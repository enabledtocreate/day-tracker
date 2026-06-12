'use client';

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export type FloatingMenuPosition = { top: number; left: number };

/** Place a fixed menu just below the anchor button (viewport coordinates). */
export function menuPositionBelowButton(rect: DOMRect, gap = 4): FloatingMenuPosition {
  return { top: rect.bottom + gap, left: rect.left };
}

/**
 * Track anchor position for a portaled menu. Recomputes on open and when any scroll container moves.
 */
export function useFloatingMenuPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  /** Re-run layout when the anchor element changes while open (e.g. different list row). */
  anchorKey?: string | number | null
): FloatingMenuPosition | null {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);

  const update = useCallback(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) {
      setPosition(null);
      return;
    }
    setPosition(menuPositionBelowButton(el.getBoundingClientRect()));
  }, [anchorRef, open]);

  useLayoutEffect(() => {
    update();
  }, [update, anchorKey]);

  useLayoutEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => update();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, update]);

  return position;
}
