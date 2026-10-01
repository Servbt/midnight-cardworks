import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from './store.js';
import { cancelCheckout, releaseExpiredReservations } from './checkoutLifecycle.js';
import { getCompletedCheckout } from './stripeWebhook.js';
import Stripe from 'stripe';
import { buildServer } from './server.js';

const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), expire: vi.fn(), create: vi.fn(), intent: vi.fn() }));
vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stripe')>();
  return { ...actual, default: class extends actual.default {
    constructor(key: string) {
      super(key);
      this.checkout.sessions.retrieve = mocks.retrieve;
      this.checkout.sessions.expire = mocks.expire;
      this.checkout.sessions.create = mocks.create;
      this.paymentIntents.retrieve = mocks.intent;
    }
  } };
});
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture(session = true) {
  const store = createInMemoryStore();
  const order = await store.createOrder({ email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Synthetic address', items: [{ productId: 'p1', quantity: 2 }], useStripe: true });
  if (session) await store.recordCheckoutSession(order.id, 'cs_test');
  const state = { id: 'cs_test', status: 'open', payment_status: 'unpaid', metadata: { orderId: order.id }, payment_intent: 'pi_test' };
  mocks.retrieve.mockResolvedValue(state);
  mocks.expire.mockResolvedValue({ ...state, status: 'expired' });
  return { store, order, state };
}

describe('reservation release lifecycle', () => {
  it('expires the live Stripe session before returning stock', async () => {
    const { store, order } = await fixture();
    await cancelCheckout(store, order, 'Canceled');
    expect(mocks.expire).toHaveBeenCalledWith('cs_test');
    expect((await store.listProducts())[0].inventory).toBe(20);
  });
  it('holds stock when Stripe payment wins the expiration race', async () => {
    const { store, order, state } = await fixture();
    mocks.expire.mockRejectedValue(new Error('Already completed'));
    mocks.retrieve.mockResolvedValueOnce(state).mockResolvedValue({ ...state, status: 'complete', payment_status: 'paid' });
    await expect(cancelCheckout(store, order, 'Canceled')).rejects.toThrow('completed');
    expect((await store.listProducts())[0].inventory).toBe(18);
    expect((await store.getOrder(order.id))?.status).toBe('pending_payment');
  });
  it('holds stock on network failure', async () => {
    const { store, order } = await fixture();
    mocks.retrieve.mockRejectedValue(new Error('Timeout'));
    await expect(cancelCheckout(store, order, 'Canceled')).rejects.toThrow('Timeout');
    expect((await store.listProducts())[0].inventory).toBe(18);
  });
  it.each(['validation', 'timeout', 'conflict'] as const)('handles %s during the initial checkout request safely', async (failure) => {
    vi.stubEnv('RESEND_API_KEY', '');
    const store = createInMemoryStore();
    const app = buildServer(store);
    const error = failure === 'timeout' ? new Error('Connection timeout') : new Stripe.errors.StripeInvalidRequestError({
      message: 'Request rejected', statusCode: failure === 'validation' ? 400 : 409,
      ...(failure === 'conflict' ? { code: 'idempotency_key_in_use' } : {})
    });
    mocks.create.mockRejectedValue(error);
    const response = await app.inject({ method: 'POST', url: '/api/checkout', payload: {
      email: 'buyer@example.test', customerName: 'Buyer', shippingAddressFields: { streetAddress: 'Test street', city: 'Test city', zipCode: '10001' }, items: [{ productId: 'p1', quantity: 2 }]
    } });
    expect(response.statusCode).toBe(400);
    expect((await store.listProducts())[0].inventory).toBe(failure === 'validation' ? 20 : 18);
    expect((await store.listOrders())[0].status).toBe(failure === 'validation' ? 'canceled' : 'pending_payment');
    await app.close();
  });
  it('recovers an unrecorded session using the exact persisted request and stable key', async () => {
    const { store, order } = await fixture(false);
    mocks.create.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.example.test' });
    await cancelCheckout(store, order, 'Canceled');
    expect(mocks.create).toHaveBeenCalledWith(JSON.parse(order.checkoutRequestJson!), { idempotencyKey: `checkout:${order.id}` });
    expect((await store.listProducts())[0].inventory).toBe(20);
  });
  it('does not retry an unrecorded session after the idempotency recovery window', async () => {
    const { store, order } = await fixture(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    await expect(cancelCheckout(store, order, 'Canceled')).rejects.toThrow('too old');
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await store.listProducts())[0].inventory).toBe(18);
  });
  it('does not trust a mismatched Stripe session', async () => {
    const { store, order, state } = await fixture();
    mocks.retrieve.mockResolvedValue({ ...state, metadata: { orderId: 'different' } });
    await expect(cancelCheckout(store, order, 'Canceled')).rejects.toThrow('does not match');
    expect(mocks.expire).not.toHaveBeenCalled();
  });
  it('releases stock for a confirmed failed delayed payment', async () => {
    const { store, order, state } = await fixture();
    mocks.retrieve.mockResolvedValue({ ...state, status: 'complete' });
    mocks.intent.mockResolvedValue({ status: 'requires_payment_method' });
    await cancelCheckout(store, order, 'Payment failed', true);
    expect((await store.listProducts())[0].inventory).toBe(20);
  });
  it('does not release stock for a delayed payment still processing', async () => {
    const { store, order, state } = await fixture();
    mocks.retrieve.mockResolvedValue({ ...state, status: 'complete' });
    mocks.intent.mockResolvedValue({ status: 'processing' });
    await expect(cancelCheckout(store, order, 'Payment failed', true)).rejects.toThrow('processing');
    expect((await store.listProducts())[0].inventory).toBe(18);
  });
  it('cleans up due reservations and preserves unexpired ones', async () => {
    const { store, order, state } = await fixture();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    mocks.retrieve.mockResolvedValue({ ...state, status: 'expired' });
    const fresh = await store.createOrder({ email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Synthetic address', items: [{ productId: 'p1', quantity: 1 }] });
    const report = vi.fn();
    await releaseExpiredReservations(store, report);
    expect((await store.getOrder(order.id))?.status).toBe('canceled');
    expect((await store.getOrder(fresh.id))?.status).toBe('pending_payment');
    expect((await store.listProducts())[0].inventory).toBe(19);
    expect(report).not.toHaveBeenCalled();
  });
  it('reports a cleanup failure and retains its stock for retry', async () => {
    const { store, order } = await fixture();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    mocks.retrieve.mockRejectedValue(new Error('Stripe unavailable'));
    const report = vi.fn();
    await releaseExpiredReservations(store, report);
    expect(report).toHaveBeenCalledWith(order.id, expect.any(Error));
    expect((await store.listProducts())[0].inventory).toBe(18);
  });
  it('does not treat an unpaid completed session as payment confirmation', () => {
    expect(getCompletedCheckout({ type: 'checkout.session.completed', data: { object: { payment_status: 'unpaid', metadata: { orderId: 'order' } } } })).toBeUndefined();
    expect(getCompletedCheckout({ type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_test', payment_status: 'paid', metadata: { orderId: 'order' } } } })).toMatchObject({ orderId: 'order' });
  });
});
