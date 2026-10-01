import Stripe from 'stripe';
import type { Order } from './types.js';
import { checkoutRequest } from './checkoutRequest.js';

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('replace_me'));
}

export async function createCheckoutResponse(order: Order) {
  const totals = { orderId: order.id, status: order.status, subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total };
  if (order.checkoutRequestJson || stripeConfigured()) {
    if (!stripeConfigured()) throw new Error('Stripe is not configured; checkout cannot be recovered');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // Persisted request and stable key recover a timeout without creating a second session.
    const request = order.checkoutRequestJson ? JSON.parse(order.checkoutRequestJson) as Stripe.Checkout.SessionCreateParams : checkoutRequest(order, process.env.APP_BASE_URL ?? 'http://localhost:5173');
    const session = await stripe.checkout.sessions.create(request, { idempotencyKey: `checkout:${order.id}` });
    return { ...totals, checkoutUrl: session.url, stripeSessionId: session.id, stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id };
  }
  return { ...totals, checkoutUrl: `/checkout/success?order=${order.id}`, stripeSessionId: undefined, stripePaymentIntentId: undefined };
}
