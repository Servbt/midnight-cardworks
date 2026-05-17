export type Product = { id: string; slug: string; title: string; description: string; price: number; category: string; tags: string[]; image: string; inventory: number; active: boolean; featured?: boolean; };
export type CartItemInput = { productId: string; quantity: number };
export type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled';
export type Order = { id: string; email: string; items: Array<{ productId: string; title: string; price: number; quantity: number }>; subtotal: number; total: number; status: OrderStatus; createdAt: string; };
export type Store = { listProducts(): Promise<Product[]>; getProduct(slug: string): Promise<Product | undefined>; upsertProduct(product: Product): Promise<Product>; listOrders(): Promise<Order[]>; createOrder(input: { email: string; items: CartItemInput[] }): Promise<Order>; };
