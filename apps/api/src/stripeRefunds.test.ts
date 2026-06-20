import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrderRefund } from './stripeRefunds.js';
import type { Order } from './types.js';

const calls = vi.hoisted(() => ({ retrievedSessionId: '', refundedPaymentIntent: '' }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        retrieve: async (sessionId: string) => {
          calls.retrievedSessionId = sessionId;
          return { payment_intent: 'pi_from_session' };
        }
      }
    };
    refunds = {
      create: async (input: { payment_intent: string; amount: number }) => {
        calls.refundedPaymentIntent = input.payment_intent;
        return { id: 're_test_123', amount: input.amount, status: 'succeeded' };
      }
    };
  }
}));

const order: Order = {
  id: 'ord_test',
  email: 'guest@example.com',
  status: 'paid',
  total: 1798,
  subtotal: 1299,
  shippingCost: 499,
  refundedAmount: 0,
  stripeSessionId: 'cs_test_123',
  createdAt: '2026-05-18T00:00:00.000Z',
  items: [{ productId: 'p1', title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }]
};

describe('createOrderRefund', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    calls.retrievedSessionId = '';
    calls.refundedPaymentIntent = '';
  });

  it('retrieves the Stripe PaymentIntent from the Checkout Session when older orders are missing it', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake_for_unit_test');

    const refund = await createOrderRefund(order, { reason: 'Customer requested cancellation' });

    expect(calls.retrievedSessionId).toBe('cs_test_123');
    expect(calls.refundedPaymentIntent).toBe('pi_from_session');
    expect(refund).toMatchObject({ refundId: 're_test_123', amount: 1798, status: 'succeeded' });
  });
});
