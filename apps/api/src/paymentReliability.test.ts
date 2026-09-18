import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from './store.js';
import { cancelCheckout, processPaymentEvent, requestRefund, startCheckout } from './paymentService.js';
import { flushNotifications } from './notificationWorker.js';
import type { Order, Store } from './types.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), refund: vi.fn(), getRefund: vi.fn(), listRefunds: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  checkout = { sessions: { create: mocks.create, retrieve: mocks.retrieve, expire: mocks.expire } };
  refunds = { create: mocks.refund, retrieve: mocks.getRefund, list: mocks.listRefunds };
} }));
const input = { email: 'buyer@example.com', customerName: 'Buyer', shippingAddress: '123 Main Street', items: [{ productId: 'p1', quantity: 1 }] };
const session = (order: Order, patch = {}) => ({ id: 'cs_test', metadata: { orderId: order.id }, status: 'complete', payment_status: 'paid', currency: 'usd', amount_subtotal: 1798, amount_total: 1598, total_details: { amount_discount: 200 }, payment_intent: 'pi_test', ...patch });
const event = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, data: { object } });
async function paid(store: Store) { const order = await store.createOrder(input); await processPaymentEvent(store, event('evt_paid', 'checkout.session.completed', session(order))); return (await store.getOrder(order.id))!; }
beforeEach(() => { vi.stubEnv('STRIPE_SECRET_KEY', ''); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('durable payment processing', () => {
  it('applies a discount and inventories exactly once across concurrent distinct/repeated events, preserving fulfillment', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await Promise.all(Array.from({ length: 8 }, (_, i) => processPaymentEvent(store, event(`evt_${i % 4}`, 'checkout.session.completed', session(order)))));
    await store.markOrderFulfilled(order.id);
    await processPaymentEvent(store, event('evt_late', 'checkout.session.completed', session(order)));
    expect(await store.getOrder(order.id)).toMatchObject({ total: 1598, discountAmount: 200, status: 'fulfilled' });
    expect((await store.getProduct('golden-hour-commander-proxy'))!.inventory).toBe(19);
    expect((await store.listRecords('notification')).filter(r => r.id.includes(':Paid:'))).toHaveLength(1);
    expect(await store.listRecords('event')).toHaveLength(5);
  });
  it('waits for delayed payments, records failure, and reconciles later success without losing captured money', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await processPaymentEvent(store, event('evt_pending', 'checkout.session.completed', session(order, { payment_status: 'unpaid' })));
    expect((await store.getOrder(order.id))!.status).toBe('pending_payment');
    await processPaymentEvent(store, event('evt_failed', 'checkout.session.async_payment_failed', session(order, { payment_status: 'unpaid' })));
    expect((await store.getOrder(order.id))!.status).toBe('canceled');
    await processPaymentEvent(store, event('evt_success', 'checkout.session.async_payment_succeeded', session(order)));
    await processPaymentEvent(store, event('evt_failed2', 'checkout.session.async_payment_failed', session(order, { payment_status: 'unpaid' })));
    expect((await store.getOrder(order.id))!.status).toBe('paid');
  });
  it('accepts a fully discounted payment but rejects wrong currency and mismatched totals without committing event IDs', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await expect(processPaymentEvent(store, event('bad', 'checkout.session.completed', session(order, { currency: 'eur' })))).rejects.toThrow();
    await expect(processPaymentEvent(store, event('bad', 'checkout.session.completed', session(order, { amount_total: 1700 })))).rejects.toThrow();
    expect(await store.getRecord('event:bad')).toBeUndefined();
    await processPaymentEvent(store, event('free', 'checkout.session.completed', session(order, { payment_status: 'no_payment_required', amount_total: 0, total_details: { amount_discount: 1798 } })));
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'paid', total: 0, discountAmount: 1798 });
  });
  it('rolls back order and inventory when notification persistence fails', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    const put = store.putRecord; store.putRecord = async r => { if (r.kind === 'notification') throw new Error('database failure'); return put(r); };
    await expect(processPaymentEvent(store, event('retry', 'checkout.session.completed', session(order)))).rejects.toThrow('database failure');
    expect(await store.getRecord('event:retry')).toBeUndefined();
    expect((await store.getOrder(order.id))!.status).toBe('pending_payment');
    expect((await store.getProduct('golden-hour-commander-proxy'))!.inventory).toBe(20);
    store.putRecord = put;
    await processPaymentEvent(store, event('retry', 'checkout.session.completed', session(order)));
    expect((await store.getOrder(order.id))!.status).toBe('paid');
  });
  it('keeps each refund, ignores old replay after a second refund, and cannot regress refunded status on payment', async () => {
    const store = createInMemoryStore(); const order = await paid(store);
    const refund = (id: string, amount: number, status = 'succeeded') => ({ id, amount, status, metadata: { orderId: order.id } });
    await processPaymentEvent(store, event('r1', 'refund.updated', refund('re_1', 500)));
    await processPaymentEvent(store, event('r2', 'refund.updated', refund('re_2', 1098)));
    await processPaymentEvent(store, event('r1_again', 'refund.created', refund('re_1', 500, 'pending')));
    await processPaymentEvent(store, event('paid_again', 'checkout.session.completed', session(order)));
    expect(await store.getOrder(order.id)).toMatchObject({ refundedAmount: 1598, status: 'refunded' });
    expect(await store.listRecords('refund')).toHaveLength(2);
    expect((await store.listRecords('notification')).filter(r => r.id.includes(':Refunded:'))).toHaveLength(2);
  });
  it('handles a succeeded refund later failing and does not resurrect it on a stale response', async () => {
    const store = createInMemoryStore(); const order = await paid(store);
    await store.markOrderRefunded(order.id, { refundId: 're_1', amount: 500 });
    await store.markOrderRefundFailed(order.id, { refundId: 're_1', reason: 'bank failure' });
    await store.markOrderRefunded(order.id, { refundId: 're_1', amount: 500 });
    expect(await store.getOrder(order.id)).toMatchObject({ refundedAmount: 0, status: 'refund_failed' });
  });
  it('retries checkout using the original order, receipt capability, and Stripe key after a lost response', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.create.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/session' });
    const store = createInMemoryStore(); const key = 'x'.repeat(43);
    await expect(startCheckout(store, input, key)).rejects.toThrow('lost response');
    const result = await startCheckout(store, input, key);
    expect(await store.listOrders()).toHaveLength(1);
    expect(mocks.create.mock.calls[0]).toEqual(mocks.create.mock.calls[1]);
    expect(await startCheckout(store, input, key)).toEqual(result);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await expect(startCheckout(store, { ...input, customerName: 'Someone else' }, key)).rejects.toThrow('different details');
  });
  it('holds unresolved refunds, reuses the original amount/key, and refuses retries beyond provider retention', async () => {
    const store = createInMemoryStore(); const order = await paid(store);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.retrieve.mockResolvedValue(session(order));
    mocks.listRefunds.mockImplementation(async function* () {});
    mocks.refund.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ id: 're_retry', amount: 500, status: 'succeeded' });
    const key = 'r'.repeat(43);
    await expect(requestRefund(store, order.id, { amount: 500 }, key)).rejects.toThrow('lost response');
    await expect(requestRefund(store, order.id, { amount: 500 }, 's'.repeat(43))).rejects.toThrow('unresolved');
    await requestRefund(store, order.id, { amount: 500 }, key);
    expect(mocks.refund.mock.calls[0]).toEqual(mocks.refund.mock.calls[1]);
    await requestRefund(store, order.id, { amount: 500 }, key);
    expect(mocks.refund).toHaveBeenCalledTimes(2);
    expect((await store.getOrder(order.id))!.refundedAmount).toBe(500);
    mocks.refund.mockRejectedValue(new Error('lost'));
    await expect(requestRefund(store, order.id, { amount: 500 }, 'z'.repeat(43))).rejects.toThrow('lost');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 24 * 3600000);
    await expect(requestRefund(store, order.id, { amount: 500 }, 'z'.repeat(43))).rejects.toThrow('manual reconciliation');
    expect(mocks.refund).toHaveBeenCalledTimes(3);
  });
  it('expires open sessions and detects a payment racing cancellation', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await store.recordCheckoutSession(order.id, 'cs_test');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.retrieve.mockResolvedValueOnce(session(order, { status: 'open', payment_status: 'unpaid' })).mockResolvedValue(session(order));
    mocks.expire.mockRejectedValue(new Error('session completed'));
    await expect(cancelCheckout(store, (await store.getOrder(order.id))!)).rejects.toThrow('Checkout completed');
    expect((await store.getOrder(order.id))!.status).toBe('paid');
    expect(mocks.expire).toHaveBeenCalledWith('cs_test');
  });
  it('cancels only after expiration and leaves completed delayed payments pending', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await store.recordCheckoutSession(order.id, 'cs_test');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.retrieve.mockResolvedValue(session(order, { payment_status: 'unpaid' }));
    await expect(cancelCheckout(store, (await store.getOrder(order.id))!)).rejects.toThrow('processing');
    expect((await store.getOrder(order.id))!.status).toBe('pending_payment');
    mocks.retrieve.mockResolvedValue(session(order, { status: 'open', payment_status: 'unpaid' }));
    mocks.expire.mockResolvedValue(session(order, { status: 'expired', payment_status: 'unpaid' }));
    await cancelCheckout(store, (await store.getOrder(order.id))!);
    expect((await store.getOrder(order.id))!.status).toBe('canceled');
  });
  it('reconciles legacy discounted totals without a second inventory decrement or confirmation', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await store.markOrderPaid(order.id, { stripeSessionId: 'cs_test', stripePaymentIntentId: 'pi_test' });
    await store.markOrderFulfilled(order.id);
    await processPaymentEvent(store, event('legacy_sync', 'checkout.session.completed', session(order)));
    expect(await store.getOrder(order.id)).toMatchObject({ total: 1598, discountAmount: 200, status: 'fulfilled' });
    expect((await store.getProduct('golden-hour-commander-proxy'))!.inventory).toBe(19);
    expect((await store.listRecords('notification')).filter(r => r.id.includes(':Paid:'))).toHaveLength(1);
  });
  it('uses individual refunds for charge aggregates and retrieves current refund state on old events', async () => {
    const store = createInMemoryStore(); const order = await paid(store);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.retrieve.mockResolvedValue(session(order));
    const refunds = [
      { id: 're_a', amount: 500, status: 'succeeded', currency: 'usd', payment_intent: 'pi_test', metadata: { orderId: order.id } },
      { id: 're_b', amount: 600, status: 'succeeded', currency: 'usd', payment_intent: 'pi_test', metadata: { orderId: order.id } }
    ];
    mocks.listRefunds.mockImplementation(async function* () { yield* refunds; });
    await processPaymentEvent(store, event('charge', 'charge.refunded', { id: 'ch_test', amount: 1598, amount_refunded: 1100, payment_intent: 'pi_test' }));
    expect((await store.getOrder(order.id))!.refundedAmount).toBe(1100);
    mocks.getRefund.mockResolvedValue(refunds[0]);
    await processPaymentEvent(store, event('old_pending', 'refund.created', { ...refunds[0], status: 'pending' }));
    expect((await store.getOrder(order.id))!.refundedAmount).toBe(1100);
    expect(mocks.getRefund).toHaveBeenCalledWith('re_a');
  });
  it('imports legacy refund history without double counting the latest ID or emailing historical refunds', async () => {
    const store = createInMemoryStore(); const order = await paid(store);
    await store.saveOrder({ ...order, status: 'partially_refunded', refundedAmount: 500, stripeRefundId: 're_old' });
    await store.putRecord({ id: `refund-baseline:${order.id}`, kind: 'refund-baseline', orderId: order.id, data: { amount: 500, lastRefundId: 're_old', migratedAt: 100000 } });
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.retrieve.mockResolvedValue(session(order));
    const old = { id: 're_old', amount: 500, status: 'succeeded', currency: 'usd', payment_intent: 'pi_test', metadata: { orderId: order.id } };
    const recent = { ...old, id: 're_new', amount: 200 };
    mocks.getRefund.mockResolvedValue(recent);
    mocks.listRefunds.mockImplementation(async function* () { yield recent; yield old; });
    await processPaymentEvent(store, { ...event('new_refund', 'refund.updated', recent), created: 200 });
    expect((await store.getOrder(order.id))!.refundedAmount).toBe(700);
    const notifications = (await store.listRecords('notification')).filter(r => r.id.includes(':Refunded:'));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toContain('re_new');
    expect(notifications[0].data).toMatchObject({ order: { refundedAmount: 700 } });
    mocks.getRefund.mockResolvedValue(old);
    await processPaymentEvent(store, { ...event('old_refund', 'refund.updated', old), created: 50 });
    expect((await store.getOrder(order.id))!.refundedAmount).toBe(700);
  });
  it('refuses fulfillment before payment and full-refund fulfillment', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await expect(store.markOrderFulfilled(order.id)).rejects.toThrow('Only paid');
    await store.markOrderPaid(order.id);
    await store.markOrderRefunded(order.id, { refundId: 're_full', amount: order.total });
    await expect(store.markOrderFulfilled(order.id)).rejects.toThrow('Only paid');
  });
});

