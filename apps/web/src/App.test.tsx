import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const products = [
  { id: 'p1', slug: 'golden', title: 'Golden Hour Commander Proxy', description: 'Premium commander centerpiece', price: 1299, category: 'Commander', tags: ['commander'], image: 'x', inventory: 20, active: true },
  { id: 'p2', slug: 'token', title: 'Midnight Token Pack', description: 'Token bundle', price: 899, category: 'Tokens', tags: ['tokens'], image: 'x', inventory: 35, active: true }
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/api/products')) return new Response(JSON.stringify({ products }), { status: 200 });
    if (String(url).includes('/api/checkout')) return new Response(JSON.stringify({ orderId: 'ord_test', checkoutUrl: '/checkout/success', total: 1299 }), { status: 201 });
    if (String(url).includes('/api/admin/orders')) return new Response(JSON.stringify({ orders: [{ id: 'ord_test', email: 'buyer@example.com', total: 1299, status: 'pending_payment', items: [] }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
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
    await userEvent.click(screen.getByRole('button', { name: 'Checkout securely' }));
    expect(await screen.findByText(/Order ord_test reserved/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/checkout'), expect.objectContaining({ method: 'POST' }));
  });

  it('shows admin order review', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const panel = await screen.findByText('Orders');
    expect(within(panel.parentElement!).getByText(/ord_test/)).toBeInTheDocument();
  });

  it('uses Clerk-ready account actions instead of a manual demo email form', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign in with Clerk' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Account email')).not.toBeInTheDocument();
  });
});
