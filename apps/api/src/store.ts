import { nanoid } from 'nanoid';
import type { BlogPost, BlogPostInput, FaqItem, FaqItemInput, MarketingSubscriber, MarketingSubscribeInput, Order, Product, Store } from './types.js';
import { seedBlogPosts, seedFaqItems, seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';
import { checkoutItems, reservationDurationMs } from './inventory.js';
import { checkoutRequest } from './checkoutRequest.js';
import { publicOrder } from './receiptAccess.js';
import { refundLedgerUpdate, reconciledRefundLedger, type RefundEntry, type RefundUpdate } from './refundLedger.js';

function now() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function createMarketingSubscriber(input: MarketingSubscribeInput): MarketingSubscriber {
  const timestamp = now();
  return {
    id: 'sub_' + nanoid(8),
    email: normalizeEmail(input.email),
    name: input.name?.trim() || undefined,
    status: 'subscribed',
    source: input.source,
    couponCode: input.couponCode,
    unsubscribeToken: nanoid(32),
    consentedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function decrementInventoryForOrder(products: Map<string, Product>, order: Order) {
  const quantitiesByProductId = new Map<string, number>();
  for (const item of order.items) {
    quantitiesByProductId.set(item.productId, (quantitiesByProductId.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [slug, product] of products) {
    const quantity = quantitiesByProductId.get(product.id);
    if (!quantity) continue;
    if (product.inventory < quantity) throw new Error('Insufficient inventory for ' + product.id);
  }
  for (const [slug, product] of products) {
    const quantity = quantitiesByProductId.get(product.id);
    if (quantity) products.set(slug, { ...product, inventory: product.inventory - quantity });
  }
}

export function createInMemoryStore(initialProducts: Product[] = seedProducts): Store {
  const products = new Map(initialProducts.map((p) => [p.slug, { ...p }]));
  const orders: Order[] = [];
  const refunds = new Map<string, RefundEntry>();
  const refundSyncs = new Map<string, Promise<unknown>>();
  function applyLedger(orderId: string, update: RefundUpdate, status: RefundEntry['status']) {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return undefined;
    const existing = refunds.get(update.refundId ?? '');
    if (existing && existing.orderId !== orderId) throw new Error('Refund belongs to another order');
    const result = refundLedgerUpdate(order, [...refunds.values()].filter((entry) => entry.orderId === orderId), update, status);
    refunds.set(result.entry.id, result.entry);
    order.refundedAmount = result.refundedAmount;
    order.status = result.status;
    order.stripeRefundId = result.entry.id;
    order.refundReason = result.entry.reason;
    if (status === 'succeeded') order.refundedAt = now();
    if (result.entry.status !== 'pending' && existing?.status !== result.entry.status) {
      const id = (result.entry.status === 'succeeded' ? 'refunded:' : 'refund_failed:') + order.id + ':' + result.entry.id;
      if (!notifications.has(id)) notifications.set(id, { payloadJson: JSON.stringify(publicOrder(order)) });
    }
    return order;
  }
  const notifications = new Map<string, { payloadJson: string; firstAttemptAt?: number; leaseUntil?: number; leaseToken?: string; sentAt?: number; lastError?: string }>();
  const marketingSubscribers = new Map<string, MarketingSubscriber>();
  const faqItems = new Map(seedFaqItems.map((item) => [item.id, { ...item }]));
  const blogPosts = new Map(seedBlogPosts.map((post) => [post.slug, { ...post }]));
  return {
    async syncRefund(orderId, retrieve) {
      const preceding = refundSyncs.get(orderId) ?? Promise.resolve();
      const operation = preceding.catch(() => {}).then(async () => {
        const order = orders.find((candidate) => candidate.id === orderId);
        if (!order) return undefined;
        if (order.refundReconciliationRequired) throw new Error('Historical refunds require reconciliation before updates');
        const current = await retrieve(structuredClone(order));
        if (current.orderId !== orderId) throw new Error('Refund belongs to another order');
        return applyLedger(orderId, { refundId: current.id, amount: current.amount, reason: current.reason }, current.status);
      });
      refundSyncs.set(orderId, operation);
      try { return await operation; }
      finally { if (refundSyncs.get(orderId) === operation) refundSyncs.delete(orderId); }
    },
    async reconcileHistoricalRefunds(orderId, entries) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      const result = reconciledRefundLedger(order, entries);
      for (const entry of entries) {
        const previous = refunds.get(entry.id);
        if (previous && previous.orderId !== orderId) throw new Error('Refund belongs to another order');
      }
      for (const [id, entry] of refunds) if (entry.orderId === orderId) refunds.delete(id);
      for (const entry of entries) refunds.set(entry.id, { ...entry });
      Object.assign(order, result, { refundReconciliationRequired: false });
      return order;
    },
    async pendingNotifications(orderId) {
      return [...notifications].filter(([id, job]) => !job.sentAt && (!orderId || id === 'paid:' + orderId || id.startsWith('refunded:' + orderId + ':') || id.startsWith('refund_failed:' + orderId + ':'))).map(([id]) => ({ id }));
    },
    async claimNotification(id, leaseToken) {
      const job = notifications.get(id);
      if (!job || job.sentAt || (job.leaseUntil ?? 0) > Date.now()) return undefined;
      if (job.firstAttemptAt && Date.now() - job.firstAttemptAt >= 23 * 60 * 60 * 1000) throw new Error('Notification requires manual reconciliation after retry window');
      job.firstAttemptAt ??= Date.now();
      job.leaseUntil = Date.now() + 60_000;
      job.leaseToken = leaseToken;
      return { payloadJson: job.payloadJson };
    },
    async completeNotification(id, leaseToken) {
      const job = notifications.get(id);
      if (job?.leaseToken === leaseToken) { job.sentAt = Date.now(); job.leaseToken = undefined; job.leaseUntil = undefined; }
    },
    async releaseNotification(id, leaseToken, error) {
      const job = notifications.get(id);
      if (job?.leaseToken === leaseToken) { job.leaseToken = undefined; job.leaseUntil = undefined; job.lastError = error; }
    },
    async healthCheck() {},
    async listProducts() { return [...products.values()].filter((p) => p.active); },
    async listAdminProducts() { return [...products.values()]; },
    async getProduct(slug) { return products.get(slug); },
    async upsertProduct(product) { products.set(product.slug, { ...product }); return product; },
    async updateProductImage(slug, image) {
      const product = products.get(slug);
      if (!product) return undefined;
      const updated = { ...product, image };
      products.set(slug, updated);
      return updated;
    },
    async listOrders() { return [...orders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
    async listOrdersByEmail(email) { return [...orders].filter((order) => order.email.toLowerCase() === email.toLowerCase()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
    async getOrder(orderId) { return orders.find((order) => order.id === orderId); },
    async createOrder(input) {
      const productList = [...products.values()];
      const items = checkoutItems(input.items).map((item) => {
        const product = productList.find((p) => p.id === item.productId);
        if (!product) throw new Error('Unknown product ' + item.productId);
        if (!product.active || product.inventory < item.quantity) throw new Error('Product unavailable: ' + item.productId);
        return { productId: product.id, title: product.title, price: effectiveProductPrice(product), quantity: item.quantity };
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const shippingCost = calculateShippingCost(subtotal);
      const order: Order = { id: 'ord_' + nanoid(8), email: input.email, customerName: input.customerName, shippingAddress: input.shippingAddress, items, subtotal, shippingCost, total: subtotal + shippingCost, status: 'pending_payment', refundedAmount: 0, createdAt: now() };
      order.inventoryReserved = true;
      order.receiptTokenHash = input.receiptTokenHash;
      order.reservationExpiresAt = new Date(Date.now() + reservationDurationMs).toISOString();
      if (input.useStripe) order.checkoutRequestJson = JSON.stringify(checkoutRequest(order, input.checkoutBaseUrl ?? 'http://localhost:5173'));
      decrementInventoryForOrder(products, order);
      orders.push(order);
      return order;
    },
    async recordCheckoutSession(orderId, stripeSessionId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.stripeSessionId = stripeSessionId;
      return order;
    },
    async markOrderPaid(orderId, payment = {}) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      if (order.status === 'canceled') throw new Error('Canceled orders cannot be marked paid');
      if (payment.stripeSessionId && order.stripeSessionId && payment.stripeSessionId !== order.stripeSessionId) throw new Error('Payment session does not match order');
      if (payment.stripePaymentIntentId && order.stripePaymentIntentId && payment.stripePaymentIntentId !== order.stripePaymentIntentId) throw new Error('Payment intent does not match order');
      if (order.status !== 'pending_payment') return order;
      if (!order.inventoryReserved) decrementInventoryForOrder(products, order);
      order.inventoryReserved = false;
      order.status = 'paid';
      order.stripeSessionId = payment.stripeSessionId ?? order.stripeSessionId;
      order.stripePaymentIntentId = payment.stripePaymentIntentId ?? order.stripePaymentIntentId;
      notifications.set('paid:' + order.id, { payloadJson: JSON.stringify(publicOrder(order)) });
      return order;
    },
    async markOrderFulfilled(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      if (order.status === 'fulfilled') return order;
      if (order.status !== 'paid') throw new Error('Only paid orders can be fulfilled');
      order.status = 'fulfilled';
      return order;
    },
    async cancelOrder(orderId, reason) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      if (order.status === 'canceled') return order;
      if (order.status !== 'pending_payment') throw new Error('Only pending payment orders can be canceled');
      if (order.inventoryReserved) {
        for (const item of order.items) {
          const entry = [...products.entries()].find(([, product]) => product.id === item.productId);
          if (entry) products.set(entry[0], { ...entry[1], inventory: entry[1].inventory + item.quantity });
        }
        order.inventoryReserved = false;
      }
      order.status = 'canceled';
      order.refundReason = reason ?? order.refundReason;
      order.canceledAt = now();
      return order;
    },
    async markOrderRefundPending(orderId, refund) {
      return applyLedger(orderId, refund, 'pending');
    },
    async markOrderRefunded(orderId, refund) {
      return applyLedger(orderId, refund, 'succeeded');
    },
    async markOrderRefundFailed(orderId, refund) {
      return applyLedger(orderId, refund, 'failed');
    },
    async subscribeMarketing(input) {
      const email = normalizeEmail(input.email);
      const existing = marketingSubscribers.get(email);
      if (existing) {
        const updated: MarketingSubscriber = {
          ...existing,
          name: input.name?.trim() || existing.name,
          status: 'subscribed',
          source: input.source,
          couponCode: input.couponCode || existing.couponCode,
          consentedAt: now(),
          unsubscribedAt: undefined,
          updatedAt: now()
        };
        marketingSubscribers.set(email, updated);
        return { subscriber: updated, created: false };
      }
      const subscriber = createMarketingSubscriber(input);
      marketingSubscribers.set(email, subscriber);
      return { subscriber, created: true };
    },
    async listMarketingSubscribers() {
      return [...marketingSubscribers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async unsubscribeMarketing(token) {
      const subscriber = [...marketingSubscribers.values()].find((candidate) => candidate.unsubscribeToken === token);
      if (!subscriber) return undefined;
      const updated: MarketingSubscriber = { ...subscriber, status: 'unsubscribed', unsubscribedAt: now(), updatedAt: now() };
      marketingSubscribers.set(updated.email, updated);
      return updated;
    },
    async listFaqItems(options = {}) {
      return [...faqItems.values()]
        .filter((item) => options.includeInactive || item.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.question.localeCompare(b.question));
    },
    async upsertFaqItem(input: FaqItemInput) {
      const existing = input.id ? faqItems.get(input.id) : undefined;
      const timestamp = now();
      const saved: FaqItem = {
        id: existing?.id ?? input.id ?? 'faq_' + nanoid(8),
        question: input.question,
        answer: input.answer,
        sortOrder: input.sortOrder,
        active: input.active,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      faqItems.set(saved.id, saved);
      return saved;
    },
    async listBlogPosts(options = {}) {
      return [...blogPosts.values()]
        .filter((post) => options.includeDrafts || post.published)
        .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
    },
    async getBlogPost(slug, options = {}) {
      const post = blogPosts.get(slug);
      if (!post || (!options.includeDrafts && !post.published)) return undefined;
      return post;
    },
    async upsertBlogPost(input: BlogPostInput) {
      const existing = input.id ? [...blogPosts.values()].find((post) => post.id === input.id) : blogPosts.get(input.slug);
      const timestamp = now();
      const publishedAt = input.published ? input.publishedAt ?? existing?.publishedAt ?? timestamp : input.publishedAt ?? existing?.publishedAt;
      const saved: BlogPost = {
        id: existing?.id ?? input.id ?? 'blog_' + nanoid(8),
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: input.body,
        published: input.published,
        publishedAt: publishedAt ?? undefined,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      if (existing && existing.slug !== saved.slug) blogPosts.delete(existing.slug);
      blogPosts.set(saved.slug, saved);
      return saved;
    }
  };
}
