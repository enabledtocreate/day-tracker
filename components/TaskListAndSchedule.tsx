'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from '@use-gesture/react';
import type { AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Task, ScheduledSlot, IcalFeedEvent, TimeSettings, Priority, TaskLink, TaskListItem } from '@/lib/api';
import { icalEventToLocal, icalEventLocalStartDate } from '@/lib/icalTimezone';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { CompletedPanel } from '@/components/CompletedPanel';
import { AIPanel } from '@/components/AIPanel';
import { LinkModal } from '@/components/LinkModal';
import { TaskListItemsModal } from '@/components/TaskListItemsModal';

type Props = {
  user: AuthUser;
  aiEnabled: boolean;
  isMobile?: boolean;
  mainSlideIndex?: number;
  onMainSlideChange?: (index: number) => void;
  /** Optional ref to register a refetch-organization callback so other panels (e.g. settings) can refresh this view's org list */
  refetchOrganizationRef?: React.MutableRefObject<(() => void) | null>;
};

function today(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function formatTimeAMPM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + period;
}

const ROW_HEIGHT = 32;

/** §5.12: CSS hooks for short/narrow schedule blocks (font scale, hide tags, action drawer). */
export function scheduleBlockDensityClasses(heightPx: number, widthPctSlot: number): string {
  const parts: string[] = [];
  if (heightPx < 40) parts.push('time-block-density-micro');
  else if (heightPx < 72) parts.push('time-block-density-tight');
  if (heightPx < 56 || widthPctSlot < 38) parts.push('time-block-density-actions-drawer');
  return parts.length ? ' ' + parts.join(' ') : '';
}

function snapToSlot(minutes: number, startHour: number, endHour: number, slotDuration: number): number {
  const start = startHour * 60;
  const end = endHour * 60;
  const step = Math.max(1, slotDuration);
  const offset = minutes - start;
  const slot = Math.round(offset / step) * step + start;
  return Math.max(start, Math.min(end - step, slot));
}

export function calcMovedSlotTimes(params: {
  scheduleDropStartMin: number;
  viewEndMin: number;
  slotDurationMinutes: number;
  originalDurationMin: number;
  startHour: number;
  endHour: number;
}): { newStartMin: number; newEndMin: number; preservedDurationMin: number } {
  const preservedDurationMin = Math.max(0, Math.max(params.originalDurationMin, params.slotDurationMinutes));
  const latestStartMin = params.viewEndMin - preservedDurationMin;
  const candidateStartMin = Math.min(params.scheduleDropStartMin, latestStartMin);
  // Re-snap to the slot grid, but never allow end_time to pass viewEndMin.
  const snappedStartMin = snapToSlot(candidateStartMin, params.startHour, params.endHour, params.slotDurationMinutes);
  const newStartMin = Math.min(snappedStartMin, latestStartMin);
  return { newStartMin, newEndMin: newStartMin + preservedDurationMin, preservedDurationMin };
}

/** Walk `parent_id` (task id) chain to the root slot row for this day. */
export function resolveScheduleRootSlotId(slots: ScheduledSlot[], slotId: number): number {
  let current = slots.find((s) => s.id === slotId);
  if (!current) return slotId;
  const seen = new Set<number>();
  while (current.parent_id != null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = slots.find((s) => s.task_id === current!.parent_id);
    if (!parent) break;
    current = parent;
  }
  return current!.id;
}

export function reorderGroupSiblingIds(params: {
  members: Array<{ id: number; group_order?: number }>;
  movedId: number;
  targetId: number;
}): number[] {
  const { members, movedId, targetId } = params;
  const sorted = members
    .slice()
    .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id);
  const ids = sorted.map((m) => m.id);
  const fromIndex = ids.indexOf(movedId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return ids;
  }
  const next = ids.slice();
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

