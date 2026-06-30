import type { Dispatch, SetStateAction } from 'react';
import type { ScheduledSlot } from '@/lib/api';
import {
  durationFromStoredTimes,
  MINUTES_PER_DAY,
  storedEndTimeFromDuration,
} from '@/lib/overnightSlotTimes';
import {
  clampBottomResizeEndForMinGroupDuration,
  clampTopResizeStartForMinGroupDuration,
  distributeGroupMemberTimes,
  minutesToTime,
  snapToSlot,
  timeToMinutes,
} from '@/lib/scheduleSlotMath';

export type ScheduleSlotResizeDeps = {
  slot: ScheduledSlot;
  childSlots: ScheduledSlot[];
  startMin: number;
  endMin: number;
  viewStartMinutes: number;
  slotDurationMinutes: number;
  startHour: number;
  endHour: number;
  rowHeightPx: number;
  taskTitle: string;
  setSlots: Dispatch<SetStateAction<ScheduledSlot[]>>;
  onRecurringResize: (payload: {
    slot: ScheduledSlot;
    childSlots: ScheduledSlot[];
    newStartTime?: string;
    newEndTime?: string;
  }) => void;
  onCommit: () => void;
  onError: (err: unknown) => void;
  patchSlots: (
    updates: Array<{ id: number; start_time: string; end_time: string }>
  ) => Promise<void>;
};

function orderedChildSlots(childSlots: ScheduledSlot[]): ScheduledSlot[] {
  return childSlots.slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
}

function applyMemberTimesToSlots(
  setSlots: ScheduleSlotResizeDeps['setSlots'],
  slot: ScheduledSlot,
  childSlots: ScheduledSlot[],
  groupStartMin: number,
  groupEndMin: number,
  slotDur: number
) {
  const orderedChildren = orderedChildSlots(childSlots);
  const memberCount = 1 + orderedChildren.length;
  const memberSlots = [{ id: slot.id }, ...orderedChildren.map((c) => ({ id: c.id }))];
  const memberTimes = distributeGroupMemberTimes({
    groupStartMin,
    groupEndMin,
    slotDurationMinutes: slotDur,
    memberCount,
  });
  const memberTimesById = new Map<number, { startMin: number; endMin: number }>();
  memberSlots.forEach((ms, i) =>
    memberTimesById.set(ms.id, {
      startMin: i === 0 ? groupStartMin : memberTimes[i]!.startMin,
      endMin: i === 0 ? groupEndMin : memberTimes[i]!.endMin,
    })
  );
  setSlots((prev) =>
    prev.map((s) => {
      const mt = memberTimesById.get(s.id);
      if (!mt) return s;
      return { ...s, start_time: minutesToTime(mt.startMin), end_time: minutesToTime(mt.endMin) };
    })
  );
  return memberSlots.map((ms) => ({
    id: ms.id,
    start_time: minutesToTime(memberTimesById.get(ms.id)!.startMin),
    end_time: minutesToTime(memberTimesById.get(ms.id)!.endMin),
  }));
}

export function bindScheduleSlotTopResize(deps: ScheduleSlotResizeDeps): (e: React.PointerEvent) => void {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    const handleEl = e.currentTarget as HTMLElement;
    const blockEl = handleEl.closest('.time-block') as HTMLElement | null;
    if (!blockEl) return;
    const { slot, childSlots, startMin, endMin } = deps;
    handleEl.setPointerCapture(e.pointerId);
    blockEl.classList.add('time-block-resizing');
    const startY = e.clientY;
    let lastStart = startMin;
    let finished = false;
    const slotDur = Math.max(1, deps.slotDurationMinutes);
    const memberCount = 1 + childSlots.length;
    const recurring = !!(slot.recurring || slot.is_recurring_occurrence);

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const delta = Math.round(dy / deps.rowHeightPx) * slotDur;
      let newStart = snapToSlot(startMin + delta, deps.startHour, deps.endHour, slotDur);
      newStart = clampTopResizeStartForMinGroupDuration({
        candidateStartMin: newStart,
        endMin,
        slotDurationMinutes: slotDur,
        memberCount,
        startHour: deps.startHour,
        endHour: deps.endHour,
        currentStartMin: startMin,
      });
      lastStart = newStart;
      if (recurring) {
        blockEl.style.top = Math.max(0, ((lastStart - deps.viewStartMinutes) / slotDur) * deps.rowHeightPx) + 'px';
        blockEl.style.height = Math.max(deps.rowHeightPx, ((endMin - lastStart) / slotDur) * deps.rowHeightPx) + 'px';
        return;
      }
      applyMemberTimesToSlots(deps.setSlots, slot, childSlots, lastStart, endMin, slotDur);
    };

    const cleanup = () => {
      blockEl.classList.remove('time-block-resizing');
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      handleEl.removeEventListener('lostpointercapture', up);
      if (recurring) {
        blockEl.style.top = '';
        blockEl.style.height = '';
      }
    };

    const up = () => {
      if (finished) return;
      finished = true;
      const clampedStart = clampTopResizeStartForMinGroupDuration({
        candidateStartMin: lastStart,
        endMin,
        slotDurationMinutes: slotDur,
        memberCount,
        startHour: deps.startHour,
        endHour: deps.endHour,
        currentStartMin: startMin,
      });
      if (clampedStart !== startMin) {
        if (recurring) {
          deps.onRecurringResize({
            slot,
            childSlots,
            newStartTime: minutesToTime(clampedStart),
            newEndTime: slot.end_time ?? undefined,
          });
        } else {
          const updates = applyMemberTimesToSlots(deps.setSlots, slot, childSlots, clampedStart, endMin, slotDur);
          void deps
            .patchSlots(updates)
            .then(() => deps.onCommit())
            .catch((err) => deps.onError(err));
        }
      }
      cleanup();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    handleEl.addEventListener('lostpointercapture', up, { once: true });
  };
}

