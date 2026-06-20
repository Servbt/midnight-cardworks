import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rawBody from 'fastify-raw-body';
import { z } from 'zod';
import { createCheckoutResponse } from './checkout.js';
import { createOrderRefund } from './stripeRefunds.js';
import { createAdminAuthFromEnv, type AdminAuth } from './adminAuth.js';
import { createCustomerAuthFromEnv, type CustomerAuth } from './customerAuth.js';
import { createInMemoryStore } from './store.js';
import { getCompletedCheckout, getRefundUpdate, parseStripeWebhookEvent } from './stripeWebhook.js';
import type { UploadImage } from './imageUpload.js';
import { uploadProductImage } from './imageUpload.js';
import type { Store, Product } from './types.js';
import { createEmailNotifierFromEnv, type EmailNotifier } from './emailNotifications.js';
import { effectiveProductPrice } from './pricing.js';

const shippingAddressFieldsSchema = z.object({
  streetAddress: z.string().trim().min(1).max(200),
  apartment: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(1).max(120),
  zipCode: z.string().trim().min(5).max(20)
});
const checkoutSchema = z.object({
  email: z.string().trim().email(),
  customerName: z.string().trim().min(1).max(120),
  shippingAddressFields: shippingAddressFieldsSchema,
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(99) })).min(1)
}).transform(({ shippingAddressFields, ...checkout }) => ({
  ...checkout,
  shippingAddress: [
    shippingAddressFields.streetAddress,
    shippingAddressFields.apartment,
    `${shippingAddressFields.city} ${shippingAddressFields.zipCode}`
  ].filter(Boolean).join(', ')
}));
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  orderNumber: z.string().trim().max(80).optional(),
  message: z.string().trim().min(10).max(3000),
  website: z.string().optional().default('')
});
const productSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().int().nonnegative(),
  saleActive: z.boolean().default(false),
  salePrice: z.number().int().positive().nullable().optional().default(null),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  image: z.string().min(1),
  inventory: z.number().int().nonnegative(),
  active: z.boolean(),
  featured: z.boolean().optional()
}).superRefine((product, context) => {
  if (product.saleActive && (!product.salePrice || product.salePrice >= product.price)) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the regular price' });
  }
});
const imageUploadSchema = z.object({ fileName: z.string().min(1), contentType: z.string().regex(/^image\//), dataUrl: z.string().startsWith('data:image/') });
const orderActionSchema = z.object({ reason: z.string().trim().max(500).optional() });
const refundSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional() });
const imageUploadBodyLimit = 16 * 1024 * 1024;

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const productUrl = (slug: string) => `/products/${slug}`;
function productSeoHead(product: Product) {
  const title = `${product.title} | Midnight Cardworks`;
  const url = productUrl(product.slug);
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description,
    image: product.image,
    category: product.category,
    url,
    offers: { '@type': 'Offer', priceCurrency: 'USD', price: (effectiveProductPrice(product) / 100).toFixed(2), availability: product.inventory > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }
  });
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(product.description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:title" content="${escapeHtml(product.title)}">`,
    `<meta property="og:description" content="${escapeHtml(product.description)}">`,
    `<meta property="og:image" content="${escapeHtml(product.image)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<script type="application/ld+json">${jsonLd.replace(/</g, '\\u003c')}</script>`
  ].join('');
}
async function productSeoHtml(staticRoot: string, product: Product) {
  const html = await readFile(path.join(staticRoot, 'index.html'), 'utf8');
  const withoutTitle = html.replace(/<title>.*?<\/title>/i, '');
  const head = productSeoHead(product);
  return withoutTitle.includes('</head>') ? withoutTitle.replace('</head>', `${head}</head>`) : `${head}${withoutTitle}`;
}

type ServerOptions = { uploadImage?: UploadImage; serveStaticRoot?: string; adminAuth?: AdminAuth; customerAuth?: CustomerAuth; emailNotifier?: EmailNotifier };

