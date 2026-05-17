import type { Order } from './types.js';

export async function createCheckoutResponse(order: Order) {
  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  const stripeSecret = process.env.STRIPE_SECRET_KEY;

  if (stripeSecret && !stripeSecret.includes('replace_me')) {
    const stripeModule = await import('stripe');
    const StripeClient = stripeModule as unknown as { new (key: string): { checkout: { sessions: { create(input: unknown): Promise<{ url: string | null }> } } } };
    const stripe = new StripeClient(stripeSecret);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: order.email,
      line_items: order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: item.price,
          product_data: { name: item.title }
        }
      })),
      metadata: { orderId: order.id },
      success_url: `${appBaseUrl}/checkout/success?order=${order.id}`,
      cancel_url: `${appBaseUrl}/cart?order=${order.id}`
    });
    return { orderId: order.id, checkoutUrl: session.url, status: order.status, total: order.total };
  }

  return { orderId: order.id, checkoutUrl: `/checkout/success?order=${order.id}`, status: order.status, total: order.total };
}
