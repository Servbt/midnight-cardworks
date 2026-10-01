import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkReceiptStorage, readReceiptToken, saveReceiptToken } from './receiptStorage';

afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });
describe('guest receipt storage', () => {
  it('keeps receipt credentials scoped to each order across a page reload', () => {
    checkReceiptStorage();
    saveReceiptToken('order-a', 'token-a');
    saveReceiptToken('order-b', 'token-b');
    expect(readReceiptToken('order-a')).toBe('token-a');
    expect(readReceiptToken('order-b')).toBe('token-b');
    expect(readReceiptToken('unknown')).toBeUndefined();
  });
  it('fails before checkout when browser session storage is disabled', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    expect(checkReceiptStorage).toThrow('Allow session storage');
  });
});
