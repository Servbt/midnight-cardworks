import Stripe from 'stripe';
import type { Order } from './types.js';
import type { RefundEntry } from './refundLedger.js';

export async function retrieveCurrentRefund(order: Order, refundId: string): Promise<RefundEntry> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('replace_me')) throw new Error('Stripe is required for refund verification');
  const stripe = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 0 });
  let intentId = order.stripePaymentIntentId;
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (session.id !== order.stripeSessionId || session.metadata?.orderId !== order.id) throw new Error('Stripe session does not match order');
    const id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (intentId && id !== intentId) throw new Error('Stripe payment intent does not match order');
    intentId = id;
  }
  if (!intentId) throw new Error('Order is missing Stripe payment details');
  const refund = await stripe.refunds.retrieve(refundId);
  const refundIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  if (refund.id !== refundId || refundIntent !== intentId || (refund.metadata?.orderId && refund.metadata.orderId !== order.id)) throw new Error('Refund does not match order');
  if (!['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(refund.status ?? '')) throw new Error('Unknown Stripe refund status');
  return { id: refund.id, orderId: order.id, amount: refund.amount, status: refund.status === 'succeeded' ? 'succeeded' : ['failed', 'canceled'].includes(refund.status!) ? 'failed' : 'pending', reason: refund.metadata?.reason || refund.failure_reason || undefined };
}

export async function retrieveHistoricalRefunds(order: Order): Promise<RefundEntry[]> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('replace_me')) throw new Error('Stripe is required for historical reconciliation');
  const stripe = new Stripe(key);
  let intentId = order.stripePaymentIntentId;
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (session.metadata?.orderId !== order.id || session.id !== order.stripeSessionId) throw new Error('Stripe session does not match order');
    const sessionIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (intentId && sessionIntent !== intentId) throw new Error('Stripe payment intent does not match order');
    intentId = sessionIntent;
  }
  if (!intentId) throw new Error('Order is missing Stripe payment details');
  const entries: RefundEntry[] = [];
  for await (const refund of stripe.refunds.list({ payment_intent: intentId, limit: 100 })) {
    const refundIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    if (refundIntent !== intentId || (refund.metadata?.orderId && refund.metadata.orderId !== order.id)) throw new Error('Refund does not match order');
    if (!['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(refund.status ?? '')) throw new Error('Unknown Stripe refund status');
    entries.push({ id: refund.id, orderId: order.id, amount: refund.amount, status: refund.status === 'succeeded' ? 'succeeded' : ['failed', 'canceled'].includes(refund.status!) ? 'failed' : 'pending', reason: refund.metadata?.reason || refund.failure_reason || undefined });
  }
  return entries;
}
