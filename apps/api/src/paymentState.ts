import type { Order, PaymentDetails, Store } from './types.js';

export type NotificationKind = 'Pending' | 'Paid' | 'Fulfilled' | 'Canceled' | 'Refunded' | 'RefundFailed';
export type RefundEntry = { refundId: string; amount: number; status: string; reason?: string };
export async function queueNotification(tx: Store, order: Order, kind: NotificationKind, suffix = '') {
  const id = `notification:${order.id}:${kind}:${suffix}`;
  if (!await tx.getRecord(id)) await tx.putRecord({ id, kind: 'notification', orderId: order.id, data: { kind, order, state: 'pending' } });
}
export async function payOrder(tx: Store, order: Order, payment: PaymentDetails) {
  if (order.stripeSessionId && payment.stripeSessionId && order.stripeSessionId !== payment.stripeSessionId) throw new Error('Checkout session does not match order');
  if (order.stripePaymentIntentId && payment.stripePaymentIntentId && order.stripePaymentIntentId !== payment.stripePaymentIntentId) throw new Error('Payment does not match order');
  if (payment.total !== undefined) {
    if (!Number.isSafeInteger(payment.total) || payment.total < 0 || payment.total > order.subtotal + order.shippingCost) throw new Error('Invalid final payment total');
    const discount = payment.discountAmount ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0 || payment.total + discount !== order.subtotal + order.shippingCost) throw new Error('Payment totals do not reconcile');
    order.total = payment.total;
    order.discountAmount = discount;
  }
  if (order.paidAt || ['paid', 'fulfilled', 'refund_pending', 'partially_refunded', 'refunded', 'refund_failed'].includes(order.status)) {
    order.paidAt ??= order.createdAt;
    // Legacy paid rows predate final-total persistence. Reconcile their totals
    // without regressing fulfillment/refund state or decrementing inventory again.
    order.stripeSessionId = payment.stripeSessionId ?? order.stripeSessionId;
    order.stripePaymentIntentId = payment.stripePaymentIntentId ?? order.stripePaymentIntentId;
    return tx.saveOrder(order);
  }
  order.paidAt = new Date().toISOString();
  order.stripeSessionId = payment.stripeSessionId ?? order.stripeSessionId;
  order.stripePaymentIntentId = payment.stripePaymentIntentId ?? order.stripePaymentIntentId;
  order.status = 'paid';
  // A verified late payment wins over an earlier expiration/failure. Never lose captured money.
  order.canceledAt = undefined;
  await tx.decrementOrderInventory(order);
  await tx.saveOrder(order);
  await queueNotification(tx, order, 'Paid');
  return order;
}
export async function fulfillOrder(tx: Store, order: Order) {
  if (order.fulfilledAt) return order;
  if (!['paid', 'partially_refunded', 'refund_failed'].includes(order.status)) throw new Error('Only paid orders can be fulfilled');
  order.fulfilledAt = new Date().toISOString();
  if (order.status === 'paid' || order.status === 'refund_failed') order.status = 'fulfilled';
  await tx.saveOrder(order);
  await queueNotification(tx, order, 'Fulfilled');
  return order;
}
export async function cancelOrder(tx: Store, order: Order, reason?: string) {
  if (order.status === 'canceled') return order;
  if (order.paidAt || order.status !== 'pending_payment') throw new Error('Only unpaid orders can be canceled');
  order.status = 'canceled';
  order.canceledAt = new Date().toISOString();
  order.refundReason = reason;
  await tx.saveOrder(order);
  await queueNotification(tx, order, 'Canceled');
  return order;
}
export async function refundOrder(tx: Store, order: Order, refund: RefundEntry, notify = true) {
  if (!order.paidAt) throw new Error('Payment must be reconciled before a refund');
  if (!refund.refundId || !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(refund.status) || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) throw new Error('Invalid refund');
  const id = `refund:${refund.refundId}`;
  const existing = await tx.getRecord(id);
  if (existing && existing.orderId !== order.id) throw new Error('Refund belongs to a different order');
  const old = existing?.data as RefundEntry | undefined;
  if (old && old.amount !== refund.amount) throw new Error('Refund amount changed');
  // Refunds can fail after appearing successful. The webhook handler retrieves current
  // Stripe state, and failed/canceled records cannot be resurrected by an older response.
  if (old && (old.status === refund.status || ['failed', 'canceled'].includes(old.status) || (old.status === 'succeeded' && !['failed', 'canceled'].includes(refund.status)))) return order;
  const baseline = (await tx.getRecord(`refund-baseline:${order.id}`))?.data as { amount: number; lastRefundId?: string } | undefined;
  if (baseline?.lastRefundId === refund.refundId) return order;
  // Historical refunds cannot safely be reconstructed from only a latest ID.
  // Old Stripe deliveries must not add to the migrated aggregate; see runbook.
  await tx.putRecord({ id, kind: 'refund', orderId: order.id, data: refund });
  const entries = (await tx.listRecords('refund', order.id)).map(r => r.data as RefundEntry);
  order.refundedAmount = (baseline?.amount ?? 0) + entries.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0);
  if (order.refundedAmount > order.total) throw new Error('Refund total exceeds captured total; reconcile payment');
  order.stripeRefundId = refund.refundId;
  order.refundReason = refund.reason;
  order.status = order.refundedAmount >= order.total ? 'refunded'
    : entries.some(r => !['succeeded', 'failed', 'canceled'].includes(r.status)) ? 'refund_pending'
    : order.refundedAmount > 0 ? 'partially_refunded'
    : ['failed', 'canceled'].includes(refund.status) ? 'refund_failed'
    : order.fulfilledAt ? 'fulfilled' : 'paid';
  if (refund.status === 'succeeded') order.refundedAt = new Date().toISOString();
  await tx.saveOrder(order);
  if (notify && refund.status === 'succeeded') await queueNotification(tx, order, 'Refunded', refund.refundId);
  if (notify && ['failed', 'canceled'].includes(refund.status)) await queueNotification(tx, order, 'RefundFailed', refund.refundId);
  return order;
}
export async function mutateOrder(store: Store, id: string, work: (tx: Store, order: Order) => Promise<Order>) {
  return store.atomic(async tx => {
    const order = await tx.getOrder(id);
    return order ? work(tx, order) : undefined;
  });
}
export function paymentMethods(getStore: () => Store): Pick<Store, 'markOrderPaid' | 'markOrderFulfilled' | 'cancelOrder' | 'markOrderRefundPending' | 'markOrderRefunded' | 'markOrderRefundFailed'> {
  return {
    markOrderPaid: (id, payment = {}) => mutateOrder(getStore(), id, (tx, order) => payOrder(tx, order, payment)),
    markOrderFulfilled: id => mutateOrder(getStore(), id, fulfillOrder),
    cancelOrder: (id, reason) => mutateOrder(getStore(), id, (tx, order) => cancelOrder(tx, order, reason)),
    markOrderRefundPending: (id, refund) => mutateOrder(getStore(), id, (tx, order) => refundOrder(tx, order, { ...refund, refundId: refund.refundId ?? '', status: 'pending' })),
    markOrderRefunded: (id, refund) => mutateOrder(getStore(), id, (tx, order) => refundOrder(tx, order, { ...refund, refundId: refund.refundId ?? '', status: 'succeeded' })),
    markOrderRefundFailed: (id, refund) => mutateOrder(getStore(), id, async (tx, order) => {
      const previous = (await tx.getRecord(`refund:${refund.refundId}`))?.data as RefundEntry | undefined;
      if (!previous) throw new Error('Refund details required');
      return refundOrder(tx, order, { ...previous, ...refund, status: 'failed' });
    })
  };
}
