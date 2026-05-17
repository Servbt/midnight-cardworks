import type { FastifyRequest } from 'fastify';

type StripeWebhookEvent = {
  type?: string;
  data?: { object?: { metadata?: { orderId?: string | null } | null } | null };
};

export async function parseStripeWebhookEvent(request: FastifyRequest): Promise<StripeWebhookEvent> {
  const signature = request.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (webhookSecret && signature && 'rawBody' in request && request.rawBody) {
    const stripeModule = await import('stripe');
    const StripeClient = stripeModule as unknown as { new (key: string): { webhooks: { constructEvent(rawBody: string | Buffer, signature: string | string[], secret: string): StripeWebhookEvent } } };
    const stripe = new StripeClient(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');
    return stripe.webhooks.constructEvent(request.rawBody as string | Buffer, signature, webhookSecret);
  }

  return request.body as StripeWebhookEvent;
}

export function getCompletedCheckoutOrderId(event: StripeWebhookEvent): string | undefined {
  if (event.type !== 'checkout.session.completed') return undefined;
  return event.data?.object?.metadata?.orderId ?? undefined;
}
