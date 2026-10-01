import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveCheckoutPaymentStatus } from './stripeCheckoutStatus.js';
import { createInMemoryStore } from './store.js';
const mock = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { retrieve: mock.retrieve } }; } }));
afterEach(() => { vi.unstubAllEnvs(); mock.retrieve.mockReset(); });
async function fixture() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic');
  const store = createInMemoryStore();
  const order = await store.createOrder({ email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Test', items: [{ productId: 'p1', quantity: 1 }] });
  await store.recordCheckoutSession(order.id, 'cs_expected');
  return { order, session: { id: 'cs_expected', metadata: { orderId: order.id }, status: 'complete', payment_status: 'paid', payment_intent: { id: 'pi_expected' }, amount_total: order.total } };
}
describe('Stripe payment sync verification', () => {
  it('accepts a completed paid session and expanded payment intent', async () => {
    const { order, session } = await fixture();
    mock.retrieve.mockResolvedValue(session);
    expect(await retrieveCheckoutPaymentStatus(order)).toMatchObject({ paid: true, stripePaymentIntentId: 'pi_expected' });
  });
  it.each(['open', 'expired'])('refuses a paid claim for a %s session', async (status) => {
    const { order, session } = await fixture();
    mock.retrieve.mockResolvedValue({ ...session, status });
    expect((await retrieveCheckoutPaymentStatus(order)).paid).toBe(false);
  });
  it.each([0, 100])('accepts no-payment-required only for zero total (%s)', async (amount_total) => {
    const { order, session } = await fixture();
    mock.retrieve.mockResolvedValue({ ...session, payment_status: 'no_payment_required', amount_total });
    expect((await retrieveCheckoutPaymentStatus(order)).paid).toBe(amount_total === 0);
  });
  it.each(['session', 'metadata', 'intent'])('rejects conflicting %s ownership', async (field) => {
    const { order, session } = await fixture();
    if (field === 'session') session.id = 'cs_other';
    if (field === 'metadata') session.metadata.orderId = 'ord_other';
    if (field === 'intent') order.stripePaymentIntentId = 'pi_other';
    mock.retrieve.mockResolvedValue(session);
    await expect(retrieveCheckoutPaymentStatus(order)).rejects.toThrow('does not match');
  });
  it('leaves delayed unpaid payments unconfirmed', async () => {
    const { order, session } = await fixture();
    mock.retrieve.mockResolvedValue({ ...session, payment_status: 'unpaid' });
    expect((await retrieveCheckoutPaymentStatus(order)).paid).toBe(false);
  });
});
