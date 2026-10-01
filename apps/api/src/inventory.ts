import type { CartItemInput } from './types.js';

export const reservationDurationMs = 35 * 60 * 1000;

export function checkoutItems(items: CartItemInput[]): CartItemInput[] {
  if (!items.length || items.length > 100) throw new Error('Checkout requires between 1 and 100 items');
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new Error('Invalid checkout item');
    }
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (quantity > 99) throw new Error('Maximum quantity per product is 99');
    quantities.set(item.productId, quantity);
  }
  // Consistent row-lock ordering avoids deadlocks between overlapping carts.
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }));
}
