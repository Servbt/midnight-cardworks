import { useEffect, useRef, useState } from 'react';
import { fetchOperationsHealth, type OperationsHealth } from './api';

export function OperationsHealthPanel({ getToken, onReviewOrders }: { getToken: () => Promise<string | null | undefined>; onReviewOrders: () => void }) {
  const tokenProvider = useRef(getToken);
  tokenProvider.current = getToken;
  const [refresh, setRefresh] = useState(0);
  const [health, setHealth] = useState<OperationsHealth>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setHealth(undefined);
    void (async () => {
      try {
        const token = await tokenProvider.current();
        if (controller.signal.aborted) return;
        if (!token) throw new Error('Admin access expired. Sign in again.');
        const result = await fetchOperationsHealth(token, controller.signal);
        if (!controller.signal.aborted) setHealth(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Health information is unavailable.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refresh]);
  const items = health?.items.filter(item => category === 'all' || category === item.category) ?? [];
  return <section className="admin-workspace operations-health" role="tabpanel" aria-label="Operational health">
    <div className="section-heading"><div><h3>Operational health</h3><p>Review payment requests, order emails, and reserved stock.</p></div>
      <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Checking health…' : 'Refresh health'}</button></div>
    <p>This is a snapshot of local order records, not a live Stripe, email, or uptime check. Refresh before acting.</p>
    {loading && <p role="status">Loading operational health…</p>}
    {error && <p role="alert">{error}</p>}
    {health && <>
      <p>Checked <time dateTime={health.checkedAt}>{new Date(health.checkedAt).toLocaleString()}</time></p>
      <div className="health-summary" role="status"><strong>{health.attentionCount} need attention</strong><span>{health.waitingCount} waiting</span></div>
      {health.items.length === 0 ? <p>No outstanding items in this snapshot.</p> : <>
        <label>Show items <select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option><option value="payment">Payments</option><option value="email">Email</option><option value="inventory">Inventory</option></select></label>
        {items.length === 0 ? <p>No items in this category.</p> : <ul className="health-items">{items.map(item => <li className={item.status === 'attention' ? 'health-attention' : ''} key={item.id}>
          <div><h4>{item.title}</h4><span>{item.status === 'attention' ? 'Needs attention' : 'Waiting'}</span></div>
          {item.orderId && <p>Order: <strong>{item.orderId}</strong></p>}
          <p>{item.detail}</p>
          {item.since && <p>{item.id.startsWith('hold:') ? 'Checkout deadline' : 'Started'}: <time dateTime={item.since}>{new Date(item.since).toLocaleString()}</time></p>}
        </li>)}</ul>}
      </>}
      <button className="ghost" onClick={onReviewOrders}>Review orders</button>
    </>}
  </section>;
}
