import { operationsHealth } from './operationsHealth.js';
import { availableProduct, InventoryError } from './inventory.js';
import { startCheckout, CheckoutClosedError, requestKey, processPaymentEvent, syncPayment, cancelCheckout, requestRefund } from './paymentService.js';
import { flushNotifications, notificationHealth } from './notificationWorker.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import rawBody from 'fastify-raw-body';
import { z } from 'zod';
import { createAdminAuthFromEnv, type AdminAuth } from './adminAuth.js';
import { createCustomerAuthFromEnv, type CustomerAuth } from './customerAuth.js';
import { createInMemoryStore } from './store.js';
import { parseStripeWebhookEvent } from './stripeWebhook.js';
import { isPermanentPaymentError } from './paymentErrors.js';
import type { UploadImage } from './imageUpload.js';
import { uploadProductImage } from './imageUpload.js';
import type { MarketingSubscriber, Store, Product } from './types.js';
import { createEmailNotifierFromEnv, type EmailNotifier } from './emailNotifications.js';
import { canReadReceipt, customerOrder } from './orderAccess.js';
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
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(99) })).min(1).max(100)
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
const newsletterSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200),
  marketingConsent: z.literal(true),
  website: z.string().optional().default('')
});
const unsubscribeSchema = z.object({ token: z.string().trim().min(8).max(160) });
const marketingCampaignSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(5000)
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
  inventoryVersion: z.number().int().nonnegative().optional(),
  active: z.boolean(),
  featured: z.boolean().optional()
}).superRefine((product, context) => {
  if (product.saleActive && (!product.salePrice || product.salePrice >= product.price)) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the regular price' });
  }
});
const imageUploadSchema = z.object({ fileName: z.string().min(1), contentType: z.string().regex(/^image\//), dataUrl: z.string().startsWith('data:image/') });
const faqItemSchema = z.object({
  id: z.string().min(1).optional(),
  question: z.string().trim().min(1).max(240),
  answer: z.string().trim().min(1).max(3000),
  sortOrder: z.number().int().nonnegative().max(9999),
  active: z.boolean()
});
const blogPostSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(180),
  excerpt: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
  published: z.boolean(),
  publishedAt: z.string().datetime().nullable().optional()
});
const orderActionSchema = z.object({ reason: z.string().trim().max(500).optional() });
const refundSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional() });
const imageUploadBodyLimit = 16 * 1024 * 1024;

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Product SEO needs absolute URLs; relative canonical/og:url values are ignored by crawlers. */
const appBaseUrl = (env: NodeJS.ProcessEnv = process.env) => {
  const value = env.APP_BASE_URL?.trim();
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
};
const productUrl = (slug: string) => {
  const base = appBaseUrl();
  return base ? `${base}products/${slug}` : `/products/${slug}`;
};
const marketingCouponCode = () => (process.env.NEWSLETTER_COUPON_CODE || 'MIDNIGHT10').trim();
function publicSubscriber(subscriber: MarketingSubscriber) {
  const { unsubscribeToken: _unsubscribeToken, ...safeSubscriber } = subscriber;
  return safeSubscriber;
}
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
/**
 * Tags a product page fully replaces. The product head was injected *alongside* the shell's
 * own head rather than in place of it, so every product page shipped two conflicting
 * canonicals — the shell's `https://servbotshop.com/` came first, which is the one crawlers
 * honoured, meaning every product page declared the homepage as its canonical and served the
 * generic homepage share card.
 */
const productReplacedTags = [
  /<title>.*?<\/title>/gi,
  /<link\b[^>]*\brel=["']canonical["'][^>]*>/gi,
  /<meta\b[^>]*\bname=["']description["'][^>]*>/gi,
  /<meta\b[^>]*\bproperty=["']og:[^"']*["'][^>]*>/gi
];
function stripProductReplacedTags(html: string) {
  return productReplacedTags.reduce((current, pattern) => current.replace(pattern, ''), html);
}
async function productSeoHtml(staticRoot: string, product: Product) {
  const html = await readFile(path.join(staticRoot, 'index.html'), 'utf8');
  const withoutReplacedTags = stripProductReplacedTags(html);
  const head = productSeoHead(product);
  return withoutReplacedTags.includes('</head>') ? withoutReplacedTags.replace('</head>', `${head}</head>`) : `${head}${withoutReplacedTags}`;
}

type ServerOptions = { uploadImage?: UploadImage; serveStaticRoot?: string; adminAuth?: AdminAuth; customerAuth?: CustomerAuth; emailNotifier?: EmailNotifier; rateLimit?: { globalMax?: number; checkoutMax?: number; publicFormMax?: number } | false };

/**
 * CORS is scoped to the shop's own origins. Previously any origin was reflected, which let
 * arbitrary sites call the API from a browser. Requests without an Origin header (same-origin
 * and server-to-server calls) are allowed by @fastify/cors regardless of this list.
 * Outside production an empty list falls back to reflection so local development keeps working.
 */
function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const candidates = [env.APP_BASE_URL, ...(env.CLERK_AUTHORIZED_PARTIES ?? '').split(',')];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') origins.add(url.origin);
    } catch { /* ignore malformed entries */ }
  }
  if (origins.size) return [...origins];
  return env.NODE_ENV === 'production' ? [] : true;
}

