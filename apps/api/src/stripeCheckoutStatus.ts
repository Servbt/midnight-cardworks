import type { Order } from './types.js';

import Stripe from 'stripe';

function stripeId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

export type CheckoutPaymentStatus = {
  paid: boolean;
  paymentStatus?: string;
  sessionStatus?: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
};

export async function retrieveCheckoutPaymentStatus(order: Order): Promise<CheckoutPaymentStatus> {
  if (!order.stripeSessionId) throw new Error('Order is missing a Stripe Checkout Session. Use the original shop checkout link before syncing payment.');
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret || stripeSecret.includes('replace_me')) throw new Error('Stripe secret key is not configured for payment sync.');

  const stripe = new Stripe(stripeSecret);
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
  if (session.id !== order.stripeSessionId || session.metadata?.orderId !== order.id) throw new Error('Stripe session does not match this order');
  const paymentIntentId = stripeId(session.payment_intent);
  if (order.stripePaymentIntentId && paymentIntentId !== order.stripePaymentIntentId) throw new Error('Stripe payment intent does not match this order');

  return {
    paid: session.status === 'complete' && (session.payment_status === 'paid' || (session.payment_status === 'no_payment_required' && session.amount_total === 0)),
    paymentStatus: session.payment_status ?? undefined,
    sessionStatus: session.status ?? undefined,
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId
  };
}
