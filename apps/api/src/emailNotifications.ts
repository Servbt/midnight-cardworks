import type { MarketingSubscriber, Order } from './types.js';

export type ContactMessage = { name: string; email: string; orderNumber?: string; message: string };
export type MarketingCampaign = { subject: string; message: string };

export type EmailNotifier = {
  sendOrderPending(order: Order): Promise<void>;
  sendOrderPaid(order: Order): Promise<void>;
  sendOrderFulfilled(order: Order): Promise<void>;
  sendOrderCanceled(order: Order): Promise<void>;
  sendOrderRefunded(order: Order): Promise<void>;
  sendOrderRefundFailed(order: Order): Promise<void>;
  sendContactMessage(message: ContactMessage): Promise<void>;
  sendMarketingWelcome(subscriber: MarketingSubscriber): Promise<void>;
  sendMarketingCampaign(subscriber: MarketingSubscriber, campaign: MarketingCampaign): Promise<void>;
};

export type ResendEmail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

const newline = String.fromCharCode(10);
const parseEmailList = (value?: string) => (value ?? '').split(',').map((email) => email.trim()).filter(Boolean);
const ownerNotificationEmails = () => {
  const explicit = parseEmailList(process.env.ORDER_NOTIFICATION_EMAIL);
  return explicit.length > 0 ? explicit : parseEmailList(process.env.ADMIN_EMAILS);
};
const money = (cents: number) => '$' + (cents / 100).toFixed(2);
const orderLines = (order: Order) => order.items.map((item) => '- ' + item.quantity + ' x ' + item.title + ' - ' + money(item.price * item.quantity)).join(newline);
const appBaseUrl = () => {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  return base.endsWith('/') ? base.slice(0, -1) : base;
};

function marketingFooter(subscriber: MarketingSubscriber) {
  const address = process.env.MARKETING_POSTAL_ADDRESS;
  if (!address) return undefined;
  const unsubscribeUrl = appBaseUrl() + '/unsubscribe?token=' + encodeURIComponent(subscriber.unsubscribeToken);
  return {
    unsubscribeUrl,
    text: [
      '',
      'You are receiving this because you signed up for Midnight Cardworks deals and product updates.',
      'Unsubscribe: ' + unsubscribeUrl,
      'Postal address: ' + address
    ].join(newline)
  };
}

function buildPendingOrderAdminEmail(order: Order): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  const to = ownerNotificationEmails();
  if (!from || to.length === 0) return undefined;
  return {
    from,
    to,
    subject: 'Pending checkout started ' + order.id,
    text: [
      'A Midnight Cardworks checkout order was created and is waiting for payment.',
      '',
      'Order: ' + order.id,
      'Customer: ' + order.email,
      order.customerName ? 'Name: ' + order.customerName : undefined,
      order.shippingAddress ? 'Ship to: ' + order.shippingAddress : undefined,
      order.stripeSessionId ? 'Stripe Checkout Session: ' + order.stripeSessionId : undefined,
      'Status: ' + order.status,
      'Total: ' + money(order.total),
    order.discountAmount ? 'Discount: ' + money(order.discountAmount) : undefined,
      '',
      orderLines(order),
      '',
      'Do not fulfill until Stripe confirms payment or the admin sync marks it paid.'
    ].filter(Boolean).join(newline)
  };
}
function buildPaidEmail(order: Order): { customer: ResendEmail; admin?: ResendEmail } | undefined {
  const from = process.env.EMAIL_FROM;
  if (!from) return undefined;
  const customerName = order.customerName ? ' ' + order.customerName : '';
  const text = [
    'Thanks' + customerName + ' - your Midnight Cardworks order is confirmed.',
    '',
    'Order: ' + order.id,
    'Total: ' + money(order.total),
    order.discountAmount ? 'Discount: ' + money(order.discountAmount) : undefined,
    order.shippingAddress ? 'Ship to: ' + order.shippingAddress : undefined,
    '',
    orderLines(order),
    '',
    'We will prepare it for fulfillment.'
  ].filter(Boolean).join(newline);
  const customer: ResendEmail = { from, to: [order.email], subject: 'Order ' + order.id + ' confirmed', text };
  const adminTo = ownerNotificationEmails();
  const admin = adminTo.length > 0 ? { from, to: adminTo, subject: 'New paid order ' + order.id, text: ['New paid order from ' + order.email, order.customerName ? 'Name: ' + order.customerName : undefined, order.shippingAddress ? 'Ship to: ' + order.shippingAddress : undefined, 'Total: ' + money(order.total), '', orderLines(order)].filter(Boolean).join(newline) } : undefined;
  return { customer, admin };
}

function buildFulfilledEmail(order: Order): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  if (!from) return undefined;
  return {
    from,
    to: [order.email],
    subject: 'Order ' + order.id + ' fulfilled',
    text: ['Good news - your Midnight Cardworks order has been marked fulfilled.', '', 'Order: ' + order.id, order.shippingAddress ? 'Ship to: ' + order.shippingAddress : undefined, '', 'Thanks again for supporting the shop.'].filter(Boolean).join(newline)
  };
}

function buildCanceledEmail(order: Order): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  if (!from) return undefined;
  return {
    from,
    to: [order.email],
    subject: 'Order ' + order.id + ' canceled',
    text: [
      'Your Midnight Cardworks order has been canceled.',
      '',
      'Order: ' + order.id,
      order.refundReason ? 'Note: ' + order.refundReason : undefined,
      '',
      'No payment was captured for this order.'
    ].filter(Boolean).join(newline)
  };
}

