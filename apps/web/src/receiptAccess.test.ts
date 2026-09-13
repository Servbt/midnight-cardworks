import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { fetchOrder } from './api';
import { receiptTokenFor } from './receiptAccess';

beforeEach(() => { window.sessionStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(() => vi.restoreAllMocks());
describe('private receipt access', () => {
  it('removes the fragment and preserves access for a page reload in the same tab', async () => {
    const token = 'a'.repeat(43);
    window.history.replaceState({}, '', '/checkout/success?order=ord_reload#receiptToken=' + token);
    expect(receiptTokenFor('ord_reload')).toBe(token);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?order=ord_reload');
    vi.resetModules();
    const reloaded = await import('./receiptAccess');
    expect(reloaded.receiptTokenFor('ord_reload')).toBe(token);
    expect(reloaded.receiptTokenFor('ord_other')).toBeUndefined();
  });
  it('supports blocked storage and repeated rendering without leaving the token in the URL', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    window.history.replaceState({}, '', '/checkout/success?order=ord_private#receiptToken=' + 'b'.repeat(43));
    expect(receiptTokenFor('ord_private')).toBe('b'.repeat(43));
    expect(receiptTokenFor('ord_private')).toBe('b'.repeat(43));
    expect(window.location.hash).toBe('');
  });
  it('rejects malformed fragments without persisting them', () => {
    window.history.replaceState({}, '', '/checkout/success?order=ord_bad#receiptToken=invalid');
    expect(receiptTokenFor('ord_bad')).toBeUndefined();
    expect(window.sessionStorage.getItem('midnight-cardworks.receipt.ord_bad')).toBeNull();
    expect(window.location.hash).toBe('');
  });
  it('sends guest access in a header and disables caching, without a secret in the request URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ order: { id: 'ord_guest' } })));
    await fetchOrder('ord_guest', { receiptToken: 'secret', token: 'unused-session' });
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/api\/orders\/ord_guest$/), { headers: { 'x-receipt-token': 'secret' }, cache: 'no-store' });
  });
  it('uses the account token when there is no guest link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ order: { id: 'ord_account' } })));
    await fetchOrder('ord_account', { token: 'verified-session' });
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/api\/orders\/ord_account$/), { headers: { authorization: 'Bearer verified-session' }, cache: 'no-store' });
  });
  it('shows an access instruction when the server denies the receipt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(fetchOrder('ord_denied')).rejects.toThrow('Open your private receipt link or sign in');
  });
});
