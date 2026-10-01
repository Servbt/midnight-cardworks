import { randomUUID } from 'node:crypto';
import type { Store, Order } from './types.js';
import type { EmailNotifier } from './emailNotifications.js';

export async function deliverOrderNotifications(store: Store, notifier: EmailNotifier, orderId?: string, report?: (id: string, error: unknown) => void, kind?: 'paid' | 'refunded' | 'refund_failed') {
  for (const { id } of await store.pendingNotifications(orderId)) {
    if (kind && !id.startsWith(kind + ':')) continue;
    const leaseToken = randomUUID();
    try {
      const job = await store.claimNotification(id, leaseToken);
      if (!job) continue;
      const order = JSON.parse(job.payloadJson) as Order;
      if (id.startsWith('refunded:')) await notifier.sendOrderRefunded(order, id);
      else if (id.startsWith('refund_failed:')) await notifier.sendOrderRefundFailed(order, id);
      else await notifier.sendOrderPaid(order, id);
      await store.completeNotification(id, leaseToken);
    } catch (error) {
      await store.releaseNotification(id, leaseToken, error instanceof Error ? error.message : 'Notification failed');
      if (!report) throw error;
      report(id, error);
    }
  }
}