export function bindScheduleSlotBottomResize(deps: ScheduleSlotResizeDeps): (e: React.PointerEvent) => void {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    const handleEl = e.currentTarget as HTMLElement;
    const blockEl = handleEl.closest('.time-block') as HTMLElement | null;
    if (!blockEl) return;
    const { slot, childSlots, startMin, endMin } = deps;
    handleEl.setPointerCapture(e.pointerId);
    blockEl.classList.add('time-block-resizing');
    const startY = e.clientY;
    let lastEnd = endMin;
    let finished = false;
    const slotDur = Math.max(1, deps.slotDurationMinutes);
    const memberCount = 1 + childSlots.length;
    const recurring = !!(slot.recurring || slot.is_recurring_occurrence);
    const initialDuration = durationFromStoredTimes(slot.start_time, slot.end_time);
    let lastDuration = Math.max(slotDur, initialDuration);

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const delta = Math.round(dy / deps.rowHeightPx) * slotDur;
      if (memberCount === 1) {
        let newDuration = Math.max(slotDur, initialDuration + delta);
        newDuration = Math.min(MINUTES_PER_DAY, newDuration);
        lastDuration = newDuration;
        const layoutEnd = startMin + newDuration > MINUTES_PER_DAY ? MINUTES_PER_DAY : startMin + newDuration;
        const end_time = storedEndTimeFromDuration(startMin, newDuration);
        if (recurring) {
          blockEl.style.height =
            Math.max(deps.rowHeightPx, ((layoutEnd - startMin) / slotDur) * deps.rowHeightPx) + 'px';
          return;
        }
        deps.setSlots((prev) =>
          prev.map((s) => (s.id === slot.id ? { ...s, start_time: minutesToTime(startMin), end_time } : s))
        );
        return;
      }
      let newEnd = snapToSlot(endMin + delta, deps.startHour, deps.endHour, slotDur, 'end');
      newEnd = clampBottomResizeEndForMinGroupDuration({
        startMin,
        candidateEndMin: newEnd,
        slotDurationMinutes: slotDur,
        memberCount,
      });
      lastEnd = newEnd;
      if (recurring) {
        blockEl.style.height =
          Math.max(deps.rowHeightPx, ((lastEnd - startMin) / slotDur) * deps.rowHeightPx) + 'px';
        return;
      }
      applyMemberTimesToSlots(deps.setSlots, slot, childSlots, startMin, lastEnd, slotDur);
    };

    const cleanup = () => {
      blockEl.classList.remove('time-block-resizing');
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      handleEl.removeEventListener('lostpointercapture', up);
      if (recurring) {
        blockEl.style.height = '';
      }
    };

    const up = () => {
      if (finished) return;
      finished = true;
      if (memberCount === 1) {
        const end_time = storedEndTimeFromDuration(startMin, lastDuration);
        const storedEnd = slot.end_time ?? '';
        if (end_time !== storedEnd || lastDuration !== initialDuration) {
          if (recurring) {
            deps.onRecurringResize({
              slot,
              childSlots,
              newStartTime: slot.start_time ?? undefined,
              newEndTime: end_time,
            });
          } else {
            void deps
              .patchSlots([{ id: slot.id, start_time: minutesToTime(startMin), end_time }])
              .then(() => deps.onCommit())
              .catch((err) => deps.onError(err));
          }
        }
        cleanup();
        return;
      }
      const clampedEnd = clampBottomResizeEndForMinGroupDuration({
        startMin,
        candidateEndMin: lastEnd,
        slotDurationMinutes: slotDur,
        memberCount,
      });
      const storedRootEndMin = timeToMinutes(slot.end_time);
      const shouldCommit = clampedEnd !== endMin || clampedEnd !== storedRootEndMin;
      if (shouldCommit) {
        if (recurring) {
          deps.onRecurringResize({
            slot,
            childSlots,
            newStartTime: slot.start_time ?? undefined,
            newEndTime: minutesToTime(clampedEnd),
          });
        } else {
          const updates = applyMemberTimesToSlots(deps.setSlots, slot, childSlots, startMin, clampedEnd, slotDur);
          void deps
            .patchSlots(updates)
            .then(() => deps.onCommit())
            .catch((err) => deps.onError(err));
        }
      }
      cleanup();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    handleEl.addEventListener('lostpointercapture', up, { once: true });
  };
}
