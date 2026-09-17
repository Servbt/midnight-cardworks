import { beforeEach, describe, expect, it } from 'vitest';
import { finishRequest, retryKey } from './requestRetry';
beforeEach(() => sessionStorage.clear());
describe('retry keys', () => {
  it('reuses persisted keys until success, then permits a deliberate identical request', () => {
    const payload = { amount: 500 };
    const first = retryKey('refund:order', payload);
    expect(retryKey('refund:order', { amount: 500 })).toBe(first);
    finishRequest('refund:order', first);
    expect(retryKey('refund:order', payload)).not.toBe(first);
  });
  it('separates order requests and protects a newer attempt from a late response', () => {
    const first = retryKey('checkout', { quantity: 1 });
    const newer = retryKey('checkout', { quantity: 2 });
    expect(newer).not.toBe(first);
    finishRequest('checkout', first);
    expect(retryKey('checkout', { quantity: 2 })).toBe(newer);
    expect(retryKey('refund:another', { quantity: 2 })).not.toBe(newer);
  });
});
