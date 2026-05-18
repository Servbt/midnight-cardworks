export type Product = { id:string; slug:string; title:string; description:string; price:number; category:string; tags:string[]; image:string; inventory:number; active:boolean; featured?:boolean };
export type Order = { id:string; email:string; total:number; status:string; items:Array<{title:string;quantity:number;price:number}> };
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

export async function fetchProducts(): Promise<Product[]> { const r = await fetch(`${API}/api/products`); return (await r.json()).products; }
export async function createCheckout(email:string, items:Array<{productId:string;quantity:number}>): Promise<{orderId:string;checkoutUrl:string;total:number}> { const r = await fetch(`${API}/api/checkout`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, items}) }); if(!r.ok) throw new Error('Checkout failed'); return r.json(); }
export async function fetchOrder(orderId: string): Promise<Order> { const r = await fetch(`${API}/api/orders/${orderId}`); if(!r.ok) throw new Error('Order not found'); return (await r.json()).order; }
export async function fetchAdminOrders(token?: string): Promise<Order[]> { const r = await fetch(`${API}/api/admin/orders`, { headers: token ? { authorization: `Bearer ${token}` } : undefined }); if(!r.ok) throw new Error('Admin access required'); return (await r.json()).orders; }
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
