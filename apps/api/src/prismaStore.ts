import { inventoryMethods } from './inventory.js';
import { paymentMethods } from './paymentState.js';
import { nanoid } from 'nanoid';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { BlogPost, BlogPostInput, CheckoutInput, FaqItem, FaqItemInput, MarketingSubscriber, MarketingSubscriberStatus, MarketingSubscribeInput, Order, OrderStatus, Product, Store } from './types.js';
import { seedBlogPosts, seedFaqItems, seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';

type PrismaProduct = Awaited<ReturnType<PrismaClient['product']['findFirstOrThrow']>>;
type PrismaOrder = Awaited<ReturnType<PrismaClient['order']['findFirstOrThrow']>> & {
  items: Array<{ productId: string; title: string; price: number; quantity: number }>;
};
type PrismaMarketingSubscriber = Awaited<ReturnType<PrismaClient['marketingSubscriber']['findFirstOrThrow']>>;
type PrismaFaqItem = Awaited<ReturnType<PrismaClient['faqItem']['findFirstOrThrow']>>;
type PrismaBlogPost = Awaited<ReturnType<PrismaClient['blogPost']['findFirstOrThrow']>>;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toProduct(product: PrismaProduct): Product {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    price: product.price,
    saleActive: product.saleActive,
    salePrice: product.salePrice,
    category: product.category,
    tags: product.tags,
    image: product.image,
    inventory: product.inventory,
    reservedInventory: product.reservedInventory,
    inventoryVersion: product.inventoryVersion,
    active: product.active,
    featured: product.featured
  };
}

function toOrder(order: PrismaOrder): Order {
  return {
    id: order.id,
    email: order.email,
    receiptTokenHash: order.receiptTokenHash ?? undefined,
    customerName: order.customerName ?? undefined,
    shippingAddress: order.shippingAddress ?? undefined,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    total: order.total,
    status: order.status as OrderStatus,
    stripeSessionId: order.stripeSessionId ?? undefined,
    stripePaymentIntentId: order.stripePaymentIntentId ?? undefined,
    stripeRefundId: order.stripeRefundId ?? undefined,
    refundedAmount: order.refundedAmount,
    discountAmount: order.discountAmount,
    inventoryState: order.inventoryState as Order['inventoryState'],
    reservationExpiresAt: order.reservationExpiresAt?.toISOString(),
    inventoryIssue: order.inventoryIssue ?? undefined,
    paidAt: order.paidAt?.toISOString(),
    fulfilledAt: order.fulfilledAt?.toISOString(),
    refundReason: order.refundReason ?? undefined,
    canceledAt: order.canceledAt?.toISOString(),
    refundedAt: order.refundedAt?.toISOString(),
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productId: item.productId,
      title: item.title,
      price: item.price,
      quantity: item.quantity
    }))
  };
}

function toMarketingSubscriber(subscriber: PrismaMarketingSubscriber): MarketingSubscriber {
  return {
    id: subscriber.id,
    email: subscriber.email,
    name: subscriber.name ?? undefined,
    status: subscriber.status as MarketingSubscriberStatus,
    source: subscriber.source,
    couponCode: subscriber.couponCode,
    unsubscribeToken: subscriber.unsubscribeToken,
    consentedAt: subscriber.consentedAt.toISOString(),
    unsubscribedAt: subscriber.unsubscribedAt?.toISOString(),
    createdAt: subscriber.createdAt.toISOString(),
    updatedAt: subscriber.updatedAt.toISOString()
  };
}

function toFaqItem(item: PrismaFaqItem): FaqItem {
  return {
    id: item.id,
    question: item.question,
    answer: item.answer,
    sortOrder: item.sortOrder,
    active: item.active,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

function toBlogPost(post: PrismaBlogPost): BlogPost {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    published: post.published,
    publishedAt: post.publishedAt?.toISOString(),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString()
  };
}

export async function seedPrismaProducts(prisma: PrismaClient, products: Product[] = seedProducts) {
  // Both IDs and slugs are unique. Skip either collision, including renamed seed listings.
  await prisma.product.createMany({ data: products, skipDuplicates: true });
}

export async function seedPrismaContent(prisma: PrismaClient, faqItems: FaqItem[] = seedFaqItems, blogPosts: BlogPost[] = seedBlogPosts) {
  for (const item of faqItems) {
    await prisma.faqItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        question: item.question,
        answer: item.answer,
        sortOrder: item.sortOrder,
        active: item.active
      }
    });
  }
  for (const post of blogPosts) {
    await prisma.blogPost.upsert({
      where: { slug: post.slug },
      update: {},
      create: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        body: post.body,
        published: post.published,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null
      }
    });
  }
}

