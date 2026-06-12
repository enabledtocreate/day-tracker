'use client';

/**
 * Tiny wrapper around navigator.vibrate that no-ops gracefully where unsupported.
 * Keep call sites short and intentional: arm/transition/success — not every tap.
 */

export type HapticKind =
  | 'arm'        // Long Press armed (entering Move / Resize)
  | 'transition' // Mode entry/exit, group add/remove
  | 'success'    // Move / Resize committed
  | 'warn';      // Clamp, ignored input, etc.

const PATTERNS: Record<HapticKind, number | number[]> = {
  arm: 18,
  transition: 10,
  success: [10, 30, 18],
  warn: [10, 50, 10],
};

type VibrateFn = (pattern: number | number[]) => boolean;

export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined') return;
  const vibrate = (navigator as unknown as { vibrate?: VibrateFn }).vibrate;
  if (typeof vibrate !== 'function') return;
  try {
    vibrate.call(navigator, PATTERNS[kind]);
  } catch {
    /* swallow — never let a haptic crash UI */
  }
}
