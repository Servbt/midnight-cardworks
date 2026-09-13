import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';
import { hashReceiptToken } from './orderAccess.js';

const payload = { email: 'Buyer@Example.com', customerName: 'Buyer', shippingAddressFields: { streetAddress: '123 Test Street', city: 'Test', zipCode: '12345' }, items: [{ productId: 'p1', quantity: 1 }] };
const customerAuth = { async authorize(value: string | undefined) {
  if (value === 'Bearer buyer') return { ok: true as const, email: 'buyer@example.com' };
  if (value === 'Bearer stranger') return { ok: true as const, email: 'stranger@example.com' };
  return { ok: false as const, status: 401 as const, error: 'Invalid session' };
} };
afterEach(() => vi.unstubAllEnvs());

describe('order access', () => {
  it('requires a per-order guest token or the matching verified account, and limits disclosed fields', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const store = createInMemoryStore();
    const app = buildServer(store, { customerAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload });
    expect(checkout.statusCode).toBe(201);
    const id = checkout.json().orderId;
    const token = new URLSearchParams(new URL(checkout.json().checkoutUrl, 'http://localhost').hash.slice(1)).get('receiptToken')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.getOrder(id)).toMatchObject({ email: 'buyer@example.com', receiptTokenHash: hashReceiptToken(token) });
    expect(checkout.body).not.toContain('receiptTokenHash');
    const second = await app.inject({ method: 'POST', url: '/api/checkout', payload });
    const otherId = second.json().orderId;
    expect(second.json().checkoutUrl).not.toContain(token);
    await store.markOrderPaid(id, { stripeSessionId: 'cs_private', stripePaymentIntentId: 'pi_private' });
    const get = (orderId = id, headers = {}) => app.inject({ method: 'GET', url: '/api/orders/' + orderId, headers });
    expect((await get()).statusCode).toBe(401);
    expect((await get(id, { authorization: 'Bearer stranger' })).statusCode).toBe(404);
    expect((await get(id, { authorization: 'Bearer forged' })).statusCode).toBe(401);
    expect((await get(id, { 'x-receipt-token': 'x'.repeat(43) })).statusCode).toBe(404);
    expect((await get(otherId, { 'x-receipt-token': token })).statusCode).toBe(404);
    expect((await get('missing', { 'x-receipt-token': token })).statusCode).toBe(404);
    expect((await get(id, { 'x-receipt-token': hashReceiptToken(token) })).statusCode).toBe(404);
    for (const headers of [{ 'x-receipt-token': token }, { authorization: 'Bearer buyer' }]) {
      const receipt = await get(id, headers);
      expect(receipt.statusCode).toBe(200);
      expect(receipt.headers['cache-control']).toBe('no-store');
      expect(receipt.json().order).toMatchObject({ id, status: 'paid', shippingAddress: '123 Test Street, Test 12345' });
      for (const key of ['email', 'customerName', 'receiptTokenHash', 'stripeSessionId', 'stripePaymentIntentId', 'stripeRefundId', 'refundReason']) expect(receipt.json().order).not.toHaveProperty(key);
    }
    const history = await app.inject({ method: 'GET', url: '/api/orders', headers: { authorization: 'Bearer buyer' } });
    expect(history.statusCode).toBe(200);
    expect(history.json().orders).toHaveLength(2);
    expect(history.headers['cache-control']).toBe('no-store');
    for (const order of history.json().orders) expect(order).not.toHaveProperty('receiptTokenHash');
    expect(history.body).not.toContain('pi_private');
    const strangerHistory = await app.inject({ method: 'GET', url: '/api/orders?email=buyer@example.com', headers: { authorization: 'Bearer stranger' } });
    expect(strangerHistory.json().orders).toEqual([]);
    await app.close();
  });
  it('keeps legacy orders private while allowing their verified owner to read them', async () => {
    const store = createInMemoryStore();
    const legacy = await store.createOrder({ email: 'BUYER@example.com', customerName: 'Buyer', shippingAddress: 'Test address', items: payload.items });
    const app = buildServer(store, { customerAuth });
    expect((await app.inject({ url: '/api/orders/' + legacy.id, headers: { 'x-receipt-token': 'x'.repeat(43) } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/orders/' + legacy.id, headers: { authorization: 'Bearer buyer' } })).statusCode).toBe(200);
    await app.close();
  });
});
