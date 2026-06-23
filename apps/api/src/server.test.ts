import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import { createInMemoryStore } from './store.js';

const stripeMock = vi.hoisted(() => ({ paymentStatus: 'paid', sessionStatus: 'complete', paymentIntentId: 'pi_synced' }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = {
      sessions: {
        retrieve: vi.fn(async (id: string) => ({
          id,
          payment_status: stripeMock.paymentStatus,
          status: stripeMock.sessionStatus,
          payment_intent: stripeMock.paymentIntentId
        }))
      }
    };
  }
}));

const adminAuth = {
  authorize: async (authorization: string | undefined) => {
    if (!authorization) return { ok: false as const, status: 401 as const, error: 'Admin sign-in required' };
    if (authorization === 'Bearer admin-token') return { ok: true as const, email: 'owner@example.com' };
    return { ok: false as const, status: 403 as const, error: 'Admin access required' };
  }
};
const adminHeaders = { authorization: 'Bearer admin-token' };
const customerAuth = {
  authorize: async (authorization: string | undefined) => {
    if (!authorization) return { ok: false as const, status: 401 as const, error: 'Customer sign-in required' };
    if (authorization === 'Bearer buyer-token') return { ok: true as const, email: 'buyer@example.com' };
    return { ok: false as const, status: 401 as const, error: 'Invalid customer session' };
  }
};
const customerHeaders = { authorization: 'Bearer buyer-token' };
const shippingAddressFields = { streetAddress: '123 Midnight Lane', apartment: '', city: 'Los Angeles', zipCode: '90001' };
function checkoutPayload(items: Array<{ productId: string; quantity: number }>, overrides: Record<string, unknown> = {}) {
  return {
    email: 'buyer@example.com',
    customerName: 'Ari Buyer',
    shippingAddressFields,
    items,
    ...overrides
  };
}
function createEmailNotifierSpy() {
  const sent: Array<{ type: string; order?: { id: string; email: string; status: string }; message?: { name: string; email: string; orderNumber?: string; message: string }; subscriber?: { email: string; status: string; couponCode: string }; campaign?: { subject: string; message: string } }> = [];
  return {
    sent,
    notifier: {
      sendOrderPending: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'pending', order }); },
      sendOrderPaid: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'paid', order }); },
      sendOrderFulfilled: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'fulfilled', order }); },
      sendOrderCanceled: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'canceled', order }); },
      sendOrderRefunded: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'refunded', order }); },
      sendOrderRefundFailed: async (order: { id: string; email: string; status: string }) => { sent.push({ type: 'refund_failed', order }); },
      sendContactMessage: async (message: { name: string; email: string; orderNumber?: string; message: string }) => { sent.push({ type: 'contact', message }); },
      sendMarketingWelcome: async (subscriber: { email: string; status: string; couponCode: string }) => { sent.push({ type: 'marketing_welcome', subscriber }); },
      sendMarketingCampaign: async (subscriber: { email: string; status: string; couponCode: string }, campaign: { subject: string; message: string }) => { sent.push({ type: 'marketing_campaign', subscriber, campaign }); }
    }
  };
}

