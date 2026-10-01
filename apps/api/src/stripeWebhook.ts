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
    if (!signature || !('rawBody' in request) || !request.rawBody) {
      throw new Error('Stripe webhook signature required');
    }
    const { default: StripeClient } = await import('stripe');
    const stripe = new StripeClient(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');
    const event = stripe.webhooks.constructEvent(request.rawBody as string | Buffer, signature, webhookSecret);
    return { type: event.type, data: { object: { ...event.data.object } } };
  }

  if (isProduction) {
    throw new Error('Stripe webhook secret is required in production');
  }

  return request.body as StripeWebhookEvent;
}

export function getCompletedCheckout(event: StripeWebhookEvent): { orderId: string; stripeSessionId?: string; stripePaymentIntentId?: string } | undefined {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type ?? '')) return undefined;
  const object = event.data?.object ?? undefined;
  if (object?.payment_status !== 'paid' && object?.payment_status !== 'no_payment_required') return undefined;
  if (object.payment_status === 'no_payment_required' && object.amount_total !== 0) return undefined;
  if (object.status !== undefined && object.status !== 'complete') return undefined;
  const orderId = metadataValue(object, 'orderId');
  if (!orderId) return undefined;
  return {
    orderId,
    stripeSessionId: stringValue(object?.id),
    stripePaymentIntentId: stringValue(object?.payment_intent)
  };
}

export function getReleasedCheckout(event: StripeWebhookEvent) {
  if (!['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type ?? '')) return undefined;
  const object = event.data?.object ?? undefined;
  const orderId = metadataValue(object, 'orderId');
  const sessionId = stringValue(object?.id);
  return orderId && sessionId ? { orderId, sessionId, failedPayment: event.type === 'checkout.session.async_payment_failed' } : undefined;
}

export function getRefundUpdate(event: StripeWebhookEvent): { orderId: string; refundId?: string; amount: number; status?: string; reason?: string } | undefined {
  if (!['refund.created', 'refund.updated', 'refund.failed'].includes(event.type ?? '')) return undefined;
  const object = event.data?.object ?? undefined;
  const orderId = metadataValue(object, 'orderId');
  const amount = typeof object?.amount === 'number' ? object.amount : 0;
  if (!orderId || !Number.isSafeInteger(amount) || amount <= 0 || !stringValue(object?.id)) return undefined;
  const reason = metadataValue(object, 'reason') ?? (typeof object?.failure_reason === 'string' ? object.failure_reason : undefined);
  return {
    orderId,
    refundId: stringValue(object?.id),
    amount,
    status: object?.status === 'canceled' ? 'failed' : typeof object?.status === 'string' ? object.status : event.type === 'refund.failed' ? 'failed' : undefined,
    reason
  };
}
