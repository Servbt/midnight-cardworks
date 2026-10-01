import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';
import { hashReceiptToken } from './receiptAccess.js';

const apps: ReturnType<typeof buildServer>[] = [];
beforeEach(() => { vi.stubEnv('STRIPE_SECRET_KEY', ''); vi.stubEnv('RESEND_API_KEY', ''); });
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); vi.unstubAllEnvs(); });

async function fixture() {
  const store = createInMemoryStore();
  const app = buildServer(store, {
    customerAuth: { authorize: async (header) => header === 'Bearer owner' ? { ok: true, email: 'buyer@example.test' } : header === 'Bearer other' ? { ok: true, email: 'other@example.test' } : { ok: false, status: 401, error: 'Sign-in required' } },
    adminAuth: { authorize: async (header) => header === 'Bearer admin' ? { ok: true, email: 'admin@example.test' } : { ok: false, status: 403, error: 'Admin required' } }
  });
  apps.push(app);
  const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: {
    email: 'BUYER@example.test', customerName: 'Buyer', shippingAddressFields: { streetAddress: 'Test street', city: 'Test city', zipCode: '10001' }, items: [{ productId: 'p1', quantity: 1 }]
  } });
  expect(checkout.statusCode).toBe(201);
  return { store, app, ...checkout.json() as { orderId: string; receiptToken: string; checkoutUrl: string } };
}

describe('private order receipts', () => {
  it('stores only a hash and keeps the token out of checkout URLs', async () => {
    const { store, orderId, receiptToken, checkoutUrl } = await fixture();
    expect(receiptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const order = await store.getOrder(orderId);
    expect(order?.receiptTokenHash).toBe(hashReceiptToken(receiptToken));
    expect(JSON.stringify(order)).not.toContain(receiptToken);
    expect(checkoutUrl).not.toContain(receiptToken);
  });
  it('allows the guest credential and returns only receipt fields', async () => {
    const { app, orderId, receiptToken } = await fixture();
    const receipt = await app.inject({ url: `/api/orders/${orderId}`, headers: { 'x-receipt-token': receiptToken } });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['cache-control']).toBe('no-store');
    expect(Object.keys(receipt.json().order).sort()).toEqual(['id', 'items', 'refundedAmount', 'shippingAddress', 'shippingCost', 'status', 'subtotal', 'total'].sort());
    expect(receipt.json().order.items[0]).toEqual({ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 });
  });
  it.each([undefined, '', 'invalid', 'a'.repeat(43)])('rejects absent or invalid guest credentials %s', async (token) => {
    const { app, orderId } = await fixture();
    const response = await app.inject({ url: `/api/orders/${orderId}`, headers: token ? { 'x-receipt-token': token } : {} });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Order not found' });
  });
  it('does not accept another order token or a token in a query parameter', async () => {
    const first = await fixture();
    const second = await fixture();
    expect((await first.app.inject({ url: `/api/orders/${first.orderId}`, headers: { 'x-receipt-token': second.receiptToken } })).statusCode).toBe(404);
    expect((await first.app.inject(`/api/orders/${first.orderId}?token=${first.receiptToken}`)).statusCode).toBe(404);
  });
  it.each(['owner', 'admin'])('allows authenticated %s access', async (role) => {
    const { app, orderId } = await fixture();
    expect((await app.inject({ url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${role}` } })).statusCode).toBe(200);
  });
  it('rejects a different account and a forged bearer token', async () => {
    const { app, orderId } = await fixture();
    for (const role of ['other', 'forged']) expect((await app.inject({ url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${role}` } })).statusCode).toBe(404);
  });
  it('protects legacy orders without guest tokens while retaining owner access', async () => {
    const { store, app } = await fixture();
    const legacy = await store.createOrder({ email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Legacy address', items: [{ productId: 'p1', quantity: 1 }] });
    expect((await app.inject(`/api/orders/${legacy.id}`)).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/orders/${legacy.id}`, headers: { authorization: 'Bearer owner' } })).statusCode).toBe(200);
  });
  it('keeps receipt hashes and saved checkout requests out of account/admin responses', async () => {
    const { app, receiptToken } = await fixture();
    for (const [url, role] of [['/api/orders', 'owner'], ['/api/admin/orders', 'admin']]) {
      const response = await app.inject({ url, headers: { authorization: `Bearer ${role}` } });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('receiptTokenHash');
      expect(response.body).not.toContain('checkoutRequestJson');
      expect(response.body).not.toContain(receiptToken);
    }
  });
});
