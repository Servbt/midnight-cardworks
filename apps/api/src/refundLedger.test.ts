import { describe, expect, it } from 'vitest';
import { refundLedgerUpdate, type RefundEntry } from './refundLedger.js';
import type { Order } from './types.js';
import { createInMemoryStore } from './store.js';
import { deliverOrderNotifications } from './orderNotifications.js';
import { createEmailNotifierFromEnv } from './emailNotifications.js';
const order: Order = { id: 'ord_test', email: 'test@example.test', items: [], subtotal: 1000, shippingCost: 0, total: 1000, status: 'paid', refundedAmount: 0, createdAt: '2026-10-01' };
describe('refund ledger calculations', () => {
  it('replaces incorrect historical totals without sending old refund notifications', async () => {
    const store = createInMemoryStore();
    const saved = await store.createOrder({ email: 'test@example.test', customerName: 'Test', shippingAddress: 'Test', items: [{ productId: 'p1', quantity: 1 }] });
    await store.markOrderPaid(saved.id);
    await deliverOrderNotifications(store, createEmailNotifierFromEnv(), saved.id);
    saved.refundReconciliationRequired = true;
    saved.refundedAmount = 900;
    saved.status = 'refunded';
    await store.reconcileHistoricalRefunds(saved.id, [{ id: 're_history', orderId: saved.id, amount: 100, status: 'succeeded' }]);
    expect(saved).toMatchObject({ refundedAmount: 100, status: 'partially_refunded', refundReconciliationRequired: false });
    await store.markOrderRefunded(saved.id, { refundId: 're_history', amount: 100 });
    expect(await store.pendingNotifications(saved.id)).toEqual([]);
    await expect(store.reconcileHistoricalRefunds(saved.id, [])).rejects.toThrow('does not require');
  });
  it('counts A/B/A exactly once per refund', () => {
    let entries: RefundEntry[] = [];
    for (const [refundId, amount] of [['re_A', 100], ['re_B', 200], ['re_A', 100]] as const) {
      entries = refundLedgerUpdate(order, entries, { refundId, amount }, 'succeeded').next;
    }
    const result = refundLedgerUpdate(order, entries, { refundId: 're_B', amount: 200 }, 'succeeded');
    expect(result.refundedAmount).toBe(300);
    expect(result.next).toHaveLength(2);
  });
  it('counts only successful refunds and ignores stale pending snapshots', () => {
    const pending = refundLedgerUpdate(order, [], { refundId: 're_A', amount: 100 }, 'pending');
    expect(pending.refundedAmount).toBe(0);
    const success = refundLedgerUpdate(order, pending.next, { refundId: 're_A', amount: 100 }, 'succeeded');
    const stale = refundLedgerUpdate(order, success.next, { refundId: 're_A', amount: 100 }, 'pending');
    expect(stale.refundedAmount).toBe(100);
    expect(stale.entry.status).toBe('succeeded');
    const failure = refundLedgerUpdate(order, stale.next, { refundId: 're_A', amount: 100 }, 'failed');
    expect(failure.refundedAmount).toBe(0);
    expect(failure.status).toBe('refund_failed');
  });
  it('rejects conflicting ownership, changed amounts, excess totals, and unreconciled history', () => {
    const entry: RefundEntry = { id: 're_A', orderId: order.id, amount: 100, status: 'succeeded' };
    expect(() => refundLedgerUpdate(order, [{ ...entry, orderId: 'other' }], { refundId: entry.id, amount: 100 }, 'succeeded')).toThrow('another order');
    expect(() => refundLedgerUpdate(order, [entry], { refundId: entry.id, amount: 200 }, 'succeeded')).toThrow('cannot change');
    expect(() => refundLedgerUpdate(order, [entry], { refundId: 're_B', amount: 1000 }, 'succeeded')).toThrow('exceeds');
    expect(() => refundLedgerUpdate({ ...order, refundReconciliationRequired: true }, [], { refundId: entry.id, amount: 100 }, 'succeeded')).toThrow('reconciliation');
  });
});
