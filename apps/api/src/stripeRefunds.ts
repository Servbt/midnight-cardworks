import type Stripe from 'stripe';
import { stripeSecret } from './productionConfig.js';
import { nanoid } from 'nanoid';
import type { Order } from './types.js';

export type RefundRequest = { amount?: number; reason?: string };
export type RefundResult = { refundId: string; amount: number; status: string; reason?: string };

function stripeId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

async function retrievePaymentIntentFromSession(stripe: Stripe, stripeSessionId: string | undefined) {
  if (!stripeSessionId) return undefined;
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
  return stripeId(session.payment_intent);
}

export async function createOrderRefund(order: Order, request: RefundRequest = {}, idempotencyKey?: string): Promise<RefundResult> {
  const remainingAmount = Math.max(0, order.total - order.refundedAmount);
  const amount = request.amount ?? remainingAmount;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Refund amount must be positive');
  if (amount > remainingAmount) throw new Error('Refund amount exceeds the remaining refundable total');

  const secret = stripeSecret();
  if (!secret) {
    return { refundId: `re_demo_${order.id}_${nanoid(6)}`, amount, status: 'succeeded', reason: request.reason };
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secret, { timeout: 20000, maxNetworkRetries: 1 });
  const paymentIntentId = order.stripePaymentIntentId ?? await retrievePaymentIntentFromSession(stripe, order.stripeSessionId);
  if (!paymentIntentId) throw new Error('Order is missing Stripe payment details. Open the matching payment in Stripe Dashboard to refund this older order.');

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount,
    reason: 'requested_by_customer',
    metadata: { orderId: order.id, reason: request.reason ?? '' }
  }, { idempotencyKey: idempotencyKey ?? `refund:${order.id}:${nanoid(24)}` });

  return { refundId: refund.id, amount: refund.amount, status: refund.status ?? 'pending', reason: request.reason };
}
