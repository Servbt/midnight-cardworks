const memoryTokens = new Map<string, string>();

/** Fragments never reach the server; remove the secret before analytics or navigation. */
export function receiptTokenFor(orderId: string) {
  const key = `midnight-cardworks.receipt.${orderId}`;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('receiptToken');
  if (token !== null) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
      memoryTokens.set(orderId, token);
      try { window.sessionStorage.setItem(key, token); } catch { /* In-memory access works when storage is unavailable. */ }
      return token;
    }
    return undefined;
  }
  try { return window.sessionStorage.getItem(key) ?? memoryTokens.get(orderId); }
  catch { return memoryTokens.get(orderId); }
}
