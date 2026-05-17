import { useEffect, useMemo, useState } from 'react';
import { createCheckout, fetchAdminOrders, fetchProducts, uploadProductImage, type Order, type Product } from './api';
import { AccountPanel } from './auth';

type CartLine = { product: Product; quantity: number };
type View = 'shop' | 'cart' | 'account' | 'admin';

const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('shop');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [email, setEmail] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminMessage, setAdminMessage] = useState('');

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => { if (view === 'admin') fetchAdminOrders().then(setOrders).catch(() => setOrders([])); }, [view, checkoutMessage]);

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];
  const visibleProducts = useMemo(() => products.filter((p) => {
    const matchesQuery = [p.title, p.description, p.category, ...p.tags].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === 'All' || p.category === category);
  }), [products, query, category]);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  function addToCart(product: Product) {
    setCart((lines) => {
      const existing = lines.find((line) => line.product.id === product.id);
      if (existing) return lines.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...lines, { product, quantity: 1 }];
    });
    setView('cart');
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((lines) => lines.flatMap((line) => line.product.id === productId ? (quantity > 0 ? [{ ...line, quantity }] : []) : [line]));
  }

  async function checkout() {
    const checkout = await createCheckout(email || 'guest@example.com', cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })));
    setCheckoutMessage(`Order ${checkout.orderId} reserved — Stripe Checkout handoff ready for ${formatMoney(checkout.total)}.`);
    setCart([]);
    setView('account');
  }

  async function handleImageUpload(product: Product, file: File | undefined) {
    if (!file) return;
    setAdminMessage(`Uploading image for ${product.title}...`);
    try {
      const updated = await uploadProductImage(product.slug, file);
      setProducts((items) => items.map((item) => item.slug === updated.slug ? updated : item));
      setAdminMessage(`Updated image for ${updated.title}.`);
    } catch {
      setAdminMessage(`Could not upload image for ${product.title}.`);
    }
  }

  return <main>
    <header className="hero">
      <nav>
        <strong className="brand">Midnight Cardworks</strong>
        <button onClick={() => setView('shop')}>Shop</button>
        <button onClick={() => setView('cart')}>Cart ({cart.reduce((s, l) => s + l.quantity, 0)})</button>
        <button onClick={() => setView('account')}>Account</button>
        <button onClick={() => setView('admin')}>Admin</button>
      </nav>
      <section className="hero-grid">
        <div>
          <p className="eyebrow">Custom casual-play cards • collector energy • no discount-bin vibes</p>
          <h1>Step through the screen into a sharper card shop.</h1>
          <p>Browse premium custom proxies, token packs, display cards, and commander-ready upgrades with a bold neon mystery aesthetic.</p>
          <div className="cta-row"><button onClick={() => setView('shop')}>Enter the shop</button><button className="ghost" onClick={() => setView('account')}>Create account</button></div>
        </div>
        <aside className="tv-card"><span>CHANNEL 04</span><h2>Featured drop</h2><p>Golden Hour Commander Proxy</p></aside>
      </section>
    </header>

    {view === 'shop' && <section className="panel">
      <div className="toolbar">
        <input aria-label="Search products" placeholder="Search cards, tokens, commander..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter category" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}>
        <img src={product.image} alt="" />
        <div className="card-body"><span className="badge">{product.category}</span><h2>{product.title}</h2><p>{product.description}</p><div className="buy-row"><strong>{formatMoney(product.price)}</strong><button onClick={() => addToCart(product)}>Add to cart</button></div></div>
      </article>)}</div>
    </section>}

    {view === 'cart' && <section className="panel narrow"><h2>Your cart</h2>{cart.length === 0 ? <p>Your cart is waiting for its first social link.</p> : <>{cart.map((line) => <div className="cart-line" key={line.product.id}><span>{line.product.title}</span><input aria-label={`Quantity for ${line.product.title}`} type="number" min="0" value={line.quantity} onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))} /><strong>{formatMoney(line.product.price * line.quantity)}</strong></div>)}<h3>Subtotal: {formatMoney(subtotal)}</h3><input aria-label="Checkout email" placeholder="email for receipt" value={email} onChange={(e) => setEmail(e.target.value)} /><button onClick={checkout}>Checkout securely</button></>}</section>}

    {view === 'account' && <AccountPanel checkoutMessage={checkoutMessage} />}

    {view === 'admin' && <section className="panel"><h2>Admin dashboard</h2><p>Manage listings, upload product images, and review orders. Admin auth hardening is next before launch.</p>{adminMessage && <p className="status-message">{adminMessage}</p>}<div className="admin-grid"><div><h3>Listings</h3>{products.map((p) => <article className="admin-listing" key={p.id}><img src={p.image} alt="" /><div><strong>{p.title}</strong><p>{formatMoney(p.price)} — {p.inventory} in stock</p><label>Upload image for {p.title}<input aria-label={`Upload image for ${p.title}`} type="file" accept="image/*" onChange={(e) => void handleImageUpload(p, e.currentTarget.files?.[0])} /></label></div></article>)}</div><div><h3>Orders</h3>{orders.length === 0 ? <p>No orders yet.</p> : orders.map((o) => <p key={o.id}>{o.id}: {o.email} — {formatMoney(o.total)} — {o.status}</p>)}</div></div></section>}

    <footer>Unofficial custom game pieces for casual play. Not affiliated with or endorsed by Wizards of the Coast. Not tournament legal.</footer>
  </main>;
}
