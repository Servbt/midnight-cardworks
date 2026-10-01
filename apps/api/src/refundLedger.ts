import type { Order } from './types.js';

export type RefundEntry = { id: string; orderId: string; amount: number; status: 'pending' | 'succeeded' | 'failed'; reason?: string };
export type RefundUpdate = { refundId?: string; amount?: number; reason?: string };

export function reconciledRefundLedger(order: Order, entries: RefundEntry[]) {
  if (!order.refundReconciliationRequired) throw new Error('Order does not require historical reconciliation');
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('Duplicate refund IDs');
  let result = { refundedAmount: 0, status: 'paid' as Order['status'] };
  let validated: RefundEntry[] = [];
  for (const entry of entries) {
    if (entry.orderId !== order.id) throw new Error('Refund belongs to another order');
    const update = refundLedgerUpdate({ ...order, refundReconciliationRequired: false }, validated, { refundId: entry.id, amount: entry.amount, reason: entry.reason }, entry.status);
    validated = update.next;
    result = { refundedAmount: update.refundedAmount, status: update.status };
  }
  return result;
}

// Entries represent authoritative refund snapshots, never incremental amounts.
export function refundLedgerUpdate(order: Order, entries: RefundEntry[], update: RefundUpdate, status: RefundEntry['status']) {
  if (!update.refundId) throw new Error('Refund ID is required');
  if (order.refundReconciliationRequired) throw new Error('Historical refunds require reconciliation before updates');
  if (['pending_payment', 'canceled'].includes(order.status)) throw new Error('Only paid orders can be refunded');
  const previous = entries.find((entry) => entry.id === update.refundId);
  if (previous && previous.orderId !== order.id) throw new Error('Refund belongs to another order');
  const amount = update.amount ?? previous?.amount ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0 || (status !== 'failed' && amount === 0)) throw new Error('Invalid refund amount');
  if (previous && previous.amount !== 0 && amount !== previous.amount) throw new Error('Refund amount cannot change');
  const entry: RefundEntry = previous && previous.status !== 'pending' && status === 'pending'
    ? previous
    : { id: update.refundId, orderId: order.id, amount, status, reason: update.reason ?? previous?.reason };
  const next = entries.filter((candidate) => candidate.id !== entry.id).concat(entry);
  const refundedAmount = next.filter((candidate) => candidate.status === 'succeeded').reduce((sum, candidate) => sum + candidate.amount, 0);
  if (refundedAmount > order.total) throw new Error('Refund ledger exceeds order total');
  const nextStatus = refundedAmount === order.total ? 'refunded' : next.some((candidate) => candidate.status === 'pending') ? 'refund_pending' : refundedAmount > 0 ? 'partially_refunded' : 'refund_failed';
  return { entry, next, refundedAmount, status: nextStatus as Order['status'] };
}
