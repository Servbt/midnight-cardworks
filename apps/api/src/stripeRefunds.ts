import { nanoid } from 'nanoid';
import type { Order } from './types.js';

export type RefundRequest = { amount?: number; reason?: string };
export type RefundResult = { refundId: string; amount: number; status: string; reason?: string };

function hasRealStripeSecret() {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  return Boolean(stripeSecret && !stripeSecret.includes('replace_me'));
}

export async function createOrderRefund(order: Order, request: RefundRequest = {}): Promise<RefundResult> {
  const remainingAmount = Math.max(0, order.total - order.refundedAmount);
  const amount = request.amount ?? remainingAmount;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Refund amount must be positive');
  if (amount > remainingAmount) throw new Error('Refund amount exceeds the remaining refundable total');

  if (!hasRealStripeSecret()) {
    return { refundId: `re_demo_${order.id}_${nanoid(6)}`, amount, status: 'succeeded', reason: request.reason };
  }

  if (!order.stripePaymentIntentId) throw new Error('Order is missing a Stripe payment intent');

  const stripeModule = await import('stripe');
  const StripeClient = ((stripeModule as any).default ?? stripeModule) as { new (key: string): { refunds: { create(input: unknown): Promise<{ id: string; amount: number; status: string | null; metadata?: Record<string, string> }> } } };
  const stripe = new StripeClient(process.env.STRIPE_SECRET_KEY!);
  const refund = await stripe.refunds.create({
    payment_intent: order.stripePaymentIntentId,
    amount,
    reason: 'requested_by_customer',
    metadata: { orderId: order.id, reason: request.reason ?? '' }
  });

  return { refundId: refund.id, amount: refund.amount, status: refund.status ?? 'pending', reason: request.reason };
}
