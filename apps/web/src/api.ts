export type Product = { id:string; slug:string; title:string; description:string; price:number; category:string; tags:string[]; image:string; inventory:number; active:boolean; featured?:boolean };
export type Order = { id:string; email:string; total:number; status:string; items:Array<{title:string;quantity:number;price:number}> };
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
export async function fetchProducts(): Promise<Product[]> { const r = await fetch(`${API}/api/products`); return (await r.json()).products; }
export async function createCheckout(email:string, items:Array<{productId:string;quantity:number}>): Promise<{orderId:string;checkoutUrl:string;total:number}> { const r = await fetch(`${API}/api/checkout`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, items}) }); if(!r.ok) throw new Error('Checkout failed'); return r.json(); }
export async function fetchAdminOrders(): Promise<Order[]> { const r = await fetch(`${API}/api/admin/orders`); return (await r.json()).orders; }
