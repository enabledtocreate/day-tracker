'use client';

/**
 * Event-delegated mobile gestures for the task list bucket container.
 *
 * Handles the entire bucket area (one node) instead of wiring `useMobileGestures`
 * onto every TaskCard. Drives the spec from `.apm/_WORKSPACE/TODO-mobile.md §0.3`:
 *
 *   - Swipe Left  → next bucket
 *   - Swipe Right → previous bucket
 *   - Long Press on a `[data-task-id]` row → enter Move mode (sourced from the list)
 *   - Double Tap on a `[data-task-id]` row while in Move mode:
 *       - originating task → exit Move mode
 *       - any other task   → add/remove from move group (toggle)
 *
 * Suppression: honors `useMobileMode().isGestureSuppressed` (modal open count).
 *
 * NOTE: drop / commit semantics live in the schedule (Step 5). This hook only
 * arms Move mode + handles bucket navigation + grouping toggles.
 */

import { useEffect, useRef } from 'react';
import { useMobileMode, type MoveSource } from '@/lib/mobileMode';
import { haptic } from '@/lib/mobileHaptics';
import { MOBILE_GESTURE_DEFAULTS } from '@/lib/mobileGestures';

export type TaskListGestureOptions = {
  enabled: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Defaults to `'list'`. Set to `'schedule'` when wiring this same hook on a schedule. */
  source?: MoveSource;
  /** Skip Long Press / Double Tap if the pointerdown target matches this CSS selector. */
  ignoreTargetSelector?: string;
};

export function useTaskListMobileGestures(
  hostRef: React.RefObject<HTMLElement | null>,
  options: TaskListGestureOptions
): void {
  const optsRef = useRef(options);
  optsRef.current = options;
  const { mode, isGestureSuppressed, actions } = useMobileMode();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const suppressedRef = useRef(isGestureSuppressed);
  suppressedRef.current = isGestureSuppressed;

  useEffect(() => {
    if (!options.enabled) return;
    const host = hostRef.current;
    if (!host) return;

    const D = MOBILE_GESTURE_DEFAULTS;

    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let activeTaskId: number | null = null;
    let lpTimer: number | null = null;
    let lpFired = false;
    let movedFar = false;
    // True once we've decided this gesture is a horizontal swipe and already
    // fired onSwipeLeft/onSwipeRight; suppresses the duplicate pointerup commit
    // and the tap/double-tap fallbacks.
    let swipeCommitted = false;

    // Per-task double-tap tracking
    let lastTapTaskId: number | null = null;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const clearLp = () => {
      if (lpTimer != null) {
        window.clearTimeout(lpTimer);
        lpTimer = null;
      }
    };

    const findTaskId = (target: EventTarget | null): number | null => {
      if (!(target instanceof Element)) return null;
      const node = target.closest('[data-task-id]');
      if (!node) return null;
      const raw = (node as HTMLElement).dataset.taskId;
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };

    const isIgnoredTarget = (target: EventTarget | null): boolean => {
      const sel = optsRef.current.ignoreTargetSelector;
      if (!sel) return false;
      if (!(target instanceof Element)) return false;
      return target.closest(sel) != null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (suppressedRef.current) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      activeTaskId = findTaskId(e.target);
      lpFired = false;
      movedFar = false;
      swipeCommitted = false;
      clearLp();
      // Only arm Long Press on a row, and only when not on a button/input
      if (
        activeTaskId != null &&
        modeRef.current.kind === 'normal' &&
        !isIgnoredTarget(e.target)
      ) {
        const tid = activeTaskId;
        lpTimer = window.setTimeout(() => {
          lpTimer = null;
          if (movedFar || suppressedRef.current) return;
          if (modeRef.current.kind !== 'normal') return;
          lpFired = true;
          haptic('arm');
          actions.enterMove(tid, optsRef.current.source ?? 'list');
        }, D.longPressMs);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (swipeCommitted) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dist = Math.hypot(dx, dy);
      if (dist > D.doubleTapPx) {
        movedFar = true;
        clearLp();
      }
      // Commit horizontal swipes during pointermove so they survive even when
      // the browser later sends pointercancel (e.g. competing scroll). This is
      // what makes a swipe over a task win against the tap/long-press path.
      if (
        !suppressedRef.current &&
        Math.abs(dx) > Math.abs(dy) &&
        Math.abs(dx) > D.swipePx
      ) {
        swipeCommitted = true;
        clearLp();
        if (dx < 0) optsRef.current.onSwipeLeft?.();
        else optsRef.current.onSwipeRight?.();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dt = performance.now() - startT;
      const dist = Math.hypot(dx, dy);
      const vel = dist / Math.max(dt, 1);
      const wasLp = lpFired;
      const wasSwipe = swipeCommitted;
      const taskAtUp = activeTaskId;
      activePointerId = null;
      activeTaskId = null;
      lpFired = false;
      movedFar = false;
      swipeCommitted = false;
      clearLp();

      if (suppressedRef.current) return;
      if (wasSwipe) return; // Already fired during pointermove
      if (wasLp) return; // Long Press already handled

      // Horizontal swipe between buckets (final-velocity fallback for fast flicks)
      if (Math.abs(dx) > Math.abs(dy) && (dist > D.swipePx || vel > D.swipeVelocity)) {
        if (dx < 0) optsRef.current.onSwipeLeft?.();
        else optsRef.current.onSwipeRight?.();
        return;
      }

      // Tap / double-tap on a row
      if (taskAtUp == null) return;
      // Ignore taps that originated on a button/input
      if (isIgnoredTarget(e.target)) return;

      const now = performance.now();
      const sameTask = taskAtUp === lastTapTaskId;
      const distFromLast = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
      const isDouble =
        sameTask && now - lastTapTime < D.doubleTapMs && distFromLast < D.doubleTapPx;

      if (isDouble) {
        lastTapTaskId = null;
        lastTapTime = 0;
        const m = modeRef.current;
        if (m.kind === 'move') {
          if (taskAtUp === m.originatingTaskId) {
            actions.exitMove();
            haptic('transition');
          } else if (m.groupMemberIds.includes(taskAtUp)) {
            actions.removeMoveGroupMember(taskAtUp);
            haptic('warn');
          } else {
            actions.addMoveGroupMember(taskAtUp);
            haptic('transition');
          }
        }
        return;
      }
      lastTapTaskId = taskAtUp;
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      activeTaskId = null;
      clearLp();
      lpFired = false;
      movedFar = false;
      swipeCommitted = false;
    };

    host.addEventListener('pointerdown', handlePointerDown);
    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerup', handlePointerUp);
    host.addEventListener('pointercancel', handlePointerCancel);
    host.addEventListener('lostpointercapture', handlePointerCancel as EventListener);

    return () => {
      clearLp();
      host.removeEventListener('pointerdown', handlePointerDown);
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerup', handlePointerUp);
      host.removeEventListener('pointercancel', handlePointerCancel);
      host.removeEventListener('lostpointercapture', handlePointerCancel as EventListener);
    };
  }, [hostRef, options.enabled, actions]);
}
