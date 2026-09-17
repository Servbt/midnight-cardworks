import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaStore, seedPrismaProducts } from './prismaStore.js';
import { processPaymentEvent, startCheckout } from './paymentService.js';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/midnight_payment_test') throw new Error('Payment integration tests require the isolated local midnight_payment_test database');
}
const clients: PrismaClient[] = [];
const connect = () => { const p = new PrismaClient({ datasourceUrl: url! }); clients.push(p); return p; };
afterAll(async () => { await Promise.all(clients.map(p => p.$disconnect())); vi.unstubAllEnvs(); });
const input = { email: 'buyer@example.com', customerName: 'Buyer', shippingAddress: '123 Main Street', items: [{ productId: 'p1', quantity: 1 }] };
const paidEvent = (id: string, orderId: string) => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test', metadata: { orderId }, status: 'complete', payment_status: 'paid', currency: 'usd', amount_subtotal: 1798, amount_total: 1598, total_details: { amount_discount: 200 }, payment_intent: 'pi_test' } } });

describe.skipIf(!url)('payment transactions on PostgreSQL', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('STRIPE_SECRET_KEY', '');
    const prisma = connect();
    await prisma.paymentJournal.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany(); await prisma.product.deleteMany();
    await seedPrismaProducts(prisma);
  });
  it('serializes two independent clients and persists deduplication across reconnects', async () => {
    const a = createPrismaStore(connect()); const b = createPrismaStore(connect());
    const order = await a.createOrder(input);
    await Promise.all(Array.from({ length: 8 }, (_, i) => processPaymentEvent(i % 2 ? a : b, paidEvent(`evt_${i % 3}`, order.id))));
    await b.markOrderFulfilled(order.id);
    const restarted = createPrismaStore(connect());
    await processPaymentEvent(restarted, paidEvent('evt_replay', order.id));
    expect(await restarted.getOrder(order.id)).toMatchObject({ status: 'fulfilled', total: 1598, discountAmount: 200 });
    expect((await restarted.getProduct('golden-hour-commander-proxy'))!.inventory).toBe(19);
    expect((await restarted.listRecords('notification')).filter(r => r.id.includes(':Paid:'))).toHaveLength(1);
    expect(await restarted.listRecords('event')).toHaveLength(4);
  });
  it('atomically rolls back the event, order and inventory if queue persistence fails', async () => {
    const store = createPrismaStore(connect()); const order = await store.createOrder(input);
    const atomic = store.atomic;
    store.atomic = work => atomic(tx => {
      const put = tx.putRecord;
      tx.putRecord = async record => { if (record.kind === 'notification') throw new Error('simulated write failure'); return put(record); };
      return work(tx);
    });
    await expect(processPaymentEvent(store, paidEvent('evt_retry', order.id))).rejects.toThrow('simulated write failure');
    expect((await store.getOrder(order.id))!.status).toBe('pending_payment');
    expect((await store.getProduct('golden-hour-commander-proxy'))!.inventory).toBe(20);
    expect(await store.getRecord('event:evt_retry')).toBeUndefined();
    store.atomic = atomic;
    await processPaymentEvent(store, paidEvent('evt_retry', order.id));
    expect((await store.getOrder(order.id))!.status).toBe('paid');
  });
  it('uses one checkout order and receipt after concurrent starts and a process restart', async () => {
    const a = createPrismaStore(connect()); const b = createPrismaStore(connect()); const key = 'x'.repeat(43);
    const results = await Promise.all([startCheckout(a, input, key), startCheckout(b, input, key)]);
    expect(results[0]).toEqual(results[1]); expect(await a.listOrders()).toHaveLength(1);
    expect(await startCheckout(createPrismaStore(connect()), input, key)).toEqual(results[0]);
  });
  it('serializes different partial refunds and ignores older refund and payment replays', async () => {
    const a = createPrismaStore(connect()); const b = createPrismaStore(connect()); const order = await a.createOrder(input);
    await processPaymentEvent(a, paidEvent('evt_paid', order.id));
    await Promise.all([a.markOrderRefunded(order.id, { refundId: 're_one', amount: 500 }), b.markOrderRefunded(order.id, { refundId: 're_two', amount: 1098 })]);
    await a.markOrderRefundPending(order.id, { refundId: 're_one', amount: 500 });
    await processPaymentEvent(b, paidEvent('evt_again', order.id));
    expect(await a.getOrder(order.id)).toMatchObject({ status: 'refunded', refundedAmount: 1598 });
    expect(await b.listRecords('refund')).toHaveLength(2);
  });
  it('upgrades historical paid, fulfilled and refunded rows while preserving old refund totals', async () => {
    const prisma = connect();
    const migration = await readFile(new URL('../prisma/migrations/20260917000000_payment_reliability/migration.sql', import.meta.url), 'utf8');
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE SCHEMA payment_upgrade_test');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO payment_upgrade_test');
      await tx.$executeRawUnsafe(`CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "status" TEXT, "createdAt" TIMESTAMP DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(), "refundedAmount" INTEGER DEFAULT 0, "stripeRefundId" TEXT)`);
      await tx.$executeRawUnsafe(`INSERT INTO "Order" ("id", "status", "refundedAmount", "stripeRefundId") VALUES ('legacy_paid', 'paid', 0, NULL), ('legacy_fulfilled', 'fulfilled', 0, NULL), ('legacy_refund', 'partially_refunded', 700, 're_old'), ('pending', 'pending_payment', 0, NULL)`);
      for (const statement of migration.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; paidAt: Date | null; fulfilledAt: Date | null }>>('SELECT * FROM "Order" ORDER BY "id"');
      expect(rows.filter(r => r.paidAt)).toHaveLength(3);
      expect(rows.find(r => r.id === 'legacy_fulfilled')!.fulfilledAt).not.toBeNull();
      const records = await tx.$queryRawUnsafe<Array<{ data: unknown }>>('SELECT * FROM "PaymentJournal"');
      expect(records).toHaveLength(1); expect(records[0].data).toMatchObject({ amount: 700, lastRefundId: 're_old', migratedAt: expect.any(Number) });
      await tx.$executeRawUnsafe('DROP SCHEMA payment_upgrade_test CASCADE');
    });
  });
});
