import { retryKey, finishRequest } from './requestRetry';
export type Product = { id:string; slug:string; title:string; description:string; price:number; saleActive:boolean; salePrice:number|null; category:string; tags:string[]; image:string; inventory:number; reservedInventory?:number; inventoryVersion?:number; active:boolean; featured?:boolean };
export type Order = { id:string; email:string; customerName?:string; shippingAddress?:string; subtotal?:number; shippingCost?:number; total:number; status:string; stripeSessionId?:string; stripePaymentIntentId?:string; stripeRefundId?:string; refundedAmount:number; inventoryIssue?:string; fulfillmentOnHold?:boolean; discountAmount?:number; paidAt?:string; refundReason?:string; canceledAt?:string; refundedAt?:string; items:Array<{title:string;quantity:number;price:number}> };
export type CustomerOrder = Pick<Order, 'id' | 'shippingAddress' | 'subtotal' | 'shippingCost' | 'total' | 'status' | 'refundedAmount' | 'fulfillmentOnHold' | 'discountAmount' | 'paidAt' | 'canceledAt' | 'refundedAt' | 'items'>;
export type ContactPayload = { name:string; email:string; orderNumber?:string; message:string; website?:string };
export type ShippingAddressFields = { streetAddress:string; apartment:string; city:string; zipCode:string };
export type MarketingSubscriber = { id:string; email:string; name?:string; status:'subscribed'|'unsubscribed'; source:string; couponCode:string; consentedAt:string; unsubscribedAt?:string; createdAt:string; updatedAt:string };
export type NewsletterSignupPayload = { name?:string; email:string; marketingConsent:boolean; website?:string };
export type MarketingCampaignPayload = { subject:string; message:string };
export type FaqItem = { id:string; question:string; answer:string; sortOrder:number; active:boolean; createdAt:string; updatedAt:string };
export type BlogPost = { id:string; slug:string; title:string; excerpt:string; body:string; published:boolean; publishedAt?:string; createdAt:string; updatedAt:string };
export type AdminContent = { faqItems:FaqItem[]; blogPosts:BlogPost[] };
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

