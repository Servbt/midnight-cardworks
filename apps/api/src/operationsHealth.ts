import type { Store } from './types.js';

type HealthItem = { id: string; orderId?: string; category: 'payment' | 'email' | 'inventory'; status: 'attention' | 'waiting'; title: string; detail: string; since?: string };
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
/** Read-only, allowlisted operational snapshot. Never return provider errors or email payloads. */
export async function operationsHealth(store: Store, now = Date.now()) {
  const [orders, notifications, deliveries, checkouts, refunds, recovery] = await Promise.all([
    store.listOrders(), store.listRecords('notification'), store.listRecords('delivery'),
    store.listRecords('checkout'), store.listRecords('refund-request'), store.listRecords('inventory-recovery')
  ]);
  const byId = new Map(orders.map(order => [order.id, order]));
  const items: HealthItem[] = [];
  for (const order of orders) {
    if (order.inventoryIssue) items.push({ id: `stock:${order.id}`, orderId: order.id, category: 'inventory', status: 'attention', title: 'Paid order needs stock', detail: 'Review physical stock, then sync Stripe payment to allocate it, or refund. Fulfillment is blocked.' });
    if (['held', 'legacy_held'].includes(order.inventoryState ?? '')) {
      const overdue = now - new Date(order.reservationExpiresAt ?? order.createdAt).getTime() > 48 * 3600000;
      items.push({ id: `hold:${order.id}`, orderId: order.id, category: 'inventory', status: overdue ? 'attention' : 'waiting', title: overdue ? 'Long-running stock hold' : 'Stock held for checkout', detail: overdue ? 'The hold is more than 48 hours past its deadline. Review the Stripe payment before releasing stock.' : 'Processing payments may retain stock past checkout expiration. Recovery checks Stripe automatically.', since: order.reservationExpiresAt });
    }
  }
  for (const record of recovery) {
    const data = record.data as { state?: string };
    const order = byId.get(record.orderId ?? '');
    if (data.state === 'attention' && order && ['held', 'legacy_held'].includes(order.inventoryState ?? '')) items.push({ id: record.id, orderId: order.id, category: 'inventory', status: 'attention', title: 'Stock recovery needs attention', detail: 'The last Stripe reconciliation failed. Check provider connectivity and the order; stock remains held.' });
  }
  for (const record of [...checkouts, ...refunds]) {
    const data = record.data as { done?: boolean; startedAt?: number };
    const order = byId.get(record.orderId ?? '');
    if (data.done || (record.kind === 'checkout' && order && (order.paidAt || order.status === 'canceled'))) continue;
    const attention = !data.startedAt || now - data.startedAt >= 5 * 60000;
    items.push({ id: record.id, orderId: record.orderId, category: 'payment', status: attention ? 'attention' : 'waiting', title: record.kind === 'checkout' ? 'Unresolved checkout request' : 'Unresolved refund request', detail: attention ? 'Unresolved for at least five minutes, or its age is unknown. Reconcile Stripe before starting another request; do not duplicate a refund.' : 'Request is still settling. Refresh before taking action.', since: timestamp(data.startedAt) });
  }
  for (const record of [...notifications, ...deliveries]) {
    const data = record.data as { state?: string; error?: string; firstAttemptAt?: number; kind?: string; intentId?: string };
    if (!['pending', 'attention'].includes(data.state ?? '')) continue;
    const intent = record.kind === 'notification' ? data : notifications.find(n => n.id === data.intentId)?.data as { kind?: string } | undefined;
    const order = byId.get(record.orderId ?? '');
    if (intent?.kind === 'Pending' && order && order.status !== 'pending_payment') continue;
    if (intent?.kind === 'Canceled' && order?.paidAt) continue;
    const attention = data.state === 'attention' || Boolean(data.error) || !process.env.RESEND_API_KEY;
    items.push({ id: record.id, orderId: record.orderId, category: 'email', status: attention ? 'attention' : 'waiting', title: data.state === 'attention' ? 'Email requires reconciliation' : attention ? 'Email delivery needs attention' : 'Email queued', detail: data.state === 'attention' ? 'Automatic retries stopped near the provider deduplication limit. Check delivery history before any resend.' : attention ? 'Check email configuration and provider delivery history. Automatic retries remain enabled; avoid manual duplicate sends.' : 'The notification worker will attempt delivery automatically.', since: timestamp(data.firstAttemptAt) });
  }
  items.sort((a, b) => (a.status === 'attention' ? 0 : 1) - (b.status === 'attention' ? 0 : 1) || a.id.localeCompare(b.id));
  return { checkedAt: new Date(now).toISOString(), attentionCount: items.filter(item => item.status === 'attention').length, waitingCount: items.filter(item => item.status === 'waiting').length, items };
}
