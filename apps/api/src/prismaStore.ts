import { nanoid } from 'nanoid';
import type { PrismaClient } from '@prisma/client';
import type { CartItemInput, Order, OrderStatus, Product, Store } from './types.js';
import { seedProducts } from './seed.js';

type PrismaProduct = Awaited<ReturnType<PrismaClient['product']['findFirstOrThrow']>>;
type PrismaOrder = Awaited<ReturnType<PrismaClient['order']['findFirstOrThrow']>> & {
  items: Array<{ productId: string; title: string; price: number; quantity: number }>;
};

function toProduct(product: PrismaProduct): Product {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    price: product.price,
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
    subtotal: order.subtotal,
    total: order.total,
    status: order.status as OrderStatus,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productId: item.productId,
      title: item.title,
      price: item.price,
      quantity: item.quantity
    }))
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
  return {
    async listProducts() {
      const products = await prisma.product.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
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
    async listOrders() {
      const orders = await prisma.order.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
      return orders.map(toOrder);
    },
    async createOrder(input: { email: string; items: CartItemInput[] }) {
      const productIds = input.items.map((item) => item.productId);
      const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
      const orderItems = input.items.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new Error(`Unknown product ${item.productId}`);
        return { productId: product.id, title: product.title, price: product.price, quantity: item.quantity };
      });
      const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const order = await prisma.order.create({
        data: {
          id: `ord_${nanoid(8)}`,
          email: input.email,
          subtotal,
          total: subtotal,
          status: 'pending_payment',
          items: { create: orderItems }
        },
        include: { items: true }
      });
      return toOrder(order);
    },
    async markOrderPaid(orderId) {
      const order = await prisma.order.update({ where: { id: orderId }, data: { status: 'paid' }, include: { items: true } }).catch(() => undefined);
      return order ? toOrder(order) : undefined;
    }
  };
}
