import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPrismaStore, seedPrismaProducts } from './prismaStore.js';
import { seedProducts } from './seed.js';
import { newReceiptToken, hashReceiptToken } from './receiptAccess.js';
import { deliverOrderNotifications } from './orderNotifications.js';
import { createEmailNotifierFromEnv } from './emailNotifications.js';

// Opt-in only. Never fall back to DATABASE_URL or a deployed database.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_audit')) {
    throw new Error('TEST_DATABASE_URL must name a localhost database ending in _audit');
  }
}
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl ?? 'postgresql://unused@127.0.0.1/unused_audit' } } });
const productIds: string[] = [];
const store = createPrismaStore(prisma);
const buyer = { email: 'buyer@example.test', customerName: 'Buyer', shippingAddress: 'Synthetic address' };

afterEach(async () => {
  if (!productIds.length) return;
  // Delete only records created by this suite, even in the disposable database.
  await prisma.order.deleteMany({ where: { items: { some: { productId: { in: productIds } } } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds.splice(0) } } });
});
afterAll(() => prisma.$disconnect());

async function product(inventory: number, suffix = '') {
  const id = `audit-${randomUUID()}${suffix}`;
  productIds.push(id);
  return prisma.product.create({ data: { ...seedProducts[0], id, slug: id, inventory } });
}

