import { existsSync } from 'node:fs';
import * as path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rawBody from 'fastify-raw-body';
import { z } from 'zod';
import { createCheckoutResponse } from './checkout.js';
import { createAdminAuthFromEnv, type AdminAuth } from './adminAuth.js';
import { createInMemoryStore } from './store.js';
import { getCompletedCheckoutOrderId, parseStripeWebhookEvent } from './stripeWebhook.js';
import type { UploadImage } from './imageUpload.js';
import { uploadProductImage } from './imageUpload.js';
import type { Store } from './types.js';

const checkoutSchema = z.object({ email: z.string().email(), customerName: z.string().min(1).optional(), shippingAddress: z.string().min(1).optional(), items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(99) })).min(1) });
const productSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().int().nonnegative(),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  image: z.string().min(1),
  inventory: z.number().int().nonnegative(),
  active: z.boolean(),
  featured: z.boolean().optional()
});
const imageUploadSchema = z.object({ fileName: z.string().min(1), contentType: z.string().regex(/^image\//), dataUrl: z.string().startsWith('data:image/') });
const imageUploadBodyLimit = 16 * 1024 * 1024;

type ServerOptions = { uploadImage?: UploadImage; serveStaticRoot?: string; adminAuth?: AdminAuth };

export function buildServer(store: Store = createInMemoryStore(), options: ServerOptions = {}) {
  const uploadImage = options.uploadImage ?? uploadProductImage;
  const adminAuth = options.adminAuth ?? createAdminAuthFromEnv();
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
  app.post('/api/checkout', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid checkout payload' });
    try {
      const order = await store.createOrder(parsed.data);
      return reply.code(201).send(await createCheckoutResponse(order));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Checkout failed' });
    }
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
      const orderId = getCompletedCheckoutOrderId(event);
      if (orderId) {
        const order = await store.markOrderPaid(orderId);
        if (!order) return reply.code(404).send({ error: 'Order not found' });
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
    return { order };
  });
  app.post('/api/admin/products', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Valid product details required' });
    const existing = await store.getProduct(parsed.data.slug);
    return { product: await store.upsertProduct({ ...parsed.data, id: parsed.data.id ?? existing?.id ?? `prod_${parsed.data.slug}` }) };
  });
  if (options.serveStaticRoot) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
