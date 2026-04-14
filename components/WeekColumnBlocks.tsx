'use client';

import type { IcalFeedEvent, Priority, ScheduledSlot, Task, TimeSettings } from '@/lib/api';
import { icalEventLocalStartDate, icalEventToLocal } from '@/lib/icalTimezone';

const ROW_H = 32;

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function priorityIcon(p: Priority | string | undefined): string {
  switch (p) {
    case 'commitment':
      return '★';
    case 'high':
      return '↑';
    case 'medium':
      return '●';
    default:
      return '↓';
  }
}

/** Match Today view: tint from task category color (subcategories have no separate color in API). */
function scheduleBlockBgColor(categoryColor: string | null | undefined): string {
  if (!categoryColor) return 'rgba(220, 220, 220, 0.45)';
  return categoryColor.startsWith('hsl')
    ? categoryColor.replace(/\)$/, ', 0.25)').replace(/^hsl\(/, 'hsla(')
    : categoryColor + '40';
}

export type WeekColumnBlocksProps = {
  columnDate: string;
  columnSlots: ScheduledSlot[];
  tasks: Task[];
  organizationCategories: Array<{ id: number; name: string; color?: string | null }>;
  organizationTags: Array<{ id: number; name: string; color?: string | null }>;
  settings: TimeSettings;
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
};

export function WeekColumnBlocks({
  columnDate,
  columnSlots,
  tasks,
  organizationCategories,
  organizationTags,
  settings,
  viewStartMinutes,
  slotDurationMinutes,
  feedEvents,
  allowTaskComplete,
  isMobile,
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
}: WeekColumnBlocksProps) {
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
    ...timed.map((slot) => ({ key: `t-${slot.id}`, startMin: timeToMinutes(slot.start_time), endMin: timeToMinutes(slot.end_time), slot })),
    ...feedEvents
      .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, settings.timezone) === columnDate)
      .map((e) => {
        const local = icalEventToLocal(e.start, e.end, false, settings.timezone);
        return { key: `f-${e.id ?? e.uid + e.start}`, startMin: local.localStartMinutes, endMin: local.localEndMinutes, feed: e };
      }),
  ].sort((a, b) => a.startMin - b.startMin);

  const overlaps = new Map<string, { col: number; total: number }>();
  blocks.forEach((block) => {
    const ov = blocks.filter((o) => o.startMin < block.endMin && o.endMin > block.startMin);
    const sorted = [...ov].sort((a, b) => a.startMin - b.startMin);
    const col = sorted.findIndex((o) => o.key === block.key);
    overlaps.set(block.key, { col: col >= 0 ? col : 0, total: sorted.length });
  });

  return (
    <>
      {timed.map((slot) => {
        const children = (childByParent.get(slot.task_id) ?? []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
        const startMin = timeToMinutes(slot.start_time);
        const endMin = timeToMinutes(slot.end_time);
        const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_H;
        const height = Math.max(ROW_H, ((endMin - startMin) / slotDurationMinutes) * ROW_H);
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
              (selectedScheduleRootSlotIds.has(slot.id) ? ' time-block-bulk-selected' : '')
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
              if ((e.target as HTMLElement).closest('button, .time-block-title')) return;
              e.preventDefault();
              onStartScheduleHold(slot.task_id, 'schedule', e.clientX, e.clientY, columnDate);
            }}
          >
            <div className="time-block-header">
              <div className="time-block-title-wrap">
                <div className={'time-block-priority time-block-child-priority'}>{priorityIcon((slot.priority as Priority) ?? task?.priority ?? 'low')}</div>
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
                {slotTagList.length > 0 && (
                  <span className="time-block-tags">
                    {slotTagList.map((tg) => (
                      <span
                        key={tg.id}
                        className="time-block-tag-pill"
                        style={{
                          backgroundColor: tg.color ?? 'var(--surface)',
                          color: tg.color ? (tg.color.startsWith('hsl') && tg.color.includes('65%') ? '#fff' : '#000') : 'var(--text)',
                        }}
                      >
                        {tg.name}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              {allowTaskComplete && !colPast && !(slot.is_recurring_occurrence && columnDate > t) && onCompleteSlot && (
                <button
                  type="button"
                  className="time-block-check"
                  title="Mark complete"
                  aria-pressed={children.length > 0 ? overlayDone : slotCompleted}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onCompleteSlot(slot, children);
                  }}
                >
                  ✓
                </button>
              )}
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
          const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_H;
          const h = ((endMin - startMin) / slotDurationMinutes) * ROW_H;
          const fk = `f-${e.id ?? e.uid + e.start}`;
          const ov = overlaps.get(fk) ?? { col: 0, total: 1 };
          const wPct = 100 / ov.total;
          const leftPct = ov.col * wPct;
          const canMark = allowTaskComplete && columnDate === t && e.id != null;
          return (
            <div
              key={fk}
              className="time-block time-block-feed time-block-week"
              style={{
                top: top + 'px',
                height: Math.max(h, 20) + 'px',
                left: leftPct + '%',
                width: (wPct > 0 ? wPct - 0.5 : 99.5) + '%',
              }}
            >
              <div className="time-block-header">
                <div className="time-block-title-wrap">
                  <div className="time-block-title" style={e.user_completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                    {local.localStartTime} – {local.localEndTime} {e.title}
                  </div>
                </div>
                {canMark && onIcalComplete && (
                  <button
                    type="button"
                    className="time-block-check"
                    title={e.user_completed ? 'Mark incomplete' : 'Mark complete'}
                    aria-pressed={!!e.user_completed}
                    style={isMobile ? { color: e.user_completed ? 'var(--text-muted)' : 'transparent' } : undefined}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onIcalComplete(e.id!, !e.user_completed);
                    }}
                  >
                    ✓
                  </button>
                )}
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
