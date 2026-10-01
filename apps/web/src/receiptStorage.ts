const key = (orderId: string) => `midnight-cardworks.receipt.${orderId}`;

export function checkReceiptStorage() {
  try {
    const probe = 'midnight-cardworks.receipt.storageCheck';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
  } catch {
    throw new Error('Allow session storage in this browser to keep secure access to your receipt.');
  }
}

export function saveReceiptToken(orderId: string, token: string) {
  window.sessionStorage.setItem(key(orderId), token);
}

export function readReceiptToken(orderId: string) {
  try { return window.sessionStorage.getItem(key(orderId)) ?? undefined; } catch { return undefined; }
}
