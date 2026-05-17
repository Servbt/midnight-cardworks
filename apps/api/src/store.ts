import { nanoid } from 'nanoid';
import type { CartItemInput, Order, Product, Store } from './types.js';
import { seedProducts } from './seed.js';

export function createInMemoryStore(initialProducts: Product[] = seedProducts): Store {
  const products = new Map(initialProducts.map((p) => [p.slug, { ...p }]));
  const orders: Order[] = [];
  return {
    async listProducts() { return [...products.values()].filter((p) => p.active); },
    async getProduct(slug) { return products.get(slug); },
    async upsertProduct(product) { products.set(product.slug, { ...product }); return product; },
    async listOrders() { return [...orders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
    async createOrder(input) {
      const productList = [...products.values()];
      const items = input.items.map((item) => {
        const product = productList.find((p) => p.id === item.productId);
        if (!product) throw new Error(`Unknown product ${item.productId}`);
        return { productId: product.id, title: product.title, price: product.price, quantity: item.quantity };
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const order: Order = { id: `ord_${nanoid(8)}`, email: input.email, items, subtotal, total: subtotal, status: 'pending_payment', createdAt: new Date().toISOString() };
      orders.push(order);
      return order;
    }
  };
}