describe.skipIf(!databaseUrl)('PostgreSQL reservation transactions', () => {
  it('retrieves each refund snapshot only after preceding sync commits', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await store.markOrderPaid(order.id);
    const id = 're_' + randomUUID();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = store.syncRefund(order.id, async () => {
      entered();
      await gate;
      return { id, orderId: order.id, amount: 100, status: 'succeeded' };
    });
    await started;
    const second = store.syncRefund(order.id, async (current) => {
      expect(current.refundedAmount).toBe(100);
      return { id, orderId: order.id, amount: 100, status: 'failed' };
    });
    release();
    await Promise.all([first, second]);
    expect(await store.getOrder(order.id)).toMatchObject({ refundedAmount: 0, status: 'refund_failed' });
  });
  it('atomically replaces historical totals and suppresses historical email replays', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await store.markOrderPaid(order.id);
    await deliverOrderNotifications(store, createEmailNotifierFromEnv(), order.id);
    await prisma.order.update({ where: { id: order.id }, data: { refundReconciliationRequired: true, status: 'refunded', refundedAmount: 900 } });
    const id = 're_' + randomUUID();
    await expect(store.reconcileHistoricalRefunds(order.id, [{ id, orderId: order.id, amount: order.total + 1, status: 'succeeded' }])).rejects.toThrow('exceeds');
    expect((await store.getOrder(order.id))?.refundedAmount).toBe(900);
    expect(await prisma.orderRefund.count({ where: { orderId: order.id } })).toBe(0);
    await store.reconcileHistoricalRefunds(order.id, [{ id, orderId: order.id, amount: 100, status: 'succeeded' }]);
    expect(await store.getOrder(order.id)).toMatchObject({ refundedAmount: 100, status: 'partially_refunded', refundReconciliationRequired: false });
    await store.markOrderRefunded(order.id, { refundId: id, amount: 100 });
    expect(await store.pendingNotifications(order.id)).toEqual([]);
  });
  it('counts concurrent A/B/A refund deliveries once and preserves successful entries on stale pending updates', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await store.markOrderPaid(order.id);
    const a = 're_' + randomUUID();
    const b = 're_' + randomUUID();
    await store.markOrderRefundPending(order.id, { refundId: a, amount: 100 });
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.markOrderRefunded(order.id, { refundId: index % 2 ? a : b, amount: index % 2 ? 100 : 200 })));
    await store.markOrderRefundPending(order.id, { refundId: a, amount: 100 });
    expect((await store.getOrder(order.id))?.refundedAmount).toBe(300);
    expect(await prisma.orderRefund.count({ where: { orderId: order.id } })).toBe(2);
    expect(await prisma.orderNotification.count({ where: { orderId: order.id, id: { startsWith: 'refunded:' } } })).toBe(2);
    await store.markOrderRefundFailed(order.id, { refundId: b });
    expect((await store.getOrder(order.id))?.refundedAmount).toBe(100);
    await expect(store.markOrderRefunded(order.id, { refundId: a, amount: 101 })).rejects.toThrow('cannot change');
    expect((await store.getOrder(order.id))?.refundedAmount).toBe(100);
  });

  it('rejects historical refund updates and global refund ID ownership conflicts', async () => {
    const p = await product(5);
    const orders = await Promise.all(Array.from({ length: 2 }, () => store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] })));
    await Promise.all(orders.map((order) => store.markOrderPaid(order.id)));
    const refundId = 're_' + randomUUID();
    await store.markOrderRefunded(orders[0].id, { refundId, amount: 100 });
    await expect(store.markOrderRefunded(orders[1].id, { refundId, amount: 100 })).rejects.toThrow('another order');
    await prisma.order.update({ where: { id: orders[1].id }, data: { refundReconciliationRequired: true } });
    await expect(store.markOrderRefunded(orders[1].id, { refundId: 're_' + randomUUID(), amount: 100 })).rejects.toThrow('reconciliation');
    expect(await prisma.orderRefund.count({ where: { orderId: orders[1].id } })).toBe(0);
  });
  it('commits one durable notification and gives only one concurrent worker its lease', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await Promise.all(Array.from({ length: 8 }, () => store.markOrderPaid(order.id)));
    expect(await store.pendingNotifications(order.id)).toEqual([{ id: 'paid:' + order.id }]);
    let sends = 0;
    const notifier = { ...createEmailNotifierFromEnv(), async sendOrderPaid() { sends++; } };
    await Promise.all(Array.from({ length: 8 }, () => deliverOrderNotifications(store, notifier, order.id)));
    expect(sends).toBe(1);
    await store.markOrderFulfilled(order.id);
    await store.markOrderPaid(order.id);
    expect(await store.pendingNotifications(order.id)).toEqual([]);
    expect(await prisma.orderNotification.count({ where: { orderId: order.id } })).toBe(1);
  });
  it('binds payment identifiers and guards fulfillment in the database adapter', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await store.recordCheckoutSession(order.id, 'cs_original');
    await expect(store.markOrderFulfilled(order.id)).rejects.toThrow('Only paid');
    await expect(store.markOrderPaid(order.id, { stripeSessionId: 'cs_other' })).rejects.toThrow('session does not match');
    await store.markOrderPaid(order.id, { stripeSessionId: 'cs_original', stripePaymentIntentId: 'pi_original' });
    await store.markOrderFulfilled(order.id);
    await expect(store.markOrderPaid(order.id, { stripePaymentIntentId: 'pi_other' })).rejects.toThrow('intent does not match');
    expect((await store.getOrder(order.id))?.status).toBe('fulfilled');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(4);
    const canceled = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] });
    await store.cancelOrder(canceled.id);
    await expect(store.markOrderPaid(canceled.id)).rejects.toThrow('Canceled');
    await expect(store.markOrderFulfilled(canceled.id)).rejects.toThrow('Only paid');
  });
  it('accepts exactly three concurrent purchases for three available units', async () => {
    const p = await product(3);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(0);
    expect(await prisma.order.count({ where: { items: { some: { productId: p.id } } } })).toBe(3);
  });

  it('rolls back all earlier stock changes when a later item is unavailable', async () => {
    const products = [await product(5), await product(5)].sort((a, b) => a.id.localeCompare(b.id));
    await prisma.product.update({ where: { id: products[1].id }, data: { inventory: 0 } });
    await expect(store.createOrder({ ...buyer, items: products.map((p) => ({ productId: p.id, quantity: 1 })) })).rejects.toThrow('unavailable');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: products[0].id } })).inventory).toBe(5);
    expect(await prisma.order.count({ where: { items: { some: { productId: products[0].id } } } })).toBe(0);
  });

  it('combines duplicate rows and rejects inactive products in the database adapter', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 2 }, { productId: p.id, quantity: 2 }] });
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(4);
    await prisma.product.update({ where: { id: p.id }, data: { active: false } });
    await expect(store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 1 }] })).rejects.toThrow('unavailable');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(1);
  });

  it('releases canceled stock once under concurrent retries', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 2 }] });
    await Promise.all(Array.from({ length: 8 }, () => store.cancelOrder(order.id)));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(5);
    expect((await store.getOrder(order.id))?.inventoryReserved).toBe(false);
  });

  it('does not deduct reserved stock again under concurrent payment retries', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 2 }] });
    await Promise.all(Array.from({ length: 8 }, () => store.markOrderPaid(order.id)));
    await store.markOrderFulfilled(order.id);
    await store.markOrderPaid(order.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(3);
    expect((await store.getOrder(order.id))?.status).toBe('fulfilled');
  });

  it('keeps stock consistent when payment and cancellation race', async () => {
    const p = await product(5);
    const order = await store.createOrder({ ...buyer, items: [{ productId: p.id, quantity: 2 }] });
    await Promise.allSettled([store.markOrderPaid(order.id), store.cancelOrder(order.id)]);
    const current = await store.getOrder(order.id);
    expect(['paid', 'canceled']).toContain(current?.status);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(current?.status === 'paid' ? 3 : 5);
  });

  it('preserves edited and renamed seed products across repeated database startup', async () => {
    const p = await product(5);
    const edited = { title: 'Edited', price: 9999, inventory: 0, active: false, image: 'https://example.test/edited.png', slug: `${p.slug}-renamed` };
    await prisma.product.update({ where: { id: p.id }, data: edited });
    await Promise.all([seedPrismaProducts(prisma, [p]), seedPrismaProducts(prisma, [p])]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject(edited);
    expect(await prisma.product.count({ where: { slug: p.slug } })).toBe(0);
  });

  it('persists only the receipt hash and finds account orders regardless of email casing', async () => {
    const p = await product(5);
    const token = newReceiptToken();
    const order = await store.createOrder({ ...buyer, email: 'BUYER@example.test', receiptTokenHash: hashReceiptToken(token), items: [{ productId: p.id, quantity: 1 }] });
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.receiptTokenHash).toBe(hashReceiptToken(token));
    expect(JSON.stringify(saved)).not.toContain(token);
    expect((await store.listOrdersByEmail('buyer@example.test')).map((entry) => entry.id)).toContain(order.id);
  });
});
