import { useEffect, useMemo, useState } from 'react';
import { createCheckout, fetchAdminOrders, fetchAdminProducts, fetchOrder, fetchProducts, saveAdminProduct, uploadProductImage, type Order, type Product } from './api';
import { AccountPanel, useAdminAccess } from './auth';
import { redirectToCheckout } from './checkoutRedirect';

type CartLine = { product: Product; quantity: number };
type View = 'shop' | 'cart' | 'account' | 'admin' | 'receipt';

const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const moneyToCents = (value: string) => Math.round(Number(value || '0') * 100);
const blankProduct: Product = { id: '', slug: '', title: '', description: '', price: 0, category: '', tags: [], image: 'https://placehold.co/600x800/111111/f9f871?text=New+Card', inventory: 0, active: true };

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('shop');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [email, setEmail] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [newProduct, setNewProduct] = useState<Product>(blankProduct);
  const [adminMessage, setAdminMessage] = useState('');
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');
  const { isAdmin, getAdminToken } = useAdminAccess();

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (window.location.pathname === '/checkout/success' && orderId) {
      setView('receipt');
      setReceiptMessage('Checking payment status...');
      fetchOrder(orderId).then((order) => {
        setReceiptOrder(order);
        setReceiptMessage(order.status === 'paid' ? 'Payment verified' : 'Payment is processing');
      }).catch(() => setReceiptMessage('Could not verify this order yet'));
    }
  }, []);
  useEffect(() => {
    if (view !== 'admin' || !isAdmin) return;
    getAdminToken().then(async (token) => {
      const authToken = token ?? undefined;
      const [adminListings, adminOrders] = await Promise.all([fetchAdminProducts(authToken), fetchAdminOrders(authToken)]);
      setAdminProducts(adminListings);
      setOrders(adminOrders);
    }).catch(() => { setAdminProducts([]); setOrders([]); });
  }, [view, checkoutMessage, isAdmin]);

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
    setCheckoutMessage(`Order ${checkout.orderId} reserved — sending you to Stripe Checkout for ${formatMoney(checkout.total)}.`);
    setCart([]);
    setView('account');
    redirectToCheckout(checkout.checkoutUrl);
  }

  async function handleImageUpload(product: Product, file: File | undefined) {
    if (!file) return;
    setAdminMessage(`Uploading image for ${product.title}...`);
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const updated = await uploadProductImage(product.slug, file, token);
      setProducts((items) => items.map((item) => item.slug === updated.slug ? updated : item));
      setAdminProducts((items) => items.map((item) => item.slug === updated.slug ? updated : item));
      setAdminMessage(`Updated image for ${updated.title}.`);
    } catch {
      setAdminMessage(`Could not upload image for ${product.title}.`);
    }
  }

  function updateAdminProduct(slug: string, patch: Partial<Product>) {
    setAdminProducts((items) => items.map((item) => item.slug === slug ? { ...item, ...patch } : item));
  }

  function rememberSavedProduct(saved: Product) {
    setAdminProducts((items) => items.some((item) => item.slug === saved.slug) ? items.map((item) => item.slug === saved.slug ? saved : item) : [...items, saved]);
    setProducts((items) => {
      const without = items.filter((item) => item.slug !== saved.slug);
      return saved.active ? [...without, saved] : without;
    });
  }

  async function handleProductSave(product: Product) {
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const saved = await saveAdminProduct(product, token);
      rememberSavedProduct(saved);
      setAdminMessage(`Saved ${saved.title}.`);
      if (!product.id) setNewProduct(blankProduct);
    } catch {
      setAdminMessage(`Could not save ${product.title || 'product listing'}.`);
    }
  }

  function productEditor(product: Product, isNew = false) {
    const originalTitle = isNew ? 'new product' : products.find((item) => item.slug === product.slug)?.title || product.title || product.slug;
    const setProduct = (patch: Partial<Product>) => isNew ? setNewProduct((item) => ({ ...item, ...patch })) : updateAdminProduct(product.slug, patch);
    const saveLabel = isNew ? 'Create product listing' : `Save ${originalTitle}`;
    return <article className="admin-listing product-editor" key={isNew ? 'new-product' : product.id}>
      {!isNew && <img src={product.image} alt="" />}
      <div className="editor-grid">
        <label>{isNew ? 'New product slug' : `Slug for ${originalTitle}`}<input aria-label={isNew ? 'New product slug' : `Slug for ${originalTitle}`} value={product.slug} disabled={!isNew} onChange={(e) => setProduct({ slug: e.target.value })} /></label>
        <label>{isNew ? 'New product title' : `Title for ${originalTitle}`}<input aria-label={isNew ? 'New product title' : `Title for ${originalTitle}`} value={product.title} onChange={(e) => setProduct({ title: e.target.value })} /></label>
        <label>{isNew ? 'New product description' : `Description for ${originalTitle}`}<textarea aria-label={isNew ? 'New product description' : `Description for ${originalTitle}`} value={product.description} onChange={(e) => setProduct({ description: e.target.value })} /></label>
        <label>{isNew ? 'New product price in dollars' : `Price in dollars for ${originalTitle}`}<input aria-label={isNew ? 'New product price in dollars' : `Price in dollars for ${originalTitle}`} type="number" step="0.01" value={(product.price / 100).toFixed(2)} onChange={(e) => setProduct({ price: moneyToCents(e.target.value) })} /></label>
        <label>{isNew ? 'New product category' : `Category for ${originalTitle}`}<input aria-label={isNew ? 'New product category' : `Category for ${originalTitle}`} value={product.category} onChange={(e) => setProduct({ category: e.target.value })} /></label>
        <label>{isNew ? 'New product tags' : `Tags for ${originalTitle}`}<input aria-label={isNew ? 'New product tags' : `Tags for ${originalTitle}`} value={product.tags.join(', ')} onChange={(e) => setProduct({ tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
        <label>{isNew ? 'New product inventory' : `Inventory for ${originalTitle}`}<input aria-label={isNew ? 'New product inventory' : `Inventory for ${originalTitle}`} type="number" min="0" value={product.inventory} onChange={(e) => setProduct({ inventory: Number(e.target.value) })} /></label>
        <label>{isNew ? 'New product image URL' : `Image URL for ${originalTitle}`}<input aria-label={isNew ? 'New product image URL' : `Image URL for ${originalTitle}`} value={product.image} onChange={(e) => setProduct({ image: e.target.value })} /></label>
        <label className="checkbox-row"><input aria-label={isNew ? 'Active listing for new product' : `Active listing for ${originalTitle}`} type="checkbox" checked={product.active} onChange={(e) => setProduct({ active: e.target.checked })} /> Active listing</label>
        {!isNew && <label>Upload image for {originalTitle}<input aria-label={`Upload image for ${originalTitle}`} type="file" accept="image/*" onChange={(e) => void handleImageUpload(product, e.currentTarget.files?.[0])} /></label>}
        <button onClick={() => void handleProductSave(product)}>{saveLabel}</button>
      </div>
    </article>;
  }

  return <main>
    <header className="hero">
      <nav>
        <strong className="brand">Midnight Cardworks</strong>
        <button onClick={() => setView('shop')}>Shop</button>
        <button onClick={() => setView('cart')}>Cart ({cart.reduce((s, l) => s + l.quantity, 0)})</button>
        <button onClick={() => setView('account')}>Account</button>
        {isAdmin && <button onClick={() => setView('admin')}>Admin</button>}
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

    {view === 'receipt' && <section className="panel narrow receipt-panel"><p className="eyebrow">Checkout complete</p><h2>{receiptMessage || 'Checking payment status...'}</h2>{receiptOrder ? <div><p className="status-message">Order {receiptOrder.id} — {receiptOrder.status === 'paid' ? 'paid and confirmed' : 'waiting for Stripe confirmation'}</p><h3>Total paid: {formatMoney(receiptOrder.total)}</h3><ul>{receiptOrder.items.map((item) => <li key={`${item.title}-${item.quantity}`}>{item.quantity} × {item.title} — {formatMoney(item.price * item.quantity)}</li>)}</ul><p>We saved this order in the admin dashboard for fulfillment.</p><button onClick={() => setView('shop')}>Back to shop</button></div> : <p>Hang tight while Stripe confirms the order.</p>}</section>}

    {view === 'admin' && isAdmin && <section className="panel"><h2>Admin dashboard</h2><p>Manage listings, upload product images, and review orders. Admin actions require your signed-in admin account.</p>{adminMessage && <p className="status-message">{adminMessage}</p>}<div className="admin-grid"><div><h3>Create listing</h3>{productEditor(newProduct, true)}<h3>Listings</h3>{adminProducts.map((p) => productEditor(p))}</div><div><h3>Orders</h3>{orders.length === 0 ? <p>No orders yet.</p> : orders.map((o) => <p key={o.id}>{o.id}: {o.email} — {formatMoney(o.total)} — {o.status}</p>)}</div></div></section>}

    <footer>Unofficial custom game pieces for casual play. Not affiliated with or endorsed by Wizards of the Coast. Not tournament legal.</footer>
  </main>;
}
