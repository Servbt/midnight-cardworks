import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createCheckout, fetchAdminOrders, fetchAdminProducts, fetchOrder, fetchProduct, fetchProducts, fulfillAdminOrder, saveAdminProduct, sendContactMessage, uploadProductImage, type Order, type Product } from './api';
import { AccountPanel, useAdminAccess, useCustomerSession } from './auth';
import { redirectToCheckout } from './checkoutRedirect';

type CartLine = { product: Product; quantity: number };
type View = 'shop' | 'cart' | 'account' | 'admin' | 'receipt' | 'product' | 'contact';

const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const moneyToCents = (value: string) => Math.round(Number(value || '0') * 100);
const blankProduct: Product = { id: '', slug: '', title: '', description: '', price: 0, category: '', tags: [], image: 'https://placehold.co/600x800/111111/f9f871?text=New+Card', inventory: 0, active: true };
const launchNotes = [
  { title: 'Secure Stripe checkout', copy: 'Payments stay on Stripe so card data never touches the shop server.' },
  { title: 'Made-to-order fulfillment', copy: 'Each order is reviewed, packed, and marked fulfilled from the admin dashboard.' },
  { title: 'Casual-play clarity', copy: 'Every page keeps the unofficial, not-tournament-legal note visible.' }
];
const storefrontStats = ['Custom proxies', 'Token packs', 'Display cards'];

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('shop');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [newProduct, setNewProduct] = useState<Product>(blankProduct);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminTab, setAdminTab] = useState<'orders' | 'listings'>('orders');
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productMessage, setProductMessage] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactOrderNumber, setContactOrderNumber] = useState('');
  const [contactBody, setContactBody] = useState('');
  const [contactWebsite, setContactWebsite] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const { isAdmin, getAdminToken } = useAdminAccess();
  const { isSignedIn } = useCustomerSession();

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => {
    function applyCurrentLocation() {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('order');
      const productMatch = window.location.pathname.match(/^\/products\/([a-z0-9-]+)$/);
      if (productMatch) {
        setView('product');
        setProductMessage('Loading listing...');
        fetchProduct(productMatch[1]).then((product) => {
          setSelectedProduct(product);
          setProductMessage('');
        }).catch(() => setProductMessage('Could not load that listing.'));
        return;
      }
      if (window.location.pathname === '/checkout/success' && orderId) {
        setView('receipt');
        setReceiptMessage('Checking payment status...');
        fetchOrder(orderId).then((order) => {
          setReceiptOrder(order);
          setReceiptMessage(order.status === 'paid' ? 'Payment verified' : 'Payment is processing');
        }).catch(() => setReceiptMessage('Could not verify this order yet'));
        return;
      }
      if (window.location.pathname === '/cart') {
        setView('cart');
        return;
      }
      setSelectedProduct(null);
      setProductMessage('');
      setReceiptOrder(null);
      setReceiptMessage('');
      setView('shop');
    }

    applyCurrentLocation();
    window.addEventListener('popstate', applyCurrentLocation);
    return () => window.removeEventListener('popstate', applyCurrentLocation);
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
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  useEffect(() => {
    if (view === 'product' && selectedProduct) {
      document.title = `${selectedProduct.title} | Midnight Cardworks`;
      let description = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (!description) {
        description = document.createElement('meta');
        description.name = 'description';
        document.head.appendChild(description);
      }
      description.content = selectedProduct.description;
    } else if (view === 'shop') {
      document.title = 'Midnight Cardworks';
    }
  }, [view, selectedProduct]);

  function showProduct(product: Product) {
    setSelectedProduct(product);
    setView('product');
    window.history.pushState({}, '', `/products/${product.slug}`);
  }

  function isInteractiveCardTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest('a, button, input, select, textarea, label'));
  }

  function handleProductCardClick(product: Product, event: MouseEvent<HTMLElement>) {
    if (isInteractiveCardTarget(event.target)) return;
    showProduct(product);
  }

  function handleProductCardKeyDown(product: Product, event: KeyboardEvent<HTMLElement>) {
    if (isInteractiveCardTarget(event.target) || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    showProduct(product);
  }

  function showShop() {
    setView('shop');
    window.history.pushState({}, '', '/');
  }

  function showCart() {
    setView('cart');
    if (window.location.pathname !== '/cart') window.history.pushState({}, '', '/cart');
  }

  function addToCart(product: Product) {
    setCart((lines) => {
      const existing = lines.find((line) => line.product.id === product.id);
      if (existing) return lines.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...lines, { product, quantity: 1 }];
    });
    showCart();
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((lines) => lines.flatMap((line) => line.product.id === productId ? (quantity > 0 ? [{ ...line, quantity }] : []) : [line]));
  }

  async function checkout() {
    const checkout = await createCheckout(email || 'guest@example.com', customerName, shippingAddress, cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })));
    setCheckoutMessage(`Order ${checkout.orderId} reserved — sending you to Stripe Checkout for ${formatMoney(checkout.total)}.`);
    setCart([]);
    setView('account');
    redirectToCheckout(checkout.checkoutUrl);
  }

  async function handleContactSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setContactMessage('Sending message...');
    try {
      await sendContactMessage({ name: contactName, email: contactEmail, orderNumber: contactOrderNumber || undefined, message: contactBody, website: contactWebsite });
      setContactMessage('Message sent — I’ll get back to you soon.');
      setContactBody('');
      setContactOrderNumber('');
      setContactWebsite('');
    } catch {
      setContactMessage('Could not send the message yet. Please check your email and try again.');
    }
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

  async function handleOrderFulfilled(order: Order) {
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const updated = await fulfillAdminOrder(order.id, token);
      setOrders((items) => items.map((item) => item.id === updated.id ? updated : item));
      setAdminMessage(`Marked ${updated.id} fulfilled.`);
    } catch {
      setAdminMessage(`Could not fulfill ${order.id}.`);
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
        <button onClick={showShop}>Shop</button>
        <button onClick={showCart}>Cart ({cart.reduce((s, l) => s + l.quantity, 0)})</button>
        <button onClick={() => setView('account')}>Account</button>
        <button onClick={() => setView('contact')}>Contact</button>
        {isAdmin && <button onClick={() => { setView('admin'); setAdminTab('orders'); }}>Admin</button>}
      </nav>
      <section className="hero-grid">
        <div>
          <p className="eyebrow">Launch-ready custom cardwork</p>
          <h1>Step through the screen into a sharper card shop.</h1>
          <p>Browse premium custom proxies, token packs, display cards, and commander-ready upgrades with a bold neon mystery aesthetic.</p>
          <div className="cta-row"><button onClick={showShop}>Enter the shop</button>{!isSignedIn && <button className="ghost" onClick={() => setView('account')}>Create account</button>}</div>
          <div className="mini-stats" aria-label="Storefront highlights">{storefrontStats.map((stat) => <span key={stat}>{stat}</span>)}</div>
        </div>
        <aside className="tv-card"><span>CHANNEL 04</span><h2>Featured drop</h2><p>Golden Hour Commander Proxy</p><small>Premium casual-play centerpieces with a midnight collector vibe.</small></aside>
      </section>
    </header>

    {view === 'shop' && <section className="panel storefront-panel">
      <div className="launch-strip">{launchNotes.map((note) => <article key={note.title}><strong>{note.title}</strong><p>{note.copy}</p></article>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Now broadcasting</p><h2>Shop the current lineup</h2></div><p>Search by card role, style, or format and add launch-ready pieces to your cart.</p></div>
      <div className="toolbar">
        <input aria-label="Search products" placeholder="Search cards, tokens, commander..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter category" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      {visibleProducts.length === 0 ? <div className="empty-state"><h3>No signal on this channel.</h3><p>Try a different search term or jump back to the full launch catalog.</p><button onClick={() => { setQuery(''); setCategory('All'); }}>Clear search</button></div> : <div className="product-grid">{visibleProducts.map((product) => <article aria-label={`Open listing for ${product.title}`} className={`product-card ${product.inventory <= 0 ? 'sold-out' : ''}`} key={product.id} onClick={(event) => handleProductCardClick(product, event)} onKeyDown={(event) => handleProductCardKeyDown(product, event)} role="link" tabIndex={0}>
        <img src={product.image} alt="" />
        <div className="card-body"><div className="card-kicker"><span className="badge">{product.category}</span><span>{product.inventory > 0 ? `${product.inventory} in stock` : 'Sold out'}</span></div><h2>{product.title}</h2><p>{product.description}</p><a className="detail-link" href={`/products/${product.slug}`} onClick={(e) => { e.preventDefault(); showProduct(product); }} aria-label={`View details for ${product.title}`}>View details</a><div className="tag-row">{product.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><div className="buy-row"><strong>{formatMoney(product.price)}</strong><button disabled={product.inventory <= 0} onClick={() => addToCart(product)}>{product.inventory > 0 ? 'Add to cart' : `Sold out: ${product.title}`}</button></div></div>
      </article>)}</div>}
    </section>}

    {view === 'product' && <section className="panel product-detail-panel">
      {selectedProduct ? <>
        <button className="ghost" onClick={showShop}>← Back to shop</button>
        <div className="product-detail-grid">
          <img src={selectedProduct.image} alt="" />
          <div>
            <p className="eyebrow">{selectedProduct.category}</p>
            <h2>{selectedProduct.title}</h2>
            <p>{selectedProduct.description}</p>
            <p><strong>{formatMoney(selectedProduct.price)}</strong> · {selectedProduct.inventory > 0 ? `${selectedProduct.inventory} in stock` : 'Sold out'}</p>
            <div className="tag-row">{selectedProduct.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
            <div className="seo-share-box"><strong>Shareable listing URL</strong><code>{`/products/${selectedProduct.slug}`}</code><p>Built for direct sharing and search indexing with product-specific title, description, Open Graph, and structured data.</p></div>
            <button disabled={selectedProduct.inventory <= 0} onClick={() => addToCart(selectedProduct)}>{selectedProduct.inventory > 0 ? 'Add to cart' : `Sold out: ${selectedProduct.title}`}</button>
          </div>
        </div>
      </> : <p>{productMessage || 'Loading listing...'}</p>}
    </section>}

    {view === 'cart' && <section className="panel narrow cart-panel">
      <h2>Your cart</h2>
      {cart.length === 0 ? <p>Your cart is waiting for its first social link.</p> : <>
        <div className="cart-items" aria-label="Cart items">
          {cart.map((line) => <div className="cart-line" key={line.product.id}><a className="cart-item-link" href={`/products/${line.product.slug}`} onClick={(e) => { e.preventDefault(); showProduct(line.product); }} aria-label={`View ${line.product.title} listing from cart`}><img src={line.product.image} alt={`${line.product.title} preview`} /><span>{line.product.title}</span></a><label className="quantity-field">Qty<input aria-label={`Quantity for ${line.product.title}`} type="number" min="0" value={line.quantity} onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))} /></label><strong>{formatMoney(line.product.price * line.quantity)}</strong></div>)}
        </div>
        <form className="checkout-form" aria-label="Checkout details" onSubmit={(event) => { event.preventDefault(); void checkout(); }}>
          <div className="checkout-intro">
            <p className="eyebrow">Ready to order</p>
            <h2>Checkout details</h2>
            <p>Complete the details below before continuing to secure Stripe checkout.</p>
          </div>
          <fieldset>
            <legend>Contact information</legend>
            <label>Email address<input type="email" autoComplete="email" placeholder="buyer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Full name<input autoComplete="name" placeholder="Ari Buyer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label>
          </fieldset>
          <fieldset>
            <legend>Shipping address</legend>
            <label>Street address and delivery notes<textarea autoComplete="shipping street-address" placeholder="Street, city, state, ZIP, and any delivery notes" value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} /></label>
          </fieldset>
          <fieldset className="order-summary-box">
            <legend>Order summary</legend>
            <div className="summary-row"><span>{itemCount} {itemCount === 1 ? 'item' : 'items'} in cart</span><strong>Subtotal: {formatMoney(subtotal)}</strong></div>
            <div className="summary-row"><span>Secure checkout</span><span>Stripe</span></div>
          </fieldset>
          <button type="submit">Continue to secure checkout</button>
        </form>
      </>}</section>}

    {view === 'account' && <AccountPanel checkoutMessage={checkoutMessage} />}

    {view === 'contact' && <section className="panel narrow contact-panel">
      <p className="eyebrow">Support channel</p>
      <h2>Contact Midnight Cardworks</h2>
      <p>Questions about a listing, order, custom request, or fulfillment? Send a message and it will go straight to the shop inbox.</p>
      {contactMessage && <p className="status-message">{contactMessage}</p>}
      <form className="contact-form" onSubmit={(event) => void handleContactSubmit(event)}>
        <label>Your name<input aria-label="Your name" required value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
        <label>Your email<input aria-label="Your email" type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></label>
        <label>Order number optional<input aria-label="Order number optional" placeholder="ord_... if this is about an order" value={contactOrderNumber} onChange={(e) => setContactOrderNumber(e.target.value)} /></label>
        <label className="honeypot">Website<input aria-label="Website" tabIndex={-1} autoComplete="off" value={contactWebsite} onChange={(e) => setContactWebsite(e.target.value)} /></label>
        <label>How can we help?<textarea aria-label="How can we help?" required minLength={10} maxLength={3000} value={contactBody} onChange={(e) => setContactBody(e.target.value)} /></label>
        <button type="submit">Send message</button>
      </form>
    </section>}

    {view === 'receipt' && <section className="panel narrow receipt-panel"><p className="eyebrow">Checkout complete</p><h2>{receiptMessage || 'Checking payment status...'}</h2>{receiptOrder ? <div><p className="status-message">Order {receiptOrder.id} — {receiptOrder.status === 'fulfilled' ? 'fulfilled' : receiptOrder.status === 'paid' ? 'paid and confirmed' : 'waiting for Stripe confirmation'}</p>{receiptOrder.shippingAddress && <p>Ship to: {receiptOrder.shippingAddress}</p>}<h3>Total paid: {formatMoney(receiptOrder.total)}</h3><ul>{receiptOrder.items.map((item) => <li key={`${item.title}-${item.quantity}`}>{item.quantity} × {item.title} — {formatMoney(item.price * item.quantity)}</li>)}</ul><p>We saved this order in the admin dashboard for fulfillment.</p><button onClick={() => setView('shop')}>Back to shop</button></div> : <p>Hang tight while Stripe confirms the order.</p>}</section>}

    {view === 'admin' && isAdmin && <section className="panel admin-panel"><div className="admin-header"><div><p className="eyebrow">Seller console</p><h2>Admin dashboard</h2><p>Manage orders and listings from separate workspaces, similar to an Etsy-style shop manager.</p></div><div className="admin-summary"><span>{orders.length} orders</span><span>{adminProducts.length} listings</span></div></div>{adminMessage && <p className="status-message">{adminMessage}</p>}<div className="admin-tabs" role="tablist" aria-label="Admin sections"><button role="tab" aria-selected={adminTab === 'orders'} className={adminTab === 'orders' ? 'active-tab' : 'ghost'} onClick={() => setAdminTab('orders')}>Orders ({orders.length})</button><button role="tab" aria-selected={adminTab === 'listings'} className={adminTab === 'listings' ? 'active-tab' : 'ghost'} onClick={() => setAdminTab('listings')}>Listings ({adminProducts.length})</button></div>{adminTab === 'orders' ? <section className="admin-workspace order-workspace" role="tabpanel"><div className="section-heading"><div><h3>Order navigation</h3><p>Review paid orders, shipping details, and fulfillment status.</p></div></div>{orders.length === 0 ? <p>No orders yet.</p> : <div className="order-list">{orders.map((o) => <article className="order-card" key={o.id}><div><strong>{o.id}: {o.email}</strong><p>{o.customerName ? `${o.customerName} — ` : ''}{o.shippingAddress ? `${o.shippingAddress} — ` : ''}{formatMoney(o.total)} — {o.status}</p></div>{o.status !== 'fulfilled' && <button onClick={() => void handleOrderFulfilled(o)}>Mark {o.id} fulfilled</button>}</article>)}</div>}</section> : <section className="admin-workspace listing-workspace" role="tabpanel"><div className="section-heading"><div><h3>Listing edits</h3><p>Create listings, update details, manage images, and control active storefront visibility.</p></div></div><div className="listing-layout"><div><h3>Create listing</h3>{productEditor(newProduct, true)}</div><div><h3>Current listings</h3>{adminProducts.map((p) => productEditor(p))}</div></div></section>}</section>}

    <footer>Unofficial custom game pieces for casual play. Not affiliated with or endorsed by Wizards of the Coast. Not tournament legal.</footer>
  </main>;
}
