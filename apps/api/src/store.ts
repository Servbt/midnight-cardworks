import { inventoryMethods } from './inventory.js';
import { paymentMethods } from './paymentState.js';
import type { JournalRecord } from './types.js';
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

export function createInMemoryStore(initialProducts: Product[] = seedProducts): Store {
  const products = new Map(initialProducts.map((p) => [p.slug, { ...p, reservedInventory: p.reservedInventory ?? 0, inventoryVersion: p.inventoryVersion ?? 0 }]));
  const orders: Order[] = [];
  const marketingSubscribers = new Map<string, MarketingSubscriber>();
  const faqItems = new Map(seedFaqItems.map((item) => [item.id, { ...item }]));
  const blogPosts = new Map(seedBlogPosts.map((post) => [post.slug, { ...post }]));
  const records = new Map<string, JournalRecord>();
  let tail: Promise<unknown> = Promise.resolve();
  const scoped = (): Store => { const tx: Store = { ...store, atomic: async work => work(tx) }; Object.assign(tx, paymentMethods(() => tx), inventoryMethods(() => tx)); return tx; };
  const store: Store = {
    ...paymentMethods(() => store),
    ...inventoryMethods(() => store),
    async atomic(work) {
      const run = tail.then(async () => {
        const snapshot = structuredClone({ orders, products, records });
        try { return await work(scoped()); }
        catch (error) {
          orders.splice(0, orders.length, ...snapshot.orders);
          products.clear(); for (const [key, value] of snapshot.products) products.set(key, value);
          records.clear(); for (const [key, value] of snapshot.records) records.set(key, value);
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async getRecord(id) { return structuredClone(records.get(id)); },
    async putRecord(record) { records.set(record.id, structuredClone(record)); },
    async listRecords(kind, orderId) { return structuredClone([...records.values()].filter(r => r.kind === kind && (!orderId || r.orderId === orderId))); },
    async saveOrder(order) { const index = orders.findIndex(o => o.id === order.id); if (index < 0) throw new Error('Order not found'); orders[index] = structuredClone(order); return order; },
    async adjustInventory(productId, quantity, action) {
      const product = [...products.values()].find(p => p.id === productId);
      if (!product) return false;
      const reserved = product.reservedInventory;
      if (action === 'reserve' && (!product.active || product.inventory - reserved < quantity)) return false;
      if (action === 'purchase' && product.inventory - reserved < quantity) return false;
      if (['release', 'consume'].includes(action) && reserved < quantity) return false;
      if (action === 'consume' && product.inventory < quantity) return false;
      products.set(product.slug, { ...product,
        inventory: product.inventory - (['consume', 'purchase'].includes(action) ? quantity : 0),
        reservedInventory: reserved + (action === 'reserve' ? quantity : ['release', 'consume'].includes(action) ? -quantity : 0),
        inventoryVersion: product.inventoryVersion + 1
      }); return true;
    },
    async listReservationOrders() { return structuredClone(orders.filter(o => ['held', 'legacy_held'].includes(o.inventoryState ?? ''))); },
    async healthCheck() {},
    async listProducts() { return [...products.values()].filter((p) => p.active); },
    async listAdminProducts() { return [...products.values()]; },
    async getProduct(slug) { return products.get(slug); },
    async writeProduct(product) { products.set(product.slug, { ...product, reservedInventory: product.reservedInventory ?? 0, inventoryVersion: product.inventoryVersion ?? 0 }); return product; },
    async updateProductImage(slug, image) {
      const product = products.get(slug);
      if (!product) return undefined;
      const updated = { ...product, image };
      products.set(slug, updated);
      return updated;
    },
    async listOrders() { return [...orders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
    async listOrdersByEmail(email) { return [...orders].filter((order) => order.email.toLowerCase() === email.toLowerCase()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
    async getOrder(orderId) { return structuredClone(orders.find((order) => order.id === orderId)); },
    async createUnreservedOrder(input) {
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
  return store;
}