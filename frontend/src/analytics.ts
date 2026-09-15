/**
 * Google Analytics 4, loaded only after the visitor consents. The choice is
 * kept in localStorage; nothing from GA runs until it is "granted".
 */
export const GA_MEASUREMENT_ID = 'G-3FQ78N91NB';

const KEY = 'blair_analytics';
type Choice = 'granted' | 'denied';

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

export function getAnalyticsChoice(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

let loaded = false;

function load(): void {
  if (loaded || !GA_MEASUREMENT_ID) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js requires the Arguments object itself on the dataLayer, not an array
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  window.gtag('js', new Date());
  // send_page_view: false — the router reports page views itself so SPA navigation is counted
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false, anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

export function setAnalyticsChoice(choice: Choice): void {
  try { localStorage.setItem(KEY, choice); } catch { /* ignore */ }
  if (choice === 'granted') load();
  else if (loaded) {
    // Opting out after loading: stop sending. GA honors this flag for the page's lifetime.
    (window as unknown as Record<string, boolean>)[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  }
}

/** Call once at startup: loads GA if the visitor already said yes. */
export function initAnalytics(): void {
  if (getAnalyticsChoice() === 'granted') load();
}

export function trackPageView(path: string): void {
  if (getAnalyticsChoice() !== 'granted' || !window.gtag) return;
  window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href });
}

export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (getAnalyticsChoice() !== 'granted' || !window.gtag) return;
  window.gtag('event', name, params);
}
