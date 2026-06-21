import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutResponse } from './checkout.js';
import type { Order } from './types.js';

const stripeCreate = vi.hoisted(() => vi.fn(async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session', payment_intent: 'pi_test_123' })));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        create: stripeCreate
      }
    };
  }
}));

const order: Order = {
  id: 'ord_test',
  email: 'guest@example.com',
  status: 'pending_payment',
  total: 1798,
  refundedAmount: 0,
  createdAt: '2026-05-18T00:00:00.000Z',
  subtotal: 1299,
  shippingCost: 499,
  items: [{ productId: 'p1', title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }]
};

describe('createCheckoutResponse', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    stripeCreate.mockClear();
  });

  it('uses Stripe default export when a real secret key is configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake_for_unit_test');
    vi.stubEnv('APP_BASE_URL', 'https://midnight-cardworks.onrender.com');

    const response = await createCheckoutResponse(order);

    expect(response.checkoutUrl).toBe('https://checkout.stripe.test/session');
    expect(response.orderId).toBe('ord_test');
    expect(response.stripeSessionId).toBe('cs_test_123');
    expect(response.stripePaymentIntentId).toBe('pi_test_123');
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({ allow_promotion_codes: true }));
  });
});