export async function fetchProducts(): Promise<Product[]> { const r = await fetch(API + '/api/products'); return (await r.json()).products; }
export async function fetchProduct(slug: string): Promise<Product> { const r = await fetch(API + '/api/products/' + slug); if(!r.ok) throw new Error('Product not found'); return (await r.json()).product; }
export async function fetchFaqItems(): Promise<FaqItem[]> { const r = await fetch(API + '/api/content/faqs'); if(!r.ok) throw new Error('FAQ not found'); return (await r.json()).faqItems; }
export async function fetchBlogPosts(): Promise<BlogPost[]> { const r = await fetch(API + '/api/content/blog-posts'); if(!r.ok) throw new Error('Blog not found'); return (await r.json()).blogPosts; }
export async function fetchBlogPost(slug: string): Promise<BlogPost> { const r = await fetch(API + '/api/content/blog-posts/' + slug); if(!r.ok) throw new Error('Blog post not found'); return (await r.json()).post; }
export async function createCheckout(email:string, customerName:string, shippingAddressFields:ShippingAddressFields, items:Array<{productId:string;quantity:number}>): Promise<{orderId:string;checkoutUrl:string;subtotal:number;shippingCost:number;total:number}> {
  const payload = { email, customerName, shippingAddressFields, items };
  const key = retryKey('checkout', payload);
  const r = await fetch(API + '/api/checkout', { method:'POST', headers:{'Content-Type':'application/json', 'Idempotency-Key': key}, body: JSON.stringify(payload) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (body.code === 'CHECKOUT_CLOSED') finishRequest('checkout', key);
    throw new Error(body.error ?? 'Checkout failed');
  }
  const result = await r.json();
  finishRequest('checkout', key);
  return result;
}
export async function fetchOrder(orderId: string, access: { receiptToken?: string; token?: string } = {}): Promise<CustomerOrder> {
  const headers: Record<string, string> = {};
  if (access.receiptToken) headers['x-receipt-token'] = access.receiptToken;
  else if (access.token) headers.authorization = 'Bearer ' + access.token;
  const r = await fetch(API + '/api/orders/' + encodeURIComponent(orderId), { headers, cache: 'no-store' });
  if (!r.ok) throw new Error('Open your private receipt link or sign in with the email used for this order.');
  return (await r.json()).order;
}
export async function fetchCustomerOrders(token?: string): Promise<CustomerOrder[]> { const r = await fetch(API + '/api/orders', { headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Orders not found'); return (await r.json()).orders; }
export async function sendContactMessage(payload: ContactPayload): Promise<void> { const r = await fetch(API + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error('Message send failed'); }
export async function subscribeNewsletter(payload: NewsletterSignupPayload): Promise<{ subscriber: MarketingSubscriber; created: boolean }> { const r = await fetch(API + '/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error(await errorMessage(r, 'Newsletter signup failed')); return r.json(); }
export async function unsubscribeNewsletter(token: string): Promise<MarketingSubscriber> { const r = await fetch(API + '/api/newsletter/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); if(!r.ok) throw new Error(await errorMessage(r, 'Unsubscribe failed')); return (await r.json()).subscriber; }
export async function fetchAdminOrders(token?: string): Promise<Order[]> { const r = await fetch(API + '/api/admin/orders', { headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).orders; }
export async function fetchAdminProducts(token?: string): Promise<Product[]> { const r = await fetch(API + '/api/admin/products', { headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).products; }
export async function fetchAdminContent(token?: string): Promise<AdminContent> { const r = await fetch(API + '/api/admin/content', { headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Admin access required'); return r.json(); }
export async function saveAdminFaqItem(item: FaqItem, token?: string): Promise<FaqItem> {
  const payload = { question: item.question, answer: item.answer, sortOrder: item.sortOrder, active: item.active, ...(item.id ? { id: item.id } : {}) };
  const r = await fetch(API + '/api/admin/content/faqs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
  if(!r.ok) throw new Error(await errorMessage(r, 'FAQ save failed'));
  return (await r.json()).faqItem;
}
export async function saveAdminBlogPost(post: BlogPost, token?: string): Promise<BlogPost> {
  const payload = { slug: post.slug, title: post.title, excerpt: post.excerpt, body: post.body, published: post.published, publishedAt: post.publishedAt ?? null, ...(post.id ? { id: post.id } : {}) };
  const r = await fetch(API + '/api/admin/content/blog-posts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
  if(!r.ok) throw new Error(await errorMessage(r, 'Blog post save failed'));
  return (await r.json()).blogPost;
}
export async function fetchAdminMarketingSubscribers(token?: string): Promise<MarketingSubscriber[]> { const r = await fetch(API + '/api/admin/marketing/subscribers', { headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).subscribers; }
export async function sendAdminMarketingCampaign(payload: MarketingCampaignPayload, token?: string): Promise<{ sent: number }> { const r = await fetch(API + '/api/admin/marketing/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error(await errorMessage(r, 'Campaign send failed')); return r.json(); }
export async function saveAdminProduct(product: Product, token?: string): Promise<Product> { const { id, ...rest } = product; const payload = id ? product : rest; const r = await fetch(API + '/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error('Product save failed'); return (await r.json()).product; }
export async function syncAdminOrderPayment(orderId: string, token?: string): Promise<Order> { const r = await fetch(API + '/api/admin/orders/' + orderId + '/sync-payment', { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error(await errorMessage(r, 'Payment sync failed')); return (await r.json()).order; }
export async function fulfillAdminOrder(orderId: string, token?: string): Promise<Order> { const r = await fetch(API + '/api/admin/orders/' + orderId + '/fulfill', { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : undefined }); if(!r.ok) throw new Error('Order fulfillment failed'); return (await r.json()).order; }
export async function cancelAdminOrder(orderId: string, reason: string, token?: string): Promise<Order> { const r = await fetch(API + '/api/admin/orders/' + orderId + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ reason }) }); if(!r.ok) throw new Error(await errorMessage(r, 'Order cancellation failed')); return (await r.json()).order; }
export async function refundAdminOrder(orderId: string, payload: { amount?: number; reason?: string }, token?: string): Promise<Order> {
  const scope = `refund:${orderId}`;
  const key = retryKey(scope, payload);
  const r = await fetch(API + '/api/admin/orders/' + orderId + '/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await errorMessage(r, 'Order refund failed'));
  const result = await r.json();
  finishRequest(scope, key);
  return result.order;
}
export async function uploadProductImage(slug: string, file: File, token?: string): Promise<Product> {
  const dataUrl = await readFileAsDataUrl(file);
  const r = await fetch(API + '/api/admin/products/' + slug + '/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, dataUrl })
  });
  if (!r.ok) throw new Error('Image upload failed');
  return (await r.json()).product;
}