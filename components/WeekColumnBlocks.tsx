'use client';

import type { IcalFeedEvent, Priority, ScheduledSlot, Task, TimeSettings } from '@/lib/api';
import { icalEventLocalStartDate, icalEventToLocal } from '@/lib/icalTimezone';
import { getDefaultPriorityDisplay, type PriorityDisplay } from '@/lib/priorityTheme';
import { SCHEDULE_SLOT_ROW_HEIGHT_PX } from '@/lib/scheduleSlotMetrics';
import { timedSlotLayoutBounds } from '@/lib/timedSlotLayout';
import { computeOverlapLayouts, type OverlapLayoutInfo } from '@/lib/scheduleOccupiedRects';
import { icalFeedBlockBgColor, scheduleBlockBgColor } from '@/lib/scheduleBlockColors';
import { ScheduleSlotCompleteCheckbox } from '@/components/ScheduleSlotCompleteCheckbox';
import { ScheduleIcalLocationLink } from '@/components/ScheduleIcalLocationLink';
import { scheduleBlockDensityClasses } from '@/lib/scheduleBlockDensity';
import { scheduleCategoryMetaStyle, scheduleTagPillStyle } from '@/lib/scheduleMetaContrast';
import { OrgLucideIcon } from '@/components/OrgLucideIcon';
import { useScheduleContrastSurface } from '@/lib/useScheduleContrastSurface';
import { isScheduleBlockHoldExcluded } from '@/lib/scheduleTitleEdit';

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
  organizationSubcategories?: Array<{ id: number; category_id: number; name: string }>;
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
  icalSubById?: Record<number, { schedule_color?: string | null }>;
  hideScheduleTags?: boolean;
  hideScheduleCategory?: boolean;
  /** Desktop week view: drag top/bottom edges to resize timed blocks. */
  resizeEnabled?: boolean;
  bindSlotResizeTop?: (
    slot: ScheduledSlot,
    childSlots: ScheduledSlot[],
    startMin: number,
    endMin: number
  ) => (e: React.PointerEvent) => void;
  bindSlotResizeBottom?: (
    slot: ScheduledSlot,
    childSlots: ScheduledSlot[],
    startMin: number,
    endMin: number
  ) => (e: React.PointerEvent) => void;
  editingScheduleTaskId?: number | null;
  editingScheduleTitle?: string;
  onEditingScheduleTitleChange?: (value: string) => void;
  onScheduleTitleInputBlur?: (taskId: number, e: React.FocusEvent<HTMLInputElement>) => void;
  onScheduleTitleCommit?: (taskId: number, title: string) => void;
  onOpenScheduleTitleEdit?: (taskId: number, title: string) => void;
  onCancelScheduleTitleEdit?: () => void;
  desktopPointer?: boolean;
};

