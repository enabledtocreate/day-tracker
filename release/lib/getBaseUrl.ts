/**
 * API base URL for PHP backend. Works at domain root or in a subfolder (e.g. /DayTracker/).
 * Build-time: NEXT_PUBLIC_BASE_PATH. Runtime: data-baseurl on #app overrides.
 * When neither is set, infers the folder from window.location (e.g. /DayTracker/index.html → /DayTracker/).
 */
export function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
    return base ? base + '/' : '';
  }
  const app = document.getElementById('app');
  const fromData = app?.dataset?.baseurl;
  if (fromData) {
    const b = fromData.replace(/\/$/, '');
    return b ? b + '/' : '';
  }
  const fromEnv = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv + '/';
  return inferBasePathFromLocation();
}

/** Directory path for the current app install (leading slash, trailing slash), or '' at site root. */
function inferBasePathFromLocation(): string {
  let pathname = window.location.pathname;
  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'/index.html'.length) || '/';
  }
  if (!pathname.endsWith('/')) {
    const slash = pathname.lastIndexOf('/');
    const tail = pathname.slice(slash + 1);
    if (tail.includes('.')) {
      pathname = pathname.slice(0, slash + 1);
    } else {
      pathname += '/';
    }
  }
  if (pathname === '/') return '';
  return pathname;
}

/**
 * Absolute URL for a path under this app (e.g. api/ical.php), including subfolder installs.
 */
export function resolveAppUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\//, '');
  if (typeof window !== 'undefined') {
    return new URL(rel, window.location.href).href;
  }
  return getBaseUrl() + rel;
}