export function createPrismaStore(prisma: PrismaClient | Prisma.TransactionClient, inTransaction = false): Store {
  async function findOrder(orderId: string) {
    return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  }

  async function updateOrder(orderId: string, data: Record<string, unknown>) {
    const order = await prisma.order.update({ where: { id: orderId }, data, include: { items: true } }).catch(() => undefined);
    return order ? toOrder(order) : undefined;
  }

  const store: Store = {
    ...paymentMethods(() => store),
    ...inventoryMethods(() => store),
    async atomic(work) {
      if (inTransaction) return work(store);
      return (prisma as PrismaClient).$transaction(async tx => {
        // All payment mutations use one short DB lock; no network calls inside it.
        // This also serializes first-time operation IDs before their row exists.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(74192351)::text`;
        return work(createPrismaStore(tx, true));
      }, { maxWait: 10000, timeout: 15000 });
    },
    async getRecord(id) { const r = await prisma.paymentJournal.findUnique({ where: { id } }); return r ? { ...r, orderId: r.orderId ?? undefined } : undefined; },
    async putRecord(record) {
      const data = JSON.parse(JSON.stringify(record.data)) as Prisma.InputJsonValue;
      await prisma.paymentJournal.upsert({ where: { id: record.id }, create: { ...record, data }, update: { data } });
    },
    async listRecords(kind, orderId) { return (await prisma.paymentJournal.findMany({ where: { kind, orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(r => ({ ...r, orderId: r.orderId ?? undefined })); },
    async saveOrder(order) {
      const { items: _items, createdAt: _createdAt, ...data } = order;
      const saved = await prisma.order.update({ where: { id: order.id }, data: { ...data, inventoryIssue: order.inventoryIssue ?? null, canceledAt: order.canceledAt ? new Date(order.canceledAt) : null }, include: { items: true } });
      return toOrder(saved);
    },
    async adjustInventory(productId, quantity, action) {
      const reservedDelta = action === 'reserve' ? quantity : ['release', 'consume'].includes(action) ? -quantity : 0;
      const stockDelta = ['consume', 'purchase'].includes(action) ? -quantity : 0;
      const count = await prisma.$executeRaw`
        UPDATE "Product" SET "inventory" = "inventory" + ${stockDelta},
          "reservedInventory" = "reservedInventory" + ${reservedDelta},
          "inventoryVersion" = "inventoryVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${productId}
          AND (${action} <> 'reserve' OR ("active" = true AND "inventory" - "reservedInventory" >= ${quantity}))
          AND (${action} <> 'purchase' OR "inventory" - "reservedInventory" >= ${quantity})
          AND (${action} NOT IN ('release', 'consume') OR "reservedInventory" >= ${quantity})
          AND (${action} <> 'consume' OR "inventory" >= ${quantity})`;
      return count === 1;
    },
    async listReservationOrders() { return (await prisma.order.findMany({ where: { inventoryState: { in: ['held', 'legacy_held'] } }, include: { items: true }, orderBy: { reservationExpiresAt: 'asc' } })).map(toOrder); },
    async healthCheck() {
      await prisma.$queryRaw`SELECT 1`;
    },
    async listProducts() {
      const products = await prisma.product.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
      return products.map(toProduct);
    },
    async listAdminProducts() {
      const products = await prisma.product.findMany({ orderBy: { createdAt: 'asc' } });
      return products.map(toProduct);
    },
    async getProduct(slug) {
      const product = await prisma.product.findUnique({ where: { slug } });
      return product ? toProduct(product) : undefined;
    },
    async writeProduct(product) {
      const saved = await prisma.product.upsert({ where: { slug: product.slug }, update: product, create: product });
      return toProduct(saved);
    },
    async updateProductImage(slug, image) {
      const saved = await prisma.product.update({ where: { slug }, data: { image } }).catch(() => undefined);
      return saved ? toProduct(saved) : undefined;
    },
    async listOrders() {
      const orders = await prisma.order.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
      return orders.map(toOrder);
    },
    async listOrdersByEmail(email) {
      const orders = await prisma.order.findMany({ where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } }, include: { items: true }, orderBy: { createdAt: 'desc' } });
      return orders.map(toOrder);
    },
    async getOrder(orderId) {
      const order = await findOrder(orderId);
      return order ? toOrder(order) : undefined;
    },
    async createUnreservedOrder(input: CheckoutInput) {
      const productIds = input.items.map((item) => item.productId);
      const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
      const orderItems = input.items.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new Error('Unknown product ' + item.productId);
        return { productId: product.id, title: product.title, price: effectiveProductPrice(toProduct(product)), quantity: item.quantity };
      });
      const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const shippingCost = calculateShippingCost(subtotal);
      const order = await prisma.order.create({
        data: {
          id: 'ord_' + nanoid(8),
          email: normalizeEmail(input.email),
          receiptTokenHash: input.receiptTokenHash,
          customerName: input.customerName,
          shippingAddress: input.shippingAddress,
          subtotal,
          shippingCost,
          total: subtotal + shippingCost,
          status: 'pending_payment',
          refundedAmount: 0,
          items: { create: orderItems }
        },
        include: { items: true }
      });
      return toOrder(order);
    },
    async recordCheckoutSession(orderId, stripeSessionId) {
      return updateOrder(orderId, { stripeSessionId });
    },
    async subscribeMarketing(input: MarketingSubscribeInput) {
      const email = normalizeEmail(input.email);
      const existing = await prisma.marketingSubscriber.findUnique({ where: { email } });
      const saved = existing
        ? await prisma.marketingSubscriber.update({
            where: { email },
            data: {
              name: input.name?.trim() || existing.name,
              status: 'subscribed',
              source: input.source,
              couponCode: input.couponCode || existing.couponCode,
              consentedAt: new Date(),
              unsubscribedAt: null
            }
          })
        : await prisma.marketingSubscriber.create({
            data: {
              id: 'sub_' + nanoid(8),
              email,
              name: input.name?.trim() || undefined,
              source: input.source,
              couponCode: input.couponCode,
              unsubscribeToken: nanoid(32)
            }
          });
      return { subscriber: toMarketingSubscriber(saved), created: !existing };
    },
    async listMarketingSubscribers() {
      const subscribers = await prisma.marketingSubscriber.findMany({ orderBy: { createdAt: 'desc' } });
      return subscribers.map(toMarketingSubscriber);
    },
    async unsubscribeMarketing(token) {
      const saved = await prisma.marketingSubscriber.update({ where: { unsubscribeToken: token }, data: { status: 'unsubscribed', unsubscribedAt: new Date() } }).catch(() => undefined);
      return saved ? toMarketingSubscriber(saved) : undefined;
    },
    async listFaqItems(options = {}) {
      const items = await prisma.faqItem.findMany({
        where: options.includeInactive ? undefined : { active: true },
        orderBy: [{ sortOrder: 'asc' }, { question: 'asc' }]
      });
      return items.map(toFaqItem);
    },
    async upsertFaqItem(input: FaqItemInput) {
      const id = input.id || 'faq_' + nanoid(8);
      const saved = await prisma.faqItem.upsert({
        where: { id },
        update: { question: input.question, answer: input.answer, sortOrder: input.sortOrder, active: input.active },
        create: { id, question: input.question, answer: input.answer, sortOrder: input.sortOrder, active: input.active }
      });
      return toFaqItem(saved);
    },
    async listBlogPosts(options = {}) {
      const posts = await prisma.blogPost.findMany({
        where: options.includeDrafts ? undefined : { published: true },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }]
      });
      return posts.map(toBlogPost);
    },
    async getBlogPost(slug, options = {}) {
      const post = await prisma.blogPost.findUnique({ where: { slug } });
      if (!post || (!options.includeDrafts && !post.published)) return undefined;
      return toBlogPost(post);
    },
    async upsertBlogPost(input: BlogPostInput) {
      const existing = input.id
        ? await prisma.blogPost.findUnique({ where: { id: input.id } })
        : await prisma.blogPost.findUnique({ where: { slug: input.slug } });
      const id = existing?.id ?? input.id ?? 'blog_' + nanoid(8);
      const publishedAt = input.published ? input.publishedAt ? new Date(input.publishedAt) : existing?.publishedAt ?? new Date() : input.publishedAt ? new Date(input.publishedAt) : existing?.publishedAt ?? null;
      const saved = await prisma.blogPost.upsert({
        where: { id },
        update: { slug: input.slug, title: input.title, excerpt: input.excerpt, body: input.body, published: input.published, publishedAt },
        create: { id, slug: input.slug, title: input.title, excerpt: input.excerpt, body: input.body, published: input.published, publishedAt }
      });
      return toBlogPost(saved);
    }
  };
  return store;
}
