import type Stripe from 'stripe';
import type { Order } from './types.js';

export function checkoutRequest(order: Order, appBaseUrl: string): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    customer_email: order.email,
    line_items: [
      ...order.items.map((item) => ({ quantity: item.quantity, price_data: { currency: 'usd', unit_amount: item.price, product_data: { name: item.title } } })),
      ...(order.shippingCost > 0 ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: order.shippingCost, product_data: { name: 'Flat-rate shipping' } } }] : [])
    ],
    metadata: { orderId: order.id },
    allow_promotion_codes: true,
    ...(order.reservationExpiresAt ? { expires_at: Math.floor(new Date(order.reservationExpiresAt).getTime() / 1000) } : {}),
    success_url: `${appBaseUrl}/checkout/success?order=${order.id}`,
    cancel_url: `${appBaseUrl}/cart?order=${order.id}`
  };
}
