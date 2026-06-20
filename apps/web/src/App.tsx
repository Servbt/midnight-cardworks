import { useEffect, useLayoutEffect, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { cancelAdminOrder, createCheckout, fetchAdminOrders, fetchAdminProducts, fetchCustomerOrders, fetchOrder, fetchProduct, fetchProducts, fulfillAdminOrder, refundAdminOrder, saveAdminProduct, sendContactMessage, uploadProductImage, type Order, type Product } from './api';
import { AccountPanel, useAdminAccess, useCustomerSession } from './auth';
import { redirectToCheckout } from './checkoutRedirect';

type CartLine = { product: Product; quantity: number };
type View = 'home' | 'shop' | 'cart' | 'account' | 'admin' | 'receipt' | 'product' | 'contact';

const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const moneyToCents = (value: string) => Math.round(Number(value || '0') * 100);
const isProductOnSale = (product: Product) => product.saleActive && product.salePrice !== null && product.salePrice > 0 && product.salePrice < product.price;
const effectiveProductPrice = (product: Product) => isProductOnSale(product) ? product.salePrice! : product.price;
const flatShippingCents = 499;
const freeShippingThresholdCents = 5000;
const blankProduct: Product = { id: '', slug: '', title: '', description: '', price: 0, saleActive: false, salePrice: null, category: '', tags: [], image: 'https://placehold.co/600x800/111111/f9f871?text=New+Card', inventory: 0, active: true };
const launchNotes = [
  { title: 'Secure Stripe checkout', copy: 'Payments stay on Stripe so card data never touches the shop server.' },
  { title: 'Made-to-order fulfillment', copy: 'Each order is reviewed, packed, and marked fulfilled from the admin dashboard.' },
  { title: 'Casual-play clarity', copy: 'Every page keeps the unofficial, not-tournament-legal note visible.' }
];
const storefrontStats = ['Custom proxies', 'Token packs', 'Display cards'];
const savedCheckoutInfoKey = 'midnight-cardworks.checkoutInfo';
type ShippingAddressFields = { streetAddress: string; apartment: string; city: string; zipCode: string };
const blankShippingAddressFields: ShippingAddressFields = { streetAddress: '', apartment: '', city: '', zipCode: '' };
const formatShippingAddress = (fields: ShippingAddressFields) => [
  fields.streetAddress.trim(),
  fields.apartment.trim(),
  [fields.city.trim(), fields.zipCode.trim()].filter(Boolean).join(' ')
].filter(Boolean).join(', ');

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [removedCartLine, setRemovedCartLine] = useState<CartLine | null>(null);
  const [cartNotice, setCartNotice] = useState('');
  const [clearCartRequested, setClearCartRequested] = useState(false);
  const [addedProductIds, setAddedProductIds] = useState<string[]>([]);
  const [detailQuantity, setDetailQuantity] = useState('1');
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [shippingAddressFields, setShippingAddressFields] = useState<ShippingAddressFields>(blankShippingAddressFields);
  const [savedCheckoutInfoExists, setSavedCheckoutInfoExists] = useState(false);
  const [savedCheckoutInfoMessage, setSavedCheckoutInfoMessage] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [checkoutValidationMessage, setCheckoutValidationMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [customerOrdersMessage, setCustomerOrdersMessage] = useState('');
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [newProduct, setNewProduct] = useState<Product>(blankProduct);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminTab, setAdminTab] = useState<'orders' | 'listings' | 'sales'>('orders');
  const [listingTab, setListingTab] = useState<'create' | 'current'>('current');
  const [saleSelection, setSaleSelection] = useState<string[]>([]);
  const [bulkSalePercent, setBulkSalePercent] = useState('15');
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundReasons, setRefundReasons] = useState<Record<string, string>>({});
  const [imageDragSlug, setImageDragSlug] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const [productMessage, setProductMessage] = useState('');
  const [productScrollSignal, setProductScrollSignal] = useState(0);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactOrderNumber, setContactOrderNumber] = useState('');
  const [contactBody, setContactBody] = useState('');
  const [contactWebsite, setContactWebsite] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const { isAdmin, getAdminToken } = useAdminAccess();
  const { isSignedIn, email: sessionEmail, getCustomerToken } = useCustomerSession();

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => {
    if (isSignedIn && sessionEmail && !email) setEmail(sessionEmail);
  }, [isSignedIn, sessionEmail, email]);
  useEffect(() => {
    try {
      const savedInfo = window.localStorage.getItem(savedCheckoutInfoKey);
      if (!savedInfo) return;
      const parsed = JSON.parse(savedInfo) as { email?: string; customerName?: string; shippingAddress?: string; shippingAddressFields?: Partial<ShippingAddressFields> };
      setEmail(parsed.email ?? '');
      setCustomerName(parsed.customerName ?? '');
      setShippingAddressFields({ ...blankShippingAddressFields, ...(parsed.shippingAddressFields ?? { streetAddress: parsed.shippingAddress ?? '' }) });
      setSavedCheckoutInfoExists(true);
    } catch {
      window.localStorage.removeItem(savedCheckoutInfoKey);
      setSavedCheckoutInfoExists(false);
    }
  }, []);
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
          setDetailQuantity('1');
          rememberRecentlyViewed(product);
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
      if (window.location.pathname === '/shop') {
        setCategory(params.get('category') ?? 'All');
        setQuery(params.get('q') ?? '');
        setView('shop');
        return;
      }
      if (window.location.pathname === '/admin') {
        setView(isAdmin ? 'admin' : 'account');
        setAdminTab('orders');
        return;
      }
      setSelectedProduct(null);
      setProductMessage('');
      setReceiptOrder(null);
      setReceiptMessage('');
      setView('home');
    }

    applyCurrentLocation();
    window.addEventListener('popstate', applyCurrentLocation);
    return () => window.removeEventListener('popstate', applyCurrentLocation);
  }, [isAdmin]);
  useEffect(() => {
    if (view !== 'admin' || !isAdmin) return;
    getAdminToken().then(async (token) => {
      const authToken = token ?? undefined;
      const [adminListings, adminOrders] = await Promise.all([fetchAdminProducts(authToken), fetchAdminOrders(authToken)]);
      setAdminProducts(adminListings);
      setOrders(adminOrders);
    }).catch(() => { setAdminProducts([]); setOrders([]); });
  }, [view, checkoutMessage, isAdmin]);
  useEffect(() => {
    if (view !== 'account' || !isSignedIn || !sessionEmail) return;
    let cancelled = false;
    setCustomerOrdersMessage('Loading order history...');
    getCustomerToken().then((token) => {
      if (!token) throw new Error('Customer token required');
      return fetchCustomerOrders(token);
    }).then((orderHistory) => {
      if (cancelled) return;
      setCustomerOrders(orderHistory);
      setCustomerOrdersMessage(orderHistory.length === 0 ? 'No orders saved to this account yet.' : '');
    }).catch(() => {
      if (cancelled) return;
      setCustomerOrders([]);
      setCustomerOrdersMessage('Could not load order history yet.');
    });
    return () => { cancelled = true; };
  }, [view, isSignedIn, sessionEmail]);

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];
  const visibleProducts = useMemo(() => products.filter((p) => {
    const matchesQuery = [p.title, p.description, p.category, ...p.tags].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === 'All' || p.category === category);
  }), [products, query, category]);
  const subtotal = cart.reduce((sum, line) => sum + effectiveProductPrice(line.product) * line.quantity, 0);
  const shippingCost = subtotal >= freeShippingThresholdCents ? 0 : flatShippingCents;
  const orderTotal = subtotal + shippingCost;
  const freeShippingRemaining = Math.max(0, freeShippingThresholdCents - subtotal);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const shippingAddress = useMemo(() => formatShippingAddress(shippingAddressFields), [shippingAddressFields]);

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
    } else if (view === 'home' || view === 'shop') {
      document.title = 'Midnight Cardworks';
    }
  }, [view, selectedProduct]);

  useLayoutEffect(() => {
    if (productScrollSignal === 0 || view !== 'product' || !selectedProduct) return;
    scrollToPageTop({ behavior: 'auto' });
  }, [productScrollSignal, selectedProduct, view]);

  function showProduct(product: Product) {
    setSelectedProduct(product);
    setDetailQuantity('1');
    rememberRecentlyViewed(product);
    setView('product');
    window.history.pushState({}, '', `/products/${product.slug}`);
    setProductScrollSignal((signal) => signal + 1);
  }

  function rememberRecentlyViewed(product: Product) {
    setRecentlyViewed((items) => [product, ...items.filter((item) => item.id !== product.id)].slice(0, 3));
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

  function stopConfirmationNavigation(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function scrollToPageTop(options: { behavior?: ScrollBehavior } = {}) {
    window.scrollTo({ top: 0, left: 0, behavior: options.behavior ?? 'smooth' });
  }

  function shopPath(nextCategory = category, nextQuery = query) {
    const params = new URLSearchParams();
    if (nextCategory && nextCategory !== 'All') params.set('category', nextCategory);
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    const search = params.toString();
    return `/shop${search ? `?${search}` : ''}`;
  }

  function showHome(options: { scrollToTop?: boolean } = {}) {
    setView('home');
    if (window.location.pathname === '/') window.history.replaceState({}, '', '/');
    else window.history.pushState({}, '', '/');
    if (options.scrollToTop) scrollToPageTop();
  }

  function showShop(options: { scrollToTop?: boolean; category?: string; query?: string } = {}) {
    const nextCategory = options.category ?? category;
    const nextQuery = options.query ?? query;
    if (options.category !== undefined) setCategory(nextCategory);
    if (options.query !== undefined) setQuery(nextQuery);
    setView('shop');
    const nextPath = shopPath(nextCategory, nextQuery);
    if (`${window.location.pathname}${window.location.search}` === nextPath) window.history.replaceState({}, '', nextPath);
    else window.history.pushState({}, '', nextPath);
    if (options.scrollToTop) scrollToPageTop();
  }

  function showContact(options: { scrollToTop?: boolean } = {}) {
    setView('contact');
    if (options.scrollToTop) scrollToPageTop();
  }

  function showCart() {
    setView('cart');
    if (window.location.pathname !== '/cart') window.history.pushState({}, '', '/cart');
  }

  function showAdmin() {
    if (!isAdmin) return;
    setView('admin');
    setAdminTab('orders');
    if (window.location.pathname !== '/admin') window.history.pushState({}, '', '/admin');
    scrollToPageTop();
  }

  function continueShopping() {
    showShop({ category: 'All', query: '' });
  }

  function browseTokenPacks() {
    showShop({ category: 'All', query: 'token' });
  }

  function startOrder() {
    setView('contact');
  }

  const recentlyViewedSection = recentlyViewed.length > 0 ? <section className="recently-viewed" aria-label="Recently viewed listings">
    <div><p className="eyebrow">Keep browsing</p><h3>Recently viewed</h3><p>Continue browsing where you left off.</p></div>
    <div className="recently-viewed-list">{recentlyViewed.map((product) => <article key={product.id}>
      <img src={product.image} alt="" />
      <div><strong>{product.title}</strong><span>{formatMoney(effectiveProductPrice(product))} · {product.category}</span></div>
      <button className="ghost" type="button" onClick={() => showProduct(product)} aria-label={`Continue browsing ${product.title}`}>View again</button>
    </article>)}</div>
  </section> : null;

  function normalizeProductQuantity(product: Product, quantity: number | string) {
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity)) return 1;
    return Math.max(1, Math.min(product.inventory, numericQuantity));
  }

  function addToCart(product: Product, quantity: number | string = 1) {
    const safeQuantity = normalizeProductQuantity(product, quantity);
    setCart((lines) => {
      const existing = lines.find((line) => line.product.id === product.id);
      if (existing) return lines.map((line) => line.product.id === product.id ? { ...line, quantity: Math.min(product.inventory, line.quantity + safeQuantity) } : line);
      return [...lines, { product, quantity: safeQuantity }];
    });
    setRemovedCartLine(null);
    setCartNotice('');
    setClearCartRequested(false);
    setAddedProductIds((ids) => ids.includes(product.id) ? ids : [...ids, product.id]);
  }

  function productAddedMessage(product: Product, quantity = 1) {
    return quantity > 1 ? `Added ${quantity} ${product.title} to your cart.` : 'Added to cart';
  }

  function orderStatusLabel(status: string) {
    const labels: Record<string, string> = {
      pending_payment: 'Pending payment',
      paid: 'Paid',
      fulfilled: 'Fulfilled',
      canceled: 'Canceled',
      refund_pending: 'Refund pending',
      partially_refunded: 'Partially refunded',
      refunded: 'Refunded',
      refund_failed: 'Refund failed'
    };
    return labels[status] ?? status;
  }

  function refundableAmount(order: Order) {
    return Math.max(0, order.total - (order.refundedAmount ?? 0));
  }

  function canRefundOrder(order: Order) {
    return ['paid', 'fulfilled', 'partially_refunded', 'refund_failed'].includes(order.status) && refundableAmount(order) > 0;
  }

  function orderItemSummary(order: Order) {
    return order.items.map((item) => `${item.quantity} × ${item.title} — ${formatMoney(item.price * item.quantity)}`);
  }

  function contactSupportAboutOrder(orderId: string) {
    setContactOrderNumber(orderId);
    setView('contact');
  }

  function isProductAdded(product: Product) {
    return addedProductIds.includes(product.id);
  }

  function updateDetailQuantity(product: Product, quantity: string) {
    if (quantity === '') {
      setDetailQuantity('');
      return;
    }
    setDetailQuantity(String(normalizeProductQuantity(product, quantity)));
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((lines) => lines.map((line) => {
      if (line.product.id !== productId) return line;
      const nextQuantity = Math.max(1, Math.min(line.product.inventory, quantity));
      return { ...line, quantity: nextQuantity };
    }));
    setCartNotice('');
    setClearCartRequested(false);
  }

  function removeFromCart(productId: string) {
    const removed = cart.find((line) => line.product.id === productId);
    setCart((lines) => lines.filter((line) => line.product.id !== productId));
    setRemovedCartLine(removed ?? null);
    setCartNotice(removed ? `Removed ${removed.product.title} from your cart.` : 'Removed item from your cart.');
    setClearCartRequested(false);
  }

  function undoRemoveFromCart() {
    if (!removedCartLine) return;
    setCart((lines) => lines.some((line) => line.product.id === removedCartLine.product.id) ? lines : [...lines, removedCartLine]);
    setRemovedCartLine(null);
    setCartNotice('');
  }

  function requestClearCart() {
    setRemovedCartLine(null);
    setClearCartRequested(true);
    setCartNotice(`Clear all ${itemCount} ${itemCount === 1 ? 'item' : 'items'} from your cart?`);
  }

  function confirmClearCart() {
    const clearedCount = itemCount;
    setCart([]);
    setRemovedCartLine(null);
    setClearCartRequested(false);
    setCartNotice(`Cleared ${clearedCount} ${clearedCount === 1 ? 'item' : 'items'} from your cart.`);
  }

  function saveCheckoutInfoOnDevice() {
    window.localStorage.setItem(savedCheckoutInfoKey, JSON.stringify({ email, customerName, shippingAddress, shippingAddressFields }));
    setSavedCheckoutInfoExists(true);
    setSavedCheckoutInfoMessage('Checkout info saved on this device.');
  }

  function clearSavedCheckoutInfo() {
    window.localStorage.removeItem(savedCheckoutInfoKey);
    setEmail('');
    setCustomerName('');
    setShippingAddressFields(blankShippingAddressFields);
    setSavedCheckoutInfoExists(false);
    setSavedCheckoutInfoMessage('Saved checkout info cleared from this device.');
  }

  function updateShippingAddressField(field: keyof ShippingAddressFields, value: string) {
    setShippingAddressFields((fields) => ({ ...fields, [field]: value }));
  }

  async function checkout() {
    const checkoutEmail = email.trim();
    const checkoutCustomerName = customerName.trim();
    const checkoutShippingAddressFields = {
      streetAddress: shippingAddressFields.streetAddress.trim(),
      apartment: shippingAddressFields.apartment.trim(),
      city: shippingAddressFields.city.trim(),
      zipCode: shippingAddressFields.zipCode.trim()
    };
    if (!checkoutEmail) {
      setCheckoutValidationMessage('Email address required — we’ll only use this for order updates or design/print issues.');
      return;
    }
    if (!checkoutCustomerName) {
      setCheckoutValidationMessage('Full name is required for shipping.');
      return;
    }
    const missingShipping = [
      !checkoutShippingAddressFields.streetAddress ? 'street address' : '',
      !checkoutShippingAddressFields.city ? 'city' : '',
      !checkoutShippingAddressFields.zipCode ? 'ZIP code' : ''
    ].filter(Boolean);
    if (missingShipping.length > 0) {
      setCheckoutValidationMessage(`Shipping ${missingShipping.join(', ')} required before payment.`);
      return;
    }
    const checkout = await createCheckout(checkoutEmail, checkoutCustomerName, checkoutShippingAddressFields, cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })));
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
      setContactMessage('sent');
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

  function handleImageDrop(product: Product, event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setImageDragSlug(null);
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/'));
    if (!file) {
      setAdminMessage(`Drop an image file for ${product.title}.`);
      return;
    }
    void handleImageUpload(product, file);
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

  function updateSaleSelection(slug: string, checked: boolean) {
    setSaleSelection((items) => checked ? [...new Set([...items, slug])] : items.filter((item) => item !== slug));
  }

  function defaultSalePrice(product: Product) {
    const percent = Number(bulkSalePercent);
    const safePercent = Number.isFinite(percent) && percent > 0 && percent < 100 ? percent : 15;
    return Math.max(1, Math.min(product.price - 1, Math.round(product.price * (1 - safePercent / 100))));
  }

  function patchSaleProducts(slugs: string[], patcher: (product: Product) => Partial<Product>) {
    const targets = new Set(slugs);
    setAdminProducts((items) => items.map((item) => targets.has(item.slug) ? { ...item, ...patcher(item) } : item));
  }

  function applyBulkSalePercent() {
    const percent = Number(bulkSalePercent);
    if (saleSelection.length === 0) {
      setAdminMessage('Select one or more listings before applying a sale.');
      return;
    }
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      setAdminMessage('Enter a sale percentage between 1 and 99.');
      return;
    }
    patchSaleProducts(saleSelection, (product) => ({ saleActive: true, salePrice: Math.max(1, Math.min(product.price - 1, Math.round(product.price * (1 - percent / 100)))) }));
    setAdminMessage(`Applied ${percent}% sale pricing to ${saleSelection.length} selected ${saleSelection.length === 1 ? 'listing' : 'listings'}.`);
  }

  function enableSelectedSales() {
    if (saleSelection.length === 0) {
      setAdminMessage('Select one or more listings before enabling a sale.');
      return;
    }
    patchSaleProducts(saleSelection, (product) => ({ saleActive: true, salePrice: product.salePrice && product.salePrice < product.price ? product.salePrice : defaultSalePrice(product) }));
    setAdminMessage(`Enabled sale pricing for ${saleSelection.length} selected ${saleSelection.length === 1 ? 'listing' : 'listings'}.`);
  }

  function disableSelectedSales() {
    if (saleSelection.length === 0) {
      setAdminMessage('Select one or more listings before disabling a sale.');
      return;
    }
    patchSaleProducts(saleSelection, () => ({ saleActive: false }));
    setAdminMessage(`Disabled sale pricing for ${saleSelection.length} selected ${saleSelection.length === 1 ? 'listing' : 'listings'}.`);
  }

  async function handleSaleSave(productsToSave: Product[]) {
    if (productsToSave.length === 0) {
      setAdminMessage('Select one or more listings to save sale changes.');
      return;
    }
    const invalid = productsToSave.find((product) => product.saleActive && (!product.salePrice || product.salePrice >= product.price));
    if (invalid) {
      setAdminMessage(`Sale price for ${invalid.title} must be lower than the regular price.`);
      return;
    }
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const savedProducts = await Promise.all(productsToSave.map((product) => saveAdminProduct(product, token)));
      savedProducts.forEach(rememberSavedProduct);
      setAdminMessage(`Saved sale settings for ${savedProducts.length} ${savedProducts.length === 1 ? 'listing' : 'listings'}.`);
    } catch {
      setAdminMessage('Could not save sale settings.');
    }
  }

  function rememberUpdatedOrder(updated: Order) {
    setOrders((items) => items.map((item) => item.id === updated.id ? updated : item));
    setRefundAmounts((amounts) => ({ ...amounts, [updated.id]: '' }));
  }

  async function handleOrderFulfilled(order: Order) {
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const updated = await fulfillAdminOrder(order.id, token);
      rememberUpdatedOrder(updated);
      setAdminMessage(`Marked ${updated.id} fulfilled.`);
    } catch {
      setAdminMessage(`Could not fulfill ${order.id}.`);
    }
  }

  async function handleOrderCanceled(order: Order) {
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const updated = await cancelAdminOrder(order.id, refundReasons[order.id] ?? '', token);
      rememberUpdatedOrder(updated);
      setAdminMessage(`Canceled ${updated.id}.`);
    } catch {
      setAdminMessage(`Could not cancel ${order.id}.`);
    }
  }

  async function handleOrderRefunded(order: Order, fullRefund = false) {
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin token required');
      const amountValue = refundAmounts[order.id]?.trim();
      const amount = fullRefund || !amountValue ? refundableAmount(order) : moneyToCents(amountValue);
      const updated = await refundAdminOrder(order.id, { amount, reason: refundReasons[order.id] ?? '' }, token);
      rememberUpdatedOrder(updated);
      setAdminMessage(`Refund updated for ${updated.id}.`);
    } catch {
      setAdminMessage(`Could not refund ${order.id}.`);
    }
  }

  function renderOrderCard(order: Order) {
    const remainingRefund = refundableAmount(order);
    const canFulfill = order.status === 'paid' || order.status === 'refund_failed';
    return <article className="order-card" key={order.id}>
      <div className="order-card-header"><strong>{order.id}: {order.email}</strong><span className="status-badge">{orderStatusLabel(order.status)}</span></div>
      <div className="order-detail-grid"><div><strong>Customer</strong><p>{order.customerName || order.email}</p></div><div><strong>Shipping</strong><p>{order.shippingAddress || 'Shipping address not provided yet.'}</p></div><div><strong>Total</strong><p>{formatMoney(order.total)}</p></div></div>
      <div><strong>Items</strong><ul>{orderItemSummary(order).map((item) => <li key={`${order.id}-${item}`}>{item}</li>)}</ul></div>
      {(order.refundedAmount ?? 0) > 0 && <p>Refunded: {formatMoney(order.refundedAmount)}{order.stripeRefundId ? ` (${order.stripeRefundId})` : ''}</p>}
      {order.refundReason && <p>Refund note: {order.refundReason}</p>}
      <div className="order-actions">
        {canFulfill && <button onClick={() => void handleOrderFulfilled(order)}>Mark {order.id} fulfilled</button>}
        {order.status === 'pending_payment' && <button className="ghost" onClick={() => void handleOrderCanceled(order)}>Cancel pending order</button>}
        {canRefundOrder(order) && <>
          <label>Refund amount for {order.id}<input aria-label={`Refund amount for ${order.id}`} type="number" step="0.01" min="0.01" max={(remainingRefund / 100).toFixed(2)} placeholder={(remainingRefund / 100).toFixed(2)} value={refundAmounts[order.id] ?? ''} onChange={(event) => setRefundAmounts((amounts) => ({ ...amounts, [order.id]: event.target.value }))} /></label>
          <label>Refund note for {order.id}<input aria-label={`Refund note for ${order.id}`} placeholder="Customer request, damaged item..." value={refundReasons[order.id] ?? ''} onChange={(event) => setRefundReasons((reasons) => ({ ...reasons, [order.id]: event.target.value }))} /></label>
          <button className="ghost" onClick={() => void handleOrderRefunded(order)}>Refund entered amount</button>
          <button onClick={() => void handleOrderRefunded(order, true)}>Full refund {formatMoney(remainingRefund)}</button>
        </>}
      </div>
    </article>;
  }

  function productEditor(product: Product, isNew = false) {
    const originalTitle = isNew ? 'new product' : products.find((item) => item.slug === product.slug)?.title || product.title || product.slug;
    const setProduct = (patch: Partial<Product>) => isNew ? setNewProduct((item) => ({ ...item, ...patch })) : updateAdminProduct(product.slug, patch);
    const saveLabel = isNew ? 'Create product listing' : `Save ${originalTitle}`;
    const dropzoneClass = `image-dropzone${imageDragSlug === product.slug ? ' is-dragging' : ''}`;
    return <article className={`admin-listing product-editor${isNew ? ' new-product-editor' : ''}`} key={isNew ? 'new-product' : product.id}>
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
        {!isNew && <label
          className={dropzoneClass}
          onDragEnter={(event) => { event.preventDefault(); setImageDragSlug(product.slug); }}
          onDragOver={(event) => { event.preventDefault(); setImageDragSlug(product.slug); }}
          onDragLeave={(event) => { event.preventDefault(); setImageDragSlug(null); }}
          onDrop={(event) => handleImageDrop(product, event)}
        >
          <span>Upload image for {originalTitle}</span>
          <input aria-label={`Upload image for ${originalTitle}`} type="file" accept="image/*" onChange={(e) => void handleImageUpload(product, e.currentTarget.files?.[0])} />
          <small>Drop image here or choose a file</small>
        </label>}
        <button onClick={() => void handleProductSave(product)}>{saveLabel}</button>
      </div>
    </article>;
  }

  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const saleSelectedProducts = adminProducts.filter((product) => saleSelection.includes(product.slug));

  const navigation = <div className="top-nav" role="banner">
    <div className="nav-primary">
      <a className="brand" href="/" aria-label="Midnight Cardworks home" onClick={(event) => { event.preventDefault(); showHome({ scrollToTop: true }); }}>Midnight Cardworks</a>
      <div className="nav-search">
        <span className="nav-search-icon" aria-hidden="true">⌕</span>
        <input
          aria-label="Search products"
          placeholder="Search cards, tokens, commander..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (view !== 'shop') showShop({ query: e.target.value }); }}
        />
      </div>
      <div className="nav-actions">
        <button className="nav-icon-btn" aria-label={`Account`} onClick={() => setView('account')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </button>
        <button className="nav-icon-btn" aria-label={`Cart, ${cartCount} item${cartCount !== 1 ? 's' : ''}`} onClick={showCart}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          {cartCount > 0 && <span className="nav-cart-count" aria-hidden="true">{cartCount}</span>}
        </button>
        {isAdmin && <button className="nav-icon-btn nav-admin-btn" aria-label="Admin dashboard" onClick={showAdmin}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span>Admin</span>
        </button>}
      </div>
    </div>
    <nav className="nav-secondary" aria-label="Shop categories">
      <button className={`nav-tab${view === 'shop' && category === 'All' ? ' active' : ''}`} onClick={() => showShop({ category: 'All', scrollToTop: true })}>All</button>
      {categories.filter((c) => c !== 'All').map((c) => (
        <button key={c} className={`nav-tab${view === 'shop' && category === c ? ' active' : ''}`} onClick={() => showShop({ category: c, scrollToTop: true })}>{c}</button>
      ))}
      <button className={`nav-tab${view === 'contact' ? ' active' : ''}`} onClick={() => showContact({ scrollToTop: true })}>Contact</button>
    </nav>
  </div>;

  return <main>
    {navigation}

    {view === 'home' ? <header className="hero">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Midnight Collector Studio</span>
          <h1>Cards made for the midnight table.</h1>
          <p className="hero-sub">Premium custom proxies, token packs, and display cards with a dark collector finish — built for commander nights, gifts, and display binders.</p>
          <div className="cta-row">
            <button onClick={() => showShop({ category: 'All', query: '' })}>Shop the collection</button>
            <button className="ghost" onClick={startOrder}>Start a commission</button>
          </div>
          <div className="mini-stats" aria-label="Storefront highlights">{storefrontStats.map((stat) => <span key={stat}>{stat}</span>)}</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-card-glow" />
          <div className="hero-card">
            <div className="hero-card-inner">
              <span className="hero-card-label">Featured</span>
              <span className="hero-card-title">Golden Hour<br />Commander Proxy</span>
              <span className="hero-card-price">From $12.99</span>
            </div>
          </div>
          <p className="hero-art-caption">Made-to-order · Casual play · Dark collector finish</p>
        </div>
      </div>
    </header> : null}

    {view === 'home' && <section className="panel storefront-panel">
      <section className="landing-section gallery-preview" aria-label="Gallery preview">
        <div className="section-heading"><div><span className="eyebrow">Gallery preview</span><h2>Examples from the collection.</h2></div><p>Commander proxies, token packs, and display cards — all with a dark collector finish.</p></div>
        <div className="gallery-preview-grid">{products.slice(0, 3).map((product) => {
          const catClass = product.category === 'Commander' ? 'badge badge-commander' : product.category === 'Tokens' ? 'badge badge-tokens' : 'badge badge-display';
          return <article key={`preview-${product.id}`} onClick={() => showProduct(product)} role="link" tabIndex={0} aria-label={`Preview ${product.title}`}>
            <div className="card-img-frame"><img src={product.image} alt={`${product.title} card preview`} loading="lazy" /></div>
            <div className="card-info"><span className={catClass}>{product.category}</span><h3>{product.title}</h3><p>{product.description}</p></div>
          </article>;
        })}</div>
      </section>
    </section>}

    {(view === 'home' || view === 'shop') && <section className="panel storefront-panel shop-lineup-page" aria-label="Shop the current lineup">
      <h2 className="shop-section-heading">Shop the current lineup</h2>
      <div className="shop-layout">
        <aside className="shop-sidebar" aria-label="Shop filters">
          <div className="sidebar-header"><h3>Filters</h3>{(query || category !== 'All') && <button className="sidebar-clear" type="button" onClick={() => showShop({ category: 'All', query: '' })}>Clear</button>}</div>
          <div className="filter-section">
            <button className="filter-section-toggle" type="button" aria-expanded="true">Category<span className="filter-chevron open">▾</span></button>
            <div className="filter-options">
              {categories.map((c) => (
                <label key={c} className="filter-option">
                  <input type="checkbox" checked={category === c} onChange={() => showShop({ category: c })} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <div className="filter-section">
            <button className="filter-section-toggle" type="button" aria-expanded="true">Search<span className="filter-chevron open">▾</span></button>
            <div className="filter-options" style={{ paddingTop: '.35rem' }}>
              <input aria-label="Search products" placeholder="Search cards, tokens..." value={query} onChange={(e) => showShop({ query: e.target.value })} style={{ width: '100%', fontSize: '.82rem', padding: '.55rem .75rem' }} />
            </div>
          </div>
          <div className="sidebar-cta">
            <button type="button" onClick={startOrder}>Request custom card</button>
          </div>
        </aside>
        <div className="shop-results">
          <div className="results-bar">
            <span className="results-count">{visibleProducts.length} {visibleProducts.length === 1 ? 'item' : 'items'}</span>
            <div className="results-controls">
              <span style={{ fontSize: '.8rem', color: 'var(--text-3)', fontWeight: 600 }}>Sort</span>
              <select aria-label="Filter category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ display: 'none' }}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          {visibleProducts.length === 0
            ? <div className="empty-state"><h3>No signal on this channel.</h3><p>Try a different search term or browse the full collection.</p><button onClick={() => showShop({ category: 'All', query: '' })}>Clear filters</button></div>
            : <div className="product-grid">{visibleProducts.map((product) => {
                const categoryBadgeClass = product.category === 'Commander' ? 'badge badge-commander' : product.category === 'Tokens' ? 'badge badge-tokens' : product.category === 'Display' ? 'badge badge-display' : 'badge';
                return <article
                  aria-label={`Open listing for ${product.title}`}
                  className={`product-card${product.inventory <= 0 ? ' sold-out' : ''}`}
                  key={product.id}
                  onClick={(event) => handleProductCardClick(product, event)}
                  onKeyDown={(event) => handleProductCardKeyDown(product, event)}
                  role="link"
                  tabIndex={0}
                >
                  <div className="product-card__img-wrap">
                    <img src={product.image} alt={`${product.title} card preview`} loading="lazy" />
                    <div className="product-card__badges">
                      {product.inventory <= 0 && <span className="badge badge-sold">Sold out</span>}
                      {product.inventory > 0 && product.inventory <= 5 && <span className="badge badge-new">Low stock</span>}
                      {isProductOnSale(product) && <span className="badge badge-sale">On sale</span>}
                      <span className={categoryBadgeClass}>{product.category}</span>
                    </div>
                    {isProductAdded(product)
                      ? <p className="inline-cart-confirmation" role="status" onClick={stopConfirmationNavigation} onKeyDown={stopConfirmationNavigation}>{productAddedMessage(product)}</p>
                      : <button className="product-card__cart-btn" disabled={product.inventory <= 0} onClick={() => addToCart(product)} type="button">
                          {product.inventory > 0 ? 'Add to cart' : `Sold out: ${product.title}`}
                        </button>
                    }
                  </div>
                  <div className="product-card__info">
                    <span className="product-card__name">{product.title}</span>
                    <span className="product-card__meta">{product.category}{product.tags.length > 0 ? ` · #${product.tags[0]}` : ''}</span>
                    <div className={`price-stack${isProductOnSale(product) ? ' is-sale' : ''}`}>
                      <span className="product-card__price-label">From</span>
                      {isProductOnSale(product) && <span className="product-card__original-price">{formatMoney(product.price)}</span>}
                      <span className="product-card__price">{formatMoney(effectiveProductPrice(product))}</span>
                    </div>
                    <a className="detail-link" href={`/products/${product.slug}`} onClick={(e) => { e.preventDefault(); showProduct(product); }} aria-label={`View details for ${product.title}`}>View details →</a>
                  </div>
                </article>;
              })}</div>
          }
        </div>
      </div>
    </section>}

    {view === 'product' && <section className="panel product-detail-panel">
      {selectedProduct ? <>
        <button className="ghost" onClick={() => showShop()}>← Back to shop</button>
        <div className="product-detail-grid">
          <div className="product-detail-img-col">
            <img src={selectedProduct.image} alt={`${selectedProduct.title} card art`} />
            <table className="product-detail-meta-table">
              <tbody>
                <tr><td>Category</td><td>{selectedProduct.category}</td></tr>
                <tr><td>Stock</td><td>{selectedProduct.inventory > 0 ? `${selectedProduct.inventory} available` : 'Sold out'}</td></tr>
                {selectedProduct.tags.length > 0 && <tr><td>Tags</td><td>{selectedProduct.tags.map((t) => `#${t}`).join(' ')}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="product-detail-info">
            <span className="eyebrow">{selectedProduct.category}</span>
            <h2>{selectedProduct.title}</h2>
            <div className={`product-detail-price-block${isProductOnSale(selectedProduct) ? ' is-sale' : ''}`}>
              <span className="product-detail-price-label">From</span>
              {isProductOnSale(selectedProduct) && <span className="product-detail-original-price">{formatMoney(selectedProduct.price)}</span>}
              <span className="product-detail-price">{formatMoney(effectiveProductPrice(selectedProduct))}</span>
            </div>
            <p className="product-detail-desc">{selectedProduct.description}</p>
            <div className="tag-row">{selectedProduct.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
            {selectedProduct.inventory > 0 && (
              <label className="detail-quantity-field">Quantity for {selectedProduct.title}
                <input aria-label={`Quantity for ${selectedProduct.title}`} type="number" min="1" max={selectedProduct.inventory} value={detailQuantity} onChange={(e) => updateDetailQuantity(selectedProduct, e.target.value)} />
              </label>
            )}
            {isProductAdded(selectedProduct) && <p className="detail-confirmation" role="status" onClick={stopConfirmationNavigation} onKeyDown={stopConfirmationNavigation}>{productAddedMessage(selectedProduct, normalizeProductQuantity(selectedProduct, detailQuantity))}</p>}
            <button className="product-detail-add-btn" disabled={selectedProduct.inventory <= 0} onClick={() => addToCart(selectedProduct, detailQuantity)}>
              {selectedProduct.inventory > 0
                ? (normalizeProductQuantity(selectedProduct, detailQuantity) > 1 ? `Add ${normalizeProductQuantity(selectedProduct, detailQuantity)} to cart` : 'Add to cart')
                : `Sold out: ${selectedProduct.title}`}
            </button>
            <div className="trust-strip">
              <span>🔒 Secure Stripe checkout</span>
              <span>✦ Made-to-order</span>
              <span>⚠ Casual play only</span>
            </div>
            <div className="seo-share-box">
              <strong>Shareable listing URL</strong>
              <code>{`/products/${selectedProduct.slug}`}</code>
              <p>Built for direct sharing and search indexing with product-specific title, description, Open Graph, and structured data.</p>
            </div>
          </div>
        </div>
      </> : <p>{productMessage || 'Loading listing...'}</p>}
    </section>}

    {view === 'cart' && <section className="panel cart-panel" role="region" aria-label="Cart marketplace layout">
      <div className="cart-heading-row"><div><p className="eyebrow">Shopping Cart</p><h2>Your cart</h2>{cart.length > 0 && <span className="cart-item-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>}</div>{cart.length > 0 && <button className="ghost clear-cart-button" type="button" onClick={requestClearCart}>Clear cart</button>}</div>
      {cartNotice && <div className="cart-status" role="status"><span>{cartNotice}</span>{removedCartLine && <button className="ghost" type="button" onClick={undoRemoveFromCart} aria-label={`Undo removing ${removedCartLine.product.title}`}>Undo</button>}{clearCartRequested && <div className="cart-status-actions"><button type="button" onClick={confirmClearCart}>Confirm clear cart</button><button className="ghost" type="button" onClick={() => { setClearCartRequested(false); setCartNotice(''); }}>Keep items</button></div>}</div>}
      {cart.length === 0 ? <><div className="empty-cart-state"><p className="eyebrow">No items queued</p><h3>Your cart is empty — tune into the latest drops.</h3><p>Start with commander proxies, token packs, or display cards built for casual play.</p><p>Sign in from your account page to reuse saved checkout info from a previous visit.</p><div className="empty-cart-actions"><button onClick={continueShopping}>Continue shopping</button><button className="ghost" onClick={browseTokenPacks}>Browse token packs</button></div><div className="empty-cart-cues" aria-label="Why shop Midnight Cardworks">{launchNotes.map((note) => <span key={note.title}>{note.title}</span>)}</div></div>{recentlyViewedSection}</> : <>
        <form className="checkout-form cart-marketplace-shell" aria-label="Checkout details" onSubmit={(event) => { event.preventDefault(); void checkout(); }}>
          <div className="cart-main-column">
          <section className="cart-items-card" role="region" aria-label="Items in your cart">
            <div className="cart-section-header"><div><h3>Items in your cart</h3><p>{itemCount} {itemCount === 1 ? 'item' : 'items'} in cart</p></div><div className="cart-column-labels" aria-hidden="true"><span>Item</span><span>Quantity</span><span>Price</span></div></div>
            <div className="cart-items" aria-label="Cart items">
              {cart.map((line) => <div className="cart-line" key={line.product.id}><a className="cart-item-link" href={`/products/${line.product.slug}`} onClick={(e) => { e.preventDefault(); showProduct(line.product); }} aria-label={`View ${line.product.title} listing from cart`}><img src={line.product.image} alt={`${line.product.title} preview`} /><span>{line.product.title}</span><small>Fulfilled by Midnight Cardworks</small></a><div className="cart-line-actions"><button className="quantity-stepper" type="button" disabled={line.quantity <= 1} onClick={() => updateQuantity(line.product.id, line.quantity - 1)} aria-label={`Decrease quantity for ${line.product.title}`}>−</button><label className="quantity-field">Qty<input aria-label={`Quantity for ${line.product.title}`} type="number" min="1" max={line.product.inventory} value={line.quantity} onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))} /></label><button className="quantity-stepper" type="button" disabled={line.quantity >= line.product.inventory} onClick={() => updateQuantity(line.product.id, line.quantity + 1)} aria-label={`Increase quantity for ${line.product.title}`}>+</button><button className="remove-cart-item" type="button" onClick={() => removeFromCart(line.product.id)} aria-label={`Remove ${line.product.title} from cart`}>Remove</button></div><strong className="cart-line-total">Line total: {formatMoney(effectiveProductPrice(line.product) * line.quantity)}</strong></div>)}
            </div>
          </section>
          <div className="checkout-intro">
            <p className="eyebrow">Ready to order</p>
            <ol className="checkout-progress" aria-label="Checkout progress">
              <li className="complete">1. Cart review</li>
              <li className="current" aria-current="step">2. Checkout details</li>
              <li>3. Secure payment</li>
              <li>4. Confirmation</li>
            </ol>
            <h2>Checkout details</h2>
            <p><strong>Step 2 of 4: Checkout details</strong></p>
            <p>Review items and enter your delivery details before secure Stripe payment.</p>
            <p className="next-step">Payment is processed securely by Stripe.</p>
            <p>After payment, you’ll return here for confirmation and fulfillment tracking.</p>
          </div>
          <fieldset>
            <legend>Contact information</legend>
            <label>Email address<input type="email" required autoComplete="email" placeholder="buyer@example.com" value={email} onInvalid={() => setCheckoutValidationMessage('Email address required — we’ll only use this for order updates or design/print issues.')} onChange={(e) => { setEmail(e.target.value); setCheckoutValidationMessage(''); }} /></label>
            <p className="field-note">Required so we can send order updates and contact you if there’s a design or print issue.</p>
            {checkoutValidationMessage && <p className="status-message" role="status">{checkoutValidationMessage}</p>}
            <label>Full name<input required autoComplete="name" placeholder="Ari Buyer" value={customerName} onChange={(e) => { setCustomerName(e.target.value); setCheckoutValidationMessage(''); }} /></label>
          </fieldset>
          <fieldset className="delivery-fieldset">
            <legend>Delivery information</legend>
            <div className="shipping-address-grid">
              <label>Street address<input required autoComplete="shipping address-line1" placeholder="123 Midnight Lane" value={shippingAddressFields.streetAddress} onChange={(e) => { updateShippingAddressField('streetAddress', e.target.value); setCheckoutValidationMessage(''); }} /></label>
              <label>Apartment number <span className="optional-label">optional</span><input aria-label="Apartment number" autoComplete="shipping address-line2" placeholder="Apt 4B" value={shippingAddressFields.apartment} onChange={(e) => updateShippingAddressField('apartment', e.target.value)} /></label>
              <label>City<input required autoComplete="shipping address-level2" placeholder="Austin" value={shippingAddressFields.city} onChange={(e) => { updateShippingAddressField('city', e.target.value); setCheckoutValidationMessage(''); }} /></label>
              <label>ZIP code<input required autoComplete="shipping postal-code" inputMode="numeric" placeholder="78701" value={shippingAddressFields.zipCode} onChange={(e) => { updateShippingAddressField('zipCode', e.target.value); setCheckoutValidationMessage(''); }} /></label>
            </div>
            <p className="field-note">Use separate fields so shipping labels and delivery review stay clear.</p>
          </fieldset>
          <section className="saved-checkout-info" aria-label="Saved checkout info">
            <label className="checkbox-row"><input aria-label="Save my checkout info on this device" type="checkbox" checked={savedCheckoutInfoExists} onChange={(e) => { if (e.target.checked) saveCheckoutInfoOnDevice(); }} /> Save my checkout info on this device</label>
            <p>Saved only in this browser. Not synced to your account.</p>
            {savedCheckoutInfoMessage && <p className="status-message" role="status">{savedCheckoutInfoMessage}</p>}
            {savedCheckoutInfoExists && <button className="ghost" type="button" onClick={clearSavedCheckoutInfo}>Clear saved checkout info from this device</button>}
          </section>
          </div>
          <aside className="cart-summary-card" role="region" aria-label="Cart summary">
            <h3>Cart Summary</h3>
          <fieldset className="order-summary-box">
            <legend>Order summary</legend>
            <div className="summary-row"><span>Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</span><strong>Subtotal: {formatMoney(subtotal)}</strong></div>
            <div className="summary-row"><span>Shipping</span><strong>Shipping: {shippingCost === 0 ? 'Free' : formatMoney(shippingCost)}</strong></div>
            <div className="summary-row"><span>Total before Stripe</span><strong>Total: {formatMoney(orderTotal)}</strong></div>
            <div className="summary-row"><span>Secure checkout</span><span>Stripe</span></div>
          </fieldset>
          <p className="cart-summary-note">Checkout securely with Stripe</p>
          <section className="checkout-review-box" role="region" aria-label="Review before payment">
            <h2>Review before payment</h2>
            <ul>{cart.map((line) => <li key={`review-${line.product.id}`}>{line.quantity} × {line.product.title}</li>)}</ul>
            <p>Contact: {email || 'Add an email address'}</p>
            <p>Ship to: {shippingAddress || 'Add a shipping address'}</p>
            <p><strong>Subtotal: {formatMoney(subtotal)}</strong></p>
            <p><strong>Shipping: {shippingCost === 0 ? 'Free' : formatMoney(shippingCost)}</strong></p>
            <p>{shippingCost === 0 ? 'Free shipping unlocked.' : `Free shipping at ${formatMoney(freeShippingThresholdCents)} — add ${formatMoney(freeShippingRemaining)} more to qualify.`}</p>
            <p><strong>Total: {formatMoney(orderTotal)}</strong></p>
            <p>You’ll review and pay securely on Stripe next.</p>
          </section>
          <div className="sticky-checkout-bar" role="region" aria-label="Sticky checkout summary">
            <div><span>Total</span><strong>{formatMoney(orderTotal)}</strong></div>
            <button type="submit">Continue to secure checkout</button>
          </div>
          </aside>
        </form>
      {recentlyViewedSection}</>}</section>}

    {view === 'account' && <>
      <AccountPanel checkoutMessage={checkoutMessage} />
      <section className="panel narrow saved-checkout-info account-saved-checkout-info" role="region" aria-label="Saved checkout info">
        <h2>Saved checkout info</h2>
        {savedCheckoutInfoExists ? <>
          <p>Checkout info saved on this device only — not synced to your account.</p>
          {email && <p>{email}</p>}
          {customerName && <p>{customerName}</p>}
          {shippingAddress && <p>{shippingAddress}</p>}
          {savedCheckoutInfoMessage && <p className="status-message" role="status">{savedCheckoutInfoMessage}</p>}
          <button className="ghost" type="button" onClick={clearSavedCheckoutInfo}>Clear saved checkout info from this device</button>
        </> : <>
          <p>No checkout info saved on this device yet.</p>
          <p>Checkout details can be saved from the cart for faster checkout in this browser only.</p>
          {savedCheckoutInfoMessage && <p className="status-message" role="status">{savedCheckoutInfoMessage}</p>}
        </>}
      </section>
      {isSignedIn && <section className="panel narrow account-order-history" role="region" aria-label="Order history">
        <div className="account-section-header"><div><h2>Order history</h2><p>Review recent orders and jump back into the shop when you’re ready.</p></div><button type="button" onClick={continueShopping}>Continue shopping</button></div>
        {customerOrdersMessage && <p>{customerOrdersMessage}</p>}
        {customerOrders.length > 0 && <div className="order-list">{customerOrders.map((order) => <article className="order-card" key={`customer-${order.id}`}>
          <div className="order-card-header"><strong>{order.id}</strong><span className="status-badge">{order.status}</span></div>
          <ul>{order.items.map((item) => <li key={`${order.id}-${item.title}`}>{item.quantity} × {item.title}</li>)}</ul>
          <p>{formatMoney(order.total)}</p>
          <button className="ghost" type="button" onClick={() => contactSupportAboutOrder(order.id)}>Contact support about {order.id}</button>
        </article>)}</div>}
      </section>}
    </>}

    {view === 'contact' && <section className="panel narrow contact-panel">
      <p className="eyebrow">Support channel</p>
      <h2>Contact Midnight Cardworks</h2>
      <p>Questions about a listing, order, custom request, or fulfillment? Send a message and it will go straight to the shop inbox.</p>
      {contactMessage === 'sent' && <div className="contact-success-card" role="status" aria-label="Message sent confirmation">
        <span className="status-badge">Sent</span>
        <h3>Message received</h3>
        <p>Thanks, {contactName} — your note is in the Midnight Cardworks inbox.</p>
        <p>I’ll reply to {contactEmail} within 1–2 business days.</p>
        <p>Need to add details? Send another message anytime.</p>
      </div>}
      {contactMessage && contactMessage !== 'sent' && <p className="status-message" role="status">{contactMessage}</p>}
      <form className="contact-form contact-form-card" onSubmit={(event) => void handleContactSubmit(event)}>
        <label>Your name<input aria-label="Your name" required value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
        <label>Your email<input aria-label="Your email" type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></label>
        <label>Order number optional<input aria-label="Order number optional" placeholder="ord_... if this is about an order" value={contactOrderNumber} onChange={(e) => setContactOrderNumber(e.target.value)} /></label>
        <label className="honeypot">Website<input aria-label="Website" tabIndex={-1} autoComplete="off" value={contactWebsite} onChange={(e) => setContactWebsite(e.target.value)} /></label>
        <label>How can we help?<textarea aria-label="How can we help?" required minLength={10} maxLength={3000} value={contactBody} onChange={(e) => setContactBody(e.target.value)} /></label>
        <button type="submit">Send message</button>
      </form>
    </section>}

    {view === 'receipt' && <section className="panel narrow receipt-panel"><p className="eyebrow">Checkout complete</p><h2>Order received</h2>{receiptMessage && <p className="status-message">{receiptMessage}</p>}{receiptOrder ? <div><p>Order number: {receiptOrder.id}</p><p>{receiptOrder.status === 'fulfilled' ? 'Fulfilled' : receiptOrder.status === 'paid' ? 'Paid and confirmed' : 'Waiting for Stripe confirmation'}</p>{receiptOrder.shippingAddress && <p>Ship to: {receiptOrder.shippingAddress}</p>}<p>Shipping: {receiptOrder.shippingCost === 0 ? 'Free' : formatMoney(receiptOrder.shippingCost ?? 0)}</p><h3>Total paid: {formatMoney(receiptOrder.total)}</h3><ul>{orderItemSummary(receiptOrder).map((item) => <li key={item}>{item}</li>)}</ul><h3>What happens next</h3><p>We’ll review, pack, and mark your made-to-order cards fulfilled from the shop dashboard.</p><button onClick={() => contactSupportAboutOrder(receiptOrder.id)}>Contact support about {receiptOrder.id}</button><button className="ghost" onClick={() => showShop({ category: 'All', query: '' })}>Back to shop</button></div> : <p>Hang tight while Stripe confirms the order.</p>}</section>}

    {view === 'admin' && isAdmin && <section className="panel admin-panel">
      <div className="admin-header">
        <div><p className="eyebrow">Seller console</p><h2>Admin dashboard</h2><p>Manage orders, listings, and sale pricing from separate workspaces.</p></div>
        <div className="admin-summary"><span>{orders.length} orders</span><span>{adminProducts.length} listings</span><span>{adminProducts.filter(isProductOnSale).length} on sale</span></div>
      </div>
      {adminMessage && <p className="status-message">{adminMessage}</p>}
      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button role="tab" aria-selected={adminTab === 'orders'} className={adminTab === 'orders' ? 'active-tab' : 'ghost'} onClick={() => setAdminTab('orders')}>Orders ({orders.length})</button>
        <button role="tab" aria-selected={adminTab === 'listings'} className={adminTab === 'listings' ? 'active-tab' : 'ghost'} onClick={() => { setAdminTab('listings'); setListingTab('current'); }}>Listings ({adminProducts.length})</button>
        <button role="tab" aria-selected={adminTab === 'sales'} className={adminTab === 'sales' ? 'active-tab' : 'ghost'} onClick={() => setAdminTab('sales')}>Sales ({adminProducts.filter(isProductOnSale).length})</button>
      </div>
      {adminTab === 'orders' && <section className="admin-workspace order-workspace" role="tabpanel" aria-label="Orders">
        <div className="section-heading"><div><h3>Order navigation</h3><p>Review paid orders, shipping details, and fulfillment status.</p></div></div>
        {orders.length === 0 ? <p>No orders yet.</p> : <div className="order-list">{orders.map(renderOrderCard)}</div>}
      </section>}
      {adminTab === 'listings' && <section className="admin-workspace listing-workspace" role="tabpanel" aria-label="Listings">
        <div className="section-heading"><div><h3>Listing edits</h3><p>Create listings, update details, manage images, and control active storefront visibility.</p></div></div>
        <div className="admin-tabs listing-subtabs" role="tablist" aria-label="Listing workspaces">
          <button role="tab" aria-selected={listingTab === 'current'} className={listingTab === 'current' ? 'active-tab' : 'ghost'} onClick={() => setListingTab('current')}>Current listings ({adminProducts.length})</button>
          <button role="tab" aria-selected={listingTab === 'create'} className={listingTab === 'create' ? 'active-tab' : 'ghost'} onClick={() => setListingTab('create')}>Create listing</button>
        </div>
        {listingTab === 'create' ? <section className="listing-tab-panel" role="tabpanel" aria-label="Create listing"><h3>Create listing</h3>{productEditor(newProduct, true)}</section> : <section className="listing-tab-panel" role="tabpanel" aria-label="Current listings"><h3>Current listings</h3>{adminProducts.map((p) => productEditor(p))}</section>}
      </section>}
      {adminTab === 'sales' && <section className="admin-workspace sale-workspace" role="tabpanel" aria-label="Sales">
        <div className="section-heading"><div><h3>Sale manager</h3><p>Turn sale pricing on or off for one listing, selected listings, or the whole current lineup.</p></div></div>
        <div className="sale-toolbar">
          <span>{saleSelection.length} selected</span>
          <button type="button" className="ghost" onClick={() => setSaleSelection(adminProducts.map((product) => product.slug))}>Select all</button>
          <button type="button" className="ghost" onClick={() => setSaleSelection([])}>Clear selection</button>
          <label>Bulk sale %<input aria-label="Bulk sale percentage" type="number" min="1" max="99" value={bulkSalePercent} onChange={(event) => setBulkSalePercent(event.target.value)} /></label>
          <button type="button" onClick={applyBulkSalePercent}>Apply % to selected</button>
          <button type="button" className="ghost" onClick={enableSelectedSales}>Enable selected</button>
          <button type="button" className="ghost" onClick={disableSelectedSales}>Disable selected</button>
          <button type="button" onClick={() => void handleSaleSave(saleSelectedProducts)}>Save selected sales</button>
        </div>
        <div className="sale-list">
          {adminProducts.map((product) => <article className="sale-row" key={`sale-${product.slug}`}>
            <label className="checkbox-row"><input aria-label={`Select ${product.title} for sale changes`} type="checkbox" checked={saleSelection.includes(product.slug)} onChange={(event) => updateSaleSelection(product.slug, event.target.checked)} /> Select</label>
            <div className="sale-listing-summary">
              <strong>{product.title}</strong>
              <span>{formatMoney(product.price)} regular {isProductOnSale(product) ? `· ${formatMoney(effectiveProductPrice(product))} sale` : '· no active sale'}</span>
            </div>
            <label className="checkbox-row"><input aria-label={`Sale active for ${product.title}`} type="checkbox" checked={product.saleActive} onChange={(event) => updateAdminProduct(product.slug, { saleActive: event.target.checked, salePrice: event.target.checked && (!product.salePrice || product.salePrice >= product.price) ? defaultSalePrice(product) : product.salePrice })} /> Sale active</label>
            <label>Sale price for {product.title}<input aria-label={`Sale price in dollars for ${product.title}`} type="number" step="0.01" min="0" value={product.salePrice === null ? '' : (product.salePrice / 100).toFixed(2)} onChange={(event) => updateAdminProduct(product.slug, { salePrice: event.target.value === '' ? null : moneyToCents(event.target.value) })} /></label>
            <span className={`status-badge ${isProductOnSale(product) ? 'sale-status-active' : 'sale-status-inactive'}`}>{isProductOnSale(product) ? 'On sale' : 'No sale'}</span>
            <button type="button" onClick={() => void handleSaleSave([product])}>Save sale for {product.title}</button>
          </article>)}
        </div>
      </section>}
    </section>}

    <footer>
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-wordmark">Midnight Cardworks</span>
          <p className="footer-tagline">Dark collector studio. Custom proxies, token packs, and display cards made for commander nights and display binders.</p>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <div>
            <h4>Shop</h4>
            <button className="text-btn" onClick={() => showShop({ category: 'All', query: '' })}>All products</button>
            <button className="text-btn" onClick={() => showShop({ category: 'Commander', query: '' })}>Commander proxies</button>
            <button className="text-btn" onClick={() => showShop({ category: 'Tokens', query: '' })}>Token packs</button>
            <button className="text-btn" onClick={() => showShop({ category: 'Display', query: '' })}>Display cards</button>
          </div>
          <div>
            <h4>Studio</h4>
            <button className="text-btn" onClick={startOrder}>Start a commission</button>
            <button className="text-btn" onClick={() => setView('contact')}>Contact</button>
            <button className="text-btn" onClick={() => setView('account')}>Account</button>
          </div>
        </nav>
      </div>
      <p className="footer-legal">Unofficial custom game pieces for casual play. Not affiliated with or endorsed by Wizards of the Coast. Not tournament legal.</p>
    </footer>
  </main>;
}
