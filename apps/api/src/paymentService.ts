import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { stripeSecret } from './productionConfig.js';
import { createCheckoutResponse } from './checkout.js';
import { hashReceiptToken } from './orderAccess.js';
import { createOrderRefund, type RefundResult } from './stripeRefunds.js';
import { cancelOrder, payOrder, queueNotification, refundOrder, type RefundEntry } from './paymentState.js';
import type { CheckoutInput, Order, PaymentDetails, Store } from './types.js';
import type { StripeWebhookEvent } from './stripeWebhook.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const client = () => { const key = stripeSecret(); return key ? new Stripe(key, { timeout: 20000, maxNetworkRetries: 1 }) : undefined; };
const idOf = (value: unknown): string | undefined => typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id) : undefined;
const retryWindow = 23 * 60 * 60 * 1000;
export function requestKey(value: unknown) {
  if (value === undefined) throw new Error('Idempotency-Key is required. Refresh the page before retrying');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error('Invalid Idempotency-Key');
  return value;
}
type Operation = { fingerprint: string; startedAt: number; order: Order; done?: boolean; checkoutUrl?: string | null; stripeSessionId?: string; refund?: RefundResult; amount?: number; reason?: string };
function verifyOperation(op: Operation, fingerprint: string) {
  if (op.fingerprint !== fingerprint) throw new Error('This request key was already used with different details');
  if (!op.done && Date.now() - op.startedAt >= retryWindow) throw new Error('This payment request needs manual reconciliation in Stripe before retrying');
}
export async function startCheckout(store: Store, input: CheckoutInput, key: string) {
  const id = `checkout:${digest(key)}`;
  const fingerprint = digest(JSON.stringify(input));
  const receiptToken = createHash('sha256').update(`receipt:${key}`).digest('base64url');
  const op = await store.atomic(async tx => {
    const previous = (await tx.getRecord(id))?.data as Operation | undefined;
    if (previous) { verifyOperation(previous, fingerprint); return previous; }
    const order = await tx.createOrder({ ...input, receiptTokenHash: hashReceiptToken(receiptToken) });
    const data: Operation = { fingerprint, order, startedAt: Date.now() };
    await tx.putRecord({ id, kind: 'checkout', orderId: order.id, data });
    return data;
  });
  if (!op.done) {
    const checkout = await createCheckoutResponse(op.order, receiptToken, id);
    await store.atomic(async tx => {
      const current = (await tx.getRecord(id))!.data as Operation;
      if (current.done) return;
      const order = await tx.getOrder(op.order.id);
      if (!order) throw new Error('Order not found');
      if (checkout.stripeSessionId) {
        if (order.stripeSessionId && order.stripeSessionId !== checkout.stripeSessionId) throw new Error('Checkout session mismatch');
        order.stripeSessionId = checkout.stripeSessionId;
        await tx.saveOrder(order);
      }
      // Never store the receipt capability in the journal. Demo URL is rebuilt below.
      current.checkoutUrl = checkout.stripeSessionId ? checkout.checkoutUrl : undefined;
      current.stripeSessionId = checkout.stripeSessionId;
      current.done = true;
      await tx.putRecord({ id, kind: 'checkout', orderId: order.id, data: current });
      if (order.status === 'pending_payment') await queueNotification(tx, order, 'Pending');
    });
  }
  const final = (await store.getRecord(id))!.data as Operation;
  return { orderId: op.order.id, checkoutUrl: final.checkoutUrl ?? `/checkout/success?order=${encodeURIComponent(op.order.id)}#receiptToken=${receiptToken}`, status: op.order.status, subtotal: op.order.subtotal, shippingCost: op.order.shippingCost, total: op.order.total };
}
export function sessionPayment(session: Record<string, unknown>, order: Order): PaymentDetails | undefined {
  if (typeof session.id !== 'string' || !session.id || (session.mode !== undefined && session.mode !== 'payment')) throw new Error('Invalid Checkout session');
  const metadata = session.metadata as Record<string, string> | undefined;
  if (metadata?.orderId !== order.id || (order.stripeSessionId && session.id !== order.stripeSessionId)) throw new Error('Checkout session does not match order');
  const zeroTotal = session.payment_status === 'no_payment_required' && session.amount_total === 0;
  if (session.status !== 'complete' || !(session.payment_status === 'paid' || zeroTotal)) return undefined;
  const details = session.total_details as { amount_discount?: number; amount_tax?: number; amount_shipping?: number } | undefined;
  if (session.currency !== 'usd' || typeof session.amount_total !== 'number' || session.amount_subtotal !== order.subtotal + order.shippingCost || !details || typeof details.amount_discount !== 'number' || (details.amount_tax ?? 0) !== 0 || (details.amount_shipping ?? 0) !== 0) throw new Error('Stripe totals do not match the order currency or quoted prices');
  return { stripeSessionId: String(session.id), stripePaymentIntentId: idOf(session.payment_intent), total: session.amount_total, discountAmount: details.amount_discount };
}
async function reconcileSession(store: Store, session: Record<string, unknown>, eventId?: string, failure = false) {
  const orderId = (session.metadata as Record<string, string> | undefined)?.orderId;
  if (!orderId) return;
  await store.atomic(async tx => {
    if (eventId && await tx.getRecord(`event:${eventId}`)) return;
    const order = await tx.getOrder(orderId);
    if (!order) throw new Error('Order not found; retry webhook');
    const payment = sessionPayment(session, order);
    if (payment) await payOrder(tx, order, payment);
    else if (failure && !order.paidAt) await cancelOrder(tx, order, session.status === 'expired' ? 'Checkout expired' : 'Delayed payment failed');
    if (eventId) await tx.putRecord({ id: `event:${eventId}`, kind: 'event', orderId, data: { type: 'checkout' } });
  });
}
export async function syncPayment(store: Store, order: Order) {
  const stripe = client();
  if (!stripe || !order.stripeSessionId) throw new Error('Order is missing Stripe payment details');
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
  if (!sessionPayment(session as unknown as Record<string, unknown>, order)) throw new Error(`Stripe still reports this Checkout Session as ${session.payment_status}`);
  await reconcileSession(store, session as unknown as Record<string, unknown>);
  const updated = (await store.getOrder(order.id))!;
  if (!updated.paidAt) throw new Error(`Stripe still reports this Checkout Session as ${session.payment_status}`);
  return updated;
}
export async function cancelCheckout(store: Store, order: Order, reason?: string) {
  if (order.paidAt) throw new Error('Only unpaid orders can be canceled');
  const stripe = client();
  if (stripe) {
    if (!order.stripeSessionId) throw new Error('Checkout creation is unresolved; retry checkout or reconcile Stripe before canceling');
    let session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (session.status === 'open') {
      try { session = await stripe.checkout.sessions.expire(order.stripeSessionId); }
      catch { session = await stripe.checkout.sessions.retrieve(order.stripeSessionId); }
    }
    if (session.status !== 'expired') {
      await reconcileSession(store, session as unknown as Record<string, unknown>);
      throw new Error('Checkout completed or payment is processing. Reconcile payment before canceling or refunding');
    }
  }
  return store.cancelOrder(order.id, reason);
}
export async function requestRefund(store: Store, orderId: string, input: { amount?: number; reason?: string }, key: string) {
  const id = `refund-request:${digest(key)}`;
  const fingerprint = digest(JSON.stringify({ orderId, ...input }));
  if (!await store.getRecord(id)) {
    const order = await store.getOrder(orderId);
    if (order?.stripeSessionId && client()) {
      const synced = await syncPayment(store, order);
      if (synced.stripePaymentIntentId) await processPaymentEvent(store, {
        id: `reconcile:${id}`, type: 'charge.refunded',
        data: { object: { payment_intent: synced.stripePaymentIntentId } }
      });
    }
  }
  const op = await store.atomic(async tx => {
    const old = (await tx.getRecord(id))?.data as Operation | undefined;
    if (old) { verifyOperation(old, fingerprint); return old; }
    const order = await tx.getOrder(orderId);
    if (!order || !order.paidAt || !['paid', 'fulfilled', 'partially_refunded', 'refund_failed'].includes(order.status)) throw new Error('Only paid or fulfilled orders can be refunded');
    if ((await tx.listRecords('refund-request', orderId)).some(r => !(r.data as Operation).done)) throw new Error('Another refund request is unresolved. Retry that request first');
    const amount = input.amount ?? order.total - order.refundedAmount;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > order.total - order.refundedAmount) throw new Error('Refund amount exceeds the remaining refundable total');
    const data: Operation = { fingerprint, order, startedAt: Date.now(), amount, reason: input.reason };
    await tx.putRecord({ id, kind: 'refund-request', orderId, data });
    return data;
  });
  if (!op.done) {
    const refund = await createOrderRefund(op.order, { amount: op.amount, reason: op.reason }, id);
    await store.atomic(async tx => {
      const current = (await tx.getRecord(id))!.data as Operation;
      if (current.done) return;
      const order = (await tx.getOrder(orderId))!;
      await refundOrder(tx, order, refund);
      await tx.putRecord({ id, kind: 'refund-request', orderId, data: { ...current, done: true, refund } });
    });
  }
  return { order: await store.getOrder(orderId), refund: ((await store.getRecord(id))!.data as Operation).refund };
}
export async function processPaymentEvent(store: Store, event: StripeWebhookEvent) {
  if (!event.id) throw new Error('Stripe event ID required');
  if (await store.getRecord(`event:${event.id}`)) return;
  const object = event.data?.object;
  if (!object) throw new Error('Stripe event object required');
  const stripe = client();
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type ?? '')) {
    const session = stripe ? await stripe.checkout.sessions.retrieve(String(object.id)) as unknown as Record<string, unknown> : object;
    await reconcileSession(store, session, event.id, ['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type!));
    return;
  }
  if (!['refund.created', 'refund.updated', 'refund.failed', 'charge.refunded'].includes(event.type ?? '')) return;
  // A charge contains aggregate amounts and sometimes a truncated refunds list. Never
  // add those aggregates to the individual-refund ledger.
  const paymentIntent = idOf(object.payment_intent);
  const raw = event.type === 'charge.refunded' ? undefined : stripe ? await stripe.refunds.retrieve(String(object.id)) as unknown as Record<string, unknown> : object;
  const intent = idOf(raw?.payment_intent) ?? paymentIntent;
  let orderId = (raw?.metadata as Record<string, string> | undefined)?.orderId;
  if (!orderId && intent) orderId = (await store.listOrders()).find(o => o.stripePaymentIntentId === intent)?.id;
  if (!orderId && stripe && intent) {
    orderId = (await stripe.paymentIntents.retrieve(intent)).metadata.orderId;
    if (!orderId) {
      // Older Checkout sessions did not copy metadata onto their PaymentIntent.
      const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 1 });
      orderId = sessions.data[0]?.metadata?.orderId;
    }
  }
  if (!orderId) return; // An unrelated payment on the same Stripe account.

  let order = await store.getOrder(orderId);
  if (!order) throw new Error('Order not found');
  if (!order.paidAt || (stripe && order.stripeSessionId)) order = await syncPayment(store, order);
  if (intent && order.stripePaymentIntentId && intent !== order.stripePaymentIntentId) throw new Error('Refund payment mismatch');
  await store.atomic(async tx => {
    const current = (await tx.getOrder(order!.id))!;
    if (current.refundedAmount > 0 && !await tx.getRecord(`refund-baseline:${current.id}`) && !(await tx.listRecords('refund', current.id)).length) {
      await tx.putRecord({ id: `refund-baseline:${current.id}`, kind: 'refund-baseline', orderId: current.id, data: { amount: current.refundedAmount, lastRefundId: current.stripeRefundId, migratedAt: Date.now() } });
    }
  });
  const baselineRecord = await store.getRecord(`refund-baseline:${order.id}`);
  const baseline = baselineRecord && !(baselineRecord.data as { reconciled?: boolean }).reconciled ? baselineRecord : undefined;
  let refunds: Record<string, unknown>[] = raw ? [raw] : [];
  if (stripe && intent && (baseline || !raw)) {
    refunds = [];
    for await (const refund of stripe.refunds.list({ payment_intent: intent, limit: 100 })) refunds.push(refund as unknown as Record<string, unknown>);
  }
  await store.atomic(async tx => {
    if (await tx.getRecord(`event:${event.id}`)) return;
    let current = (await tx.getOrder(order!.id))!;
    const currentBaseline = (await tx.getRecord(`refund-baseline:${current.id}`))?.data as { reconciled?: boolean; migratedAt?: number } | undefined;
    const migrateBaseline = !!baseline && !!stripe && !currentBaseline?.reconciled;
    if (migrateBaseline) {
      // Replace the legacy aggregate with Stripe's complete individual history.
      await tx.putRecord({ id: baseline!.id, kind: 'refund-baseline', orderId: current.id, data: { amount: 0, reconciled: true } });
    }
    const changed: RefundEntry[] = [];
    for (const r of refunds) {
      if (r.currency && r.currency !== 'usd') throw new Error('Refund currency mismatch');
      const entry: RefundEntry = { refundId: String(r.id), amount: Number(r.amount), status: String(r.status), reason: (r.metadata as Record<string, string> | undefined)?.reason ?? (typeof r.failure_reason === 'string' ? r.failure_reason : undefined) };
      const before = (await tx.getRecord(`refund:${entry.refundId}`))?.data as RefundEntry | undefined;
      current = await refundOrder(tx, current, entry, false);
      const after = (await tx.getRecord(`refund:${entry.refundId}`))?.data as RefundEntry | undefined;
      const notify = !migrateBaseline || ((event.created ?? 0) * 1000 >= (currentBaseline?.migratedAt ?? Number.POSITIVE_INFINITY) && (raw ? r.id === raw.id : Number(r.created) * 1000 >= (currentBaseline?.migratedAt ?? 0)));
      if (notify && after?.status === entry.status && before?.status !== after.status) changed.push(entry);
    }
    // Build receipts from the final aggregate, even when Stripe lists newest refunds first.
    for (const entry of changed) {
      const snapshot = { ...current, stripeRefundId: entry.refundId, refundReason: entry.reason };
      if (entry.status === 'succeeded') await queueNotification(tx, snapshot, 'Refunded', entry.refundId);
      if (['failed', 'canceled'].includes(entry.status)) await queueNotification(tx, snapshot, 'RefundFailed', entry.refundId);
    }
    await tx.putRecord({ id: `event:${event.id}`, kind: 'event', orderId: current.id, data: { type: event.type } });
  });
}
