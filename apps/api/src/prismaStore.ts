import { nanoid } from 'nanoid';
import type { PrismaClient } from '@prisma/client';
import type { BlogPost, BlogPostInput, CheckoutInput, FaqItem, FaqItemInput, MarketingSubscriber, MarketingSubscriberStatus, MarketingSubscribeInput, Order, OrderStatus, Product, Store } from './types.js';
import { seedBlogPosts, seedFaqItems, seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';
import { checkoutItems, reservationDurationMs } from './inventory.js';
import { checkoutRequest } from './checkoutRequest.js';
import { publicOrder } from './receiptAccess.js';
import { refundLedgerUpdate, reconciledRefundLedger, type RefundEntry, type RefundUpdate } from './refundLedger.js';

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
    active: product.active,
    featured: product.featured
  };
}

function toOrder(order: PrismaOrder): Order {
  return {
    id: order.id,
    email: order.email,
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
    refundReason: order.refundReason ?? undefined,
    canceledAt: order.canceledAt?.toISOString(),
    refundedAt: order.refundedAt?.toISOString(),
    createdAt: order.createdAt.toISOString(),
    inventoryReserved: order.inventoryReserved,
    reservationExpiresAt: order.reservationExpiresAt?.toISOString(),
    checkoutRequestJson: order.checkoutRequestJson ?? undefined,
    receiptTokenHash: order.receiptTokenHash ?? undefined,
    refundReconciliationRequired: order.refundReconciliationRequired,
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
  // Skip conflicts on either id or slug, including listings renamed by an admin.
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

export function createPrismaStore(prisma: PrismaClient): Store {
  async function applyLedger(orderId: string, update: RefundUpdate, status: RefundEntry['status'], retrieve?: (order: Order) => Promise<RefundEntry>) {
    return prisma.$transaction(async (transaction) => {
      // Serialize all refund updates for this order before reading its ledger.
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      if (!locked.length) return undefined;
      const order = await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      if (retrieve) {
        if (order.refundReconciliationRequired) throw new Error('Historical refunds require reconciliation before updates');
        const current = await retrieve(toOrder(order));
        if (current.orderId !== orderId) throw new Error('Refund belongs to another order');
        update = { refundId: current.id, amount: current.amount, reason: current.reason };
        status = current.status;
      }
      const existing = update.refundId ? await transaction.orderRefund.findUnique({ where: { id: update.refundId } }) : null;
      if (existing && existing.orderId !== orderId) throw new Error('Refund belongs to another order');
      const entries = await transaction.orderRefund.findMany({ where: { orderId } });
      const result = refundLedgerUpdate(toOrder(order), entries.map((entry) => ({ ...entry, status: entry.status as RefundEntry['status'], reason: entry.reason ?? undefined })), update, status);
      if (existing) await transaction.orderRefund.update({ where: { id: result.entry.id }, data: { amount: result.entry.amount, status: result.entry.status, reason: result.entry.reason } });
      else await transaction.orderRefund.create({ data: result.entry });
      const saved = await transaction.order.update({ where: { id: orderId }, data: { status: result.status, refundedAmount: result.refundedAmount, stripeRefundId: result.entry.id, refundReason: result.entry.reason, ...(status === 'succeeded' ? { refundedAt: new Date() } : {}) }, include: { items: true } });
      if (result.entry.status !== 'pending' && existing?.status !== result.entry.status) {
        const id = (result.entry.status === 'succeeded' ? 'refunded:' : 'refund_failed:') + orderId + ':' + result.entry.id;
        await transaction.orderNotification.upsert({ where: { id }, create: { id, orderId, payloadJson: JSON.stringify(publicOrder(toOrder(saved))) }, update: {} });
      }
      return toOrder(saved);
    }, { timeout: 30_000, maxWait: 30_000 });
  }
  async function findOrder(orderId: string) {
    return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  }

  async function updateOrder(orderId: string, data: Record<string, unknown>) {
    const order = await prisma.order.update({ where: { id: orderId }, data, include: { items: true } }).catch(() => undefined);
    return order ? toOrder(order) : undefined;
  }

  return {
    async pendingNotifications(orderId) {
      return prisma.orderNotification.findMany({ where: { sentAt: null, ...(orderId ? { orderId } : {}) }, select: { id: true } });
    },
    async syncRefund(orderId, retrieve) {
      return applyLedger(orderId, {}, 'pending', retrieve);
    },
    async reconcileHistoricalRefunds(orderId, entries) {
      return prisma.$transaction(async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        if (!locked.length) return undefined;
        const order = await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
        const result = reconciledRefundLedger(toOrder(order), entries);
        await transaction.orderRefund.deleteMany({ where: { orderId } });
        await transaction.orderRefund.createMany({ data: entries });
        const saved = await transaction.order.update({ where: { id: orderId }, data: { ...result, refundReconciliationRequired: false }, include: { items: true } });
        return toOrder(saved);
      });
    },
    async claimNotification(id, leaseToken) {
      return prisma.$transaction(async (transaction) => {
        const timestamp = new Date();
        const claimed = await transaction.orderNotification.updateMany({
          where: { id, sentAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lte: timestamp } }] },
          data: { leaseToken, leaseUntil: new Date(timestamp.getTime() + 60_000) }
        });
        if (!claimed.count) return undefined;
        const job = await transaction.orderNotification.findUniqueOrThrow({ where: { id } });
        if (job.firstAttemptAt && timestamp.getTime() - job.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000) throw new Error('Notification requires manual reconciliation after retry window');
        if (!job.firstAttemptAt) await transaction.orderNotification.update({ where: { id }, data: { firstAttemptAt: timestamp } });
        return { payloadJson: job.payloadJson };
      });
    },
    async completeNotification(id, leaseToken) {
      await prisma.orderNotification.updateMany({ where: { id, leaseToken, sentAt: null }, data: { sentAt: new Date(), leaseToken: null, leaseUntil: null } });
    },
    async releaseNotification(id, leaseToken, error) {
      await prisma.orderNotification.updateMany({ where: { id, leaseToken, sentAt: null }, data: { leaseToken: null, leaseUntil: null, lastError: error } });
    },
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
    async upsertProduct(product) {
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
      const orders = await prisma.order.findMany({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, include: { items: true }, orderBy: { createdAt: 'desc' } });
      return orders.map(toOrder);
    },
    async getOrder(orderId) {
      const order = await findOrder(orderId);
      return order ? toOrder(order) : undefined;
    },
    async createOrder(input: CheckoutInput) {
      const items = checkoutItems(input.items);
      return prisma.$transaction(async (transaction) => {
        const orderItems: Order['items'] = [];
        for (const item of items) {
          const reserved = await transaction.product.updateMany({
            where: { id: item.productId, active: true, inventory: { gte: item.quantity } },
            data: { inventory: { decrement: item.quantity } }
          });
          if (reserved.count !== 1) throw new Error('Product unavailable: ' + item.productId);
          const product = await transaction.product.findUniqueOrThrow({ where: { id: item.productId } });
          orderItems.push({ productId: product.id, title: product.title, price: effectiveProductPrice(toProduct(product)), quantity: item.quantity });
        }
        const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const shippingCost = calculateShippingCost(subtotal);
        const order = await transaction.order.create({
          data: {
            id: 'ord_' + nanoid(8),
            email: input.email,
            customerName: input.customerName,
            shippingAddress: input.shippingAddress,
            subtotal,
            shippingCost,
            total: subtotal + shippingCost,
            status: 'pending_payment',
            refundedAmount: 0,
            inventoryReserved: true,
            receiptTokenHash: input.receiptTokenHash,
            reservationExpiresAt: new Date(Date.now() + reservationDurationMs),
            items: { create: orderItems }
          },
          include: { items: true }
        });
        if (input.useStripe) {
          const saved = await transaction.order.update({ where: { id: order.id }, data: { checkoutRequestJson: JSON.stringify(checkoutRequest(toOrder(order), input.checkoutBaseUrl ?? 'http://localhost:5173')) }, include: { items: true } });
          return toOrder(saved);
        }
        return toOrder(order);
      });
    },
    async recordCheckoutSession(orderId, stripeSessionId) {
      return updateOrder(orderId, { stripeSessionId });
    },
    async markOrderPaid(orderId, payment = {}) {
      const data: Record<string, unknown> = { status: 'paid', inventoryReserved: false };
      if (payment.stripeSessionId) data.stripeSessionId = payment.stripeSessionId;
      if (payment.stripePaymentIntentId) data.stripePaymentIntentId = payment.stripePaymentIntentId;

      const updated = await prisma.$transaction(async (transaction) => {
        const order = await transaction.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!order) return undefined;
        if (order.status === 'canceled') throw new Error('Canceled orders cannot be marked paid');
        if (payment.stripeSessionId && order.stripeSessionId && payment.stripeSessionId !== order.stripeSessionId) throw new Error('Payment session does not match order');
        if (payment.stripePaymentIntentId && order.stripePaymentIntentId && payment.stripePaymentIntentId !== order.stripePaymentIntentId) throw new Error('Payment intent does not match order');
        const transition = await transaction.order.updateMany({ where: { id: orderId, status: 'pending_payment' }, data });
        if (transition.count === 1 && !order.inventoryReserved) {
          for (const item of order.items) {
            const reserved = await transaction.product.updateMany({ where: { id: item.productId, inventory: { gte: item.quantity } }, data: { inventory: { decrement: item.quantity } } });
            if (reserved.count !== 1) throw new Error('Insufficient inventory for legacy order ' + orderId);
          }
        }
        const current = await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
        if (current.status === 'canceled') throw new Error('Canceled orders cannot be marked paid');
        if (payment.stripeSessionId && current.stripeSessionId && payment.stripeSessionId !== current.stripeSessionId) throw new Error('Payment session does not match order');
        if (payment.stripePaymentIntentId && current.stripePaymentIntentId && payment.stripePaymentIntentId !== current.stripePaymentIntentId) throw new Error('Payment intent does not match order');
        if (transition.count === 1) await transaction.orderNotification.create({ data: { id: 'paid:' + orderId, orderId, payloadJson: JSON.stringify(publicOrder(toOrder(current))) } });
        return current;
      });
      return updated ? toOrder(updated) : undefined;
    },
    async markOrderFulfilled(orderId) {
      return prisma.$transaction(async (transaction) => {
        await transaction.order.updateMany({ where: { id: orderId, status: 'paid' }, data: { status: 'fulfilled' } });
        const current = await transaction.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!current) return undefined;
        if (current.status !== 'fulfilled') throw new Error('Only paid orders can be fulfilled');
        return toOrder(current);
      });
    },
    async cancelOrder(orderId, reason) {
      return prisma.$transaction(async (transaction) => {
        const order = await transaction.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!order) return undefined;
        const canceled = await transaction.order.updateMany({ where: { id: orderId, status: 'pending_payment' }, data: { status: 'canceled', inventoryReserved: false, refundReason: reason, canceledAt: new Date() } });
        if (canceled.count === 1 && order.inventoryReserved) {
          for (const item of order.items) {
            await transaction.product.update({ where: { id: item.productId }, data: { inventory: { increment: item.quantity } } });
          }
        }
        const current = await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
        if (current.status !== 'canceled') throw new Error('Only pending payment orders can be canceled');
        return toOrder(current);
      });
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
}