export async function buildServer(store: Store = createInMemoryStore(), options: ServerOptions = {}) {
  const uploadImage = options.uploadImage ?? uploadProductImage;
  const customerAuth = options.customerAuth ?? createCustomerAuthFromEnv();
  const adminAuth = options.adminAuth ?? createAdminAuthFromEnv(process.env, customerAuth);
  const emailNotifier = options.emailNotifier ?? createEmailNotifierFromEnv();
  const app = Fastify({ logger: false });
  const flushTestNotifications = async () => { if (options.emailNotifier) await flushNotifications(store, options.emailNotifier); };
  await app.register(cors, { origin: allowedOrigins() });
  // /api/checkout reserves stock for an hour before payment is captured, so an unthrottled
  // caller can hold the whole catalogue without paying. Tests run with the limiter off so
  // suites that issue many checkouts stay deterministic; passing `rateLimit` explicitly
  // (even as {}) turns it back on, which is how rateLimit.test.ts covers it.
  const rateLimits = options.rateLimit === false ? undefined
    : options.rateLimit ? {
        globalMax: options.rateLimit.globalMax ?? 600,
        checkoutMax: options.rateLimit.checkoutMax ?? 20,
        publicFormMax: options.rateLimit.publicFormMax ?? 10
      }
    : process.env.NODE_ENV === 'test' ? undefined
    : {
        globalMax: Number(process.env.RATE_LIMIT_MAX ?? 600),
        checkoutMax: Number(process.env.RATE_LIMIT_CHECKOUT_MAX ?? 20),
        publicFormMax: Number(process.env.RATE_LIMIT_PUBLIC_FORM_MAX ?? 10)
      };
  if (rateLimits) await app.register(rateLimit, { global: true, max: rateLimits.globalMax, timeWindow: '1 minute' });
  /** Per-route throttle metadata. Inert when the limiter is not registered (tests). */
  const rateLimited = (max?: number) => max === undefined ? {} : { config: { rateLimit: { max, timeWindow: '1 minute' } } };
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true, routes: ['/api/stripe/webhook'] });
  if (options.serveStaticRoot) {
    const staticRoot = path.resolve(options.serveStaticRoot);
    if (existsSync(staticRoot)) {
      app.register(fastifyStatic, { root: staticRoot, prefix: '/', wildcard: false });
    }
  }
  app.get('/health', async (_request, reply) => {
    try {
      await store.healthCheck();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  async function requireAdmin(request: { headers: { authorization?: string } }, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
    const result = await adminAuth.authorize(request.headers.authorization);
    if (result.ok === false) return reply.code(result.status).send({ error: result.error });
  }
  app.get('/api/products', async () => ({ products: (await store.listProducts()).map(availableProduct) }));
  app.get('/api/products/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await store.getProduct(slug);
    if (!product) return reply.code(404).send({ error: 'Product not found' });
    return { product: availableProduct(product) };
  });
  app.get('/api/content/faqs', async () => ({ faqItems: await store.listFaqItems() }));
  app.get('/api/content/blog-posts', async () => ({ blogPosts: await store.listBlogPosts() }));
  app.get('/api/content/blog-posts/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const post = await store.getBlogPost(slug);
    if (!post) return reply.code(404).send({ error: 'Blog post not found' });
    return { post };
  });
  app.post('/api/contact', rateLimited(rateLimits?.publicFormMax), async (request, reply) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.website) return reply.code(400).send({ error: 'Valid contact details required' });
    const { website: _website, ...message } = parsed.data;
    await emailNotifier.sendContactMessage(message);
    return { ok: true };
  });
  app.post('/api/newsletter', rateLimited(rateLimits?.publicFormMax), async (request, reply) => {
    const parsed = newsletterSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.website) return reply.code(400).send({ error: 'Valid newsletter signup and consent required' });
    const result = await store.subscribeMarketing({ email: parsed.data.email, name: parsed.data.name, source: 'storefront_coupon', couponCode: marketingCouponCode() });
    await emailNotifier.sendMarketingWelcome(result.subscriber);
    return reply.code(result.created ? 201 : 200).send({ subscriber: publicSubscriber(result.subscriber), created: result.created });
  });
  app.post('/api/newsletter/unsubscribe', async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid unsubscribe token required' });
    const subscriber = await store.unsubscribeMarketing(parsed.data.token);
    if (!subscriber) return reply.code(404).send({ error: 'Subscriber not found' });
    return { subscriber: publicSubscriber(subscriber) };
  });
  app.post('/api/checkout', rateLimited(rateLimits?.checkoutMax), async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid checkout payload' });
    try {
      const checkout = await startCheckout(store, parsed.data, requestKey(request.headers['idempotency-key']));
      await flushTestNotifications();
      reply.header('Cache-Control', 'no-store');
      return reply.code(201).send(checkout);
    } catch (error) {
      return reply.code(error instanceof InventoryError ? 409 : 400).send({ error: error instanceof Error ? error.message : 'Checkout failed', ...(error instanceof CheckoutClosedError ? { code: error.code } : {}) });
    }
  });
  app.get('/api/orders', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const result = await customerAuth.authorize(request.headers.authorization);
    if (result.ok === false) return reply.code(result.status).send({ error: result.error });
    return { orders: (await store.listOrdersByEmail(result.email)).map(customerOrder) };
  });
  app.get('/api/orders/:orderId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { orderId } = request.params as { orderId: string };
    const receiptToken = request.headers['x-receipt-token'];
    const identity = request.headers.authorization ? await customerAuth.authorize(request.headers.authorization) : undefined;
    if (identity && !identity.ok) return reply.code(identity.status).send({ error: identity.error });
    if (!identity && !receiptToken) return reply.code(401).send({ error: 'Sign-in or receipt access required' });
    const order = await store.getOrder(orderId);
    const ownsOrder = order && identity?.ok && order.email.trim().toLowerCase() === identity.email.trim().toLowerCase();
    if (!order || (!ownsOrder && !canReadReceipt(order, receiptToken))) return reply.code(404).send({ error: 'Order not found' });
    return { order: customerOrder(order) };
  });
  app.post('/api/stripe/webhook', async (request, reply) => {
    let event;
    try { event = await parseStripeWebhookEvent(request); }
    catch { return reply.code(400).send({ error: 'Invalid Stripe signature or payload' }); }
    try {
      await processPaymentEvent(store, event);
      await flushTestNotifications();
      return { received: true };
    } catch (error) {
      // A permanent failure can never succeed on redelivery. Record it against the event and
      // acknowledge, so one bad event cannot make Stripe retry forever and disable the whole
      // endpoint (which would stall every payment event, not just this one).
      if (isPermanentPaymentError(error)) {
        const reason = error instanceof Error ? error.message : 'Unreconcilable payment event';
        if (event.id) {
          try {
            await store.putRecord({ id: `event:${event.id}`, kind: 'event', data: { type: event.type, outcome: 'quarantined', reason } });
          } catch (recordError) {
            console.error('Could not record quarantined Stripe event', { eventId: event.id, errorType: recordError instanceof Error ? recordError.name : 'Error' });
            return reply.code(503).send({ error: 'Payment event processing failed; retry required' });
          }
        }
        console.error('Stripe event quarantined for manual reconciliation', { eventId: event.id, type: event.type, reason });
        return reply.code(200).send({ received: true, quarantined: true, reason });
      }
      console.error('Stripe event processing failed', { eventId: event.id, type: event.type, errorType: error instanceof Error ? error.name : 'Error' });
      return reply.code(503).send({ error: 'Payment event processing failed; retry required' });
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
  app.get('/api/admin/content', { preHandler: requireAdmin }, async () => ({ faqItems: await store.listFaqItems({ includeInactive: true }), blogPosts: await store.listBlogPosts({ includeDrafts: true }) }));
  app.post('/api/admin/content/faqs', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = faqItemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid FAQ content required' });
    return { faqItem: await store.upsertFaqItem(parsed.data) };
  });
  app.post('/api/admin/content/blog-posts', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = blogPostSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid blog post content required' });
    return { blogPost: await store.upsertBlogPost(parsed.data) };
  });
  app.get('/api/admin/marketing/subscribers', { preHandler: requireAdmin }, async () => ({ subscribers: (await store.listMarketingSubscribers()).map(publicSubscriber) }));
  app.post('/api/admin/marketing/campaigns', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = marketingCampaignSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid marketing campaign required' });
    const subscribers = (await store.listMarketingSubscribers()).filter((subscriber) => subscriber.status === 'subscribed');
    for (const subscriber of subscribers) await emailNotifier.sendMarketingCampaign(subscriber, parsed.data);
    return { sent: subscribers.length };
  });
  app.get('/api/admin/operations-health', { preHandler: requireAdmin }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationsHealth(store);
  });
  app.get('/api/admin/payment-health', { preHandler: requireAdmin }, async () => ({
    notifications: await notificationHealth(store),
    inventoryHolds: (await store.listReservationOrders()).map(o => ({ orderId: o.id, state: o.inventoryState, expiresAt: o.reservationExpiresAt })),
    inventoryIssues: (await store.listOrders()).filter(o => o.inventoryIssue).map(o => ({ orderId: o.id, issue: o.inventoryIssue })),
    inventoryRecovery: (await store.listRecords('inventory-recovery')).filter(r => (r.data as { state: string }).state === 'attention').map(r => ({ orderId: r.orderId })),
    unresolvedOperations: [...await store.listRecords('checkout'), ...await store.listRecords('refund-request')]
      .filter(r => !(r.data as { done?: boolean }).done).map(r => ({ id: r.id, orderId: r.orderId, kind: r.kind }))
  }));
  app.post('/api/admin/orders/:orderId/sync-payment', { preHandler: requireAdmin }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const order = await store.getOrder(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    try {
      const updated = await syncPayment(store, order);
      await flushTestNotifications();
      return { order: updated };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Payment sync failed' }); }
  });
  app.post('/api/admin/orders/:orderId/fulfill', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const order = await store.markOrderFulfilled((request.params as { orderId: string }).orderId);
      if (!order) return reply.code(404).send({ error: 'Order not found' });
      await flushTestNotifications();
      return { order };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Fulfillment failed' }); }
  });
  app.post('/api/admin/orders/:orderId/cancel', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = orderActionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Valid cancellation details required' });
    const order = await store.getOrder((request.params as { orderId: string }).orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    try {
      const updated = await cancelCheckout(store, order, parsed.data.reason);
      await flushTestNotifications();
      return { order: updated };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Cancellation failed' }); }
  });
  app.post('/api/admin/orders/:orderId/refund', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = refundSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Valid refund details required' });
    try {
      const result = await requestRefund(store, (request.params as { orderId: string }).orderId, parsed.data, requestKey(request.headers['idempotency-key']));
      await flushTestNotifications();
      return result;
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Refund failed' }); }
  });
  app.post('/api/admin/products', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid product details required' });
    const existing = await store.getProduct(parsed.data.slug);
    return { product: await store.upsertProduct({ ...parsed.data, id: parsed.data.id ?? existing?.id ?? `prod_${parsed.data.slug}` }) };
  });
  // Without these routes the SPA not-found handler served index.html for /robots.txt and
  // /sitemap.xml, so crawlers saw HTML instead of a robots file.
  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /cart',
    'Disallow: /checkout/',
    'Disallow: /account',
    '',
    `Sitemap: ${appBaseUrl() || 'https://servbotshop.com/'}sitemap.xml`
  ].join('\n')));
  app.get('/sitemap.xml', async (_request, reply) => {
    const base = appBaseUrl() || 'https://servbotshop.com/';
    const paths = ['', 'shop', 'faq', 'blog', 'privacy', 'contact', ...(await store.listProducts()).map((product) => `products/${product.slug}`)];
    return reply.type('application/xml').send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...paths.map((path) => `  <url><loc>${escapeHtml(`${base}${path}`)}</loc></url>`),
      '</urlset>'
    ].join('\n'));
  });
  if (options.serveStaticRoot) {
    const staticRoot = path.resolve(options.serveStaticRoot);
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      const productMatch = request.url.split('?')[0].match(/^\/products\/([a-z0-9-]+)$/);
      if (productMatch) {
        const product = await store.getProduct(productMatch[1]);
        if (product?.active) return reply.type('text/html').send(await productSeoHtml(staticRoot, availableProduct(product)));
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}
