import Stripe from 'stripe';
import { createCheckoutResponse, stripeConfigured } from './checkout.js';
import type { Order, Store } from './types.js';

export function rejectedCheckoutRequest(error: unknown) {
  // These validation failures happen before a Checkout Session is created.
  return Boolean(Stripe.errors?.StripeInvalidRequestError && error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 400 && error.code !== 'idempotency_key_in_use');
}

export async function cancelCheckout(store: Store, order: Order, reason: string, failedPayment = false) {
  if (order.status !== 'pending_payment') throw new Error('Only pending payment orders can be canceled');
  if (!order.checkoutRequestJson && !order.stripeSessionId) {
    if (!order.inventoryReserved && stripeConfigured()) throw new Error('Legacy order has no Stripe session; reconcile it before cancellation');
    return store.cancelOrder(order.id, reason);
  }
  if (!stripeConfigured()) throw new Error('Stripe is required to safely cancel this checkout');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let sessionId = order.stripeSessionId;
  if (!sessionId) {
    // Stripe only guarantees idempotency-key retention for 24 hours.
    if (Date.now() - new Date(order.createdAt).getTime() >= 23 * 60 * 60 * 1000) {
      throw new Error('Unresolved checkout is too old for automatic recovery; reconcile it in Stripe');
    }
    try {
      const recovered = await createCheckoutResponse(order);
      sessionId = recovered.stripeSessionId;
      if (!sessionId) throw new Error('Stripe did not return a Checkout Session');
      await store.recordCheckoutSession(order.id, sessionId);
    } catch (error) {
      if (rejectedCheckoutRequest(error)) return store.cancelOrder(order.id, reason);
      throw error;
    }
  }
  let session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.orderId !== order.id) throw new Error('Stripe session does not match this order');
  if (session.status === 'open') {
    try {
      session = await stripe.checkout.sessions.expire(sessionId);
    } catch {
      // Payment may have won the race; never release stock based on stale state.
      session = await stripe.checkout.sessions.retrieve(sessionId);
    }
  }
  if (failedPayment && session.status === 'complete' && session.payment_status === 'unpaid' && session.payment_intent) {
    const intent = typeof session.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
    if (intent.status === 'canceled' || intent.status === 'requires_payment_method') return store.cancelOrder(order.id, reason);
  }
  if (session.status !== 'expired') throw new Error('Checkout is completed or payment is processing; stock remains reserved');
  return store.cancelOrder(order.id, reason);
}

export async function releaseExpiredReservations(store: Store, reportError: (orderId: string, error: unknown) => void) {
  const due = (await store.listOrders()).filter((order) => order.status === 'pending_payment' && order.inventoryReserved && order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() <= Date.now());
  for (const order of due) {
    try {
      await cancelCheckout(store, order, 'Checkout reservation expired');
    } catch (error) {
      reportError(order.id, error);
    }
  }
}
