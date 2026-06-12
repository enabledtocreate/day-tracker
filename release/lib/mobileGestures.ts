'use client';

/**
 * Mobile gesture recognizer.
 *
 * One hook to wire Tap / Double Tap / Long Press / Swipe (up/down/left/right) onto
 * any HTMLElement. Decisions follow the rules locked in `.apm/_WORKSPACE/TODO-mobile.md §0.1 / §0.8`:
 *
 *   - Long Press  : 400 ms hold with movement < 24 px
 *   - Double Tap  : two taps within 300 ms and < 24 px between them
 *   - Swipe       : > 50 px distance OR > 0.3 px/ms velocity (whichever crosses first)
 *   - Tap         : everything else
 *
 * Precedence (per spec): Swipe > Double Tap > Long Press > Tap.
 *
 * The hook automatically suppresses ALL events when `MobileModeProvider`
 * reports gesture suppression (i.e. any modal/drawer is open).
 *
 * Use the returned ref on an element you control, or pass an existing ref via
 * the `ref` option (the hook will attach listeners directly to that node).
 */

import { useEffect, useRef } from 'react';
import { useMobileMode } from '@/lib/mobileMode';

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export type MobileGestureEvent = {
  /** Original pointer event. */
  source: PointerEvent;
  /** Absolute X / Y in CSS pixels. */
  x: number;
  y: number;
  /** Total movement from pointerdown. */
  dx: number;
  dy: number;
  /** Duration of the gesture in ms. */
  durationMs: number;
};

export type SwipeGestureEvent = MobileGestureEvent & { direction: SwipeDirection };

export type MobileGestureHandlers = {
  onTap?: (e: MobileGestureEvent) => void;
  onDoubleTap?: (e: MobileGestureEvent) => void;
  onLongPress?: (e: MobileGestureEvent) => void;
  onSwipe?: (e: SwipeGestureEvent) => void;
  /** Streaming pointer movement; useful for live ghost previews. */
  onPointerMove?: (e: MobileGestureEvent) => void;
};

export type MobileGestureOptions = {
  longPressMs?: number;
  doubleTapMs?: number;
  doubleTapPx?: number;
  swipePx?: number;
  swipeVelocity?: number;
  /** Restrict which swipe directions count. `both` allows all 4 directions. */
  swipeAxis?: 'x' | 'y' | 'both';
  /** Disable the recognizer entirely (does not register listeners). */
  disabled?: boolean;
  /**
   * If true, the recognizer ignores `isGestureSuppressed`. Use only for
   * gestures that must work even when modals are open (rare — usually leave false).
   */
  ignoreModalSuppression?: boolean;
  /** Restrict to touch input. Default: true. Set false to also accept mouse/pen. */
  touchOnly?: boolean;
};

export const MOBILE_GESTURE_DEFAULTS = {
  longPressMs: 400,
  doubleTapMs: 300,
  doubleTapPx: 24,
  swipePx: 50,
  swipeVelocity: 0.3,
} as const;

function pickAxisFiltered(
  dx: number,
  dy: number,
  axis: 'x' | 'y' | 'both'
): SwipeDirection | null {
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (horizontal) {
    if (axis === 'y') return null;
    return dx > 0 ? 'right' : 'left';
  }
  if (axis === 'x') return null;
  return dy > 0 ? 'down' : 'up';
}