export function clampTopResizeStartForMinDuration(params: {
  candidateStartMin: number;
  endMin: number;
  slotDurationMinutes: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  return Math.min(params.candidateStartMin, params.endMin - step);
}

export function clampBottomResizeEndForMinDuration(params: {
  startMin: number;
  candidateEndMin: number;
  slotDurationMinutes: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  return Math.max(params.candidateEndMin, params.startMin + step);
}

export function clampTopResizeStartForMinGroupDuration(params: {
  candidateStartMin: number;
  endMin: number;
  slotDurationMinutes: number;
  memberCount: number;
  startHour: number;
  endHour: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const minTotal = Math.max(1, params.memberCount) * step;
  const maxStart = params.endMin - minTotal;
  const dayStart = params.startHour * 60;
  let s = Math.min(params.candidateStartMin, maxStart);
  s = Math.max(dayStart, s);
  s = snapToSlot(s, params.startHour, params.endHour, step);
  if (s > maxStart) {
    const k = Math.max(0, Math.floor((maxStart - dayStart) / step));
    s = dayStart + k * step;
  }
  return s;
}

export function clampBottomResizeEndForMinGroupDuration(params: {
  startMin: number;
  candidateEndMin: number;
  slotDurationMinutes: number;
  memberCount: number;
}): number {
  const step = Math.max(1, params.slotDurationMinutes);
  const minTotal = Math.max(1, params.memberCount) * step;
  return Math.max(params.candidateEndMin, params.startMin + minTotal);
}

export function distributeGroupMemberTimes(params: {
  groupStartMin: number;
  groupEndMin: number;
  slotDurationMinutes: number;
  memberCount: number;
}): Array<{ startMin: number; endMin: number }> {
  const memberCount = Math.max(1, params.memberCount | 0);
  const totalMin = Math.max(0, params.groupEndMin - params.groupStartMin);
  const slotDur = params.slotDurationMinutes;
  const totalIntervals = slotDur > 0 ? Math.round(totalMin / slotDur) : 0;
  const baseIntervals = memberCount > 0 ? Math.floor(totalIntervals / memberCount) : 0;
  const remainderIntervals = memberCount > 0 ? totalIntervals - baseIntervals * memberCount : 0;

  const out: Array<{ startMin: number; endMin: number }> = [];
  let cur = params.groupStartMin;
  for (let i = 0; i < memberCount; i++) {
    const intervalsForThis = baseIntervals + (i === memberCount - 1 ? remainderIntervals : 0);
    const startMin = cur;
    const endMin = cur + intervalsForThis * slotDur;
    out.push({ startMin, endMin });
    cur = endMin;
  }
  return out;
}

export function lockTextSelection(body: HTMLElement = document.body): { prevUserSelect: string; prevWebkitUserSelect: string } {
  const prevUserSelect = body.style.userSelect;
  const prevWebkitUserSelect = (body.style as any).webkitUserSelect ?? '';
  body.style.userSelect = 'none';
  (body.style as any).webkitUserSelect = 'none';
  return { prevUserSelect, prevWebkitUserSelect };
}

export function restoreTextSelection(
  body: HTMLElement = document.body,
  prev: { prevUserSelect: string; prevWebkitUserSelect: string } | null
): void {
  if (!prev) return;
  body.style.userSelect = prev.prevUserSelect;
  (body.style as any).webkitUserSelect = prev.prevWebkitUserSelect;
}

/**
 * Utility for “near-edge delay” autoscroll.
 * Calls `activate()` only if `onEdge()` stays true for `delayMs` without `onLeave()`.
 */
export function createDelayedEdgeAction(delayMs: number, activate: () => void) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return {
    onEdge() {
      if (timeoutId != null) return;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        activate();
      }, delayMs);
    },
    onLeave() {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    isPending() {
      return timeoutId != null;
    },
  };
}

const PRIORITIES: readonly Priority[] = ['commitment', 'high', 'medium', 'low'];
function priorityLabel(p: Priority): string {
  if (p === 'commitment') return 'Commitment';
  if (p === 'high') return 'High';
  if (p === 'medium') return 'Medium';
  return 'Low';
}
function priorityIcon(p: Priority | undefined): string {
  if (p === 'commitment') return '★';
  if (p === 'high') return '↑';
  if (p === 'medium') return '●';
  return '↓';
}

function extractUrlFromDrop(e: React.DragEvent): string | null {
  const uri = e.dataTransfer.getData('text/uri-list');
  if (uri) {
    const first = uri.trim().split(/\s+/)[0];
    if (first && /^https?:\/\//i.test(first)) return first;
  }
  const plain = e.dataTransfer.getData('text/plain');
  if (plain) {
    const t = plain.trim();
    if (/^https?:\/\/\S+/i.test(t)) return t.replace(/\s.*$/, '').trim();
  }
  return null;
}

function getMonthRange(date: string): { from: string; to: string } {
  const d = new Date(date + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function buildCalendarDays(date: string): string[] {
  const d = new Date(date + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = first.getDay();
  const days: string[] = [];
  for (let i = 0; i < startPad; i++) days.push('');
  for (let day = 1; day <= last.getDate(); day++) {
    days.push(String(y) + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
  }
  return days;
}

const SWIPE_THRESHOLD = 60;

const PANEL_EDGE_BUFFER_PX = 72;

export function TaskListAndSchedule({
  user,
  aiEnabled,
  isMobile = false,
  mainSlideIndex = 1,
  onMainSlideChange,
  refetchOrganizationRef,
}: Props) {
  const [viewDate, setViewDate] = useState(today());
  const [adminDebug, setAdminDebug] = useState(false);
  const [showDebugOverlays, setShowDebugOverlays] = useState(false);
  const debugHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debugTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const scheduleContentRef = useRef<HTMLDivElement | null>(null);
  const [debugZoneRects, setDebugZoneRects] = useState<{ task: DOMRect | null; schedule: DOMRect | null }>({ task: null, schedule: null });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [slots, setSlots] = useState<ScheduledSlot[]>([]);
  const [feedErrors, setFeedErrors] = useState<Array<{ feed_url: string; message: string }>>([]);
  const [icalIntervalFetch, setIcalIntervalFetch] = useState(true);
  const [icalSyncIntervalMinutes, setIcalSyncIntervalMinutes] = useState(15);
  type IcalSyncPhase = 'idle' | 'downloading' | 'parsing' | 'saving' | 'loading' | 'synced';
  const [icalSyncPhase, setIcalSyncPhase] = useState<IcalSyncPhase>('idle');
  const icalPhaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [settings, setSettings] = useState<TimeSettings>({ start_hour: 6, end_hour: 23, increment_value: 15, increment_unit: 'min' });
  const [loading, setLoading] = useState(true);
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleTab, setScheduleTab] = useState<'today' | 'calendar'>('today');
  const [calendarMonth, setCalendarMonth] = useState(today());
  const [calendarSlotsByDate, setCalendarSlotsByDate] = useState<Record<string, ScheduledSlot[]>>({});
  const [calendarFeedEventsByDate, setCalendarFeedEventsByDate] = useState<Record<string, IcalFeedEvent[]>>({});
  const [feedEventsByDateForSchedule, setFeedEventsByDateForSchedule] = useState<Record<string, IcalFeedEvent[]>>({});
  const lastIcalMonthRef = useRef<string | null>(null);
  const feedEvents = useMemo(
    () =>
      scheduleTab === 'today'
        ? (feedEventsByDateForSchedule[viewDate] ?? [])
        : (calendarFeedEventsByDate[viewDate] ?? []),
    [scheduleTab, viewDate, feedEventsByDateForSchedule, calendarFeedEventsByDate]
  );
  const [taskSlideIndex, setTaskSlideIndex] = useState(0); // mobile: slide index into visible sections (Unassigned | Pending)
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newCommonTaskTitle, setNewCommonTaskTitle] = useState('');
  const [commonTasks, setCommonTasks] = useState<Task[]>([]);
  const [addOptionsOpen, setAddOptionsOpen] = useState(false);
  const [addOptionsTitle, setAddOptionsTitle] = useState('');
  const [addOptionsPriority, setAddOptionsPriority] = useState<Priority>('low');
  const [addOptionsRecurring, setAddOptionsRecurring] = useState(false);
  const [scheduleDateOpen, setScheduleDateOpen] = useState(false);
  const [scheduleDateTaskId, setScheduleDateTaskId] = useState<number | null>(null);
  const [scheduleDateValue, setScheduleDateValue] = useState('');
  const [scheduleTimeValue, setScheduleTimeValue] = useState('09:00');
  const [scheduleNoTime, setScheduleNoTime] = useState(false);
  const [scheduleDueAutoPriority, setScheduleDueAutoPriority] = useState(false);
  const [scheduleSlotIdToReplace, setScheduleSlotIdToReplace] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [linkModalTaskId, setLinkModalTaskId] = useState<number | null>(null);
  const [linkModalInitialUrl, setLinkModalInitialUrl] = useState('');
  const [urlDragOverTaskId, setUrlDragOverTaskId] = useState<number | null>(null);
  const [listModalTaskId, setListModalTaskId] = useState<number | null>(null);
  const [incompleteRootIds, setIncompleteRootIds] = useState<Set<number>>(new Set());
  const [accomplishedTaskIds, setAccomplishedTaskIds] = useState<Set<number>>(new Set());
  const [scheduledTaskIdsFromTodayOnward, setScheduledTaskIdsFromTodayOnward] = useState<Set<number>>(new Set());
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const TASK_VIEW_HEIGHT_KEY = 'daytracker_task_view_height';
  const TASK_VIEW_MIN_PX = 120;
  const TASK_VIEW_SCHEDULE_MIN_PX = 200;
  const TASK_ROW_ESTIMATE_PX = 44;
  const TASK_VIEW_HEADER_ESTIMATE_PX = 100;
  const [taskViewHeightPx, setTaskViewHeightPx] = useState(() => {
    if (typeof window === 'undefined') return 280;
    const s = localStorage.getItem('daytracker_task_view_height');
    const n = s != null ? parseInt(s, 10) : NaN;
    return Number.isFinite(n) && n >= TASK_VIEW_MIN_PX ? n : 280;
  });
  const leftMainRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const scheduleResizeRef = useRef<HTMLDivElement>(null);
  const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);
  const [orderBy, setOrderBy] = useState<'title' | 'priority' | 'date_added'>('date_added');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');
  const [newTaskIdToBlink, setNewTaskIdToBlink] = useState<number | null>(null);
  const taskListScrollRef = useRef<HTMLDivElement>(null);
  const [openPrioritySlotId, setOpenPrioritySlotId] = useState<number | null>(null);
  const [schedulePriorityPickerPosition, setSchedulePriorityPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const schedulePriorityButtonRef = useRef<HTMLButtonElement>(null);
  const [editingScheduleTaskId, setEditingScheduleTaskId] = useState<number | null>(null);
  const [editingScheduleTitle, setEditingScheduleTitle] = useState('');
  const [openScheduleDrawerSlotId, setOpenScheduleDrawerSlotId] = useState<number | null>(null);
  const [currentTimeMinutes, setCurrentTimeMinutes] = useState<number>(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const [dragState, setDragState] = useState<{ taskId: number; taskIds: number[]; source: 'unassigned' | 'pending' | 'schedule' | 'common' } | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [draggingTaskIds, setDraggingTaskIds] = useState<Set<number>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [taskLinksByTaskId, setTaskLinksByTaskId] = useState<Record<number, TaskLink[]>>({});
  const [taskListItemsByTaskId, setTaskListItemsByTaskId] = useState<Record<number, TaskListItem[]>>({});
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [organizationCategories, setOrganizationCategories] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [organizationSubcategories, setOrganizationSubcategories] = useState<Array<{ id: number; category_id: number; name: string }>>([]);
  const [organizationTags, setOrganizationTags] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [organizationModalTaskId, setOrganizationModalTaskId] = useState<number | null>(null);
  const [hoverDropTaskId, setHoverDropTaskId] = useState<number | null>(null);
  const [dropZoneHighlight, setDropZoneHighlight] = useState<'unassigned' | 'pending' | null>(null);
  const [scheduleDropGhostMin, setScheduleDropGhostMin] = useState<number | null>(null);
  const [scheduleDropUntimedHighlight, setScheduleDropUntimedHighlight] = useState(false);
  const [lastUndoable, setLastUndoable] = useState<{ revert: () => Promise<void> } | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orphanModal, setOrphanModal] = useState<{
    taskId: number;
    targetListState: 'unassigned' | 'pending';
    rootSlotId: number;
    completedChildSlotIds: number[];
    incompleteChildSlotIds: number[];
  } | null>(null);
  const [recurringActionModal, setRecurringActionModal] = useState<{
    type: 'complete' | 'remove';
    slot: ScheduledSlot;
    childSlots: ScheduledSlot[];
  } | null>(null);
  const [futureCompleteModal, setFutureCompleteModal] = useState<{ slot: ScheduledSlot } | null>(null);
  const [recurringConfigModal, setRecurringConfigModal] = useState<{
    taskId: number;
    recurring: boolean;
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
    time: string;
    weekDays: number[];
    monthDays: number[];
    lastDayOfMonth: boolean;
    count?: number;
    startDate?: string;
  } | null>(null);
  const [recurringResizeModal, setRecurringResizeModal] = useState<{
    slot: ScheduledSlot;
    childSlots: ScheduledSlot[];
    newStartTime?: string;
    newEndTime?: string;
  } | null>(null);
  const [scheduleBulkMode, setScheduleBulkMode] = useState(false);
  const [scheduleBulkMoveMode, setScheduleBulkMoveMode] = useState(false);
  const [selectedScheduleRootSlotIds, setSelectedScheduleRootSlotIds] = useState<Set<number>>(new Set());
  const [scheduleBulkRescheduleOpen, setScheduleBulkRescheduleOpen] = useState(false);
  const [scheduleBulkRescheduleDate, setScheduleBulkRescheduleDate] = useState('');
  const [scheduleBulkPriorityOpen, setScheduleBulkPriorityOpen] = useState(false);

  const dragStateRef = useRef<{
    taskId: number;
    taskIds: number[];
    source: 'unassigned' | 'pending' | 'schedule' | 'common';
    anchorTaskId?: number;
  } | null>(null);
  const scheduleDropStartMinRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdPointerRef = useRef<{
    taskIds: number[];
    source: 'unassigned' | 'pending' | 'schedule' | 'common';
    clientX: number;
    clientY: number;
    onHoldStart?: () => void;
    anchorTaskId?: number;
  } | null>(null);
  const cancelMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const cancelUpRef = useRef<(() => void) | null>(null);
  const initialLoadRef = useRef(true);
  const textSelectionLockRef = useRef<ReturnType<typeof lockTextSelection> | null>(null);

  const [scheduleAutoScrollBlink, setScheduleAutoScrollBlink] = useState(false);
  const scheduleAutoScrollBlinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDragState = useCallback(() => {
    dragStateRef.current = null;
    setDragState(null);
    setDragPreviewPosition(null);
    setDraggingTaskId(null);
    setDraggingTaskIds(new Set());
    setHoverDropTaskId(null);
    setDropZoneHighlight(null);
    setScheduleDropGhostMin(null);
    setScheduleDropUntimedHighlight(false);
    restoreTextSelection(document.body, textSelectionLockRef.current);
    textSelectionLockRef.current = null;
  }, []);

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('daytracker_right_panel_width') : null;
    if (w != null) {
      const n = parseInt(w, 10);
      if (Number.isFinite(n) && n >= 280) setRightPanelWidth(n);
    }
  }, []);

  const loadData = useCallback(() => {
    if (initialLoadRef.current) {
      setLoading(true);
      initialLoadRef.current = false;
    }
    setError(null);
    const run = async () => {
      try {
        await api.dataIntegrity.ensure().catch(() => {});
        const isToday = viewDate === today();
        if (isToday) await api.rollover(viewDate);
        const day = await api.day.getOrCreate(viewDate);
        const todayStr = today();
        const future = new Date(todayStr + 'T00:00:00');
        future.setFullYear(future.getFullYear() + 1);
        const futureStr = future.toISOString().slice(0, 10);

        const withExt = 'links,list_items,organization';
        const [
          allTasksRes,
          unassignedRes,
          pendingRes,
          incompleteRes,
          accomplishedRes,
          slotRes,
          scheduledRangeRes,
          settingsRes,
          organizationRes,
        ] = await Promise.all([
          api.tasks.list({ with: withExt }),
          api.tasks.list({ list_state: 'unassigned', with: withExt }),
          api.tasks.list({ list_state: 'pending', with: withExt }),
          api.tasks.list({ view: 'incomplete', day: viewDate, with: withExt }),
          api.accomplished.listAll({ with: 'links,list_items' }),
          api.slots.list(day.id, { with: 'links,list_items' }),
          api.slots.listByDateRange(todayStr, futureStr),
          api.settings.get(),
          api.organization.list().catch(() => ({ categories: [], subcategories: [], tags: [] })),
        ]);

        const allTasks = allTasksRes.tasks ?? [];
        setTasks(allTasks);
        setCommonTasks(allTasks.filter((t) => !!t.is_common && t.parent_id == null));
        setSlots(slotRes.slots);
        setSettings(settingsRes);
        setOrganizationCategories(organizationRes.categories ?? []);
        setOrganizationSubcategories(organizationRes.subcategories ?? []);
        setOrganizationTags(organizationRes.tags ?? []);

        const linksByTaskId: Record<number, TaskLink[]> = {};
        const listItemsByTaskId: Record<number, TaskListItem[]> = {};
        for (const res of [allTasksRes, unassignedRes, pendingRes, incompleteRes, accomplishedRes, slotRes]) {
          const links = (res as { linksByTaskId?: Record<number, TaskLink[]> }).linksByTaskId;
          if (links) Object.assign(linksByTaskId, links);
          const items = (res as { listItemsByTaskId?: Record<number, TaskListItem[]> }).listItemsByTaskId;
          if (items) {
            for (const [tid, arr] of Object.entries(items)) {
              const id = Number(tid);
              listItemsByTaskId[id] = (listItemsByTaskId[id] ?? []).concat(arr);
            }
          }
        }
        const sortedListItems: Record<number, TaskListItem[]> = {};
        Object.keys(listItemsByTaskId).forEach((tid) => {
          const arr = listItemsByTaskId[Number(tid)];
          const seen = new Set<number>();
          sortedListItems[Number(tid)] = arr
            .filter((i) => {
              if (seen.has(i.id)) return false;
              seen.add(i.id);
              return true;
            })
            .sort((a, b) => a.order_index - b.order_index);
        });
        setTaskLinksByTaskId(linksByTaskId);
        setTaskListItemsByTaskId(sortedListItems);

        setIncompleteRootIds(new Set(incompleteRes.incompleteRootIds ?? []));
        const accIds = new Set<number>();
        Object.values(accomplishedRes.byDate ?? {}).forEach((arr) => arr.forEach((a) => accIds.add(a.task_id)));
        setAccomplishedTaskIds(accIds);
        const schedIds = new Set<number>();
        Object.values(scheduledRangeRes.byDate ?? {}).forEach((arr: ScheduledSlot[]) => arr.forEach((s) => schedIds.add(s.task_id)));
        setScheduledTaskIdsFromTodayOnward(schedIds);

        if (scheduleTab === 'calendar') {
          const { from, to } = getMonthRange(calendarMonth);
          api.slots.listByDateRange(from, to).then((r) => setCalendarSlotsByDate(r.byDate ?? {})).catch(() => setCalendarSlotsByDate({}));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setInitialDataReady(true);
      }
    };
    run();
  }, [viewDate, scheduleTab, calendarMonth]);

  const refetchTaskContent = useCallback((taskId: number) => {
    Promise.all([
      api.links.list(taskId),
      api.taskListItems.list(taskId),
    ]).then(([linkRes, itemRes]) => {
      setTaskLinksByTaskId((prev) => ({ ...prev, [taskId]: linkRes.links ?? [] }));
      setTaskListItemsByTaskId((prev) => ({
        ...prev,
        [taskId]: (itemRes.items ?? []).sort((a, b) => a.order_index - b.order_index),
      }));
    }).catch(() => {});
  }, []);

  const refetchSlotsForViewDay = useCallback((overrideDate?: string) => {
    const date = overrideDate ?? viewDate;
    api.day.getOrCreate(date).then((d) =>
      api.slots.list(d.id, { with: 'links,list_items' }).then((r) => {
        setSlots(r.slots);
        if (r.linksByTaskId) setTaskLinksByTaskId((prev) => ({ ...prev, ...r.linksByTaskId }));
        if (r.listItemsByTaskId) {
          setTaskListItemsByTaskId((prev) => {
            const next = { ...prev };
            Object.entries(r.listItemsByTaskId!).forEach(([tid, arr]) => {
              next[Number(tid)] = [...(next[Number(tid)] ?? []), ...arr]
                .filter((item, i, a) => a.findIndex((x) => x.id === item.id) === i)
                .sort((a, b) => a.order_index - b.order_index);
            });
            return next;
          });
        }
      })
    ).catch(() => {});
  }, [viewDate]);

  const handleRefresh = useCallback((taskId?: number) => {
    if (taskId != null) refetchTaskContent(taskId);
    else loadData();
  }, [refetchTaskContent, loadData]);

  const mergeTaskFromPatch = useCallback((patched: Task) => {
    setTasks((prev) =>
      prev.map((x) => {
        if (x.id !== patched.id) return x;
        const p = { ...patched } as Task & { recurring?: boolean | number; is_common?: boolean | number };
        if (typeof p.recurring === 'number') p.recurring = p.recurring !== 0;
        if (typeof p.is_common === 'number') p.is_common = p.is_common !== 0;
        return { ...x, ...p };
      })
    );
  }, []);

  const refetchOrganization = useCallback(() => {
    api.organization.list().then((r) => {
      setOrganizationCategories(r.categories ?? []);
      setOrganizationSubcategories(r.subcategories ?? []);
      setOrganizationTags(r.tags ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (refetchOrganizationRef) refetchOrganizationRef.current = refetchOrganization;
    return () => {
      if (refetchOrganizationRef) refetchOrganizationRef.current = null;
    };
  }, [refetchOrganizationRef, refetchOrganization]);

  const handleToggleTaskComplete = useCallback(
    (taskId: number) => {
      const todayStr = today();
      api.day
        .getOrCreate(todayStr)
        .then((day) => api.slots.list(day.id))
        .then((r) => {
          const slot = (r.slots ?? []).find((s) => s.task_id === taskId);
          if (slot) {
            return api.slots.update({ id: slot.id, completed: !slot.completed }).then(loadData);
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    },
    [loadData]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (viewDate < today()) {
      setScheduleBulkMode(false);
      setSelectedScheduleRootSlotIds(new Set());
      setScheduleBulkRescheduleOpen(false);
      setScheduleBulkRescheduleDate('');
      setScheduleBulkPriorityOpen(false);
    }
  }, [viewDate]);

  useEffect(() => {
    api.icalEvents
      .getConfig()
      .then((r) => {
        setIcalIntervalFetch(r.interval_fetch !== false);
        setIcalSyncIntervalMinutes(r.interval_minutes ?? 15);
      })
      .catch(() => {
        setIcalIntervalFetch(true);
        setIcalSyncIntervalMinutes(15);
      });
  }, []);

  useEffect(() => {
    return () => {
      icalPhaseTimersRef.current.forEach(clearTimeout);
      icalPhaseTimersRef.current = [];
    };
  }, []);

  function runIcalFetchWithPhase(
    from: string,
    to: string,
    opts?: { force_sync?: boolean; sync_if_stale?: boolean }
  ): Promise<{ events: IcalFeedEvent[]; errors?: Array<{ feed_url: string; message: string }> }> {
    icalPhaseTimersRef.current.forEach(clearTimeout);
    icalPhaseTimersRef.current = [];
    setIcalSyncPhase('downloading');
    const t1 = setTimeout(() => setIcalSyncPhase('parsing'), 800);
    const t2 = setTimeout(() => setIcalSyncPhase('saving'), 1600);
    icalPhaseTimersRef.current = [t1, t2];
    return api.icalEvents.get(from, to, opts).then(
      (r) => {
        icalPhaseTimersRef.current.forEach(clearTimeout);
        icalPhaseTimersRef.current = [];
        setIcalSyncPhase('loading');
        setTimeout(() => setIcalSyncPhase('synced'), 100);
        return r;
      },
      (err) => {
        icalPhaseTimersRef.current.forEach(clearTimeout);
        icalPhaseTimersRef.current = [];
        setIcalSyncPhase('idle');
        throw err;
      }
    );
  }

  // Today tab: fetch iCal feed events only when the visible month changes (not on every viewDate change)
  useEffect(() => {
    if (scheduleTab !== 'today') return;
    const { from: monthFrom, to: monthTo } = getMonthRange(viewDate);
    if (lastIcalMonthRef.current === monthFrom) return;
    const opts = { sync_if_stale: true };
    runIcalFetchWithPhase(monthFrom, monthTo, opts)
      .then((r) => {
        const byDate: Record<string, IcalFeedEvent[]> = {};
        const tz = settings.timezone ?? '';
        for (const e of r.events ?? []) {
          const d = icalEventLocalStartDate(e.start, e.allDay, tz);
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(e);
        }
        setFeedEventsByDateForSchedule((prev) => ({ ...prev, ...byDate }));
        setFeedErrors(r.errors ?? []);
        lastIcalMonthRef.current = monthFrom;
      })
      .catch(() => {});
  }, [scheduleTab, viewDate, settings.timezone]);

  // Calendar: load slots and feed events for month
  useEffect(() => {
    if (scheduleTab !== 'calendar') return;
    const { from, to } = getMonthRange(calendarMonth);
    api.slots.listByDateRange(from, to).then((r) => setCalendarSlotsByDate(r.byDate ?? {})).catch(() => setCalendarSlotsByDate({}));
    runIcalFetchWithPhase(from, to, { sync_if_stale: true })
      .then((r) => {
        const byDate: Record<string, IcalFeedEvent[]> = {};
        const tz = settings.timezone ?? '';
        for (const e of r.events ?? []) {
          const d = icalEventLocalStartDate(e.start, e.allDay, tz);
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(e);
        }
        setCalendarFeedEventsByDate(byDate);
      })
      .catch(() => setCalendarFeedEventsByDate({}));
  }, [scheduleTab, calendarMonth, settings.timezone]);

  // Periodic iCal sync while Today tab is active (every 15 min, sync-if-stale), only when interval fetch is enabled
  useEffect(() => {
    if (scheduleTab !== 'today' || !icalIntervalFetch) return;
    const intervalMs = Math.max(60000, (icalSyncIntervalMinutes ?? 15) * 60 * 1000);
    const id = setInterval(() => {
      const { from: monthFrom, to: monthTo } = getMonthRange(viewDate);
      runIcalFetchWithPhase(monthFrom, monthTo, { sync_if_stale: true })
        .then((r) => {
          const byDate: Record<string, IcalFeedEvent[]> = {};
          const tz = settings.timezone ?? '';
          for (const e of r.events ?? []) {
            const d = icalEventLocalStartDate(e.start, e.allDay, tz);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(e);
          }
          setFeedEventsByDateForSchedule((prev) => ({ ...prev, ...byDate }));
          setFeedErrors(r.errors ?? []);
        })
        .catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [scheduleTab, viewDate, icalIntervalFetch, icalSyncIntervalMinutes, settings.timezone]);

  const refetchIcalForScheduleView = useCallback(() => {
    const { from, to } = getMonthRange(viewDate);
    const tz = settings.timezone ?? '';
    api.icalEvents.get(from, to).then((r) => {
      const byDate: Record<string, IcalFeedEvent[]> = {};
      for (const e of r.events ?? []) {
        const d = icalEventLocalStartDate(e.start, e.allDay, tz);
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(e);
      }
      setFeedEventsByDateForSchedule((prev) => ({ ...prev, ...byDate }));
    }).catch(() => {});
  }, [viewDate, settings.timezone]);

  useEffect(() => {
    if (isMobile && user?.is_admin) {
      api.admin.getSettings().then((s) => setAdminDebug(!!s.debug)).catch(() => {});
    }
  }, [isMobile, user?.is_admin]);

  useEffect(() => {
    if (!isMobile || !adminDebug) return;
    const holdMs = 400;
    const moveThreshold = 15;
    const clearTimer = () => {
      if (debugHoldTimerRef.current) {
        clearTimeout(debugHoldTimerRef.current);
        debugHoldTimerRef.current = null;
      }
      debugTouchStartRef.current = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      clearTimer();
      debugTouchStartRef.current = { x: e.clientX, y: e.clientY };
      debugHoldTimerRef.current = setTimeout(() => {
        debugHoldTimerRef.current = null;
        if (debugTouchStartRef.current) setShowDebugOverlays(true);
      }, holdMs);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!debugTouchStartRef.current) return;
      const dx = e.clientX - debugTouchStartRef.current.x;
      const dy = e.clientY - debugTouchStartRef.current.y;
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) clearTimer();
    };
    const onPointerUp = () => {
      clearTimer();
      setShowDebugOverlays(false);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('pointermove', onPointerMove, { capture: true });
    document.addEventListener('pointerup', onPointerUp, { capture: true });
    document.addEventListener('pointercancel', onPointerUp, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('pointermove', onPointerMove, { capture: true });
      document.removeEventListener('pointerup', onPointerUp, { capture: true });
      document.removeEventListener('pointercancel', onPointerUp, { capture: true });
      clearTimer();
    };
  }, [isMobile, adminDebug]);

  useLayoutEffect(() => {
    if (!showDebugOverlays || !isMobile) return;
    const taskEl = taskListScrollRef.current;
    const scheduleEl = scheduleContentRef.current;
    const raf = requestAnimationFrame(() => {
      setDebugZoneRects({
        task: taskEl ? taskEl.getBoundingClientRect() : null,
        schedule: scheduleEl ? scheduleEl.getBoundingClientRect() : null,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [showDebugOverlays, isMobile]);

  useLayoutEffect(() => {
    if (openPrioritySlotId == null) {
      setSchedulePriorityPickerPosition(null);
      return;
    }
    const btn = schedulePriorityButtonRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      setSchedulePriorityPickerPosition({ top: r.top, left: r.right + 6 });
    } else {
      setSchedulePriorityPickerPosition(null);
    }
  }, [openPrioritySlotId]);

  useEffect(() => {
    if (newTaskIdToBlink == null) return;
    const el = taskListScrollRef.current?.querySelector(`[data-task-id="${newTaskIdToBlink}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [newTaskIdToBlink]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setCurrentTimeMinutes(d.getHours() * 60 + d.getMinutes());
    };
    const id = window.setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') {
        ev.preventDefault();
        if (lastUndoable) {
          lastUndoable.revert().then(() => setLastUndoable(null)).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          if (undoTimeoutRef.current) {
            clearTimeout(undoTimeoutRef.current);
            undoTimeoutRef.current = null;
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lastUndoable]);

  const slotDurationMinutes = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
  const viewStartMinutes = settings.start_hour * 60;
  const slotLabels: string[] = [];
  for (let m = viewStartMinutes; m < settings.end_hour * 60; m += slotDurationMinutes) {
    slotLabels.push(formatTimeAMPM(m));
  }
  const totalHeight = slotLabels.length * ROW_HEIGHT;

  const priorityRank = (p: Priority | undefined) => (p === 'commitment' ? 0 : p === 'high' ? 1 : p === 'medium' ? 2 : 3);
  const sortTasks = useCallback(
    (list: Task[]) => {
      const dir = orderDir === 'asc' ? 1 : -1;
      return [...list].sort((a, b) => {
        if (orderBy === 'title') {
          const cmp = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
          return dir * cmp;
        }
        if (orderBy === 'priority') {
          const cmp = priorityRank(a.priority) - priorityRank(b.priority);
          return dir * cmp;
        }
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dir * (aDate - bDate);
      });
    },
    [orderBy, orderDir]
  );

  const scheduledTaskIdsOnViewDay = new Set(slots.map((s) => s.task_id));
  const unassigned = sortTasks(
    tasks.filter(
      (t) =>
        (t.list_state ?? 'unassigned') === 'unassigned' &&
        !t.parent_id &&
        !t.is_common &&
        !scheduledTaskIdsOnViewDay.has(t.id) &&
        !scheduledTaskIdsFromTodayOnward.has(t.id) &&
        !accomplishedTaskIds.has(t.id)
    )
  );
  const pending = sortTasks(
    tasks.filter(
      (t) =>
        (t.list_state ?? '') === 'pending' &&
        !t.parent_id &&
        !t.is_common &&
        !scheduledTaskIdsFromTodayOnward.has(t.id)
    )
  );
  const taskMatchesSearch = useCallback(
    (task: Task, q: string): boolean => {
      if (!q.trim()) return true;
      const lower = q.trim().toLowerCase();
      if (task.title.toLowerCase().includes(lower)) return true;
      const links = taskLinksByTaskId[task.id] ?? [];
      if (links.some((l) => (l.description || l.url || '').toLowerCase().includes(lower))) return true;
      const items = taskListItemsByTaskId[task.id] ?? [];
      if (items.some((i) => (i.content || '').toLowerCase().includes(lower))) return true;
      return false;
    },
    [taskLinksByTaskId, taskListItemsByTaskId]
  );
  const unassignedFiltered = taskSearchQuery.trim() ? unassigned.filter((t) => taskMatchesSearch(t, taskSearchQuery)) : unassigned;
  const pendingFiltered = taskSearchQuery.trim() ? pending.filter((t) => taskMatchesSearch(t, taskSearchQuery)) : pending;
  const commonFiltered = sortTasks(
    taskSearchQuery.trim() ? commonTasks.filter((t) => taskMatchesSearch(t, taskSearchQuery)) : commonTasks
  );

  const getChildTaskIds = (taskId: number): number[] => {
    const children = tasks.filter((t) => t.parent_id === taskId);
    const ids: number[] = [];
    children.forEach((c) => {
      ids.push(c.id);
      ids.push(...getChildTaskIds(c.id));
    });
    return ids;
  };

  const getNextAvailableTimeForDay = async (dayId: number): Promise<{ start_time: string; end_time: string }> => {
    const r = await api.slots.list(dayId);
    const daySlots = (r.slots || []).filter((s) => s.id && slotHasTime(s));
    const startMin = settings.start_hour * 60;
    const endMin = settings.end_hour * 60;
    const step = slotDurationMinutes;
    const ranges: Array<[number, number]> = daySlots
      .map((s): [number, number] => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)])
      .sort((a, b) => a[0] - b[0]);
    let slotStart = startMin;
    while (slotStart < endMin - step) {
      const slotEnd = slotStart + step;
      const overlaps = ranges.some(([s, e]) => slotStart < e && slotEnd > s);
      if (!overlaps) return { start_time: minutesToTime(slotStart), end_time: minutesToTime(slotEnd) };
      slotStart += step;
    }
    return { start_time: minutesToTime(startMin), end_time: minutesToTime(startMin + step) };
  };

  const getNextAvailableGroupTimeForDay = async (
    dayId: number,
    memberCount: number
  ): Promise<{ start_time: string; end_time: string }> => {
    const count = Math.max(1, memberCount | 0);
    if (count <= 1) return getNextAvailableTimeForDay(dayId);

    const r = await api.slots.list(dayId);
    const daySlots = (r.slots || []).filter((s) => s.id && slotHasTime(s));

    // Only root slots participate in overlap for group boundaries.
    const rootSlots = daySlots.filter((s) => s.parent_id == null);
    const ranges: Array<[number, number]> = rootSlots
      .map((s): [number, number] => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)])
      .sort((a, b) => a[0] - b[0]);

    const startMin = settings.start_hour * 60;
    const endMin = settings.end_hour * 60;
    const step = slotDurationMinutes;
    const groupDur = count * slotDurationMinutes;

    let slotStart = startMin;
    while (slotStart <= endMin - groupDur) {
      const slotEnd = slotStart + groupDur;
      const overlaps = ranges.some(([s, e]) => slotStart < e && slotEnd > s);
      if (!overlaps) return { start_time: minutesToTime(slotStart), end_time: minutesToTime(slotEnd) };
      slotStart += step;
    }

    // Fallback: return the first start even if it overlaps; UI will still reconcile.
    return { start_time: minutesToTime(startMin), end_time: minutesToTime(startMin + groupDur) };
  };

  const handleAddTask = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    api.tasks
      .create({ title })
      .then((created) => {
        setNewTaskTitle('');
        loadData();
        setNewTaskIdToBlink(created.id);
        setTimeout(() => setNewTaskIdToBlink(null), 2000);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        loadData();
      });
  };

  const handleAddCommonTask = () => {
    const title = newCommonTaskTitle.trim();
    if (!title) return;
    api.tasks
      .create({ title, is_common: true })
      .then(() => {
        setNewCommonTaskTitle('');
        loadData();
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        loadData();
      });
  };

  const handleAddTaskWithOptions = () => {
    const title = addOptionsTitle.trim();
    if (!title) return;
    api.tasks
      .create({ title, priority: addOptionsPriority, recurring: addOptionsRecurring })
      .then(() => {
        loadData();
        setAddOptionsOpen(false);
        setAddOptionsTitle('');
        setAddOptionsPriority('low');
        setAddOptionsRecurring(false);
      })
      .catch(alert);
  };

  const handleScheduleOnDate = async () => {
    const dateStr = scheduleDateValue.trim();
    let scheduleTargetId = scheduleDateTaskId;
    if (!scheduleTargetId || !dateStr) return;
    let task = tasks.find((t) => t.id === scheduleTargetId);
    if (!task) return;
    if (task.is_common) {
      const created = await api.tasks.create({ copy_from: scheduleTargetId, list_state: 'unassigned' });
      scheduleTargetId = created.id;
      task = { ...task, id: created.id, is_common: false, recurring: false };
    }
    const taskId = scheduleTargetId;
    const day = await api.day.getOrCreate(dateStr);
    const start_time = scheduleNoTime ? null : minutesToTime((() => {
      const [h, m] = (scheduleTimeValue || '09:00').split(':').map(Number);
      return (h ?? 9) * 60 + (m ?? 0);
    })());
    const slotIdToReplace = scheduleSlotIdToReplace;
    const isRecurringFuture = task.recurring && dateStr > today();
    const isGroupRoot = task.parent_id == null;
    const orderedDirectChildren = isGroupRoot
      ? tasks
          .filter((t) => t.parent_id === task.id)
          .slice()
          .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id)
      : [];
    const memberIds = isGroupRoot ? [task.id, ...orderedDirectChildren.map((c) => c.id)] : [task.id];
    const memberCount = memberIds.length;

    // Due date + optional "increase priority" happens at schedule time.
    // For grouped tasks, apply due_date (and priority bump if enabled) to all direct members.
    await Promise.all(
      memberIds.map((id) =>
        api.tasks.update({
          id,
          due_date: dateStr,
          ...(scheduleDueAutoPriority ? { priority: 'high' as Priority } : {}),
        })
      )
    );

    if (slotIdToReplace != null) {
      // Replace the whole stacked group (root + direct children) on the current viewDate.
      const oldChildSlotIds = slots.filter((s) => s.parent_id === taskId).map((s) => s.id);
      await Promise.all([slotIdToReplace, ...oldChildSlotIds].map((id) => api.slots.delete(id)));

      if (scheduleNoTime) {
        await Promise.all(
          memberIds.map((id, idx) => api.slots.create({ day_record_id: day.id, task_id: id, start_time: null, end_time: null, order_index: idx }))
        );
      } else if (start_time) {
        const groupStartMin = timeToMinutes(start_time);
        const groupEndMin = groupStartMin + memberCount * slotDurationMinutes;
        const memberTimes = distributeGroupMemberTimes({ groupStartMin, groupEndMin, slotDurationMinutes, memberCount });
        await Promise.all(
          memberIds.map((id, idx) => {
            const st = idx === 0 ? groupStartMin : memberTimes[idx].startMin;
            const et = idx === 0 ? groupEndMin : memberTimes[idx].endMin;
            return api.slots.create({
              day_record_id: day.id,
              task_id: id,
              start_time: minutesToTime(st),
              end_time: minutesToTime(et),
              order_index: idx,
            });
          })
        );
      }
    } else if (!isRecurringFuture) {
      if (scheduleNoTime) {
        await Promise.all(
          memberIds.map((id, idx) => api.slots.create({ day_record_id: day.id, task_id: id, start_time: null, end_time: null, order_index: idx }))
        );
      } else if (start_time) {
        const groupStartMin = timeToMinutes(start_time);
        const groupEndMin = groupStartMin + memberCount * slotDurationMinutes;
        const memberTimes = distributeGroupMemberTimes({ groupStartMin, groupEndMin, slotDurationMinutes, memberCount });
        await Promise.all(
          memberIds.map((id, idx) => {
            const st = idx === 0 ? groupStartMin : memberTimes[idx].startMin;
            const et = idx === 0 ? groupEndMin : memberTimes[idx].endMin;
            return api.slots.create({
              day_record_id: day.id,
              task_id: id,
              start_time: minutesToTime(st),
              end_time: minutesToTime(et),
              order_index: idx,
            });
          })
        );
      }
    }
    setScheduleDateOpen(false);
    setScheduleDateTaskId(null);
    setScheduleDateValue(viewDate);
    setScheduleTimeValue('09:00');
    setScheduleNoTime(false);
    setScheduleSlotIdToReplace(null);
    setScheduleDueAutoPriority(false);
    loadData();
    if (scheduleTab === 'calendar') setCalendarMonth(dateStr);
  };

  const handleUngroupGroup = async (rootTaskId: number) => {
    // Ungroup means: remove grouping by setting all descendants' parent_id to NULL.
    // Root tasks stay as their own independent tasks.
    const ids = getChildTaskIds(rootTaskId);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => api.tasks.update({ id, parent_id: null })));
    loadData();
  };

  const handleDropOnListZone = useCallback(
    async (
      targetListState: 'unassigned' | 'pending',
      taskIds: number[],
      source: 'unassigned' | 'pending' | 'schedule' | 'common'
    ) => {
      try {
        if (source === 'common') {
          for (const taskId of taskIds) {
            await api.tasks.create({ copy_from: taskId, list_state: targetListState });
          }
          setSelectedTaskIds((prev) => {
            const next = new Set(prev);
            taskIds.forEach((id) => next.delete(id));
            return next;
          });
          loadData();
          return;
        }
        const draggingSingle = taskIds.length === 1;
      for (const taskId of taskIds) {
        if (source === 'schedule') {
          try {
            const day = await api.day.getOrCreate(viewDate);
            const res = await api.slots.list(day.id);
            const daySlots = res.slots || [];
            const rootSlot = daySlots.find((s) => s.task_id === taskId && (s.parent_id == null || !daySlots.some((o) => o.task_id === s.parent_id)));
            if (!rootSlot) {
              const stray = daySlots.filter((s) => s.task_id === taskId && s.id > 0);
              if (stray.length > 0) {
                await Promise.all(stray.map((s) => api.slots.delete(s.id)));
              }
              await api.tasks.update({ id: taskId, list_state: targetListState });
              continue;
            }
            const childSlots = daySlots.filter((s) => s.parent_id === rootSlot.task_id);
            const completedChildSlotIds = childSlots.filter((c) => c.completed === 1).map((c) => c.id);
            const incompleteChildSlotIds = childSlots.filter((c) => c.completed !== 1).map((c) => c.id);
            const someCompleted = completedChildSlotIds.length > 0 || rootSlot.completed === 1;
            const someIncomplete = incompleteChildSlotIds.length > 0 || rootSlot.completed !== 1;
            if (someCompleted && someIncomplete) {
              if (taskIds.length === 1) {
                setOrphanModal({
                  taskId,
                  targetListState,
                  rootSlotId: rootSlot.id,
                  completedChildSlotIds,
                  incompleteChildSlotIds,
                });
                return;
              }
              await resolveOrphanAndMove(taskId, targetListState, 'no', rootSlot.id, completedChildSlotIds, incompleteChildSlotIds);
            } else {
              await resolveOrphanAndMove(taskId, targetListState, 'no', rootSlot.id, completedChildSlotIds, incompleteChildSlotIds);
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            loadData();
          }
          continue;
        }
        if ((source === 'unassigned' || source === 'pending') && incompleteRootIds.has(taskId)) {
          const yesterday = new Date(viewDate + 'T00:00:00');
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().slice(0, 10);
          try {
            const day = await api.day.getOrCreate(yesterdayStr);
            const res = await api.slots.list(day.id);
            const daySlots = res.slots || [];
            const rootSlot = daySlots.find((s) => s.task_id === taskId && (s.parent_id == null || !daySlots.some((o) => o.task_id === s.parent_id)));
            if (!rootSlot) {
              await api.tasks.update({ id: taskId, list_state: targetListState });
              continue;
            }
            const childSlots = daySlots.filter((s) => s.parent_id === rootSlot.task_id);
            const completedChildSlotIds = childSlots.filter((c) => c.completed === 1).map((c) => c.id);
            const incompleteChildSlotIds = childSlots.filter((c) => c.completed !== 1).map((c) => c.id);
            const someCompleted = completedChildSlotIds.length > 0 || rootSlot.completed === 1;
            const someIncomplete = incompleteChildSlotIds.length > 0 || rootSlot.completed !== 1;
            if (someCompleted && someIncomplete) {
              if (taskIds.length === 1) {
                setOrphanModal({
                  taskId,
                  targetListState,
                  rootSlotId: rootSlot.id,
                  completedChildSlotIds,
                  incompleteChildSlotIds,
                });
                return;
              }
              await resolveOrphanAndMove(taskId, targetListState, 'no', rootSlot.id, completedChildSlotIds, incompleteChildSlotIds);
            } else {
              await api.tasks.update({ id: taskId, list_state: targetListState });
            }
          } catch {
            await api.tasks.update({ id: taskId, list_state: targetListState });
          }
          continue;
        }
        const task = tasks.find((t) => t.id === taskId);
        // Case 2: when moving a single task out of a group, remove it from the group.
        if (draggingSingle && task?.parent_id != null) {
          await api.tasks.update({ id: taskId, parent_id: null });
        }
        await api.tasks.update({ id: taskId, list_state: targetListState });
      }
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        taskIds.forEach((id) => next.delete(id));
        return next;
      });
      loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        loadData();
      }
    },
    [viewDate, incompleteRootIds, loadData]
  );

  const resolveOrphanAndMove = async (
    taskId: number,
    targetListState: 'unassigned' | 'pending',
    choice: 'yes' | 'no' | 'cancel',
    rootSlotId: number,
    completedChildSlotIds: number[],
    incompleteChildSlotIds: number[]
  ) => {
    if (choice === 'cancel') {
      setOrphanModal(null);
      clearDragState();
      return;
    }
    try {
      if (choice === 'yes') {
        const toDelete = [rootSlotId, ...incompleteChildSlotIds];
        await Promise.all(toDelete.map((id) => api.slots.delete(id)));
        for (const id of completedChildSlotIds) {
          try {
            await api.slots.update({ id, parent_id: null });
          } catch {
            /* backend may not support parent_id update */
          }
        }
      } else {
        await api.slots.delete(rootSlotId);
        await Promise.all(incompleteChildSlotIds.map((id) => api.slots.delete(id)));
        await Promise.all(completedChildSlotIds.map((id) => api.slots.delete(id)));
      }
      await api.tasks.update({ id: taskId, list_state: targetListState });
      setOrphanModal(null);
      clearDragState();
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      loadData();
    }
  };

  const HOLD_MS = 500;
  const MOVE_THRESHOLD = 18;

  const cancelHold = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    holdPointerRef.current = null;
    if (cancelMoveRef.current) {
      window.removeEventListener('pointermove', cancelMoveRef.current);
      cancelMoveRef.current = null;
    }
    if (cancelUpRef.current) {
      window.removeEventListener('pointerup', cancelUpRef.current);
      cancelUpRef.current = null;
    }
  }, []);

  const handlePointerUpDrop = useCallback(
    (e: PointerEvent) => {
      const d = dragStateRef.current;
      if (!d) {
        clearDragState();
        return;
      }
      const taskIds = d.taskIds ?? [d.taskId];
      const source = d.source;
      const anchorTaskId = d.anchorTaskId;
      const draggedSet = new Set(taskIds);
      const scheduleDropStartMin = scheduleDropStartMinRef.current;
      clearDragState();
      const el = document.elementFromPoint(e.clientX, e.clientY);

      if (source === 'schedule' && taskIds.length > 1) {
        let onScheduleGrid = false;
        let gn: Element | null = el;
        while (gn) {
          if (gn.getAttribute('data-schedule-drop') === 'true') {
            onScheduleGrid = true;
            break;
          }
          gn = gn.parentElement;
        }
        const anchorTid = anchorTaskId ?? taskIds[0];
        if (viewDate >= today() && onScheduleGrid && scheduleDropStartMin != null) {
          const anchorSlot = slots.find(
            (s) => s.task_id === anchorTid && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id))
          );
          if (anchorSlot) {
            const viewEndMin = settings.end_hour * 60;
            const anchorOrigStart = timeToMinutes(anchorSlot.start_time);
            const anchorOrigEnd = timeToMinutes(anchorSlot.end_time);
            const anchorChildSlots = slots.filter((s) => s.parent_id === anchorSlot.task_id);
            const anchorMemberCount = 1 + anchorChildSlots.length;
            const anchorOriginalDurationMin = Math.max(0, anchorOrigEnd - anchorOrigStart);
            const anchorPreservedDurationMin = Math.max(anchorOriginalDurationMin, anchorMemberCount * slotDurationMinutes);
            const anchorLatestStartMin = viewEndMin - anchorPreservedDurationMin;
            const anchorCandidateStartMin = Math.min(scheduleDropStartMin, anchorLatestStartMin);
            const anchorSnappedStartMin = snapToSlot(
              anchorCandidateStartMin,
              settings.start_hour,
              settings.end_hour,
              slotDurationMinutes
            );
            const anchorNewStartMin = Math.min(anchorSnappedStartMin, anchorLatestStartMin);
            const deltaMin = anchorNewStartMin - anchorOrigStart;

            const memberTimesById = new Map<number, { startMin: number; endMin: number }>();
            for (const rootTaskId of taskIds) {
              const slot = slots.find(
                (s) =>
                  s.task_id === rootTaskId && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id))
              );
              if (!slot) continue;
              const origStart = timeToMinutes(slot.start_time);
              const origEnd = timeToMinutes(slot.end_time);
              const childSlots = slots
                .filter((s) => s.parent_id === slot.task_id)
                .slice()
                .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
              const memberCount = 1 + childSlots.length;
              const originalDurationMin = Math.max(0, origEnd - origStart);
              const preservedDurationMin = Math.max(originalDurationMin, memberCount * slotDurationMinutes);
              const candidateStartMin = origStart + deltaMin;
              const snappedStartMin = snapToSlot(
                candidateStartMin,
                settings.start_hour,
                settings.end_hour,
                slotDurationMinutes
              );
              const latestStartMin = viewEndMin - preservedDurationMin;
              const newStartMin = Math.min(snappedStartMin, latestStartMin);
              const newEndMin = newStartMin + preservedDurationMin;
              const memberSlots = [slot, ...childSlots];
              const memberTimes = distributeGroupMemberTimes({
                groupStartMin: newStartMin,
                groupEndMin: newEndMin,
                slotDurationMinutes,
                memberCount,
              });
              memberSlots.forEach((ms, i) =>
                memberTimesById.set(ms.id, {
                  startMin: i === 0 ? newStartMin : memberTimes[i].startMin,
                  endMin: i === 0 ? newEndMin : memberTimes[i].endMin,
                })
              );
            }

            if (memberTimesById.size === 0) {
              setScheduleBulkMoveMode(false);
              loadData();
              return;
            }

            setSlots((prev) =>
              prev.map((s) => {
                const mt = memberTimesById.get(s.id);
                if (!mt) return s;
                return { ...s, start_time: minutesToTime(mt.startMin), end_time: minutesToTime(mt.endMin) };
              })
            );
            void (async () => {
              try {
                await api.day.getOrCreate(viewDate);
                await Promise.all(
                  [...memberTimesById.entries()].map(([id, mt]) =>
                    api.slots.update({
                      id,
                      start_time: minutesToTime(mt.startMin),
                      end_time: minutesToTime(mt.endMin),
                    })
                  )
                );
                loadData();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                loadData();
              }
            })();
            setScheduleBulkMoveMode(false);
            return;
          }
        }
        setScheduleBulkMoveMode(false);
        loadData();
        return;
      }

      const canDropSubtaskOnUnassigned =
        source === 'unassigned' && taskIds.some((id) => tasks.find((t) => t.id === id)?.parent_id != null);
      // Resolve list zones on any ancestor first. Otherwise a drop on top of another task row
      // matches data-task-id before data-drop-zone and is treated as group-attach, leaving schedule
      // slots and/or parent_id set so the task vanishes from Unassigned/Pending (!parent_id filters).
      let zoneProbe: Element | null = el;
      while (zoneProbe) {
        const z = zoneProbe.getAttribute('data-drop-zone');
        if (
          z === 'unassigned' &&
          (source === 'pending' || source === 'schedule' || source === 'common' || canDropSubtaskOnUnassigned)
        ) {
          handleDropOnListZone('unassigned', taskIds, source);
          return;
        }
        if (z === 'pending' && (source === 'unassigned' || source === 'schedule' || source === 'common')) {
          handleDropOnListZone('pending', taskIds, source);
          return;
        }
        zoneProbe = zoneProbe.parentElement;
      }
      let node: Element | null = el;
      while (node) {
        const tid = node.getAttribute('data-task-id');
        if (tid) {
          const targetId = parseInt(tid, 10);
          if (!draggedSet.has(targetId)) {
            const movedId = taskIds.length === 1 ? taskIds[0] : null;
            const movedTask = movedId != null ? tasks.find((t) => t.id === movedId) : undefined;
            const targetTask = tasks.find((t) => t.id === targetId);

            // Reorder siblings inside the same parent group (task groups UI behavior).
            // Only implemented for single-task drags between existing siblings.
            if (
              movedId != null &&
              movedTask &&
              targetTask &&
              movedTask.parent_id != null &&
              movedTask.parent_id === targetTask.parent_id &&
              movedId !== targetId
            ) {
              const parentId = movedTask.parent_id;
              const siblings = tasks.filter((t) => t.parent_id === parentId).slice();
              const siblingsById = new Map(siblings.map((s) => [s.id, s]));

              const currentOrderedIds = siblings
                .slice()
                .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id)
                .map((s) => s.id);
              const nextOrderedIds = reorderGroupSiblingIds({ members: siblings, movedId, targetId });

              if (currentOrderedIds.join(',') !== nextOrderedIds.join(',')) {
                const nextSiblings = nextOrderedIds.map((id) => siblingsById.get(id)).filter(Boolean) as Task[];
                Promise.all(nextSiblings.map((s, idx) => api.tasks.update({ id: s.id, group_order: idx })))
                  .then(loadData)
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    loadData();
                  });
              } else {
                loadData();
              }

              setSelectedTaskIds((prev) => {
                const next = new Set(prev);
                taskIds.forEach((id) => next.delete(id));
                return next;
              });
              return;
            }

            // Group attach: if dropping onto a child, attach to the group root (its parent_id).
            const effectiveParentId =
              targetTask && targetTask.parent_id != null ? (targetTask.parent_id as number) : targetId;

            (async () => {
              try {
                const toAttach = taskIds.filter((id) => id !== targetId);
                if (source === 'common') {
                  for (const tid of toAttach) {
                    const created = await api.tasks.create({ copy_from: tid, list_state: 'unassigned' });
                    await api.tasks.update({ id: created.id, parent_id: effectiveParentId });
                  }
                } else {
                  await Promise.all(toAttach.map((id) => api.tasks.update({ id, parent_id: effectiveParentId })));
                }
                loadData();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                loadData();
              }
            })();
            setSelectedTaskIds((prev) => {
              const next = new Set(prev);
              taskIds.forEach((id) => next.delete(id));
              return next;
            });
          }
          return;
        }
        const date = node.getAttribute('data-date');
        if (date && date >= today()) {
          (async () => {
            try {
              const day = await api.day.getOrCreate(date);
              const effectiveTaskIds = (() => {
                const roots = taskIds.filter((tid) => tasks.find((t) => t.id === tid)?.parent_id == null);
                return roots.length > 0 ? roots : taskIds;
              })();
              for (const origId of effectiveTaskIds) {
                const template = tasks.find((t) => t.id === origId);
                if (!template) continue;
                let rootTaskId = origId;
                let recurring = template.recurring;
                if (source === 'common') {
                  const created = await api.tasks.create({ copy_from: origId, list_state: 'unassigned' });
                  rootTaskId = created.id;
                  recurring = false;
                }
                if (recurring && date > today()) {
                  continue;
                }
                const isGroupRoot = template.parent_id == null;
                const orderedDirectChildren =
                  source === 'common'
                    ? []
                    : isGroupRoot
                      ? tasks
                          .filter((t) => t.parent_id === template.id)
                          .slice()
                          .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id)
                      : [];
                const memberIds = isGroupRoot ? [rootTaskId, ...orderedDirectChildren.map((c) => c.id)] : [rootTaskId];
                const memberCount = memberIds.length;

                const gt = await getNextAvailableGroupTimeForDay(day.id, memberCount);
                const gtStartMin = timeToMinutes(gt.start_time);
                const gtEndMin = timeToMinutes(gt.end_time);
                const memberTimes = distributeGroupMemberTimes({
                  groupStartMin: gtStartMin,
                  groupEndMin: gtEndMin,
                  slotDurationMinutes,
                  memberCount,
                });

                await Promise.all(
                  memberIds.map((id, idx) =>
                    api.slots.create({
                      day_record_id: day.id,
                      task_id: id,
                      start_time: minutesToTime(idx === 0 ? gtStartMin : memberTimes[idx].startMin),
                      end_time: minutesToTime(idx === 0 ? gtEndMin : memberTimes[idx].endMin),
                      order_index: idx,
                    })
                  )
                );
              }
              loadData();
              setCalendarSlotsByDate((prev) => ({ ...prev, [date]: [] }));
              setSelectedTaskIds((prev) => {
                const next = new Set(prev);
                taskIds.forEach((id) => next.delete(id));
                return next;
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              loadData();
            }
          })();
          return;
        }
        const scheduleDropUntimed = node.getAttribute('data-schedule-drop-untimed');
        if (scheduleDropUntimed === 'true') {
          if (viewDate < today()) return;
          if (source === 'unassigned' || source === 'pending' || source === 'common') {
            (async () => {
              try {
                const day = await api.day.getOrCreate(viewDate);
                const effectiveTaskIds = (() => {
                  const roots = taskIds.filter((tid) => tasks.find((t) => t.id === tid)?.parent_id == null);
                  return roots.length > 0 ? roots : taskIds;
                })();
                for (let i = 0; i < effectiveTaskIds.length; i++) {
                  const origId = effectiveTaskIds[i];
                  const task = tasks.find((t) => t.id === origId);
                  if (!task) continue;
                  if (source !== 'common' && task.recurring && viewDate > today()) continue;
                  const ids =
                    source === 'common'
                      ? [(await api.tasks.create({ copy_from: origId, list_state: 'unassigned' })).id]
                      : task.parent_id == null
                        ? [task.id, ...getChildTaskIds(task.id)]
                        : [task.id];
                  await Promise.all(
                    ids.map((id, idx) => api.slots.create({ day_record_id: day.id, task_id: id, start_time: null, end_time: null, order_index: idx }))
                  );
                }
                refetchSlotsForViewDay(viewDate);
                setSelectedTaskIds((prev) => {
                  const next = new Set(prev);
                  taskIds.forEach((id) => next.delete(id));
                  return next;
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                loadData();
              }
            })();
            return;
          }
          if (source === 'schedule' && taskIds.length > 0) {
            (async () => {
              try {
                const day = await api.day.getOrCreate(viewDate);
                const slotsToUntime = slots.filter(
                  (s) => s.day_record_id === day.id && (taskIds.includes(s.task_id) || (s.parent_id != null && taskIds.includes(s.parent_id)))
                );
                const rootSlotsToUntime = slotsToUntime.filter((s) => !s.parent_id || !slotsToUntime.some((o) => o.task_id === s.parent_id));
                const allIds = rootSlotsToUntime.flatMap((s) => {
                  const children = slotsToUntime.filter((c) => c.parent_id === s.task_id);
                  return [s.id, ...children.map((c) => c.id)];
                });
                await Promise.all(allIds.map((id) => api.slots.update({ id, start_time: null, end_time: null })));
                refetchSlotsForViewDay(viewDate);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                loadData();
              }
            })();
            return;
          }
        }
        const scheduleDrop = node.getAttribute('data-schedule-drop');
        if (scheduleDrop === 'true') {
          if (viewDate < today()) return;
          if (source === 'unassigned' || source === 'pending' || source === 'common') {
          (async () => {
            try {
              const day = await api.day.getOrCreate(viewDate);
              const viewEndMin = settings.end_hour * 60;
              let nextStartMin =
                scheduleDropStartMin != null ? scheduleDropStartMin : null;
              const effectiveTaskIds = (() => {
                const roots = taskIds.filter((tid) => tasks.find((t) => t.id === tid)?.parent_id == null);
                return roots.length > 0 ? roots : taskIds;
              })();
              for (let i = 0; i < effectiveTaskIds.length; i++) {
                const origId = effectiveTaskIds[i];
                const template = tasks.find((t) => t.id === origId);
                if (!template) continue;
                let rootTaskId = origId;
                let recurring = template.recurring;
                if (source === 'common') {
                  const created = await api.tasks.create({ copy_from: origId, list_state: 'unassigned' });
                  rootTaskId = created.id;
                  recurring = false;
                }
                if (recurring && viewDate > today()) {
                  continue;
                }
                const isGroupRoot = template.parent_id == null;
                const orderedDirectChildren =
                  source === 'common'
                    ? []
                    : isGroupRoot
                      ? tasks
                          .filter((t) => t.parent_id === template.id)
                          .slice()
                          .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.id - b.id)
                      : [];
                const memberIds = isGroupRoot ? [rootTaskId, ...orderedDirectChildren.map((c) => c.id)] : [rootTaskId];
                const memberCount = memberIds.length;

                const groupStartMinCandidate = nextStartMin != null
                  ? Math.min(nextStartMin, viewEndMin - memberCount * slotDurationMinutes)
                  : null;
                let rootStartMin: number;
                let rootEndMin: number;
                let memberTimes: Array<{ startMin: number; endMin: number }>;

                if (groupStartMinCandidate != null) {
                  rootStartMin = groupStartMinCandidate;
                  rootEndMin = groupStartMinCandidate + memberCount * slotDurationMinutes;
                  memberTimes = distributeGroupMemberTimes({ groupStartMin: rootStartMin, groupEndMin: rootEndMin, slotDurationMinutes, memberCount });
                } else {
                  const gt = await getNextAvailableGroupTimeForDay(day.id, memberCount);
                  const gtStartMin = timeToMinutes(gt.start_time);
                  const gtEndMin = timeToMinutes(gt.end_time);
                  rootStartMin = gtStartMin;
                  rootEndMin = gtEndMin;
                  memberTimes = distributeGroupMemberTimes({
                    groupStartMin: rootStartMin,
                    groupEndMin: rootEndMin,
                    slotDurationMinutes,
                    memberCount,
                  });
                }

                if (nextStartMin != null) nextStartMin += memberCount * slotDurationMinutes;

                await Promise.all(
                  memberIds.map((id, idx) =>
                    api.slots.create({
                      day_record_id: day.id,
                      task_id: id,
                      start_time: minutesToTime(idx === 0 ? rootStartMin : memberTimes[idx].startMin),
                      end_time: minutesToTime(idx === 0 ? rootEndMin : memberTimes[idx].endMin),
                      order_index: idx,
                    })
                  )
                );
              }
              loadData();
              setSelectedTaskIds((prev) => {
                const next = new Set(prev);
                taskIds.forEach((id) => next.delete(id));
                return next;
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              loadData();
            }
          })();
          return;
        }
        if (viewDate >= today() && source === 'schedule' && taskIds.length === 1 && scheduleDropStartMin != null) {
          const slot = slots.find((s) => s.task_id === taskIds[0] && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id)));
          if (!slot) return;
          const viewEndMin = settings.end_hour * 60;
          const originalStartMin = timeToMinutes(slot.start_time);
          const originalEndMin = timeToMinutes(slot.end_time);
          const originalDurationMin = Math.max(0, originalEndMin - originalStartMin);
          const childSlots = slots.filter((s) => s.parent_id === slot.task_id);
          const memberCount = 1 + childSlots.length;
          const preservedDurationMin = Math.max(originalDurationMin, memberCount * slotDurationMinutes);
          const latestStartMin = viewEndMin - preservedDurationMin;
          const candidateStartMin = Math.min(scheduleDropStartMin, latestStartMin);
          const snappedStartMin = snapToSlot(candidateStartMin, settings.start_hour, settings.end_hour, slotDurationMinutes);
          const newStartMin = Math.min(snappedStartMin, latestStartMin);
          const newEndMin = newStartMin + preservedDurationMin;
          const orderedChildren = childSlots.slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
          const memberSlots = [slot, ...orderedChildren];
          const memberTimes = distributeGroupMemberTimes({
            groupStartMin: newStartMin,
            groupEndMin: newEndMin,
            slotDurationMinutes,
            memberCount,
          });
          const memberTimesById = new Map<number, { startMin: number; endMin: number }>();
          memberSlots.forEach((ms, i) =>
            memberTimesById.set(ms.id, {
              startMin: i === 0 ? newStartMin : memberTimes[i].startMin,
              endMin: i === 0 ? newEndMin : memberTimes[i].endMin,
            })
          );
          setSlots((prev) =>
            prev.map((s) => {
              const mt = memberTimesById.get(s.id);
              if (!mt) return s;
              return { ...s, start_time: minutesToTime(mt.startMin), end_time: minutesToTime(mt.endMin) };
            })
          );
          (async () => {
            try {
              await api.day.getOrCreate(viewDate);
              await Promise.all(
                memberSlots.map((ms) =>
                  api.slots.update({
                    id: ms.id,
                    start_time: minutesToTime(memberTimesById.get(ms.id)!.startMin),
                    end_time: minutesToTime(memberTimesById.get(ms.id)!.endMin),
                  })
                )
              );
              loadData();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              loadData();
            }
          })();
          return;
        }
        }
        node = node.parentElement;
      }
    },
    [
      viewDate,
      tasks,
      slots,
      loadData,
      getChildTaskIds,
      handleDropOnListZone,
      clearDragState,
      settings,
      slotDurationMinutes,
    ]
  );

  const enterDragMode = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    const info = holdPointerRef.current;
    if (!info) return;
    if (cancelMoveRef.current) {
      window.removeEventListener('pointermove', cancelMoveRef.current);
      cancelMoveRef.current = null;
    }
    if (cancelUpRef.current) {
      window.removeEventListener('pointerup', cancelUpRef.current);
      cancelUpRef.current = null;
    }
    const taskIds = info.taskIds;
    dragStateRef.current = {
      taskId: taskIds[0],
      taskIds,
      source: info.source,
      anchorTaskId: info.anchorTaskId,
    };
    setDragState({ taskId: taskIds[0], taskIds, source: info.source });
    setDragPreviewPosition({ x: info.clientX, y: info.clientY });
    setDraggingTaskId(taskIds[0]);
    setDraggingTaskIds(new Set(taskIds));
    if (!textSelectionLockRef.current) textSelectionLockRef.current = lockTextSelection();
    const EDGE_ZONE = 56;
    const SCROLL_STEP = 12;
    let scheduleScrollInterval: ReturnType<typeof setInterval> | null = null;
    let scheduleScrollEl: HTMLElement | null = null;
    let lastPointerY = 0;
    const scrollScrollable = (container: HTMLElement, clientY: number, step: number) => {
      const rect = container.getBoundingClientRect();
      if (clientY <= rect.top + EDGE_ZONE) {
        container.scrollTop = Math.max(0, container.scrollTop - step);
      } else if (clientY >= rect.bottom - EDGE_ZONE) {
        container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + step);
      }
    };
    const AUTOSCROLL_DELAY_MS = 250;
    const delayedScheduleAutoscroll = createDelayedEdgeAction(AUTOSCROLL_DELAY_MS, () => {
      // Start scrolling only if we're still dragging near the edge.
      if (!scheduleScrollEl) return;
      scrollScrollable(scheduleScrollEl, lastPointerY, SCROLL_STEP);
      if (!scheduleScrollInterval) {
        scheduleScrollInterval = setInterval(() => {
          const scroll = scheduleScrollEl ? scheduleScrollEl : (document.querySelector('.left-bottom .schedule-content') as HTMLElement | null);
          if (scroll) scrollScrollable(scroll, lastPointerY, SCROLL_STEP);
        }, 50);
      }
      setScheduleAutoScrollBlink(true);
      if (scheduleAutoScrollBlinkTimeoutRef.current) clearTimeout(scheduleAutoScrollBlinkTimeoutRef.current);
      scheduleAutoScrollBlinkTimeoutRef.current = setTimeout(() => setScheduleAutoScrollBlink(false), 350);
    });
    const draggedSet = new Set(taskIds);
    const onMove = (e: PointerEvent) => {
      lastPointerY = e.clientY;
      setDragPreviewPosition({ x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let node: Element | null = el;
      let found: number | null = null;
      while (node) {
        const tid = node.getAttribute('data-task-id');
        if (tid) {
          const id = parseInt(tid, 10);
          if (!draggedSet.has(id)) found = id;
          break;
        }
        node = node.parentElement;
      }
      setHoverDropTaskId((prev) => (prev !== found ? found : prev));
      let zone: 'unassigned' | 'pending' | null = null;
      node = el;
      while (node) {
        const z = node.getAttribute('data-drop-zone');
        if (z === 'unassigned' || z === 'pending') {
          const src = info.source;
          const canUnassigned =
            src === 'pending' ||
            src === 'schedule' ||
            src === 'common' ||
            (src === 'unassigned' && taskIds.some((id) => tasks.find((t) => t.id === id)?.parent_id != null));
          const canPending = src === 'unassigned' || src === 'schedule' || src === 'common';
          if (z === 'unassigned' && canUnassigned) zone = 'unassigned';
          else if (z === 'pending' && canPending) zone = 'pending';
          break;
        }
        node = node.parentElement;
      }
      setDropZoneHighlight((prev) => (prev !== zone ? zone : prev));
      let overUntimed = false;
      node = el;
      while (node) {
        if (node.getAttribute('data-schedule-drop-untimed') === 'true') {
          overUntimed = true;
          break;
        }
        node = node.parentElement;
      }
      const scheduleDropAllowed = viewDate >= today();
      if (scheduleDropAllowed) {
        if (overUntimed) {
          scheduleDropStartMinRef.current = null;
          setScheduleDropGhostMin(null);
          setScheduleDropUntimedHighlight(true);
        } else {
          setScheduleDropUntimedHighlight(false);
          const scheduleBlocks = document.querySelector('.time-view-blocks') as HTMLElement | null;
          if (scheduleBlocks) {
            const rect = scheduleBlocks.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
              const relativeY = e.clientY - rect.top + scheduleBlocks.scrollTop;
              const slotIndex = Math.max(0, Math.floor(relativeY / ROW_HEIGHT));
              const startMin = viewStartMinutes + slotIndex * slotDurationMinutes;
              const snapped = snapToSlot(startMin, settings.start_hour, settings.end_hour, slotDurationMinutes);
              const viewEndMin = settings.end_hour * 60;
              const ghostMin = Math.min(snapped, viewEndMin - slotDurationMinutes);
              scheduleDropStartMinRef.current = ghostMin;
              setScheduleDropGhostMin(ghostMin);
            } else {
              scheduleDropStartMinRef.current = null;
              setScheduleDropGhostMin(null);
            }
          } else {
            scheduleDropStartMinRef.current = null;
            setScheduleDropGhostMin(null);
          }
        }
      } else {
        setScheduleDropUntimedHighlight(false);
        scheduleDropStartMinRef.current = null;
        setScheduleDropGhostMin(null);
      }
      const scheduleScroll = document.querySelector('.left-bottom .schedule-content') as HTMLElement | null;
      if (scheduleScroll && scheduleScroll.scrollHeight > scheduleScroll.clientHeight) {
        const rect = scheduleScroll.getBoundingClientRect();
        const inScheduleX = e.clientX >= rect.left && e.clientX <= rect.right;
        const atTopEdge = inScheduleX && e.clientY <= rect.top + EDGE_ZONE;
        const atBottomEdge = inScheduleX && e.clientY >= rect.bottom - EDGE_ZONE;
        const edgeActive = atTopEdge || atBottomEdge;
        if (edgeActive) {
          scheduleScrollEl = scheduleScroll;
          if (!scheduleScrollInterval) delayedScheduleAutoscroll.onEdge();
        } else {
          delayedScheduleAutoscroll.onLeave();
          if (scheduleScrollInterval) {
            clearInterval(scheduleScrollInterval);
            scheduleScrollInterval = null;
          }
          scheduleScrollEl = null;
        }
      }
      node = el;
      while (node && node !== document.body) {
        const container = node as HTMLElement;
        const style = window.getComputedStyle(container);
        const overflowY = style.overflowY || style.overflow;
        if ((overflowY === 'auto' || overflowY === 'scroll') && container.scrollHeight > container.clientHeight) {
          scrollScrollable(container, e.clientY, SCROLL_STEP);
        }
        node = node.parentElement;
      }
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      if (scheduleScrollInterval) {
        clearInterval(scheduleScrollInterval);
        scheduleScrollInterval = null;
      }
      delayedScheduleAutoscroll.onLeave();
      setHoverDropTaskId(null);
      setDropZoneHighlight(null);
      setScheduleDropGhostMin(null);
      handlePointerUpDrop(e);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
  }, [handlePointerUpDrop, viewDate, viewStartMinutes, settings.start_hour, settings.end_hour, slotDurationMinutes]);

  const startBulkScheduleMoveHold = useCallback(
    (anchorTaskId: number, clientX: number, clientY: number) => {
      if (viewDate < today()) return;
      if (holdTimeoutRef.current) return;
      const rootSlotIds = Array.from(selectedScheduleRootSlotIds)
        .filter((id) => id > 0)
        .sort((a, b) => {
          const sa = slots.find((s) => s.id === a);
          const sb = slots.find((s) => s.id === b);
          if (!sa || !sb) return a - b;
          return timeToMinutes(sa.start_time) - timeToMinutes(sb.start_time) || a - b;
        });
      const taskIds = rootSlotIds
        .map((rid) => slots.find((s) => s.id === rid)?.task_id)
        .filter((id): id is number => id != null);
      if (taskIds.length === 0 || !taskIds.includes(anchorTaskId)) return;
      holdPointerRef.current = { taskIds, source: 'schedule', clientX, clientY, anchorTaskId };
      const cancelIfMoved = (e: PointerEvent) => {
        if (
          holdPointerRef.current &&
          (Math.abs(e.clientX - holdPointerRef.current.clientX) > MOVE_THRESHOLD ||
            Math.abs(e.clientY - holdPointerRef.current.clientY) > MOVE_THRESHOLD)
        ) {
          cancelHold();
        }
      };
      const onPointerUp = () => {
        cancelHold();
      };
      cancelMoveRef.current = cancelIfMoved;
      cancelUpRef.current = onPointerUp;
      window.addEventListener('pointermove', cancelIfMoved);
      window.addEventListener('pointerup', onPointerUp);
      holdTimeoutRef.current = setTimeout(() => {
        holdPointerRef.current?.onHoldStart?.();
        enterDragMode();
      }, HOLD_MS);
    },
    [cancelHold, enterDragMode, selectedScheduleRootSlotIds, slots, viewDate]
  );

  const startHold = useCallback(
    (taskId: number, source: 'unassigned' | 'pending' | 'schedule' | 'common', clientX: number, clientY: number, onHoldStart?: () => void) => {
      if (source === 'schedule' && scheduleBulkMode && !scheduleBulkMoveMode) return;
      if (source === 'schedule' && viewDate < today()) return;
      if (holdTimeoutRef.current) return;
      const task = tasks.find((t) => t.id === taskId);
      const isRootGroupMember = source !== 'schedule' && !!task && task.parent_id == null && getChildTaskIds(taskId).length > 0;
      const taskIds = selectedTaskIds.has(taskId) ? Array.from(selectedTaskIds) : isRootGroupMember ? [taskId, ...getChildTaskIds(taskId)] : [taskId];
      holdPointerRef.current = { taskIds, source, clientX, clientY, onHoldStart };
      const cancelIfMoved = (e: PointerEvent) => {
        if (
          holdPointerRef.current &&
          (Math.abs(e.clientX - holdPointerRef.current.clientX) > MOVE_THRESHOLD ||
            Math.abs(e.clientY - holdPointerRef.current.clientY) > MOVE_THRESHOLD)
        ) {
          cancelHold();
        }
      };
      const onPointerUp = () => {
        cancelHold();
      };
      cancelMoveRef.current = cancelIfMoved;
      cancelUpRef.current = onPointerUp;
      window.addEventListener('pointermove', cancelIfMoved);
      window.addEventListener('pointerup', onPointerUp);
      holdTimeoutRef.current = setTimeout(() => {
        holdPointerRef.current?.onHoldStart?.();
        enterDragMode();
      }, HOLD_MS);
    },
    [cancelHold, enterDragMode, selectedTaskIds, tasks, getChildTaskIds, viewDate, scheduleBulkMode, scheduleBulkMoveMode]
  );

  const goPrev = () => {
    const d = new Date(viewDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setViewDate(d.toISOString().slice(0, 10));
  };
  const goNext = () => {
    const d = new Date(viewDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    setViewDate(d.toISOString().slice(0, 10));
  };
  const isToday = viewDate === today();
  const scheduleDayPast = viewDate < today();

  const rootSlots = slots.filter((s) => !s.parent_id || !slots.some((o) => o.task_id === s.parent_id));
  const timedRootSlots = rootSlots.filter(slotHasTime);
  const untimedRootSlots = rootSlots.filter((s) => !slotHasTime(s));
  const childSlotsByParent = new Map<number, ScheduledSlot[]>();
  rootSlots.forEach((s) => {
    const children = slots.filter((c) => c.parent_id === s.task_id);
    if (children.length) childSlotsByParent.set(s.task_id, children);
  });
  const timedFeedForOverlap = feedEvents
    .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, settings.timezone) === viewDate)
    .map((e) => {
      const local = icalEventToLocal(e.start, e.end, false, settings.timezone);
      return { key: 'feed-' + (e.id ?? e.uid + e.start), startMin: local.localStartMinutes, endMin: local.localEndMinutes };
    });
  const allBlocks = [
    ...timedRootSlots.map((slot) => ({ key: slot.id as number, startMin: timeToMinutes(slot.start_time), endMin: timeToMinutes(slot.end_time) })),
    ...timedFeedForOverlap,
  ];
  const slotOverlapInfo = new Map<number, { col: number; total: number }>();
  const feedOverlapInfo = new Map<string, { col: number; total: number }>();
  allBlocks.forEach((block) => {
    const overlapping = allBlocks.filter((o) => o.startMin < block.endMin && o.endMin > block.startMin);
    const sorted = [...overlapping].sort((a, b) => a.startMin - b.startMin);
    const col = sorted.findIndex((o) => o.key === block.key);
    const info = { col: col >= 0 ? col : 0, total: sorted.length };
    if (typeof block.key === 'number') slotOverlapInfo.set(block.key, info);
    else feedOverlapInfo.set(block.key, info);
  });

  const untimedFeedEvents = feedEvents.filter(
    (e) => e.allDay && (icalEventLocalStartDate(e.start, true, settings.timezone) === viewDate || e.start.startsWith(viewDate))
  );

  const toggleScheduleRootInSelection = useCallback(
    (slotId: number) => {
      if (slotId < 1) return;
      const rootId = resolveScheduleRootSlotId(slots, slotId);
      setSelectedScheduleRootSlotIds((prev) => {
        const next = new Set(prev);
        if (next.has(rootId)) next.delete(rootId);
        else next.add(rootId);
        return next;
      });
    },
    [slots]
  );

  const exitScheduleBulkMode = useCallback(() => {
    setScheduleBulkMode(false);
    setScheduleBulkMoveMode(false);
    setSelectedScheduleRootSlotIds(new Set());
    setScheduleBulkRescheduleOpen(false);
    setScheduleBulkPriorityOpen(false);
  }, []);

  const runBulkUnassignOrPending = useCallback(
    async (listState: 'unassigned' | 'pending') => {
      const ids = Array.from(selectedScheduleRootSlotIds);
      if (ids.length === 0) return;
      try {
        const day = await api.day.getOrCreate(viewDate);
        if (day.id == null) return;
        for (const rootSlotId of ids) {
          const root = slots.find((s) => s.id === rootSlotId);
          if (!root || root.day_record_id !== day.id) continue;
          const childIds = slots.filter((c) => c.parent_id === root.task_id && c.day_record_id === day.id).map((c) => c.id);
          const toDel = [root.id, ...childIds].filter((id) => id > 0);
          await Promise.all(toDel.map((id) => api.slots.delete(id)));
          await api.tasks.update({ id: root.task_id, list_state: listState });
        }
        exitScheduleBulkMode();
        loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        loadData();
      }
    },
    [selectedScheduleRootSlotIds, slots, viewDate, loadData, exitScheduleBulkMode]
  );

  const runBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedScheduleRootSlotIds);
    if (ids.length === 0 || !confirm(`Delete ${ids.length} scheduled task(s)?`)) return;
    try {
      const day = await api.day.getOrCreate(viewDate);
      if (day.id == null) return;
      for (const rootSlotId of ids) {
        const root = slots.find((s) => s.id === rootSlotId);
        if (!root || root.day_record_id !== day.id) continue;
        const childIds = slots.filter((c) => c.parent_id === root.task_id && c.day_record_id === day.id).map((c) => c.id);
        const toDel = [root.id, ...childIds].filter((id) => id > 0);
        await Promise.all(toDel.map((id) => api.slots.delete(id)));
        await api.tasks.delete(root.task_id);
      }
      exitScheduleBulkMode();
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      loadData();
    }
  }, [selectedScheduleRootSlotIds, slots, viewDate, loadData, exitScheduleBulkMode]);

  const runBulkSetPriority = useCallback(
    async (p: Priority) => {
      const ids = Array.from(selectedScheduleRootSlotIds);
      if (ids.length === 0) return;
      try {
        const day = await api.day.getOrCreate(viewDate);
        if (day.id == null) return;
        const taskIds = new Set<number>();
        for (const rootSlotId of ids) {
          const root = slots.find((s) => s.id === rootSlotId);
          if (!root || root.day_record_id !== day.id) continue;
          taskIds.add(root.task_id);
          slots.filter((c) => c.parent_id === root.task_id && c.day_record_id === day.id).forEach((c) => taskIds.add(c.task_id));
        }
        await Promise.all(Array.from(taskIds).map((tid) => api.tasks.update({ id: tid, priority: p })));
        setScheduleBulkPriorityOpen(false);
        exitScheduleBulkMode();
        loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        loadData();
      }
    },
    [selectedScheduleRootSlotIds, slots, viewDate, loadData, exitScheduleBulkMode]
  );

  const runBulkGroup = useCallback(async () => {
    const ids = Array.from(selectedScheduleRootSlotIds);
    if (ids.length < 2) {
      setError('Select at least two tasks to group');
      return;
    }
    try {
      const day = await api.day.getOrCreate(viewDate);
      if (day.id == null) return;
      const roots = ids
        .map((id) => slots.find((s) => s.id === id))
        .filter((s): s is ScheduledSlot => !!s && s.day_record_id === day.id && slotHasTime(s))
        .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
      if (roots.length < 2) return;
      const parentTaskId = roots[0]!.task_id;
      let order = 0;
      for (let i = 1; i < roots.length; i++) {
        await api.tasks.update({ id: roots[i]!.task_id, parent_id: parentTaskId, group_order: order++ });
      }
      exitScheduleBulkMode();
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      loadData();
    }
  }, [selectedScheduleRootSlotIds, slots, viewDate, loadData, exitScheduleBulkMode]);

  const runBulkReorderBy = useCallback(
    async (by: 'priority' | 'title') => {
      const ids = Array.from(selectedScheduleRootSlotIds);
      if (ids.length === 0) return;
      try {
        const day = await api.day.getOrCreate(viewDate);
        if (day.id == null) return;
        const roots = ids
          .map((id) => slots.find((s) => s.id === id))
          .filter((s): s is ScheduledSlot => !!s && s.day_record_id === day.id && slotHasTime(s));
        const ranked = roots.slice().sort((a, b) => {
          if (by === 'title') {
            const ta = (a.title ?? tasks.find((t) => t.id === a.task_id)?.title ?? '').localeCompare(
              b.title ?? tasks.find((t) => t.id === b.task_id)?.title ?? '',
              undefined,
              { sensitivity: 'base' }
            );
            return ta;
          }
          const pa = priorityRank((tasks.find((t) => t.id === a.task_id)?.priority ?? (a.priority as Priority) ?? 'low') as Priority);
          const pb = priorityRank((tasks.find((t) => t.id === b.task_id)?.priority ?? (b.priority as Priority) ?? 'low') as Priority);
          return pa - pb;
        });
        await Promise.all(ranked.map((s, idx) => api.slots.update({ id: s.id, order_index: idx })));
        exitScheduleBulkMode();
        loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        loadData();
      }
    },
    [selectedScheduleRootSlotIds, slots, viewDate, tasks, loadData, exitScheduleBulkMode]
  );

  const runBulkReschedule = useCallback(async () => {
    const dateStr = scheduleBulkRescheduleDate.trim();
    const ids = Array.from(selectedScheduleRootSlotIds);
    if (!dateStr || ids.length === 0) return;
    try {
      const oldDay = await api.day.getOrCreate(viewDate);
      const newDay = await api.day.getOrCreate(dateStr);
      if (oldDay.id == null || newDay.id == null) return;
      for (const rootSlotId of ids) {
        const root = slots.find((s) => s.id === rootSlotId);
        if (!root || root.day_record_id !== oldDay.id || !slotHasTime(root)) continue;
        const childSlotsOrdered = slots
          .filter((c) => c.parent_id === root.task_id && c.day_record_id === oldDay.id)
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
        const memberSlots = [root, ...childSlotsOrdered];
        const startMin = timeToMinutes(root.start_time);
        const endMin = timeToMinutes(root.end_time);
        const memberCount = memberSlots.length;
        const memberTimes = distributeGroupMemberTimes({
          groupStartMin: startMin,
          groupEndMin: endMin,
          slotDurationMinutes,
          memberCount,
        });
        const oldIds = memberSlots.map((s) => s.id).filter((id) => id > 0);
        await Promise.all(oldIds.map((id) => api.slots.delete(id)));
        await Promise.all(
          memberSlots.map((ms, idx) =>
            api.slots.create({
              day_record_id: newDay.id,
              task_id: ms.task_id,
              start_time: minutesToTime(idx === 0 ? startMin : memberTimes[idx].startMin),
              end_time: minutesToTime(idx === 0 ? endMin : memberTimes[idx].endMin),
              order_index: idx,
            })
          )
        );
      }
      setScheduleBulkRescheduleOpen(false);
      setScheduleBulkRescheduleDate('');
      exitScheduleBulkMode();
      if (dateStr !== viewDate) setViewDate(dateStr);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      loadData();
    }
  }, [
    scheduleBulkRescheduleDate,
    selectedScheduleRootSlotIds,
    slots,
    viewDate,
    slotDurationMinutes,
    loadData,
    exitScheduleBulkMode,
    setViewDate,
  ]);

  const draggingSubtaskFromUnassigned =
    !!dragState &&
    dragState.source === 'unassigned' &&
    (dragState.taskIds ?? [dragState.taskId]).some((id) => tasks.find((t) => t.id === id)?.parent_id != null);
  const unassignedDropValid =
    !!dragState &&
    (dragState.source === 'pending' ||
      dragState.source === 'schedule' ||
      dragState.source === 'common' ||
      draggingSubtaskFromUnassigned);
  const pendingDropValid =
    !!dragState &&
    (dragState.source === 'unassigned' || dragState.source === 'schedule' || dragState.source === 'common');

  const hasUnassigned = unassigned.length > 0 || unassignedDropValid;
  const hasPending = pending.length > 0 || pendingDropValid;
  const visibleTaskSlideIndices = useMemo(() => {
    if (isMobile) return [0, 1, 2];
    const v: number[] = [];
    if (hasUnassigned) v.push(0);
    if (hasPending) v.push(1);
    return v;
  }, [isMobile, hasUnassigned, hasPending]);

  const maxTaskSlideIndex = Math.max(0, visibleTaskSlideIndices.length - 1);
  const clampedTaskSlideIndex = Math.min(taskSlideIndex, maxTaskSlideIndex);
  const currentSectionIndex = visibleTaskSlideIndices[clampedTaskSlideIndex] ?? 0;

  const taskSlideStateRef = useRef({ clampedTaskSlideIndex, maxTaskSlideIndex, visibleLength: visibleTaskSlideIndices.length });
  taskSlideStateRef.current = { clampedTaskSlideIndex, maxTaskSlideIndex, visibleLength: visibleTaskSlideIndices.length };
  const scheduleTabRef = useRef(scheduleTab);
  scheduleTabRef.current = scheduleTab;

  const bindScheduleContentDrag = useDrag(
    ({ movement: [mx], velocity: [vx], last }) => {
      if (!last || !isMobile) return;
      const tab = scheduleTabRef.current;
      const threshold = SWIPE_THRESHOLD;
      const minVelocity = 0.2;
      if (mx > threshold || vx > minVelocity) {
        if (tab === 'calendar') setScheduleTab('today');
        else onMainSlideChange?.(0);
      } else if (mx < -threshold || vx < -minVelocity) {
        if (tab === 'today') setScheduleTab('calendar');
        else if (aiEnabled) onMainSlideChange?.(2);
      }
    },
    { axis: 'x', pointer: { touch: true }, touch: true, filter: () => isMobile }
  );

  const bindTaskSectionsDrag = useDrag(
    ({ movement: [mx], velocity: [vx], last }) => {
      if (!last || !isMobile) return;
      const { clampedTaskSlideIndex: cur, maxTaskSlideIndex: max, visibleLength } = taskSlideStateRef.current;
      if (visibleLength === 0) return;
      const threshold = SWIPE_THRESHOLD;
      const minVelocity = 0.2;
      if (mx > threshold || vx > minVelocity) {
        if (cur === 0) {
          onMainSlideChange?.(0);
        } else {
          setTaskSlideIndex((i) => Math.max(0, i - 1));
        }
      } else if (mx < -threshold || vx < -minVelocity) {
        if (cur >= max) {
          if (aiEnabled) onMainSlideChange?.(2);
        } else {
          setTaskSlideIndex((i) => Math.min(max, i + 1));
        }
      }
    },
    {
      axis: 'x',
      pointer: { touch: true },
      touch: true,
      filter: () => isMobile,
    }
  );

  const dragTitle = dragState
    ? (dragState.taskIds.length > 1
        ? `${dragState.taskIds.length} tasks`
        : (tasks.find((t) => t.id === dragState.taskId)?.title ?? slots.find((s) => s.task_id === dragState.taskId)?.title ?? 'Task'))
    : '';

  return (
    <>
      {isMobile && adminDebug && showDebugOverlays && (
        <div className="debug-swipe-overlays" aria-hidden>
          <div className="debug-swipe-overlay debug-swipe-edge-left" style={{ left: 0, width: PANEL_EDGE_BUFFER_PX, top: 0, bottom: 0 }} />
          <div className="debug-swipe-overlay debug-swipe-edge-right" style={{ right: 0, width: PANEL_EDGE_BUFFER_PX, top: 0, bottom: 0 }} />
          {debugZoneRects.task && (
            <div
              className="debug-swipe-overlay debug-swipe-zone-task"
              style={{
                position: 'fixed',
                left: debugZoneRects.task.left,
                top: debugZoneRects.task.top,
                width: debugZoneRects.task.width,
                height: debugZoneRects.task.height,
              }}
            />
          )}
          {debugZoneRects.schedule && (
            <div
              className="debug-swipe-overlay debug-swipe-zone-schedule"
              style={{
                position: 'fixed',
                left: debugZoneRects.schedule.left,
                top: debugZoneRects.schedule.top,
                width: debugZoneRects.schedule.width,
                height: debugZoneRects.schedule.height,
              }}
            />
          )}
        </div>
      )}
      <CompletedPanel
        open={isMobile ? mainSlideIndex === 0 : undefined}
        onClose={isMobile ? () => onMainSlideChange?.(1) : undefined}
      />
      {dragState && dragPreviewPosition && (
        <div
          className="drag-preview-floating"
          style={{
            position: 'fixed',
            left: dragPreviewPosition.x,
            top: dragPreviewPosition.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          {dragTitle}
        </div>
      )}
      {lastUndoable && (
        <div className="undo-bar" style={{ position: 'fixed', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9998 }}>
          <button
            type="button"
            className="undo-btn"
            onClick={() => {
              lastUndoable.revert().then(() => setLastUndoable(null)).catch((err) => setError(err instanceof Error ? err.message : String(err)));
              if (undoTimeoutRef.current) {
                clearTimeout(undoTimeoutRef.current);
                undoTimeoutRef.current = null;
              }
            }}
          >
            Undo
          </button>
        </div>
      )}
      {openPrioritySlotId != null &&
        schedulePriorityPickerPosition != null &&
        (() => {
          const openSlot = slots.find((s) => s.id === openPrioritySlotId);
          if (!openSlot) return null;
          return createPortal(
            <div
              className="priority-picker time-block-priority-picker-floating"
              role="listbox"
              style={{
                position: 'fixed',
                top: schedulePriorityPickerPosition.top,
                left: schedulePriorityPickerPosition.left,
                zIndex: 10000,
              }}
            >
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={'priority-picker-option ' + (openSlot.priority === p ? 'selected' : '') + ' priority-' + p}
                  onClick={() => {
                    api.tasks.update({ id: openSlot.task_id, priority: p }).then(loadData);
                    setOpenPrioritySlotId(null);
                    setSchedulePriorityPickerPosition(null);
                  }}
                >
                  {priorityLabel(p)} {priorityIcon(p)}
                </button>
              ))}
            </div>,
            document.body
          );
        })()}
      <div className="panel-slide panel-slide-tasks">
        <div className="panel-slide-tasks-left">
          <div className="left-main" ref={leftMainRef}>
          <div
            className="left-top"
            style={
              isMobile
                ? {
                    height: (() => {
                      const n =
                        currentSectionIndex === 0
                          ? unassigned.length
                          : currentSectionIndex === 1
                            ? pending.length
                            : commonFiltered.length;
                      const h = TASK_VIEW_HEADER_ESTIMATE_PX + n * TASK_ROW_ESTIMATE_PX;
                      const capped = Math.max(TASK_VIEW_MIN_PX, Math.min(taskViewHeightPx, h));
                      return capped;
                    })(),
                    flex: '0 0 auto',
                    minHeight: TASK_VIEW_MIN_PX,
                    maxHeight: taskViewHeightPx,
                    transition: 'height 0.25s ease-out',
                  }
                : { height: taskViewHeightPx, flex: `0 0 ${taskViewHeightPx}px`, minHeight: TASK_VIEW_MIN_PX }
            }
          >
            <div className="add-task-row" style={{ marginBottom: '0.35rem' }}>
              <input
                type="text"
                placeholder="New task…"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              />
              <button type="button" className="add-task-btn" onClick={handleAddTask} disabled={!newTaskTitle.trim()}>
                Add
              </button>
            </div>
            <div className="task-list-sort-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                Order by
                <select
                  value={orderBy}
                  onChange={(e) => setOrderBy(e.target.value as 'title' | 'priority' | 'date_added')}
                  style={{ padding: '0.2rem 0.4rem' }}
                >
                  <option value="title">Title</option>
                  <option value="priority">Priority</option>
                  <option value="date_added">Date Added</option>
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flex: '1 1 auto', minWidth: 0 }}>
                <span className="task-search-icon" aria-hidden style={{ opacity: 0.7 }}>🔍</span>
                <input
                  type="text"
                  placeholder="Search tasks, links, list items…"
                  value={taskSearchQuery}
                  onChange={(e) => setTaskSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.3rem 0.45rem',
                    fontSize: 'var(--task-title-font-size)',
                    lineHeight: 1.25,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: '4px',
                    minHeight: '28px',
                    height: 'auto',
                    boxSizing: 'border-box',
                    minWidth: 0,
                  }}
                />
                {taskSearchQuery.trim() && (
                  <button type="button" className="add-task-btn" style={{ flex: '0 0 auto', height: '28px' }} onClick={() => setTaskSearchQuery('')}>
                    Clear
                  </button>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <select
                  value={orderDir}
                  onChange={(e) => setOrderDir(e.target.value as 'asc' | 'desc')}
                  style={{ padding: '0.2rem 0.4rem' }}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>
            <div
              id="task-list-sections"
              className={
                'task-list-sections task-swipe-zone' +
                (isMobile && visibleTaskSlideIndices.length > 0
                  ? ` task-slides-${visibleTaskSlideIndices.length} mobile-task-slide-${clampedTaskSlideIndex}`
                  : '') +
                (isMobile ? ' task-swipe-zone-active' : '')
              }
              ref={taskListScrollRef}
              style={{ position: 'relative' }}
              {...(isMobile ? bindTaskSectionsDrag() : {})}
            >
              {(!initialDataReady || loading) && (
                <div className="loading-overlay">
                  <div className="loading-spinner" aria-hidden />
                </div>
              )}
              {initialDataReady && !loading && error && (
                <p className="task-list-error" style={{ padding: '0.5rem' }}>{error}</p>
              )}
              {initialDataReady && !loading && !error && (isMobile || unassigned.length > 0 || unassignedDropValid) && (
                <div
                  className={'task-list-section' + (unassignedDropValid ? ' task-list-section-drop-zone' : '') + (isMobile && !hasUnassigned ? ' task-list-section-hidden' : '')}
                  data-drop-zone="unassigned"
                >
                  <div className="task-list-section-title">Unassigned</div>
                  <div className="task-list-scroll">
                    <ul className="task-list">
                      {dropZoneHighlight === 'unassigned' && dragState && (
                        <li className="drop-zone-placeholder" aria-hidden="true">
                          {dragState.taskIds.length > 1
                            ? `Drop ${dragState.taskIds.length} tasks here`
                            : (tasks.find((t) => t.id === dragState!.taskId)?.title ?? slots.find((s) => s.task_id === dragState!.taskId)?.title ?? 'Drop here')}
                        </li>
                      )}
                      {unassignedFiltered.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          tasks={tasks}
                          links={taskLinksByTaskId[t.id] ?? []}
                          listItems={taskListItemsByTaskId[t.id] ?? []}
                          dragSource="unassigned"
                          draggingTaskId={draggingTaskId}
                          draggingTaskIds={draggingTaskIds}
                          isDragging={draggingTaskIds.has(t.id)}
                          isDropTarget={hoverDropTaskId === t.id}
                          isSelected={selectedTaskIds.has(t.id)}
                          onToggleSelect={toggleTaskSelection}
                          onHoldStart={(e) => startHold(t.id, 'unassigned', e.clientX, e.clientY)}
                          onHoldStartGroupMember={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'unassigned', e.clientX, e.clientY); }}
                          editingTaskId={editingTaskId}
                          editingTitle={editingTitle}
                          onEditingTitleChange={setEditingTitle}
                          onEditStart={(id, title) => {
                            setEditingTaskId(id);
                            setEditingTitle(title);
                          }}
                          onEditSave={(id, title) => {
                            api.tasks.update({ id, title }).then(loadData);
                            setEditingTaskId(null);
                          }}
                          onEditCancel={() => setEditingTaskId(null)}
                          onPriorityChange={(id, p) => api.tasks.update({ id, priority: p }).then(loadData)}
                          onUngroupGroup={handleUngroupGroup}
                          onRecurringToggle={(id) => {
                            const task = tasks.find((x) => x.id === id) ?? t;
                            let rule: { freq: string; time?: string; weekDays?: number[]; monthDays?: number[]; lastDayOfMonth?: boolean; count?: number; startDate?: string } = { freq: 'daily', time: '09:00' };
                            try {
                              if (task?.recurrence_rule) rule = { ...rule, ...JSON.parse(task.recurrence_rule) };
                            } catch {}
                            setRecurringConfigModal({
                              taskId: id,
                              recurring: !!task.recurring,
                              freq: (rule.freq as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
                              time: rule.time ?? '09:00',
                              weekDays: rule.weekDays ?? [],
                              monthDays: rule.monthDays ?? [],
                              lastDayOfMonth: !!rule.lastDayOfMonth,
                              count: rule.count,
                              startDate: rule.startDate ?? (task.created_at ? task.created_at.slice(0, 10) : viewDate),
                            });
                          }}
                          onMoveToPending={undefined}
                          onMoveToUnassigned={undefined}
                          onScheduleDate={(id) => {
                            setScheduleDateTaskId(id);
                            setScheduleDateValue(viewDate);
                            setScheduleSlotIdToReplace(null);
                            setScheduleDueAutoPriority(false);
                            setScheduleDateOpen(true);
                          }}
                          onDelete={(id) => {
                            if (confirm('Delete this task?')) api.tasks.delete(id).then(loadData);
                          }}
                          onOpenLinks={(id, initialUrl) => {
                            setLinkModalTaskId(id);
                            setLinkModalInitialUrl(initialUrl ?? '');
                          }}
                          onOpenList={(id) => { setListModalTaskId(id); }}
                          onRefresh={handleRefresh}
                          onTaskPatched={mergeTaskFromPatch}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
                          organizationCategories={organizationCategories}
                          organizationSubcategories={organizationSubcategories}
                          organizationTags={organizationTags}
                          onOpenOrganization={(id) => setOrganizationModalTaskId(id)}
                          onTaskUpdate={loadData}
                          onSetIsCommon={
                            !t.parent_id && tasks.filter((x) => x.parent_id === t.id).length === 0 && !t.is_common
                              ? (id, isCommon) => api.tasks.update({ id, is_common: isCommon }).then(loadData)
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {initialDataReady && !loading && !error && (isMobile || pending.length > 0 || pendingDropValid) && (
                <div
                  className={'task-list-section' + (pendingDropValid ? ' task-list-section-drop-zone' : '') + (isMobile && !hasPending ? ' task-list-section-hidden' : '')}
                  data-drop-zone="pending"
                >
                  <div className="task-list-section-title">Pending</div>
                  <div className="task-list-scroll">
                    <ul className="task-list">
                      {dropZoneHighlight === 'pending' && dragState && (
                        <li className="drop-zone-placeholder" aria-hidden="true">
                          {dragState.taskIds.length > 1
                            ? `Drop ${dragState.taskIds.length} tasks here`
                            : (tasks.find((t) => t.id === dragState!.taskId)?.title ?? slots.find((s) => s.task_id === dragState!.taskId)?.title ?? 'Drop here')}
                        </li>
                      )}
                      {pendingFiltered.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          tasks={tasks}
                          links={taskLinksByTaskId[t.id] ?? []}
                          listItems={taskListItemsByTaskId[t.id] ?? []}
                          dragSource="pending"
                          draggingTaskId={draggingTaskId}
                          draggingTaskIds={draggingTaskIds}
                          isDragging={draggingTaskIds.has(t.id)}
                          isDropTarget={hoverDropTaskId === t.id}
                          isSelected={selectedTaskIds.has(t.id)}
                          onToggleSelect={toggleTaskSelection}
                          onHoldStart={(e) => startHold(t.id, 'pending', e.clientX, e.clientY)}
                          onHoldStartGroupMember={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'pending', e.clientX, e.clientY); }}
                          editingTaskId={editingTaskId}
                          editingTitle={editingTitle}
                          onEditingTitleChange={setEditingTitle}
                          onEditStart={(id, title) => {
                            setEditingTaskId(id);
                            setEditingTitle(title);
                          }}
                          onEditSave={(id, title) => {
                            api.tasks.update({ id, title }).then(loadData);
                            setEditingTaskId(null);
                          }}
                          onEditCancel={() => setEditingTaskId(null)}
                          onPriorityChange={(id, p) => api.tasks.update({ id, priority: p }).then(loadData)}
                          onUngroupGroup={handleUngroupGroup}
                          onRecurringToggle={(id) => {
                            const task = tasks.find((x) => x.id === id) ?? t;
                            let rule: { freq: string; time?: string; weekDays?: number[]; monthDays?: number[]; lastDayOfMonth?: boolean; count?: number; startDate?: string } = { freq: 'daily', time: '09:00' };
                            try {
                              if (task?.recurrence_rule) rule = { ...rule, ...JSON.parse(task.recurrence_rule) };
                            } catch {}
                            setRecurringConfigModal({
                              taskId: id,
                              recurring: !!task.recurring,
                              freq: (rule.freq as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
                              time: rule.time ?? '09:00',
                              weekDays: rule.weekDays ?? [],
                              monthDays: rule.monthDays ?? [],
                              lastDayOfMonth: !!rule.lastDayOfMonth,
                              count: rule.count,
                              startDate: rule.startDate ?? (task.created_at ? task.created_at.slice(0, 10) : viewDate),
                            });
                          }}
                          onMoveToPending={undefined}
                          onMoveToUnassigned={undefined}
                          onScheduleDate={(id) => {
                            setScheduleDateTaskId(id);
                            setScheduleDateValue(viewDate);
                            setScheduleDueAutoPriority(false);
                            setScheduleDateOpen(true);
                          }}
                          onDelete={(id) => {
                            if (confirm('Delete this task?')) api.tasks.delete(id).then(loadData);
                          }}
                          onOpenLinks={(id, initialUrl) => {
                            setLinkModalTaskId(id);
                            setLinkModalInitialUrl(initialUrl ?? '');
                          }}
                          onOpenList={(id) => { setListModalTaskId(id); }}
                          onRefresh={handleRefresh}
                          onTaskPatched={mergeTaskFromPatch}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
                          organizationCategories={organizationCategories}
                          organizationSubcategories={organizationSubcategories}
                          organizationTags={organizationTags}
                          onOpenOrganization={(id) => setOrganizationModalTaskId(id)}
                          onTaskUpdate={loadData}
                          onSetIsCommon={
                            !t.parent_id && tasks.filter((x) => x.parent_id === t.id).length === 0 && !t.is_common
                              ? (id, isCommon) => api.tasks.update({ id, is_common: isCommon }).then(loadData)
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {initialDataReady && !loading && !error && (
                <div className="task-list-section">
                  <div className="task-list-section-title">Common Tasks</div>
                  <div className="add-task-row" style={{ marginBottom: '0.35rem' }}>
                    <input
                      type="text"
                      placeholder="New template…"
                      value={newCommonTaskTitle}
                      onChange={(e) => setNewCommonTaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCommonTask()}
                    />
                    <button type="button" className="add-task-btn" onClick={handleAddCommonTask} disabled={!newCommonTaskTitle.trim()}>
                      Add
                    </button>
                  </div>
                  <div className="task-list-scroll">
                    <ul className="task-list">
                      {commonFiltered.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          tasks={tasks}
                          links={taskLinksByTaskId[t.id] ?? []}
                          listItems={taskListItemsByTaskId[t.id] ?? []}
                          dragSource="common"
                          draggingTaskId={draggingTaskId}
                          draggingTaskIds={draggingTaskIds}
                          isDragging={draggingTaskIds.has(t.id)}
                          isDropTarget={hoverDropTaskId === t.id}
                          isSelected={selectedTaskIds.has(t.id)}
                          onToggleSelect={toggleTaskSelection}
                          onHoldStart={(e) => startHold(t.id, 'common', e.clientX, e.clientY)}
                          onHoldStartGroupMember={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'common', e.clientX, e.clientY); }}
                          editingTaskId={editingTaskId}
                          editingTitle={editingTitle}
                          onEditingTitleChange={setEditingTitle}
                          onEditStart={(id, title) => {
                            setEditingTaskId(id);
                            setEditingTitle(title);
                          }}
                          onEditSave={(id, title) => {
                            api.tasks.update({ id, title }).then(loadData);
                            setEditingTaskId(null);
                          }}
                          onEditCancel={() => setEditingTaskId(null)}
                          onPriorityChange={(id, p) => api.tasks.update({ id, priority: p }).then(loadData)}
                          onUngroupGroup={handleUngroupGroup}
                          onRecurringToggle={(id) => {
                            const task = tasks.find((x) => x.id === id) ?? t;
                            let rule: { freq: string; time?: string; weekDays?: number[]; monthDays?: number[]; lastDayOfMonth?: boolean; count?: number; startDate?: string } = { freq: 'daily', time: '09:00' };
                            try {
                              if (task?.recurrence_rule) rule = { ...rule, ...JSON.parse(task.recurrence_rule) };
                            } catch {}
                            setRecurringConfigModal({
                              taskId: id,
                              recurring: !!task.recurring,
                              freq: (rule.freq as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
                              time: rule.time ?? '09:00',
                              weekDays: rule.weekDays ?? [],
                              monthDays: rule.monthDays ?? [],
                              lastDayOfMonth: !!rule.lastDayOfMonth,
                              count: rule.count,
                              startDate: rule.startDate ?? (task.created_at ? task.created_at.slice(0, 10) : viewDate),
                            });
                          }}
                          onMoveToPending={undefined}
                          onMoveToUnassigned={undefined}
                          onScheduleDate={(id) => {
                            setScheduleDateTaskId(id);
                            setScheduleDateValue(viewDate);
                            setScheduleSlotIdToReplace(null);
                            setScheduleDueAutoPriority(false);
                            setScheduleDateOpen(true);
                          }}
                          onDelete={(id) => {
                            if (confirm('Delete this template?')) api.tasks.delete(id).then(loadData);
                          }}
                          onOpenLinks={(id, initialUrl) => {
                            setLinkModalTaskId(id);
                            setLinkModalInitialUrl(initialUrl ?? '');
                          }}
                          onOpenList={(id) => { setListModalTaskId(id); }}
                          onRefresh={handleRefresh}
                          onTaskPatched={mergeTaskFromPatch}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
                          organizationCategories={organizationCategories}
                          organizationSubcategories={organizationSubcategories}
                          organizationTags={organizationTags}
                          onOpenOrganization={(id) => setOrganizationModalTaskId(id)}
                          onTaskUpdate={loadData}
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div
            id="task-schedule-resize"
            className="left-main-resize"
            ref={scheduleResizeRef}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const startY = e.clientY;
              const startH = taskViewHeightPx;
              const el = scheduleResizeRef.current;
              const main = leftMainRef.current;
              if (!el || !main) return;
              el.setPointerCapture(e.pointerId);
              const onMove = (e2: PointerEvent) => {
                const dy = e2.clientY - startY;
                const maxH = main.offsetHeight - TASK_VIEW_SCHEDULE_MIN_PX - (el.offsetHeight || 6);
                const newH = Math.max(TASK_VIEW_MIN_PX, Math.min(maxH, startH + dy));
                setTaskViewHeightPx(newH);
                localStorage.setItem(TASK_VIEW_HEIGHT_KEY, String(newH));
              };
              const onUp = () => {
                el.releasePointerCapture(e.pointerId);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp, { once: true });
            }}
          />
          <div className="left-bottom">
            <div className="schedule-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div className="schedule-header-tabs-row schedule-tabs">
                <button type="button" className={'schedule-tab' + (scheduleTab === 'today' ? ' active' : '')} onClick={() => setScheduleTab('today')}>
                  Today
                </button>
                <button type="button" className={'schedule-tab' + (scheduleTab === 'calendar' ? ' active' : '')} onClick={() => setScheduleTab('calendar')}>
                  Calendar
                </button>
              </div>
              {scheduleTab === 'today' && (
                <div className="schedule-header-day-row day-nav" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button type="button" className="day-nav-btn" onClick={goPrev}>
                    Prev
                  </button>
                  <span className="schedule-date" style={{ fontSize: '0.85rem' }}>
                    {viewDate}
                  </span>
                  {scheduleDayPast && (
                    <span className="schedule-past-badge" title="This day is read-only">
                      Past
                    </span>
                  )}
                  <button type="button" className="day-nav-btn" onClick={goNext}>
                    Next
                  </button>
                  {!isToday && (
                    <button type="button" className="day-nav-btn" onClick={() => setViewDate(today())}>
                      Today
                    </button>
                  )}
                </div>
              )}
              {scheduleTab === 'calendar' && (
                <div className="schedule-header-day-row calendar-month-nav-header" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className="day-nav-btn calendar-month-prev"
                    onClick={() => {
                      const d = new Date(calendarMonth + 'T00:00:00');
                      d.setMonth(d.getMonth() - 1);
                      setCalendarMonth(d.toISOString().slice(0, 10));
                    }}
                  >
                    Prev
                  </button>
                  <span className="calendar-month-label" style={{ fontSize: '0.85rem' }}>
                    {new Date(calendarMonth + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    className="day-nav-btn calendar-month-next"
                    onClick={() => {
                      const d = new Date(calendarMonth + 'T00:00:00');
                      d.setMonth(d.getMonth() + 1);
                      setCalendarMonth(d.toISOString().slice(0, 10));
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
              {scheduleTab === 'today' && (
                <div className="time-settings time-settings-top-right schedule-header-time-settings" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                  <div className="schedule-header-start-end" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <label className="time-settings-label">
                      Start
                    <select
                      className="time-settings-select"
                      value={settings.start_hour}
                      disabled={scheduleDayPast}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        api.settings.update({ start_hour: v }).then(() => setSettings((s) => ({ ...s, start_hour: v }))).catch(alert);
                      }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}</option>
                      ))}
                    </select>
                  </label>
                  <label className="time-settings-label">
                    End
                    <select
                      className="time-settings-select"
                      value={settings.end_hour}
                      disabled={scheduleDayPast}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        api.settings.update({ end_hour: v }).then(() => setSettings((s) => ({ ...s, end_hour: v }))).catch(alert);
                      }}
                    >
                      {Array.from({ length: 25 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : i === 24 ? '12:00 AM (+1)' : `${i - 12}:00 PM`}
                        </option>
                      ))}
                    </select>
                  </label>
                  </div>
                </div>
              )}
              {scheduleTab === 'today' && (
                <div className="schedule-synced-wrap" style={{ marginLeft: 'auto' }}>
                <span
                  className={'ical-sync-status-btn' + (icalSyncPhase !== 'idle' && icalSyncPhase !== 'synced' ? ' ical-phase-' + icalSyncPhase : icalSyncPhase === 'synced' ? ' ical-phase-synced' : '')}
                  title={
                    icalSyncPhase === 'idle'
                      ? 'iCal sync status'
                      : icalSyncPhase === 'downloading'
                        ? 'Downloading…'
                        : icalSyncPhase === 'parsing'
                          ? 'Parsing…'
                          : icalSyncPhase === 'saving'
                            ? 'Saving…'
                            : icalSyncPhase === 'loading'
                              ? 'Loading into UI…'
                              : 'Synced'
                  }
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem', color: icalSyncPhase === 'idle' ? 'var(--text-muted)' : undefined }}
                >
                  {icalSyncPhase !== 'idle' && icalSyncPhase !== 'synced' ? (
                    <span className="ical-sync-spinner" aria-hidden />
                  ) : icalSyncPhase === 'synced' ? (
                    <>✓ Synced</>
                  ) : (
                    <>iCal</>
                  )}
                </span>
                </div>
              )}
            </div>
            {scheduleTab === 'today' && !scheduleDayPast && (
              <div
                className="schedule-bulk-toolbar"
                role="group"
                aria-label="Schedule bulk actions"
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.25rem', borderBottom: '1px solid var(--border)' }}
              >
                <button
                  type="button"
                  className={'day-nav-btn' + (scheduleBulkMode ? ' schedule-bulk-mode-active' : '')}
                  aria-pressed={scheduleBulkMode}
                  onClick={() => {
                    if (scheduleBulkMode) exitScheduleBulkMode();
                    else {
                      setScheduleBulkMode(true);
                      setScheduleBulkMoveMode(false);
                      setSelectedScheduleRootSlotIds(new Set());
                    }
                  }}
                >
                  {scheduleBulkMode ? 'Exit bulk' : 'Bulk select'}
                </button>
                {scheduleBulkMode && timedRootSlots.some((s) => s.id > 0) && (
                  <button
                    type="button"
                    className="day-nav-btn"
                    onClick={() => setSelectedScheduleRootSlotIds(new Set(timedRootSlots.filter((s) => s.id > 0).map((s) => s.id)))}
                  >
                    Select all timed
                  </button>
                )}
                {scheduleBulkMode && selectedScheduleRootSlotIds.size === 0 && !scheduleBulkMoveMode && (
                  <span className="schedule-bulk-hint" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Tap blocks to select
                  </span>
                )}
                {scheduleBulkMode && scheduleBulkMoveMode && (
                  <span className="schedule-bulk-hint" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Hold a selected block, then drop on the time grid (same snap as moving one task).
                  </span>
                )}
                {selectedScheduleRootSlotIds.size > 0 && (
                  <>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedScheduleRootSlotIds.size} selected</span>
                    <button
                      type="button"
                      className={'day-nav-btn' + (scheduleBulkMoveMode ? ' schedule-bulk-mode-active' : '')}
                      aria-pressed={scheduleBulkMoveMode}
                      onClick={() => setScheduleBulkMoveMode((v) => !v)}
                    >
                      {scheduleBulkMoveMode ? 'Cancel move' : 'Move on schedule'}
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkUnassignOrPending('unassigned')}>
                      Unassign
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkUnassignOrPending('pending')}>
                      Pending
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => setScheduleBulkPriorityOpen(true)}>
                      Priority…
                    </button>
                    <button
                      type="button"
                      className="day-nav-btn"
                      onClick={() => {
                        setScheduleBulkRescheduleDate(viewDate);
                        setScheduleBulkRescheduleOpen(true);
                      }}
                    >
                      Reschedule…
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkGroup()}>
                      Group
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkReorderBy('priority')}>
                      Reorder by priority
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkReorderBy('title')}>
                      Reorder A–Z
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => runBulkDelete()}>
                      Delete
                    </button>
                    <button type="button" className="day-nav-btn" onClick={() => setSelectedScheduleRootSlotIds(new Set())}>
                      Clear selection
                    </button>
                  </>
                )}
              </div>
            )}
            <div
              ref={scheduleContentRef}
            className={
              'schedule-swipe-zone schedule-content' + (isMobile ? ' schedule-swipe-zone-active' : '') + (scheduleAutoScrollBlink ? ' schedule-auto-scroll-blink' : '')
            }
              {...(isMobile ? bindScheduleContentDrag() : {})}
            >
            {scheduleTab === 'today' && (
              <>
                <div
                  className={
                    'schedule-untimed-drop-zone' +
                    (scheduleDropUntimedHighlight ? ' schedule-untimed-drop-zone-active' : '') +
                    (scheduleDayPast ? ' schedule-past-readonly' : '')
                  }
                  data-schedule-drop-untimed="true"
                >
                  {feedErrors.length > 0 && (
                    <div className="schedule-untimed-feed schedule-feed-errors">
                      {feedErrors.map(({ feed_url, message }) => (
                        <p key={feed_url || message}>{feed_url ? `${message} (${feed_url})` : message}</p>
                      ))}
                    </div>
                  )}
                  {(untimedRootSlots.length > 0 || untimedFeedEvents.length > 0) && (
                    <div className="schedule-untimed-feed">
                      {untimedRootSlots.map((slot) => (
                        <div key={slot.id} className="schedule-untimed-feed-chip schedule-untimed-slot">
                          {slot.title ?? 'Task'}
                        </div>
                      ))}
                      {untimedFeedEvents.map((e) => {
                        const isToday = viewDate === today();
                        const canMarkCompleted = isToday && e.id != null;
                        return (
                          <div key={e.id ?? e.uid + e.start} className="schedule-untimed-feed-chip schedule-untimed-feed-chip-with-check">
                            <span style={e.user_completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>{e.title || 'Event'}</span>
                            {canMarkCompleted && (
                              <button
                                type="button"
                                className="time-block-check"
                                title={e.user_completed ? 'Mark incomplete' : 'Mark complete'}
                                aria-pressed={!!e.user_completed}
                                style={isMobile ? { color: e.user_completed ? 'var(--text-muted)' : 'transparent' } : undefined}
                                onClick={() => api.icalEvents.setCompleted(e.id!, !e.user_completed).then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                              >
                                ✓
                              </button>
                            )}
                            {e.uid && !scheduleDayPast && (
                              <button
                                type="button"
                                className="time-block-exclude-ical"
                                title="Hide this event from calendar (add to excluded list)"
                                aria-label="Exclude from calendar"
                                onClick={() => {
                                  api.icalExcluded.add(e.uid, e.title || 'Event').then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                                }}
                              >
                                ⊖
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {dragState && (untimedRootSlots.length === 0 && untimedFeedEvents.length === 0 && feedErrors.length === 0) && (
                    <div className="schedule-untimed-feed schedule-untimed-drop-placeholder" aria-hidden>
                      Drop here for no time
                    </div>
                  )}
                </div>
                {(!initialDataReady || loading) ? (
                  <div className="time-view-placeholder" style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
                    <div className="loading-spinner" aria-hidden />
                  </div>
                ) : error ? (
                  <p className="task-list-error">{error}</p>
                ) : (
                  <div className="time-view">
                    <div className="time-view-container" style={{ height: totalHeight + 'px' }}>
                      <div className="time-view-labels">
                        {slotLabels.map((label, i) => (
                          <div key={i} className="time-view-label-row" style={{ height: ROW_HEIGHT + 'px' }}>
                            {label}
                          </div>
                        ))}
                      </div>
                      <div
                        className="time-view-blocks"
                        style={{ height: totalHeight + 'px' }}
                        data-schedule-drop="true"
                        onDoubleClick={(e) => {
                          if (scheduleDayPast) return;
                          if ((e.target as HTMLElement).closest('.time-block, button, a, .time-block-resize, .time-block-resize-top, .time-block-drag-to-list')) return;
                          const container = e.currentTarget as HTMLElement;
                          const rect = container.getBoundingClientRect();
                          const relativeY = e.clientY - rect.top;
                          const slotIndex = Math.max(0, Math.floor(relativeY / ROW_HEIGHT));
                          const startMin = snapToSlot(
                            viewStartMinutes + slotIndex * slotDurationMinutes,
                            settings.start_hour,
                            settings.end_hour,
                            slotDurationMinutes
                          );
                          const viewEndMin = settings.end_hour * 60;
                          if (startMin >= viewEndMin - slotDurationMinutes) return;
                          const start_time = minutesToTime(startMin);
                          const end_time = minutesToTime(startMin + slotDurationMinutes);
                          api.tasks
                            .create({ title: 'New task', priority: 'low' })
                            .then((created) =>
                              api.day.getOrCreate(viewDate).then((day) =>
                                api.slots.create({ day_record_id: day.id, task_id: created.id, start_time, end_time }).then(() => {
                                  loadData();
                                  setEditingScheduleTaskId(created.id);
                                  setEditingScheduleTitle('');
                                })
                              )
                            )
                            .catch((err) => {
                            setError(err instanceof Error ? err.message : String(err));
                            loadData();
                          });
                        }}
                      >
                        {viewDate === today() && currentTimeMinutes >= viewStartMinutes && currentTimeMinutes < settings.end_hour * 60 && (
                          <div
                            className="current-time-line"
                            style={{
                              top: ((currentTimeMinutes - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT + 'px',
                            }}
                          />
                        )}
                        {slotLabels.map((_, i) => {
                          const min = viewStartMinutes + i * slotDurationMinutes;
                          const isHour = min % 60 === 0;
                          return (
                            <div
                              key={i}
                              className={isHour ? 'time-grid-line hour' : 'time-grid-line increment'}
                              style={{ top: i * ROW_HEIGHT + 'px' }}
                            />
                          );
                        })}
                        {dragState && scheduleDropGhostMin != null && (
                          <div
                            className="time-block time-block-ghost"
                            style={{
                              top: ((scheduleDropGhostMin - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT + 'px',
                              height: ROW_HEIGHT + 'px',
                              left: '2%',
                              width: '96%',
                              pointerEvents: 'none',
                            }}
                            aria-hidden
                          >
                            <div className="time-block-title-wrap">
                              <div className="time-block-title">
                                {dragState.taskIds.length > 1
                                  ? `${dragState.taskIds.length} tasks`
                                  : (tasks.find((t) => t.id === dragState!.taskId)?.title ?? slots.find((s) => s.task_id === dragState!.taskId)?.title ?? 'Drop here')}
                              </div>
                            </div>
                          </div>
                        )}
                        {timedRootSlots.map((slot) => {
                          const startMin = timeToMinutes(slot.start_time);
                          const endMin = timeToMinutes(slot.end_time);
                          const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT;
                          const height = ((endMin - startMin) / slotDurationMinutes) * ROW_HEIGHT;
                          const overlap = slotOverlapInfo.get(slot.id) ?? { col: 0, total: 1 };
                          const widthPctSlot = overlap.total > 0 ? 100 / overlap.total : 100;
                          const leftPct = overlap.col * widthPctSlot;
                          const childSlots = childSlotsByParent.get(slot.task_id) ?? [];
                          const allChildrenComplete = childSlots.length > 0 && childSlots.every((c) => c.completed);
                          const parentCompleteLocked = slot.completed === 1 && allChildrenComplete;
                          const slotTask = tasks.find((t) => t.id === slot.task_id);
                          const slotCategory = slotTask?.category_id != null ? organizationCategories.find((c) => c.id === slotTask.category_id) : null;
                          const slotSubcategory = slotTask?.subcategory_id != null ? organizationSubcategories.find((s) => s.id === slotTask.subcategory_id) : null;
                          const slotTagList = (slotTask?.tag_ids ?? []).map((tid) => organizationTags.find((t) => t.id === tid)).filter(Boolean) as Array<{ id: number; name: string; color?: string | null }>;
                          const slotBgColor = slotCategory?.color
                            ? (slotCategory.color.startsWith('hsl')
                              ? slotCategory.color.replace(/\)$/, ', 0.25)').replace(/^hsl\(/, 'hsla(')
                              : slotCategory.color + '40')
                            : 'rgba(220, 220, 220, 0.45)';
                          return (
                            <div
                              key={slot.id}
                              className={
                                'time-block' +
                                (slot.completed ? ' completed' : '') +
                                (slot.is_recurring_occurrence ? ' time-block-recurring-occurrence' : '') +
                                (dragState?.source === 'schedule' && dragState?.taskIds?.includes(slot.task_id) ? ' time-block-dragging' : '') +
                                (urlDragOverTaskId === slot.task_id ? ' time-block-drop-url' : '') +
                                (scheduleDayPast ? ' time-block-readonly' : '') +
                                (selectedScheduleRootSlotIds.has(slot.id) ? ' time-block-bulk-selected' : '') +
                                scheduleBlockDensityClasses(height, widthPctSlot)
                              }
                              style={{
                                top: top + 'px',
                                height: height + 'px',
                                left: leftPct + '%',
                                width: (widthPctSlot > 0 ? widthPctSlot - 0.5 : 99.5) + '%',
                                backgroundColor: slotBgColor,
                                ['--tb-h' as string]: `${Math.round(height)}px`,
                              } as React.CSSProperties}
                              onDragOver={(e) => {
                                if (scheduleDayPast) return;
                                if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'link';
                                }
                              }}
                              onDragEnter={(e) => {
                                if (scheduleDayPast) return;
                                if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
                                  setUrlDragOverTaskId(slot.task_id);
                                }
                              }}
                              onDragLeave={(e) => {
                                if (scheduleDayPast) return;
                                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                  setUrlDragOverTaskId(null);
                                }
                              }}
                              onDrop={(e) => {
                                if (scheduleDayPast) return;
                                const url = extractUrlFromDrop(e);
                                if (url) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setUrlDragOverTaskId(null);
                                  setLinkModalTaskId(slot.task_id);
                                  setLinkModalInitialUrl(url);
                                }
                              }}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                if (scheduleBulkMode && slot.id > 0) {
                                  if (
                                    scheduleBulkMoveMode &&
                                    selectedScheduleRootSlotIds.has(slot.id) &&
                                    !(e.target as HTMLElement).closest(
                                      'button, a, .time-block-resize, .time-block-resize-top, .time-block-drag-to-list, .time-block-link-inline, .time-block-link'
                                    )
                                  ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    startBulkScheduleMoveHold(slot.task_id, e.clientX, e.clientY);
                                    return;
                                  }
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleScheduleRootInSelection(slot.id);
                                  return;
                                }
                                if ((e.target as HTMLElement).closest('button, a, .time-block-resize, .time-block-resize-top, .time-block-drag-to-list, .time-block-link-inline, .time-block-link')) return;
                                e.preventDefault();
                                startHold(slot.task_id, 'schedule', e.clientX, e.clientY);
                              }}
                              >
                              {!scheduleDayPast && !slot.is_recurring_occurrence && (
                              <div
                                className="time-block-resize time-block-resize-top"
                                title="Drag to change start time"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const handleEl = e.currentTarget as HTMLElement;
                                  const blockEl = handleEl.closest('.time-block') as HTMLElement;
                                  if (!blockEl) return;
                                  handleEl.setPointerCapture(e.pointerId);
                                  blockEl.classList.add('time-block-resizing');
                                  const startY = e.clientY;
                                  let lastStart = startMin;
                                  const slotDur = Math.max(1, slotDurationMinutes);
                                  const move = (e2: PointerEvent) => {
                                    const dy = e2.clientY - startY;
                                    const delta = Math.round(dy / ROW_HEIGHT) * slotDur;
                                    let newStart = snapToSlot(startMin + delta, settings.start_hour, settings.end_hour, slotDur);
                                    const memberCount = 1 + childSlots.length;
                                    newStart = clampTopResizeStartForMinGroupDuration({
                                      candidateStartMin: newStart,
                                      endMin,
                                      slotDurationMinutes: slotDur,
                                      memberCount,
                                      startHour: settings.start_hour,
                                      endHour: settings.end_hour,
                                    });
                                    lastStart = newStart;
                                    blockEl.style.top = ((lastStart - viewStartMinutes) / slotDur) * ROW_HEIGHT + 'px';
                                    blockEl.style.height = Math.max(ROW_HEIGHT, ((endMin - lastStart) / slotDur) * ROW_HEIGHT) + 'px';
                                  };
                                  const up = () => {
                                    blockEl.classList.remove('time-block-resizing');
                                    handleEl.releasePointerCapture(e.pointerId);
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                    blockEl.style.top = '';
                                    blockEl.style.height = '';
                                    const memberCount = 1 + childSlots.length;
                                    const clampedStart = clampTopResizeStartForMinGroupDuration({
                                      candidateStartMin: lastStart,
                                      endMin,
                                      slotDurationMinutes: slotDur,
                                      memberCount,
                                      startHour: settings.start_hour,
                                      endHour: settings.end_hour,
                                    });
                                    if (clampedStart !== startMin) {
                                      const newStartTime = minutesToTime(clampedStart);
                                      const orderedChildren = childSlots
                                        .slice()
                                        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
                                      const memberSlots = [{ id: slot.id }, ...orderedChildren.map((c) => ({ id: c.id }))];
                                      const memberTimes = distributeGroupMemberTimes({
                                        groupStartMin: clampedStart,
                                        groupEndMin: endMin,
                                        slotDurationMinutes: slotDur,
                                        memberCount,
                                      });
                                      const memberTimesById = new Map<number, { startMin: number; endMin: number }>();
                                      memberSlots.forEach((ms, i) =>
                                        memberTimesById.set(ms.id, {
                                          startMin: i === 0 ? clampedStart : memberTimes[i].startMin,
                                          endMin: i === 0 ? endMin : memberTimes[i].endMin,
                                        })
                                      );
                                      setSlots((prev) =>
                                        prev.map((s) => {
                                          const mt = memberTimesById.get(s.id);
                                          if (!mt) return s;
                                          return { ...s, start_time: minutesToTime(mt.startMin), end_time: minutesToTime(mt.endMin) };
                                        })
                                      );
                                      if (slot.recurring || slot.is_recurring_occurrence) {
                                        setRecurringResizeModal({ slot, childSlots, newStartTime, newEndTime: slot.end_time ?? undefined });
                                      } else {
                                        Promise.all(
                                          memberSlots.map((ms) =>
                                            api.slots.update({
                                              id: ms.id,
                                              start_time: minutesToTime(memberTimesById.get(ms.id)!.startMin),
                                              end_time: minutesToTime(memberTimesById.get(ms.id)!.endMin),
                                            })
                                          )
                                        )
                                          .then(() => refetchSlotsForViewDay())
                                          .catch((err) => {
                                            setError(err instanceof Error ? err.message : String(err));
                                            loadData();
                                          });
                                      }
                                    }
                                  };
                                  window.addEventListener('pointermove', move);
                                  window.addEventListener('pointerup', up, { once: true });
                                }}
                              />
                              )}
                              <div className="time-block-header">
                                <div className="time-block-header-leading">
                                  <span
                                    className="time-block-drag-to-list"
                                    title="Hold to move to list"
                                    onPointerDown={(e) => {
                                      if (e.button === 0) {
                                        if (scheduleBulkMode && !scheduleBulkMoveMode) return;
                                        e.stopPropagation();
                                        if (scheduleBulkMoveMode && selectedScheduleRootSlotIds.has(slot.id)) {
                                          startBulkScheduleMoveHold(slot.task_id, e.clientX, e.clientY);
                                        } else {
                                          startHold(slot.task_id, 'schedule', e.clientX, e.clientY);
                                        }
                                      }
                                    }}
                                  >
                                    ⋮⋮
                                  </span>
                                  <div className="time-block-priority-wrap">
                                    <button
                                      ref={openPrioritySlotId === slot.id ? schedulePriorityButtonRef : undefined}
                                      type="button"
                                      className={'time-block-priority time-block-priority-btn priority-' + (slot.priority || 'low')}
                                      title="Priority"
                                      disabled={scheduleDayPast}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (scheduleDayPast) return;
                                        setOpenPrioritySlotId((id) => (id === slot.id ? null : slot.id));
                                      }}
                                    >
                                      {priorityIcon((slot.priority as Priority) ?? 'low')}
                                    </button>
                                  </div>
                                </div>
                                <div className="time-block-title-wrap">
                                  {editingScheduleTaskId === slot.task_id ? (
                                    <input
                                      className="time-block-edit"
                                      value={editingScheduleTitle}
                                      onChange={(e) => setEditingScheduleTitle(e.target.value)}
                                      onBlur={() => {
                                        const t = editingScheduleTitle.trim();
                                        if (t) {
                                          api.tasks.update({ id: slot.task_id, title: t }).then(loadData);
                                          setEditingScheduleTaskId(null);
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const t = editingScheduleTitle.trim();
                                          if (t) {
                                            api.tasks.update({ id: slot.task_id, title: t }).then(loadData);
                                            setEditingScheduleTaskId(null);
                                          }
                                        }
                                        if (e.key === 'Escape') {
                                          setEditingScheduleTaskId(null);
                                          api.tasks.delete(slot.task_id).then(() => loadData());
                                        }
                                      }}
                                      placeholder="Task title (required)"
                                      autoFocus
                                    />
                                  ) : (
                                    <div
                                      className="time-block-title"
                                      style={slot.completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (scheduleDayPast || parentCompleteLocked || (slot.is_recurring_occurrence && viewDate > today())) return;
                                        setEditingScheduleTaskId(slot.task_id);
                                        setEditingScheduleTitle(slot.title ?? 'Task');
                                      }}
                                      title="Double-click to edit title"
                                    >
                                      {slot.title ?? 'Task'}
                                    </div>
                                  )}
                                  {(taskLinksByTaskId[slot.task_id] ?? []).map((link) => (
                                    <a
                                      key={link.id}
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="time-block-link-inline"
                                      title={link.description || link.url}
                                    >
                                      🔗
                                    </a>
                                  ))}
                                  {slotTagList.length > 0 && (
                                    <span className="time-block-tags">
                                      {slotTagList.map((t) => (
                                        <span
                                          key={t.id}
                                          className="time-block-tag-pill"
                                          style={{
                                            backgroundColor: t.color ?? 'var(--surface)',
                                            color: t.color ? (t.color.startsWith('hsl') && t.color.includes('65%') ? '#fff' : '#000') : 'var(--text)',
                                          }}
                                        >
                                          {t.name}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                  {(slotCategory != null || slotSubcategory != null) && (
                                    <div className="time-block-category-sub" style={{ fontSize: '0.7em', opacity: 0.9, marginTop: '0.1rem' }}>
                                      {slotCategory?.name}{slotSubcategory != null ? ` › ${slotSubcategory.name}` : ''}
                                    </div>
                                  )}
                                </div>
                                <span className="time-block-desktop-actions">
                                  <button
                                    type="button"
                                    className="time-block-link"
                                    title="Add link"
                                    disabled={scheduleDayPast}
                                    onClick={() => {
                                      if (scheduleDayPast) return;
                                      setLinkModalTaskId(slot.task_id);
                                      setLinkModalInitialUrl('');
                                    }}
                                  >
                                    <span className="time-block-link-icon">🔗<sup>+</sup></span>
                                  </button>
                                  <button
                                    type="button"
                                    className="time-block-link"
                                    title="List items"
                                    disabled={scheduleDayPast}
                                    onClick={() => {
                                      if (scheduleDayPast) return;
                                      setListModalTaskId(slot.task_id);
                                    }}
                                  >
                                    <span className="time-block-link-icon">📋<sup>+</sup></span>
                                  </button>
                                  <button
                                    type="button"
                                    className="time-block-link task-list-add-btn"
                                    title="Category & tags"
                                    disabled={scheduleDayPast}
                                    onClick={() => {
                                      if (scheduleDayPast) return;
                                      setOrganizationModalTaskId(slot.task_id);
                                    }}
                                  >
                                    <span className="time-block-link-icon">📁<sup className="task-list-add-plus">+</sup></span>
                                  </button>
                                  <button
                                    type="button"
                                    className="time-block-date"
                                    title="Change date"
                                    disabled={scheduleDayPast}
                                    onClick={() => {
                                      if (scheduleDayPast) return;
                                      setScheduleDateTaskId(slot.task_id);
                                      setScheduleDateValue(viewDate);
                                      setScheduleNoTime(!slotHasTime(slot));
                                      setScheduleTimeValue(slot.start_time?.slice(0, 5) || '09:00');
                                      setScheduleSlotIdToReplace(slot.id);
                                      setScheduleDueAutoPriority(false);
                                      setScheduleDateOpen(true);
                                    }}
                                  >
                                    📅
                                  </button>
                                  <button
                                    type="button"
                                    className={'time-block-recurring' + (slot.recurring ? ' depressed' : '')}
                                    title="Recurring"
                                    disabled={scheduleDayPast}
                                    onClick={() => {
                                      if (scheduleDayPast) return;
                                      const task = tasks.find((t) => t.id === slot.task_id);
                                      let rule: { freq: string; time?: string; weekDays?: number[]; monthDays?: number[]; lastDayOfMonth?: boolean; count?: number; startDate?: string } = { freq: 'daily', time: '09:00' };
                                      try {
                                        if (task?.recurrence_rule) rule = { ...rule, ...JSON.parse(task.recurrence_rule) };
                                      } catch {}
                                      setRecurringConfigModal({
                                        taskId: slot.task_id,
                                        recurring: !!slot.recurring,
                                        freq: (rule.freq as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
                                        time: rule.time ?? '09:00',
                                        weekDays: rule.weekDays ?? [],
                                        monthDays: rule.monthDays ?? [],
                                        lastDayOfMonth: !!rule.lastDayOfMonth,
                                        count: rule.count,
                                        startDate: rule.startDate ?? viewDate,
                                      });
                                    }}
                                  >
                                    ↻
                                  </button>
                                  <button
                                    type="button"
                                    className="time-block-trash trash-btn"
                                    title="Delete task"
                                    disabled={scheduleDayPast}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (scheduleDayPast) return;
                                      if (slot.recurring) {
                                        setRecurringActionModal({ type: 'remove', slot, childSlots });
                                        return;
                                      }
                                      if (confirm('Delete this task?')) {
                                        const slotIds = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                                        Promise.all(slotIds.map((id) => api.slots.delete(id)))
                                          .then(() => api.tasks.delete(slot.task_id))
                                          .then(loadData)
                                          .catch((err) => {
                                            setError(err instanceof Error ? err.message : String(err));
                                            loadData();
                                          });
                                      }
                                    }}
                                  >
                                    🗑
                                  </button>
                                  {!parentCompleteLocked && !(slot.is_recurring_occurrence && viewDate > today()) && (
                                    <button
                                      type="button"
                                      className="time-block-check"
                                      title="Mark complete"
                                      aria-pressed={!!slot.completed}
                                      disabled={scheduleDayPast}
                                      style={isMobile ? { color: slot.completed ? 'var(--text-muted)' : 'transparent' } : undefined}
                                      onClick={() => {
                                        if (scheduleDayPast) return;
                                        const newCompleted = slot.completed ? 0 : 1;
                                        if (newCompleted !== 1) {
                                          const updates = [api.slots.update({ id: slot.id, completed: false })];
                                          childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: false })));
                                          Promise.all(updates).then(loadData).catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); });
                                          return;
                                        }
                                        if (slot.is_recurring_occurrence && slot.id < 0) {
                                          api.slots.completeOccurrence(slot.task_id, viewDate).then(loadData).catch((err) => {
                                            setError(err instanceof Error ? err.message : String(err));
                                            loadData();
                                          });
                                          return;
                                        }
                                        if (slot.recurring && slot.id > 0) {
                                          setRecurringActionModal({ type: 'complete', slot, childSlots });
                                          return;
                                        }
                                        if (viewDate > today()) {
                                          setFutureCompleteModal({ slot });
                                          return;
                                        }
                                        const updates = [api.slots.update({ id: slot.id, completed: true })];
                                        childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: true })));
                                        Promise.all(updates).then(loadData).catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); });
                                      }}
                                    >
                                      ✓
                                    </button>
                                  )}
                                </span>
                                <span className="time-block-mobile-drawer" style={{ position: 'relative' }}>
                                  <button
                                    type="button"
                                    className="time-block-drawer-chevron"
                                    title={openScheduleDrawerSlotId === slot.id ? 'Close' : 'Actions'}
                                    aria-expanded={openScheduleDrawerSlotId === slot.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenScheduleDrawerSlotId((id) => (id === slot.id ? null : slot.id));
                                    }}
                                  >
                                    {openScheduleDrawerSlotId === slot.id ? '▶' : '◀'}
                                  </button>
                                  {openScheduleDrawerSlotId === slot.id && (
                                    <div className="time-block-actions-drawer">
                                      <button
                                        type="button"
                                        title="Edit title"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (scheduleDayPast) return;
                                          setEditingScheduleTaskId(slot.task_id);
                                          setEditingScheduleTitle(slot.title ?? '');
                                          setOpenScheduleDrawerSlotId(null);
                                        }}
                                      >
                                        ✎
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        title="Add link"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (scheduleDayPast) return;
                                          setLinkModalTaskId(slot.task_id);
                                          setLinkModalInitialUrl('');
                                          setOpenScheduleDrawerSlotId(null);
                                        }}
                                      >
                                        🔗
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        title="List items"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (scheduleDayPast) return;
                                          setListModalTaskId(slot.task_id);
                                          setOpenScheduleDrawerSlotId(null);
                                        }}
                                      >
                                        📋
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        title="Category & tags"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (scheduleDayPast) return;
                                          setOrganizationModalTaskId(slot.task_id);
                                          setOpenScheduleDrawerSlotId(null);
                                        }}
                                      >
                                        📁
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        title="Change date"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (scheduleDayPast) return;
                                          setScheduleDateTaskId(slot.task_id);
                                          setScheduleDateValue(viewDate);
                                          setScheduleNoTime(!slotHasTime(slot));
                                          setScheduleTimeValue(slot.start_time?.slice(0, 5) || '09:00');
                                          setScheduleSlotIdToReplace(slot.id);
                                          setScheduleDueAutoPriority(false);
                                          setScheduleDateOpen(true);
                                          setOpenScheduleDrawerSlotId(null);
                                        }}
                                      >
                                        📅
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        title="Recurring"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                        e.stopPropagation();
                                        if (scheduleDayPast) return;
                                        const task = tasks.find((t) => t.id === slot.task_id);
                                        let rule: { freq: string; time?: string; weekDays?: number[]; monthDays?: number[]; lastDayOfMonth?: boolean; count?: number; startDate?: string } = { freq: 'daily', time: '09:00' };
                                        try {
                                          if (task?.recurrence_rule) rule = { ...rule, ...JSON.parse(task.recurrence_rule) };
                                        } catch {}
                                        setRecurringConfigModal({
                                          taskId: slot.task_id,
                                          recurring: !!slot.recurring,
                                          freq: (rule.freq as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
                                          time: rule.time ?? '09:00',
                                          weekDays: rule.weekDays ?? [],
                                          monthDays: rule.monthDays ?? [],
                                          lastDayOfMonth: !!rule.lastDayOfMonth,
                                          count: rule.count,
                                          startDate: rule.startDate ?? viewDate,
                                        });
                                        setOpenScheduleDrawerSlotId(null);
                                      }}
                                      >
                                        ↻
                                      </button>
                                      {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                      <button
                                        type="button"
                                        className="trash-btn"
                                        title="Delete task"
                                        disabled={scheduleDayPast}
                                        onClick={(e) => {
                                        e.stopPropagation();
                                        if (scheduleDayPast) return;
                                        setOpenScheduleDrawerSlotId(null);
                                        if (slot.recurring) {
                                          setRecurringActionModal({ type: 'remove', slot, childSlots });
                                          return;
                                        }
                                        if (confirm('Delete this task?')) {
                                          const slotIds = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                                          Promise.all(slotIds.map((id) => api.slots.delete(id)))
                                            .then(() => api.tasks.delete(slot.task_id))
                                            .then(loadData)
                                            .catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); });
                                        }
                                      }}>🗑</button>
                                      {!parentCompleteLocked && !(slot.is_recurring_occurrence && viewDate > today()) && (
                                        <>
                                          {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                                          <button
                                            type="button"
                                            title="Mark complete"
                                            disabled={scheduleDayPast}
                                            onClick={(e) => {
                                            e.stopPropagation();
                                            if (scheduleDayPast) return;
                                            setOpenScheduleDrawerSlotId(null);
                                            const newCompleted = slot.completed ? 0 : 1;
                                            if (newCompleted !== 1) {
                                              const updates = [api.slots.update({ id: slot.id, completed: false })];
                                              childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: false })));
                                              Promise.all(updates).then(loadData).catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); });
                                              return;
                                            }
                                            if (slot.is_recurring_occurrence && slot.id < 0) {
                                              api.slots.completeOccurrence(slot.task_id, viewDate).then(loadData).catch((err) => {
                                                setError(err instanceof Error ? err.message : String(err));
                                                loadData();
                                              });
                                              return;
                                            }
                                            if (slot.recurring && slot.id > 0) {
                                              setRecurringActionModal({ type: 'complete', slot, childSlots });
                                              return;
                                            }
                                            if (viewDate > today()) {
                                              setFutureCompleteModal({ slot });
                                              return;
                                            }
                                            const updates = [api.slots.update({ id: slot.id, completed: true })];
                                            childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: true })));
                                            Promise.all(updates).then(loadData).catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); });
                                          }}>✓</button>
                                        </>
                                      )}
                                      {!isMobile && (
                                        <span className="task-card-drawer-divider task-card-drawer-end" aria-hidden>&gt;</span>
                                      )}
                                    </div>
                                  )}
                                </span>
                              </div>
                              {childSlots.length > 0 && (
                                <div className="time-block-children">
                                  {childSlots.map((c) => (
                                    <div
                                      key={c.id}
                                      className="time-block-child time-block-child-header"
                                      onPointerDown={(e) => {
                                        if (!scheduleBulkMode || e.button !== 0) return;
                                        if ((e.target as HTMLElement).closest('button')) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleScheduleRootInSelection(slot.id);
                                      }}
                                    >
                                      <span className="time-block-child-title" style={c.completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                                        {c.title ?? 'Task'}
                                      </span>
                                      <button
                                        type="button"
                                        className="time-block-check"
                                        title="Mark complete"
                                        aria-pressed={!!c.completed}
                                        disabled={scheduleDayPast}
                                        style={isMobile ? { color: c.completed ? 'var(--text-muted)' : 'transparent' } : undefined}
                                        onClick={() => {
                                          const newCompleted = c.completed ? 0 : 1;
                                          const updates = [api.slots.update({ id: c.id, completed: newCompleted === 1 })];
                                          if (newCompleted === 1) {
                                            const allDone = childSlots.every((x) => x.id === c.id || x.completed === 1);
                                            if (allDone) updates.push(api.slots.update({ id: slot.id, completed: true }));
                                          } else {
                                            updates.push(api.slots.update({ id: slot.id, completed: false }));
                                          }
                                          Promise.all(updates)
                                            .then(loadData)
                                            .catch((err) => {
                                              setError(err instanceof Error ? err.message : String(err));
                                              loadData();
                                            });
                                        }}
                                      >
                                        ✓
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!scheduleDayPast && !slot.is_recurring_occurrence && (
                              <div
                                className="time-block-resize"
                                title="Drag to resize"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const handleEl = e.currentTarget as HTMLElement;
                                  const blockEl = handleEl.closest('.time-block') as HTMLElement;
                                  if (!blockEl) return;
                                  handleEl.setPointerCapture(e.pointerId);
                                  blockEl.classList.add('time-block-resizing');
                                  const startY = e.clientY;
                                  let lastEnd = endMin;
                                  const slotDur = Math.max(1, slotDurationMinutes);
                                  const move = (e2: PointerEvent) => {
                                    const dy = e2.clientY - startY;
                                    const delta = Math.round(dy / ROW_HEIGHT) * slotDur;
                                    let newEnd = snapToSlot(endMin + delta, settings.start_hour, settings.end_hour, slotDur);
                                    const memberCount = 1 + childSlots.length;
                                    newEnd = clampBottomResizeEndForMinGroupDuration({
                                      startMin,
                                      candidateEndMin: newEnd,
                                      slotDurationMinutes: slotDur,
                                      memberCount,
                                    });
                                    lastEnd = newEnd;
                                    blockEl.style.height =
                                      Math.max(ROW_HEIGHT, ((lastEnd - startMin) / slotDur) * ROW_HEIGHT) + 'px';
                                  };
                                  const up = () => {
                                    blockEl.classList.remove('time-block-resizing');
                                    handleEl.releasePointerCapture(e.pointerId);
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                    blockEl.style.height = '';
                                    const memberCount = 1 + childSlots.length;
                                    const clampedEnd = clampBottomResizeEndForMinGroupDuration({
                                      startMin,
                                      candidateEndMin: lastEnd,
                                      slotDurationMinutes: slotDur,
                                      memberCount,
                                    });
                                    if (clampedEnd !== endMin) {
                                      const newEndTime = minutesToTime(clampedEnd);
                                      const orderedChildren = childSlots
                                        .slice()
                                        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id - b.id);
                                      const memberSlots = [{ id: slot.id }, ...orderedChildren.map((c) => ({ id: c.id }))];
                                      const memberTimes = distributeGroupMemberTimes({
                                        groupStartMin: startMin,
                                        groupEndMin: clampedEnd,
                                        slotDurationMinutes: slotDur,
                                        memberCount,
                                      });
                                      const memberTimesById = new Map<number, { startMin: number; endMin: number }>();
                                      memberSlots.forEach((ms, i) =>
                                        memberTimesById.set(ms.id, {
                                          startMin: i === 0 ? startMin : memberTimes[i].startMin,
                                          endMin: i === 0 ? clampedEnd : memberTimes[i].endMin,
                                        })
                                      );
                                      setSlots((prev) =>
                                        prev.map((s) => {
                                          const mt = memberTimesById.get(s.id);
                                          if (!mt) return s;
                                          return { ...s, start_time: minutesToTime(mt.startMin), end_time: minutesToTime(mt.endMin) };
                                        })
                                      );
                                      if (slot.recurring || slot.is_recurring_occurrence) {
                                        setRecurringResizeModal({ slot, childSlots, newStartTime: slot.start_time ?? undefined, newEndTime });
                                      } else {
                                        Promise.all(
                                          memberSlots.map((ms) =>
                                            api.slots.update({
                                              id: ms.id,
                                              start_time: minutesToTime(memberTimesById.get(ms.id)!.startMin),
                                              end_time: minutesToTime(memberTimesById.get(ms.id)!.endMin),
                                            })
                                          )
                                        )
                                          .then(() => refetchSlotsForViewDay())
                                          .catch((err) => {
                                            setError(err instanceof Error ? err.message : String(err));
                                            loadData();
                                          });
                                      }
                                    }
                                  };
                                  window.addEventListener('pointermove', move);
                                  window.addEventListener('pointerup', up, { once: true });
                                }}
                              />
                              )}
                            </div>
                          );
                        })}
                        {feedEvents
                          .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, settings.timezone) === viewDate)
                          .map((e) => {
                            const local = icalEventToLocal(e.start, e.end, false, settings.timezone);
                            const startMin = local.localStartMinutes;
                            const endMin = local.localEndMinutes;
                            const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT;
                            const height = ((endMin - startMin) / slotDurationMinutes) * ROW_HEIGHT;
                            const isToday = viewDate === today();
                            const canMarkCompleted = isToday && e.id != null;
                            const feedKey = 'feed-' + (e.id ?? e.uid + e.start);
                            const overlap = feedOverlapInfo.get(feedKey) ?? { col: 0, total: 1 };
                            const widthPct = overlap.total > 0 ? 100 / overlap.total : 100;
                            const leftPct = overlap.col * widthPct;
                            return (
                              <div
                                key={e.id ?? e.uid + e.start}
                                className="time-block time-block-feed"
                                style={{
                                  top: top + 'px',
                                  height: Math.max(height, 20) + 'px',
                                  left: leftPct + '%',
                                  width: (widthPct > 0 ? widthPct - 0.5 : 99.5) + '%',
                                }}
                              >
                                <div className="time-block-header">
                                  <div className="time-block-title-wrap">
                                    <div className="time-block-title" style={e.user_completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                                      {local.localStartTime} – {local.localEndTime} {e.title}
                                    </div>
                                  </div>
                                  {canMarkCompleted && (
                                    <button
                                      type="button"
                                      className="time-block-check"
                                      title={e.user_completed ? 'Mark incomplete' : 'Mark complete'}
                                      aria-pressed={!!e.user_completed}
                                      style={isMobile ? { color: e.user_completed ? 'var(--text-muted)' : 'transparent' } : undefined}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        api.icalEvents.setCompleted(e.id!, !e.user_completed).then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                                      }}
                                    >
                                      ✓
                                    </button>
                                  )}
                                  {e.uid && (
                                    <button
                                      type="button"
                                      className="time-block-exclude-ical"
                                      title="Hide this event from calendar (add to excluded list)"
                                      aria-label="Exclude from calendar"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        api.icalExcluded.add(e.uid, e.title || 'Event').then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                                      }}
                                    >
                                      ⊖
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {scheduleTab === 'calendar' && (
              <div className="calendar-view visible">
                <div className="calendar-grid">
                  {buildCalendarDays(calendarMonth).map((dateStr, i) => {
                    const daySlots = dateStr ? (calendarSlotsByDate[dateStr] ?? []) : [];
                    const dayRoots = daySlots.filter((s) => !s.parent_id || !daySlots.some((o) => o.task_id === s.parent_id));
                    const dayFeedEvents = dateStr ? (calendarFeedEventsByDate[dateStr] ?? []) : [];
                    const isPast = dateStr && dateStr < today();
                    const isTodayDate = dateStr === today();
                    return (
                      <div
                        key={i}
                        className={
                          'calendar-day' +
                          (dateStr ? (isPast ? ' calendar-day-past' : isTodayDate ? ' calendar-day-today' : '') : '')
                        }
                        data-date={dateStr || ''}
                        onClick={() => {
                          if (!dateStr) return;
                          setViewDate(dateStr);
                          setScheduleTab('today');
                        }}
                        onDoubleClick={(e) => {
                          if (!dateStr || dateStr < today()) return;
                          if ((e.target as HTMLElement).closest('.calendar-day-task')) return;
                          setViewDate(dateStr);
                          setScheduleTab('today');
                          const slotDur = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
                          const startMin = 9 * 60;
                          const start_time = minutesToTime(startMin);
                          const end_time = minutesToTime(startMin + slotDur);
                          api.tasks
                            .create({ title: 'New task', priority: 'low' })
                            .then((created) =>
                              api.day.getOrCreate(dateStr).then((day) =>
                                api.slots.create({ day_record_id: day.id, task_id: created.id, start_time, end_time }).then(() => {
                                  refetchSlotsForViewDay(dateStr);
                                  setEditingScheduleTaskId(created.id);
                                  setEditingScheduleTitle('');
                                })
                              )
                            )
                            .catch((err) => {
                              setError(err instanceof Error ? err.message : String(err));
                              loadData();
                            });
                        }}
                      >
                        <div className="calendar-day-num">{dateStr ? new Date(dateStr + 'T00:00:00').getDate() : ''}</div>
                        {dateStr && (
                          <ul className="calendar-day-tasks">
                            {dayRoots.map((s) => (
                              <li
                                key={s.id}
                                className={
                                  'calendar-day-task calendar-day-task-priority-' + (s.priority || 'low') + (s.completed ? ' calendar-day-task-completed' : '') + (s.is_recurring_occurrence ? ' calendar-day-task-recurring' : '')
                                }
                              >
                                <span className="calendar-task-icon" aria-hidden title={s.completed ? 'Completed' : s.recurring || s.is_recurring_occurrence ? 'Recurring' : undefined}>
                                  {s.completed ? '☑' : s.recurring || s.is_recurring_occurrence ? '↻' : '☐'}
                                </span>
                                <span className="calendar-task-desc" style={s.completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}>
                                  {s.title ?? 'Task'}
                                </span>
                              </li>
                            ))}
                            {dayFeedEvents.map((e) => (
                              <li key={e.uid + e.start} className="calendar-day-task calendar-day-feed-event">
                                <span className="calendar-task-icon" aria-hidden>
                                  ◐
                                </span>
                                <span className="calendar-task-desc">{e.title || 'Event'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
        </div>
        <div
          ref={resizeHandleRef}
          id="resize-handle"
          role="separator"
          aria-orientation="vertical"
          className="resize-handle"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const startX = e.clientX;
            const startW = rightPanelWidth;
            const minW = 280;
            const maxW = typeof window !== 'undefined' ? window.innerWidth - 400 : 800;
            const move = (e2: PointerEvent) => {
              const delta = startX - e2.clientX;
              const newW = Math.max(minW, Math.min(maxW, startW + delta));
              setRightPanelWidth(newW);
              localStorage.setItem('daytracker_right_panel_width', String(newW));
            };
            const up = () => {
              resizeHandleRef.current?.releasePointerCapture?.(e.pointerId);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            resizeHandleRef.current?.setPointerCapture?.(e.pointerId);
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      </div>
      <div className="panel-slide panel-slide-ai">
        <AIPanel
          aiEnabled={aiEnabled}
          viewDate={viewDate}
          onRefresh={handleRefresh}
          width={rightPanelWidth}
          onWidthChange={(w) => {
            setRightPanelWidth(w);
            if (typeof window !== 'undefined') localStorage.setItem('daytracker_right_panel_width', String(w));
          }}
          collapsed={isMobile ? mainSlideIndex !== 2 : undefined}
        />
      </div>

      <Modal
        open={addOptionsOpen}
        onClose={() => setAddOptionsOpen(false)}
        title="Add task with options"
        actions={
          <>
            <Button onClick={handleAddTaskWithOptions} disabled={!addOptionsTitle.trim()}>
              Add
            </Button>
            <Button onClick={() => setAddOptionsOpen(false)}>Cancel</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label>
            Title
            <input
              type="text"
              value={addOptionsTitle}
              onChange={(e) => setAddOptionsTitle(e.target.value)}
              style={{ width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
            />
          </label>
          <label>
            Priority
            <select
              value={addOptionsPriority}
              onChange={(e) => setAddOptionsPriority(e.target.value as Priority)}
              style={{ marginLeft: '0.5rem', padding: '0.35rem' }}
            >
              <option value="commitment">Commitment ★</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input type="checkbox" checked={addOptionsRecurring} onChange={(e) => setAddOptionsRecurring(e.target.checked)} />
            Recurring (re-add to list when completed)
          </label>
        </div>
      </Modal>

      <Modal
        open={scheduleDateOpen}
        onClose={() => {
          setScheduleDateOpen(false);
          setScheduleDateTaskId(null);
          setScheduleSlotIdToReplace(null);
          setScheduleDueAutoPriority(false);
        }}
        title="Schedule on date"
        actions={
          <>
            <Button onClick={() => handleScheduleOnDate().catch((err) => { setError(err instanceof Error ? err.message : String(err)); loadData(); })} disabled={!scheduleDateValue.trim()}>
              Schedule
            </Button>
            <Button onClick={() => setScheduleDateOpen(false)}>Cancel</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            Date
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <input
                type="date"
                value={scheduleDateValue}
                onChange={(e) => setScheduleDateValue(e.target.value)}
                style={{ padding: '0.35rem' }}
                ref={scheduleDateInputRef}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  handleScheduleOnDate().catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    loadData();
                  });
                }}
              />
              <button
                type="button"
                title="Open calendar"
                onClick={() => (scheduleDateInputRef.current as HTMLInputElement | null)?.showPicker?.()}
                style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', cursor: 'pointer' }}
              >
                📅
              </button>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={scheduleDueAutoPriority}
              onChange={(e) => setScheduleDueAutoPriority(e.target.checked)}
            />
            Increase priority automatically
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={scheduleNoTime}
              onChange={(e) => setScheduleNoTime(e.target.checked)}
            />
            No specific time (show between header and time slots)
          </label>
          {!scheduleNoTime && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Start time
              <input
                type="time"
                value={scheduleTimeValue}
                onChange={(e) => setScheduleTimeValue(e.target.value)}
                style={{ padding: '0.35rem' }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  handleScheduleOnDate().catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    loadData();
                  });
                }}
              />
            </label>
          )}
        </div>
      </Modal>

      <LinkModal
        open={linkModalTaskId != null}
        onClose={() => { setLinkModalTaskId(null); setLinkModalInitialUrl(''); }}
        taskId={linkModalTaskId}
        initialUrl={linkModalInitialUrl}
        onLinksChange={() => { if (linkModalTaskId != null) handleRefresh(linkModalTaskId); }}
      />

      <TaskListItemsModal
        open={listModalTaskId != null}
        onClose={() => setListModalTaskId(null)}
        taskId={listModalTaskId}
        listStyle={tasks.find((t) => t.id === listModalTaskId)?.list_style ?? 'bullet'}
        onRefresh={() => { if (listModalTaskId != null) handleRefresh(listModalTaskId); }}
        onTaskPatched={mergeTaskFromPatch}
      />

      {organizationModalTaskId != null && (() => {
        const task = tasks.find((t) => t.id === organizationModalTaskId);
        return task ? (
          <OrganizationTaskModal
            task={task}
            categories={organizationCategories}
            subcategories={organizationSubcategories}
            tags={organizationTags}
            onSave={(category_id, subcategory_id, tag_ids) => {
              api.tasks.update({ id: organizationModalTaskId, category_id, subcategory_id, tag_ids }).then(loadData);
              setOrganizationModalTaskId(null);
            }}
            onClose={() => setOrganizationModalTaskId(null)}
            onRefreshTags={() => api.organization.list().then((r) => {
              setOrganizationCategories(r.categories ?? []);
              setOrganizationSubcategories(r.subcategories ?? []);
              setOrganizationTags(r.tags ?? []);
            })}
          />
        ) : null;
      })()}

      {orphanModal && (
        <Modal
          open
          onClose={() => { setOrphanModal(null); clearDragState(); }}
          title="Return task to list"
          actions={
            <>
              <Button
                onClick={() =>
                  resolveOrphanAndMove(
                    orphanModal.taskId,
                    orphanModal.targetListState,
                    'yes',
                    orphanModal.rootSlotId,
                    orphanModal.completedChildSlotIds,
                    orphanModal.incompleteChildSlotIds
                  )
                }
              >
                Yes
              </Button>
              <Button
                onClick={() =>
                  resolveOrphanAndMove(
                    orphanModal.taskId,
                    orphanModal.targetListState,
                    'no',
                    orphanModal.rootSlotId,
                    orphanModal.completedChildSlotIds,
                    orphanModal.incompleteChildSlotIds
                  )
                }
              >
                No
              </Button>
              <Button onClick={() => { setOrphanModal(null); clearDragState(); }}>Cancel</Button>
            </>
          }
        >
          <p>Returning this task will affect other tasks in the same schedule group.</p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>Yes</strong> – Completed grouped tasks stay on the schedule; the root and any still-incomplete members go back to the list.
          </p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>No</strong> – All grouped schedule rows are removed and marked incomplete; the task goes back to the list.
          </p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>Cancel</strong> – Do nothing.
          </p>
        </Modal>
      )}

      {recurringActionModal && (
        <Modal
          open
          onClose={() => setRecurringActionModal(null)}
          title={recurringActionModal.type === 'complete' ? 'Recurring task: complete' : 'Recurring task: remove from schedule'}
          actions={
            <>
              <Button
                onClick={() => {
                  const { type, slot, childSlots } = recurringActionModal;
                  if (type === 'complete') {
                    if (slot.id < 0) {
                      api.slots.completeOccurrence(slot.task_id, viewDate).then(loadData).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        loadData();
                      });
                    } else {
                      const updates = [api.slots.update({ id: slot.id, completed: true })];
                      childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: true })));
                      Promise.all(updates).then(loadData).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        loadData();
                      });
                    }
                  } else {
                    const omitPromise = (() => {
                      const origTask = tasks.find((t) => t.id === slot.task_id) ?? null;
                      if (!origTask) return Promise.resolve();
                      try {
                        const parsed = origTask.recurrence_rule ? JSON.parse(origTask.recurrence_rule) : {};
                        const rule: any = parsed && typeof parsed === 'object' ? parsed : {};
                        const omitDates: string[] = Array.isArray(rule.omitDates) ? rule.omitDates : [];
                        if (!omitDates.includes(viewDate)) omitDates.push(viewDate);
                        rule.omitDates = omitDates;
                        return api.tasks
                          .update({ id: slot.task_id, recurrence_rule: JSON.stringify(rule) })
                          .catch(() => {});
                      } catch {
                        return Promise.resolve();
                      }
                    })();

                    const toDelete = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                    const deletePromise = toDelete.length > 0 ? Promise.all(toDelete.map((id) => api.slots.delete(id))) : Promise.resolve();

                    Promise.all([omitPromise, deletePromise])
                      .then(() => {
                        loadData();
                      })
                      .catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        loadData();
                      });
                  }
                  setRecurringActionModal(null);
                }}
              >
                This occurrence only
              </Button>
              <Button
                onClick={() => {
                  const { type, slot, childSlots } = recurringActionModal;
                  if (type === 'complete') {
                    if (slot.id < 0) {
                      api.slots.completeOccurrence(slot.task_id, viewDate).then(() =>
                        api.tasks.update({ id: slot.task_id, recurring: false })
                      ).then(loadData).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        loadData();
                      });
                    } else {
                      const updates = [api.slots.update({ id: slot.id, completed: true })];
                      childSlots.forEach((c) => updates.push(api.slots.update({ id: c.id, completed: true })));
                      Promise.all(updates)
                        .then(() => api.tasks.update({ id: slot.task_id, recurring: false }))
                        .then(loadData)
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : String(err));
                          loadData();
                        });
                    }
                  } else {
                    // Full delete: removes the recurring series (and any direct child tasks) instead of only disabling recurrence.
                    api.tasks.delete(slot.task_id).then(loadData).catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                      loadData();
                    });
                  }
                  setRecurringActionModal(null);
                }}
              >
                All occurrences
              </Button>
              <Button onClick={() => setRecurringActionModal(null)}>Cancel</Button>
            </>
          }
        >
          <p>
            {recurringActionModal.type === 'complete'
              ? 'Mark this occurrence complete only, or stop recurring so it won’t be copied to future days?'
              : 'Remove this occurrence from the schedule only, or stop recurring and remove from schedule?'}
          </p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>This occurrence only</strong> – Affects only today’s schedule. The task will still recur (copy-on-day-end for completed).
          </p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>All occurrences</strong> – Delete the recurring series so it won’t appear on future days.
          </p>
        </Modal>
      )}

      <Modal
        open={scheduleBulkPriorityOpen}
        onClose={() => setScheduleBulkPriorityOpen(false)}
        title="Set priority for selected"
        actions={
          <Button type="button" onClick={() => setScheduleBulkPriorityOpen(false)}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.5rem 0' }}>
          {PRIORITIES.map((p) => (
            <Button key={p} type="button" onClick={() => runBulkSetPriority(p)}>
              {p}
            </Button>
          ))}
        </div>
      </Modal>

      <Modal
        open={scheduleBulkRescheduleOpen}
        onClose={() => {
          setScheduleBulkRescheduleOpen(false);
          setScheduleBulkRescheduleDate('');
        }}
        title="Reschedule selected to date"
        actions={
          <>
            <Button type="button" onClick={() => runBulkReschedule()}>
              Move
            </Button>
            <Button
              type="button"
              onClick={() => {
                setScheduleBulkRescheduleOpen(false);
                setScheduleBulkRescheduleDate('');
              }}
            >
              Cancel
            </Button>
          </>
        }
      >
        <label className="time-settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', padding: '0.5rem 0' }}>
          Date
          <input
            type="date"
            title="Target date for selected tasks"
            aria-label="Target date for selected tasks"
            value={scheduleBulkRescheduleDate}
            onChange={(e) => setScheduleBulkRescheduleDate(e.target.value)}
          />
        </label>
      </Modal>

      {recurringResizeModal && (
        <Modal
          open
          onClose={() => {
            setRecurringResizeModal(null);
            refetchSlotsForViewDay();
          }}
          title="Recurring task: change time"
          actions={
            <>
              <Button
                onClick={() => {
                  const { slot, newStartTime, newEndTime } = recurringResizeModal;
                  if (newStartTime == null || newEndTime == null) {
                    setRecurringResizeModal(null);
                    return;
                  }
                  api.slots.listByDateRange(
                    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                  ).then((res) => {
                    const allSlotsForTask: number[] = [];
                    Object.values(res.byDate ?? {}).forEach((arr: ScheduledSlot[]) => {
                      arr.forEach((s) => {
                        if (s.task_id === slot.task_id && s.id > 0) allSlotsForTask.push(s.id);
                      });
                    });
                    return Promise.all(
                      allSlotsForTask.map((id) => api.slots.update({ id, start_time: newStartTime, end_time: newEndTime }))
                    );
                  })
                    .then(() => refetchSlotsForViewDay())
                    .catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                      loadData();
                    });
                  setRecurringResizeModal(null);
                }}
              >
                Change time for all recurring tasks
              </Button>
              <Button
                onClick={() => {
                  const { slot, childSlots, newStartTime, newEndTime } = recurringResizeModal;
                  if (newStartTime == null || newEndTime == null) {
                    setRecurringResizeModal(null);
                    return;
                  }
                  const task = tasks.find((t) => t.id === slot.task_id);

                  const omitPromise = (() => {
                    if (!task) return Promise.resolve();
                    try {
                      const parsed = task.recurrence_rule ? JSON.parse(task.recurrence_rule) : {};
                      const rule: any = parsed && typeof parsed === 'object' ? parsed : {};
                      const omitDates: string[] = Array.isArray(rule.omitDates) ? rule.omitDates : [];
                      if (!omitDates.includes(viewDate)) omitDates.push(viewDate);
                      rule.omitDates = omitDates;
                      return api.tasks
                        .update({ id: slot.task_id, recurrence_rule: JSON.stringify(rule) })
                        .catch(() => {});
                    } catch {
                      return Promise.resolve();
                    }
                  })();

                  api.tasks.create({
                    title: task?.title ?? 'Task',
                    priority: (task?.priority as Priority) ?? 'low',
                    recurring: false,
                  }).then((newTask) =>
                    api.day.getOrCreate(viewDate).then((day) =>
                      api.slots.create({
                        day_record_id: day.id,
                        task_id: newTask.id,
                        start_time: newStartTime,
                        end_time: newEndTime,
                      }).then(() => {
                        const toDelete = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                        return Promise.all(toDelete.map((id) => api.slots.delete(id)));
                      })
                    )
                  ).then(() => {
                    return omitPromise.then(() => {
                      loadData();
                      refetchSlotsForViewDay();
                    });
                  }).catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    loadData();
                  });
                  setRecurringResizeModal(null);
                }}
              >
                This occurrence only (becomes one-off task)
              </Button>
              <Button
                onClick={() => {
                  setRecurringResizeModal(null);
                  refetchSlotsForViewDay();
                }}
              >
                Cancel
              </Button>
            </>
          }
        >
          <p>This is a recurring task. Change the time for this occurrence only (creates a one-off task), or change time for all future and past occurrences?</p>
        </Modal>
      )}

      {futureCompleteModal && (
        <Modal
          open
          onClose={() => setFutureCompleteModal(null)}
          title="Complete for today?"
          actions={
            <>
              <Button
                onClick={() => {
                  const { slot } = futureCompleteModal;
                  setFutureCompleteModal(null);
                  api.day.getOrCreate(today()).then((day) =>
                    api.slots.create({
                      day_record_id: day.id,
                      task_id: slot.task_id,
                      completed: true,
                      start_time: slot.start_time ?? undefined,
                      end_time: slot.end_time ?? undefined,
                    })
                  ).then(() => {
                    if (slot.id > 0) return api.slots.delete(slot.id);
                  }).then(() => { loadData(); }).catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    loadData();
                  });
                }}
              >
                Yes – archive as completed for today
              </Button>
              <Button onClick={() => setFutureCompleteModal(null)}>Cancel</Button>
            </>
          }
        >
          <p>This task is scheduled for a future date. Do you want to mark it as completed for today instead?</p>
        </Modal>
      )}

      {recurringConfigModal && (
        <RecurringConfigModal
          taskId={recurringConfigModal.taskId}
          recurring={recurringConfigModal.recurring}
          freq={recurringConfigModal.freq}
          time={recurringConfigModal.time}
          weekDays={recurringConfigModal.weekDays}
          monthDays={recurringConfigModal.monthDays}
          lastDayOfMonth={recurringConfigModal.lastDayOfMonth}
          count={recurringConfigModal.count}
          startDate={recurringConfigModal.startDate}
          onClose={() => setRecurringConfigModal(null)}
          onSave={(updates) => {
            setRecurringConfigModal(null);
            api.tasks.update(updates).then((res) => {
              if (res.task) {
                setTasks((prev) => prev.map((t) => (t.id === res.task!.id ? { ...t, ...res.task } : t)));
              }
              if (scheduleTab === 'calendar') {
                const { from, to } = getMonthRange(calendarMonth);
                api.slots.listByDateRange(from, to).then((r) => setCalendarSlotsByDate(r.byDate ?? {})).catch(() => {});
              }
              refetchSlotsForViewDay();
            }).catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
              loadData();
            });
          }}
        />
      )}

    </>
  );
}

function RecurringConfigModal({
  taskId,
  recurring,
  freq,
  time,
  weekDays,
  monthDays,
  lastDayOfMonth,
  count: countProp,
  startDate: startDateProp,
  onClose,
  onSave,
}: {
  taskId: number;
  recurring: boolean;
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  time: string;
  weekDays: number[];
  monthDays: number[];
  lastDayOfMonth: boolean;
  count?: number;
  startDate?: string;
  onClose: () => void;
  onSave: (updates: { id: number; recurring: boolean; recurrence_rule: string }) => void;
}) {
  const [checked, setChecked] = useState(recurring);
  const [freqVal, setFreqVal] = useState(freq);
  const [timeVal, setTimeVal] = useState(time || '09:00');
  const [weekDaysVal, setWeekDaysVal] = useState<number[]>(weekDays);
  const [monthDaysVal, setMonthDaysVal] = useState<number[]>(monthDays);
  const [lastDayVal, setLastDayVal] = useState(lastDayOfMonth);
  const [countVal, setCountVal] = useState<string>(countProp != null && countProp > 0 ? String(countProp) : '');
  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const handleSave = () => {
    if (checked && freqVal === 'weekly' && weekDaysVal.length === 0) {
      alert('Please select at least one day for weekly recurrence.');
      return;
    }
    const rule: Record<string, unknown> = { freq: freqVal, time: timeVal };
    if (freqVal === 'weekly') rule.weekDays = weekDaysVal;
    if (freqVal === 'monthly') {
      rule.monthDays = monthDaysVal;
      rule.lastDayOfMonth = lastDayVal;
    }
    const n = parseInt(countVal, 10);
    if (n > 0) rule.count = n;
    const startDate = startDateProp && /^\d{4}-\d{2}-\d{2}$/.test(startDateProp) ? startDateProp : today();
    rule.startDate = startDate;
    onSave({
      id: taskId,
      recurring: checked,
      recurrence_rule: checked ? JSON.stringify(rule) : '',
    });
  };
  const has31 = monthDaysVal.includes(31);
  return (
    <Modal open onClose={onClose} title="Recurring" actions={<><Button onClick={handleSave}>Save</Button><Button onClick={onClose}>Cancel</Button></>}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Recurring
      </label>
      {checked && (
        <>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Frequency</label>
          <select value={freqVal} onChange={(e) => setFreqVal(e.target.value as typeof freqVal)} style={{ marginBottom: '1rem', padding: '0.3rem' }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            Time
            <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} style={{ minWidth: '8rem' }} />
          </label>
          {freqVal === 'weekly' && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.35rem' }}>Days</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {WEEKDAY_LABELS.map((label, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={weekDaysVal.includes(i)}
                      onChange={(e) => {
                        if (e.target.checked) setWeekDaysVal([...weekDaysVal, i].sort((a, b) => a - b));
                        else setWeekDaysVal(weekDaysVal.filter((d) => d !== i));
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {freqVal === 'monthly' && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.35rem' }}>Days of month</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <label key={d} style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={monthDaysVal.includes(d)}
                      onChange={(e) => {
                        if (e.target.checked) setMonthDaysVal([...monthDaysVal, d].sort((a, b) => a - b));
                        else setMonthDaysVal(monthDaysVal.filter((x) => x !== d));
                      }}
                    />
                    <span style={{ marginLeft: '0.15rem', minWidth: '1.5rem' }}>{d}</span>
                  </label>
                ))}
              </div>
              {(has31 || monthDaysVal.includes(30)) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={lastDayVal} onChange={(e) => setLastDayVal(e.target.checked)} />
                  Last day of month (e.g. Feb 28/29 when 30th or 31st selected; otherwise 31st = only months with 31 days)
                </label>
              )}
            </div>
          )}
          {freqVal === 'yearly' && (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Yearly recurrence uses the task&apos;s creation date. Copy-on-day-end applies when completed.</p>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
            Repeat (times)
            <input
              type="number"
              min={1}
              placeholder="Optional"
              value={countVal}
              onChange={(e) => setCountVal(e.target.value.replace(/\D/g, ''))}
              style={{ width: '5rem', padding: '0.3rem' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Stop after this many occurrences (optional)</span>
          </label>
        </>
      )}
    </Modal>
  );
}

function OrganizationTaskModal({
  task,
  categories,
  subcategories,
  tags,
  onSave,
  onClose,
  onRefreshTags,
}: {
  task: Task;
  categories: Array<{ id: number; name: string; color?: string | null }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
  onSave: (category_id: number | null, subcategory_id: number | null, tag_ids: number[]) => void;
  onClose: () => void;
  onRefreshTags: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number | null>(task.category_id ?? null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(task.subcategory_id ?? null);
  const [tagIds, setTagIds] = useState<number[]>(task.tag_ids ?? []);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const subcategoryOptions = subcategories.filter((s) => s.category_id === (categoryId ?? 0));
  const tagSuggestions = tagInput.trim()
    ? tags.filter((t) => t.name.toLowerCase().includes(tagInput.trim().toLowerCase()) && !tagIds.includes(t.id))
    : tags.filter((t) => !tagIds.includes(t.id));

  useEffect(() => {
    setCategoryId(task.category_id ?? null);
    setSubcategoryId(task.subcategory_id ?? null);
    setTagIds(task.tag_ids ?? []);
  }, [task.id, task.category_id, task.subcategory_id, task.tag_ids]);

  useEffect(() => {
    if (categoryId == null) setSubcategoryId(null);
    else if (subcategoryId != null && !subcategoryOptions.some((s) => s.id === subcategoryId)) setSubcategoryId(null);
  }, [categoryId, subcategoryId, subcategoryOptions]);

  const addTag = (tag: { id: number; name: string }) => {
    if (!tagIds.includes(tag.id)) setTagIds((prev) => [...prev, tag.id]);
    setTagInput('');
    setTagSuggestOpen(false);
  };
  const createAndAddTag = () => {
    const name = tagInput.trim();
    if (!name) return;
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      addTag(existing);
      return;
    }
    api.organization.createTag({ name }).then((created) => {
      onRefreshTags();
      setTagIds((prev) => [...prev, created.id]);
      setTagInput('');
      setTagSuggestOpen(false);
    }).catch(() => {});
  };
  const removeTag = (id: number) => setTagIds((prev) => prev.filter((tid) => tid !== id));

  return (
    <Modal
      open
      onClose={onClose}
      title="Category & tags"
      actions={
        <>
          <Button onClick={() => onSave(categoryId, subcategoryId, tagIds)}>Save</Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Category
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value === '' ? null : Number(e.target.value))}
            style={{ padding: '0.35rem' }}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {categoryId != null && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Subcategory
            <select
              value={subcategoryId ?? ''}
              onChange={(e) => setSubcategoryId(e.target.value === '' ? null : Number(e.target.value))}
              style={{ padding: '0.35rem' }}
            >
              <option value="">— None —</option>
              {subcategoryOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label>Tags</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
            {tagIds.map((tid) => {
              const t = tags.find((x) => x.id === tid);
              return t ? (
                <span
                  key={t.id}
                  className="task-org-tag-chip"
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '999px',
                    fontSize: '0.85rem',
                    backgroundColor: t.color ?? 'var(--surface)',
                    color: t.color ? (t.color.startsWith('hsl') && t.color.includes('65%') ? '#fff' : '#000') : 'var(--text)',
                  }}
                >
                  {t.name}
                  <button type="button" aria-label="Remove tag" onClick={() => removeTag(t.id)} style={{ marginLeft: '0.35rem', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                </span>
              ) : null;
            })}
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Add tag…"
                value={tagInput}
                onChange={(e) => { setTagInput(e.target.value); setTagSuggestOpen(true); }}
                onFocus={() => setTagSuggestOpen(true)}
                onBlur={() => setTimeout(() => setTagSuggestOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createAndAddTag(); } }}
                style={{ padding: '0.35rem 0.5rem', minWidth: '8rem' }}
              />
              {tagSuggestOpen && (tagSuggestions.length > 0 || tagInput.trim()) && (
                <ul
                  className="task-org-tag-suggest"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    margin: 0,
                    padding: '0.25rem 0.5rem',
                    listStyle: 'none',
                    background: 'var(--surface-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.35rem',
                    zIndex: 10,
                    maxHeight: '12rem',
                    overflow: 'auto',
                    color: 'var(--text)',
                  }}
                >
                  {tagSuggestions.slice(0, 10).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => addTag(t)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.25rem 0.5rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text)',
                        }}
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                  {tagInput.trim() && !tags.some((t) => t.name.toLowerCase() === tagInput.trim().toLowerCase()) && (
                    <li>
                      <button
                        type="button"
                        onClick={createAndAddTag}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.25rem 0.5rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--accent)',
                        }}
                      >
                        Create &quot;{tagInput.trim()}&quot;
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TaskCard({
  task,
  tasks,
  links,
  listItems,
  editingTaskId,
  editingTitle,
  onEditingTitleChange,
  onEditStart,
  onEditSave,
  onEditCancel,
  onPriorityChange,
  onUngroupGroup,
  onRecurringToggle,
  onMoveToPending,
  onMoveToUnassigned,
  onScheduleDate,
  onOpenLinks,
  onOpenList,
  onDelete,
  onRefresh,
  onTaskPatched,
  highlightBlink,
  dragSource,
  draggingTaskId,
  draggingTaskIds,
  isDragging,
  isDropTarget,
  isSelected,
  onToggleSelect,
  onHoldStart,
  onHoldStartGroupMember,
  isUrlDragOver,
  onUrlDragEnter,
  onUrlDragLeave,
  taskLinksByTaskId,
  taskListItemsByTaskId,
  isMobile = false,
  onToggleComplete: _onToggleComplete,
  organizationCategories,
  organizationSubcategories,
  organizationTags,
  onOpenOrganization,
  onTaskUpdate,
  onSetIsCommon,
}: {
  task: Task;
  tasks: Task[];
  links: TaskLink[];
  listItems: TaskListItem[];
  editingTaskId: number | null;
  editingTitle: string;
  onEditingTitleChange: (v: string) => void;
  onEditStart: (id: number, title: string) => void;
  onEditSave: (id: number, title: string) => void;
  onEditCancel: () => void;
  onPriorityChange: (id: number, p: Priority) => void;
  onUngroupGroup?: (rootId: number) => void;
  onRecurringToggle: (id: number) => void;
  onMoveToPending: ((id: number) => void) | undefined;
  onMoveToUnassigned: ((id: number) => void) | undefined;
  onScheduleDate: (id: number) => void;
  onOpenLinks: (id: number, initialUrl?: string) => void;
  onOpenList: (id: number) => void;
  onDelete: (id: number) => void;
  onRefresh?: (taskId?: number) => void;
  onTaskPatched?: (task: Task) => void;
  highlightBlink?: boolean;
  dragSource?: 'unassigned' | 'pending' | 'common';
  draggingTaskId?: number | null;
  draggingTaskIds?: Set<number>;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (taskId: number) => void;
  onHoldStart?: (e: React.PointerEvent) => void;
  onHoldStartGroupMember?: (e: React.PointerEvent, taskId: number) => void;
  isUrlDragOver?: boolean;
  onUrlDragEnter?: () => void;
  onUrlDragLeave?: () => void;
  taskLinksByTaskId?: Record<number, TaskLink[]>;
  taskListItemsByTaskId?: Record<number, TaskListItem[]>;
  isMobile?: boolean;
  onToggleComplete?: (taskId: number) => void;
  organizationCategories?: Array<{ id: number; name: string; color?: string | null }>;
  organizationSubcategories?: Array<{ id: number; category_id: number; name: string }>;
  organizationTags?: Array<{ id: number; name: string; color?: string | null }>;
  onOpenOrganization?: (taskId: number) => void;
  onTaskUpdate?: () => void;
  onSetIsCommon?: (id: number, isCommon: boolean) => void;
}) {
  const organizationCategoriesList = organizationCategories ?? [];
  const organizationSubcategoriesList = organizationSubcategories ?? [];
  const organizationTagsList = organizationTags ?? [];
  const categoryName = task.category_id != null ? organizationCategoriesList.find((c) => c.id === task.category_id)?.name : null;
  const subcategoryName = task.subcategory_id != null ? organizationSubcategoriesList.find((s) => s.id === task.subcategory_id)?.name : null;
  const taskTags = (task.tag_ids ?? []).map((tid) => organizationTagsList.find((t) => t.id === tid)).filter(Boolean) as Array<{ id: number; name: string; color?: string | null }>;
  const [actionsDrawerOpen, setActionsDrawerOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [editingLinkUrl, setEditingLinkUrl] = useState('');
  const [editingLinkDesc, setEditingLinkDesc] = useState('');
  const [editingListItemId, setEditingListItemId] = useState<number | null>(null);
  const [editingListItemContent, setEditingListItemContent] = useState('');
  const [newListItemDraftById, setNewListItemDraftById] = useState<Record<number, string>>({});
  const [subPriorityOpenId, setSubPriorityOpenId] = useState<number | null>(null);
  const [memberActionsDrawerTaskId, setMemberActionsDrawerTaskId] = useState<number | null>(null);
  const [linksCollapsed, setLinksCollapsed] = useState(true);
  const [listCollapsed, setListCollapsed] = useState(true);
  /** Per–group-member toggles for links / list sections (stacked rows stay visible; only sections collapse). */
  const [groupMemberLinksCollapsed, setGroupMemberLinksCollapsed] = useState<Record<number, boolean>>({});
  const [groupMemberListCollapsed, setGroupMemberListCollapsed] = useState<Record<number, boolean>>({});
  const isEditing = editingTaskId === task.id;
  const childTasks = tasks.filter((t) => t.parent_id === task.id);
  const hasLinksOrList = links.length > 0 || listItems.length > 0;
  const linksTooltip = links.length > 0
    ? links.map((l) => l.description?.trim() || l.url).filter(Boolean).join(' · ') || 'Links'
    : '';

  const isGrouped = childTasks.length > 0;
  const listDraft = (id: number) => newListItemDraftById[id] ?? '';
  const setListDraft = (id: number, v: string) =>
    setNewListItemDraftById((m) => ({ ...m, [id]: v }));

  const renderLinksListRich = (
    segTask: Task,
    segLinks: TaskLink[],
    segListItems: TaskListItem[],
    linkShut: boolean,
    toggleLinks: () => void,
    listShut: boolean,
    toggleList: () => void,
  ) => {
    const segLinksPeek =
      segLinks.length > 0
        ? segLinks.map((l) => l.description?.trim() || l.url).filter(Boolean).join(' · ') || 'Links'
        : '';
    return (
      <div className="task-card-rich">
        {segLinks.length > 0 && (
          <div className="task-card-details-section task-card-links-section">
            <div className="task-card-details-section-header">
              <button
                type="button"
                className="task-card-details-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLinks();
                }}
                aria-expanded={!linkShut}
              >
                {linkShut ? '▶' : '▼'}
              </button>
              {linkShut ? (
                <span className="task-card-details-label-inline" title={segLinksPeek}>
                  Links…{' '}
                  {segLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="task-card-link-icon-inline"
                      title={link.description?.trim() || link.url}
                      aria-label={link.description?.trim() || link.url}
                    >
                      🔗
                    </a>
                  ))}
                </span>
              ) : (
                <div className="task-card-links">
                  {segLinks.map((link) => (
                    <span key={link.id} className="task-card-link-row">
                      {editingLinkId === link.id ? (
                        <>
                          <input
                            className="task-card-link-edit-input"
                            value={editingLinkUrl}
                            onChange={(e) => setEditingLinkUrl(e.target.value)}
                            placeholder="URL"
                          />
                          <input
                            className="task-card-link-edit-input"
                            value={editingLinkDesc}
                            onChange={(e) => setEditingLinkDesc(e.target.value)}
                            placeholder="Description"
                          />
                          <button
                            type="button"
                            className="task-card-link-save"
                            onClick={() => {
                              api.links
                                .update({ id: link.id, url: editingLinkUrl.trim(), description: editingLinkDesc.trim() })
                                .then(() => {
                                  setEditingLinkId(null);
                                  onRefresh?.(segTask.id);
                                });
                            }}
                          >
                            Save
                          </button>
                          <button type="button" className="task-card-link-cancel" onClick={() => setEditingLinkId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                            {link.description?.trim() || link.url}
                          </a>
                          <button
                            type="button"
                            className="task-card-link-edit"
                            title="Edit in place"
                            onClick={() => {
                              setEditingLinkId(link.id);
                              setEditingLinkUrl(link.url);
                              setEditingLinkDesc(link.description ?? '');
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="task-card-link-delete trash-btn"
                            title="Remove link"
                            onClick={() => api.links.delete(link.id).then(() => onRefresh?.(segTask.id))}
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </span>
                  ))}
                  <button type="button" className="task-card-link-add" title="Add link" onClick={() => onOpenLinks(segTask.id)}>
                    + link
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {segListItems.length > 0 && (
          <div className="task-card-details-section task-card-list-section">
            <div className="task-card-details-section-header">
              <button
                type="button"
                className="task-card-details-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleList();
                }}
                aria-expanded={!listShut}
              >
                {listShut ? '▶' : '▼'}
              </button>
              {listShut ? (
                <span className="task-card-details-label-inline">List…</span>
              ) : (
                <div className="task-card-list-expanded-wrap">
                  <span
                    className="task-card-list-style-selector"
                    role="group"
                    aria-label="List style"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={'task-card-list-style-btn' + ((segTask.list_style ?? 'bullet') === 'bullet' ? ' active' : '')}
                      title="Bullet list"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const wasChecklist = (segTask.list_style ?? 'bullet') === 'checklist';
                        if (wasChecklist && segListItems.some((i) => i.completed)) {
                          if (
                            !confirm(
                              'Switch from checklist to bullet list? Checked items keep their done state but show as bullets without checkboxes.'
                            )
                          ) {
                            return;
                          }
                        }
                        api.tasks
                          .update({ id: segTask.id, list_style: 'bullet' })
                          .then((res) => {
                            const merged = res?.task ?? { ...segTask, list_style: 'bullet' as const };
                            onTaskPatched?.(merged);
                            onRefresh?.(segTask.id);
                            onTaskUpdate?.();
                          });
                      }}
                    >
                      •
                    </button>
                    <button
                      type="button"
                      className={'task-card-list-style-btn' + ((segTask.list_style ?? 'bullet') === 'checklist' ? ' active' : '')}
                      title="Checklist"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        api.tasks
                          .update({ id: segTask.id, list_style: 'checklist' })
                          .then((res) => {
                            const merged = res?.task ?? { ...segTask, list_style: 'checklist' as const };
                            onTaskPatched?.(merged);
                            onRefresh?.(segTask.id);
                            onTaskUpdate?.();
                          });
                      }}
                    >
                      ☐
                    </button>
                  </span>
                  <div className="task-card-list">
                    {segListItems.map((item) => (
                      <div
                        key={item.id}
                        className={
                          'task-card-list-item' +
                          ((segTask.list_style ?? 'bullet') === 'checklist' ? ' task-card-list-item-checklist' : '')
                        }
                      >
                        {(segTask.list_style ?? 'bullet') === 'bullet' && <span className="task-card-list-bullet" aria-hidden>•</span>}
                        {(segTask.list_style ?? 'bullet') === 'checklist' && (
                          <span className="task-card-list-check" aria-hidden>
                            {item.completed ? '☑' : '☐'}
                          </span>
                        )}
                        {editingListItemId === item.id ? (
                          <>
                            <input
                              className="task-card-list-edit-input"
                              value={editingListItemContent}
                              onChange={(e) => setEditingListItemContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  api.taskListItems
                                    .update({ id: item.id, content: editingListItemContent.trim() || item.content })
                                    .then(() => {
                                      setEditingListItemId(null);
                                      onRefresh?.(segTask.id);
                                    });
                                }
                                if (e.key === 'Escape') setEditingListItemId(null);
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="task-card-list-item-save"
                              onClick={() =>
                                api.taskListItems
                                  .update({ id: item.id, content: editingListItemContent.trim() || item.content })
                                  .then(() => {
                                    setEditingListItemId(null);
                                    onRefresh?.(segTask.id);
                                  })
                              }
                            >
                              ✓
                            </button>
                          </>
                        ) : (
                          <span
                            className="task-card-list-content"
                            style={item.completed ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : undefined}
                            onDoubleClick={() => {
                              setEditingListItemId(item.id);
                              setEditingListItemContent(item.content);
                            }}
                          >
                            {item.content}
                          </span>
                        )}
                        {editingListItemId !== item.id && (
                          <button
                            type="button"
                            className="task-card-list-item-delete trash-btn"
                            title="Remove"
                            onClick={() => api.taskListItems.delete(item.id).then(() => onRefresh?.(segTask.id))}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    ))}
                    <form
                      className="task-card-list-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const content = listDraft(segTask.id).trim();
                        if (content) {
                          api.taskListItems
                            .create({ task_id: segTask.id, content, order_index: segListItems.length })
                            .then(() => {
                              setListDraft(segTask.id, '');
                              onRefresh?.(segTask.id);
                            });
                        }
                      }}
                    >
                      <input
                        className="task-card-list-new-input"
                        value={listDraft(segTask.id)}
                        onChange={(e) => setListDraft(segTask.id, e.target.value)}
                        placeholder="+ Add item"
                      />
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <li
      className={
        'task-card' +
        (highlightBlink ? ' task-card-blink' : '') +
        (isDragging ? ' task-card-dragging' : '') +
        (isDropTarget ? ' task-card-drop-target' : '') +
        (isSelected ? ' task-card-selected' : '') +
        (isUrlDragOver ? ' task-card-drop-url' : '') +
        (isMobile ? ' task-card-mobile' : '') +
        (task.is_common ? ' task-card-common' : '')
      }
      data-task-id={task.id}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'link';
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
          onUrlDragEnter?.();
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          onUrlDragLeave?.();
        }
      }}
      onDrop={(e) => {
        const url = extractUrlFromDrop(e);
        if (url) {
          e.preventDefault();
          onUrlDragLeave?.();
          onOpenLinks(task.id, url);
        }
      }}
    >
      {!isGrouped ? (
        <>
      <div
        className="task-card-top"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button, input') != null) return;
          if (e.ctrlKey) {
            onToggleSelect?.(task.id);
            return;
          }
          if (dragSource) onHoldStart?.(e);
        }}
      >
        <div className="task-row">
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={'priority-btn priority-' + (task.priority || 'low')}
              title="Priority"
              onClick={() => setPriorityOpen((o) => !o)}
            >
              {priorityIcon(task.priority)}
            </button>
            {priorityOpen && (
              <div className="priority-picker" role="listbox">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={'priority-picker-option ' + (task.priority === p ? 'selected' : '') + ' priority-' + p}
                    onClick={() => {
                      if (childTasks.length > 0) {
                        onPriorityChange(task.id, p);
                        childTasks.forEach((c) => onPriorityChange(c.id, p));
                      } else {
                        onPriorityChange(task.id, p);
                      }
                      setPriorityOpen(false);
                    }}
                  >
                    {priorityLabel(p)} {priorityIcon(p)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="task-title-wrap task-title-wrap-stacked">
            <span className="task-title-line">
              {isEditing ? (
                <input
                  className="task-title-edit"
                  value={editingTitle}
                  onChange={(e) => onEditingTitleChange(e.target.value)}
                  onBlur={() => onEditSave(task.id, editingTitle.trim() || task.title)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onEditSave(task.id, editingTitle.trim() || task.title);
                    if (e.key === 'Escape') onEditCancel();
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="task-title"
                  onDoubleClick={() => onEditStart(task.id, task.title)}
                >
                  {task.title}
                </span>
              )}
              {links.length > 0 && linksCollapsed && (
                <span className="task-card-links-collapsed-icon" title={linksTooltip} aria-label="Links">🔗</span>
              )}
              {task.created_at && (
                <span className="task-date-added">
                  {new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </span>
            {(categoryName != null || subcategoryName != null || taskTags.length > 0) && (
              <span className="task-card-meta-below">
                {(categoryName != null || subcategoryName != null) && (
                  <span className="task-card-meta-cat">
                    {categoryName != null && <span>{categoryName}</span>}
                    {subcategoryName != null && <span>{categoryName != null ? ' › ' : ''}{subcategoryName}</span>}
                  </span>
                )}
                {taskTags.length > 0 && (
                  <span className="task-card-meta-tags">
                    {taskTags.map((t) => (
                      <span
                        key={t.id}
                        className="task-card-tag-chip"
                        style={{
                          backgroundColor: t.color ?? 'var(--surface)',
                          color: t.color ? (t.color.startsWith('hsl') && t.color.includes('65%') ? '#fff' : '#000') : 'var(--text)',
                        }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="task-row-desktop-actions">
            <button
              type="button"
              className={'cycle-btn' + (task.recurring ? ' depressed' : '')}
              title="Recurring"
              onClick={() => onRecurringToggle(task.id)}
            >
              ↻
            </button>
            {onOpenOrganization && (
              <button type="button" className="task-list-add-btn" title="Category & tags" onClick={() => onOpenOrganization(task.id)}>
                📁<sup className="task-list-add-plus">+</sup>
              </button>
            )}
            <button type="button" className="links-btn" title="Add link" onClick={() => onOpenLinks(task.id)}>
              🔗<span className="link-plus">+</span>
            </button>
            <button type="button" className="task-list-add-btn" title="Add list / List items" onClick={() => onOpenList(task.id)}>
              📋<sup className="task-list-add-plus">+</sup>
            </button>
            <button type="button" className="task-calendar-btn" title="Schedule on a date" onClick={() => onScheduleDate(task.id)}>
              📅
            </button>
            <button type="button" className="trash-btn" title="Delete" onClick={() => onDelete(task.id)}>
              🗑
            </button>
          </span>
          <span className="task-row-mobile-actions task-row-drawer-actions" style={{ position: 'relative' }}>
            <button
              type="button"
              className="task-card-drawer-chevron"
              title={actionsDrawerOpen ? 'Close' : 'Actions'}
              aria-expanded={actionsDrawerOpen}
              onClick={() => setActionsDrawerOpen((o) => !o)}
            >
              {actionsDrawerOpen ? '▶' : '◀'}
            </button>
            {actionsDrawerOpen && (
              <div className="task-card-actions-drawer">
                {onOpenOrganization && (
                  <>
                    <button type="button" title="Category & tags" onClick={() => { onOpenOrganization(task.id); setActionsDrawerOpen(false); }}>📁</button>
                    {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                  </>
                )}
                <button type="button" title="Add link" onClick={() => { onOpenLinks(task.id); setActionsDrawerOpen(false); }}>🔗</button>
                {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                <button type="button" title="Add list / List items" onClick={() => { onOpenList(task.id); setActionsDrawerOpen(false); }}>📋</button>
                {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                <button type="button" title="Schedule on a date" onClick={() => { onScheduleDate(task.id); setActionsDrawerOpen(false); }}>📅</button>
                {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                <button type="button" title="Recurring" onClick={() => { onRecurringToggle(task.id); setActionsDrawerOpen(false); }}>{task.recurring ? '↻' : '↻'}</button>
                {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                <button type="button" className="trash-btn" title="Delete" onClick={() => { if (confirm('Delete this task?')) onDelete(task.id); setActionsDrawerOpen(false); }}>🗑</button>
                {!isMobile && (
                  <span className="task-card-drawer-divider task-card-drawer-end" aria-hidden>&gt;</span>
                )}
              </div>
            )}
          </span>
          {onMoveToPending && (
            <button
              type="button"
              className="add-task-btn"
              style={{ fontSize: '0.7rem' }}
              onClick={() => onMoveToPending(task.id)}
              title="Move to Pending"
            >
              To Pending
            </button>
          )}
          {onMoveToUnassigned && (
            <button
              type="button"
              className="add-task-btn"
              style={{ fontSize: '0.7rem' }}
              onClick={() => onMoveToUnassigned(task.id)}
              title="Move to Unassigned"
            >
              To Unassigned
            </button>
          )}
          {!!task.is_common && onSetIsCommon && (
            <button
              type="button"
              className="task-action-icon-btn task-card-template-unset-btn"
              onClick={() => onSetIsCommon(task.id, false)}
              title="Remove from Common Tasks"
            >
              <span aria-hidden>✖</span>
            </button>
          )}
          {!task.is_common &&
            !task.parent_id &&
            childTasks.length === 0 &&
            (dragSource === 'unassigned' || dragSource === 'pending') &&
            onSetIsCommon && (
              <button
                type="button"
                className="task-action-icon-btn task-card-template-save-btn"
                onClick={() => onSetIsCommon(task.id, true)}
                title="Save as reusable template"
              >
                <span aria-hidden>🗂️</span>
              </button>
            )}
        </div>
      </div>
      {hasLinksOrList && (
        <>
          <hr className="task-card-divider-incomplete" aria-hidden />
          {renderLinksListRich(
            task,
            links,
            listItems,
            linksCollapsed,
            () => setLinksCollapsed((c) => !c),
            listCollapsed,
            () => setListCollapsed((c) => !c),
          )}
        </>
      )}
        </>
      ) : (
        <div className="task-card-group-stack">
          <div className="task-card-group-stack-header">
            <span className="task-card-details-label">Group</span>
            <button
              type="button"
              className="task-card-subtask-btn"
              title="Split group (clear membership for all tasks in this group)"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Split this group? Tasks stay on your list but are no longer grouped together.')) onUngroupGroup?.(task.id);
              }}
            >
              ↩
            </button>
          </div>
          <hr className="task-card-group-stack-divider" aria-hidden />
          {[task, ...childTasks].map((segTask, segIdx) => {
            const isRootSeg = segIdx === 0;
            const segLinks = isRootSeg ? links : (taskLinksByTaskId?.[segTask.id] ?? []);
            const segListItems = isRootSeg ? listItems : (taskListItemsByTaskId?.[segTask.id] ?? []);
            const hasSegRich = segLinks.length > 0 || segListItems.length > 0;
            const linkShut = isRootSeg ? linksCollapsed : (groupMemberLinksCollapsed[segTask.id] ?? true);
            const listShut = isRootSeg ? listCollapsed : (groupMemberListCollapsed[segTask.id] ?? true);
            const segLinksTooltip =
              segLinks.length > 0
                ? segLinks.map((l) => l.description?.trim() || l.url).filter(Boolean).join(' · ') || 'Links'
                : '';
            const segCategoryName =
              segTask.category_id != null ? organizationCategoriesList.find((c) => c.id === segTask.category_id)?.name : null;
            const segSubcategoryName =
              segTask.subcategory_id != null ? organizationSubcategoriesList.find((s) => s.id === segTask.subcategory_id)?.name : null;
            const segTaskTags = (segTask.tag_ids ?? [])
              .map((tid) => organizationTagsList.find((t) => t.id === tid))
              .filter(Boolean) as Array<{ id: number; name: string; color?: string | null }>;
            const segEditing = editingTaskId === segTask.id;
            const segDragging = draggingTaskIds?.has(segTask.id) ?? (draggingTaskId === segTask.id);
            const nestedMini = !isRootSeg ? tasks.filter((t) => t.parent_id === segTask.id) : [];
            const memberDrawerOpen = memberActionsDrawerTaskId === segTask.id;

            return (
              <div
                key={segTask.id}
                className={'task-card-group-segment' + (segDragging ? ' task-card-dragging' : '')}
                data-task-id={segTask.id}
              >
                <div
                  className="task-card-top"
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input') != null) return;
                    if (!isRootSeg) e.stopPropagation();
                    if (e.ctrlKey) {
                      onToggleSelect?.(segTask.id);
                      return;
                    }
                    if (dragSource) {
                      if (isRootSeg) onHoldStart?.(e);
                      else onHoldStartGroupMember?.(e, segTask.id);
                    }
                  }}
                >
                  <div className="task-row">
                    <div style={{ position: 'relative' }}>
                      {isRootSeg ? (
                        <>
                          <button
                            type="button"
                            className={'priority-btn priority-' + (segTask.priority || 'low')}
                            title="Priority"
                            onClick={() => setPriorityOpen((o) => !o)}
                          >
                            {priorityIcon(segTask.priority)}
                          </button>
                          {priorityOpen && (
                            <div className="priority-picker" role="listbox">
                              {PRIORITIES.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className={
                                    'priority-picker-option ' + (segTask.priority === p ? 'selected' : '') + ' priority-' + p
                                  }
                                  onClick={() => {
                                    onPriorityChange(segTask.id, p);
                                    childTasks.forEach((c) => onPriorityChange(c.id, p));
                                    setPriorityOpen(false);
                                  }}
                                >
                                  {priorityLabel(p)} {priorityIcon(p)}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={'priority-btn priority-' + (segTask.priority || 'low')}
                            title="Priority"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubPriorityOpenId((id) => (id === segTask.id ? null : segTask.id));
                            }}
                          >
                            {priorityIcon(segTask.priority)}
                          </button>
                          {subPriorityOpenId === segTask.id && (
                            <div className="priority-picker" role="listbox">
                              {PRIORITIES.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className={
                                    'priority-picker-option ' + (segTask.priority === p ? 'selected' : '') + ' priority-' + p
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onPriorityChange(segTask.id, p);
                                    setSubPriorityOpenId(null);
                                  }}
                                >
                                  {priorityLabel(p)} {priorityIcon(p)}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <span className="task-title-wrap task-title-wrap-stacked">
                      <span className="task-title-line">
                        {segEditing ? (
                          <input
                            className="task-title-edit"
                            value={editingTitle}
                            onChange={(e) => onEditingTitleChange(e.target.value)}
                            onBlur={() => onEditSave(segTask.id, editingTitle.trim() || segTask.title)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onEditSave(segTask.id, editingTitle.trim() || segTask.title);
                              if (e.key === 'Escape') onEditCancel();
                            }}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="task-title"
                            onDoubleClick={() => onEditStart(segTask.id, segTask.title)}
                          >
                            {segTask.title}
                          </span>
                        )}
                        {segLinks.length > 0 && linkShut && (
                          <span className="task-card-links-collapsed-icon" title={segLinksTooltip} aria-label="Links">🔗</span>
                        )}
                        {segTask.created_at && (
                          <span className="task-date-added">
                            {new Date(segTask.created_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                      </span>
                      {(segCategoryName != null || segSubcategoryName != null || segTaskTags.length > 0) && (
                        <span className="task-card-meta-below">
                          {(segCategoryName != null || segSubcategoryName != null) && (
                            <span className="task-card-meta-cat">
                              {segCategoryName != null && <span>{segCategoryName}</span>}
                              {segSubcategoryName != null && (
                                <span>{segCategoryName != null ? ' › ' : ''}{segSubcategoryName}</span>
                              )}
                            </span>
                          )}
                          {segTaskTags.length > 0 && (
                            <span className="task-card-meta-tags">
                              {segTaskTags.map((tg) => (
                                <span
                                  key={tg.id}
                                  className="task-card-tag-chip"
                                  style={{
                                    backgroundColor: tg.color ?? 'var(--surface)',
                                    color: tg.color
                                      ? tg.color.startsWith('hsl') && tg.color.includes('65%')
                                        ? '#fff'
                                        : '#000'
                                      : 'var(--text)',
                                  }}
                                >
                                  {tg.name}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="task-row-desktop-actions">
                      <button
                        type="button"
                        className={'cycle-btn' + (segTask.recurring ? ' depressed' : '')}
                        title="Recurring"
                        onClick={() => onRecurringToggle(segTask.id)}
                      >
                        ↻
                      </button>
                      {onOpenOrganization && (
                        <button
                          type="button"
                          className="task-list-add-btn"
                          title="Category & tags"
                          onClick={() => onOpenOrganization(segTask.id)}
                        >
                          📁<sup className="task-list-add-plus">+</sup>
                        </button>
                      )}
                      <button type="button" className="links-btn" title="Add link" onClick={() => onOpenLinks(segTask.id)}>
                        🔗<span className="link-plus">+</span>
                      </button>
                      <button
                        type="button"
                        className="task-list-add-btn"
                        title="Add list / List items"
                        onClick={() => onOpenList(segTask.id)}
                      >
                        📋<sup className="task-list-add-plus">+</sup>
                      </button>
                      <button
                        type="button"
                        className="task-calendar-btn"
                        title="Schedule on a date"
                        onClick={() => onScheduleDate(segTask.id)}
                      >
                        📅
                      </button>
                      {!isRootSeg && (
                        <button
                          type="button"
                          className="task-calendar-btn"
                          title="Remove from parent"
                          onClick={() =>
                            api.tasks.update({ id: segTask.id, parent_id: null }).then(() => onRefresh?.())
                          }
                        >
                          ↩
                        </button>
                      )}
                      <button type="button" className="trash-btn" title="Delete" onClick={() => onDelete(segTask.id)}>
                        🗑
                      </button>
                    </span>
                    <span className="task-row-mobile-actions task-row-drawer-actions" style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="task-card-drawer-chevron"
                        title={isRootSeg ? (actionsDrawerOpen ? 'Close' : 'Actions') : memberDrawerOpen ? 'Close' : 'Actions'}
                        aria-expanded={isRootSeg ? actionsDrawerOpen : memberDrawerOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isRootSeg) {
                            setActionsDrawerOpen((o) => !o);
                            setMemberActionsDrawerTaskId(null);
                          } else {
                            setMemberActionsDrawerTaskId((id) => (id === segTask.id ? null : segTask.id));
                            setActionsDrawerOpen(false);
                          }
                        }}
                      >
                        {(isRootSeg ? actionsDrawerOpen : memberDrawerOpen) ? '▶' : '◀'}
                      </button>
                      {(isRootSeg ? actionsDrawerOpen : memberDrawerOpen) && (
                        <div className="task-card-actions-drawer">
                          {onOpenOrganization && (
                            <>
                              <button
                                type="button"
                                title="Category & tags"
                                onClick={() => {
                                  onOpenOrganization(segTask.id);
                                  if (isRootSeg) setActionsDrawerOpen(false);
                                  else setMemberActionsDrawerTaskId(null);
                                }}
                              >
                                📁
                              </button>
                              {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                            </>
                          )}
                          <button
                            type="button"
                            title="Add link"
                            onClick={() => {
                              onOpenLinks(segTask.id);
                              if (isRootSeg) setActionsDrawerOpen(false);
                              else setMemberActionsDrawerTaskId(null);
                            }}
                          >
                            🔗
                          </button>
                          {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                          <button
                            type="button"
                            title="Add list / List items"
                            onClick={() => {
                              onOpenList(segTask.id);
                              if (isRootSeg) setActionsDrawerOpen(false);
                              else setMemberActionsDrawerTaskId(null);
                            }}
                          >
                            📋
                          </button>
                          {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                          <button
                            type="button"
                            title="Schedule on a date"
                            onClick={() => {
                              onScheduleDate(segTask.id);
                              if (isRootSeg) setActionsDrawerOpen(false);
                              else setMemberActionsDrawerTaskId(null);
                            }}
                          >
                            📅
                          </button>
                          {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                          <button
                            type="button"
                            title="Recurring"
                            onClick={() => {
                              onRecurringToggle(segTask.id);
                              if (isRootSeg) setActionsDrawerOpen(false);
                              else setMemberActionsDrawerTaskId(null);
                            }}
                          >
                            ↻
                          </button>
                          {!isMobile && <span className="task-card-drawer-divider" aria-hidden>|</span>}
                          <button
                            type="button"
                            className="trash-btn"
                            title="Delete"
                            onClick={() => {
                              if (confirm('Delete this task?')) onDelete(segTask.id);
                              if (isRootSeg) setActionsDrawerOpen(false);
                              else setMemberActionsDrawerTaskId(null);
                            }}
                          >
                            🗑
                          </button>
                          {!isMobile && (
                            <span className="task-card-drawer-divider task-card-drawer-end" aria-hidden>&gt;</span>
                          )}
                        </div>
                      )}
                    </span>
                    {onMoveToPending && (
                      <button
                        type="button"
                        className="add-task-btn"
                        style={{ fontSize: '0.7rem' }}
                        onClick={() => onMoveToPending(segTask.id)}
                        title="Move to Pending"
                      >
                        To Pending
                      </button>
                    )}
                    {onMoveToUnassigned && (
                      <button
                        type="button"
                        className="add-task-btn"
                        style={{ fontSize: '0.7rem' }}
                        onClick={() => onMoveToUnassigned(segTask.id)}
                        title="Move to Unassigned"
                      >
                        To Unassigned
                      </button>
                    )}
                    {!!segTask.is_common && onSetIsCommon && (
                      <button
                        type="button"
                        className="task-action-icon-btn task-card-template-unset-btn"
                        onClick={() => onSetIsCommon(segTask.id, false)}
                        title="Remove from Common Tasks"
                      >
                        <span aria-hidden>✖</span>
                      </button>
                    )}
                    {!segTask.is_common &&
                      !segTask.parent_id &&
                      tasks.filter((t) => t.parent_id === segTask.id).length === 0 &&
                      (dragSource === 'unassigned' || dragSource === 'pending') &&
                      onSetIsCommon && (
                        <button
                          type="button"
                          className="task-action-icon-btn task-card-template-save-btn"
                          onClick={() => onSetIsCommon(segTask.id, true)}
                          title="Save as reusable template"
                        >
                          <span aria-hidden>🗂️</span>
                        </button>
                      )}
                  </div>
                </div>
                {hasSegRich && (
                  <>
                    <hr className="task-card-divider-incomplete" aria-hidden />
                    {renderLinksListRich(
                      segTask,
                      segLinks,
                      segListItems,
                      linkShut,
                      isRootSeg
                        ? () => setLinksCollapsed((c) => !c)
                        : () =>
                            setGroupMemberLinksCollapsed((m) => ({
                              ...m,
                              [segTask.id]: !(m[segTask.id] ?? true),
                            })),
                      listShut,
                      isRootSeg
                        ? () => setListCollapsed((c) => !c)
                        : () =>
                            setGroupMemberListCollapsed((m) => ({
                              ...m,
                              [segTask.id]: !(m[segTask.id] ?? true),
                            })),
                    )}
                  </>
                )}
                {nestedMini.length > 0 && (
                  <>
                    <hr className="task-card-divider-complete" aria-hidden />
                    <div className="task-card-details-section task-card-subtasks-section">
                      <div className="task-card-details-section-header">
                        <span className="task-card-details-label">Group</span>
                      </div>
                      <ul className="task-card-subtasks task-card-subtasks-nested">
                        {nestedMini.map((nested) => (
                          <li key={nested.id} className="task-card-subtask" data-task-id={nested.id}>
                            <span className="task-card-subtask-title">{nested.title}</span>
                            <button
                              type="button"
                              className="task-card-subtask-btn"
                              title="Priority"
                              onClick={() => onPriorityChange(nested.id, nested.priority ?? 'low')}
                            >
                              {priorityIcon(nested.priority)}
                            </button>
                            <button
                              type="button"
                              className="task-card-subtask-btn trash-btn"
                              title="Remove from parent"
                              onClick={(e) => {
                                e.stopPropagation();
                                api.tasks.update({ id: nested.id, parent_id: null }).then(() => onRefresh?.());
                              }}
                            >
                              🗑
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
                <hr className="task-card-group-stack-divider" aria-hidden />
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}