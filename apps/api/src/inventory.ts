import type { CartItemInput, Order, Product, Store } from './types.js';

export const reservationDurationMs = 60 * 60 * 1000;
export class InventoryError extends Error { statusCode = 409; }
export function availableProduct(product: Product): Product {
  return { ...product, inventory: Math.max(0, product.inventory - (product.reservedInventory ?? 0)) };
}
export function normalizeCart(items: CartItemInput[], existingOrder = false) {
  if (!items.length || (!existingOrder && items.length > 100)) throw new InventoryError('Cart must contain between 1 and 100 lines');
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new InventoryError('Invalid cart quantity');
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > (existingOrder ? 2147483647 : 99)) throw new InventoryError('Maximum quantity is 99 per product');
    quantities.set(item.productId, quantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }));
}
const held = (order: Order) => ['held', 'legacy_held'].includes(order.inventoryState ?? '');
export async function releaseStock(tx: Store, order: Order) {
  if (held(order)) {
    for (const item of normalizeCart(order.items, true)) {
      if (!await tx.adjustInventory(item.productId, item.quantity, 'release')) throw new Error('Reservation accounting mismatch');
    }
  }
  if (order.inventoryState !== 'consumed') order.inventoryState = 'released';
}
/** Payment is always recorded, even when an old/released checkout has no stock.
 * Such an order is held for review and cannot be fulfilled until allocated. */
export async function commitStock(tx: Store, order: Order, previouslyPaid = false) {
  if (order.inventoryState === 'consumed' || (previouslyPaid && order.status === 'refunded')) return;
  if (previouslyPaid && (!order.inventoryState || ['legacy', 'legacy_held'].includes(order.inventoryState))) {
    if (held(order)) await releaseStock(tx, order);
    order.inventoryState = 'consumed';
    return;
  }
  const items = normalizeCart(order.items, true);
  const products = await tx.listAdminProducts();
  const isHeld = held(order);
  const enough = items.every(item => {
    const product = products.find(p => p.id === item.productId);
    return product && (isHeld ? product.inventory >= item.quantity && (product.reservedInventory ?? 0) >= item.quantity : product.inventory - (product.reservedInventory ?? 0) >= item.quantity);
  });
  if (!enough) {
    if (isHeld) await releaseStock(tx, order);
    order.inventoryState = 'attention';
    order.inventoryIssue = 'Payment received without enough allocatable stock. Replenish and sync payment, or refund; do not fulfill.';
    return;
  }
  for (const item of items) {
    if (!await tx.adjustInventory(item.productId, item.quantity, isHeld ? 'consume' : 'purchase')) throw new Error('Inventory changed during payment allocation');
  }
  order.inventoryState = 'consumed';
  order.inventoryIssue = undefined;
}
export function inventoryMethods(getStore: () => Store): Pick<Store, 'createOrder' | 'upsertProduct'> {
  return {
    createOrder: input => getStore().atomic(async tx => {
      const items = normalizeCart(input.items);
      const order = await tx.createUnreservedOrder({ ...input, items });
      for (const item of items) {
        if (!await tx.adjustInventory(item.productId, item.quantity, 'reserve')) throw new InventoryError('An item is unavailable or has insufficient stock. Refresh your cart and try again');
      }
      order.inventoryState = 'held';
      order.reservationExpiresAt = new Date(Date.now() + reservationDurationMs).toISOString();
      return tx.saveOrder(order);
    }),
    upsertProduct: product => getStore().atomic(async tx => {
      if (!Number.isSafeInteger(product.inventory) || product.inventory < 0) throw new InventoryError('Inventory must be a nonnegative whole number');
      const current = (await tx.listAdminProducts()).find(p => p.id === product.id || p.slug === product.slug);
      if (current && product.inventoryVersion !== (current.inventoryVersion ?? 0)) throw new InventoryError('Stock changed since this listing was loaded. Refresh the admin dashboard before saving');
      if (product.inventory < (current?.reservedInventory ?? 0)) throw new InventoryError('Inventory cannot be lower than stock held by active checkouts');
      return tx.writeProduct({ ...product, reservedInventory: current?.reservedInventory ?? 0, inventoryVersion: (current?.inventoryVersion ?? -1) + 1 });
    })
  };
}
