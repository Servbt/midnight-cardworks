// Keep unresolved attempts across network failures, edits and page reloads.
// A successful response consumes only its own key; other attempts remain retryable.
type Attempt = { fingerprint: string; key: string };
function readAttempts(name: string): Attempt[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(name) ?? '[]');
    return Array.isArray(value) ? value.filter(a => typeof a.fingerprint === 'string' && typeof a.key === 'string') : [];
  } catch { return []; }
}
export function retryKey(scope: string, payload: unknown) {
  const name = `midnight:request:${scope}`;
  const fingerprint = JSON.stringify(payload);
  const attempts = readAttempts(name);
  const existing = attempts.find(a => a.fingerprint === fingerprint);
  if (existing) return existing.key;
  const key = crypto.randomUUID();
  sessionStorage.setItem(name, JSON.stringify([...attempts, { fingerprint, key }]));
  return key;
}
export function finishRequest(scope: string, key: string) {
  const name = `midnight:request:${scope}`;
  const remaining = readAttempts(name).filter(a => a.key !== key);
  if (remaining.length) sessionStorage.setItem(name, JSON.stringify(remaining));
  else sessionStorage.removeItem(name);
}