function buildRefundedEmail(order: Order): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  if (!from) return undefined;
  const refundedAmount = order.refundedAmount > 0 ? order.refundedAmount : order.total;
  const isFullRefund = refundedAmount >= order.total;
  return {
    from,
    to: [order.email],
    subject: 'Order ' + order.id + ' ' + (isFullRefund ? 'refunded' : 'partially refunded'),
    text: [
      'Your Midnight Cardworks order has been ' + (isFullRefund ? 'refunded' : 'partially refunded') + '.',
      '',
      'Order: ' + order.id,
      'Refunded to date: ' + money(refundedAmount),
      'Order total: ' + money(order.total),
      order.refundReason ? 'Note: ' + order.refundReason : undefined,
      '',
      'Your bank or card issuer may take a few business days to post the refund.'
    ].filter(Boolean).join(newline)
  };
}

function buildRefundFailedEmail(order: Order): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  if (!from) return undefined;
  return {
    from,
    to: [order.email],
    subject: 'Refund update for order ' + order.id,
    text: [
      'We tried to refund your Midnight Cardworks order, but Stripe reported that the refund failed.',
      '',
      'Order: ' + order.id,
      order.refundReason ? 'Note: ' + order.refundReason : undefined,
      '',
      'We will review the payment and follow up with the next step.'
    ].filter(Boolean).join(newline)
  };
}

function buildContactEmail(message: ContactMessage): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  const to = ownerNotificationEmails();
  if (!from || to.length === 0) return undefined;
  return {
    from,
    to,
    reply_to: message.email,
    subject: 'New Midnight Cardworks message from ' + message.name,
    text: [
      'New customer message from ' + message.name,
      'Email: ' + message.email,
      message.orderNumber ? 'Order: ' + message.orderNumber : undefined,
      '',
      message.message
    ].filter(Boolean).join(newline)
  };
}

function buildMarketingWelcomeEmail(subscriber: MarketingSubscriber): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  const footer = marketingFooter(subscriber);
  if (!from || !footer) return undefined;
  return {
    from,
    to: [subscriber.email],
    subject: 'Your Midnight Cardworks launch coupon',
    text: [
      subscriber.name ? 'Welcome, ' + subscriber.name + '.' : 'Welcome to Midnight Cardworks.',
      '',
      'Your launch coupon code is ' + subscriber.couponCode + '.',
      'Enter it during Stripe Checkout when promotion codes are enabled for the shop.',
      '',
      'You will get occasional notes about new cards, sale drops, and launch-only offers.',
      footer.text
    ].join(newline),
    headers: { 'List-Unsubscribe': '<' + footer.unsubscribeUrl + '>' }
  };
}

function buildMarketingCampaignEmail(subscriber: MarketingSubscriber, campaign: MarketingCampaign): ResendEmail | undefined {
  const from = process.env.EMAIL_FROM;
  const footer = marketingFooter(subscriber);
  if (!from || !footer) return undefined;
  return {
    from,
    to: [subscriber.email],
    subject: campaign.subject,
    text: [campaign.message, footer.text].join(newline),
    headers: { 'List-Unsubscribe': '<' + footer.unsubscribeUrl + '>' }
  };
}

export async function sendResend(email: ResendEmail, idempotencyKey?: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { if (idempotencyKey) throw new Error('RESEND_API_KEY is missing'); return; }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(email)
  });
  if (!response.ok) throw new Error('Email send failed with ' + response.status);
}

export function createEmailNotifierFromEnv(): EmailNotifier {
  return {
    async sendOrderPending(order) {
      const email = buildPendingOrderAdminEmail(order);
      if (!email) return;
      await sendResend(email);
    },
    async sendOrderPaid(order) {
      const emails = buildPaidEmail(order);
      if (!emails) return;
      await sendResend(emails.customer);
      if (emails.admin) await sendResend(emails.admin);
    },
    async sendOrderFulfilled(order) {
      const email = buildFulfilledEmail(order);
      if (!email) return;
      await sendResend(email);
    },
    async sendOrderCanceled(order) {
      const email = buildCanceledEmail(order);
      if (!email) return;
      await sendResend(email);
    },
    async sendOrderRefunded(order) {
      const email = buildRefundedEmail(order);
      if (!email) return;
      await sendResend(email);
    },
    async sendOrderRefundFailed(order) {
      const email = buildRefundFailedEmail(order);
      if (!email) return;
      await sendResend(email);
    },
    async sendContactMessage(message) {
      const email = buildContactEmail(message);
      if (!email) return;
      await sendResend(email);
    },
    async sendMarketingWelcome(subscriber) {
      const email = buildMarketingWelcomeEmail(subscriber);
      if (!email) return;
      await sendResend(email);
    },
    async sendMarketingCampaign(subscriber, campaign) {
      const email = buildMarketingCampaignEmail(subscriber, campaign);
      if (!email) return;
      await sendResend(email);
    }
  };
}

/** Render once, then persist each recipient's exact payload before the first send. */
export function buildOrderNotification(kind: import('./paymentState.js').NotificationKind, order: Order): ResendEmail[] {
  if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is missing');
  if (kind === 'Paid') {
    const emails = buildPaidEmail(order)!;
    return [emails.customer, ...(emails.admin ? [emails.admin] : [])];
  }
  const email = kind === 'Pending' ? buildPendingOrderAdminEmail(order)
    : kind === 'Fulfilled' ? buildFulfilledEmail(order)
    : kind === 'Canceled' ? buildCanceledEmail(order)
    : kind === 'Refunded' ? buildRefundedEmail(order) : buildRefundFailedEmail(order);
  if (!email) throw new Error('Notification recipient configuration is missing');
  return [email];
}
