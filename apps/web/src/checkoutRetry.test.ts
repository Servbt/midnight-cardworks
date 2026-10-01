import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCheckout } from './api';
const address = { streetAddress: '123 Main Street', apartment: '', city: 'New York', zipCode: '10001' };
const checkout = () => createCheckout('buyer@example.com', 'Buyer', address, [{ productId: 'p1', quantity: 1 }]);
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it('keeps the checkout key on ambiguous failure but rotates it after confirmed closure', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_CLOSED', error: 'Start again' }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ orderId: 'new_order' }), { status: 201 }));
  vi.stubGlobal('fetch', request);
  await expect(checkout()).rejects.toThrow('network');
  await expect(checkout()).rejects.toThrow('Start again');
  await checkout();
  const keys = request.mock.calls.map(call => call[1].headers['Idempotency-Key']);
  expect(keys[0]).toBe(keys[1]); expect(keys[2]).not.toBe(keys[1]);
});