export function buildServer(store: Store = createInMemoryStore(), options: ServerOptions = {}) {
  const uploadImage = options.uploadImage ?? uploadProductImage;
  const adminAuth = options.adminAuth ?? createAdminAuthFromEnv();
  const customerAuth = options.customerAuth ?? createCustomerAuthFromEnv();
  const emailNotifier = options.emailNotifier ?? createEmailNotifierFromEnv();
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true, routes: ['/api/stripe/webhook'] });
  if (options.serveStaticRoot) {
    const staticRoot = path.resolve(options.serveStaticRoot);
    if (existsSync(staticRoot)) {
      app.register(fastifyStatic, { root: staticRoot, prefix: '/', wildcard: false });
    }
  }
  app.get('/health', async () => ({ ok: true }));
  async function requireAdmin(request: { headers: { authorization?: string } }, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
    const result = await adminAuth.authorize(request.headers.authorization);
    if (result.ok === false) return reply.code(result.status).send({ error: result.error });
  }
  app.get('/api/products', async () => ({ products: await store.listProducts() }));
  app.get('/api/products/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await store.getProduct(slug);
    if (!product) return reply.code(404).send({ error: 'Product not found' });
    return { product };
  });
  app.post('/api/contact', async (request, reply) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.website) return reply.code(400).send({ error: 'Valid contact details required' });
    const { website: _website, ...message } = parsed.data;
    await emailNotifier.sendContactMessage(message);
    return { ok: true };
  });
  app.post('/api/checkout', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid checkout payload' });
    try {
      const order = await store.createOrder(parsed.data);
      const checkout = await createCheckoutResponse(order);
      if (checkout.stripeSessionId) await store.recordCheckoutSession(order.id, checkout.stripeSessionId);
      return reply.code(201).send(checkout);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Checkout failed' });
    }
  });
  app.get('/api/orders', async (request, reply) => {
    const result = await customerAuth.authorize(request.headers.authorization);
    if (result.ok === false) return reply.code(result.status).send({ error: result.error });
    return { orders: await store.listOrdersByEmail(result.email) };
  });
  app.get('/api/orders/:orderId', async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const order = await store.getOrder(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return { order };
  });
  app.post('/api/stripe/webhook', async (request, reply) => {
    try {
      const event = await parseStripeWebhookEvent(request);
      const checkout = getCompletedCheckout(event);
      if (checkout) {
        const order = await store.markOrderPaid(checkout.orderId, { stripeSessionId: checkout.stripeSessionId, stripePaymentIntentId: checkout.stripePaymentIntentId });
        if (!order) return reply.code(404).send({ error: 'Order not found' });
        await emailNotifier.sendOrderPaid(order);
      }
      const refund = getRefundUpdate(event);
      if (refund) {
        if (refund.status === 'failed') {
          const order = await store.markOrderRefundFailed(refund.orderId, { refundId: refund.refundId, reason: refund.reason });
          if (!order) return reply.code(404).send({ error: 'Order not found' });
        } else if (refund.status === 'succeeded') {
          const order = await store.markOrderRefunded(refund.orderId, { amount: refund.amount, refundId: refund.refundId, reason: refund.reason });
          if (!order) return reply.code(404).send({ error: 'Order not found' });
        } else {
          const order = await store.markOrderRefundPending(refund.orderId, { amount: refund.amount, refundId: refund.refundId, reason: refund.reason });
          if (!order) return reply.code(404).send({ error: 'Order not found' });
        }
      }
      return { received: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid Stripe webhook' });
    }
  });
  app.post('/api/admin/products/:slug/image', { bodyLimit: imageUploadBodyLimit, preHandler: requireAdmin }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = imageUploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid image upload required' });
    try {
      const uploaded = await uploadImage({ ...parsed.data, folder: 'midnight-cardworks/products' });
      const product = await store.updateProductImage(slug, uploaded.url);
      if (!product) return reply.code(404).send({ error: 'Product not found' });
      return { product };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Image upload failed' });
    }
  });
  app.get('/api/admin/orders', { preHandler: requireAdmin }, async () => ({ orders: await store.listOrders() }));
  app.get('/api/admin/products', { preHandler: requireAdmin }, async () => ({ products: await store.listAdminProducts() }));
  app.post('/api/admin/orders/:orderId/fulfill', { preHandler: requireAdmin }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const order = await store.markOrderFulfilled(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    await emailNotifier.sendOrderFulfilled(order);
    return { order };
  });
  app.post('/api/admin/orders/:orderId/cancel', { preHandler: requireAdmin }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const parsed = orderActionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Valid cancellation details required' });
    const order = await store.getOrder(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (order.status !== 'pending_payment') return reply.code(400).send({ error: 'Only pending payment orders can be canceled without a refund' });
    return { order: await store.cancelOrder(orderId, parsed.data.reason) };
  });
  app.post('/api/admin/orders/:orderId/refund', { preHandler: requireAdmin }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const parsed = refundSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Valid refund details required' });
    const order = await store.getOrder(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (!['paid', 'fulfilled', 'partially_refunded', 'refund_failed'].includes(order.status)) return reply.code(400).send({ error: 'Only paid or fulfilled orders can be refunded' });
    try {
      const refund = await createOrderRefund(order, parsed.data);
      const updated = refund.status === 'succeeded'
        ? await store.markOrderRefunded(orderId, { amount: refund.amount, refundId: refund.refundId, reason: refund.reason })
        : await store.markOrderRefundPending(orderId, { amount: refund.amount, refundId: refund.refundId, reason: refund.reason });
      return { order: updated, refund };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Refund failed' });
    }
  });
  app.post('/api/admin/products', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid product details required' });
    const existing = await store.getProduct(parsed.data.slug);
    return { product: await store.upsertProduct({ ...parsed.data, id: parsed.data.id ?? existing?.id ?? `prod_${parsed.data.slug}` }) };
  });
  if (options.serveStaticRoot) {
    const staticRoot = path.resolve(options.serveStaticRoot);
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      const productMatch = request.url.split('?')[0].match(/^\/products\/([a-z0-9-]+)$/);
      if (productMatch) {
        const product = await store.getProduct(productMatch[1]);
        if (product?.active) return reply.type('text/html').send(await productSeoHtml(staticRoot, product));
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}
