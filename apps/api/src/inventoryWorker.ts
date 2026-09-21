import Stripe from 'stripe';
import { stripeSecret } from './productionConfig.js';
import { reconcileSession, sessionPayment } from './paymentService.js';
import type { Store } from './types.js';

/** A clock deadline triggers provider reconciliation, never an unconditional release. */
export async function reconcileReservations(store: Store, onError: (error: unknown) => void = () => {}) {
  const secret = stripeSecret();
  const stripe = secret ? new Stripe(secret, { timeout: 20000, maxNetworkRetries: 1 }) : undefined;
  for (const candidate of await store.listReservationOrders()) {
    try {
      const order = (await store.getOrder(candidate.id))!;
      if (order.paidAt) {
        // A phase-3 instance can finish payment between migration and code rollout.
        await store.markOrderPaid(order.id);
        continue;
      }
      const expiresAt = new Date(order.reservationExpiresAt ?? order.createdAt).getTime();
      if (Date.now() < expiresAt) continue;
      if (!stripe) { await store.cancelOrder(order.id, 'Local checkout expired'); continue; }
      let sessions: Stripe.Checkout.Session[] = [];
      if (order.stripeSessionId) sessions = [await stripe.checkout.sessions.retrieve(order.stripeSessionId)];
      else {
        // A request can reach Stripe before its response or the local session ID is saved.
        // Enumerate the complete bounded creation window, including paginated results.
        for await (const session of stripe.checkout.sessions.list({ created: { gte: Math.floor(new Date(order.createdAt).getTime() / 1000) - 60, lte: Math.ceil(expiresAt / 1000) }, limit: 100 })) {
          if (session.metadata?.orderId === order.id) sessions.push(session);
        }
        if (!sessions.length) {
          // New sessions have a fixed expires_at and are no longer creatable. Legacy
          // sessions could live 24h after a late retry; allow 48h from order creation.
          if (order.inventoryState === 'held' && Date.now() >= expiresAt + 5 * 60000) await store.cancelOrder(order.id, 'Checkout creation expired without a Stripe session');
          else if (order.inventoryState === 'legacy_held' && Date.now() >= new Date(order.createdAt).getTime() + 48 * 3600000 + 5 * 60000) await store.cancelOrder(order.id, 'Legacy checkout creation window expired without a Stripe session');
          continue;
        }
      }
      let allExpired = true;
      for (let session of sessions) {
        sessionPayment(session as unknown as Record<string, unknown>, order); // validate identity even if unpaid
        if (session.status === 'open') {
          try { session = await stripe.checkout.sessions.expire(session.id); }
          catch { session = await stripe.checkout.sessions.retrieve(session.id); }
        }
        const snapshot = session as unknown as Record<string, unknown>;
        if (sessionPayment(snapshot, order)) {
          await reconcileSession(store, snapshot);
          allExpired = false;
        } else if (session.status !== 'expired') {
          allExpired = false;
          const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
          if (session.status === 'complete' && sessions.length === 1 && intentId && ['canceled', 'requires_payment_method'].includes((await stripe.paymentIntents.retrieve(intentId)).status)) await reconcileSession(store, snapshot, undefined, true);
        }
      }
      if (allExpired) await store.cancelOrder(order.id, 'Checkout expired');
      await store.putRecord({ id: `inventory-recovery:${order.id}`, kind: 'inventory-recovery', orderId: order.id, data: { state: 'checked', checkedAt: new Date().toISOString() } });
    } catch (error) {
      onError(error);
      await store.putRecord({ id: `inventory-recovery:${candidate.id}`, kind: 'inventory-recovery', orderId: candidate.id, data: { state: 'attention', errorType: error instanceof Error ? error.name : 'Error', checkedAt: new Date().toISOString() } }).catch(onError);
    }
  }
}
export function startInventoryWorker(store: Store, onError: (error: unknown) => void) {
  let running: Promise<void> | undefined;
  const tick = () => { if (!running) running = reconcileReservations(store, onError).catch(onError).finally(() => { running = undefined; }); };
  const timer = setInterval(tick, 60000); timer.unref(); tick();
  return async () => { clearInterval(timer); await running; };
}
