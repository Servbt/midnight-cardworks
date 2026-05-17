import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';

describe('storefront API', () => {
  it('lists active products for the shop grid', async () => {
    const app = buildServer(createInMemoryStore());
    const res = await app.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.products.length).toBeGreaterThan(2);
    expect(body.products[0]).toHaveProperty('price');
  });

  it('creates a checkout order from cart items', async () => {
    const app = buildServer(createInMemoryStore());
    const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 2 }] } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending_payment', total: 2598 });
  });

  it('exposes admin order review after checkout', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p2', quantity: 1 }] } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/orders' });
    expect(res.json().orders[0].email).toBe('buyer@example.com');
  });

  it('marks an order paid when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] } });
    const orderId = checkout.json().orderId;

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } }
    });

    expect(webhook.statusCode).toBe(200);
    const orders = await app.inject({ method: 'GET', url: '/api/admin/orders' });
    expect(orders.json().orders[0]).toMatchObject({ id: orderId, status: 'paid' });
  });
});