describe('durable notification delivery', () => {
  beforeEach(() => { vi.stubEnv('EMAIL_FROM', 'Shop <shop@example.com>'); vi.stubEnv('ORDER_NOTIFICATION_EMAIL', 'owner@example.com'); vi.stubEnv('RESEND_API_KEY', 're_test'); });
  it('does not repeat successful recipients when another fails, and retries frozen payloads with stable keys', async () => {
    const store = createInMemoryStore(); await paid(store);
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    await flushNotifications(store);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubEnv('EMAIL_FROM', 'Changed <changed@example.com>');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6000);
    await Promise.all([flushNotifications(store), flushNotifications(store)]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body);
    expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[2][1].headers['Idempotency-Key']);
    expect((await store.listRecords('delivery')).every(r => (r.data as { state: string }).state === 'sent')).toBe(true);
  });
  it('rolls back a partial queue expansion and resumes after a worker dies following provider acceptance', async () => {
    const store = createInMemoryStore(); await paid(store);
    const put = store.putRecord;
    store.putRecord = async r => { if (r.kind === 'delivery' && r.id.endsWith(':1')) throw new Error('database unavailable'); return put(r); };
    await expect(flushNotifications(store)).rejects.toThrow('database unavailable');
    expect(await store.listRecords('delivery')).toHaveLength(0);
    store.putRecord = put;
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
    store.putRecord = async r => { if (r.kind === 'delivery' && (r.data as { state: string }).state === 'sent') throw new Error('worker lost'); return put(r); };
    await expect(flushNotifications(store)).rejects.toThrow('worker lost');
    expect(fetch).toHaveBeenCalledTimes(1);
    store.putRecord = put;
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61000);
    await flushNotifications(store);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  });
  it('suppresses queued cancellation and refund-success messages superseded before delivery', async () => {
    const store = createInMemoryStore(); const order = await store.createOrder(input);
    await store.cancelOrder(order.id); await store.markOrderPaid(order.id);
    await store.markOrderRefunded(order.id, { refundId: 're_late_fail', amount: 500 });
    await store.markOrderRefundFailed(order.id, { refundId: 're_late_fail' });
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
    await flushNotifications(store);
    const subjects = fetch.mock.calls.map(call => JSON.parse(call[1].body).subject);
    expect(subjects.some(subject => subject.includes('canceled') || subject.includes('partially refunded'))).toBe(false);
    expect(subjects.some(subject => subject.includes('Refund update'))).toBe(true);
  });
  it('keeps missing configuration pending and quarantines ambiguous sends beyond the retry window', async () => {
    const store = createInMemoryStore(); await paid(store);
    vi.stubEnv('EMAIL_FROM', ''); const fetch = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetch);
    await flushNotifications(store); expect(fetch).not.toHaveBeenCalled();
    expect((await store.listRecords('notification'))[0].data).toMatchObject({ state: 'pending' });
    vi.stubEnv('EMAIL_FROM', 'Shop <shop@example.com>');
    await flushNotifications(store); expect(fetch).toHaveBeenCalledTimes(2);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 24 * 3600000);
    await flushNotifications(store); expect(fetch).toHaveBeenCalledTimes(2);
    expect((await store.listRecords('delivery')).every(r => (r.data as { state: string }).state === 'attention')).toBe(true);
  });
});
