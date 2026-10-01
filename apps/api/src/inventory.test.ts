import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from './store.js';
import { availableProduct } from './inventory.js';
import { startCheckout, processPaymentEvent } from './paymentService.js';
import { reconcileReservations } from './inventoryWorker.js';
import type { Order, Store } from './types.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), list: vi.fn(), intent: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  checkout = { sessions: { create: mocks.create, retrieve: mocks.retrieve, expire: mocks.expire, list: mocks.list } };
  paymentIntents = { retrieve: mocks.intent };
} }));
const input = { email: 'buyer@example.com', customerName: 'Buyer', shippingAddress: '123 Main Street', items: [{ productId: 'p1', quantity: 1 }] };
const stock = async (store: Store) => (await store.getProduct('golden-hour-commander-proxy'))!;
async function lastUnit() { const store = createInMemoryStore(); await store.upsertProduct({ ...await stock(store), inventory: 1 }); return store; }
function session(order: Order, patch = {}) { return { id: 'cs_test', mode: 'payment', metadata: { orderId: order.id }, status: 'complete', payment_status: 'paid', currency: 'usd', amount_subtotal: order.subtotal + order.shippingCost, amount_total: order.total, total_details: { amount_discount: 0 }, payment_intent: 'pi_test', ...patch }; }
function advance(order: Order, minutes = 6) { vi.useFakeTimers(); vi.setSystemTime(new Date(order.reservationExpiresAt!).getTime() + minutes * 60000); }
beforeEach(() => { vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('STRIPE_SECRET_KEY', ''); vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('inventory reservations', () => {
  it('lets only one competing checkout reserve the last unit, before contacting Stripe', async () => {
    const store = await lastUnit(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.create.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/session' });
    const results = await Promise.allSettled([startCheckout(store, input, 'a'.repeat(43)), startCheckout(store, input, 'b'.repeat(43))]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await store.listOrders()).toHaveLength(1); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(await stock(store)).toMatchObject({ inventory: 1, reservedInventory: 1 });
    expect(availableProduct(await stock(store)).inventory).toBe(0);
    expect(mocks.create.mock.calls[0][0].expires_at).toBe(Math.floor(new Date((await store.listOrders())[0].reservationExpiresAt!).getTime() / 1000));
  });
  it('aggregates duplicate lines and rolls back every item when a later reservation fails', async () => {
    const store = await lastUnit();
    await expect(store.createOrder({ ...input, items: [...input.items, ...input.items] })).rejects.toThrow('stock');
    await expect(store.createOrder({ ...input, items: [...input.items, { productId: 'p2', quantity: 99 }] })).rejects.toThrow();
    expect(await store.listOrders()).toHaveLength(0); expect((await stock(store)).reservedInventory).toBe(0);
    await store.upsertProduct({ ...await stock(store), inventory: 3 });
    const order = await store.createOrder({ ...input, items: [...input.items, ...input.items] });
    expect(order.items).toHaveLength(1); expect(order.items[0].quantity).toBe(2);
    expect((await stock(store)).reservedInventory).toBe(2);
  });
  it('rejects inactive items and invalid or excessive quantities without orphan orders', async () => {
    const store = await lastUnit(); await store.upsertProduct({ ...await stock(store), active: false });
    for (const quantity of [1, 0, -1, 0.5, 100]) await expect(store.createOrder({ ...input, items: [{ productId: 'p1', quantity }] })).rejects.toThrow();
    expect(await store.listOrders()).toHaveLength(0);
  });
  it('reuses a hold after a lost Stripe response and expires it only after canonical confirmation', async () => {
    const store = await lastUnit(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.create.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/session' });
    const key = 'x'.repeat(43); await expect(startCheckout(store, input, key)).rejects.toThrow('lost response');
    await startCheckout(store, input, key); const order = (await store.listOrders())[0];
    expect((await stock(store)).reservedInventory).toBe(1); expect(mocks.create.mock.calls[0]).toEqual(mocks.create.mock.calls[1]);
    advance(order); mocks.retrieve.mockResolvedValue(session(order, { status: 'expired', payment_status: 'unpaid' }));
    await Promise.all([reconcileReservations(store), reconcileReservations(store)]);
    expect(await stock(store)).toMatchObject({ inventory: 1, reservedInventory: 0 });
    await expect(startCheckout(store, input, key)).rejects.toMatchObject({ code: 'CHECKOUT_CLOSED' });
  });
  it('releases definitive creation rejection but preserves ambiguous network failures', async () => {
    const store = await lastUnit(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.create.mockRejectedValue({ type: 'StripeInvalidRequestError', code: 'parameter_invalid_integer' });
    await expect(startCheckout(store, input, 'c'.repeat(43))).rejects.toMatchObject({ code: 'CHECKOUT_CLOSED' });
    expect((await stock(store)).reservedInventory).toBe(0);
    mocks.create.mockRejectedValue(new Error('timeout'));
    await expect(startCheckout(store, input, 'd'.repeat(43))).rejects.toThrow('timeout');
    expect((await stock(store)).reservedInventory).toBe(1);
  });
  it('consumes a hold exactly once and never restocks on refund', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input);
    await Promise.all([store.markOrderPaid(order.id), store.markOrderPaid(order.id)]);
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
    await store.markOrderRefunded(order.id, { refundId: 're_full', amount: order.total });
    await store.markOrderPaid(order.id);
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
  });
  it('blocks stale admin writes and stock below active holds', async () => {
    const store = await lastUnit(); const stale = await stock(store); await store.createOrder(input);
    await expect(store.upsertProduct({ ...stale, inventory: 10 })).rejects.toThrow('Stock changed');
    await expect(store.upsertProduct({ ...await stock(store), inventory: 0 })).rejects.toThrow('held');
    expect(await stock(store)).toMatchObject({ inventory: 1, reservedInventory: 1 });
  });
  it('records late payment without stealing another hold, blocks fulfillment, and allocates after replenishment', async () => {
    const store = await lastUnit(); const first = await store.createOrder(input); await store.cancelOrder(first.id);
    const second = await store.createOrder(input); await store.markOrderPaid(first.id);
    expect(await store.getOrder(first.id)).toMatchObject({ status: 'paid', inventoryState: 'attention' });
    await expect(store.markOrderFulfilled(first.id)).rejects.toThrow('allocation');
    expect(await stock(store)).toMatchObject({ inventory: 1, reservedInventory: 1 });
    await store.upsertProduct({ ...await stock(store), inventory: 2 }); await store.markOrderPaid(first.id);
    expect((await store.getOrder(first.id))!.inventoryIssue).toBeUndefined();
    await store.markOrderFulfilled(first.id); await store.markOrderPaid(second.id);
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
  });
  it('resolves an unallocated payment by full refund without returning stock', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); await store.cancelOrder(order.id);
    await store.createOrder(input); await store.markOrderPaid(order.id);
    await store.markOrderRefunded(order.id, { refundId: 're_attention', amount: order.total });
    await store.markOrderPaid(order.id);
    expect(await store.getOrder(order.id)).toMatchObject({ status: 'refunded', inventoryState: 'released' });
    expect(await stock(store)).toMatchObject({ inventory: 1, reservedInventory: 1 });
    await store.markOrderRefundFailed(order.id, { refundId: 're_attention', reason: 'bank rejected refund' });
    await expect(store.markOrderFulfilled(order.id)).rejects.toThrow('allocation');
  });
});

describe('reservation recovery', () => {
  it('retains processing payments beyond the deadline and ignores stale failure events', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); await store.recordCheckoutSession(order.id, 'cs_test');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'); advance(order);
    mocks.retrieve.mockResolvedValue(session(order, { payment_status: 'unpaid' })); mocks.intent.mockResolvedValue({ status: 'processing' });
    await reconcileReservations(store);
    await processPaymentEvent(store, { id: 'evt_stale', type: 'checkout.session.async_payment_failed', data: { object: { id: 'cs_test' } } });
    expect((await stock(store)).reservedInventory).toBe(1);
    mocks.intent.mockResolvedValue({ status: 'requires_payment_method' }); await reconcileReservations(store);
    expect((await stock(store)).reservedInventory).toBe(0);
  });
  it('retains stock when Stripe is unavailable and exposes a recovery issue', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); await store.recordCheckoutSession(order.id, 'cs_test');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'); advance(order); mocks.retrieve.mockRejectedValue(new Error('network'));
    await reconcileReservations(store);
    expect((await stock(store)).reservedInventory).toBe(1);
    expect((await store.getRecord(`inventory-recovery:${order.id}`))!.data).toMatchObject({ state: 'attention' });
  });
  it('recovers a session whose create response was lost, including later pages', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'); advance(order);
    mocks.list.mockImplementation(async function* () { for (let i = 0; i < 101; i++) yield { metadata: { orderId: 'unrelated' } }; yield session(order); });
    await reconcileReservations(store);
    expect(await store.getOrder(order.id)).toMatchObject({ inventoryState: 'consumed', stripeSessionId: 'cs_test', status: 'paid' });
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
  });
  it('waits through the no-session grace period and then frees an abandoned creation', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    mocks.list.mockImplementation(async function* () {}); advance(order, 1); await reconcileReservations(store);
    expect((await stock(store)).reservedInventory).toBe(1);
    advance(order); await reconcileReservations(store); expect((await stock(store)).reservedInventory).toBe(0);
  });
  it('reconciles payment winning a race with expiration without releasing purchased stock', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input); await store.recordCheckoutSession(order.id, 'cs_test');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'); advance(order);
    mocks.retrieve.mockResolvedValueOnce(session(order, { status: 'open', payment_status: 'unpaid' })).mockResolvedValue(session(order));
    mocks.expire.mockRejectedValue(new Error('already complete'));
    await reconcileReservations(store);
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
    expect((await store.getOrder(order.id))!.status).toBe('paid');
  });
  it('cleans up a migrated hold already deducted by an older paid writer without deducting twice', async () => {
    const store = await lastUnit(); const order = await store.createOrder(input);
    await store.writeProduct({ ...await stock(store), inventory: 0 });
    await store.saveOrder({ ...order, inventoryState: 'legacy_held', status: 'paid', paidAt: new Date().toISOString() });
    await reconcileReservations(store);
    expect(await stock(store)).toMatchObject({ inventory: 0, reservedInventory: 0 });
    expect((await store.getOrder(order.id))!.inventoryState).toBe('consumed');
  });
});
