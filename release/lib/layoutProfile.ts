/**
 * Mobile vs desktop **layout** detection (panels, schedule chrome, gesture routing).
 *
 * Portrait phones match `max-width: 768px`. Landscape phones often exceed 768px
 * width but stay touch-primary — we also treat `(pointer: coarse)` devices whose
 * shorter viewport edge is phone-sized as mobile layout.
 *
 * Keep in sync with the mobile block in `app/globals.css`.
 */

import { useMediaQuery } from '@/lib/useMediaQuery';

/** Shared with CSS `@media` — do not change without updating globals.css. */
export const MOBILE_LAYOUT_MEDIA_QUERY =
  '(max-width: 768px), ((max-height: 520px) and (pointer: coarse))';

export type ViewportLayoutInput = {
  width: number;
  height: number;
  coarsePointer: boolean;
};

/** Pure helper for tests and non-React callers. */
export function matchesMobileLayout(viewport: ViewportLayoutInput): boolean {
  const { width, height, coarsePointer } = viewport;
  if (width <= 768) return true;
  if (coarsePointer && Math.min(width, height) <= 520) return true;
  return false;
}

export function readMobileLayoutFromWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches ||
    matchesMobileLayout({
      width: window.innerWidth,
      height: window.innerHeight,
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    })
  );
}

/** True when the app should use mobile layout and touch-gesture interactions. */
export function useMobileLayout(): boolean {
  return useMediaQuery(MOBILE_LAYOUT_MEDIA_QUERY);
}

/** Desktop-only: hold-drag, resize handles, double-click edit, panel split drag. */
export function desktopPointerInteractionsEnabled(isMobileLayout: boolean): boolean {
  return !isMobileLayout;
}

/** Mobile-only: bucket/schedule swipes, long-press → Move mode, mobile chrome. */
export function mobileTouchGesturesEnabled(isMobileLayout: boolean): boolean {
  return isMobileLayout;
}
