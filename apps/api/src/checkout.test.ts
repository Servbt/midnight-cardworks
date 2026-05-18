import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutResponse } from './checkout.js';
import type { Order } from './types.js';

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        create: async () => ({ url: 'https://checkout.stripe.test/session' })
      }
    };
  }
}));

const order: Order = {
  id: 'ord_test',
  email: 'guest@example.com',
  status: 'pending_payment',
  total: 1299,
  createdAt: '2026-05-18T00:00:00.000Z',
  subtotal: 1299,
  items: [{ productId: 'p1', title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }]
};

describe('createCheckoutResponse', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses Stripe default export when a real secret key is configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake_for_unit_test');
    vi.stubEnv('APP_BASE_URL', 'https://midnight-cardworks.onrender.com');

    const response = await createCheckoutResponse(order);

    expect(response.checkoutUrl).toBe('https://checkout.stripe.test/session');
    expect(response.orderId).toBe('ord_test');
  });
});
