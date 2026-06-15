import { nanoid } from 'nanoid';
import type { CartItemInput, Order, Product, Store } from './types.js';
import { seedProducts } from './seed.js';
import { calculateShippingCost } from './shipping.js';
import { effectiveProductPrice } from './pricing.js';

export function createInMemoryStore(initialProducts: Product[] = seedProducts): Store {
  const products = new Map(initialProducts.map((p) => [p.slug, { ...p }]));
  const orders: Order[] = [];
  return {
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
        if (!product) throw new Error(`Unknown product ${item.productId}`);
        return { productId: product.id, title: product.title, price: effectiveProductPrice(product), quantity: item.quantity };
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const shippingCost = calculateShippingCost(subtotal);
      const order: Order = { id: `ord_${nanoid(8)}`, email: input.email, customerName: input.customerName, shippingAddress: input.shippingAddress, items, subtotal, shippingCost, total: subtotal + shippingCost, status: 'pending_payment', createdAt: new Date().toISOString() };
      orders.push(order);
      return order;
    },
    async markOrderPaid(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'paid';
      return order;
    },
    async markOrderFulfilled(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return undefined;
      order.status = 'fulfilled';
      return order;
    }
  };
}
