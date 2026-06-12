import type { CSSProperties } from 'react';
import {
  contrastIconColorOnBackground,
  type Rgb,
  scheduleSurfaceRgb,
} from '@/lib/contrastOnBackground';

/** Same luminance/blend logic as schedule completion checkmarks. */
export const contrastTextOnBackground = contrastIconColorOnBackground;

export { scheduleSurfaceRgb };

/** Hex alpha suffix (e.g. `55` ≈ 33%) for schedule block strip backgrounds. */
export function blockColorWithAlpha(color: string | null | undefined, alphaHex: string): string {
  if (!color) return `#7b8a9c${alphaHex}`;
  if (color.startsWith('hsl(')) {
    return color.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${parseInt(alphaHex, 16) / 255})`);
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${alphaHex}`;
  return color;
}

export function scheduleBlockStripBackground(blockColor: string | null | undefined): string {
  return blockColorWithAlpha(blockColor, '55');
}

export function scheduleCategoryMetaStyle(
  slotBackgroundColor: string,
  surface: Rgb
): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    flexWrap: 'wrap',
    color: contrastTextOnBackground(slotBackgroundColor, surface),
  };
}

export function scheduleTagPillStyle(
  tagColor: string | null | undefined,
  surface: Rgb
): CSSProperties {
  const bg = tagColor?.trim() ?? '';
  if (!bg) {
    return {
      backgroundColor: 'var(--surface)',
      color: contrastTextOnBackground('rgba(128, 128, 128, 0.18)', surface),
    };
  }
  return {
    backgroundColor: bg,
    color: contrastTextOnBackground(bg, surface),
  };
}

export function scheduleBlockLabelStyle(
  blockColor: string | null | undefined,
  surface: Rgb
): CSSProperties {
  return { color: contrastTextOnBackground(scheduleBlockStripBackground(blockColor), surface) };
}
