import type { Order } from './types.js';

function stripeId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

type StripeCheckoutSession = {
  id: string;
  payment_status?: string | null;
  status?: string | null;
  payment_intent?: unknown;
};

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

  const stripeModule = await import('stripe');
  const StripeClient = ((stripeModule as any).default ?? stripeModule) as { new (key: string): { checkout: { sessions: { retrieve(id: string): Promise<StripeCheckoutSession> } } } };
  const stripe = new StripeClient(stripeSecret);
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);

  return {
    paid: session.payment_status === 'paid',
    paymentStatus: session.payment_status ?? undefined,
    sessionStatus: session.status ?? undefined,
    stripeSessionId: session.id,
    stripePaymentIntentId: stripeId(session.payment_intent)
  };
}
