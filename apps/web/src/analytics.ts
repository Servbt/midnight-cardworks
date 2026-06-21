type PlausibleOptions = { props?: Record<string, string | number | boolean> };
type PlausibleFn = ((eventName: string, options?: PlausibleOptions) => void) & { q?: unknown[] };

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const plausibleScriptSrc = (import.meta.env.VITE_PLAUSIBLE_SRC as string | undefined) || 'https://plausible.io/js/script.js';

export const analyticsConfigured = Boolean(plausibleDomain && !plausibleDomain.includes('replace_me'));

export function loadAnalytics() {
  if (!analyticsConfigured || typeof document === 'undefined') return false;
  if (document.querySelector('script[data-midnight-analytics="plausible"]')) return true;

  const plausibleProxy = function plausibleProxy(...args: unknown[]) {
    (window.plausible!.q = window.plausible!.q || []).push(args);
  } as PlausibleFn;
  window.plausible = window.plausible || plausibleProxy;

  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = plausibleDomain!;
  script.dataset.midnightAnalytics = 'plausible';
  script.src = plausibleScriptSrc;
  document.head.appendChild(script);
  return true;
}

export function trackAnalyticsEvent(eventName: string, props?: Record<string, string | number | boolean>) {
  if (!analyticsConfigured || typeof window === 'undefined' || !window.plausible) return;
  window.plausible(eventName, props ? { props } : undefined);
}
