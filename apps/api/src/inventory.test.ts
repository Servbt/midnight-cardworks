import { describe, expect, it } from 'vitest';
import { createInMemoryStore } from './store.js';
import { seedProducts } from './seed.js';
import { buildServer } from './server.js';

const buyer = { email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Synthetic address' };
const cart = (quantity: number) => ({ ...buyer, items: [{ productId: 'p1', quantity }] });

describe('inventory reservations', () => {
  it('rejects payment identifiers belonging to another checkout even on replay', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder(cart(1));
    await store.recordCheckoutSession(order.id, 'cs_original');
    await expect(store.markOrderPaid(order.id, { stripeSessionId: 'cs_other' })).rejects.toThrow('session does not match');
    expect(order.status).toBe('pending_payment');
    await store.markOrderPaid(order.id, { stripeSessionId: 'cs_original', stripePaymentIntentId: 'pi_original' });
    await store.markOrderFulfilled(order.id);
    await expect(store.markOrderPaid(order.id, { stripePaymentIntentId: 'pi_other' })).rejects.toThrow('intent does not match');
    expect(order.status).toBe('fulfilled');
    expect((await store.listProducts())[0].inventory).toBe(19);
  });

  it('refuses fulfillment of unpaid, canceled, and refunded orders', async () => {
    const store = createInMemoryStore();
    const pending = await store.createOrder(cart(1));
    await expect(store.markOrderFulfilled(pending.id)).rejects.toThrow('Only paid');
    await store.cancelOrder(pending.id);
    await expect(store.markOrderFulfilled(pending.id)).rejects.toThrow('Only paid');
    const paid = await store.createOrder(cart(1));
    await store.markOrderPaid(paid.id);
    await store.markOrderRefunded(paid.id, { refundId: 're_example', amount: paid.total });
    await expect(store.markOrderFulfilled(paid.id)).rejects.toThrow('Only paid');
    expect(paid.status).toBe('refunded');
  });
  it('reserves the last unit for only one concurrent buyer', async () => {
    const store = createInMemoryStore([{ ...seedProducts[0], inventory: 1 }]);
    const results = await Promise.allSettled([store.createOrder(cart(1)), store.createOrder(cart(1))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await store.listProducts())[0].inventory).toBe(0);
    expect(await store.listOrders()).toHaveLength(1);
  });

  it.each([0, -1, 1.5, 100, NaN])('rejects invalid quantity %s without changing stock', async (quantity) => {
    const store = createInMemoryStore();
    await expect(store.createOrder(cart(quantity))).rejects.toThrow();
    expect((await store.listProducts())[0].inventory).toBe(20);
    expect(await store.listOrders()).toHaveLength(0);
  });

  it('combines duplicate lines before reserving stock', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder({ ...buyer, items: [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3 }] });
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(5);
    expect((await store.listProducts())[0].inventory).toBe(15);
  });

  it('rejects duplicate lines that exceed stock and rolls back the whole cart', async () => {
    const store = createInMemoryStore();
    await expect(store.createOrder({ ...buyer, items: [{ productId: 'p2', quantity: 1 }, { productId: 'p1', quantity: 15 }, { productId: 'p1', quantity: 10 }] })).rejects.toThrow();
    expect(await store.listProducts()).toEqual(seedProducts);
  });

  it('rejects inactive listings both at checkout and through the public product API', async () => {
    const store = createInMemoryStore([{ ...seedProducts[0], active: false }]);
    await expect(store.createOrder(cart(1))).rejects.toThrow('unavailable');
    const app = buildServer(store);
    expect((await app.inject(`/api/products/${seedProducts[0].slug}`)).statusCode).toBe(404);
    await app.close();
  });

  it('consumes a reservation once and preserves fulfilled state on payment replay', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder(cart(2));
    expect((await store.listProducts())[0].inventory).toBe(18);
    await store.markOrderPaid(order.id);
    await store.markOrderFulfilled(order.id);
    await store.markOrderPaid(order.id);
    expect((await store.getOrder(order.id))?.status).toBe('fulfilled');
    expect((await store.listProducts())[0].inventory).toBe(18);
  });

  it('releases a canceled reservation only once and refuses later payment', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder(cart(2));
    await Promise.all([store.cancelOrder(order.id), store.cancelOrder(order.id)]);
    expect((await store.listProducts())[0].inventory).toBe(20);
    await expect(store.markOrderPaid(order.id)).rejects.toThrow('Canceled');
  });

  it('does not return stock when cancellation loses to payment', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder(cart(2));
    await store.markOrderPaid(order.id);
    await expect(store.cancelOrder(order.id)).rejects.toThrow('Only pending');
    expect((await store.listProducts())[0].inventory).toBe(18);
  });

  it('saves a stable Stripe request and reservation deadline before payment creation', async () => {
    const store = createInMemoryStore();
    const order = await store.createOrder({ ...cart(1), useStripe: true, checkoutBaseUrl: 'https://shop.example.test' });
    const request = JSON.parse(order.checkoutRequestJson!);
    expect(request.metadata.orderId).toBe(order.id);
    expect(request.expires_at).toBe(Math.floor(new Date(order.reservationExpiresAt!).getTime() / 1000));
    expect(request.success_url).toContain('https://shop.example.test/checkout/success');
  });
});
