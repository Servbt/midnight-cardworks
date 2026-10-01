import type { FastifyRequest } from 'fastify';

export type StripeWebhookEvent = {
  id?: string;
  created?: number;
  type?: string;
  data?: { object?: Record<string, unknown> | null };
};

export async function parseStripeWebhookEvent(request: FastifyRequest): Promise<StripeWebhookEvent> {
  const signature = request.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (webhookSecret) {
    if (typeof signature !== 'string' || !signature || !('rawBody' in request) || !request.rawBody) {
      throw new Error('Stripe webhook signature required');
    }
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_signature_verification');
    return stripe.webhooks.constructEvent(request.rawBody as string | Buffer, signature, webhookSecret) as unknown as StripeWebhookEvent;
  }

  if (isProduction) {
    throw new Error('Stripe webhook secret is required in production');
  }

  return request.body as StripeWebhookEvent;
}
