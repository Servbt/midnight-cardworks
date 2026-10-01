import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveHistoricalRefunds, retrieveCurrentRefund } from './refundReconciliation.js';
import type { Order } from './types.js';
const mock = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), refund: vi.fn() }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { retrieve: mock.retrieve } }; refunds = { list: mock.list, retrieve: mock.refund }; } }));
const order: Order = { id: 'ord_test', email: 'buyer@example.test', items: [], subtotal: 1000, shippingCost: 0, total: 1000, status: 'refunded', refundedAmount: 1000, createdAt: '2026-10-01', stripeSessionId: 'cs_test', stripePaymentIntentId: 'pi_test', refundReconciliationRequired: true };
function setup(overrides = {}) {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic');
  mock.retrieve.mockResolvedValue({ id: 'cs_test', metadata: { orderId: order.id }, payment_intent: { id: 'pi_test' }, ...overrides });
}
function refunds(values: unknown[]) {
  mock.list.mockImplementation(() => ({ async *[Symbol.asyncIterator]() { for (const value of values) yield value; } }));
}
afterEach(() => { vi.unstubAllEnvs(); mock.retrieve.mockReset(); mock.list.mockReset(); mock.refund.mockReset(); });
describe('Stripe historical refund retrieval', () => {
  it('retrieves current refund status and checks payment ownership', async () => {
    setup();
    mock.refund.mockResolvedValue({ id: 're_test', payment_intent: 'pi_test', amount: 100, status: 'failed' });
    expect(await retrieveCurrentRefund(order, 're_test')).toMatchObject({ id: 're_test', amount: 100, status: 'failed' });
    mock.refund.mockResolvedValue({ id: 're_test', payment_intent: 'pi_other', amount: 100, status: 'succeeded' });
    await expect(retrieveCurrentRefund(order, 're_test')).rejects.toThrow('does not match');
  });
  it('consumes every result and maps all supported statuses', async () => {
    setup();
    refunds(['succeeded', 'pending', 'requires_action', 'failed', 'canceled'].map((status, index) => ({ id: 're_' + index, payment_intent: 'pi_test', amount: 100, status, metadata: { orderId: order.id } })));
    const entries = await retrieveHistoricalRefunds(order);
    expect(entries.map((entry) => entry.status)).toEqual(['succeeded', 'pending', 'pending', 'failed', 'failed']);
    expect(mock.list).toHaveBeenCalledWith({ payment_intent: 'pi_test', limit: 100 });
  });
  it.each([{ id: 'cs_other' }, { metadata: { orderId: 'other' } }, { payment_intent: 'pi_other' }])('rejects mismatched session bindings %j', async (overrides) => {
    setup(overrides);
    await expect(retrieveHistoricalRefunds(order)).rejects.toThrow('does not match');
    expect(mock.list).not.toHaveBeenCalled();
  });
  it.each([{ payment_intent: 'pi_other' }, { metadata: { orderId: 'other' } }, { status: 'unknown' }])('rejects mismatched or unknown refund snapshots %j', async (overrides) => {
    setup();
    refunds([{ id: 're_test', amount: 100, status: 'succeeded', payment_intent: 'pi_test', ...overrides }]);
    await expect(retrieveHistoricalRefunds(order)).rejects.toThrow();
  });
  it('fails without Stripe configuration instead of inventing historical records', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    await expect(retrieveHistoricalRefunds(order)).rejects.toThrow('Stripe is required');
  });
});
