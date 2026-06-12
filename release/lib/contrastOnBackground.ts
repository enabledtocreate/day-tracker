export type Rgb = { r: number; g: number; b: number };

/** Blend semi-transparent foreground over a solid surface (schedule grid / theme surface). */
export function blendRgbaOnSurface(fg: Rgb & { a?: number }, surface: Rgb): Rgb {
  const a = fg.a ?? 1;
  return {
    r: Math.round(fg.r * a + surface.r * (1 - a)),
    g: Math.round(fg.g * a + surface.g * (1 - a)),
    b: Math.round(fg.b * a + surface.b * (1 - a)),
  };
}

/** WCAG relative luminance (0–1). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function parseHex(hex: string): (Rgb & { a?: number }) | null {
  const h = hex.replace(/^#/, '').trim();
  if (h.length === 3) {
    return {
      r: parseInt(h[0]! + h[0], 16),
      g: parseInt(h[1]! + h[1], 16),
      b: parseInt(h[2]! + h[2], 16),
      a: 1,
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgbLike(s: string): (Rgb & { a?: number }) | null {
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return {
    r: Math.round(Number(m[1])),
    g: Math.round(Number(m[2])),
    b: Math.round(Number(m[3])),
    a: m[4] != null ? Number(m[4]) : 1,
  };
}

function parseHslLike(s: string): (Rgb & { a?: number }) | null {
  const m = s.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  const h = (Number(m[1]) % 360) / 360;
  const sat = Number(m[2]) / 100;
  const lit = Number(m[3]) / 100;
  const a = m[4] != null ? Number(m[4]) : 1;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (sat === 0) {
    r = g = b = lit;
  } else {
    const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
    const p = 2 * lit - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a,
  };
}

export function parseCssColor(input: string | null | undefined): (Rgb & { a?: number }) | null {
  if (input == null) return null;
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith('#')) return parseHex(s);
  if (s.startsWith('rgb')) return parseRgbLike(s);
  if (s.startsWith('hsl')) return parseHslLike(s);
  if (/^[0-9a-fA-F]{3,8}$/.test(s)) return parseHex('#' + s);
  return null;
}

/** Single light or dark icon color that contrasts with `backgroundColor` on `surface`. */
export function contrastIconColorOnBackground(
  backgroundColor: string | null | undefined,
  surface: Rgb = { r: 220, g: 220, b: 220 }
): string {
  const parsed = parseCssColor(backgroundColor);
  if (!parsed) return '#1a1a1a';
  const blended = blendRgbaOnSurface(parsed, surface);
  const L = relativeLuminance(blended);
  return L > 0.45 ? '#141414' : '#f4f4f4';
}

export function scheduleSurfaceRgb(theme: 'light' | 'dark' | string | undefined): Rgb {
  return theme === 'light' ? { r: 248, g: 248, b: 250 } : { r: 28, g: 30, b: 34 };
}