describe('storefront API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    stripeMock.paymentStatus = 'paid';
    stripeMock.sessionStatus = 'complete';
    stripeMock.paymentIntentId = 'pi_synced';
  });

  it('lists active products for the shop grid', async () => {
    const app = buildServer(createInMemoryStore());
    const res = await app.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.products.length).toBeGreaterThan(2);
    expect(body.products[0]).toHaveProperty('price');
  });

  it('serves public FAQ and blog content', async () => {
    const app = buildServer(createInMemoryStore());

    const faqs = await app.inject({ method: 'GET', url: '/api/content/faqs' });
    const posts = await app.inject({ method: 'GET', url: '/api/content/blog-posts' });
    const post = await app.inject({ method: 'GET', url: '/api/content/blog-posts/first-drop-notes' });

    expect(faqs.statusCode).toBe(200);
    expect(faqs.json().faqItems[0]).toMatchObject({ active: true, question: 'Are these tournament legal?' });
    expect(posts.statusCode).toBe(200);
    expect(posts.json().blogPosts[0]).toMatchObject({ slug: 'first-drop-notes', published: true });
    expect(post.statusCode).toBe(200);
    expect(post.json().post).toMatchObject({ slug: 'first-drop-notes', title: 'First Drop Notes' });
  });

  it('lets admins manage FAQ and blog content', async () => {
    const app = buildServer(createInMemoryStore(), { adminAuth });

    const content = await app.inject({ method: 'GET', url: '/api/admin/content', headers: adminHeaders });
    const faq = await app.inject({
      method: 'POST',
      url: '/api/admin/content/faqs',
      headers: adminHeaders,
      payload: { question: 'Do you ship internationally?', answer: 'Message first so the studio can quote shipping accurately.', sortOrder: 5, active: true }
    });
    const blog = await app.inject({
      method: 'POST',
      url: '/api/admin/content/blog-posts',
      headers: adminHeaders,
      payload: { slug: 'new-drop-preview', title: 'New Drop Preview', excerpt: 'A small preview of the next drop.', body: 'New commander proxies are being photographed this week.', published: true }
    });
    const publicFaqs = await app.inject({ method: 'GET', url: '/api/content/faqs' });
    const publicPost = await app.inject({ method: 'GET', url: '/api/content/blog-posts/new-drop-preview' });

    expect(content.statusCode).toBe(200);
    expect(content.json().faqItems.length).toBeGreaterThan(0);
    expect(content.json().blogPosts.length).toBeGreaterThan(0);
    expect(faq.statusCode).toBe(200);
    expect(faq.json().faqItem).toMatchObject({ question: 'Do you ship internationally?', active: true });
    expect(blog.statusCode).toBe(200);
    expect(blog.json().blogPost).toMatchObject({ slug: 'new-drop-preview', published: true });
    expect(publicFaqs.json().faqItems.map((item: { question: string }) => item.question)).toContain('Do you ship internationally?');
    expect(publicPost.json().post).toMatchObject({ slug: 'new-drop-preview', title: 'New Drop Preview' });
  });

  it('creates a checkout order from cart items with customer, shipping details, and separate shipping cost', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: checkoutPayload([{ productId: 'p1', quantity: 2 }])
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending_payment', subtotal: 2598, shippingCost: 499, total: 3097 });
    const order = await store.getOrder(res.json().orderId);
    expect(order).toMatchObject({ email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane, Los Angeles 90001', subtotal: 2598, shippingCost: 499, total: 3097 });
  });

  it('emails the shop owner when checkout creates a pending payment order', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { emailNotifier: emailSpy.notifier });

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: checkoutPayload([{ productId: 'p1', quantity: 1 }])
    });

    expect(res.statusCode).toBe(201);
    expect(emailSpy.sent).toEqual([{ type: 'pending', order: expect.objectContaining({ id: res.json().orderId, email: 'buyer@example.com', status: 'pending_payment' }) }]);
  });
  it('rejects checkout orders without required shipping details', async () => {
    const app = buildServer(createInMemoryStore());

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: { email: 'buyer@example.com', items: [{ productId: 'p1', quantity: 1 }] }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid checkout payload' });
  });

  it('uses active sale pricing when creating checkout orders', async () => {
    const product = { ...(await createInMemoryStore().getProduct('golden-hour-commander-proxy'))!, saleActive: true, salePrice: 999 };
    const store = createInMemoryStore([product]);
    const app = buildServer(store);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: checkoutPayload([{ productId: 'p1', quantity: 2 }])
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotal: 1998, shippingCost: 499, total: 2497 });
    const order = await store.getOrder(res.json().orderId);
    expect(order?.items[0]).toMatchObject({ title: 'Golden Hour Commander Proxy', quantity: 2, price: 999 });
  });

  it('waives shipping when the cart subtotal reaches the free shipping threshold', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: checkoutPayload([{ productId: 'p1', quantity: 4 }])
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotal: 5196, shippingCost: 0, total: 5196 });
  });

  it('exposes admin order review after checkout', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p2', quantity: 1 }]) });
    const res = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: adminHeaders });
    expect(res.json().orders[0].email).toBe('buyer@example.com');
  });

  it('marks an order paid when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } }
    });

    expect(webhook.statusCode).toBe(200);
    const orders = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: adminHeaders });
    expect(orders.json().orders[0]).toMatchObject({ id: orderId, status: 'paid' });
  });

  it('decrements product inventory once when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 2 }]) });
    const orderId = checkout.json().orderId;

    const webhookPayload = { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } };
    const firstWebhook = await app.inject({ method: 'POST', url: '/api/stripe/webhook', payload: webhookPayload });
    const secondWebhook = await app.inject({ method: 'POST', url: '/api/stripe/webhook', payload: webhookPayload });

    expect(firstWebhook.statusCode).toBe(200);
    expect(secondWebhook.statusCode).toBe(200);
    expect(await store.getProduct('golden-hour-commander-proxy')).toMatchObject({ inventory: 18 });
  });

  it('rejects unsigned Stripe webhooks in production when the webhook secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const app = buildServer(createInMemoryStore(), { adminAuth });

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId: 'ord_test' } } } }
    });

    expect(webhook.statusCode).toBe(400);
    expect(webhook.json()).toEqual({ error: 'Stripe webhook secret is required in production' });
  });

  it('shows a checkout receipt with current order status', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store);
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId);

    const receipt = await app.inject({ method: 'GET', url: `/api/orders/${orderId}` });

    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().order).toMatchObject({ id: orderId, email: 'buyer@example.com', subtotal: 1299, shippingCost: 499, total: 1798, status: 'paid' });
  });

  it('lists customer order history for the signed-in account only', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { customerAuth });
    await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p2', quantity: 1 }], { email: 'other@example.com' }) });

    const history = await app.inject({ method: 'GET', url: '/api/orders', headers: customerHeaders });

    expect(history.statusCode).toBe(200);
    expect(history.json().orders).toHaveLength(1);
    expect(history.json().orders[0]).toMatchObject({ email: 'buyer@example.com', items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] });
  });

  it('blocks anonymous customer order history access', async () => {
    const app = buildServer(createInMemoryStore(), { customerAuth });

    const history = await app.inject({ method: 'GET', url: '/api/orders?email=buyer%40example.com' });

    expect(history.statusCode).toBe(401);
    expect(history.json()).toEqual({ error: 'Customer sign-in required' });
  });

  it('lets admins mark paid orders fulfilled', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId);

    const fulfill = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/fulfill`, headers: adminHeaders });
    const receipt = await app.inject({ method: 'GET', url: `/api/orders/${orderId}` });

    expect(fulfill.statusCode).toBe(200);
    expect(fulfill.json().order).toMatchObject({ id: orderId, status: 'fulfilled' });
    expect(receipt.json().order).toMatchObject({ id: orderId, status: 'fulfilled' });
  });

  it('lets admins sync a paid Stripe Checkout Session for pending orders', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;
    await store.recordCheckoutSession(orderId, 'cs_test_sync');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_sync');

    const sync = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/sync-payment`, headers: adminHeaders });

    expect(sync.statusCode).toBe(200);
    expect(sync.json().order).toMatchObject({ id: orderId, status: 'paid', stripeSessionId: 'cs_test_sync', stripePaymentIntentId: 'pi_synced' });
    expect(sync.json().checkout).toMatchObject({ paid: true, paymentStatus: 'paid' });
    expect(await store.getProduct('golden-hour-commander-proxy')).toMatchObject({ inventory: 19 });
    expect(emailSpy.sent).toEqual([{ type: 'paid', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'paid' }) }]);
  });

  it('does not mark a pending order paid when Stripe still reports unpaid checkout', async () => {
    stripeMock.paymentStatus = 'unpaid';
    stripeMock.sessionStatus = 'open';
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.recordCheckoutSession(orderId, 'cs_test_sync');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_sync');

    const sync = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/sync-payment`, headers: adminHeaders });

    expect(sync.statusCode).toBe(400);
    expect(sync.json()).toEqual({ error: 'Stripe still reports this Checkout Session as unpaid' });
    expect(await store.getOrder(orderId)).toMatchObject({ status: 'pending_payment' });
  });

  it('lets admins cancel pending payment orders without issuing a refund', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;

    const cancel = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/cancel`, headers: adminHeaders, payload: { reason: 'Customer changed their mind before payment' } });

    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().order).toMatchObject({ id: orderId, status: 'canceled', refundReason: 'Customer changed their mind before payment' });
    expect(cancel.json().order.canceledAt).toBeTruthy();
  });

  it('lets admins issue a full refund for paid orders', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId, { stripePaymentIntentId: 'pi_test_123' });

    const refund = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/refund`, headers: adminHeaders, payload: { reason: 'Customer requested cancellation' } });

    expect(refund.statusCode).toBe(200);
    expect(refund.json().order).toMatchObject({ id: orderId, status: 'refunded', refundedAmount: 1798, refundReason: 'Customer requested cancellation' });
    expect(refund.json().refund).toMatchObject({ amount: 1798, status: 'succeeded' });
  });

  it('lets admins issue a partial refund for paid orders', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId, { stripePaymentIntentId: 'pi_test_123' });

    const refund = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/refund`, headers: adminHeaders, payload: { amount: 499, reason: 'Shipping adjustment' } });

    expect(refund.statusCode).toBe(200);
    expect(refund.json().order).toMatchObject({ id: orderId, status: 'partially_refunded', refundedAmount: 499, refundReason: 'Shipping adjustment' });
  });

  it('updates refund state from Stripe refund webhooks', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    await store.markOrderPaid(orderId, { stripePaymentIntentId: 'pi_test_123' });

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'refund.updated', data: { object: { id: 're_test_123', amount: 499, status: 'succeeded', metadata: { orderId, reason: 'Shipping adjustment' } } } }
    });

    expect(webhook.statusCode).toBe(200);
    const order = await store.getOrder(orderId);
    expect(order).toMatchObject({ status: 'partially_refunded', refundedAmount: 499, stripeRefundId: 're_test_123', refundReason: 'Shipping adjustment' });
  });

  it('sends an order confirmation email when Stripe confirms checkout completion', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: { metadata: { orderId } } } }
    });

    expect(webhook.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'paid', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'paid' }) }]);
  });

  it('sends a fulfillment email when admins mark orders fulfilled', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;
    await store.markOrderPaid(orderId);

    const fulfill = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/fulfill`, headers: adminHeaders });

    expect(fulfill.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'fulfilled', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'fulfilled' }) }]);
  });

  it('sends a cancellation email when admins cancel pending payment orders', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;

    const cancel = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/cancel`, headers: adminHeaders, payload: { reason: 'Customer changed their mind before payment' } });

    expect(cancel.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'canceled', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'canceled' }) }]);
  });

  it('sends a refund email when admins issue a successful refund', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;
    await store.markOrderPaid(orderId, { stripePaymentIntentId: 'pi_test_123' });

    const refund = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/refund`, headers: adminHeaders, payload: { reason: 'Customer requested cancellation' } });

    expect(refund.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'refunded', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'refunded' }) }]);
  });

  it('sends a refund failure email when Stripe reports a failed refund', async () => {
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });
    const checkout = await app.inject({ method: 'POST', url: '/api/checkout', payload: checkoutPayload([{ productId: 'p1', quantity: 1 }]) });
    const orderId = checkout.json().orderId;
    emailSpy.sent.length = 0;
    await store.markOrderPaid(orderId, { stripePaymentIntentId: 'pi_test_123' });

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'refund.failed', data: { object: { id: 're_test_123', amount: 1798, status: 'failed', metadata: { orderId, reason: 'Card issuer declined refund' } } } }
    });

    expect(webhook.statusCode).toBe(200);
    expect(emailSpy.sent).toEqual([{ type: 'refund_failed', order: expect.objectContaining({ id: orderId, email: 'buyer@example.com', status: 'refund_failed' }) }]);
  });

  it('emails the shop owner when a customer submits a contact message', async () => {
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(createInMemoryStore(), { emailNotifier: emailSpy.notifier });

    const res = await app.inject({
      method: 'POST',
      url: '/api/contact',
      payload: { name: 'Ari Buyer', email: 'buyer@example.com', orderNumber: 'ord_test', message: 'Can you make this as a foil token?' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(emailSpy.sent).toEqual([{ type: 'contact', message: { name: 'Ari Buyer', email: 'buyer@example.com', orderNumber: 'ord_test', message: 'Can you make this as a foil token?' } }]);
  });

  it('rejects contact messages with invalid email or spam honeypot', async () => {
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(createInMemoryStore(), { emailNotifier: emailSpy.notifier });

    const badEmail = await app.inject({ method: 'POST', url: '/api/contact', payload: { name: 'Ari', email: 'not-email', message: 'Hello there' } });
    const bot = await app.inject({ method: 'POST', url: '/api/contact', payload: { name: 'Ari', email: 'buyer@example.com', message: 'Hello there', website: 'https://spam.example' } });

    expect(badEmail.statusCode).toBe(400);
    expect(bot.statusCode).toBe(400);
    expect(emailSpy.sent).toEqual([]);
  });

  it('stores newsletter subscribers and sends a launch coupon email', async () => {
    vi.stubEnv('NEWSLETTER_COUPON_CODE', 'MIDNIGHT10');
    const store = createInMemoryStore();
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { emailNotifier: emailSpy.notifier });

    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletter',
      payload: { name: 'Ari Buyer', email: 'BUYER@EXAMPLE.COM', marketingConsent: true }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().subscriber).toMatchObject({ email: 'buyer@example.com', name: 'Ari Buyer', status: 'subscribed', couponCode: 'MIDNIGHT10' });
    expect(res.json().subscriber).not.toHaveProperty('unsubscribeToken');
    expect(await store.listMarketingSubscribers()).toHaveLength(1);
    expect(emailSpy.sent).toEqual([{ type: 'marketing_welcome', subscriber: expect.objectContaining({ email: 'buyer@example.com', status: 'subscribed', couponCode: 'MIDNIGHT10' }) }]);
  });

  it('rejects newsletter signups without consent or with spam honeypot data', async () => {
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(createInMemoryStore(), { emailNotifier: emailSpy.notifier });

    const noConsent = await app.inject({ method: 'POST', url: '/api/newsletter', payload: { email: 'buyer@example.com', marketingConsent: false } });
    const bot = await app.inject({ method: 'POST', url: '/api/newsletter', payload: { email: 'buyer@example.com', marketingConsent: true, website: 'https://spam.example' } });

    expect(noConsent.statusCode).toBe(400);
    expect(bot.statusCode).toBe(400);
    expect(emailSpy.sent).toEqual([]);
  });

  it('unsubscribes marketing subscribers by token', async () => {
    const store = createInMemoryStore();
    const signup = await store.subscribeMarketing({ email: 'buyer@example.com', name: 'Ari', source: 'storefront_coupon', couponCode: 'MIDNIGHT10' });
    const app = buildServer(store);

    const res = await app.inject({ method: 'POST', url: '/api/newsletter/unsubscribe', payload: { token: signup.subscriber.unsubscribeToken } });

    expect(res.statusCode).toBe(200);
    expect(res.json().subscriber).toMatchObject({ email: 'buyer@example.com', status: 'unsubscribed' });
    expect(res.json().subscriber).not.toHaveProperty('unsubscribeToken');
    expect((await store.listMarketingSubscribers())[0]).toMatchObject({ email: 'buyer@example.com', status: 'unsubscribed' });
  });

  it('lets admins review subscribers and send campaigns to active subscribers only', async () => {
    const store = createInMemoryStore();
    const active = await store.subscribeMarketing({ email: 'active@example.com', source: 'storefront_coupon', couponCode: 'MIDNIGHT10' });
    const inactive = await store.subscribeMarketing({ email: 'inactive@example.com', source: 'storefront_coupon', couponCode: 'MIDNIGHT10' });
    await store.unsubscribeMarketing(inactive.subscriber.unsubscribeToken);
    const emailSpy = createEmailNotifierSpy();
    const app = buildServer(store, { adminAuth, emailNotifier: emailSpy.notifier });

    const list = await app.inject({ method: 'GET', url: '/api/admin/marketing/subscribers', headers: adminHeaders });
    const campaign = await app.inject({ method: 'POST', url: '/api/admin/marketing/campaigns', headers: adminHeaders, payload: { subject: 'New cards are live', message: 'Fresh card listings are ready in the shop.' } });

    expect(list.statusCode).toBe(200);
    expect(list.json().subscribers).toHaveLength(2);
    expect(list.json().subscribers[0]).not.toHaveProperty('unsubscribeToken');
    expect(campaign.statusCode).toBe(200);
    expect(campaign.json()).toEqual({ sent: 1 });
    expect(emailSpy.sent).toEqual([{ type: 'marketing_campaign', subscriber: expect.objectContaining({ email: active.subscriber.email, status: 'subscribed' }), campaign: { subject: 'New cards are live', message: 'Fresh card listings are ready in the shop.' } }]);
  });

  it('uploads and saves a product image for an admin listing', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, {
      adminAuth,
      uploadImage: async () => ({ url: 'https://images.example.com/golden.jpg' })
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/products/golden-hour-commander-proxy/image',
      headers: adminHeaders,
      payload: { fileName: 'golden.jpg', contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,abc123' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().product).toMatchObject({ slug: 'golden-hour-commander-proxy', image: 'https://images.example.com/golden.jpg' });
    const product = await store.getProduct('golden-hour-commander-proxy');
    expect(product?.image).toBe('https://images.example.com/golden.jpg');
  });

  it('accepts practical product image payload sizes for admin uploads', async () => {
    const app = buildServer(createInMemoryStore(), {
      adminAuth,
      uploadImage: async () => ({ url: 'https://images.example.com/large-golden.jpg' })
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/products/golden-hour-commander-proxy/image',
      headers: adminHeaders,
      payload: { fileName: 'large-golden.jpg', contentType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${'a'.repeat(2_000_000)}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().product.image).toBe('https://images.example.com/large-golden.jpg');
  });

  it('creates and updates admin products while keeping inactive products out of the storefront', async () => {
    const store = createInMemoryStore();
    const app = buildServer(store, { adminAuth });

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: adminHeaders,
      payload: {
        slug: 'secret-drop',
        title: 'Secret Drop Proxy',
        description: 'Hidden draft listing',
        price: 1599,
        category: 'Commander',
        tags: ['draft', 'commander'],
        image: 'https://images.example.com/secret.jpg',
        inventory: 4,
        active: false
      }
    });
    const shop = await app.inject({ method: 'GET', url: '/api/products' });
    const adminProducts = await app.inject({ method: 'GET', url: '/api/admin/products', headers: adminHeaders });
    const update = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: adminHeaders,
      payload: {
        slug: 'secret-drop',
        title: 'Secret Drop Proxy Updated',
        description: 'Live listing',
        price: 1699,
        category: 'Commander',
        tags: ['commander'],
        image: 'https://images.example.com/secret.jpg',
        inventory: 7,
        active: true
      }
    });

    expect(create.statusCode).toBe(200);
    expect(create.json().product).toMatchObject({ slug: 'secret-drop', active: false });
    expect(shop.json().products.map((product: { slug: string }) => product.slug)).not.toContain('secret-drop');
    expect(adminProducts.json().products.map((product: { slug: string }) => product.slug)).toContain('secret-drop');
    expect(update.json().product).toMatchObject({ slug: 'secret-drop', title: 'Secret Drop Proxy Updated', price: 1699, inventory: 7, active: true });
  });

  it('blocks anonymous and non-admin access to admin orders', async () => {
    const app = buildServer(createInMemoryStore(), { adminAuth });

    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/orders' });
    const nonAdmin = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: { authorization: 'Bearer customer-token' } });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: 'Admin sign-in required' });
    expect(nonAdmin.statusCode).toBe(403);
    expect(nonAdmin.json()).toEqual({ error: 'Admin access required' });
  });

  it('serves product routes with SEO meta tags for shareable listing pages', async () => {
    const staticRoot = await mkdtemp(path.join(tmpdir(), 'midnight-cardworks-web-'));
    await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><html><head><title>Midnight Cardworks</title></head><body><div id="root"></div></body></html>');

    try {
      const app = buildServer(createInMemoryStore(), { serveStaticRoot: staticRoot });
      const productPage = await app.inject({ method: 'GET', url: '/products/golden-hour-commander-proxy' });

      expect(productPage.statusCode).toBe(200);
      expect(productPage.headers['content-type']).toContain('text/html');
      expect(productPage.body).toContain('<title>Golden Hour Commander Proxy | Midnight Cardworks</title>');
      expect(productPage.body).toContain('property="og:title" content="Golden Hour Commander Proxy"');
      expect(productPage.body).toContain('property="og:url" content="/products/golden-hour-commander-proxy"');
      expect(productPage.body).toContain('type="application/ld+json"');
    } finally {
      await rm(staticRoot, { recursive: true, force: true });
    }
  });

  it('serves the built React app and keeps API 404s as JSON in production mode', async () => {
    const staticRoot = await mkdtemp(path.join(tmpdir(), 'midnight-cardworks-web-'));
    await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Midnight Cardworks</title><div id="root"></div>');

    try {
      const app = buildServer(createInMemoryStore(), { serveStaticRoot: staticRoot });
      const home = await app.inject({ method: 'GET', url: '/' });
      const clientRoute = await app.inject({ method: 'GET', url: '/account' });
      const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

      expect(home.statusCode).toBe(200);
      expect(home.headers['content-type']).toContain('text/html');
      expect(home.body).toContain('Midnight Cardworks');
      expect(clientRoute.statusCode).toBe(200);
      expect(clientRoute.body).toContain('Midnight Cardworks');
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.json()).toEqual({ error: 'Not found' });
    } finally {
      await rm(staticRoot, { recursive: true, force: true });
    }
  });
});
