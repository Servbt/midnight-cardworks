import type { Order } from './types.js';
export function createCheckoutResponse(order: Order) {
  return { orderId: order.id, checkoutUrl: `/checkout/success?order=${order.id}`, status: order.status, total: order.total };
}
