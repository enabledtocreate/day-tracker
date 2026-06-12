'use client';

import type { IcalFeedEvent, Priority, ScheduledSlot, Task, TimeSettings } from '@/lib/api';
import { icalEventLocalStartDate, icalEventToLocal } from '@/lib/icalTimezone';
import { getDefaultPriorityDisplay, type PriorityDisplay } from '@/lib/priorityTheme';
import { SCHEDULE_SLOT_ROW_HEIGHT_PX } from '@/lib/scheduleSlotMetrics';
import { timedSlotLayoutBounds } from '@/lib/timedSlotLayout';
import { computeOverlapMaps } from '@/lib/scheduleOccupiedRects';
import { ICAL_FEED_BLOCK_BG, scheduleBlockBgColor } from '@/lib/scheduleBlockColors';
import { ScheduleSlotCompleteCheckbox } from '@/components/ScheduleSlotCompleteCheckbox';
import { scheduleTagPillStyle } from '@/lib/scheduleMetaContrast';
import { useScheduleContrastSurface } from '@/lib/useScheduleContrastSurface';

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export type WeekColumnBlocksProps = {
  columnDate: string;
  columnSlots: ScheduledSlot[];
  tasks: Task[];
  organizationCategories: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
  organizationTags: Array<{ id: number; name: string; color?: string | null }>;
  settings: TimeSettings;
  /** Task list priority icons/labels/colors (optional; defaults match built-in theme). */
  priorityDisplay?: PriorityDisplay;
  viewStartMinutes: number;
  slotDurationMinutes: number;
  feedEvents: IcalFeedEvent[];
  /** When false, completion controls are hidden (week view: only “today” passes true). */
  allowTaskComplete: boolean;
  isMobile: boolean;
  scheduleBulkMode: boolean;
  scheduleBulkMoveMode: boolean;
  selectedScheduleRootSlotIds: Set<number>;
  dragState: { taskId: number; taskIds?: number[]; source: string } | null;
  onToggleScheduleRootInSelection: (slotId: number) => void;
  onStartScheduleHold: (taskId: number, source: 'schedule', clientX: number, clientY: number, columnDate: string) => void;
  onStartBulkScheduleMoveHold: (taskId: number, clientX: number, clientY: number) => void;
  onCompleteSlot?: (slot: ScheduledSlot, childSlots: ScheduledSlot[]) => void;
  onIcalComplete?: (eventId: number, completed: boolean) => void;
  onIcalExclude?: (uid: string, title: string) => void;
  hideScheduleTags?: boolean;
};

