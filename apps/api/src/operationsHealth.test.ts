import { afterEach, expect, it, vi } from 'vitest';
import { operationsHealth } from './operationsHealth.js';
import { createInMemoryStore } from './store.js';
import { buildServer } from './server.js';
const input = { email: 'private@example.com', customerName: 'Private Buyer', shippingAddress: '123 Secret Street', items: [{ productId: 'p1', quantity: 1 }] };
afterEach(() => vi.unstubAllEnvs());
it('requires server-side admin access and prevents caching health responses', async () => {
  const app = await buildServer(createInMemoryStore(), { adminAuth: { authorize: async value => value === 'Bearer admin' ? { ok: true, email: 'owner@example.com' } : { ok: false, status: value ? 403 : 401, error: 'Denied' } } });
  try {
    expect((await app.inject('/api/admin/operations-health')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/admin/operations-health', headers: { authorization: 'Bearer customer' } })).statusCode).toBe(403);
    const result = await app.inject({ url: '/api/admin/operations-health', headers: { authorization: 'Bearer admin' } });
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toMatchObject({ attentionCount: 0, waitingCount: 0, items: [] });
  } finally { await app.close(); }
});
it('separates normal holds from overdue holds and suppresses stale recovery issues after cancellation', async () => {
  const store = createInMemoryStore(); const order = await store.createOrder(input);
  expect((await operationsHealth(store)).items).toMatchObject([{ status: 'waiting', orderId: order.id }]);
  const later = new Date(order.reservationExpiresAt!).getTime() + 49 * 3600000;
  expect((await operationsHealth(store, later)).attentionCount).toBe(1);
  await store.putRecord({ id: 'inventory-recovery:' + order.id, kind: 'inventory-recovery', orderId: order.id, data: { state: 'attention', errorType: 'secret error' } });
  expect((await operationsHealth(store)).attentionCount).toBe(1);
  await store.cancelOrder(order.id);
  expect((await operationsHealth(store)).items.filter(item => item.category === 'inventory')).toHaveLength(0);
});
it('flags aged unresolved requests but excludes completed and canceled checkouts', async () => {
  const store = createInMemoryStore(); const order = await store.createOrder(input); const now = Date.now();
  await store.putRecord({ id: 'checkout:a', kind: 'checkout', orderId: order.id, data: { startedAt: now - 60000, order } });
  await store.putRecord({ id: 'refund-request:b', kind: 'refund-request', orderId: order.id, data: { startedAt: now - 600000 } });
  let result = await operationsHealth(store, now);
  expect(result.items.find(item => item.id === 'checkout:a')!.status).toBe('waiting');
  expect(result.items.find(item => item.id === 'refund-request:b')!.status).toBe('attention');
  await store.cancelOrder(order.id); result = await operationsHealth(store, now);
  expect(result.items.some(item => item.id === 'checkout:a')).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private@example.com');
});
it('reports email failures without exposing payloads, provider errors or receipt capabilities', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test'); const store = createInMemoryStore();
  await store.putRecord({ id: 'delivery:test', kind: 'delivery', orderId: 'ord_test', data: { state: 'attention', error: 'private@example.com sk_secret receiptToken=private', email: { to: ['private@example.com'], text: '123 Secret Street' } } });
  const result = await operationsHealth(store);
  expect(result.attentionCount).toBe(1); expect(result.items[0].title).toBe('Email requires reconciliation');
  expect(JSON.stringify(result)).not.toMatch(/private@example|sk_secret|receiptToken|Secret Street/);
});
it('shows stock allocation issues and preserves waiting email queues when configured', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test'); const store = createInMemoryStore(); const order = await store.createOrder(input);
  await store.saveOrder({ ...order, inventoryState: 'attention', inventoryIssue: 'Sensitive provider detail', status: 'paid' });
  await store.putRecord({ id: 'delivery:queued', kind: 'delivery', orderId: order.id, data: { state: 'pending' } });
  const result = await operationsHealth(store);
  expect(result).toMatchObject({ attentionCount: 1, waitingCount: 1 });
  expect(JSON.stringify(result)).not.toContain('Sensitive provider detail');
});
