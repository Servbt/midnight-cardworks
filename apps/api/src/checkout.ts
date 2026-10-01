import { stripeSecret as configuredStripeSecret } from './productionConfig.js';
import type { Order } from './types.js';

function stripeId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

export async function createCheckoutResponse(order: Order, receiptToken: string, idempotencyKey = `checkout:${order.id}`) {
  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  const stripeSecret = configuredStripeSecret();
  const receiptPath = `/checkout/success?order=${encodeURIComponent(order.id)}#receiptToken=${encodeURIComponent(receiptToken)}`;

  if (stripeSecret && !stripeSecret.includes('replace_me')) {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeSecret, { timeout: 20000, maxNetworkRetries: 1 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(order.reservationExpiresAt ? { expires_at: Math.floor(new Date(order.reservationExpiresAt).getTime() / 1000) } : {}),
      customer_email: order.email,
      line_items: [
        ...order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: item.price,
          product_data: { name: item.title }
        }
        })),
        ...(order.shippingCost > 0 ? [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: order.shippingCost,
            product_data: { name: 'Flat-rate shipping' }
          }
        }] : [])
      ],
      metadata: { orderId: order.id },
      payment_intent_data: { metadata: { orderId: order.id } },
      allow_promotion_codes: true,
      success_url: `${appBaseUrl}${receiptPath}`,
      cancel_url: `${appBaseUrl}/cart?order=${order.id}`
    }, { idempotencyKey });
    if (!session.url) throw new Error('Stripe returned no Checkout URL');
    return { orderId: order.id, checkoutUrl: session.url, status: order.status, subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total, stripeSessionId: session.id, stripePaymentIntentId: stripeId(session.payment_intent) };
  }

  return { orderId: order.id, checkoutUrl: receiptPath, status: order.status, subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total };
}
