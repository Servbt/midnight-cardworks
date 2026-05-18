import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { redirectToCheckout } from './checkoutRedirect';

const mockAuth = vi.hoisted(() => ({ isAdmin: false, token: 'admin-token' }));

vi.mock('./checkoutRedirect', () => ({ redirectToCheckout: vi.fn() }));
vi.mock('./auth', () => ({
  AccountPanel: ({ checkoutMessage }: { checkoutMessage: string }) => <section className="panel narrow"><h2>Customer account</h2><button>Sign in with Clerk</button>{checkoutMessage && <p>{checkoutMessage}</p>}</section>,
  useAdminAccess: () => ({ isAdmin: mockAuth.isAdmin, getAdminToken: async () => mockAuth.token })
}));

const products = [
  { id: 'p1', slug: 'golden', title: 'Golden Hour Commander Proxy', description: 'Premium commander centerpiece', price: 1299, category: 'Commander', tags: ['commander'], image: 'x', inventory: 20, active: true },
  { id: 'p2', slug: 'token', title: 'Midnight Token Pack', description: 'Token bundle', price: 899, category: 'Tokens', tags: ['tokens'], image: 'x', inventory: 35, active: true }
];

beforeEach(() => {
  mockAuth.isAdmin = false;
  mockAuth.token = 'admin-token';
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/api/admin/products') && !String(url).includes('/image')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ product: { ...body, id: body.id ?? `prod_${body.slug}` } }), { status: 200 });
      }
      return new Response(JSON.stringify({ products }), { status: 200 });
    }
    if (String(url).includes('/api/products')) return new Response(JSON.stringify({ products }), { status: 200 });
    if (String(url).includes('/api/checkout')) return new Response(JSON.stringify({ orderId: 'ord_test', checkoutUrl: 'https://checkout.stripe.test/session', total: 1299 }), { status: 201 });
    if (String(url).includes('/api/admin/orders/ord_test/fulfill')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', total: 1299, status: 'fulfilled', items: [] } }), { status: 200 });
    if (String(url).includes('/api/admin/products/golden/image')) return new Response(JSON.stringify({ product: { ...products[0], image: 'https://images.example.com/golden.jpg' } }), { status: 200 });
    if (String(url).includes('/api/orders/ord_test')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', total: 1299, status: 'paid', items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).includes('/api/admin/orders')) return new Response(JSON.stringify({ orders: [{ id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', total: 1299, status: 'paid', items: [] }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('Midnight Cardworks storefront', () => {
  it('renders a searchable product catalog', async () => {
    render(<App />);
    expect(await screen.findByText('Golden Hour Commander Proxy')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search products'), 'token');
    const productGrid = screen.getByText('Midnight Token Pack').closest('.product-grid');
    expect(productGrid).toBeTruthy();
    expect(within(productGrid as HTMLElement).getByText('Midnight Token Pack')).toBeInTheDocument();
    expect(within(productGrid as HTMLElement).queryByText('Golden Hour Commander Proxy')).not.toBeInTheDocument();
  });

  it('adds an item to cart and creates checkout order', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    expect(screen.getByText(/Subtotal:/)).toHaveTextContent('Subtotal: $12.99');
    await userEvent.type(screen.getByLabelText('Checkout email'), 'buyer@example.com');
    await userEvent.type(screen.getByLabelText('Full name for checkout'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Shipping address'), '123 Midnight Lane');
    await userEvent.click(screen.getByRole('button', { name: 'Checkout securely' }));
    expect(await screen.findByText(/Order ord_test reserved/)).toBeInTheDocument();
    expect(redirectToCheckout).toHaveBeenCalledWith('https://checkout.stripe.test/session');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/checkout'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('123 Midnight Lane') }));
  });

  it('shows admin order review', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const panel = await screen.findByText('Orders');
    expect(within(panel.parentElement!).getByText(/ord_test: buyer@example.com/)).toBeInTheDocument();
  });

  it('lets admins mark paid orders fulfilled', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));

    expect(await screen.findByText(/Ari Buyer/)).toBeInTheDocument();
    expect(screen.getByText(/123 Midnight Lane/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark ord_test fulfilled' }));

    expect(await screen.findByText(/ord_test: buyer@example.com — Ari Buyer — 123 Midnight Lane — \$12.99 — fulfilled/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/orders/ord_test/fulfill'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('uploads a product image from the admin dashboard', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const upload = await screen.findByLabelText('Upload image for Golden Hour Commander Proxy');
    const file = new File(['image-bytes'], 'golden.jpg', { type: 'image/jpeg' });

    await userEvent.upload(upload, file);

    expect(await screen.findByText('Updated image for Golden Hour Commander Proxy.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/products/golden/image'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('edits product listing details from the admin dashboard', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));

    await userEvent.clear(await screen.findByLabelText('Title for Golden Hour Commander Proxy'));
    await userEvent.type(screen.getByLabelText('Title for Golden Hour Commander Proxy'), 'Golden Hour Commander Proxy Deluxe');
    await userEvent.clear(screen.getByLabelText('Price in dollars for Golden Hour Commander Proxy'));
    await userEvent.type(screen.getByLabelText('Price in dollars for Golden Hour Commander Proxy'), '14.99');
    await userEvent.clear(screen.getByLabelText('Inventory for Golden Hour Commander Proxy'));
    await userEvent.type(screen.getByLabelText('Inventory for Golden Hour Commander Proxy'), '12');
    await userEvent.click(screen.getByLabelText('Active listing for Golden Hour Commander Proxy'));
    await userEvent.click(screen.getByRole('button', { name: 'Save Golden Hour Commander Proxy' }));

    expect(await screen.findByText('Saved Golden Hour Commander Proxy Deluxe.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/products'), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer admin-token' }),
      body: expect.stringContaining('Golden Hour Commander Proxy Deluxe')
    }));
    expect(String((fetch as any).mock.calls.find((call: unknown[]) => String(call[0]).includes('/api/admin/products') && (call[1] as RequestInit | undefined)?.method === 'POST')?.[1]?.body)).toContain('"active":false');
  });

  it('creates a new product listing from the admin dashboard', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));

    await userEvent.type(await screen.findByLabelText('New product slug'), 'moonlit-token');
    await userEvent.type(screen.getByLabelText('New product title'), 'Moonlit Token Pack');
    await userEvent.type(screen.getByLabelText('New product description'), 'Fresh token bundle');
    await userEvent.type(screen.getByLabelText('New product price in dollars'), '9.50');
    await userEvent.type(screen.getByLabelText('New product category'), 'Tokens');
    await userEvent.type(screen.getByLabelText('New product tags'), 'tokens, moonlit');
    await userEvent.type(screen.getByLabelText('New product inventory'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Create product listing' }));

    expect(await screen.findByText('Saved Moonlit Token Pack.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/products'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('moonlit-token') }));
  });

  it('hides the admin dashboard from non-admin customers', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('shows a verified receipt when returning from Stripe Checkout', async () => {
    window.history.pushState({}, '', '/checkout/success?order=ord_test');

    render(<App />);

    expect(await screen.findByText('Payment verified')).toBeInTheDocument();
    expect(screen.getByText(/Order ord_test/)).toBeInTheDocument();
    expect(screen.getByText(/1 × Golden Hour Commander Proxy — \$12.99/)).toBeInTheDocument();
    expect(screen.getByText('Ship to: 123 Midnight Lane')).toBeInTheDocument();
    expect(screen.getByText(/Total paid: \$12.99/)).toBeInTheDocument();
  });

  it('uses Clerk-ready account actions instead of a manual demo email form', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign in with Clerk' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Account email')).not.toBeInTheDocument();
  });
});
