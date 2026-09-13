import { nanoid } from 'nanoid';
import type { BlogPost, BlogPostInput, FaqItem, FaqItemInput, MarketingSubscriber, MarketingSubscribeInput, Order, Product, Store } from './types.js';
import { seedBlogPosts, seedFaqItems, seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';

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
    products.set(slug, { ...product, inventory: Math.max(0, product.inventory - quantity) });
  }
}

function applyRefund(order: Order, refund: { amount: number; refundId?: string; reason?: string }) {
  if (refund.refundId && order.stripeRefundId === refund.refundId && (order.status === 'refunded' || order.status === 'partially_refunded')) {
    return order;
  }
  const refundedAmount = Math.min(order.total, order.refundedAmount + refund.amount);
  order.refundedAmount = refundedAmount;
  order.stripeRefundId = refund.refundId ?? order.stripeRefundId;
  order.refundReason = refund.reason ?? order.refundReason;
  order.status = refundedAmount >= order.total ? 'refunded' : 'partially_refunded';
  order.refundedAt = now();
  return order;
}

export function createInMemoryStore(initialProducts: Product[] = seedProducts): Store {
  const products = new Map(initialProducts.map((p) => [p.slug, { ...p }]));
  const orders: Order[] = [];
  const marketingSubscribers = new Map<string, MarketingSubscriber>();
  const faqItems = new Map(seedFaqItems.map((item) => [item.id, { ...item }]));
  const blogPosts = new Map(seedBlogPosts.map((post) => [post.slug, { ...post }]));
  return {
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
      const items = input.items.map((item) => {
        const product = productList.find((p) => p.id === item.productId);
        if (!product) throw new Error('Unknown product ' + item.productId);
        return { productId: product.id, title: product.title, price: effectiveProductPrice(product), quantity: item.quantity };
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const shippingCost = calculateShippingCost(subtotal);
      const order: Order = { id: 'ord_' + nanoid(8), email: normalizeEmail(input.email), receiptTokenHash: input.receiptTokenHash, customerName: input.customerName, shippingAddress: input.shippingAddress, items, subtotal, shippingCost, total: subtotal + shippingCost, status: 'pending_payment', refundedAmount: 0, createdAt: now() };
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
      if (order.status === 'pending_payment') decrementInventoryForOrder(products, order);
      order.status = 'paid';
      order.stripeSessionId = payment.stripeSessionId ?? order.stripeSessionId;
      order.stripePaymentIntentId = payment.stripePaymentIntentId ?? order.stripePaymentIntentId;
      return order;
    },
    async markOrderFulfilled(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'fulfilled';
      return order;
    },
    async cancelOrder(orderId, reason) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'canceled';
      order.refundReason = reason ?? order.refundReason;
      order.canceledAt = now();
      return order;
    },
    async markOrderRefundPending(orderId, refund) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'refund_pending';
      order.stripeRefundId = refund.refundId ?? order.stripeRefundId;
      order.refundReason = refund.reason ?? order.refundReason;
      return order;
    },
    async markOrderRefunded(orderId, refund) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      return applyRefund(order, refund);
    },
    async markOrderRefundFailed(orderId, refund) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'refund_failed';
      order.stripeRefundId = refund.refundId ?? order.stripeRefundId;
      order.refundReason = refund.reason ?? order.refundReason;
      return order;
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