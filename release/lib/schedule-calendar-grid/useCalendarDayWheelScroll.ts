'use client';

import { useEffect, type RefObject } from 'react';

/** Keep wheel scrolling inside `.calendar-day-tasks` instead of the parent schedule panel. */
export function useCalendarDayWheelScroll(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const list = (e.target as Element | null)?.closest('.calendar-day-tasks');
      if (!(list instanceof HTMLElement)) return;
      const maxScroll = list.scrollHeight - list.clientHeight;
      if (maxScroll <= 0) return;
      const top = list.scrollTop;
      const dy = e.deltaY;
      if ((dy < 0 && top > 0) || (dy > 0 && top < maxScroll - 0.5)) {
        e.stopPropagation();
      }
    };
    root.addEventListener('wheel', onWheel, { capture: true });
    return () => root.removeEventListener('wheel', onWheel, { capture: true });
  }, [containerRef]);
}
