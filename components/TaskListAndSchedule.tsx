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

function snapToSlot(minutes: number, startHour: number, endHour: number, slotDuration: number): number {
  const start = startHour * 60;
  const end = endHour * 60;
  const step = slotDuration;
  const offset = minutes - start;
  const slot = Math.round(offset / step) * step + start;
  return Math.max(start, Math.min(end - step, slot));
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
  const [taskSlideIndex, setTaskSlideIndex] = useState(0); // mobile: 0=Unassigned, 1=Pending, 2=Incomplete
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addOptionsOpen, setAddOptionsOpen] = useState(false);
  const [addOptionsTitle, setAddOptionsTitle] = useState('');
  const [addOptionsPriority, setAddOptionsPriority] = useState<Priority>('low');
  const [addOptionsRecurring, setAddOptionsRecurring] = useState(false);
  const [scheduleDateOpen, setScheduleDateOpen] = useState(false);
  const [scheduleDateTaskId, setScheduleDateTaskId] = useState<number | null>(null);
  const [scheduleDateValue, setScheduleDateValue] = useState('');
  const [scheduleTimeValue, setScheduleTimeValue] = useState('09:00');
  const [scheduleNoTime, setScheduleNoTime] = useState(false);
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
  const [dragState, setDragState] = useState<{ taskId: number; taskIds: number[]; source: 'unassigned' | 'pending' | 'incomplete' | 'schedule' } | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [draggingTaskIds, setDraggingTaskIds] = useState<Set<number>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [taskLinksByTaskId, setTaskLinksByTaskId] = useState<Record<number, TaskLink[]>>({});
  const [taskListItemsByTaskId, setTaskListItemsByTaskId] = useState<Record<number, TaskListItem[]>>({});
  const [hoverDropTaskId, setHoverDropTaskId] = useState<number | null>(null);
  const [dropZoneHighlight, setDropZoneHighlight] = useState<'unassigned' | 'pending' | 'incomplete' | null>(null);
  const [scheduleDropGhostMin, setScheduleDropGhostMin] = useState<number | null>(null);
  const [scheduleDropUntimedHighlight, setScheduleDropUntimedHighlight] = useState(false);
  const [lastUndoable, setLastUndoable] = useState<{ revert: () => Promise<void> } | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collapsedScheduleSubtasks, setCollapsedScheduleSubtasks] = useState<Set<number>>(new Set());
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

  const dragStateRef = useRef<{ taskId: number; taskIds: number[]; source: 'unassigned' | 'pending' | 'incomplete' | 'schedule' } | null>(null);
  const scheduleDropStartMinRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdPointerRef = useRef<{ taskIds: number[]; source: 'unassigned' | 'pending' | 'incomplete' | 'schedule'; clientX: number; clientY: number; onHoldStart?: () => void } | null>(null);
  const cancelMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const cancelUpRef = useRef<(() => void) | null>(null);
  const initialLoadRef = useRef(true);

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
        const isToday = viewDate === today();
        if (isToday) await api.rollover(viewDate);
        const day = await api.day.getOrCreate(viewDate);
        const todayStr = today();
        const future = new Date(todayStr + 'T00:00:00');
        future.setFullYear(future.getFullYear() + 1);
        const futureStr = future.toISOString().slice(0, 10);

        const [
          allTasksRes,
          unassignedRes,
          pendingRes,
          incompleteRes,
          accomplishedRes,
          slotRes,
          scheduledRangeRes,
          settingsRes,
        ] = await Promise.all([
          api.tasks.list(),
          api.tasks.list({ list_state: 'unassigned', with: 'links,list_items' }),
          api.tasks.list({ list_state: 'pending', with: 'links,list_items' }),
          api.tasks.list({ view: 'incomplete', day: viewDate, with: 'links,list_items' }),
          api.accomplished.listAll({ with: 'links,list_items' }),
          api.slots.list(day.id, { with: 'links,list_items' }),
          api.slots.listByDateRange(todayStr, futureStr),
          api.settings.get(),
        ]);

        setTasks(allTasksRes.tasks ?? []);
        setSlots(slotRes.slots);
        setSettings(settingsRes);

        const linksByTaskId: Record<number, TaskLink[]> = {};
        const listItemsByTaskId: Record<number, TaskListItem[]> = {};
        for (const res of [unassignedRes, pendingRes, incompleteRes, accomplishedRes, slotRes]) {
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
    api.icalEvents
      .getConfig()
      .then((r) => {
        setIcalIntervalFetch(r.interval_fetch !== false);
      })
      .catch(() => {
        setIcalIntervalFetch(true);
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
    const intervalMs = 15 * 60 * 1000;
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
  }, [scheduleTab, viewDate, icalIntervalFetch, settings.timezone]);

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
        !incompleteRootIds.has(t.id) &&
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
        !scheduledTaskIdsFromTodayOnward.has(t.id)
    )
  );
  const incomplete = sortTasks(
    tasks.filter(
      (t) =>
        !t.parent_id &&
        incompleteRootIds.has(t.id) &&
        !scheduledTaskIdsFromTodayOnward.has(t.id)
    )
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
    const taskId = scheduleDateTaskId;
    const dateStr = scheduleDateValue.trim();
    if (!taskId || !dateStr) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const day = await api.day.getOrCreate(dateStr);
    const start_time = scheduleNoTime ? null : minutesToTime((() => {
      const [h, m] = (scheduleTimeValue || '09:00').split(':').map(Number);
      return (h ?? 9) * 60 + (m ?? 0);
    })());
    const end_time = scheduleNoTime ? null : minutesToTime((() => {
      const inc = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
      const [h, m] = (scheduleTimeValue || '09:00').split(':').map(Number);
      return (h ?? 9) * 60 + (m ?? 0) + inc;
    })());
    const slotIdToReplace = scheduleSlotIdToReplace;
    const isRecurringFuture = task.recurring && dateStr > today();
    if (slotIdToReplace != null) {
      await api.slots.create({ day_record_id: day.id, task_id: taskId, start_time, end_time });
      await api.slots.delete(slotIdToReplace);
    } else if (!isRecurringFuture) {
      const ids = task.parent_id == null ? [task.id, ...getChildTaskIds(task.id)] : [task.id];
      await Promise.all(ids.map((id) => api.slots.create({ day_record_id: day.id, task_id: id, start_time, end_time })));
    }
    setScheduleDateOpen(false);
    setScheduleDateTaskId(null);
    setScheduleDateValue(viewDate);
    setScheduleTimeValue('09:00');
    setScheduleNoTime(false);
    setScheduleSlotIdToReplace(null);
    loadData();
    if (scheduleTab === 'calendar') setCalendarMonth(dateStr);
  };

  const handleDropOnListZone = useCallback(
    async (
      targetListState: 'unassigned' | 'pending',
      taskIds: number[],
      source: 'unassigned' | 'pending' | 'incomplete' | 'schedule'
    ) => {
      try {
      for (const taskId of taskIds) {
        if (source === 'schedule') {
          try {
            const day = await api.day.getOrCreate(viewDate);
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
              await resolveOrphanAndMove(taskId, targetListState, 'no', rootSlot.id, completedChildSlotIds, incompleteChildSlotIds);
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            loadData();
          }
          continue;
        }
        if (source === 'incomplete' && incompleteRootIds.has(taskId)) {
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
        if (source === 'unassigned' && targetListState === 'unassigned') {
          const task = tasks.find((t) => t.id === taskId);
          if (task?.parent_id != null) {
            await api.tasks.update({ id: taskId, parent_id: null });
          }
          continue;
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
      const draggedSet = new Set(taskIds);
      const scheduleDropStartMin = scheduleDropStartMinRef.current;
      clearDragState();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let node: Element | null = el;
      while (node) {
        const zone = node.getAttribute('data-drop-zone');
        const canDropSubtaskOnUnassigned =
          source === 'unassigned' && taskIds.some((id) => tasks.find((t) => t.id === id)?.parent_id != null);
        if (
          zone === 'unassigned' &&
          (source === 'pending' || source === 'incomplete' || source === 'schedule' || canDropSubtaskOnUnassigned)
        ) {
          handleDropOnListZone('unassigned', taskIds, source);
          return;
        }
        if (zone === 'pending' && (source === 'unassigned' || source === 'incomplete' || source === 'schedule')) {
          handleDropOnListZone('pending', taskIds, source);
          return;
        }
        if (zone === 'incomplete') {
          const fromScheduleIncomplete =
            source === 'schedule' &&
            taskIds.some((rootTaskId) => {
              const rootSlot = slots.find(
                (s) => s.task_id === rootTaskId && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id))
              );
              if (!rootSlot) return false;
              const children = slots.filter((c) => c.parent_id === rootTaskId);
              if (children.length === 0) return rootSlot.completed !== 1;
              return !(rootSlot.completed === 1 && children.every((c) => c.completed === 1));
            });
          if (source === 'unassigned' || source === 'pending' || fromScheduleIncomplete) {
            handleDropOnListZone('pending', taskIds, source);
            return;
          }
        }
        const tid = node.getAttribute('data-task-id');
        if (tid) {
          const targetId = parseInt(tid, 10);
          if (!draggedSet.has(targetId)) {
            Promise.all(
              taskIds.filter((id) => id !== targetId).map((id) => api.tasks.update({ id, parent_id: targetId }))
            )
              .then(loadData)
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
                loadData();
              });
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
              for (const taskId of taskIds) {
                const task = tasks.find((t) => t.id === taskId);
                if (!task) continue;
                if (task.recurring && date > today()) {
                  continue;
                }
                const { start_time, end_time } = await getNextAvailableTimeForDay(day.id);
                const ids = task.parent_id == null ? [task.id, ...getChildTaskIds(task.id)] : [task.id];
                await Promise.all(ids.map((id) => api.slots.create({ day_record_id: day.id, task_id: id, start_time, end_time })));
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
          if (source === 'unassigned' || source === 'pending' || source === 'incomplete') {
            (async () => {
              try {
                const day = await api.day.getOrCreate(viewDate);
                for (let i = 0; i < taskIds.length; i++) {
                  const taskId = taskIds[i];
                  const task = tasks.find((t) => t.id === taskId);
                  if (!task) continue;
                  if (task.recurring && viewDate > today()) continue;
                  const ids = task.parent_id == null ? [task.id, ...getChildTaskIds(task.id)] : [task.id];
                  await Promise.all(ids.map((id) => api.slots.create({ day_record_id: day.id, task_id: id, start_time: null, end_time: null })));
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
          if (source === 'unassigned' || source === 'pending' || source === 'incomplete') {
          (async () => {
            try {
              const day = await api.day.getOrCreate(viewDate);
              const viewEndMin = settings.end_hour * 60;
              let nextStartMin =
                scheduleDropStartMin != null
                  ? Math.min(scheduleDropStartMin, viewEndMin - slotDurationMinutes)
                  : null;
              for (let i = 0; i < taskIds.length; i++) {
                const taskId = taskIds[i];
                const task = tasks.find((t) => t.id === taskId);
                if (!task) continue;
                if (task.recurring && viewDate > today()) {
                  continue;
                }
                const ids = task.parent_id == null ? [task.id, ...getChildTaskIds(task.id)] : [task.id];
                const { start_time, end_time } =
                  nextStartMin != null
                    ? {
                        start_time: minutesToTime(nextStartMin),
                        end_time: minutesToTime(nextStartMin + slotDurationMinutes),
                      }
                    : await getNextAvailableTimeForDay(day.id);
                if (nextStartMin != null) nextStartMin += slotDurationMinutes;
                await Promise.all(ids.map((id) => api.slots.create({ day_record_id: day.id, task_id: id, start_time, end_time })));
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
        if (source === 'schedule' && taskIds.length === 1 && scheduleDropStartMin != null) {
          const slot = slots.find((s) => s.task_id === taskIds[0] && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id)));
          if (!slot) return;
          const viewEndMin = settings.end_hour * 60;
          const newStartMin = Math.min(scheduleDropStartMin, viewEndMin - slotDurationMinutes);
          const newStartTime = minutesToTime(newStartMin);
          const newEndTime = minutesToTime(newStartMin + slotDurationMinutes);
          const childSlots = slots.filter((s) => s.parent_id === slot.task_id);
          const slotIdsToUpdate = [slot.id, ...childSlots.map((c) => c.id)];
          setSlots((prev) =>
            prev.map((s) => {
              if (s.id === slot.id) return { ...s, start_time: newStartTime, end_time: newEndTime };
              if (childSlots.some((c) => c.id === s.id)) return { ...s, start_time: newStartTime, end_time: newEndTime };
              return s;
            })
          );
          (async () => {
            try {
              await api.day.getOrCreate(viewDate);
              await Promise.all(slotIdsToUpdate.map((id) => api.slots.update({ id, start_time: newStartTime, end_time: newEndTime })));
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
    dragStateRef.current = { taskId: taskIds[0], taskIds, source: info.source };
    setDragState({ taskId: taskIds[0], taskIds, source: info.source });
    setDragPreviewPosition({ x: info.clientX, y: info.clientY });
    setDraggingTaskId(taskIds[0]);
    setDraggingTaskIds(new Set(taskIds));
    const EDGE_ZONE = 56;
    const SCROLL_STEP = 12;
    let scheduleScrollInterval: ReturnType<typeof setInterval> | null = null;
    let lastPointerY = 0;
    const scrollScrollable = (container: HTMLElement, clientY: number, step: number) => {
      const rect = container.getBoundingClientRect();
      if (clientY <= rect.top + EDGE_ZONE) {
        container.scrollTop = Math.max(0, container.scrollTop - step);
      } else if (clientY >= rect.bottom - EDGE_ZONE) {
        container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + step);
      }
    };
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
      let zone: 'unassigned' | 'pending' | 'incomplete' | null = null;
      node = el;
      while (node) {
        const z = node.getAttribute('data-drop-zone');
        if (z === 'unassigned' || z === 'pending' || z === 'incomplete') {
          const src = info.source;
          const canUnassigned =
            src === 'pending' || src === 'incomplete' || src === 'schedule' || (src === 'unassigned' && taskIds.some((id) => tasks.find((t) => t.id === id)?.parent_id != null));
          const canPending = src === 'unassigned' || src === 'incomplete' || src === 'schedule';
          const canIncomplete = src === 'unassigned' || src === 'pending';
          if (z === 'unassigned' && canUnassigned) zone = 'unassigned';
          else if (z === 'pending' && canPending) zone = 'pending';
          else if (z === 'incomplete' && canIncomplete) zone = 'incomplete';
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
      const scheduleScroll = document.querySelector('.left-bottom .schedule-content') as HTMLElement | null;
      if (scheduleScroll && scheduleScroll.scrollHeight > scheduleScroll.clientHeight) {
        const rect = scheduleScroll.getBoundingClientRect();
        const inScheduleX = e.clientX >= rect.left && e.clientX <= rect.right;
        const atTopEdge = inScheduleX && e.clientY <= rect.top + EDGE_ZONE;
        const atBottomEdge = inScheduleX && e.clientY >= rect.bottom - EDGE_ZONE;
        if (atTopEdge || atBottomEdge) {
          scrollScrollable(scheduleScroll, e.clientY, SCROLL_STEP);
          if (!scheduleScrollInterval) {
            scheduleScrollInterval = setInterval(() => {
              const scroll = document.querySelector('.left-bottom .schedule-content') as HTMLElement | null;
              if (scroll) scrollScrollable(scroll, lastPointerY, SCROLL_STEP);
            }, 50);
          }
        } else {
          if (scheduleScrollInterval) {
            clearInterval(scheduleScrollInterval);
            scheduleScrollInterval = null;
          }
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
      setHoverDropTaskId(null);
      setDropZoneHighlight(null);
      setScheduleDropGhostMin(null);
      handlePointerUpDrop(e);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
  }, [handlePointerUpDrop]);

  const startHold = useCallback(
    (taskId: number, source: 'unassigned' | 'pending' | 'incomplete' | 'schedule', clientX: number, clientY: number, onHoldStart?: () => void) => {
      if (holdTimeoutRef.current) return;
      const taskIds = selectedTaskIds.has(taskId) ? Array.from(selectedTaskIds) : [taskId];
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
    [cancelHold, enterDragMode, selectedTaskIds]
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

  const rootSlots = slots.filter((s) => !s.parent_id || !slots.some((o) => o.task_id === s.parent_id));
  const timedRootSlots = rootSlots.filter(slotHasTime);
  const untimedRootSlots = rootSlots.filter((s) => !slotHasTime(s));
  const childSlotsByParent = new Map<number, ScheduledSlot[]>();
  rootSlots.forEach((s) => {
    const children = slots.filter((c) => c.parent_id === s.task_id);
    if (children.length) childSlotsByParent.set(s.task_id, children);
  });
  const slotOverlapInfo = new Map<number, { col: number; total: number }>();
  timedRootSlots.forEach((slot) => {
    const startMin = timeToMinutes(slot.start_time);
    const endMin = timeToMinutes(slot.end_time);
    const overlapping = timedRootSlots.filter(
      (o) => timeToMinutes(o.start_time) < endMin && timeToMinutes(o.end_time) > startMin
    );
    const sorted = [...overlapping].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    const col = sorted.findIndex((o) => o.id === slot.id);
    slotOverlapInfo.set(slot.id, { col: col >= 0 ? col : 0, total: sorted.length });
  });

  const untimedFeedEvents = feedEvents.filter(
    (e) => e.allDay && (icalEventLocalStartDate(e.start, true, settings.timezone) === viewDate || e.start.startsWith(viewDate))
  );

  const draggingSubtaskFromUnassigned =
    !!dragState &&
    dragState.source === 'unassigned' &&
    (dragState.taskIds ?? [dragState.taskId]).some((id) => tasks.find((t) => t.id === id)?.parent_id != null);
  const unassignedDropValid =
    !!dragState &&
    (dragState.source === 'pending' || dragState.source === 'incomplete' || dragState.source === 'schedule' || draggingSubtaskFromUnassigned);
  const pendingDropValid = !!dragState && (dragState.source === 'unassigned' || dragState.source === 'incomplete' || dragState.source === 'schedule');
  const isDraggingIncompleteFromSchedule =
    !!dragState &&
    dragState.source === 'schedule' &&
    (dragState.taskIds ?? [dragState.taskId]).some((rootTaskId) => {
      const rootSlot = slots.find(
        (s) => s.task_id === rootTaskId && (s.parent_id == null || !slots.some((o) => o.task_id === s.parent_id))
      );
      if (!rootSlot) return false;
      const children = childSlotsByParent.get(rootTaskId) ?? [];
      if (children.length === 0) return rootSlot.completed !== 1;
      const allComplete = rootSlot.completed === 1 && children.every((c) => c.completed === 1);
      return !allComplete;
    });
  const incompleteDropValid =
    !!dragState &&
    ((dragState.source === 'unassigned' || dragState.source === 'pending') || isDraggingIncompleteFromSchedule);

  const hasUnassigned = unassigned.length > 0 || unassignedDropValid;
  const hasPending = pending.length > 0 || pendingDropValid;
  const hasIncomplete = incomplete.length > 0 || incompleteDropValid;
  const visibleTaskSlideIndices = useMemo(() => {
    const v: number[] = [];
    if (hasUnassigned) v.push(0);
    if (hasPending) v.push(1);
    if (hasIncomplete) v.push(2);
    return v;
  }, [hasUnassigned, hasPending, hasIncomplete]);

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
                            : incomplete.length;
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
              className={'task-list-sections task-swipe-zone' + (isMobile && visibleTaskSlideIndices.length === 3 ? ` mobile-task-slide-${clampedTaskSlideIndex}` : '') + (isMobile ? ' task-swipe-zone-active' : '')}
              ref={taskListScrollRef}
              style={{
                position: 'relative',
                ...(isMobile && visibleTaskSlideIndices.length !== 3
                  ? { transform: `translateX(-${(currentSectionIndex / 3) * 100}%)` }
                  : {}),
              }}
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
                      {unassigned.map((t) => (
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
                          onHoldStartSubtask={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'unassigned', e.clientX, e.clientY); }}
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
                            setScheduleDateOpen(true);
                          }}
                          onDelete={(id) => {
                            if (confirm('Delete this task?')) api.tasks.delete(id).then(loadData);
                          }}
                          onOpenLinks={(id, initialUrl) => {
                            setLinkModalTaskId(id);
                            setLinkModalInitialUrl(initialUrl ?? '');
                          }}
                          onOpenList={(id) => setListModalTaskId(id)}
                          onRefresh={handleRefresh}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
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
                      {pending.map((t) => (
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
                          onHoldStartSubtask={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'pending', e.clientX, e.clientY); }}
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
                            setScheduleDateOpen(true);
                          }}
                          onDelete={(id) => {
                            if (confirm('Delete this task?')) api.tasks.delete(id).then(loadData);
                          }}
                          onOpenLinks={(id, initialUrl) => {
                            setLinkModalTaskId(id);
                            setLinkModalInitialUrl(initialUrl ?? '');
                          }}
                          onOpenList={(id) => setListModalTaskId(id)}
                          onRefresh={handleRefresh}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {initialDataReady && !loading && !error && (isMobile || incomplete.length > 0 || incompleteDropValid) && (
                <div className={'task-list-section' + (incompleteDropValid ? ' task-list-section-drop-zone' : '') + (isMobile && !hasIncomplete ? ' task-list-section-hidden' : '')} data-drop-zone="incomplete">
                  <div className="task-list-section-title">Incomplete</div>
                  <div className="task-list-scroll">
                    <ul className="task-list">
                      {dropZoneHighlight === 'incomplete' && dragState && (
                        <li className="drop-zone-placeholder" aria-hidden="true">
                          {dragState.taskIds.length > 1
                            ? `Drop ${dragState.taskIds.length} tasks here`
                            : (tasks.find((t) => t.id === dragState!.taskId)?.title ?? 'Drop here')}
                        </li>
                      )}
                      {incomplete.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          tasks={tasks}
                          links={taskLinksByTaskId[t.id] ?? []}
                          listItems={taskListItemsByTaskId[t.id] ?? []}
                          dragSource="incomplete"
                          draggingTaskId={draggingTaskId}
                          draggingTaskIds={draggingTaskIds}
                          isDragging={draggingTaskIds.has(t.id)}
                          isDropTarget={hoverDropTaskId === t.id}
                          isSelected={selectedTaskIds.has(t.id)}
                          onToggleSelect={toggleTaskSelection}
                          onHoldStart={(e) => startHold(t.id, 'incomplete', e.clientX, e.clientY)}
                          onHoldStartSubtask={(e, taskId) => { e.stopPropagation(); startHold(taskId, 'incomplete', e.clientX, e.clientY); }}
                          editingTaskId={editingTaskId}
                          editingTitle={editingTitle}
                          onEditingTitleChange={setEditingTitle}
                          onEditStart={(id, title) => { setEditingTaskId(id); setEditingTitle(title); }}
                          onEditSave={(id, title) => { api.tasks.update({ id, title }).then(loadData); setEditingTaskId(null); }}
                          onEditCancel={() => setEditingTaskId(null)}
                          onPriorityChange={(id, p) => api.tasks.update({ id, priority: p }).then(loadData)}
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
                          onMoveToUnassigned={(id) => api.tasks.update({ id, list_state: 'unassigned' }).then(loadData)}
                          onScheduleDate={(id) => { setScheduleDateTaskId(id); setScheduleDateValue(viewDate); setScheduleSlotIdToReplace(null); setScheduleDateOpen(true); }}
                          onOpenLinks={(id, initialUrl) => { setLinkModalTaskId(id); setLinkModalInitialUrl(initialUrl ?? ''); }}
                          onOpenList={(id) => setListModalTaskId(id)}
                          onDelete={(id) => { if (confirm('Delete this task?')) api.tasks.delete(id).then(loadData); }}
                          onRefresh={handleRefresh}
                          highlightBlink={newTaskIdToBlink === t.id}
                          isUrlDragOver={urlDragOverTaskId === t.id}
                          onUrlDragEnter={() => setUrlDragOverTaskId(t.id)}
                          onUrlDragLeave={() => setUrlDragOverTaskId(null)}
                          taskLinksByTaskId={taskLinksByTaskId}
                          taskListItemsByTaskId={taskListItemsByTaskId}
                          isMobile={isMobile}
                          onToggleComplete={handleToggleTaskComplete}
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
                  <button type="button" className="day-nav-btn" onClick={goPrev} disabled={isToday}>
                    Prev
                  </button>
                  <span className="schedule-date" style={{ fontSize: '0.85rem' }}>
                    {viewDate}
                  </span>
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
              {scheduleTab === 'today' && (
                <div className="time-settings time-settings-top-right schedule-header-time-settings" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                  <div className="schedule-header-start-end" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <label className="time-settings-label">
                      Start
                    <select
                      className="time-settings-select"
                      value={settings.start_hour}
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
                  <label className="time-settings-label schedule-header-increment">
                    Increment
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={settings.increment_value}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 15));
                        api.settings.update({ increment_value: v }).then(() => setSettings((s) => ({ ...s, increment_value: v }))).catch(alert);
                      }}
                      style={{ width: '3rem', padding: '0.2rem 0.4rem' }}
                    />
                    <select
                      className="time-settings-select"
                      value={settings.increment_unit}
                      onChange={(e) => {
                        const v = e.target.value as 'min' | 'hr';
                        api.settings.update({ increment_unit: v }).then(() => setSettings((s) => ({ ...s, increment_unit: v }))).catch(alert);
                      }}
                    >
                      <option value="min">min</option>
                      <option value="hr">hr</option>
                    </select>
                  </label>
                  <label className="time-settings-label schedule-header-timezone" title="IANA timezone for iCal event times (e.g. America/Los_Angeles). Empty = browser timezone.">
                    Time zone
                    <input
                      type="text"
                      list="schedule-timezone-suggestions"
                      value={settings.timezone ?? ''}
                      onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        api.settings.update({ timezone: v }).then(() => setSettings((s) => ({ ...s, timezone: v }))).catch(alert);
                      }}
                      placeholder="Browser"
                      style={{ width: '12rem', padding: '0.2rem 0.4rem', marginLeft: '0.25rem' }}
                    />
                    <datalist id="schedule-timezone-suggestions">
                      {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'].map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </label>
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
            <div
              ref={scheduleContentRef}
              className={'schedule-swipe-zone schedule-content' + (isMobile ? ' schedule-swipe-zone-active' : '')}
              {...(isMobile ? bindScheduleContentDrag() : {})}
            >
            {scheduleTab === 'today' && (
              <>
                <div
                  className={'schedule-untimed-drop-zone' + (scheduleDropUntimedHighlight ? ' schedule-untimed-drop-zone-active' : '')}
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
                            <span style={e.user_completed ? { textDecoration: 'line-through' } : undefined}>{e.title || 'Event'}</span>
                            {canMarkCompleted && (
                              <button
                                type="button"
                                className="time-block-check"
                                title={e.user_completed ? 'Mark incomplete' : 'Mark complete'}
                                aria-pressed={!!e.user_completed}
                                onClick={() => api.icalEvents.setCompleted(e.id!, !e.user_completed).then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                              >
                                ✓
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
                          return (
                            <div
                              key={slot.id}
                              className={'time-block' + (slot.completed ? ' completed' : '') + (slot.is_recurring_occurrence ? ' time-block-recurring-occurrence' : '') + (dragState?.source === 'schedule' && dragState?.taskIds?.includes(slot.task_id) ? ' time-block-dragging' : '') + (urlDragOverTaskId === slot.task_id ? ' time-block-drop-url' : '')}
                              style={{
                                top: top + 'px',
                                height: height + 'px',
                                left: leftPct + '%',
                                width: (widthPctSlot > 0 ? widthPctSlot - 0.5 : 99.5) + '%',
                              }}
                              onDragOver={(e) => {
                                if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'link';
                                }
                              }}
                              onDragEnter={(e) => {
                                if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
                                  setUrlDragOverTaskId(slot.task_id);
                                }
                              }}
                              onDragLeave={(e) => {
                                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                  setUrlDragOverTaskId(null);
                                }
                              }}
                              onDrop={(e) => {
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
                                if ((e.target as HTMLElement).closest('button, a, .time-block-resize, .time-block-resize-top, .time-block-drag-to-list, .time-block-link-inline, .time-block-link')) return;
                                e.preventDefault();
                                startHold(slot.task_id, 'schedule', e.clientX, e.clientY);
                              }}
                              >
                              {!slot.is_recurring_occurrence && (
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
                                  const move = (e2: PointerEvent) => {
                                    const dy = e2.clientY - startY;
                                    const delta = Math.round(dy / ROW_HEIGHT) * slotDurationMinutes;
                                    let newStart = snapToSlot(startMin + delta, settings.start_hour, settings.end_hour, slotDurationMinutes);
                                    if (newStart >= endMin - slotDurationMinutes) newStart = endMin - slotDurationMinutes;
                                    lastStart = newStart;
                                    blockEl.style.top = ((lastStart - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT + 'px';
                                    blockEl.style.height = ((endMin - lastStart) / slotDurationMinutes) * ROW_HEIGHT + 'px';
                                  };
                                  const up = () => {
                                    blockEl.classList.remove('time-block-resizing');
                                    handleEl.releasePointerCapture(e.pointerId);
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                    blockEl.style.top = '';
                                    blockEl.style.height = '';
                                    if (lastStart !== startMin) {
                                      const newStartTime = minutesToTime(lastStart);
                                      const childSlots = childSlotsByParent.get(slot.task_id) ?? [];
                                      setSlots((prev) =>
                                        prev.map((s) => {
                                          if (s.id === slot.id) return { ...s, start_time: newStartTime, end_time: slot.end_time };
                                          if (childSlots.some((c) => c.id === s.id)) return { ...s, start_time: newStartTime, end_time: slot.end_time };
                                          return s;
                                        })
                                      );
                                      api.slots.update({ id: slot.id, start_time: newStartTime, end_time: slot.end_time })
                                        .then(() => refetchSlotsForViewDay())
                                        .catch((err) => {
                                          setError(err instanceof Error ? err.message : String(err));
                                          loadData();
                                        });
                                    }
                                  };
                                  window.addEventListener('pointermove', move);
                                  window.addEventListener('pointerup', up, { once: true });
                                }}
                              />
                              )}
                              <div className="time-block-header">
                                <span
                                  className="time-block-drag-to-list"
                                  title="Hold to move to list"
                                  onPointerDown={(e) => {
                                    if (e.button === 0) {
                                      e.stopPropagation();
                                      startHold(slot.task_id, 'schedule', e.clientX, e.clientY);
                                    }
                                  }}
                                >
                                  ⋮⋮
                                </span>
                                <div style={{ position: 'relative' }}>
                                  <button
                                    ref={openPrioritySlotId === slot.id ? schedulePriorityButtonRef : undefined}
                                    type="button"
                                    className={'time-block-priority time-block-priority-btn priority-' + (slot.priority || 'low')}
                                    title="Priority"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenPrioritySlotId((id) => (id === slot.id ? null : slot.id));
                                    }}
                                  >
                                    {priorityIcon((slot.priority as Priority) ?? 'low')}
                                  </button>
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
                                      style={slot.completed ? { textDecoration: 'line-through' } : undefined}
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (editingScheduleTaskId === slot.task_id) return;
                                        if (parentCompleteLocked || (slot.is_recurring_occurrence && viewDate > today())) return;
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
                                      title="Double-tap to toggle completion"
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
                                </div>
                                <span className="time-block-desktop-actions">
                                  <button type="button" className="time-block-link" title="Add link" onClick={() => { setLinkModalTaskId(slot.task_id); setLinkModalInitialUrl(''); }}>
                                    <span className="time-block-link-icon">🔗<sup>+</sup></span>
                                  </button>
                                  <button type="button" className="time-block-link" title="List items" onClick={() => setListModalTaskId(slot.task_id)}>
                                    <span className="time-block-link-icon">📋<sup>+</sup></span>
                                  </button>
                                  <button
                                    type="button"
                                    className="time-block-date"
                                    title="Change date"
                                    onClick={() => {
                                      setScheduleDateTaskId(slot.task_id);
                                      setScheduleDateValue(viewDate);
                                      setScheduleNoTime(!slotHasTime(slot));
                                      setScheduleTimeValue(slot.start_time?.slice(0, 5) || '09:00');
                                      setScheduleSlotIdToReplace(slot.id);
                                      setScheduleDateOpen(true);
                                    }}
                                  >
                                    📅
                                  </button>
                                  <button
                                    type="button"
                                    className={'time-block-recurring' + (slot.recurring ? ' depressed' : '')}
                                    title="Recurring"
                                    onClick={() => {
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
                                    onClick={(e) => {
                                      e.stopPropagation();
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
                                      onClick={() => {
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
                                    onClick={(e) => { e.stopPropagation(); setOpenScheduleDrawerSlotId((id) => (id === slot.id ? null : slot.id)); }}
                                  >
                                    {openScheduleDrawerSlotId === slot.id ? '>' : '<'}
                                  </button>
                                  {openScheduleDrawerSlotId === slot.id && (
                                    <div className="time-block-actions-drawer">
                                      <button type="button" title="Edit title" onClick={(e) => { e.stopPropagation(); setEditingScheduleTaskId(slot.task_id); setEditingScheduleTitle(slot.title ?? ''); setOpenScheduleDrawerSlotId(null); }}>✎</button>
                                      <span className="task-card-drawer-divider" aria-hidden>|</span>
                                      <button type="button" title="Add link" onClick={(e) => { e.stopPropagation(); setLinkModalTaskId(slot.task_id); setLinkModalInitialUrl(''); setOpenScheduleDrawerSlotId(null); }}>🔗</button>
                                      <span className="task-card-drawer-divider" aria-hidden>|</span>
                                      <button type="button" title="List items" onClick={(e) => { e.stopPropagation(); setListModalTaskId(slot.task_id); setOpenScheduleDrawerSlotId(null); }}>📋</button>
                                      <span className="task-card-drawer-divider" aria-hidden>|</span>
                                      <button type="button" title="Change date" onClick={(e) => {
                                        e.stopPropagation();
                                        setScheduleDateTaskId(slot.task_id);
                                        setScheduleDateValue(viewDate);
                                        setScheduleNoTime(!slotHasTime(slot));
                                        setScheduleTimeValue(slot.start_time?.slice(0, 5) || '09:00');
                                        setScheduleSlotIdToReplace(slot.id);
                                        setScheduleDateOpen(true);
                                        setOpenScheduleDrawerSlotId(null);
                                      }}>📅</button>
                                      <span className="task-card-drawer-divider" aria-hidden>|</span>
                                      <button type="button" title="Recurring" onClick={(e) => {
                                        e.stopPropagation();
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
                                      }}>↻</button>
                                      <span className="task-card-drawer-divider" aria-hidden>|</span>
                                      <button type="button" className="trash-btn" title="Delete task" onClick={(e) => {
                                        e.stopPropagation();
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
                                          <span className="task-card-drawer-divider" aria-hidden>|</span>
                                          <button type="button" title="Mark complete" onClick={(e) => {
                                            e.stopPropagation();
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
                                      <span className="task-card-drawer-divider task-card-drawer-end" aria-hidden>&gt;</span>
                                    </div>
                                  )}
                                </span>
                              </div>
                              {childSlots.length > 0 && (
                                <>
                                  <button
                                    type="button"
                                    className="time-block-subtasks-toggle"
                                    onClick={() => setCollapsedScheduleSubtasks((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(slot.id)) next.delete(slot.id);
                                      else next.add(slot.id);
                                      return next;
                                    })}
                                  >
                                    {collapsedScheduleSubtasks.has(slot.id) ? '▶ Subtasks' : '▼ Subtasks'}
                                  </button>
                                  {!collapsedScheduleSubtasks.has(slot.id) && (
                                    <div className="time-block-children">
                                      {childSlots.map((c) => (
                                        <div key={c.id} className="time-block-child time-block-child-header">
                                          <span className="time-block-child-title" style={c.completed ? { textDecoration: 'line-through' } : undefined}>
                                            {c.title ?? 'Subtask'}
                                          </span>
                                          <button
                                            type="button"
                                            className="time-block-check"
                                            title="Mark complete"
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
                                </>
                              )}
                              {!slot.is_recurring_occurrence && (
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
                                  const move = (e2: PointerEvent) => {
                                    const dy = e2.clientY - startY;
                                    const delta = Math.round(dy / ROW_HEIGHT) * slotDurationMinutes;
                                    let newEnd = snapToSlot(endMin + delta, settings.start_hour, settings.end_hour, slotDurationMinutes);
                                    if (newEnd <= startMin + slotDurationMinutes) newEnd = startMin + slotDurationMinutes;
                                    lastEnd = newEnd;
                                    blockEl.style.height = ((lastEnd - startMin) / slotDurationMinutes) * ROW_HEIGHT + 'px';
                                  };
                                  const up = () => {
                                    blockEl.classList.remove('time-block-resizing');
                                    handleEl.releasePointerCapture(e.pointerId);
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                    blockEl.style.height = '';
                                    if (lastEnd !== endMin) {
                                      const newEndTime = minutesToTime(lastEnd);
                                      setSlots((prev) =>
                                        prev.map((s) => (s.id === slot.id ? { ...s, end_time: newEndTime } : s))
                                      );
                                      api.slots.update({ id: slot.id, start_time: slot.start_time, end_time: newEndTime })
                                        .then(() => refetchSlotsForViewDay())
                                        .catch((err) => {
                                          setError(err instanceof Error ? err.message : String(err));
                                          loadData();
                                        });
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
                            return (
                              <div
                                key={e.id ?? e.uid + e.start}
                                className="time-block time-block-feed"
                                style={{
                                  top: top + 'px',
                                  height: Math.max(height, 20) + 'px',
                                  left: '2%',
                                  width: '96%',
                                }}
                              >
                                <div className="time-block-header">
                                  <div className="time-block-title-wrap">
                                    <div className="time-block-title" style={e.user_completed ? { textDecoration: 'line-through' } : undefined}>
                                      {local.localStartTime} – {local.localEndTime} {e.title}
                                    </div>
                                  </div>
                                  {canMarkCompleted && (
                                    <button
                                      type="button"
                                      className="time-block-check"
                                      title={e.user_completed ? 'Mark incomplete' : 'Mark complete'}
                                      aria-pressed={!!e.user_completed}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        api.icalEvents.setCompleted(e.id!, !e.user_completed).then(() => refetchIcalForScheduleView()).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                                      }}
                                    >
                                      ✓
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
                <div className="calendar-month-nav">
                  <button
                    type="button"
                    className="calendar-month-prev"
                    onClick={() => {
                      const d = new Date(calendarMonth + 'T00:00:00');
                      d.setMonth(d.getMonth() - 1);
                      setCalendarMonth(d.toISOString().slice(0, 10));
                    }}
                  >
                    Prev
                  </button>
                  <span className="calendar-month-label">
                    {new Date(calendarMonth + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    className="calendar-month-next"
                    onClick={() => {
                      const d = new Date(calendarMonth + 'T00:00:00');
                      d.setMonth(d.getMonth() + 1);
                      setCalendarMonth(d.toISOString().slice(0, 10));
                    }}
                  >
                    Next
                  </button>
                </div>
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
                                <span className="calendar-task-desc" style={s.completed ? { textDecoration: 'line-through' } : undefined}>
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
      />

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
          <p>Returning this task will affect its scheduled subtasks.</p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>Yes</strong> – Completed subtasks stay on the schedule as their own tasks; the parent and incomplete subtasks go back to the list.
          </p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <strong>No</strong> – All subtasks are removed and marked incomplete; the task goes back to the list.
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
                    const toDelete = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                    if (toDelete.length > 0) {
                      Promise.all(toDelete.map((id) => api.slots.delete(id)))
                        .then(loadData)
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : String(err));
                          loadData();
                        });
                    } else {
                      loadData();
                    }
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
                    const toDelete = [slot.id, ...childSlots.map((c) => c.id)].filter((id) => id > 0);
                    const updateTask = () => api.tasks.update({ id: slot.task_id, recurring: false }).then(loadData).catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                      loadData();
                    });
                    if (toDelete.length > 0) {
                      Promise.all(toDelete.map((id) => api.slots.delete(id))).then(updateTask);
                    } else {
                      updateTask();
                    }
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
            <strong>All occurrences</strong> – Turn off recurring for this task so it won’t appear on future days.
          </p>
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
  onRecurringToggle,
  onMoveToPending,
  onMoveToUnassigned,
  onScheduleDate,
  onOpenLinks,
  onOpenList,
  onDelete,
  onRefresh,
  highlightBlink,
  dragSource,
  draggingTaskId,
  draggingTaskIds,
  isDragging,
  isDropTarget,
  isSelected,
  onToggleSelect,
  onHoldStart,
  onHoldStartSubtask,
  isUrlDragOver,
  onUrlDragEnter,
  onUrlDragLeave,
  taskLinksByTaskId,
  taskListItemsByTaskId,
  isMobile = false,
  onToggleComplete: _onToggleComplete,
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
  onRecurringToggle: (id: number) => void;
  onMoveToPending: ((id: number) => void) | undefined;
  onMoveToUnassigned: ((id: number) => void) | undefined;
  onScheduleDate: (id: number) => void;
  onOpenLinks: (id: number, initialUrl?: string) => void;
  onOpenList: (id: number) => void;
  onDelete: (id: number) => void;
  onRefresh?: (taskId?: number) => void;
  highlightBlink?: boolean;
  dragSource?: 'unassigned' | 'pending' | 'incomplete';
  draggingTaskId?: number | null;
  draggingTaskIds?: Set<number>;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (taskId: number) => void;
  onHoldStart?: (e: React.PointerEvent) => void;
  onHoldStartSubtask?: (e: React.PointerEvent, taskId: number) => void;
  isUrlDragOver?: boolean;
  onUrlDragEnter?: () => void;
  onUrlDragLeave?: () => void;
  taskLinksByTaskId?: Record<number, TaskLink[]>;
  taskListItemsByTaskId?: Record<number, TaskListItem[]>;
  isMobile?: boolean;
  onToggleComplete?: (taskId: number) => void;
}) {
  const [actionsDrawerOpen, setActionsDrawerOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [editingLinkUrl, setEditingLinkUrl] = useState('');
  const [editingLinkDesc, setEditingLinkDesc] = useState('');
  const [editingListItemId, setEditingListItemId] = useState<number | null>(null);
  const [editingListItemContent, setEditingListItemContent] = useState('');
  const [newListItemContent, setNewListItemContent] = useState('');
  const [subPriorityOpenId, setSubPriorityOpenId] = useState<number | null>(null);
  const [expandedSubtaskDetails, setExpandedSubtaskDetails] = useState<Set<number>>(new Set());
  const [detailsCollapsed, setDetailsCollapsed] = useState(true);
  const [linksCollapsed, setLinksCollapsed] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(false);
  const isEditing = editingTaskId === task.id;
  const childTasks = tasks.filter((t) => t.parent_id === task.id);
  const hasDetails = links.length > 0 || listItems.length > 0 || childTasks.length > 0;
  const linksTooltip = links.length > 0
    ? links.map((l) => l.description?.trim() || l.url).filter(Boolean).join(' · ') || 'Links'
    : '';

  return (
    <li
      className={'task-card' + (highlightBlink ? ' task-card-blink' : '') + (isDragging ? ' task-card-dragging' : '') + (isDropTarget ? ' task-card-drop-target' : '') + (isSelected ? ' task-card-selected' : '') + (isUrlDragOver ? ' task-card-drop-url' : '') + (isMobile ? ' task-card-mobile' : '')}
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
          {hasDetails && (
            <button
              type="button"
              className="task-card-details-chevron-main"
              title={detailsCollapsed ? 'Expand details' : 'Collapse details'}
              aria-expanded={!detailsCollapsed}
              onClick={() => setDetailsCollapsed((c) => !c)}
            >
              {detailsCollapsed ? '▶' : '▼'}
            </button>
          )}
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
                      onPriorityChange(task.id, p);
                      setPriorityOpen(false);
                    }}
                  >
                    {priorityLabel(p)} {priorityIcon(p)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="task-title-wrap">
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
          <span className="task-row-desktop-actions">
            <button
              type="button"
              className={'cycle-btn' + (task.recurring ? ' depressed' : '')}
              title="Recurring"
              onClick={() => onRecurringToggle(task.id)}
            >
              ↻
            </button>
            <button type="button" className="links-btn" title="Add link" onClick={() => onOpenLinks(task.id)}>
              🔗<span className="link-plus">+</span>
            </button>
            <button type="button" className="task-list-add-btn" title="Add list / List items" onClick={() => onOpenList(task.id)}>
              📋<sub>+</sub>
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
              {actionsDrawerOpen ? '>' : '<'}
            </button>
            {actionsDrawerOpen && (
              <div className="task-card-actions-drawer">
                <button type="button" title="Add link" onClick={() => { onOpenLinks(task.id); setActionsDrawerOpen(false); }}>🔗</button>
                <span className="task-card-drawer-divider" aria-hidden>|</span>
                <button type="button" title="Add list / List items" onClick={() => { onOpenList(task.id); setActionsDrawerOpen(false); }}>📋</button>
                <span className="task-card-drawer-divider" aria-hidden>|</span>
                <button type="button" title="Schedule on a date" onClick={() => { onScheduleDate(task.id); setActionsDrawerOpen(false); }}>📅</button>
                <span className="task-card-drawer-divider" aria-hidden>|</span>
                <button type="button" title="Recurring" onClick={() => { onRecurringToggle(task.id); setActionsDrawerOpen(false); }}>{task.recurring ? '↻' : '↻'}</button>
                <span className="task-card-drawer-divider" aria-hidden>|</span>
                <button type="button" className="trash-btn" title="Delete" onClick={() => { if (confirm('Delete this task?')) onDelete(task.id); setActionsDrawerOpen(false); }}>🗑</button>
                <span className="task-card-drawer-divider task-card-drawer-end" aria-hidden>&gt;</span>
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
        </div>
      </div>
      {hasDetails && !detailsCollapsed && (
        <div className="task-card-details">
          {links.length > 0 && (
            <div className="task-card-details-section task-card-links-section">
              <div className="task-card-details-section-header">
                <button
                  type="button"
                  className="task-card-details-toggle"
                  onClick={() => setLinksCollapsed((c) => !c)}
                  aria-expanded={!linksCollapsed}
                >
                  {linksCollapsed ? '▶' : '▼'}
                </button>
                {linksCollapsed ? (
                  <span className="task-card-details-label-inline">
                    Links: {links.map((link) => (
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
                  <>
                    <span className="task-card-details-label">Links</span>
                    <div className="task-card-links">
                      {links.map((link) => (
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
                              <button type="button" className="task-card-link-save" onClick={() => {
                                api.links.update({ id: link.id, url: editingLinkUrl.trim(), description: editingLinkDesc.trim() }).then(() => { setEditingLinkId(null); onRefresh?.(task.id); });
                              }}>Save</button>
                              <button type="button" className="task-card-link-cancel" onClick={() => { setEditingLinkId(null); }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                                {link.description?.trim() || link.url}
                              </a>
                              <button type="button" className="task-card-link-edit" title="Edit in place" onClick={() => { setEditingLinkId(link.id); setEditingLinkUrl(link.url); setEditingLinkDesc(link.description ?? ''); }}>✎</button>
                              <button type="button" className="task-card-link-delete trash-btn" title="Remove link" onClick={() => api.links.delete(link.id).then(() => onRefresh?.(task.id))}>🗑</button>
                            </>
                          )}
                        </span>
                      ))}
                      <button type="button" className="task-card-link-add" title="Add link" onClick={() => onOpenLinks(task.id)}>+ link</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {listItems.length > 0 && (
            <div className="task-card-details-section task-card-list-section">
              <div className="task-card-details-section-header">
                <button
                  type="button"
                  className="task-card-details-toggle"
                  onClick={() => setListCollapsed((c) => !c)}
                  aria-expanded={!listCollapsed}
                >
                  {listCollapsed ? '▶' : '▼'}
                </button>
                {listCollapsed ? <span className="task-card-details-label">List…</span> : <span className="task-card-details-label">List</span>}
              </div>
              {!listCollapsed && (
            <div className="task-card-list">
              {listItems.map((item) => (
                <div key={item.id} className={'task-card-list-item' + ((task.list_style ?? 'bullet') === 'checklist' ? ' task-card-list-item-checklist' : '')}>
                  {(task.list_style ?? 'bullet') === 'bullet' && <span className="task-card-list-bullet" aria-hidden>•</span>}
                  {(task.list_style ?? 'bullet') === 'checklist' && (
                    <button
                      type="button"
                      className="task-card-list-check"
                      title={item.completed ? 'Mark incomplete' : 'Mark complete'}
                      onClick={() => api.taskListItems.update({ id: item.id, completed: item.completed ? 0 : 1 }).then(() => onRefresh?.(task.id))}
                      aria-pressed={!!item.completed}
                    >
                      {item.completed ? '☑' : '☐'}
                    </button>
                  )}
                  {editingListItemId === item.id ? (
                    <>
                      <input
                        className="task-card-list-edit-input"
                        value={editingListItemContent}
                        onChange={(e) => setEditingListItemContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            api.taskListItems.update({ id: item.id, content: editingListItemContent.trim() || item.content }).then(() => { setEditingListItemId(null); onRefresh?.(task.id); });
                          }
                          if (e.key === 'Escape') setEditingListItemId(null);
                        }}
                        autoFocus
                      />
                      <button type="button" className="task-card-list-item-save" onClick={() => api.taskListItems.update({ id: item.id, content: editingListItemContent.trim() || item.content }).then(() => { setEditingListItemId(null); onRefresh?.(task.id); })}>✓</button>
                    </>
                  ) : (
                    <span
                      className="task-card-list-content"
                      style={item.completed ? { textDecoration: 'line-through', opacity: 0.8 } : undefined}
                      onDoubleClick={() => { setEditingListItemId(item.id); setEditingListItemContent(item.content); }}
                    >
                      {item.content}
                    </span>
                  )}
                  {editingListItemId !== item.id && (
                    <button type="button" className="task-card-list-item-delete trash-btn" title="Remove" onClick={() => api.taskListItems.delete(item.id).then(() => onRefresh?.(task.id))}>🗑</button>
                  )}
                </div>
              ))}
              <form className="task-card-list-add" onSubmit={(e) => {
                e.preventDefault();
                const content = newListItemContent.trim();
                if (content) api.taskListItems.create({ task_id: task.id, content, order_index: listItems.length }).then(() => { setNewListItemContent(''); onRefresh?.(task.id); });
              }}>
                <input
                  className="task-card-list-new-input"
                  value={newListItemContent}
                  onChange={(e) => setNewListItemContent(e.target.value)}
                  placeholder="+ Add item"
                />
              </form>
            </div>
              )}
            </div>
          )}
          {childTasks.length > 0 && (
            <div className="task-card-details-section task-card-subtasks-section">
              <div className="task-card-details-section-header">
                <button
                  type="button"
                  className="task-card-details-toggle"
                  onClick={() => setSubtasksCollapsed((c) => !c)}
                  aria-expanded={!subtasksCollapsed}
                >
                  {subtasksCollapsed ? '▶' : '▼'}
                </button>
                <span className="task-card-details-label">{subtasksCollapsed ? 'Subtasks…' : 'Subtasks'}</span>
              </div>
              {!subtasksCollapsed && (
            <ul className="task-card-subtasks">
              {childTasks.map((sub) => {
                const subEditing = editingTaskId === sub.id;
                const subDragging = draggingTaskIds?.has(sub.id) ?? (draggingTaskId === sub.id);
                const subLinks = taskLinksByTaskId?.[sub.id] ?? [];
                const subListItems = taskListItemsByTaskId?.[sub.id] ?? [];
                const subChildren = tasks.filter((t) => t.parent_id === sub.id);
                const subHasDetails = subLinks.length > 0 || subListItems.length > 0 || subChildren.length > 0;
                const subDetailsExpanded = expandedSubtaskDetails.has(sub.id);
                return (
                  <li
                    key={sub.id}
                    className={'task-card-subtask' + (subDragging ? ' task-card-dragging' : '') + (subHasDetails ? ' task-card-subtask-has-details' : '')}
                    data-task-id={sub.id}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input') != null) return;
                      e.stopPropagation();
                      if (e.ctrlKey) {
                        onToggleSelect?.(sub.id);
                        return;
                      }
                      if (dragSource) onHoldStartSubtask?.(e, sub.id);
                    }}
                  >
                    <div className="task-card-subtask-row">
                      {subHasDetails && (
                        <button
                          type="button"
                          className="task-card-details-chevron-main"
                          title={subDetailsExpanded ? 'Collapse details' : 'Expand details'}
                          aria-expanded={subDetailsExpanded}
                          onClick={(e) => { e.stopPropagation(); setExpandedSubtaskDetails((s) => { const n = new Set(s); if (n.has(sub.id)) n.delete(sub.id); else n.add(sub.id); return n; }); }}
                        >
                          {subDetailsExpanded ? '▼' : '▶'}
                        </button>
                      )}
                      {subEditing ? (
                        <input
                          className="task-title-edit task-card-subtask-edit"
                          value={editingTitle}
                          onChange={(e) => onEditingTitleChange(e.target.value)}
                          onBlur={() => onEditSave(sub.id, editingTitle.trim() || sub.title)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onEditSave(sub.id, editingTitle.trim() || sub.title);
                            if (e.key === 'Escape') onEditCancel();
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="task-card-subtask-title" onDoubleClick={() => onEditStart(sub.id, sub.title)}>{sub.title}</span>
                      )}
                      <div className="task-card-subtask-priority-wrap" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="task-card-subtask-btn priority" title="Priority" onClick={() => setSubPriorityOpenId((id) => id === sub.id ? null : sub.id)}>{priorityIcon(sub.priority)}</button>
                        {subPriorityOpenId === sub.id && (
                          <div className="priority-picker task-card-subtask-picker" role="listbox">
                            {PRIORITIES.map((p) => (
                              <button key={p} type="button" className={'priority-picker-option ' + (sub.priority === p ? 'selected' : '') + ' priority-' + p} onClick={() => { onPriorityChange(sub.id, p); setSubPriorityOpenId(null); }}>{priorityLabel(p)} {priorityIcon(p)}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button type="button" className={'task-card-subtask-btn' + (sub.recurring ? ' depressed' : '')} title="Recurring" onClick={(e) => { e.stopPropagation(); onRecurringToggle(sub.id); }}>↻</button>
                      <button type="button" className="task-card-subtask-btn" title="Links" onClick={(e) => { e.stopPropagation(); onOpenLinks(sub.id); }}>🔗</button>
                      <button type="button" className="task-card-subtask-btn" title="List" onClick={(e) => { e.stopPropagation(); onOpenList(sub.id); }}>📋</button>
                      <button type="button" className="task-card-subtask-btn" title="Schedule" onClick={(e) => { e.stopPropagation(); onScheduleDate(sub.id); }}>📅</button>
                      <button type="button" className="task-card-subtask-btn trash-btn" title="Remove from parent" onClick={(e) => { e.stopPropagation(); api.tasks.update({ id: sub.id, parent_id: null }).then(() => onRefresh?.()); }}>🗑</button>
                      <button type="button" className="task-card-subtask-btn trash-btn" title="Delete" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this task?')) onDelete(sub.id); }}>🗑</button>
                    </div>
                    {subHasDetails && subDetailsExpanded && (
                      <div className="task-card-details task-card-subtask-details">
                        {subLinks.length > 0 && (
                          <div className="task-card-details-section task-card-links-section">
                            <div className="task-card-details-section-header">
                              <span className="task-card-details-toggle" aria-hidden>▼</span>
                              <span className="task-card-details-label">Links: </span>
                              {subLinks.map((link) => (
                                <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="task-card-link-icon-inline" title={link.description?.trim() || link.url}>🔗</a>
                              ))}
                            </div>
                          </div>
                        )}
                        {subListItems.length > 0 && (
                          <div className="task-card-details-section task-card-list-section">
                            <div className="task-card-details-section-header">
                              <span className="task-card-details-toggle" aria-hidden>▼</span>
                              <span className="task-card-details-label">List</span>
                            </div>
                            <div className="task-card-list">
                              {subListItems.map((item) => (
                                <div key={item.id} className={'task-card-list-item' + ((sub.list_style ?? 'bullet') === 'checklist' ? ' task-card-list-item-checklist' : '')}>
                                  {(sub.list_style ?? 'bullet') === 'bullet' && <span className="task-card-list-bullet" aria-hidden>•</span>}
                                  {(sub.list_style ?? 'bullet') === 'checklist' && (
                                    <button type="button" className="task-card-list-check" title={item.completed ? 'Mark incomplete' : 'Mark complete'} onClick={() => api.taskListItems.update({ id: item.id, completed: item.completed ? 0 : 1 }).then(() => onRefresh?.(sub.id))} aria-pressed={!!item.completed}>{item.completed ? '☑' : '☐'}</button>
                                  )}
                                  <span className="task-card-list-content" style={item.completed ? { textDecoration: 'line-through', opacity: 0.8 } : undefined}>{item.content}</span>
                                  <button type="button" className="task-card-list-item-delete trash-btn" title="Remove" onClick={() => api.taskListItems.delete(item.id).then(() => onRefresh?.(sub.id))}>🗑</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {subChildren.length > 0 && (
                          <div className="task-card-details-section task-card-subtasks-section">
                            <div className="task-card-details-section-header">
                              <span className="task-card-details-toggle" aria-hidden>▼</span>
                              <span className="task-card-details-label">Subtasks</span>
                            </div>
                            <ul className="task-card-subtasks">
                              {subChildren.map((nested) => (
                                <li key={nested.id} className="task-card-subtask" data-task-id={nested.id}>
                                  <span className="task-card-subtask-title">{nested.title}</span>
                                  <button type="button" className="task-card-subtask-btn" title="Priority" onClick={() => onPriorityChange(nested.id, nested.priority ?? 'low')}>{priorityIcon(nested.priority)}</button>
                                  <button type="button" className="task-card-subtask-btn trash-btn" title="Remove from parent" onClick={(e) => { e.stopPropagation(); api.tasks.update({ id: nested.id, parent_id: null }).then(() => onRefresh?.()); }}>🗑</button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}