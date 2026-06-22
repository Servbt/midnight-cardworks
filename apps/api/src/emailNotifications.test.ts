import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailNotifierFromEnv } from './emailNotifications.js';
import type { Order } from './types.js';

function sentEmailBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as unknown as [unknown, { body: string }];
  return JSON.parse(call[1].body) as { from?: string; to?: string[]; subject?: string };
}

const order: Order = {
  id: 'ord_pending',
  email: 'buyer@example.com',
  customerName: 'Ari Buyer',
  shippingAddress: '123 Midnight Lane, Orlando 32812',
  items: [{ productId: 'p1', title: 'Midnight Token Pack', price: 899, quantity: 1 }],
  subtotal: 899,
  shippingCost: 499,
  total: 1398,
  status: 'pending_payment',
  stripeSessionId: 'cs_test_pending',
  refundedAmount: 0,
  createdAt: '2026-06-22T00:00:00.000Z'
};

describe('createEmailNotifierFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends pending order owner alerts to ADMIN_EMAILS when ORDER_NOTIFICATION_EMAIL is not set', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Midnight Cardworks <orders@example.com>');
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com, helper@example.com');

    await createEmailNotifierFromEnv().sendOrderPending(order);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEmailBody(fetchMock)).toMatchObject({
      from: 'Midnight Cardworks <orders@example.com>',
      to: ['owner@example.com', 'helper@example.com'],
      subject: 'Pending checkout started ord_pending'
    });
  });

  it('prefers ORDER_NOTIFICATION_EMAIL over ADMIN_EMAILS for pending order owner alerts', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Midnight Cardworks <orders@example.com>');
    vi.stubEnv('ORDER_NOTIFICATION_EMAIL', 'orders@example.com');
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');

    await createEmailNotifierFromEnv().sendOrderPending(order);

    expect(sentEmailBody(fetchMock)).toMatchObject({
      to: ['orders@example.com'],
      subject: 'Pending checkout started ord_pending'
    });
  });
});