export function WeekColumnBlocks({
  columnDate,
  columnSlots,
  tasks,
  organizationCategories,
  organizationTags,
  settings,
  priorityDisplay: priorityDisplayProp,
  viewStartMinutes,
  slotDurationMinutes,
  feedEvents,
  allowTaskComplete,
  isMobile: _isMobile,
  scheduleBulkMode,
  scheduleBulkMoveMode,
  selectedScheduleRootSlotIds,
  dragState,
  onToggleScheduleRootInSelection,
  onStartScheduleHold,
  onStartBulkScheduleMoveHold,
  onCompleteSlot,
  onIcalComplete,
  onIcalExclude,
  hideScheduleTags = false,
}: WeekColumnBlocksProps) {
  const { surface: scheduleContrastSurface } = useScheduleContrastSurface();
  const priorityDisplay = priorityDisplayProp ?? getDefaultPriorityDisplay();
  const t = todayStr();
  const colPast = columnDate < t;
  const roots = columnSlots.filter((s) => !s.parent_id || !columnSlots.some((o) => o.task_id === s.parent_id));
  const timed = roots.filter(slotHasTime);
  const childByParent = new Map<number, ScheduledSlot[]>();
  roots.forEach((s) => {
    const ch = columnSlots.filter((c) => c.parent_id === s.task_id);
    if (ch.length) childByParent.set(s.task_id, ch);
  });

  const blocks = [
    ...timed.map((slot) => {
      const ch = childByParent.get(slot.task_id) ?? [];
      const { startMin, endMin } = timedSlotLayoutBounds(slot, ch);
      return { key: `t-${slot.id}`, startMin, endMin, slot };
    }),
    ...feedEvents
      .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, settings.timezone) === columnDate)
      .map((e) => {
        const local = icalEventToLocal(e.start, e.end, false, settings.timezone);
        return { key: `f-${e.id ?? e.uid + e.start}`, startMin: local.localStartMinutes, endMin: local.localEndMinutes, feed: e };
      }),
  ].sort((a, b) => a.startMin - b.startMin);

  const overlapMap = computeOverlapMaps(
    blocks.map((b) => ({ key: b.key, startMin: b.startMin, endMin: b.endMin }))
  );
  const overlaps = new Map<string, { col: number; total: number }>();
  for (const b of blocks) {
    overlaps.set(b.key, overlapMap.get(b.key) ?? { col: 0, total: 1 });
  }

  return (
    <>
      {timed.map((slot) => {
        const children = (childByParent.get(slot.task_id) ?? []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
        const { startMin, endMin } = timedSlotLayoutBounds(slot, children);
        const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * SCHEDULE_SLOT_ROW_HEIGHT_PX;
        const height = Math.max(
          SCHEDULE_SLOT_ROW_HEIGHT_PX,
          ((endMin - startMin) / slotDurationMinutes) * SCHEDULE_SLOT_ROW_HEIGHT_PX
        );
        const ov = overlaps.get(`t-${slot.id}`) ?? { col: 0, total: 1 };
        const wPct = 100 / ov.total;
        const leftPct = ov.col * wPct;
        const task = tasks.find((x) => x.id === slot.task_id);
        const slotCategory = task?.category_id != null ? organizationCategories.find((c) => c.id === task.category_id) : null;
        const slotTagList = (task?.tag_ids ?? [])
          .map((tid) => organizationTags.find((t) => t.id === tid))
          .filter(Boolean) as Array<{ id: number; name: string; color?: string | null }>;
        const slotBgColor = scheduleBlockBgColor(slotCategory?.color);
        const slotCompleted = Number(slot.completed) === 1;
        const groupAllDone =
          children.length > 0 && [slot, ...children].every((c) => Number(c.completed) === 1);
        const overlayDone = children.length > 0 ? groupAllDone : slotCompleted;
        const listLinePx = 15;
        const listHeaderPad = 18;
        const listLines = 1 + children.length;
        const showTaskList =
          children.length > 0 && height >= listHeaderPad + listLines * listLinePx;
        const showCompleteRail =
          allowTaskComplete && !colPast && !(slot.is_recurring_occurrence && columnDate > t) && !!onCompleteSlot;
        return (
          <div
            key={slot.id}
            className={
              'time-block time-block-week' +
              (children.length ? ' time-block-has-group' : '') +
              (showTaskList ? ' time-block-week-group-expanded' : '') +
              (overlayDone ? ' completed' : '') +
              (slot.is_recurring_occurrence ? ' time-block-recurring-occurrence' : '') +
              (dragState?.source === 'schedule' && dragState.taskIds?.includes(slot.task_id) ? ' time-block-dragging' : '') +
              (colPast ? ' time-block-readonly' : '') +
              (selectedScheduleRootSlotIds.has(slot.id) ? ' time-block-bulk-selected' : '') +
              (showCompleteRail ? ' time-block-has-complete-rail' : '')
            }
            style={{
              top: top + 'px',
              height: height + 'px',
              left: leftPct + '%',
              width: (wPct > 0 ? wPct - 0.5 : 99.5) + '%',
              backgroundColor: slotBgColor,
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (scheduleBulkMode && slot.id > 0) {
                if (
                  scheduleBulkMoveMode &&
                  selectedScheduleRootSlotIds.has(slot.id) &&
                  !(e.target as HTMLElement).closest('button, .time-block-title')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  onStartBulkScheduleMoveHold(slot.task_id, e.clientX, e.clientY);
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onToggleScheduleRootInSelection(slot.id);
                return;
              }
              if ((e.target as HTMLElement).closest('button, .time-block-title, .time-block-complete-rail, .time-block-complete-checkbox')) return;
              e.preventDefault();
              onStartScheduleHold(slot.task_id, 'schedule', e.clientX, e.clientY, columnDate);
            }}
          >
            {showCompleteRail && (
              <div className="time-block-complete-rail">
                <ScheduleSlotCompleteCheckbox
                  completed={children.length > 0 ? overlayDone : slotCompleted}
                  disabled={colPast || scheduleBulkMode}
                  backgroundColor={slotBgColor}
                  onToggle={() => onCompleteSlot!(slot, children)}
                />
              </div>
            )}
            <div className="time-block-header">
              <div className="time-block-title-wrap">
                <div
                  className={'time-block-priority time-block-child-priority'}
                  style={priorityDisplay.colorStyle((slot.priority as Priority) ?? task?.priority ?? 'low')}
                >
                  {priorityDisplay.icon((slot.priority as Priority) ?? task?.priority ?? 'low')}
                </div>
                <div className="time-block-title" title={slot.title ?? 'Task'}>
                  {children.length === 0 ? (
                    slot.title ?? 'Task'
                  ) : showTaskList ? (
                    <div className="time-block-week-group-list">
                      <div>{slot.title ?? 'Task'}</div>
                      {children.map((c) => (
                        <div key={c.id}>{c.title ?? 'Task'}</div>
                      ))}
                    </div>
                  ) : (
                    `${slot.title ?? 'Task'} (+${children.length})`
                  )}
                </div>
                {!hideScheduleTags && slotTagList.length > 0 && (
                  <span className="time-block-tags">
                    {slotTagList.map((tg) => (
                      <span
                        key={tg.id}
                        className="time-block-tag-pill"
                        style={scheduleTagPillStyle(tg.color, scheduleContrastSurface)}
                      >
                        {tg.name}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {feedEvents
        .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, settings.timezone) === columnDate)
        .map((e) => {
          const local = icalEventToLocal(e.start, e.end, false, settings.timezone);
          const startMin = local.localStartMinutes;
          const endMin = local.localEndMinutes;
          const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * SCHEDULE_SLOT_ROW_HEIGHT_PX;
          const h = ((endMin - startMin) / slotDurationMinutes) * SCHEDULE_SLOT_ROW_HEIGHT_PX;
          const fk = `f-${e.id ?? e.uid + e.start}`;
          const ov = overlaps.get(fk) ?? { col: 0, total: 1 };
          const wPct = 100 / ov.total;
          const leftPct = ov.col * wPct;
          const canMark = allowTaskComplete && columnDate === t && e.id != null;
          return (
            <div
              key={fk}
              className={
                'time-block time-block-feed time-block-week' + (canMark && onIcalComplete ? ' time-block-has-complete-rail' : '')
              }
              style={{
                top: top + 'px',
                height: Math.max(h, 20) + 'px',
                left: leftPct + '%',
                width: (wPct > 0 ? wPct - 0.5 : 99.5) + '%',
              }}
            >
              {canMark && onIcalComplete && (
                <div className="time-block-complete-rail">
                  <ScheduleSlotCompleteCheckbox
                    completed={!!e.user_completed}
                    backgroundColor={ICAL_FEED_BLOCK_BG}
                    onToggle={() => onIcalComplete(e.id!, !e.user_completed)}
                  />
                </div>
              )}
              <div className="time-block-header">
                <div className="time-block-title-wrap">
                  <div className="time-block-title" style={e.user_completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                    {local.localStartTime} – {local.localEndTime} {e.title}
                  </div>
                </div>
                {e.uid && onIcalExclude && (
                  <button
                    type="button"
                    className="time-block-exclude-ical"
                    title="Hide this event"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onIcalExclude(e.uid, e.title || 'Event');
                    }}
                  >
                    ⊖
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </>
  );
}
