import { existsSync } from 'node:fs';
import * as path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rawBody from 'fastify-raw-body';
import { z } from 'zod';
import { createCheckoutResponse } from './checkout.js';
import { createInMemoryStore } from './store.js';
import { getCompletedCheckoutOrderId, parseStripeWebhookEvent } from './stripeWebhook.js';
import type { UploadImage } from './imageUpload.js';
import { uploadProductImage } from './imageUpload.js';
import type { Store } from './types.js';

const checkoutSchema = z.object({ email: z.string().email(), items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(99) })).min(1) });
const imageUploadSchema = z.object({ fileName: z.string().min(1), contentType: z.string().regex(/^image\//), dataUrl: z.string().startsWith('data:image/') });
const imageUploadBodyLimit = 16 * 1024 * 1024;

type ServerOptions = { uploadImage?: UploadImage; serveStaticRoot?: string };

export function buildServer(store: Store = createInMemoryStore(), options: ServerOptions = {}) {
  const uploadImage = options.uploadImage ?? uploadProductImage;
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
  app.post('/api/admin/products/:slug/image', { bodyLimit: imageUploadBodyLimit }, async (request, reply) => {
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
  app.get('/api/admin/orders', async () => ({ orders: await store.listOrders() }));
  app.post('/api/admin/products', async (request, reply) => {
    const product = request.body as any;
    if (!product?.slug || !product?.title) return reply.code(400).send({ error: 'Product slug and title required' });
    return { product: await store.upsertProduct(product) };
  });
  if (options.serveStaticRoot) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
