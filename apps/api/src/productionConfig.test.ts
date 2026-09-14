import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertProductionConfig } from './productionConfig.js';
import { createStoreFromEnv } from './storeFactory.js';
import { createCheckoutResponse } from './checkout.js';
import { createOrderRefund } from './stripeRefunds.js';
import { createInMemoryStore } from './store.js';

const valid = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:password@db.example/shop', STRIPE_SECRET_KEY: 'sk_test_configured', STRIPE_WEBHOOK_SECRET: 'whsec_configured', APP_BASE_URL: 'https://shop.example', CLERK_SECRET_KEY: 'sk_test_configured', CLERK_ISSUER_URL: 'https://clerk.shop.example', ADMIN_EMAILS: 'admin@shop.example' };
afterEach(() => vi.unstubAllEnvs());
describe('production startup configuration', () => {
  it('accepts essential runtime configuration, including test-mode services for staging', () => {
    expect(() => assertProductionConfig(valid)).not.toThrow();
    expect(() => assertProductionConfig({ ...valid, CLERK_AUTHORIZED_PARTIES: 'https://shop.example,https://www.shop.example' })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
  it.each(Object.keys(valid).filter((key) => key !== 'NODE_ENV'))('rejects a missing %s without leaking values', (key) => {
    expect(() => assertProductionConfig({ ...valid, [key]: '' })).toThrow(key);
  });
  it.each([
    ['DATABASE_URL', 'sqlite://private-password'], ['STRIPE_SECRET_KEY', 'sk_test_replace_me'],
    ['STRIPE_WEBHOOK_SECRET', 'whsec_placeholder'], ['APP_BASE_URL', 'http://shop.example'],
    ['CLERK_ISSUER_URL', 'https://clerk.shop.example/path'], ['CLERK_SECRET_KEY', 'not-a-key'],
    ['CLERK_AUTHORIZED_PARTIES', 'https://shop.example,'], ['ADMIN_EMAILS', 'not-an-email-address']
  ])('rejects invalid %s', (key, value) => {
    try { assertProductionConfig({ ...valid, [key]: value }); throw new Error('Unexpected success'); }
    catch (error) { expect((error as Error).message).toContain(key); expect((error as Error).message).not.toContain(value); }
  });
  it('cannot silently select in-memory storage in production', async () => {
    await expect(createStoreFromEnv({ NODE_ENV: 'production' })).rejects.toThrow('DATABASE_URL');
    const { store } = await createStoreFromEnv({ NODE_ENV: 'development' });
    expect((await store.listProducts()).length).toBeGreaterThan(0);
  });
  it.each(['', 'sk_test_replace_me', 'not-a-key'])('cannot simulate production checkout or refunds with key %j', async (key) => {
    const store = createInMemoryStore();
    const order = await store.createOrder({ email: 'buyer@example.com', customerName: 'Buyer', shippingAddress: 'Test', items: [{ productId: 'p1', quantity: 1 }] });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_SECRET_KEY', key);
    await expect(createCheckoutResponse(order, 'receipt-token')).rejects.toThrow('STRIPE_SECRET_KEY');
    await expect(createOrderRefund(order)).rejects.toThrow('STRIPE_SECRET_KEY');
  });
  it('retains explicit development checkout and refund simulation', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const order = await createInMemoryStore().createOrder({ email: 'buyer@example.com', customerName: 'Buyer', shippingAddress: 'Test', items: [{ productId: 'p1', quantity: 1 }] });
    expect((await createCheckoutResponse(order, 'token')).checkoutUrl).toContain('/checkout/success');
    expect((await createOrderRefund(order)).refundId).toMatch(/^re_demo_/);
  });
  it('the actual startup entry point fails before opening the database or listening', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    await expect(import('./index.js')).rejects.toThrow('Production configuration missing or invalid: DATABASE_URL');
  });
});
