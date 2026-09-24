import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { redirectToCheckout } from './checkoutRedirect';

const mockAuth = vi.hoisted(() => ({ isAdmin: false, isSignedIn: false, token: 'admin-token', email: 'buyer@example.com' }));
let adminOrderStatus = 'paid';

vi.mock('./checkoutRedirect', () => ({ redirectToCheckout: vi.fn() }));
vi.mock('./auth', () => ({
  AccountPanel: ({ checkoutMessage }: { checkoutMessage: string }) => <section className="panel narrow"><h2>Customer account</h2><button>Sign in with Clerk</button>{checkoutMessage && <p>{checkoutMessage}</p>}</section>,
  useAdminAccess: () => ({ isAdmin: mockAuth.isAdmin, getAdminToken: async () => mockAuth.token }),
  useCustomerSession: () => ({ isSignedIn: mockAuth.isSignedIn, email: mockAuth.email, getCustomerToken: async () => mockAuth.token })
}));

const products = [
  { id: 'p1', slug: 'golden', title: 'Golden Hour Commander Proxy', description: 'Premium commander centerpiece', price: 1299, saleActive: false, salePrice: null, category: 'Commander', tags: ['commander'], image: 'x', inventory: 20, active: true },
  { id: 'p2', slug: 'token', title: 'Midnight Token Pack', description: 'Token bundle', price: 899, saleActive: false, salePrice: null, category: 'Tokens', tags: ['tokens'], image: 'x', inventory: 35, active: true },
  { id: 'p3', slug: 'sold-out', title: 'Archive Showcase Proxy', description: 'Display-only showcase card', price: 1599, saleActive: false, salePrice: null, category: 'Display', tags: ['display', 'archive'], image: 'x', inventory: 0, active: true }
];
const marketingSubscribers = [
  { id: 'sub_1', email: 'buyer@example.com', name: 'Ari Buyer', status: 'subscribed', source: 'storefront_coupon', couponCode: 'MIDNIGHT10', consentedAt: '2026-06-21T00:00:00.000Z', createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-21T00:00:00.000Z' },
  { id: 'sub_2', email: 'quiet@example.com', status: 'unsubscribed', source: 'storefront_coupon', couponCode: 'MIDNIGHT10', consentedAt: '2026-06-20T00:00:00.000Z', unsubscribedAt: '2026-06-21T00:00:00.000Z', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-21T00:00:00.000Z' }
];
const faqItems = [
  { id: 'faq_1', question: 'Are these tournament legal?', answer: 'No, these are casual-play pieces only.', sortOrder: 10, active: true, createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-21T00:00:00.000Z' },
  { id: 'faq_2', question: 'Can I ask about a custom idea?', answer: 'Yes, send a note with the card name and direction.', sortOrder: 20, active: true, createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-21T00:00:00.000Z' }
];
const blogPosts = [
  { id: 'blog_1', slug: 'first-drop-notes', title: 'First Drop Notes', excerpt: 'Launch context for the first Midnight Cardworks lineup.', body: 'The first drop focuses on commander tables.\n\nExpect proxy centerpieces, tokens, and display cards.', published: true, publishedAt: '2026-06-21T00:00:00.000Z', createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-21T00:00:00.000Z' }
];

beforeEach(() => {
  mockAuth.isAdmin = false;
  mockAuth.isSignedIn = false;
  mockAuth.token = 'admin-token';
  mockAuth.email = 'buyer@example.com';
  adminOrderStatus = 'paid';
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/api/admin/content/faqs')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ faqItem: { id: body.id ?? 'faq_saved', question: body.question, answer: body.answer, sortOrder: body.sortOrder, active: body.active, createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-22T00:00:00.000Z' } }), { status: 200 });
    }
    if (String(url).includes('/api/admin/content/blog-posts')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ blogPost: { id: body.id ?? 'blog_saved', slug: body.slug, title: body.title, excerpt: body.excerpt, body: body.body, published: body.published, publishedAt: body.publishedAt ?? '2026-06-22T00:00:00.000Z', createdAt: '2026-06-21T00:00:00.000Z', updatedAt: '2026-06-22T00:00:00.000Z' } }), { status: 200 });
    }
    if (String(url).includes('/api/admin/content')) return new Response(JSON.stringify({ faqItems, blogPosts }), { status: 200 });
    if (String(url).includes('/api/content/blog-posts/first-drop-notes')) return new Response(JSON.stringify({ post: blogPosts[0] }), { status: 200 });
    if (String(url).includes('/api/content/blog-posts')) return new Response(JSON.stringify({ blogPosts }), { status: 200 });
    if (String(url).includes('/api/content/faqs')) return new Response(JSON.stringify({ faqItems }), { status: 200 });
    if (String(url).includes('/api/admin/marketing/subscribers')) return new Response(JSON.stringify({ subscribers: marketingSubscribers }), { status: 200 });
    if (String(url).includes('/api/admin/marketing/campaigns')) return new Response(JSON.stringify({ sent: 1 }), { status: 200 });
    if (String(url).includes('/api/newsletter/unsubscribe')) return new Response(JSON.stringify({ subscriber: { ...marketingSubscribers[0], status: 'unsubscribed', unsubscribedAt: '2026-06-21T00:00:00.000Z' } }), { status: 200 });
    if (String(url).includes('/api/newsletter')) return new Response(JSON.stringify({ subscriber: marketingSubscribers[0], created: true }), { status: 201 });
    if (String(url).includes('/api/admin/products') && !String(url).includes('/image')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ product: { ...body, id: body.id ?? `prod_${body.slug}` } }), { status: 200 });
      }
      return new Response(JSON.stringify({ products }), { status: 200 });
    }
    if (String(url).includes('/api/products/golden')) return new Response(JSON.stringify({ product: products[0] }), { status: 200 });
    if (String(url).includes('/api/products')) return new Response(JSON.stringify({ products }), { status: 200 });
    if (String(url).includes('/api/checkout')) return new Response(JSON.stringify({ orderId: 'ord_test', checkoutUrl: 'https://checkout.stripe.test/session', subtotal: 1299, shippingCost: 499, total: 1798 }), { status: 201 });
    if (String(url).includes('/api/admin/orders/ord_test/sync-payment')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'paid', stripeSessionId: 'cs_test_sync', stripePaymentIntentId: 'pi_synced', refundedAmount: 0, items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).includes('/api/admin/orders/ord_test/fulfill')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'fulfilled', refundedAmount: 0, items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).includes('/api/admin/orders/ord_test/cancel')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'canceled', refundedAmount: 0, refundReason: 'Customer changed their mind', canceledAt: '2026-06-20T00:00:00.000Z', items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).includes('/api/admin/orders/ord_test/refund')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'refunded', refundedAmount: 1798, stripeRefundId: 're_demo_ord_test', refundReason: 'Customer requested cancellation', items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).includes('/api/admin/products/golden/image')) return new Response(JSON.stringify({ product: { ...products[0], image: 'https://images.example.com/golden.jpg' } }), { status: 200 });
    if (String(url).includes('/api/orders/ord_test')) return new Response(JSON.stringify({ order: { id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'paid', refundedAmount: 0, items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] } }), { status: 200 });
    if (String(url).endsWith('/api/orders')) return new Response(JSON.stringify({ orders: [{ id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: 'paid', refundedAmount: 0, items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] }] }), { status: 200 });
    if (String(url).includes('/api/contact')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (String(url).includes('/api/admin/orders')) return new Response(JSON.stringify({ orders: [{ id: 'ord_test', email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane', subtotal: 1299, shippingCost: 499, total: 1798, status: adminOrderStatus, refundedAmount: 0, items: [{ title: 'Golden Hour Commander Proxy', quantity: 1, price: 1299 }] }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  document.querySelectorAll('script[data-midnight-analytics="plausible"]').forEach((script) => script.remove());
  delete (window as any).plausible;
  vi.unstubAllGlobals();
});

describe('Midnight Cardworks storefront', () => {
  it('opens a shareable product detail page and sets SEO metadata', async () => {
    window.history.pushState({}, '', '/products/golden');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(screen.getByText('Premium commander centerpiece')).toBeInTheDocument();
    expect(screen.getByText('Copy link to this card')).toBeInTheDocument();
    expect(screen.getByText('Casual play only')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Golden Hour Commander Proxy | Midnight Cardworks'));
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('Premium commander centerpiece');
  });

  it('opens product detail pages when the whole listing card is clicked', async () => {
    render(<App />);

    const listingCard = await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' });
    await userEvent.click(listingCard);

    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/products/golden');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });

  it('keeps explicit product detail links for accessibility and sharing', async () => {
    render(<App />);

    const detailLink = await screen.findByRole('link', { name: 'View details for Golden Hour Commander Proxy' });
    expect(detailLink).toHaveAttribute('href', '/products/golden');

    await userEvent.click(detailLink);

    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });

  it('returns from a listing detail to the shop when browser back navigation fires', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();

    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByText('Copy link to this card')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('uses the brand name as a home link from non-home pages', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();

    const brandHomeLink = screen.getByRole('link', { name: 'Midnight Cardworks home' });
    expect(brandHomeLink).toHaveAttribute('href', '/');
    await userEvent.click(brandHomeLink);

    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByText('Copy link to this card')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('scrolls to the top of the homepage when the brand home link is clicked', async () => {
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Midnight Cardworks home' }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
  });

  it('scrolls to the top of the selected section when shop category nav buttons are clicked', async () => {
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    const categoryNav = screen.getByRole('navigation', { name: 'Shop categories' });
    const scrollTo = vi.mocked(window.scrollTo);

    await userEvent.click(within(categoryNav).getByRole('button', { name: 'Contact' }));

    expect(await screen.findByRole('heading', { name: 'Contact Midnight Cardworks' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'smooth' });

    scrollTo.mockClear();
    await userEvent.click(within(categoryNav).getByRole('button', { name: 'Commander' }));

    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByText('Midnight Collector Studio')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/shop');
    expect(window.location.search).toBe('?category=Commander');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'smooth' });
  });

  it('opens public FAQ and blog pages from the shop navigation', async () => {
    window.localStorage.setItem('midnight-cardworks.newsletterOfferHomeSeen', 'true');
    render(<App />);

    const categoryNav = screen.getByRole('navigation', { name: 'Shop categories' });
    await userEvent.click(within(categoryNav).getByRole('button', { name: 'FAQ' }));

    expect(window.location.pathname).toBe('/faq');
    expect(await screen.findByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(screen.getByText('No, these are casual-play pieces only.')).toBeInTheDocument();

    await userEvent.click(within(categoryNav).getByRole('button', { name: 'Blog' }));

    expect(window.location.pathname).toBe('/blog');
    expect(await screen.findByRole('heading', { name: 'Studio notes' })).toBeInTheDocument();
    expect(screen.getByText('Launch context for the first Midnight Cardworks lineup.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Read First Drop Notes' }));

    expect(window.location.pathname).toBe('/blog/first-drop-notes');
    expect(await screen.findByRole('heading', { name: 'First Drop Notes' })).toBeInTheDocument();
    expect(screen.getByText('Expect proxy centerpieces, tokens, and display cards.')).toBeInTheDocument();
  });

  it('shows privacy notice and remembers necessary-only choice', async () => {
    render(<App />);

    const notice = screen.getByRole('region', { name: 'Privacy and cookie notice' });
    expect(within(notice).getByText('Privacy & cookie choices')).toBeInTheDocument();

    await userEvent.click(within(notice).getByRole('button', { name: 'Necessary only' }));

    expect(window.localStorage.getItem('midnight-cardworks.analyticsPreference')).toBe('necessary');
    expect(screen.queryByRole('region', { name: 'Privacy and cookie notice' })).not.toBeInTheDocument();
  });

  it('opens the privacy page from the footer and lets shoppers allow analytics', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Necessary only' }));
    const footer = screen.getByRole('contentinfo');
    await userEvent.click(within(footer).getByRole('button', { name: 'Privacy & Cookies' }));

    expect(window.location.pathname).toBe('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy & Cookies' })).toBeInTheDocument();
    expect(screen.getByText(/Stripe handles payment/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Allow analytics' }));

    expect(window.localStorage.getItem('midnight-cardworks.analyticsPreference')).toBe('accepted');
  });

  it('lets shoppers sign up for the launch coupon email', async () => {
    render(<App />);

    // The offer waits for engagement instead of covering the storefront on load.
    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();
    fireEvent.scroll(window);

    expect(await screen.findByRole('heading', { name: 'Get a coupon for the first drop.' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Newsletter name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Newsletter email'), 'buyer@example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Email me coupons and product updates' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send my coupon' }));

    expect(await screen.findByRole('status')).toHaveTextContent('You are on the list. Coupon sent. Code: MIDNIGHT10');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/newsletter'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('buyer@example.com') }));
  });

  it('does not block the storefront with the coupon popup, then shows it once after engagement', async () => {
    render(<App />);

    // Nothing covers the page before the shopper has looked at anything.
    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('midnight-cardworks.newsletterOfferHomeSeen')).toBeNull();

    fireEvent.scroll(window);

    const dialog = await screen.findByRole('dialog', { name: 'Get a coupon for the first drop.' });
    expect(within(dialog).getByText('Launch list')).toBeInTheDocument();
    expect(window.localStorage.getItem('midnight-cardworks.newsletterOfferHomeSeen')).toBe('true');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close launch coupon signup' }));
    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();

    cleanup();
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument());
  });

  it('closes the coupon popup with Escape', async () => {
    render(<App />);
    fireEvent.scroll(window);

    const dialog = await screen.findByRole('dialog', { name: 'Get a coupon for the first drop.' });
    expect(dialog).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();
  });

  it('shows the launch coupon as an inline account offer above order history after the home offer was seen', async () => {
    window.localStorage.setItem('midnight-cardworks.newsletterOfferHomeSeen', 'true');
    mockAuth.isSignedIn = true;
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);

    const accountOffer = await screen.findByRole('region', { name: 'Account launch coupon' });
    expect(within(accountOffer).getByText('Account offer')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Get a coupon for the first drop.' })).not.toBeInTheDocument();

    const history = await screen.findByRole('region', { name: 'Order history' });
    expect(accountOffer.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the dark Apple-inspired collector studio direction', async () => {
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /cards made for the midnight table/i })).toBeInTheDocument();
    expect(screen.getByText('Custom proxies, token packs, and display cards — hand-finished for commander nights, gifts, and display binders.')).toBeInTheDocument();
    
    expect(screen.getAllByRole('button', { name: 'Start a commission' })[0]).toBeInTheDocument();
    
  });

  it('shows conversion-focused landing sections before the product grid', async () => {
    render(<App />);

    expect(await screen.findByRole('region', { name: 'Gallery preview' })).toBeInTheDocument();
    expect(screen.getByText('Examples from the collection.')).toBeInTheDocument();
  });

  it('shows launch polish with product metadata', async () => {
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sold out: Archive Showcase Proxy' })).toBeDisabled();
  });

  it('only shows the hero on the landing shop page', async () => {
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 0/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));
    expect(screen.getByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(screen.queryByText('Midnight Collector Studio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(screen.queryByText('Midnight Collector Studio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 0/i })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Contact' })[0]);
    expect(screen.getByRole('heading', { name: 'Contact Midnight Cardworks' })).toBeInTheDocument();
    expect(screen.queryByText('Midnight Collector Studio')).not.toBeInTheDocument();
  });

  it('shows a polished empty state when filters find no products', async () => {
    render(<App />);
    await screen.findAllByText('Golden Hour Commander Proxy');

    await userEvent.type(screen.getAllByLabelText('Search products')[0], 'goblin thunderstorm');

    expect(screen.getByText('No signal on this channel.')).toBeInTheDocument();
    expect(screen.getByText('Clear filters')).toBeInTheDocument();
  });

  it('hides the hero create account CTA when a customer is already signed in', async () => {
    mockAuth.isSignedIn = true;
    render(<App />);

    expect(await screen.findByText('Midnight Collector Studio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shop the collection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });

  it('lets customers send a contact message to the shop owner', async () => {
    render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Contact' })[0]);
    expect(screen.getByRole('heading', { name: 'Contact Midnight Cardworks' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Your email'), 'buyer@example.com');
    await userEvent.type(screen.getByLabelText('Order number optional'), 'ord_test');
    await userEvent.type(screen.getByLabelText('How can we help?'), 'Can you make this as a foil token?');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const confirmation = await screen.findByRole('status', { name: 'Message sent confirmation' });
    expect(within(confirmation).getByRole('heading', { name: 'Message received' })).toBeInTheDocument();
    expect(within(confirmation).getByText('Thanks, Ari Buyer — your note is in the Midnight Cardworks inbox.')).toBeInTheDocument();
    expect(within(confirmation).getByText('I’ll reply to buyer@example.com within 1–2 business days.')).toBeInTheDocument();
    expect(within(confirmation).getByText('Need to add details? Send another message anytime.')).toBeInTheDocument();
    expect(screen.getByLabelText('How can we help?')).toHaveValue('');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/contact'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('foil token') }));
  });

  it('renders a searchable product catalog', async () => {
    render(<App />);
    expect(await screen.findAllByText('Golden Hour Commander Proxy')).not.toHaveLength(0);
    await userEvent.type(screen.getAllByLabelText('Search products')[0], 'token');
    const productGrid = screen.getByRole('link', { name: 'Open listing for Midnight Token Pack' }).closest('.product-grid');
    expect(productGrid).toBeTruthy();
    expect(within(productGrid as HTMLElement).getByText('Midnight Token Pack')).toBeInTheDocument();
    expect(within(productGrid as HTMLElement).queryByText('Golden Hour Commander Proxy')).not.toBeInTheDocument();
  });

  it('keeps shoppers on the current page and replaces the add button with confirmation', async () => {
    render(<App />);

    await screen.findAllByText('Golden Hour Commander Proxy');
    const addButton = (await screen.findAllByRole('button', { name: 'Add to cart' }))[0];
    const cardEl = addButton.closest('.product-card') as HTMLElement;
    await userEvent.click(addButton);

    expect(within(cardEl).getByRole('status')).toHaveTextContent('Added to cart');
    expect(within(cardEl).queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 1/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('does not open listing details when the inline added confirmation is clicked again', async () => {
    render(<App />);

    await screen.findAllByText('Golden Hour Commander Proxy');
    const addButton = (await screen.findAllByRole('button', { name: 'Add to cart' }))[0];
    const cardEl = addButton.closest('.product-card') as HTMLElement;
    await userEvent.click(addButton);

    await userEvent.click(within(cardEl).getByRole('status'));

    expect(screen.getByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByText('Copy link to this card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 1/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('lets shoppers choose a quantity on product detail pages before adding to cart', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Quantity for Golden Hour Commander Proxy'));
    await userEvent.type(screen.getByLabelText('Quantity for Golden Hour Commander Proxy'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add 3 to cart' }));

    const confirmation = screen.getByRole('status');
    const addAgainButton = screen.getByRole('button', { name: 'Add 3 to cart' });
    expect(confirmation).toHaveTextContent('Added 3 Golden Hour Commander Proxy to your cart.');
    expect(confirmation.compareDocumentPosition(addAgainButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: /cart, 3/i })).toBeInTheDocument();
    expect(screen.getByText('Copy link to this card')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/products/golden');

    await userEvent.click(screen.getByRole('button', { name: /cart, 3/i }));
    expect(screen.getByLabelText('Quantity for Golden Hour Commander Proxy')).toHaveValue(3);
  });

  it('returns from the cart to the shop when browser back navigation fires', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));
    expect(screen.getByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/cart');

    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
  });

  it('shows a helpful empty cart state with clear shopping actions', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));

    expect(screen.getByRole('heading', { name: 'Your cart is empty — tune into the latest drops.' })).toBeInTheDocument();
    expect(screen.getByText('Start with commander proxies, token packs, or display cards built for casual play.')).toBeInTheDocument();
    expect(screen.getByText('Secure Stripe checkout')).toBeInTheDocument();
    expect(screen.getByText('Made-to-order fulfillment')).toBeInTheDocument();
    expect(screen.getByText('Casual-play clarity')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continue shopping' }));
    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Search products')[0]).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Browse token packs' }));
    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Search products')[0]).toHaveValue('token');
  });

  it('shows recently viewed listings in the cart so shoppers can continue browsing', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Midnight Token Pack' }));
    expect(await screen.findByRole('heading', { name: 'Midnight Token Pack' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));

    const recentlyViewed = screen.getByRole('region', { name: 'Recently viewed listings' });
    expect(within(recentlyViewed).getByRole('heading', { name: 'Recently viewed' })).toBeInTheDocument();
    expect(within(recentlyViewed).getByText('Continue browsing where you left off.')).toBeInTheDocument();
    expect(within(recentlyViewed).getByRole('button', { name: 'Continue browsing Midnight Token Pack' })).toBeInTheDocument();
    expect(within(recentlyViewed).getByRole('button', { name: 'Continue browsing Golden Hour Commander Proxy' })).toBeInTheDocument();

    await userEvent.click(within(recentlyViewed).getByRole('button', { name: 'Continue browsing Golden Hour Commander Proxy' }));

    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/products/golden');
  });

  it('returns from the cart tab to the listing that opened it when browser back navigation fires', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cart, 0/i }));
    expect(screen.getByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/cart');

    window.history.pushState({}, '', '/products/golden');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(screen.getByText('Copy link to this card')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
  });

  it('returns from the cart to the listing that opened it when browser back navigation fires', async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    expect(await screen.findByText('Copy link to this card')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));
    expect(screen.getByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/cart');

    window.history.pushState({}, '', '/products/golden');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(screen.getByText('Copy link to this card')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
  });

  it('shows listing images in the cart and opens detail pages from cart items', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    expect(screen.getByRole('img', { name: 'Golden Hour Commander Proxy preview' })).toHaveAttribute('src', 'x');
    await userEvent.click(screen.getByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' }));

    expect(await screen.findByRole('heading', { name: 'Golden Hour Commander Proxy' })).toBeInTheDocument();
    expect(screen.getByText('Copy link to this card')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/products/golden');
  });

  it('presents a TCGplayer-inspired marketplace cart layout', async () => {
    render(<App />);
    const addButtons = await screen.findAllByRole('button', { name: 'Add to cart' });
    await userEvent.click(addButtons[0]);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(within(screen.getByRole('link', { name: 'Open listing for Midnight Token Pack' })).getByRole('button', { name: 'Add to cart' }));
    await userEvent.click(screen.getByRole('button', { name: /cart, 2/i }));

    const cartLayout = screen.getByRole('region', { name: 'Cart marketplace layout' });
    expect(within(cartLayout).getByText('Shopping Cart')).toBeInTheDocument();
    expect(within(cartLayout).getByText('2 items')).toBeInTheDocument();

    const itemsPanel = within(cartLayout).getByRole('region', { name: 'Items in your cart' });
    expect(within(itemsPanel).getByRole('heading', { name: 'Items in your cart' })).toBeInTheDocument();
    expect(within(itemsPanel).getByText('Item')).toBeInTheDocument();
    expect(within(itemsPanel).getByText('Quantity')).toBeInTheDocument();
    expect(within(itemsPanel).getByText('Price')).toBeInTheDocument();
    expect(within(itemsPanel).getAllByText('Fulfilled by Midnight Cardworks')).toHaveLength(2);
    expect(within(itemsPanel).queryByText('Direct from studio')).not.toBeInTheDocument();

    const summaryPanel = within(cartLayout).getByRole('region', { name: 'Cart summary' });
    expect(within(summaryPanel).getByRole('heading', { name: 'Cart Summary' })).toBeInTheDocument();
    expect(within(summaryPanel).getByText('Subtotal (2 items)')).toBeInTheDocument();
    expect(within(summaryPanel).getByText('Checkout securely with Stripe')).toBeInTheDocument();
  });

  it('removes individual items from the cart without changing the other lines', async () => {
    render(<App />);
    const addButtons = await screen.findAllByRole('button', { name: 'Add to cart' });
    await userEvent.click(addButtons[0]);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    const tokenListing = screen.getByRole('link', { name: 'Open listing for Midnight Token Pack' });
    await userEvent.click(within(tokenListing).getByRole('button', { name: 'Add to cart' }));
    await userEvent.click(screen.getByRole('button', { name: /cart, 2/i }));

    expect(screen.getByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Midnight Token Pack listing from cart' })).toBeInTheDocument();
    expect(screen.getByText('2 items in cart')).toBeInTheDocument();
    const initialSummary = screen.getByRole('group', { name: 'Order summary' });
    expect(within(initialSummary).getByText('Subtotal: $21.98')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Golden Hour Commander Proxy from cart' }));

    expect(screen.queryByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Midnight Token Pack listing from cart' })).toBeInTheDocument();
    expect(screen.getByText('1 item in cart')).toBeInTheDocument();
    const remainingSummary = screen.getByRole('group', { name: 'Order summary' });
    expect(within(remainingSummary).getByText('Subtotal: $8.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 1/i })).toBeInTheDocument();
  });

  it('lets shoppers adjust cart quantities with line controls', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    const quantityInput = screen.getByLabelText('Quantity for Golden Hour Commander Proxy');
    expect(quantityInput).toHaveValue(1);

    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity for Golden Hour Commander Proxy' }));

    expect(quantityInput).toHaveValue(2);
    expect(screen.getByRole('button', { name: /cart, 2/i })).toBeInTheDocument();
    expect(screen.getByText('2 items in cart')).toBeInTheDocument();
    const updatedSummary = screen.getByRole('group', { name: 'Order summary' });
    expect(within(updatedSummary).getByText('Subtotal: $25.98')).toBeInTheDocument();
    expect(screen.getByText('Line total: $25.98')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity for Golden Hour Commander Proxy' }));

    expect(quantityInput).toHaveValue(1);
    expect(screen.getByRole('button', { name: /cart, 1/i })).toBeInTheDocument();
    const finalSummary = screen.getByRole('group', { name: 'Order summary' });
    expect(within(finalSummary).getByText('Subtotal: $12.99')).toBeInTheDocument();
  });

  it('lets shoppers undo removing a cart item', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove Golden Hour Commander Proxy from cart' }));

    expect(screen.getByRole('status')).toHaveTextContent('Removed Golden Hour Commander Proxy from your cart.');
    expect(screen.queryByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 0/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo removing Golden Hour Commander Proxy' }));

    expect(screen.getByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears the whole cart only after confirmation', async () => {
    render(<App />);
    const addButtons = await screen.findAllByRole('button', { name: 'Add to cart' });
    await userEvent.click(addButtons[0]);
    const tokenListing = screen.getByRole('link', { name: 'Open listing for Midnight Token Pack' });
    await userEvent.click(within(tokenListing).getByRole('button', { name: 'Add to cart' }));
    await userEvent.click(screen.getByRole('button', { name: /cart, 2/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Clear cart' }));

    expect(screen.getByRole('status')).toHaveTextContent('Clear all 2 items from your cart?');
    expect(screen.getByRole('button', { name: 'Confirm clear cart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Golden Hour Commander Proxy listing from cart' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm clear cart' }));

    expect(screen.getByRole('heading', { name: 'Your cart is empty — tune into the latest drops.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cart, 0/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cleared 2 items from your cart.');
  });

  it('organizes checkout details into contact, shipping, and order summary sections', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    expect(screen.getByRole('heading', { name: 'Checkout details' })).toBeInTheDocument();
    expect(screen.getByText('Review items and enter your delivery details before secure Stripe payment.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Contact information' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Delivery information' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Order summary' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Street address')).toBeInTheDocument();
    expect(screen.getByLabelText('Apartment number')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('ZIP code')).toBeInTheDocument();
    expect(screen.getByText('Use separate fields so shipping labels and delivery review stay clear.')).toBeInTheDocument();
    expect(screen.getByText('1 item in cart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to secure checkout' })).toBeInTheDocument();
  });

  it('shows a final review before sending shoppers to Stripe', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    await userEvent.type(screen.getByLabelText('Email address'), 'buyer@example.com');
    await userEvent.type(screen.getByLabelText('Full name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Street address'), '123 Midnight Lane');
    await userEvent.type(screen.getByLabelText('Apartment number'), 'Apt 4B');
    await userEvent.type(screen.getByLabelText('City'), 'Austin');
    await userEvent.type(screen.getByLabelText('ZIP code'), '78701');

    const review = screen.getByRole('region', { name: 'Review before payment' });
    expect(within(review).getByRole('heading', { name: 'Review before payment' })).toBeInTheDocument();
    expect(within(review).getByText('1 × Golden Hour Commander Proxy')).toBeInTheDocument();
    expect(within(review).getByText('Contact: buyer@example.com')).toBeInTheDocument();
    expect(within(review).getByText('Ship to: 123 Midnight Lane, Apt 4B, Austin 78701')).toBeInTheDocument();
    expect(within(review).getByText('Subtotal: $12.99')).toBeInTheDocument();
    expect(within(review).getByText('Shipping: $4.99')).toBeInTheDocument();
    expect(within(review).getByText('Free shipping at $50.00 — add $37.01 more to qualify.')).toBeInTheDocument();
    expect(within(review).getByText('Total: $17.98')).toBeInTheDocument();
    expect(within(review).getByText('You’ll review and pay securely on Stripe next.')).toBeInTheDocument();
  });

  it('shows free shipping once the cart reaches the threshold', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' }));
    await userEvent.clear(screen.getByLabelText('Quantity for Golden Hour Commander Proxy'));
    await userEvent.type(screen.getByLabelText('Quantity for Golden Hour Commander Proxy'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add 4 to cart' }));
    await userEvent.click(screen.getByRole('button', { name: /cart, 4/i }));

    const review = screen.getByRole('region', { name: 'Review before payment' });
    expect(within(review).getByText('Subtotal: $51.96')).toBeInTheDocument();
    expect(within(review).getByText('Shipping: Free')).toBeInTheDocument();
    expect(within(review).getByText('Free shipping unlocked.')).toBeInTheDocument();
    expect(within(review).getByText('Total: $51.96')).toBeInTheDocument();
  });

  it('saves checkout details locally and prefills them next time on this device', async () => {
    const firstVisit = render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    await userEvent.type(screen.getByLabelText('Email address'), 'buyer@example.com');
    await userEvent.type(screen.getByLabelText('Full name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Street address'), '123 Midnight Lane');
    await userEvent.type(screen.getByLabelText('Apartment number'), 'Apt 4B');
    await userEvent.type(screen.getByLabelText('City'), 'Austin');
    await userEvent.type(screen.getByLabelText('ZIP code'), '78701');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Save my checkout info on this device' }));

    expect(screen.getByRole('status')).toHaveTextContent('Checkout info saved on this device.');
    expect(window.localStorage.getItem('midnight-cardworks.checkoutInfo')).toContain('123 Midnight Lane');

    firstVisit.unmount();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    expect(screen.getByLabelText('Email address')).toHaveValue('buyer@example.com');
    expect(screen.getByLabelText('Full name')).toHaveValue('Ari Buyer');
    expect(screen.getByLabelText('Street address')).toHaveValue('123 Midnight Lane');
    expect(screen.getByLabelText('Apartment number')).toHaveValue('Apt 4B');
    expect(screen.getByLabelText('City')).toHaveValue('Austin');
    expect(screen.getByLabelText('ZIP code')).toHaveValue('78701');
    expect(screen.getByText('Saved only in this browser. Not synced to your account.')).toBeInTheDocument();
  });

  it('clears locally saved checkout details from this device', async () => {
    window.localStorage.setItem('midnight-cardworks.checkoutInfo', JSON.stringify({ email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane' }));
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Clear saved checkout info from this device' }));

    expect(screen.getByRole('status')).toHaveTextContent('Saved checkout info cleared from this device.');
    expect(window.localStorage.getItem('midnight-cardworks.checkoutInfo')).toBeNull();
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    expect(screen.getByLabelText('Street address')).toHaveValue('');
    expect(screen.getByLabelText('Apartment number')).toHaveValue('');
    expect(screen.getByLabelText('City')).toHaveValue('');
    expect(screen.getByLabelText('ZIP code')).toHaveValue('');
  });

  it('shows checkout progress and the next step before leaving for Stripe', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    const progress = screen.getByRole('list', { name: 'Checkout progress' });
    expect(within(progress).getByText('1. Cart review')).toBeInTheDocument();
    expect(within(progress).getByText('2. Checkout details')).toBeInTheDocument();
    expect(within(progress).getByText('3. Secure payment')).toBeInTheDocument();
    expect(within(progress).getByText('4. Confirmation')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4: Checkout details')).toBeInTheDocument();
    expect(screen.getByText('Payment is processed securely by Stripe.')).toBeInTheDocument();
    expect(screen.getByText('After payment, you’ll return here for confirmation and fulfillment tracking.')).toBeInTheDocument();
  });

  it('keeps checkout totals and the submit action visible in a sticky cart bar', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    const stickyBar = screen.getByRole('region', { name: 'Sticky checkout summary' });
    expect(within(stickyBar).getByText('Total')).toBeInTheDocument();
    expect(within(stickyBar).getByText('$17.98')).toBeInTheDocument();
    expect(within(stickyBar).getByRole('button', { name: 'Continue to secure checkout' })).toBeInTheDocument();
  });

  it('requires a customer email before creating a checkout order', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    expect(screen.getByLabelText('Email address')).toBeRequired();
    await userEvent.type(screen.getByLabelText('Full name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Street address'), '123 Midnight Lane');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to secure checkout' }));

    expect(screen.getByRole('status')).toHaveTextContent('Email address required — we’ll only use this for order updates or design/print issues.');
    expect((fetch as any).mock.calls.some((call: unknown[]) => String(call[0]).includes('/api/checkout'))).toBe(false);
    expect(redirectToCheckout).not.toHaveBeenCalled();
  });

  it('prefills checkout email from a signed-in customer account', async () => {
    mockAuth.isSignedIn = true;
    mockAuth.email = 'account-buyer@example.com';
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));

    expect(screen.getByLabelText('Email address')).toHaveValue('account-buyer@example.com');
  });

  it('adds an item to cart and creates checkout order', async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add to cart' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /cart, 1/i }));
    const summary = screen.getByRole('group', { name: 'Order summary' });
    expect(within(summary).getByText(/Subtotal:/)).toHaveTextContent('Subtotal: $12.99');
    expect(within(summary).getByText(/Shipping:/)).toHaveTextContent('Shipping: $4.99');
    expect(within(summary).getByText(/Total:/)).toHaveTextContent('Total: $17.98');
    await userEvent.type(screen.getByLabelText('Email address'), 'buyer@example.com');
    await userEvent.type(screen.getByLabelText('Full name'), 'Ari Buyer');
    await userEvent.type(screen.getByLabelText('Street address'), '123 Midnight Lane');
    await userEvent.type(screen.getByLabelText('Apartment number'), 'Apt 4B');
    await userEvent.type(screen.getByLabelText('City'), 'Austin');
    await userEvent.type(screen.getByLabelText('ZIP code'), '78701');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to secure checkout' }));
    expect(await screen.findByText(/Order ord_test reserved/)).toBeInTheDocument();
    expect(redirectToCheckout).toHaveBeenCalledWith('https://checkout.stripe.test/session');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/checkout'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('123 Midnight Lane') }));
  });

  it('shows Etsy-style admin tabs for orders and listing edits', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    const adminShortcut = screen.getByRole('button', { name: 'Admin dashboard' });
    expect(adminShortcut).toHaveTextContent('Admin');

    await userEvent.click(adminShortcut);

    expect(window.location.pathname).toBe('/admin');
    expect(await screen.findByRole('tab', { name: /Orders \(1\)/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Listings \(3\)/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'Order navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Listing edits' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Listings \(3\)/ }));

    expect(screen.getByRole('tab', { name: /Listings \(3\)/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Listing edits' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Current listings \(3\)/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Create listing' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Current listings' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New product slug')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Create listing' }));

    expect(screen.getByRole('tab', { name: 'Create listing' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Create listing' })).toBeInTheDocument();
    expect(screen.getByLabelText('New product slug')).toBeInTheDocument();
  });

  it('lets admins create FAQ and blog content from the content workspace', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Content/ }));

    expect(await screen.findByRole('heading', { name: 'Content manager' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /FAQ \(2\)/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.type(screen.getByLabelText('FAQ question'), 'Do you ship internationally?');
    await userEvent.type(screen.getByLabelText('FAQ answer'), 'Message first so the studio can quote shipping accurately.');
    await userEvent.click(screen.getByRole('button', { name: 'Create FAQ' }));

    expect(await screen.findByText('Saved FAQ: Do you ship internationally?.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/content/faqs'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }), body: expect.stringContaining('Do you ship internationally?') }));

    await userEvent.click(screen.getByRole('tab', { name: /Blog/ }));
    await userEvent.type(screen.getByLabelText('Blog title'), 'New drop preview');
    expect(screen.getByLabelText('Blog slug')).toHaveValue('new-drop-preview');
    await userEvent.type(screen.getByLabelText('Blog excerpt'), 'A small preview of the next shop drop.');
    await userEvent.type(screen.getByLabelText('Blog body'), 'New commander proxies are being photographed this week.');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Blog post published' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create post' }));

    expect(await screen.findByText('Saved blog post: New drop preview.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/content/blog-posts'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }), body: expect.stringContaining('new-drop-preview') }));
  });

  it('shows admin order review', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByText(/buyer@example.com/)).toHaveTextContent('ord_test: buyer@example.com');
    expect(within(panel).getByText('Paid')).toBeInTheDocument();
    expect(within(panel).getByText('Customer')).toBeInTheDocument();
    expect(within(panel).getByText('Ari Buyer')).toBeInTheDocument();
    expect(within(panel).getByText('Shipping')).toBeInTheDocument();
    expect(within(panel).getByText('123 Midnight Lane')).toBeInTheDocument();
    expect(within(panel).getByText('Items')).toBeInTheDocument();
    expect(within(panel).getByText('1 × Golden Hour Commander Proxy — $12.99')).toBeInTheDocument();
  });

  it('lets admins mark paid orders fulfilled', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));

    expect(await screen.findByText(/Ari Buyer/)).toBeInTheDocument();
    expect(screen.getByText(/123 Midnight Lane/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark ord_test fulfilled' }));

    expect(await screen.findByText(/Marked ord_test fulfilled/)).toBeInTheDocument();
    const fulfilledPanel = screen.getByRole('tabpanel');
    expect(within(fulfilledPanel).getByText(/buyer@example.com/)).toHaveTextContent('ord_test: buyer@example.com');
    expect(within(fulfilledPanel).getByText('Fulfilled')).toBeInTheDocument();
    expect(within(fulfilledPanel).getByText('Ari Buyer')).toBeInTheDocument();
    expect(within(fulfilledPanel).getByText('123 Midnight Lane')).toBeInTheDocument();
    expect(within(fulfilledPanel).getByText('1 × Golden Hour Commander Proxy — $12.99')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/orders/ord_test/fulfill'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });


  it('lets admins sync pending Stripe payments from the order card', async () => {
    adminOrderStatus = 'pending_payment';
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));

    expect(await screen.findByText('Pending payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark ord_test fulfilled' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sync Stripe payment' }));

    expect(await screen.findByText('Synced payment for ord_test. Confirmation email sent.')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark ord_test fulfilled' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/orders/ord_test/sync-payment'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('lets admins issue a full refund from the order card', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));

    expect(await screen.findByText(/Ari Buyer/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Refund note for ord_test'), 'Customer requested cancellation');
    await userEvent.click(screen.getByRole('button', { name: 'Full refund $17.98' }));

    expect(await screen.findByText('Refund updated for ord_test.')).toBeInTheDocument();
    const orderPanel = screen.getByRole('tabpanel');
    expect(within(orderPanel).getByText('Refunded')).toBeInTheDocument();
    expect(within(orderPanel).getByText(/Refunded: \$17.98/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/orders/ord_test/refund'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }), body: expect.stringContaining('Customer requested cancellation') }));
  });

  it('uploads a product image from the admin dashboard', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Listings/ }));
    const upload = await screen.findByLabelText('Upload image for Golden Hour Commander Proxy');
    const file = new File(['image-bytes'], 'golden.jpg', { type: 'image/jpeg' });

    await userEvent.upload(upload, file);

    expect(await screen.findByText('Updated image for Golden Hour Commander Proxy.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/products/golden/image'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('uploads a product image when it is dropped onto the admin image dropzone', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Listings/ }));
    const dropzone = (await screen.findByText('Upload image for Golden Hour Commander Proxy')).closest('label');
    const file = new File(['drop-image-bytes'], 'dropped-golden.png', { type: 'image/png' });

    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone as HTMLElement, { dataTransfer: { files: [file] } });

    expect(await screen.findByText('Updated image for Golden Hour Commander Proxy.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/products/golden/image'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('edits product listing details from the admin dashboard', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Listings/ }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Listings/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Create listing' }));

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

  it('lets admins manage marketing subscribers and send a campaign', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Marketing/ }));

    expect(await screen.findByRole('heading', { name: 'Marketing emails' })).toBeInTheDocument();
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    expect(screen.getByText('quiet@example.com')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Marketing email subject'));
    await userEvent.type(screen.getByLabelText('Marketing email subject'), 'New cards are live');
    await userEvent.clear(screen.getByLabelText('Marketing email message'));
    await userEvent.type(screen.getByLabelText('Marketing email message'), 'Fresh card listings are ready in the shop.');
    await userEvent.click(screen.getByRole('button', { name: 'Send campaign to active subscribers' }));

    expect(await screen.findByText('Marketing campaign sent to 1 subscriber.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/marketing/campaigns'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer admin-token' }), body: expect.stringContaining('New cards are live') }));
  });

  it('lets admins apply and save sale pricing for selected listings', async () => {
    mockAuth.isAdmin = true;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin dashboard' }));
    await userEvent.click(await screen.findByRole('tab', { name: /Sales/ }));

    expect(await screen.findByRole('heading', { name: 'Sale manager' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Select Golden Hour Commander Proxy for sale changes'));
    await userEvent.clear(screen.getByLabelText('Bulk sale percentage'));
    await userEvent.type(screen.getByLabelText('Bulk sale percentage'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Apply % to selected' }));

    expect(screen.getByLabelText('Sale active for Golden Hour Commander Proxy')).toBeChecked();
    expect(screen.getByLabelText('Sale price in dollars for Golden Hour Commander Proxy')).toHaveValue(10.39);
    await userEvent.click(screen.getByRole('button', { name: 'Save selected sales' }));

    expect(await screen.findByText('Saved sale settings for 1 listing.')).toBeInTheDocument();
    expect(String((fetch as any).mock.calls.find((call: unknown[]) => String(call[0]).includes('/api/admin/products') && (call[1] as RequestInit | undefined)?.method === 'POST' && String((call[1] as RequestInit).body).includes('"saleActive":true'))?.[1]?.body)).toContain('"salePrice":1039');

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    const saleCard = await screen.findByRole('link', { name: 'Open listing for Golden Hour Commander Proxy' });
    expect(within(saleCard).getByText('On sale')).toBeInTheDocument();
    expect(within(saleCard).getByText('$12.99')).toBeInTheDocument();
    expect(within(saleCard).getByText('$10.39')).toBeInTheDocument();
  });

  it('hides the admin dashboard from non-admin customers', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('unsubscribes marketing emails from unsubscribe links', async () => {
    window.history.pushState({}, '', '/unsubscribe?token=sub_token');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Unsubscribe' })).toBeInTheDocument();
    expect(await screen.findByText('buyer@example.com has been unsubscribed from marketing emails.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/newsletter/unsubscribe'), expect.objectContaining({ method: 'POST', body: expect.stringContaining('sub_token') }));
  });

  it('shows a verified receipt when returning from Stripe Checkout', async () => {
    window.history.pushState({}, '', '/checkout/success?order=ord_test#receiptToken=' + 'r'.repeat(43));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Order received' })).toBeInTheDocument();
    expect(screen.getByText('Payment verified')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/orders/ord_test'), expect.objectContaining({ headers: { 'x-receipt-token': 'r'.repeat(43) }, cache: 'no-store' }));
    expect(screen.getByText('Order number: ord_test')).toBeInTheDocument();
    expect(screen.getByText(/1 × Golden Hour Commander Proxy — \$12.99/)).toBeInTheDocument();
    expect(screen.getByText('Ship to: 123 Midnight Lane')).toBeInTheDocument();
    expect(screen.getByText(/Shipping: \$4.99/)).toBeInTheDocument();
    expect(screen.getByText(/Total paid: \$17.98/)).toBeInTheDocument();
    expect(screen.getByText('What happens next')).toBeInTheDocument();
    expect(screen.getByText('We’ll review, pack, and mark your made-to-order cards fulfilled from the shop dashboard.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contact support about ord_test' })).toBeInTheDocument();
  });

  it('explains a paid stock hold without promising fulfillment', async () => {
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/api/orders/ord_test')) return new Response(JSON.stringify({ order: {
        id: 'ord_test', status: 'paid', total: 1798, fulfillmentOnHold: true, refundedAmount: 0, items: []
      } }), { status: 200 });
      return originalFetch(url, init);
    }));
    window.history.pushState({}, '', '/checkout/success?order=ord_test#receiptToken=' + 'r'.repeat(43));
    render(<App />);
    expect(await screen.findByText('Payment received; stock review pending')).toBeInTheDocument();
    expect(screen.getByText('Paid; fulfillment on hold')).toBeInTheDocument();
    expect(screen.queryByText('Paid and confirmed')).not.toBeInTheDocument();
  });

  it.each([
    ['pending_payment', 1798, 0, 'Order total: $17.98'],
    ['paid', 1598, 200, 'Total paid: $15.98'],
    ['canceled', 1798, 0, 'Order total: $17.98']
  ])('renders an accurate %s receipt', async (status, total, discountAmount, label) => {
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/api/orders/ord_test')) return new Response(JSON.stringify({ order: {
        id: 'ord_test', status, total, discountAmount, shippingCost: 499, refundedAmount: 0, items: []
      } }), { status: 200 });
      return originalFetch(url, init);
    }));
    window.history.pushState({}, '', '/checkout/success?order=ord_test#receiptToken=' + 'r'.repeat(43));
    render(<App />);
    expect(await screen.findByRole('heading', { name: String(label) })).toBeInTheDocument();
    if (discountAmount) expect(screen.getByText('Discount: -$2.00')).toBeInTheDocument();
    if (status !== 'paid') expect(screen.queryByText('Payment verified')).not.toBeInTheDocument();
    if (status === 'canceled') expect(screen.queryByText('Payment is processing')).not.toBeInTheDocument();
  });

  it('shows signed-in customers their order history in account', async () => {
    mockAuth.isSignedIn = true;
    render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);

    const history = await screen.findByRole('region', { name: 'Order history' });
    expect(within(history).getByRole('heading', { name: 'Order history' })).toBeInTheDocument();
    expect(within(history).getByText('ord_test')).toBeInTheDocument();
    expect(within(history).getByText('paid')).toBeInTheDocument();
    expect(within(history).getByText('1 × Golden Hour Commander Proxy')).toBeInTheDocument();
    expect(within(history).getByText('$17.98')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/orders$/), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer admin-token' }) }));
  });

  it('shows account saved checkout info controls that stay device-local', async () => {
    window.localStorage.setItem('midnight-cardworks.checkoutInfo', JSON.stringify({ email: 'buyer@example.com', customerName: 'Ari Buyer', shippingAddress: '123 Midnight Lane' }));
    render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);

    const savedInfo = screen.getByRole('region', { name: 'Saved checkout info' });
    expect(within(savedInfo).getByText('Checkout info saved on this device only — not synced to your account.')).toBeInTheDocument();
    expect(within(savedInfo).getByText('buyer@example.com')).toBeInTheDocument();
    await userEvent.click(within(savedInfo).getByRole('button', { name: 'Clear saved checkout info from this device' }));
    expect(window.localStorage.getItem('midnight-cardworks.checkoutInfo')).toBeNull();
    expect(within(savedInfo).getByRole('status')).toHaveTextContent('Saved checkout info cleared from this device.');
    expect(within(savedInfo).getByText('No checkout info saved on this device yet.')).toBeInTheDocument();
  });

  it('lets account customers contact support about an order', async () => {
    mockAuth.isSignedIn = true;
    render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);
    const history = await screen.findByRole('region', { name: 'Order history' });
    await userEvent.click(within(history).getByRole('button', { name: 'Contact support about ord_test' }));

    expect(screen.getByRole('heading', { name: 'Contact Midnight Cardworks' })).toBeInTheDocument();
    expect(screen.getByLabelText('Order number optional')).toHaveValue('ord_test');
  });

  it('offers a clear continue-shopping action from account order history', async () => {
    mockAuth.isSignedIn = true;
    render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);
    const history = await screen.findByRole('region', { name: 'Order history' });
    await userEvent.click(within(history).getByRole('button', { name: 'Continue shopping' }));

    expect(await screen.findByRole('heading', { name: 'Shop the current lineup' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/shop');
  });

  it('uses Clerk-ready account actions instead of a manual demo email form', async () => {
    render(<App />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);
    expect(screen.getByRole('button', { name: 'Sign in with Clerk' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Account email')).not.toBeInTheDocument();
  });
});
