/**
 * Maps-link detection and opening.
 *
 * A normal task link is just a URL opened in a new tab. When the URL points at
 * a mapping service (or a `geo:` location), we treat it as a "map link": it
 * shows a map glyph instead of the chain glyph and, when opened, we prefer
 * letting the OS hand the URL to a native maps app where possible.
 */

/** Emoji glyph shown in place of the normal link glyph for map links. */
export const MAP_LINK_GLYPH = '🗺️';

/** Hostname substrings that identify a mapping provider. */
const MAP_HOST_HINTS = [
  'maps.google.',
  'google.com/maps',
  'google.co', // google.co.uk/maps etc. (paired with /maps path check below)
  'maps.app.goo.gl',
  'goo.gl/maps',
  'g.co/maps',
  'maps.apple.com',
  'maps.bing.com',
  'bing.com/maps',
  'openstreetmap.org',
  'osm.org',
  'waze.com',
  'wego.here.com',
  'here.com',
  'mapquest.com',
  'maps.yandex.',
  'yandex.com/maps',
  '2gis.',
  'tomtom.com',
  'maps.me',
];

/** Path-based hints (host alone is ambiguous, e.g. google.com). */
const MAP_PATH_HINTS = ['/maps', '/map/', '/dir/'];

/**
 * True when the URL points at a recognized maps provider or uses the `geo:`
 * URI scheme. Detection is intentionally permissive ("support all maps type").
 */
export function isMapsUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  const url = rawUrl.trim();
  if (url === '') return false;

  // geo: URI (RFC 5870), e.g. geo:37.786971,-122.399677
  if (/^geo:/i.test(url)) return true;
  // Native map app schemes.
  if (/^(comgooglemaps|maps|waze):/i.test(url)) return true;

  let host = '';
  let path = '';
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    // Fall back to a raw substring scan when URL parsing fails.
    const lower = url.toLowerCase();
    return MAP_HOST_HINTS.some((h) => lower.includes(h));
  }

  const hostAndPath = `${host}${path}`;
  for (const hint of MAP_HOST_HINTS) {
    if (hint.includes('/')) {
      if (hostAndPath.includes(hint)) return true;
    } else if (host.includes(hint)) {
      // Ambiguous Google ccTLDs (google.co*) require a maps path.
      if (hint === 'google.co' && !MAP_PATH_HINTS.some((p) => path.includes(p))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Open a URL, preferring a maps experience for recognized map links.
 *
 * For http(s) map links we open a new tab; on mobile the OS routes the maps
 * URL to a native app when one is registered. For `geo:`/app-scheme URLs we
 * navigate the current document so the OS handler fires.
 */
export function openMapsUrl(rawUrl: string): void {
  if (typeof window === 'undefined') return;
  const url = rawUrl.trim();
  if (url === '') return;

  const isAppScheme = /^(geo|comgooglemaps|maps|waze):/i.test(url);
  if (isAppScheme) {
    // Let the OS hand off to the native maps/navigation app.
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Turn an iCal LOCATION value (plain address or maps URL) into a URL suitable for {@link openMapsUrl}.
 */
export function icalLocationToMapsUrl(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (t === '') return '';
  if (/^https?:\/\//i.test(t) || /^geo:/i.test(t) || /^(comgooglemaps|maps|waze):/i.test(t)) {
    return t;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
}

/** Glyph to show for a link: map glyph for map links, chain glyph otherwise. */
export function linkGlyph(rawUrl: string | null | undefined): string {
  return isMapsUrl(rawUrl) ? MAP_LINK_GLYPH : '🔗';
}
