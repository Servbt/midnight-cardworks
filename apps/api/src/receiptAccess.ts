import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Order } from './types.js';

export const newReceiptToken = () => randomBytes(32).toString('base64url');
export const hashReceiptToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function receiptTokenMatches(token: unknown, hash: string | undefined) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !hash || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashReceiptToken(token), 'hex'), Buffer.from(hash, 'hex'));
}

export function publicOrder(order: Order) {
  const { receiptTokenHash: _hash, checkoutRequestJson: _request, inventoryReserved: _reserved, reservationExpiresAt: _expires, ...safe } = order;
  return safe;
}

export function orderReceipt(order: Order) {
  return {
    id: order.id, status: order.status, shippingAddress: order.shippingAddress,
    subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total,
    refundedAmount: order.refundedAmount,
    items: order.items.map(({ title, quantity, price }) => ({ title, quantity, price }))
  };
}
