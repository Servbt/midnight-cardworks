import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';

const adminAuth = {
  authorize: async (authorization: string | undefined) => {
    if (!authorization) return { ok: false as const, status: 401 as const, error: 'Admin sign-in required' };
    if (authorization === 'Bearer admin-token') return { ok: true as const, email: 'owner@example.com' };
    return { ok: false as const, status: 403 as const, error: 'Admin access required' };
  }
};
const adminHeaders = { authorization: 'Bearer admin-token' };
function createEmailNotifierSpy() {
  const sent: Array<{ type: string; order: { id: string; email: string; status: string } }> = [];
  return {
    sent,
    notifier: {
      sendOrderPaid: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'paid', order }); },
      sendOrderFulfilled: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'fulfilled', order }); }
    }
  };
}

describe('storefront API', () => {
  it('lists active products for the shop grid', async () => {
    const app = buildServer(createInMemoryStore());
    const res = await app.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.products.length).toBeGreaterThan(2);
    expect(body.products[0]).toHaveProperty('price');
  });

  it('creates a checkout order from cart items with customer and shipping details', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: {
        email: 'buyer@example.com',
        customerName: 'Ari Buyer',
        shippingAddress: '123 Midnight Lane\nLos Angeles, CA 90001',
        items: [{ productId: 'p1', quantity: 2 }]
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending_payment', total: 2598 });
    const order = await store.getOrder(res.json().orderId);
    expect(order).toMatchObject({ email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane\nLos Angeles, CA 90001' });
  });

  it('exposes admin order review after checkout', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p2', quantity: 1 }] } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: adminHeaders });
    expect(res.json().orders[0].email).toBe('buyer@example.com');
  });

  it('marks an order paid when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } }
    });

    expect(webhook.statusCode).toBe(200);
    const orders = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: adminHeaders });
    expect(orders.json().orders[0]).toMatchObject({ id: orderId, status: 'paid' });
  });

  it('shows a checkout receipt with current order status', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId);

    const receipt = await app.inject({ method: 'GET', url: `/api/orders/${orderId}` });

    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().order).toMatchObject({ id: orderId, email: 'buyer@example.com', total: 1299, status: 'paid' });
  });

  it('lets admins mark paid orders fulfilled', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId);

    const fulfill = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/fulfill`, headers: adminHeaders });
    const receipt = await app.inject({ method: 'GET', url: `/api/orders/${orderId}` });

    expect(fulfill.statusCode).toBe(200);
    expect(fulfill.json().order).toMatchObject({ id: orderId, status: 'fulfilled' });
    expect(receipt.json().order).toMatchObject({ id: orderId, status: 'fulfilled' });
  });

  it('sends an order confirmation email when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } }
    });

    expect(webhook.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'paid', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'paid' }) }]);
  });

  it('sends a fulfillment email when admins mark orders fulfilled', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId);

    const fulfill = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/fulfill`, headers: adminHeaders });

    expect(fulfill.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'fulfilled', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'fulfilled' }) }]);
  });

  it('uploads and saves a product image for an admin listing', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, {
      adminAuth,
      uploadImage: async () => ({ url: 'https://images.example.com/golden.jpg' })
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/products/golden-hour-commander-proxy/image',
      headers: adminHeaders,
      payload: { fileName: 'golden.jpg', contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,abc123' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().product).toMatchObject({ slug: 'golden-hour-commander-proxy', image: 'https://images.example.com/golden.jpg' });
    const product = await store.getProduct('golden-hour-commander-proxy');
    expect(product?.image).toBe('https://images.example.com/golden.jpg');
  });

  it('accepts practical product image payload sizes for admin uploads', async () => {
    const app = buildServer(createInMemoryStore(), {
      adminAuth,
      uploadImage: async () => ({ url: 'https://images.example.com/large-golden.jpg' })
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/products/golden-hour-commander-proxy/image',
      headers: adminHeaders,
      payload: { fileName: 'large-golden.jpg', contentType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${'a'.repeat(2_000_000)}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().product.image).toBe('https://images.example.com/large-golden.jpg');
  });

  it('creates and updates admin products while keeping inactive products out of the storefront', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: adminHeaders,
      payload: {
        slug: 'secret-drop',
        title: 'Secret Drop Proxy',
        description: 'Hidden draft listing',
        price: 1599,
        category: 'Commander',
        tags: ['draft', 'commander'],
        image: 'https://images.example.com/secret.jpg',
        inventory: 4,
        active: false
      }
    });
    const shop = await app.inject({ method: 'GET', url: '/api/products' });
    const adminProducts = await app.inject({ method: 'GET', url: '/api/admin/products', headers: adminHeaders });
    const update = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: adminHeaders,
      payload: {
        slug: 'secret-drop',
        title: 'Secret Drop Proxy Updated',
        description: 'Live listing',
        price: 1699,
        category: 'Commander',
        tags: ['commander'],
        image: 'https://images.example.com/secret.jpg',
        inventory: 7,
        active: true
      }
    });

    expect(create.statusCode).toBe(200);
    expect(create.json().product).toMatchObject({ slug: 'secret-drop', active: false });
    expect(shop.json().products.map((product: { slug: string }) => product.slug)).not.toContain('secret-drop');
    expect(adminProducts.json().products.map((product: { slug: string }) => product.slug)).toContain('secret-drop');
    expect(update.json().product).toMatchObject({ slug: 'secret-drop', title: 'Secret Drop Proxy Updated', price: 1699, inventory: 7, active: true });
  });

  it('blocks anonymous and non-admin access to admin orders', async () => {
    const app = buildServer(createInMemoryStore(), { adminAuth });

    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/orders' });
    const nonAdmin = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: { authorization: 'Bearer customer-token' } });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: 'Admin sign-in required' });
    expect(nonAdmin.statusCode).toBe(403);
    expect(nonAdmin.json()).toEqual({ error: 'Admin access required' });
  });

  it('serves the built React app and keeps API 404s as JSON in production mode', async () => {
    const staticRoot = await mkdtemp(path.join(tmpdir(), 'midnight-cardworks-web-'));
    await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Midnight Cardworks</title><div id="root"></div>');

    try {
      const app = buildServer(createInMemoryStore(), { serveStaticRoot: staticRoot });
      const home = await app.inject({ method: 'GET', url: '/' });
      const clientRoute = await app.inject({ method: 'GET', url: '/account' });
      const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

      expect(home.statusCode).toBe(200);
      expect(home.headers['content-type']).toContain('text/html');
      expect(home.body).toContain('Midnight Cardworks');
      expect(clientRoute.statusCode).toBe(200);
      expect(clientRoute.body).toContain('Midnight Cardworks');
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.json()).toEqual({ error: 'Not found' });
    } finally {
      await rm(staticRoot, { recursive: true, force: true });
    }
  });
});