export function useMobileGestures<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handlers: MobileGestureHandlers,
  options: MobileGestureOptions = {}
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const optsRef = useRef(options);
  optsRef.current = options;

  const modeCtx = useMobileMode();
  const suppressedRef = useRef(modeCtx.isGestureSuppressed);
  suppressedRef.current = modeCtx.isGestureSuppressed;

  useEffect(() => {
    if (options.disabled) return;
    const el = ref.current;
    if (!el) return;

    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lpTimer: number | null = null;
    let lpFired = false;
    let movedFar = false;

    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let pendingTapTimer: number | null = null;
    let pendingTapEvent: MobileGestureEvent | null = null;

    const cleanupActiveGesture = () => {
      if (lpTimer != null) {
        window.clearTimeout(lpTimer);
        lpTimer = null;
      }
    };

    const buildEvent = (e: PointerEvent): MobileGestureEvent => ({
      source: e,
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - startX,
      dy: e.clientY - startY,
      durationMs: performance.now() - startT,
    });

    const isSuppressed = () =>
      !optsRef.current.ignoreModalSuppression && suppressedRef.current;

    const onPointerDown = (e: PointerEvent) => {
      if (optsRef.current.touchOnly !== false && e.pointerType !== 'touch') return;
      if (isSuppressed()) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      lpFired = false;
      movedFar = false;
      const lpMs = optsRef.current.longPressMs ?? MOBILE_GESTURE_DEFAULTS.longPressMs;
      if (handlersRef.current.onLongPress) {
        lpTimer = window.setTimeout(() => {
          lpTimer = null;
          if (movedFar) return;
          if (isSuppressed()) return;
          lpFired = true;
          handlersRef.current.onLongPress?.(buildEvent(e));
        }, lpMs);
      }
    };

    const onPointerMoveNative = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      const cancelPx = optsRef.current.doubleTapPx ?? MOBILE_GESTURE_DEFAULTS.doubleTapPx;
      if (dist > cancelPx) {
        movedFar = true;
        if (lpTimer != null) {
          window.clearTimeout(lpTimer);
          lpTimer = null;
        }
      }
      handlersRef.current.onPointerMove?.(buildEvent(e));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      cleanupActiveGesture();
      activePointerId = null;

      if (isSuppressed()) return;
      if (lpFired) return; // Long Press already fired; ignore this up

      const ev = buildEvent(e);
      const dist = Math.hypot(ev.dx, ev.dy);
      const swipePx = optsRef.current.swipePx ?? MOBILE_GESTURE_DEFAULTS.swipePx;
      const swipeVel =
        optsRef.current.swipeVelocity ?? MOBILE_GESTURE_DEFAULTS.swipeVelocity;
      const velocity = dist / Math.max(ev.durationMs, 1);
      const isSwipe = dist > swipePx || velocity > swipeVel;
      if (isSwipe && handlersRef.current.onSwipe) {
        const axis = optsRef.current.swipeAxis ?? 'both';
        const dir = pickAxisFiltered(ev.dx, ev.dy, axis);
        if (dir) {
          // Swipe wins: cancel any pending single tap
          if (pendingTapTimer != null) {
            window.clearTimeout(pendingTapTimer);
            pendingTapTimer = null;
            pendingTapEvent = null;
          }
          handlersRef.current.onSwipe({ ...ev, direction: dir });
          return;
        }
      }

      // Detect double tap
      const now = performance.now();
      const doubleMs = optsRef.current.doubleTapMs ?? MOBILE_GESTURE_DEFAULTS.doubleTapMs;
      const doublePx = optsRef.current.doubleTapPx ?? MOBILE_GESTURE_DEFAULTS.doubleTapPx;
      const lastDist = Math.hypot(ev.x - lastTapX, ev.y - lastTapY);
      if (
        handlersRef.current.onDoubleTap &&
        now - lastTapTime < doubleMs &&
        lastDist < doublePx
      ) {
        // Cancel any pending single-tap fire from the first tap
        if (pendingTapTimer != null) {
          window.clearTimeout(pendingTapTimer);
          pendingTapTimer = null;
          pendingTapEvent = null;
        }
        lastTapTime = 0;
        handlersRef.current.onDoubleTap(ev);
        return;
      }

      lastTapTime = now;
      lastTapX = ev.x;
      lastTapY = ev.y;

      // If a double tap handler exists we must defer the single tap fire
      // long enough to see if a second tap follows.
      if (handlersRef.current.onDoubleTap && handlersRef.current.onTap) {
        pendingTapEvent = ev;
        pendingTapTimer = window.setTimeout(() => {
          pendingTapTimer = null;
          const fire = pendingTapEvent;
          pendingTapEvent = null;
          if (fire) handlersRef.current.onTap?.(fire);
        }, doubleMs + 10);
      } else {
        handlersRef.current.onTap?.(ev);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      cleanupActiveGesture();
      activePointerId = null;
      lpFired = false;
      movedFar = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMoveNative);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', onPointerCancel as EventListener);

    return () => {
      cleanupActiveGesture();
      if (pendingTapTimer != null) {
        window.clearTimeout(pendingTapTimer);
        pendingTapTimer = null;
        pendingTapEvent = null;
      }
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMoveNative);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('lostpointercapture', onPointerCancel as EventListener);
    };
  }, [ref, options.disabled]);
}
