import { stripeSecret as configuredStripeSecret } from './productionConfig.js';
import type { Order } from './types.js';

function stripeId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

export async function createCheckoutResponse(order: Order, receiptToken: string) {
  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  const stripeSecret = configuredStripeSecret();
  const receiptPath = `/checkout/success?order=${encodeURIComponent(order.id)}#receiptToken=${encodeURIComponent(receiptToken)}`;

  if (stripeSecret && !stripeSecret.includes('replace_me')) {
    const stripeModule = await import('stripe');
    const StripeClient = ((stripeModule as any).default ?? stripeModule) as { new (key: string): { checkout: { sessions: { create(input: unknown): Promise<{ id: string; url: string | null; payment_intent?: unknown }> } } } };
    const stripe = new StripeClient(stripeSecret);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
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
      allow_promotion_codes: true,
      success_url: `${appBaseUrl}${receiptPath}`,
      cancel_url: `${appBaseUrl}/cart?order=${order.id}`
    });
    return { orderId: order.id, checkoutUrl: session.url, status: order.status, subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total, stripeSessionId: session.id, stripePaymentIntentId: stripeId(session.payment_intent) };
  }

  return { orderId: order.id, checkoutUrl: receiptPath, status: order.status, subtotal: order.subtotal, shippingCost: order.shippingCost, total: order.total };
}