export function WeekColumnBlocks({
  columnDate,
  columnSlots,
  tasks,
  organizationCategories,
  organizationSubcategories = [],
  organizationTags,
  settings,
  priorityDisplay: priorityDisplayProp,
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
  icalSubById = {},
  hideScheduleTags = false,
  hideScheduleCategory = false,
  resizeEnabled = false,
  bindSlotResizeTop,
  bindSlotResizeBottom,
  editingScheduleTaskId = null,
  editingScheduleTitle = '',
  onEditingScheduleTitleChange,
  onScheduleTitleInputBlur,
  onScheduleTitleCommit,
  onOpenScheduleTitleEdit,
  onCancelScheduleTitleEdit,
  desktopPointer = false,
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

  const overlapMap = computeOverlapLayouts(
    blocks.map((b) => ({ key: b.key, startMin: b.startMin, endMin: b.endMin }))
  );
  const overlaps = new Map<string, OverlapLayoutInfo>();
  for (const b of blocks) {
    overlaps.set(b.key, overlapMap.get(b.key) ?? {
      col: 0,
      total: 1,
      leftPct: 0,
      widthPct: 99.5,
      zIndex: 1,
      stacked: false,
    });
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
        const ov = overlaps.get(`t-${slot.id}`) ?? {
          col: 0,
          total: 1,
          leftPct: 0,
          widthPct: 99.5,
          zIndex: 1,
          stacked: false,
        };
        const wPct = ov.widthPct;
        const leftPct = ov.leftPct;
        const task = tasks.find((x) => x.id === slot.task_id);
        const slotCategory = task?.category_id != null ? organizationCategories.find((c) => c.id === task.category_id) : null;
        const slotSubcategory =
          task?.subcategory_id != null ? organizationSubcategories.find((s) => s.id === task.subcategory_id) : null;
        const slotTagList = (task?.tag_ids ?? [])
          .map((tid) => organizationTags.find((t) => t.id === tid))
          .filter(Boolean) as Array<{ id: number; name: string; color?: string | null }>;
        const slotHasOrgMeta =
          (!hideScheduleCategory && (slotCategory != null || slotSubcategory != null)) ||
          (!hideScheduleTags && slotTagList.length > 0);
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
        const canResize =
          resizeEnabled &&
          !colPast &&
          !slot.is_recurring_occurrence &&
          !!bindSlotResizeTop &&
          !!bindSlotResizeBottom;
        const densityClasses = scheduleBlockDensityClasses(height, wPct);
        return (
          <div
            key={slot.id}
            className={
              'time-block time-block-week' +
              (ov.stacked ? ' time-block--stacked-overlap' : '') +
              (children.length ? ' time-block-has-group' : '') +
              (showTaskList ? ' time-block-week-group-expanded' : '') +
              (overlayDone ? ' completed' : '') +
              (slot.is_recurring_occurrence ? ' time-block-recurring-occurrence' : '') +
              (dragState?.source === 'schedule' && dragState.taskIds?.includes(slot.task_id) ? ' time-block-dragging' : '') +
              (colPast ? ' time-block-readonly' : '') +
              (selectedScheduleRootSlotIds.has(slot.id) ? ' time-block-bulk-selected' : '') +
              (showCompleteRail ? ' time-block-has-complete-rail' : '') +
              densityClasses
            }
            style={{
              top: top + 'px',
              height: height + 'px',
              left: leftPct + '%',
              width: wPct + '%',
              zIndex: ov.zIndex,
              backgroundColor: slotBgColor,
              ['--tb-h' as string]: `${Math.round(height)}px`,
            } as React.CSSProperties}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest('.time-block-resize, .time-block-resize-top')) return;
              if (scheduleBulkMode && slot.id > 0) {
                if (
                  scheduleBulkMoveMode &&
                  selectedScheduleRootSlotIds.has(slot.id) &&
                  !isScheduleBlockHoldExcluded(e.target)
                ) {
                  if (!isMobile) {
                    e.preventDefault();
                    e.stopPropagation();
                    onStartBulkScheduleMoveHold(slot.task_id, e.clientX, e.clientY);
                  }
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onToggleScheduleRootInSelection(slot.id);
                return;
              }
              if (isMobile) return;
              if (isScheduleBlockHoldExcluded(e.target)) return;
              e.preventDefault();
              onStartScheduleHold(slot.task_id, 'schedule', e.clientX, e.clientY, columnDate);
            }}
          >
            {canResize && (
              <div
                className="time-block-resize time-block-resize-top"
                title="Drag to change start time"
                onPointerDown={bindSlotResizeTop!(slot, children, startMin, endMin)}
              />
            )}
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
              <div className="time-block-header-leading">
                <div
                  className={'time-block-priority time-block-child-priority'}
                  style={priorityDisplay.colorStyle((slot.priority as Priority) ?? task?.priority ?? 'low')}
                >
                  {priorityDisplay.icon((slot.priority as Priority) ?? task?.priority ?? 'low')}
                </div>
              </div>
              <div
                className={
                  'time-block-title-wrap' +
                  (showTaskList ? '' : ' time-block-title-wrap-stacked') +
                  (showTaskList
                    ? ''
                    : children.length > 0 || !slotHasOrgMeta
                      ? ' time-block-title-wrap-no-meta'
                      : ' time-block-title-wrap-with-meta')
                }
              >
                {showTaskList ? (
                  <div className="time-block-week-group-list">
                    <div>{slot.title ?? 'Task'}</div>
                    {children.map((c) => (
                      <div key={c.id}>{c.title ?? 'Task'}</div>
                    ))}
                  </div>
                ) : children.length > 0 ? (
                  <div className="time-block-title-line">
                    <div className="time-block-title" title={slot.title ?? 'Task'}>
                      {`${slot.title ?? 'Task'} (+${children.length})`}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="time-block-title-line">
                      {editingScheduleTaskId === slot.task_id && onEditingScheduleTitleChange && onScheduleTitleInputBlur ? (
                        <input
                          className="time-block-edit"
                          value={editingScheduleTitle}
                          onChange={(e) => onEditingScheduleTitleChange(e.target.value)}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onBlur={(e) => onScheduleTitleInputBlur(slot.task_id, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onScheduleTitleCommit?.(slot.task_id, editingScheduleTitle);
                            if (e.key === 'Escape') onCancelScheduleTitleEdit?.();
                          }}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="time-block-title"
                          title={slot.title ?? 'Task'}
                          onMouseDown={
                            desktopPointer && onOpenScheduleTitleEdit
                              ? (e) => {
                                  if (e.button !== 0 || colPast) return;
                                  e.preventDefault();
                                }
                              : undefined
                          }
                          onDoubleClick={
                            desktopPointer && onOpenScheduleTitleEdit && !colPast && !slot.is_recurring_occurrence
                              ? (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onOpenScheduleTitleEdit(slot.task_id, slot.title ?? 'Task');
                                }
                              : undefined
                          }
                        >
                          {slot.title ?? 'Task'}
                        </div>
                      )}
                    </div>
                    {slotHasOrgMeta && (
                      <div className="time-block-meta-line">
                        {!hideScheduleCategory && (slotCategory != null || slotSubcategory != null) && (
                          <div
                            className="time-block-category-sub"
                            style={scheduleCategoryMetaStyle(slotBgColor, scheduleContrastSurface)}
                            title={
                              slotCategory != null
                                ? slotCategory.name + (slotSubcategory != null ? ` › ${slotSubcategory.name}` : '')
                                : slotSubcategory?.name
                            }
                          >
                            {slotCategory != null && <OrgLucideIcon name={slotCategory.icon} size={12} />}
                            {slotCategory?.name}
                            {slotSubcategory != null ? ` › ${slotSubcategory.name}` : ''}
                          </div>
                        )}
                        {!hideScheduleTags && slotTagList.length > 0 && (
                          <span className="time-block-tags">
                            {slotTagList.map((tg) => (
                              <span
                                key={tg.id}
                                className="time-block-tag-pill"
                                style={scheduleTagPillStyle(tg.color, scheduleContrastSurface)}
                                title={tg.name}
                              >
                                {tg.name}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {canResize && (
              <div
                className="time-block-resize"
                title="Drag to resize"
                onPointerDown={bindSlotResizeBottom!(slot, children, startMin, endMin)}
              />
            )}
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
          const ov = overlaps.get(fk) ?? {
            col: 0,
            total: 1,
            leftPct: 0,
            widthPct: 99.5,
            zIndex: 1,
            stacked: false,
          };
          const wPct = ov.widthPct;
          const leftPct = ov.leftPct;
          const canMark = allowTaskComplete && columnDate === t && e.id != null;
          const feedBg = icalFeedBlockBgColor(
            e.subscription_id != null ? icalSubById[e.subscription_id]?.schedule_color : null
          );
          return (
            <div
              key={fk}
              className={
                'time-block time-block-feed time-block-week' +
                (ov.stacked ? ' time-block--stacked-overlap' : '') +
                (canMark && onIcalComplete ? ' time-block-has-complete-rail' : '')
              }
              style={{
                top: top + 'px',
                height: Math.max(h, 20) + 'px',
                left: leftPct + '%',
                width: wPct + '%',
                zIndex: ov.zIndex,
                background: feedBg,
              }}
            >
              {canMark && onIcalComplete && (
                <div className="time-block-complete-rail">
                  <ScheduleSlotCompleteCheckbox
                    completed={!!e.user_completed}
                    backgroundColor={feedBg}
                    onToggle={() => onIcalComplete(e.id!, !e.user_completed)}
                  />
                </div>
              )}
              <div className="time-block-header">
                <div className="time-block-title-wrap">
                  <div className="time-block-title" style={e.user_completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                    {e.title}
                  </div>
                  <ScheduleIcalLocationLink location={e.location} />
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
