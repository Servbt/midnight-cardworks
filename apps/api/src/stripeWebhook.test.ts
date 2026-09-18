import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';
import type { EmailNotifier } from './emailNotifications.js';

const secret = 'whsec_local_signature_test';
const stripe = new Stripe('sk_test_local_signature_test');
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('signed Stripe webhook HTTP boundary (real SDK)', () => {
  it('accepts the exact signed raw bytes and rejects missing, incorrect, stale and tampered signatures', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_signature_test');
    const store = createInMemoryStore();
    const order = await store.createOrder({ email: 'test@example.com', customerName: 'Test', shippingAddress: 'Test address', items: [{ productId: 'p1', quantity: 1 }] });
    const paid = vi.fn(async () => {});
    const app = await buildServer(store, { emailNotifier: { sendOrderPaid: paid } as unknown as EmailNotifier });
    // Whitespace and Unicode exercise raw-byte handling rather than reserialized JSON.
    const payload = JSON.stringify({ id: 'evt_local', type: 'checkout.session.completed', data: { object: { id: 'cs_local', status: 'complete', currency: 'usd', amount_total: 1798, amount_subtotal: 1798, total_details: { amount_discount: 0 }, payment_status: 'paid', payment_intent: 'pi_local', metadata: { orderId: order.id, note: '\u00e9' } } } }, null, 2);
    vi.spyOn(Object.getPrototypeOf(stripe.checkout.sessions), 'retrieve').mockResolvedValue(JSON.parse(payload).data.object);
    const sign = (value = payload, signingSecret = secret, timestamp?: number) => stripe.webhooks.generateTestHeaderString({ payload: value, secret: signingSecret, timestamp });
    const post = (body: string, signature?: string) => app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) }, payload: body });
    try {
      for (const [body, signature] of [[payload, undefined], [payload, sign(payload, 'whsec_wrong')], [payload + ' ', sign()], [payload, sign(payload, secret, 1)]] as const) {
        expect((await post(body, signature)).statusCode).toBe(400);
        expect((await store.getOrder(order.id))?.status).toBe('pending_payment');
        expect(paid).not.toHaveBeenCalled();
      }
      expect((await post(payload, sign())).statusCode).toBe(200);
      expect(await store.getOrder(order.id)).toMatchObject({ status: 'paid', stripeSessionId: 'cs_local', stripePaymentIntentId: 'pi_local' });
      expect(paid).toHaveBeenCalledTimes(1);
      const unrelated = JSON.stringify({ id: 'evt_unrelated', type: 'customer.created', data: { object: {} } });
      expect((await post(unrelated, sign(unrelated))).json()).toEqual({ received: true });
      expect(paid).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
