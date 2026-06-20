export type Product = { id:string; slug:string; title:string; description:string; price:number; saleActive:boolean; salePrice:number|null; category:string; tags:string[]; image:string; inventory:number; active:boolean; featured?:boolean };
export type Order = { id:string; email:string; customerName?:string; shippingAddress?:string; subtotal?:number; shippingCost?:number; total:number; status:string; stripeSessionId?:string; stripePaymentIntentId?:string; stripeRefundId?:string; refundedAmount:number; refundReason?:string; canceledAt?:string; refundedAt?:string; items:Array<{title:string;quantity:number;price:number}> };
export type ContactPayload = { name:string; email:string; orderNumber?:string; message:string; website?:string };
export type ShippingAddressFields = { streetAddress:string; apartment:string; city:string; zipCode:string };
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

export async function fetchProducts(): Promise<Product[]> { const r = await fetch(`${API}/api/products`); return (await r.json()).products; }
export async function fetchProduct(slug: string): Promise<Product> { const r = await fetch(`${API}/api/products/${slug}`); if(!r.ok) throw new Error('Product not found'); return (await r.json()).product; }
export async function createCheckout(email:string, customerName:string, shippingAddressFields:ShippingAddressFields, items:Array<{productId:string;quantity:number}>): Promise<{orderId:string;checkoutUrl:string;subtotal:number;shippingCost:number;total:number}> { const r = await fetch(`${API}/api/checkout`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, customerName, shippingAddressFields, items}) }); if(!r.ok) throw new Error('Checkout failed'); return r.json(); }
export async function fetchOrder(orderId: string): Promise<Order> { const r = await fetch(`${API}/api/orders/${orderId}`); if(!r.ok) throw new Error('Order not found'); return (await r.json()).order; }
export async function fetchCustomerOrders(token?: string): Promise<Order[]> { const r = await fetch(`${API}/api/orders`, { headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error('Orders not found'); return (await r.json()).orders; }
export async function sendContactMessage(payload: ContactPayload): Promise<void> { const r = await fetch(`${API}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error('Message send failed'); }
export async function fetchAdminOrders(token?: string): Promise<Order[]> { const r = await fetch(`${API}/api/admin/orders`, { headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).orders; }
export async function fetchAdminProducts(token?: string): Promise<Product[]> { const r = await fetch(`${API}/api/admin/products`, { headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).products; }
export async function saveAdminProduct(product: Product, token?: string): Promise<Product> { const { id, ...rest } = product; const payload = id ? product : rest; const r = await fetch(`${API}/api/admin/products`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error('Product save failed'); return (await r.json()).product; }
export async function syncAdminOrderPayment(orderId: string, token?: string): Promise<Order> { const r = await fetch(`${API}/api/admin/orders/${orderId}/sync-payment`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error(await errorMessage(r, 'Payment sync failed')); return (await r.json()).order; }
export async function fulfillAdminOrder(orderId: string, token?: string): Promise<Order> { const r = await fetch(`${API}/api/admin/orders/${orderId}/fulfill`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error('Order fulfillment failed'); return (await r.json()).order; }
export async function cancelAdminOrder(orderId: string, reason: string, token?: string): Promise<Order> { const r = await fetch(`${API}/api/admin/orders/${orderId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ reason }) }); if(!r.ok) throw new Error(await errorMessage(r, 'Order cancellation failed')); return (await r.json()).order; }
export async function refundAdminOrder(orderId: string, payload: { amount?: number; reason?: string }, token?: string): Promise<Order> { const r = await fetch(`${API}/api/admin/orders/${orderId}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) }); if(!r.ok) throw new Error(await errorMessage(r, 'Order refund failed')); return (await r.json()).order; }
export async function uploadProductImage(slug: string, file: File, token?: string): Promise<Product> {
  const dataUrl = await readFileAsDataUrl(file);
  const r = await fetch(`${API}/api/admin/products/${slug}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, dataUrl })
  });
  if (!r.ok) throw new Error('Image upload failed');
  return (await r.json()).product;
}
