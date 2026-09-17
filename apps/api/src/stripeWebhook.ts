import type { FastifyRequest } from 'fastify';

type StripeWebhookEvent = {
  type?: string;
  data?: { object?: Record<string, unknown> | null };
};

function stringValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return undefined;
}

function metadataValue(object: Record<string, unknown> | undefined, key: string) {
  const metadata = object?.metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

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

export function getCompletedCheckout(event: StripeWebhookEvent): { orderId: string; stripeSessionId?: string; stripePaymentIntentId?: string } | undefined {
  if (event.type !== 'checkout.session.completed') return undefined;
  const object = event.data?.object ?? undefined;
  const orderId = metadataValue(object, 'orderId');
  if (!orderId) return undefined;
  return {
    orderId,
    stripeSessionId: stringValue(object?.id),
    stripePaymentIntentId: stringValue(object?.payment_intent)
  };
}

export function getRefundUpdate(event: StripeWebhookEvent): { orderId: string; refundId?: string; amount: number; status?: string; reason?: string } | undefined {
  if (!['refund.created', 'refund.updated', 'refund.failed', 'charge.refunded'].includes(event.type ?? '')) return undefined;
  const object = event.data?.object ?? undefined;
  const orderId = metadataValue(object, 'orderId');
  const amount = typeof object?.amount === 'number' ? object.amount : typeof object?.amount_refunded === 'number' ? object.amount_refunded : 0;
  if (!orderId || amount <= 0) return undefined;
  const reason = metadataValue(object, 'reason') ?? (typeof object?.failure_reason === 'string' ? object.failure_reason : undefined);
  return {
    orderId,
    refundId: stringValue(object?.id),
    amount,
    status: typeof object?.status === 'string' ? object.status : event.type === 'refund.failed' ? 'failed' : undefined,
    reason
  };
}
