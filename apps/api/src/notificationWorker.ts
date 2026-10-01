import { randomUUID } from 'node:crypto';
import { buildOrderNotification, sendResend, type EmailNotifier, type ResendEmail } from './emailNotifications.js';
import type { NotificationKind } from './paymentState.js';
import type { JournalRecord, Order, Store } from './types.js';

type Intent = { kind: NotificationKind; order: Order; state: string; error?: string };
type Delivery = { intentId?: string; email: ResendEmail; state: 'pending' | 'sent' | 'attention' | 'superseded'; attempts: number; firstAttemptAt?: number; nextAt?: number; leaseUntil?: number; leaseId?: string; error?: string };
async function superseded(tx: Store, record: JournalRecord, intent: Intent) {
  const order = await tx.getOrder(record.orderId!);
  if (intent.kind === 'Canceled' && order?.paidAt) return true;
  if (intent.kind === 'Pending' && order?.status !== 'pending_payment') return true;
  if (intent.kind === 'Refunded' && intent.order.stripeRefundId) {
    const refund = (await tx.getRecord(`refund:${intent.order.stripeRefundId}`))?.data as { status?: string } | undefined;
    return !!refund && refund.status !== 'succeeded';
  }
  return false;
}
export async function flushNotifications(store: Store, notifier?: EmailNotifier) {
  const intents = await store.listRecords('notification');
  for (const record of intents) {
    const intent = record.data as Intent;
    if (intent.state !== 'pending') continue;
    if (notifier) {
      // Test adapter. Production deliveries always use persisted recipient payloads below.
      await notifier[`sendOrder${intent.kind}`](intent.order);
      await store.putRecord({ ...record, data: { ...intent, state: 'expanded' } });
      continue;
    }
    await store.atomic(async tx => {
      const latest = (await tx.getRecord(record.id))!.data as Intent;
      if (latest.state !== 'pending') return;
      if (await superseded(tx, record, latest)) {
        await tx.putRecord({ ...record, data: { ...latest, state: 'superseded' } }); return;
      }
      let emails: ResendEmail[];
      try { emails = buildOrderNotification(latest.kind, latest.order); }
      catch (error) {
        await tx.putRecord({ ...record, data: { ...latest, error: error instanceof Error ? error.message : 'Notification configuration error' } });
        return;
      }
      // Persistence errors must roll back the entire expansion. Otherwise a partial
      // delivery could be sent, then overwritten with an unused retry window.
      for (const [index, email] of emails.entries()) await tx.putRecord({ id: `${record.id}:${index}`, kind: 'delivery', orderId: record.orderId, data: { intentId: record.id, email, state: 'pending', attempts: 0 } satisfies Delivery });
      await tx.putRecord({ ...record, data: { ...latest, state: 'expanded' } });
    });
  }
  if (notifier) return;
  // Each recipient has its own idempotency key, so admin retries cannot duplicate customer mail.
  const deliveries = await store.listRecords('delivery');
  for (const record of deliveries) {
    const claim = await store.atomic(async tx => {
      const current = (await tx.getRecord(record.id))!.data as Delivery;
      const now = Date.now();
      if (current.state !== 'pending' || (current.nextAt ?? 0) > now || (current.leaseUntil ?? 0) > now) return;
      const intent = current.intentId ? await tx.getRecord(current.intentId) : undefined;
      if (intent && await superseded(tx, intent, intent.data as Intent)) {
        await tx.putRecord({ ...record, data: { ...current, state: 'superseded' } }); return;
      }
      if (current.firstAttemptAt && now - current.firstAttemptAt >= 23 * 60 * 60 * 1000) {
        await tx.putRecord({ ...record, data: { ...current, state: 'attention', error: 'Provider deduplication window ending; reconcile delivery before retrying' } }); return;
      }
      // Instead of skipping silently (which let paid-order notifications pile up unseen),
      // flag the delivery so /api/admin/payment-health surfaces the misconfiguration.
      if (!process.env.RESEND_API_KEY) {
        await tx.putRecord({ ...record, data: { ...current, state: 'attention', error: 'RESEND_API_KEY is not configured, so order notifications cannot be delivered' } });
        return;
      }
      const data: Delivery = { ...current, firstAttemptAt: current.firstAttemptAt ?? now, attempts: current.attempts + 1, leaseUntil: now + 60000, leaseId: randomUUID() };
      await tx.putRecord({ ...record, data });
      return data;
    });
    if (!claim) continue;
    let error: string | undefined;
    try { await sendResend(claim.email, record.id); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Email delivery failed'; }
    await store.atomic(async tx => {
      const latest = (await tx.getRecord(record.id))!.data as Delivery;
      if (latest.leaseId !== claim.leaseId) return;
      await tx.putRecord({ ...record, data: { ...latest, state: error ? 'pending' : 'sent', error, leaseUntil: 0, nextAt: Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(claim.attempts, 12)) } });
    });
  }
}
export function startNotificationWorker(store: Store, onError: (error: unknown) => void) {
  let running: Promise<void> | undefined;
  const tick = () => { if (!running) running = flushNotifications(store).catch(onError).finally(() => { running = undefined; }); };
  const timer = setInterval(tick, 10000);
  timer.unref(); tick();
  return async () => { clearInterval(timer); await running; };
}
export async function notificationHealth(store: Store) {
  const records: JournalRecord[] = [...await store.listRecords('notification'), ...await store.listRecords('delivery')];
  return records.filter(r => ['pending', 'attention'].includes((r.data as { state: string }).state)).map(r => ({ id: r.id, orderId: r.orderId, state: (r.data as { state: string }).state, error: (r.data as { error?: string }).error }));
}
