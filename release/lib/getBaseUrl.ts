/**
 * API base URL for PHP backend. Works at domain root or in a subfolder (e.g. /DayTracker/).
 * Build-time: NEXT_PUBLIC_BASE_PATH. Runtime: data-baseurl on #app overrides.
 */
export function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
    return base ? base + '/' : '';
  }
  const app = document.getElementById('app');
  if (app?.dataset?.baseurl) {
    return (app.dataset.baseurl as string).replace(/\/$/, '') + '/';
  }
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  return base ? base + '/' : '';
}
