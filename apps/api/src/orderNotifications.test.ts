import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from './store.js';
import { deliverOrderNotifications } from './orderNotifications.js';
import { createEmailNotifierFromEnv } from './emailNotifications.js';
import type { Order } from './types.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function fixture() {
  const store = createInMemoryStore();
  const order = await store.createOrder({ email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Test', items: [{ productId: 'p1', quantity: 1 }] });
  await store.markOrderPaid(order.id);
  return { store, order, notifier: { ...createEmailNotifierFromEnv(), sendOrderPaid: vi.fn(async (_order: Order, _key?: string) => {}) } };
}
describe('paid notification delivery', () => {
  it('delivers each refund once across A/B/A replay and retries failed notifications', async () => {
    const { store, order } = await fixture();
    const refunded = vi.fn(async (_order: Order, _key?: string) => {});
    const failed = vi.fn(async (_order: Order, _key?: string) => {});
    const notifier = { ...createEmailNotifierFromEnv(), sendOrderRefunded: refunded, sendOrderRefundFailed: failed };
    for (const [refundId, amount] of [['re_A', 100], ['re_B', 200], ['re_A', 100]] as const) {
      await store.markOrderRefunded(order.id, { refundId, amount });
      await deliverOrderNotifications(store, notifier, order.id, undefined, 'refunded');
    }
    expect(refunded).toHaveBeenCalledTimes(2);
    expect(refunded.mock.calls[0][0].refundedAmount).toBe(100);
    expect(refunded.mock.calls[1][0].refundedAmount).toBe(300);
    await store.markOrderRefundFailed(order.id, { refundId: 're_B', amount: 200 });
    failed.mockRejectedValueOnce(new Error('unavailable'));
    await expect(deliverOrderNotifications(store, notifier, order.id, undefined, 'refund_failed')).rejects.toThrow('unavailable');
    await store.markOrderRefundFailed(order.id, { refundId: 're_B', amount: 200 });
    await Promise.all(Array.from({ length: 8 }, () => deliverOrderNotifications(store, notifier, order.id, undefined, 'refund_failed')));
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls[0]).toEqual(failed.mock.calls[1]);
  });
  it('sends once for concurrent workers and payment replays after fulfillment', async () => {
    const { store, order, notifier } = await fixture();
    await Promise.all(Array.from({ length: 8 }, () => deliverOrderNotifications(store, notifier)));
    await store.markOrderFulfilled(order.id);
    await store.markOrderPaid(order.id);
    await deliverOrderNotifications(store, notifier);
    expect(notifier.sendOrderPaid).toHaveBeenCalledTimes(1);
    expect(notifier.sendOrderPaid.mock.calls[0][0]).toMatchObject({ status: 'paid' });
    expect(await store.pendingNotifications()).toEqual([]);
  });
  it('retries failures with the original snapshot and key', async () => {
    const { store, order, notifier } = await fixture();
    notifier.sendOrderPaid.mockRejectedValueOnce(new Error('timeout'));
    await expect(deliverOrderNotifications(store, notifier)).rejects.toThrow('timeout');
    await store.markOrderFulfilled(order.id);
    await deliverOrderNotifications(store, notifier);
    expect(notifier.sendOrderPaid.mock.calls[0]).toEqual(notifier.sendOrderPaid.mock.calls[1]);
    expect(await store.pendingNotifications()).toEqual([]);
  });
  it('recovers an expired lease but refuses automatic retries after 23 hours', async () => {
    vi.useFakeTimers();
    const { store, order, notifier } = await fixture();
    const id = 'paid:' + order.id;
    await store.claimNotification(id, 'crashed');
    await deliverOrderNotifications(store, notifier);
    expect(notifier.sendOrderPaid).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    await store.claimNotification(id, 'second-crash');
    await store.completeNotification(id, 'crashed');
    expect(await store.pendingNotifications()).toHaveLength(1);
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    await expect(deliverOrderNotifications(store, notifier)).rejects.toThrow('manual reconciliation');
    expect(notifier.sendOrderPaid).not.toHaveBeenCalled();
  });
  it('uses separate stable HTTP idempotency keys for customer and owner sends', async () => {
    vi.stubEnv('RESEND_API_KEY', 'synthetic');
    vi.stubEnv('EMAIL_FROM', 'shop@example.test');
    vi.stubEnv('ORDER_NOTIFICATION_EMAIL', 'owner@example.test');
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { store, order } = await fixture();
    const notifier = createEmailNotifierFromEnv();
    await expect(deliverOrderNotifications(store, notifier)).rejects.toThrow('503');
    await store.markOrderFulfilled(order.id);
    await deliverOrderNotifications(store, notifier);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('paid:' + order.id + '/customer');
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('paid:' + order.id + '/owner');
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[3][1].body);
  });
});
