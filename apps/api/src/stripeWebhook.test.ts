import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';

// Use the actual installed SDK and raw HTTP payloads; no mocked Stripe constructor.
const stripe = new Stripe('sk_test_synthetic');
const secret = 'whsec_synthetic';
const apps: ReturnType<typeof buildServer>[] = [];
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  vi.stubEnv('RESEND_API_KEY', '');
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
});

async function fixture() {
  const store = createInMemoryStore();
  const product = (await store.listProducts())[0];
  const order = await store.createOrder({ email: 'test@example.test', customerName: 'Test', shippingAddress: 'Synthetic address', items: [{ productId: product.id, quantity: 1 }] });
  const app = buildServer(store, { retrieveRefund: async (order, id) => ({ id, orderId: order.id, amount: 100, status: 'succeeded' }) });
  apps.push(app);
  const payload = JSON.stringify({ id: 'evt_payment', type: 'checkout.session.completed', data: { object: { id: 'cs_test', payment_status: 'paid', payment_intent: 'pi_test', metadata: { orderId: order.id } } } }, null, 2);
  return { store, order, app, payload };
}

describe('signed Stripe webhook HTTP requests', () => {
  it('waits for delayed payment success and ignores stale completion, failure, and expiry events', async () => {
    const { app, store, order } = await fixture();
    async function send(type: string, payment_status: string, extra = {}) {
      const payload = JSON.stringify({ id: 'evt_' + type, type, data: { object: { id: 'cs_test', status: 'complete', payment_status, payment_intent: 'pi_test', metadata: { orderId: order.id }, ...extra } } });
      return app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) }, payload });
    }
    expect((await send('checkout.session.completed', 'unpaid')).statusCode).toBe(200);
    expect((await store.getOrder(order.id))?.status).toBe('pending_payment');
    expect((await send('checkout.session.async_payment_succeeded', 'paid')).statusCode).toBe(200);
    await store.markOrderFulfilled(order.id);
    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']) {
      expect((await send(type, type.includes('failed') ? 'unpaid' : 'paid')).statusCode).toBe(200);
    }
    expect((await store.getOrder(order.id))?.status).toBe('fulfilled');
    expect((await store.listProducts())[0].inventory).toBe(19);
    expect(await store.pendingNotifications(order.id)).toEqual([]);
  });

  it('rejects a signed payment that arrives after cancellation without taking released stock', async () => {
    const { app, store, order, payload } = await fixture();
    await store.cancelOrder(order.id);
    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) }, payload });
    expect(response.statusCode).toBe(400);
    expect((await store.getOrder(order.id))?.status).toBe('canceled');
    expect((await store.listProducts())[0].inventory).toBe(20);
    expect(await store.pendingNotifications(order.id)).toEqual([]);
  });
  it('verifies the original raw bytes and processes a payment', async () => {
    const { app, store, order, payload } = await fixture();
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload });
    expect(response.statusCode, response.body).toBe(200);
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'paid', stripePaymentIntentId: 'pi_test' });
  });

  it('verifies and processes a signed refund', async () => {
    const { app, store, order } = await fixture();
    await store.markOrderPaid(order.id);
    const payload = JSON.stringify({ id: 'evt_refund', type: 'refund.updated', data: { object: { id: 're_test', amount: 100, status: 'succeeded', metadata: { orderId: order.id } } } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload });
    expect(response.statusCode, response.body).toBe(200);
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'partially_refunded', refundedAmount: 100 });
  });

  it('uses the retrieved refund status instead of an older signed event snapshot', async () => {
    const { app, store, order } = await fixture();
    await store.markOrderPaid(order.id, { stripePaymentIntentId: 'pi_test' });
    const payload = JSON.stringify({ id: 'evt_old_failure', type: 'refund.failed', data: { object: { id: 're_test', amount: 100, status: 'failed', metadata: { orderId: order.id } } } });
    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) }, payload });
    expect(response.statusCode).toBe(200);
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'partially_refunded', refundedAmount: 100 });
  });

  it.each(['missing', 'wrong-secret', 'tampered', 'expired'] as const)('rejects %s signatures without changing the order', async (failure) => {
    const { app, store, order, payload } = await fixture();
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: failure === 'wrong-secret' ? 'whsec_wrong' : secret, timestamp: failure === 'expired' ? 1 : undefined });
    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', ...(failure === 'missing' ? {} : { 'stripe-signature': signature }) }, payload: failure === 'tampered' ? payload + ' ' : payload });
    expect(response.statusCode).toBe(400);
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'pending_payment', refundedAmount: 0 });
  });
});
