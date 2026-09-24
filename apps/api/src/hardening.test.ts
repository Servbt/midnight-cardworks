import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';
import { hashReceiptToken, receiptExpiryFrom } from './orderAccess.js';

const stripeMock = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        retrieve: vi.fn(async (id: string) => ({
          id, payment_status: 'paid', status: 'complete', payment_intent: 'pi_hardening',
          metadata: { orderId: '' }, currency: 'usd', amount_total: 1798, amount_subtotal: 1798,
          total_details: { amount_discount: 0 }, ...stripeMock.session
        }))
      }
    };
  }
}));

const shippingAddressFields = { streetAddress: '123 Midnight Lane', apartment: '', city: 'Los Angeles', zipCode: '90001' };
const checkoutPayload = (quantity = 1) => ({
  email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddressFields,
  items: [{ productId: 'p1', quantity }]
});
const checkoutHeaders = { 'idempotency-key': 'hardening-checkout-key-0000000000' };
const receiptToken = (char: string) => char.repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
  stripeMock.session = {};
});

describe('launch hardening', () => {
  describe('crawlable storefront files', () => {
    it('serves robots.txt as plain text instead of the SPA shell', async () => {
      const app = await buildServer(createInMemoryStore());
      const response = await app.inject({ method: 'GET', url: '/robots.txt' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('User-agent: *');
      expect(response.body).toContain('Sitemap:');
      expect(response.body).toContain('Disallow: /admin');
    });

    it('serves a sitemap that lists real product pages', async () => {
      const app = await buildServer(createInMemoryStore());
      const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('xml');
      expect(response.body).toContain('<urlset');
      expect(response.body).toContain('/products/golden-hour-commander-proxy');
    });

    it('emits absolute canonical and og:url values when APP_BASE_URL is configured', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://servbotshop.com');
      const staticRoot = await mkdtemp(path.join(tmpdir(), 'midnight-hardening-'));
      await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><html><head><title>Midnight Cardworks</title></head><body><div id="root"></div></body></html>');

      try {
        const app = await buildServer(createInMemoryStore(), { serveStaticRoot: staticRoot });
        const page = await app.inject({ method: 'GET', url: '/products/golden-hour-commander-proxy' });

        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('rel="canonical" href="https://servbotshop.com/products/golden-hour-commander-proxy"');
        expect(page.body).toContain('property="og:url" content="https://servbotshop.com/products/golden-hour-commander-proxy"');
      } finally {
        await rm(staticRoot, { recursive: true, force: true });
      }
    });
  });

  describe('CORS scoping', () => {
    it('does not reflect an arbitrary origin when the shop origin is configured', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://servbotshop.com');
      const app = await buildServer(createInMemoryStore());

      const hostile = await app.inject({ method: 'GET', url: '/api/products', headers: { origin: 'https://evil.example' } });
      const legit = await app.inject({ method: 'GET', url: '/api/products', headers: { origin: 'https://servbotshop.com' } });

      expect(hostile.headers['access-control-allow-origin']).toBeUndefined();
      expect(legit.headers['access-control-allow-origin']).toBe('https://servbotshop.com');
    });
  });

  describe('receipt link expiry', () => {
    it('rejects an expired receipt token and still serves a live one', async () => {
      const store = createInMemoryStore();
      const app = await buildServer(store);

      const expired = await store.createOrder({
        email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane',
        items: [{ productId: 'p1', quantity: 1 }],
        receiptTokenHash: hashReceiptToken(receiptToken('a')), receiptExpiresAt: new Date(Date.now() - 60_000).toISOString()
      });
      const live = await store.createOrder({
        email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane',
        items: [{ productId: 'p1', quantity: 1 }],
        receiptTokenHash: hashReceiptToken(receiptToken('b')), receiptExpiresAt: receiptExpiryFrom()
      });

      const expiredResponse = await app.inject({ method: 'GET', url: `/api/orders/${expired.id}`, headers: { 'x-receipt-token': receiptToken('a') } });
      const liveResponse = await app.inject({ method: 'GET', url: `/api/orders/${live.id}`, headers: { 'x-receipt-token': receiptToken('b') } });

      expect(expiredResponse.statusCode).toBe(404);
      expect(liveResponse.statusCode).toBe(200);
      expect(liveResponse.json().order.id).toBe(live.id);
    });

    it('sets an expiry on newly created checkout orders', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const store = createInMemoryStore();
      const app = await buildServer(store);

      const response = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload(), headers: checkoutHeaders });
      expect(response.statusCode).toBe(201);

      const order = await store.getOrder(response.json().orderId);
      expect(order?.receiptExpiresAt).toBeDefined();
      expect(new Date(order!.receiptExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Stripe webhook resilience', () => {
    it('acknowledges an unreconcilable event and records it instead of asking Stripe to retry forever', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_hardening');
      const store = createInMemoryStore();
      const app = await buildServer(store);
      const order = await store.createOrder({
        email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane',
        items: [{ productId: 'p1', quantity: 1 }]
      });
      // A subscription-mode session can never belong to this payment order, so the event is
      // permanently unreconcilable.
      stripeMock.session = { mode: 'subscription', metadata: { orderId: order.id }, status: 'complete', payment_status: 'paid' };

      const response = await app.inject({
        method: 'POST', url: '/api/stripe/webhook',
        payload: { id: 'evt_permanent', type: 'checkout.session.completed', data: { object: { id: 'cs_hardening' } } }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().quarantined).toBe(true);
      const recorded = await store.getRecord('event:evt_permanent');
      expect(recorded?.data).toMatchObject({ outcome: 'quarantined' });
    });

    it('records unhandled event types so they are auditable and not reprocessed', async () => {
      const store = createInMemoryStore();
      const app = await buildServer(store);

      const response = await app.inject({
        method: 'POST', url: '/api/stripe/webhook',
        payload: { id: 'evt_unhandled', type: 'customer.created', data: { object: { id: 'cus_1' } } }
      });

      expect(response.statusCode).toBe(200);
      const recorded = await store.getRecord('event:evt_unhandled');
      expect(recorded?.data).toMatchObject({ outcome: 'skipped' });
    });

    it('still asks Stripe to retry a genuinely transient failure', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_hardening');
      const store = createInMemoryStore();
      const app = await buildServer(store);
      // No order matches this metadata, which is a transient condition worth retrying.
      stripeMock.session = { metadata: { orderId: 'ord_missing' }, status: 'complete', payment_status: 'paid' };

      const response = await app.inject({
        method: 'POST', url: '/api/stripe/webhook',
        payload: { id: 'evt_transient', type: 'checkout.session.completed', data: { object: { id: 'cs_missing' } } }
      });

      expect(response.statusCode).toBe(503);
      expect(await store.getRecord('event:evt_transient')).toBeUndefined();
    });
  });

  describe('checkout throttling', () => {
    it('rejects checkout attempts beyond the configured limit', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const store = createInMemoryStore();
      const app = await buildServer(store, { rateLimit: { checkoutMax: 3, globalMax: 1000 } });

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload(), headers: checkoutHeaders });
        statuses.push(response.statusCode);
      }

      expect(statuses.slice(0, 3).every((status) => status === 201)).toBe(true);
      expect(statuses[3]).toBe(429);
    });

    it('leaves checkout unthrottled when rate limiting is not configured for tests', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const app = await buildServer(createInMemoryStore());

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload(), headers: checkoutHeaders });
        statuses.push(response.statusCode);
      }

      expect(statuses.every((status) => status === 201)).toBe(true);
    });
  });
});
