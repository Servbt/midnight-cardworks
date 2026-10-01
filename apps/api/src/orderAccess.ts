import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Order } from './types.js';

/** Receipt links are bearer capabilities for the order page, which shows the shipping address. */
export const receiptLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export function receiptExpiryFrom(now: number = Date.now()) {
  return new Date(now + receiptLifetimeMs).toISOString();
}

export function hashReceiptToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function createReceiptAccess() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashReceiptToken(token) };
}
export function canReadReceipt(order: Order, token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !order.receiptTokenHash) return false;
  // Orders created before receipt expiry existed carry no expiry and stay readable so
  // existing customers are not locked out of receipts they were already sent.
  if (order.receiptExpiresAt && Date.now() >= new Date(order.receiptExpiresAt).getTime()) return false;
  const expected = Buffer.from(order.receiptTokenHash, 'hex');
  const actual = Buffer.from(hashReceiptToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
/** Explicit allowlist: payment identifiers, access hashes and internal notes stay private. */
export function customerOrder(order: Order) {
  return {
    id: order.id, status: order.status, fulfillmentOnHold: !!order.inventoryIssue, shippingAddress: order.shippingAddress,
    items: order.items.map(({ title, price, quantity }) => ({ title, price, quantity })),
    subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total, discountAmount: order.discountAmount ?? 0, paidAt: order.paidAt,
    refundedAmount: order.refundedAmount, createdAt: order.createdAt,
    canceledAt: order.canceledAt, refundedAt: order.refundedAt
  };
}
