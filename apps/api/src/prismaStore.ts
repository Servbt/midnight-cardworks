import { nanoid } from 'nanoid';
import type { PrismaClient } from '@prisma/client';
import type { CheckoutInput, MarketingSubscriber, MarketingSubscriberStatus, MarketingSubscribeInput, Order, OrderStatus, Product, Store } from './types.js';
import { seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';

type PrismaProduct = Awaited<ReturnType<PrismaClient['product']['findFirstOrThrow']>>;
type PrismaOrder = Awaited<ReturnType<PrismaClient['order']['findFirstOrThrow']>> & {
  items: Array<{ productId: string; title: string; price: number; quantity: number }>;
};
type PrismaMarketingSubscriber = Awaited<ReturnType<PrismaClient['marketingSubscriber']['findFirstOrThrow']>>;

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

export async function seedPrismaProducts(prisma: PrismaClient, products: Product[] = seedProducts) {
  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: product,
      create: product
    });
  }
}

export function createPrismaStore(prisma: PrismaClient): Store {
  async function findOrder(orderId: string) {
    return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  }

  async function updateOrder(orderId: string, data: Record<string, unknown>) {
    const order = await prisma.order.update({ where: { id: orderId }, data, include: { items: true } }).catch(() => undefined);
    return order ? toOrder(order) : undefined;
  }

  return {
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
      const orders = await prisma.order.findMany({ where: { email }, include: { items: true }, orderBy: { createdAt: 'desc' } });
      return orders.map(toOrder);
    },
    async getOrder(orderId) {
      const order = await findOrder(orderId);
      return order ? toOrder(order) : undefined;
    },
    async createOrder(input: CheckoutInput) {
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
          email: input.email,
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
    async markOrderPaid(orderId, payment = {}) {
      return updateOrder(orderId, { status: 'paid', stripeSessionId: payment.stripeSessionId, stripePaymentIntentId: payment.stripePaymentIntentId });
    },
    async markOrderFulfilled(orderId) {
      return updateOrder(orderId, { status: 'fulfilled' });
    },
    async cancelOrder(orderId, reason) {
      return updateOrder(orderId, { status: 'canceled', refundReason: reason, canceledAt: new Date() });
    },
    async markOrderRefundPending(orderId, refund) {
      return updateOrder(orderId, { status: 'refund_pending', stripeRefundId: refund.refundId, refundReason: refund.reason });
    },
    async markOrderRefunded(orderId, refund) {
      const order = await findOrder(orderId);
      if (!order) return undefined;
      const alreadyApplied = refund.refundId && order.stripeRefundId === refund.refundId && (order.status === 'refunded' || order.status === 'partially_refunded');
      const refundedAmount = alreadyApplied ? order.refundedAmount : Math.min(order.total, order.refundedAmount + refund.amount);
      return updateOrder(orderId, {
        status: refundedAmount >= order.total ? 'refunded' : 'partially_refunded',
        refundedAmount,
        stripeRefundId: refund.refundId ?? order.stripeRefundId,
        refundReason: refund.reason ?? order.refundReason,
        refundedAt: new Date()
      });
    },
    async markOrderRefundFailed(orderId, refund) {
      return updateOrder(orderId, { status: 'refund_failed', stripeRefundId: refund.refundId, refundReason: refund.reason });
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
    }
  };
}
