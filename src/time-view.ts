/**
 * Time view: configurable start/end/increment, drag or double-click to schedule, resize blocks, check.
 */
import type { Task, ScheduledSlot, DayRecord, TimeSettings, IcalFeedEvent } from './api';
import { api } from './api';
import type { TaskLink } from './api';
import { openTaskListModal } from './task-list-items-ui';
import { getChildTaskIds, getTasks, showPriorityPicker } from './task-list';
import { openLinkModalForTask } from './links';
import { confirmUnschedulePartiallyComplete } from './unschedule-modal';
// Legacy mobile.ts removed (see `.apm/_WORKSPACE/TODO-mobile.md §0.9 Step 2`).
// Inline replacements; the legacy Vite build is not the shipped target.
const isMobileView = (): boolean => window.matchMedia('(max-width: 768px)').matches;
const getTaskSlideIndex = (): number => 0;

const ROW_HEIGHT = 32;
const DEBUG_DATE_KEY = 'daytracker_debug_date';

function getCurrentDate(): string {
  const checkbox = document.getElementById('debug-mode-checkbox') as HTMLInputElement | null;
  if (checkbox?.checked) {
    const input = document.getElementById('debug-date') as HTMLInputElement | null;
    if (input?.value) return input.value;
    const stored = sessionStorage.getItem(DEBUG_DATE_KEY);
    if (stored) return stored;
  }
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
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

function populateHourDropdown(select: HTMLSelectElement, selectedHour: number): void {
  select.innerHTML = '';
  for (let h = 0; h <= 23; h++) {
    const option = document.createElement('option');
    option.value = String(h);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    option.textContent = h12 + ':00 ' + period;
    if (h === selectedHour) option.selected = true;
    select.appendChild(option);
  }
}

let currentDay: DayRecord | null = null;
let settings: TimeSettings = { start_hour: 6, end_hour: 23, increment_value: 15, increment_unit: 'min' };
let slots: ScheduledSlot[] = [];
let slotDurationMinutes: number = 15;
let slotLabels: string[] = [];
let viewStartMinutes: number = 0;
export type SlotsChangedExtra = { unassignedRootIds: Set<number>; incompleteRootIds: Set<number> };
let onSlotsChanged: ((ids: Set<number>, extra?: SlotsChangedExtra) => void) | null = null;
let timeLineInterval: number | null = null;
let scheduleViewDate: string | null = null;
/** When set before render, the block for this task_id will open in title-edit mode after render. */
let openEditForTaskId: number | null = null;
/** Read-only events from subscribed iCal feeds (loaded with slots). */
let feedEvents: IcalFeedEvent[] = [];
/** Per-feed errors when loading calendar feeds (so we can show and log). */
let feedErrors: Array<{ feed_url: string; message: string }> = [];

const timeViewEl = document.getElementById('time-view');
const timeStartInput = document.getElementById('time-start') as HTMLSelectElement | null;
const timeEndInput = document.getElementById('time-end') as HTMLSelectElement | null;
const timeIncrementInput = document.getElementById('time-increment') as HTMLInputElement | null;
const timeIncrementUnitSelect = document.getElementById('time-increment-unit') as HTMLSelectElement | null;

function getSlotDurationMinutes(): number {
  const v = settings.increment_value;
  return settings.increment_unit === 'hr' ? v * 60 : v;
}

function buildSlotLabels(): string[] {
  const startMin = settings.start_hour * 60;
  const endMin = settings.end_hour * 60;
  const step = getSlotDurationMinutes();
  const labels: string[] = [];
  for (let m = startMin; m < endMin; m += step) {
    labels.push(formatTimeAMPM(m));
  }
  return labels;
}

function loadSettings(): Promise<void> {
  return api.settings.get().then((s) => {
    settings = s;
    slotDurationMinutes = getSlotDurationMinutes();
    slotLabels = buildSlotLabels();
    if (timeStartInput) populateHourDropdown(timeStartInput, settings.start_hour);
    if (timeEndInput) populateHourDropdown(timeEndInput, settings.end_hour);
    if (timeIncrementInput) timeIncrementInput.value = String(settings.increment_value);
    if (timeIncrementUnitSelect) timeIncrementUnitSelect.value = settings.increment_unit;
  });
}

function saveSettingsFromInputs(): void {
  const start = timeStartInput ? parseInt(timeStartInput.value, 10) : settings.start_hour;
  const end = timeEndInput ? parseInt(timeEndInput.value, 10) : settings.end_hour;
  const incVal = timeIncrementInput ? parseInt(timeIncrementInput.value, 10) : settings.increment_value;
  const incUnit = timeIncrementUnitSelect?.value === 'hr' ? 'hr' : 'min';
  api.settings.update({ start_hour: start, end_hour: end, increment_value: incVal, increment_unit: incUnit }).then(() => {
    settings = { start_hour: start, end_hour: end, increment_value: incVal, increment_unit: incUnit };
    slotDurationMinutes = getSlotDurationMinutes();
    slotLabels = buildSlotLabels();
    viewStartMinutes = settings.start_hour * 60;
    render();
  });
}

function getScheduleViewDate(): string {
  if (scheduleViewDate) return scheduleViewDate;
  return getCurrentDate();
}

function ensureDay(): Promise<DayRecord> {
  const today = getCurrentDate();
  const date = getScheduleViewDate();
  const runRollover = date === today;
  return (runRollover ? api.rollover(today) : Promise.resolve({ ok: true }))
    .then(() => api.day.getOrCreate(date))
    .then((d) => {
      currentDay = d;
      return d;
    });
}

function getNextAvailableTimeForDay(dayId: number): Promise<{ start_time: string; end_time: string }> {
  return loadSettings().then(() =>
    api.slots.list(dayId).then((r) => {
      const daySlots = (r.slots || []).filter((s) => s.id);
      const startMin = settings.start_hour * 60;
      const endMin = settings.end_hour * 60;
      const step = getSlotDurationMinutes();
      const ranges: Array<[number, number]> = daySlots.map((s): [number, number] => [
        timeToMinutes(s.start_time),
        timeToMinutes(s.end_time),
      ]).sort((a, b) => a[0] - b[0]);
      let slotStart = startMin;
      while (slotStart < endMin - step) {
        const slotEnd = slotStart + step;
        const overlaps = ranges.some(([s, e]) => slotStart < e && slotEnd > s);
        if (!overlaps) return { start_time: minutesToTime(slotStart), end_time: minutesToTime(slotEnd) };
        slotStart += step;
      }
      return { start_time: minutesToTime(startMin), end_time: minutesToTime(startMin + step) };
    })
  );
}

function loadSlots(): Promise<void> {
  if (!currentDay) return Promise.resolve();
  const viewDate = getScheduleViewDate();
  const feedLoadingEl = document.getElementById('schedule-feed-loading');
  if (feedLoadingEl) {
    feedLoadingEl.classList.add('visible');
    feedLoadingEl.setAttribute('aria-hidden', 'false');
  }
  const icalPromise = api.icalEvents.get(viewDate, viewDate)
    .catch((err) => {
      feedErrors = [{ feed_url: '', message: err instanceof Error ? err.message : 'Could not load calendar feeds.' }];
      return { events: [] as IcalFeedEvent[], errors: feedErrors };
    })
    .finally(() => {
      if (feedLoadingEl) {
        feedLoadingEl.classList.remove('visible');
        feedLoadingEl.setAttribute('aria-hidden', 'true');
      }
    });
  return Promise.all([
    api.slots.list(currentDay.id),
    icalPromise,
  ]).then(([slotRes, eventRes]) => {
    const seen = new Set<number>();
    slots = (slotRes.slots || []).filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    feedEvents = eventRes.events || [];
    feedErrors = eventRes.errors || [];
    render();
    const today = getCurrentDate();
    const future = new Date(today + 'T00:00:00');
    future.setFullYear(future.getFullYear() + 1);
    const futureStr = future.toISOString().slice(0, 10);

    api.slots.listByDateRange(today, futureStr).then((r) => {
      const scheduledIds = new Set<number>();
      const byDate = r.byDate || {};
      Object.values(byDate).forEach((arr: ScheduledSlot[]) => arr.forEach((s) => scheduledIds.add(s.task_id)));
      if (getScheduleViewDate() !== today) {
        onSlotsChanged?.(scheduledIds);
        return;
      }
      const incompleteRootIds = new Set<number>();
      const yesterday = new Date(today + 'T00:00:00');
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      api.day.getOrCreate(yesterdayStr)
        .then((day) => api.slots.list(day.id))
        .then((pastRes) => {
          const pastSlots = pastRes.slots || [];
          const pastByTaskId = new Map<number, ScheduledSlot>();
          pastSlots.forEach((s) => pastByTaskId.set(s.task_id, s));
          const pastChildByParent = new Map<number, ScheduledSlot[]>();
          const pastRoots: ScheduledSlot[] = [];
          pastSlots.forEach((s) => {
            if (s.parent_id != null && pastByTaskId.has(s.parent_id)) {
              const arr = pastChildByParent.get(s.parent_id) || [];
              arr.push(s);
              pastChildByParent.set(s.parent_id, arr);
            } else {
              pastRoots.push(s);
            }
          });
          pastRoots.forEach((root) => {
            const childSlots = pastChildByParent.get(root.task_id) || [];
            if (childSlots.length === 0) return;
            const allDone = root.completed && childSlots.every((c) => c.completed);
            const noneDone = !root.completed && childSlots.every((c) => !c.completed);
            if (!allDone && !noneDone) incompleteRootIds.add(root.task_id);
          });
          onSlotsChanged?.(scheduledIds, { unassignedRootIds: new Set(), incompleteRootIds });
        })
        .catch(() => onSlotsChanged?.(scheduledIds, { unassignedRootIds: new Set(), incompleteRootIds: new Set() }));
    }).catch(() => onSlotsChanged?.(new Set(slots.map((s) => s.task_id))));
  });
}

function snapToSlot(minutes: number): number {
  const start = settings.start_hour * 60;
  const step = slotDurationMinutes;
  const offset = minutes - start;
  const slot = Math.round(offset / step) * step + start;
  return Math.max(start, Math.min(settings.end_hour * 60 - step, slot));
}

function computeBlockColumns(slotList: ScheduledSlot[]): Map<number, number> {
  const byId = new Map<number, number>();
  const sorted = [...slotList].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  const columns: Array<{ endMin: number }> = [];
  for (const s of sorted) {
    const startMin = timeToMinutes(s.start_time);
    const endMin = timeToMinutes(s.end_time);
    let col = 0;
    while (col < columns.length && columns[col].endMin > startMin) col++;
    if (col === columns.length) columns.push({ endMin: 0 });
    columns[col].endMin = endMin;
    byId.set(s.id, col);
  }
  return byId;
}

function updateScheduleDate(): void {
  const el = document.getElementById('schedule-date');
  if (!el) return;
  const date = getScheduleViewDate();
  const d = new Date(date + 'T00:00:00');
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  el.textContent = '— ' + d.toLocaleDateString('en-US', options);
}

/** Puts the block's title into edit mode (input, focus, blur to save). */
function openBlockTitleEdit(block: HTMLElement, taskId: number): void {
  const titleEl = block.querySelector('.time-block-header .time-block-title') as HTMLElement | null;
  if (!titleEl) return;
  const currentTitle = titleEl.textContent || '';
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'time-block-edit';
  editInput.value = currentTitle;
  titleEl.replaceWith(editInput);
  editInput.focus();
  editInput.select();
  const commitEdit = () => {
    const v = editInput.value.trim();
    if (v && v !== currentTitle) {
      api.tasks.update({ id: taskId, title: v }).then(() => loadSlots());
    } else {
      editInput.replaceWith(titleEl);
    }
  };
  editInput.addEventListener('blur', commitEdit);
  editInput.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') editInput.blur();
    if (ke.key === 'Escape') {
      editInput.removeEventListener('blur', commitEdit);
      editInput.replaceWith(titleEl);
    }
  });
}

function renderCurrentTimeLine(blocksCol: HTMLElement): void {
  const checkbox = document.getElementById('debug-mode-checkbox') as HTMLInputElement | null;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMin = settings.start_hour * 60;
  const endMin = settings.end_hour * 60;

  let line = blocksCol.querySelector('.current-time-line') as HTMLElement | null;

  if (checkbox?.checked || nowMinutes < startMin || nowMinutes > endMin) {
    if (line) line.remove();
    return;
  }

  if (!line) {
    line = document.createElement('div');
    line.className = 'current-time-line';
    blocksCol.appendChild(line);
  }

  const top = ((nowMinutes - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT;
  line.style.top = top + 'px';
}

function render(): void {
  if (!timeViewEl) return;
  viewStartMinutes = settings.start_hour * 60;
  const totalSlots = slotLabels.length;
  const totalHeight = totalSlots * ROW_HEIGHT;
  const viewDate = getScheduleViewDate();

  const untimedEl = document.getElementById('schedule-untimed-feed');
  if (untimedEl) {
    untimedEl.innerHTML = '';
    untimedEl.className = 'schedule-untimed-feed';
    const untimedForDay = feedEvents.filter((e) => e.allDay && e.start.startsWith(viewDate));
    if (feedErrors.length > 0) {
      const errBlock = document.createElement('div');
      errBlock.className = 'schedule-feed-errors';
      feedErrors.forEach(({ feed_url, message }) => {
        const p = document.createElement('p');
        p.textContent = feed_url ? `${message} (${feed_url})` : message;
        errBlock.appendChild(p);
      });
      untimedEl.appendChild(errBlock);
      untimedEl.style.display = '';
    }
    if (untimedForDay.length > 0) {
      untimedForDay.forEach((ev) => {
        const chip = document.createElement('div');
        chip.className = 'schedule-untimed-feed-chip';
        chip.textContent = ev.title || 'Event';
        untimedEl.appendChild(chip);
      });
      untimedEl.style.display = '';
    }
    if (feedErrors.length === 0 && untimedForDay.length === 0) {
      untimedEl.style.display = 'none';
    }
  }

  timeViewEl.innerHTML = '';
  timeViewEl.className = 'time-view';

  const container = document.createElement('div');
  container.className = 'time-view-container';
  container.style.height = totalHeight + 'px';

  const labelsCol = document.createElement('div');
  labelsCol.className = 'time-view-labels';
  slotLabels.forEach((label) => {
    const row = document.createElement('div');
    row.className = 'time-view-label-row';
    row.style.height = ROW_HEIGHT + 'px';
    row.textContent = label;
    labelsCol.appendChild(row);
  });
  container.appendChild(labelsCol);

  const blocksCol = document.createElement('div');
  blocksCol.className = 'time-view-blocks';
  blocksCol.style.height = totalHeight + 'px';
  blocksCol.dataset.dayId = String(currentDay?.id ?? '');

  for (let i = 0; i <= slotLabels.length; i++) {
    const min = viewStartMinutes + i * slotDurationMinutes;
    const isHour = min % 60 === 0;
    const line = document.createElement('div');
    line.className = isHour ? 'time-grid-line hour' : 'time-grid-line increment';
    line.style.top = (i * ROW_HEIGHT) + 'px';
    blocksCol.appendChild(line);
  }

  const slotByTaskId = new Map<number, ScheduledSlot>();
  slots.forEach(s => slotByTaskId.set(s.task_id, s));

  const childSlotsByParent = new Map<number, ScheduledSlot[]>();
  const rootSlots: ScheduledSlot[] = [];
  slots.forEach(s => {
    if (s.parent_id != null && slotByTaskId.has(s.parent_id)) {
      const arr = childSlotsByParent.get(s.parent_id) || [];
      arr.push(s);
      childSlotsByParent.set(s.parent_id, arr);
    } else {
      rootSlots.push(s);
    }
  });

  const cols = computeBlockColumns(rootSlots);
  const maxCol = rootSlots.length ? Math.max(...cols.values()) + 1 : 1;

  rootSlots.forEach((slot) => {
    const childSlots = childSlotsByParent.get(slot.task_id) || [];
    const childSlotIds = childSlots.map(c => c.id);
    const startMin = timeToMinutes(slot.start_time);
    const endMin = timeToMinutes(slot.end_time);
    const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT;
    const height = ((endMin - startMin) / slotDurationMinutes) * ROW_HEIGHT;
    const col = cols.get(slot.id) ?? 0;
    const widthPct = 100 / maxCol;
    const leftPct = col * widthPct;

    const block = document.createElement('div');
    const groupAllComplete =
      childSlots.length > 0 && !!slot.completed && childSlots.every((c) => !!c.completed);
    const showBlockCompletedOverlay = childSlots.length > 0 ? groupAllComplete : !!slot.completed;
    block.className =
      'time-block' +
      (childSlots.length > 0 ? ' time-block-has-group' : '') +
      (showBlockCompletedOverlay ? ' completed' : '');
    block.dataset.slotId = String(slot.id);
    block.style.top = top + 'px';
    block.style.height = height + 'px';
    block.style.left = leftPct + '%';
    block.style.width = (widthPct - 1) + '%';

    /* Allow dropping a URL (e.g. from Chrome address bar) to open link modal with URL pre-filled */
    block.addEventListener('dragover', (e) => {
      const dt = e.dataTransfer;
      if (!dt || dt.types.includes('application/x-daytracker-slot')) return;
      if (dt.types.includes('text/uri-list') || dt.types.includes('text/plain')) {
        e.preventDefault();
        e.stopPropagation();
        dt.dropEffect = 'link';
        block.classList.add('time-block-drop-url');
      }
    });
    block.addEventListener('dragleave', () => block.classList.remove('time-block-drop-url'));
    block.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      block.classList.remove('time-block-drop-url');
      if (!dt || dt.types.includes('application/x-daytracker-slot')) return;
      let url = (dt.types.includes('text/uri-list') ? dt.getData('text/uri-list') : dt.getData('text/plain') || '').trim();
      if (url) url = url.split(/[\r\n]+/)[0].trim();
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
      e.preventDefault();
      e.stopPropagation();
      openLinkModalForTask(slot.task_id, url);
    });

    const header = document.createElement('div');
    header.className =
      'time-block-header' +
      (childSlots.length > 0 && slot.completed ? ' time-block-group-member-completed' : '');

    const priorityBtn = document.createElement('button');
    priorityBtn.type = 'button';
    const slotPriority = slot.priority || 'low';
    priorityBtn.className = 'time-block-priority time-block-priority-btn priority-' + slotPriority;
    priorityBtn.textContent = slotPriority === 'commitment' ? '★' : slotPriority === 'high' ? '↑' : slotPriority === 'medium' ? '●' : '↓';
    priorityBtn.title = 'Priority: ' + slotPriority + ' (click to select)';
    priorityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showPriorityPicker(priorityBtn, (slot.priority as Task['priority']) ?? undefined, (p) => {
        api.tasks.update({ id: slot.task_id, priority: p }).then(() => loadSlots());
      });
    });
    header.appendChild(priorityBtn);

    if (slot.has_list) {
      const listBtn = document.createElement('button');
      listBtn.type = 'button';
      listBtn.className = 'time-block-list-btn';
      listBtn.title = 'List items';
      listBtn.textContent = '📋';
      listBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTaskListModal(slot.task_id, slot.list_style ?? 'bullet', () => loadSlots());
      });
      header.appendChild(listBtn);
    }

    const titleWrap = document.createElement('div');
    titleWrap.className = 'time-block-title-wrap';
    const title = document.createElement('div');
    title.className = 'time-block-title';
    title.textContent = slot.title ?? 'Task';
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const performRootCompleteToggle = (): void => {
      const newCompleted = !slot.completed;
      const updates = [api.slots.update({ id: slot.id, completed: newCompleted })];
      Promise.all(updates).then(() => {
        if (slot.recurring && newCompleted) {
          const deletes = [api.slots.delete(slot.id), ...childSlotIds.map(id => api.slots.delete(id))];
          Promise.all(deletes).then(() => loadSlots());
        } else {
          loadSlots();
        }
      });
    };
    if (!isMobileView()) {
      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.className = 'time-block-check';
      checkBtn.title = 'Mark complete';
      checkBtn.textContent = '✓';
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        performRootCompleteToggle();
      });
      header.appendChild(checkBtn);
    } else {
      let blockSwipeStartX = 0;
      let blockSwipeStartY = 0;
      block.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length === 1) {
          blockSwipeStartX = e.touches[0].clientX;
          blockSwipeStartY = e.touches[0].clientY;
        }
      }, { passive: true });
      block.addEventListener('touchend', (e: TouchEvent) => {
        if (e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - blockSwipeStartX;
        const dy = e.changedTouches[0].clientY - blockSwipeStartY;
        if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          e.stopPropagation();
          performRootCompleteToggle();
        }
      }, { passive: false });
    }

    const addLinkBtn = document.createElement('button');
    addLinkBtn.type = 'button';
    addLinkBtn.className = 'time-block-link';
    addLinkBtn.innerHTML = '🔗<span class="link-plus">+</span>';
    addLinkBtn.title = 'Add link';
    addLinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLinkModalForTask(slot.task_id);
    });
    header.appendChild(addLinkBtn);

    const addListBtn = document.createElement('button');
    addListBtn.type = 'button';
    addListBtn.className = 'time-block-link';
    addListBtn.innerHTML = '📋<span class=\"link-plus\">+</span>';
    addListBtn.title = 'Add list';
    addListBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskListModal(slot.task_id, slot.list_style ?? 'bullet', () => loadSlots());
    });
    header.appendChild(addListBtn);

    const dateBtn = document.createElement('button');
    dateBtn.type = 'button';
    dateBtn.className = 'time-block-date';
    dateBtn.title = 'Change date';
    dateBtn.textContent = '📅';
    dateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('daytracker-change-slot-date', { detail: { slotId: slot.id } }));
    });
    header.appendChild(dateBtn);

    const recurringBtn = document.createElement('button');
    recurringBtn.type = 'button';
    recurringBtn.className = 'time-block-recurring' + (slot.recurring ? ' depressed' : '');
    recurringBtn.title = 'Recurring: re-add to list when completed';
    recurringBtn.textContent = '↻';
    recurringBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      api.tasks.update({ id: slot.task_id, recurring: !slot.recurring }).then(() => loadSlots());
    });
    header.appendChild(recurringBtn);

    const trashBtn = document.createElement('button');
    trashBtn.type = 'button';
    trashBtn.className = 'time-block-trash';
    trashBtn.title = 'Remove from schedule';
    trashBtn.textContent = '🗑';
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmUnschedulePartiallyComplete(slot.id).then(({ choice, taskId, childSlots }) => {
        if (choice === 'cancel') return;
        const afterSlotsDeleted = () => {
          if (taskId != null) {
            api.tasks.delete(taskId).then(() => {
              loadSlots();
              window.dispatchEvent(new Event('daytracker-refresh'));
              window.dispatchEvent(new Event('daytracker-unschedule'));
            }).catch(console.error);
          } else {
            loadSlots();
            window.dispatchEvent(new Event('daytracker-refresh'));
          }
        };
        if (choice === 'orphan' && childSlots?.length) {
          const incomplete = childSlots.filter((c) => c.completed !== 1);
          Promise.all(incomplete.map((c) => api.slots.delete(c.id)))
            .then(() => api.slots.delete(slot.id))
            .then(afterSlotsDeleted)
            .catch(console.error);
        } else {
          api.slots.delete(slot.id).then(afterSlotsDeleted).catch(console.error);
        }
      });
    });
    header.appendChild(trashBtn);

    block.appendChild(header);

    api.links.list(slot.task_id).then((res) => {
      if (res.links.length === 0) return;
      res.links.forEach((link: TaskLink) => {
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'time-block-link-inline';
        linkBtn.textContent = '🔗';
        linkBtn.title = link.description || link.url;
        linkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(link.url, '_blank');
        });
        titleWrap.appendChild(linkBtn);
      });
    });

    if (childSlots.length > 0) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'time-block-children';
      childrenDiv.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      childSlots.forEach(child => {
        const childWrap = document.createElement('div');
        childWrap.className = 'time-block-child-wrap';

        const childRow = document.createElement('div');
        childRow.className = 'time-block-child time-block-child-header' + (child.completed ? ' child-completed' : '');

        const childPrioritySpan = document.createElement('span');
        childPrioritySpan.className = 'time-block-priority time-block-child-priority';
        const childP = child.priority || 'low';
        childPrioritySpan.textContent = childP === 'commitment' ? '★' : childP === 'high' ? '↑' : childP === 'medium' ? '●' : '↓';
        childPrioritySpan.title = 'Priority: ' + childP;

        const childTitleWrap = document.createElement('span');
        childTitleWrap.className = 'time-block-child-title-wrap';
        const childTitle = document.createElement('span');
        childTitle.className = 'time-block-child-title';
        childTitle.textContent = child.title ?? 'Subtask';
        childTitle.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'time-block-child-title-edit';
          input.value = child.title ?? '';
          childTitle.replaceWith(input);
          input.focus();
          input.select();
          const commit = () => {
            const v = input.value.trim();
            if (v && v !== (child.title ?? '')) {
              api.tasks.update({ id: child.task_id, title: v }).then(() => loadSlots());
            } else {
              input.replaceWith(childTitle);
            }
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') input.blur();
            if (ke.key === 'Escape') {
              input.removeEventListener('blur', commit);
              input.replaceWith(childTitle);
            }
          });
        });
        childTitleWrap.appendChild(childTitle);

        const performChildCompleteToggle = (): void => {
          const nowComplete = !child.completed;
          const updates: Promise<unknown>[] = [api.slots.update({ id: child.id, completed: nowComplete })];
          if (!nowComplete && slot.completed) {
            updates.push(api.slots.update({ id: slot.id, completed: false }));
          }
          Promise.all(updates).then(() => loadSlots());
        };

        const childLinkBtn = document.createElement('button');
        childLinkBtn.type = 'button';
        childLinkBtn.className = 'time-block-link';
        childLinkBtn.innerHTML = '🔗<span class="link-plus">+</span>';
        childLinkBtn.title = 'Add link';
        childLinkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openLinkModalForTask(child.task_id);
        });

        const childOrphanBtn = document.createElement('button');
        childOrphanBtn.type = 'button';
        childOrphanBtn.className = 'time-block-orphan';
        childOrphanBtn.title = 'Make own task (orphan)';
        childOrphanBtn.textContent = '⊕';
        childOrphanBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          api.tasks.update({ id: child.task_id, parent_id: null }).then(() => {
            loadSlots();
            window.dispatchEvent(new Event('daytracker-refresh'));
          }).catch(console.error);
        });

        if (!isMobileView()) {
          const childCheckBtn = document.createElement('button');
          childCheckBtn.type = 'button';
          childCheckBtn.className = 'time-block-check';
          childCheckBtn.title = 'Mark subtask complete';
          childCheckBtn.textContent = '✓';
          childCheckBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            performChildCompleteToggle();
          });
          childRow.append(childPrioritySpan, childTitleWrap, childCheckBtn, childLinkBtn, childOrphanBtn);
        } else {
          let childSwipeStartX = 0;
          let childSwipeStartY = 0;
          childRow.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
              childSwipeStartX = e.touches[0].clientX;
              childSwipeStartY = e.touches[0].clientY;
            }
          }, { passive: true });
          childRow.addEventListener('touchend', (e: TouchEvent) => {
            if (e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - childSwipeStartX;
            const dy = e.changedTouches[0].clientY - childSwipeStartY;
            if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
              e.preventDefault();
              e.stopPropagation();
              performChildCompleteToggle();
            }
          }, { passive: false });
          childRow.append(childPrioritySpan, childTitleWrap, childLinkBtn, childOrphanBtn);
        }
        childWrap.appendChild(childRow);

        api.links.list(child.task_id).then((res) => {
          if (res.links.length === 0) return;
          res.links.forEach((link: TaskLink) => {
            const linkBtn = document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'time-block-link-inline';
            linkBtn.textContent = '🔗';
            linkBtn.title = link.description || link.url;
            linkBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              window.open(link.url, '_blank');
            });
            childTitleWrap.appendChild(linkBtn);
          });
        });

        childrenDiv.appendChild(childWrap);
      });
      block.appendChild(childrenDiv);
    }

    const resizeHandleTop = document.createElement('div');
    resizeHandleTop.className = 'time-block-resize time-block-resize-top';
    resizeHandleTop.title = 'Drag to change start time';
    resizeHandleTop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    resizeHandleTop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const resizeStartY = e.clientY;
      let resizeStartStartMin = startMin;
      let lastNewStart = startMin;
      const onMove = (e2: PointerEvent) => {
        const dy = e2.clientY - resizeStartY;
        const slotDelta = Math.round(dy / ROW_HEIGHT) * slotDurationMinutes;
        let newStart = resizeStartStartMin + slotDelta;
        newStart = snapToSlot(newStart);
        if (newStart < settings.start_hour * 60) newStart = settings.start_hour * 60;
        if (newStart >= endMin - slotDurationMinutes) newStart = endMin - slotDurationMinutes;
        lastNewStart = newStart;
        const newHeight = ((endMin - newStart) / slotDurationMinutes) * ROW_HEIGHT;
        block.style.top = ((newStart - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT + 'px';
        block.style.height = newHeight + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (lastNewStart !== startMin) {
          const newStartTime = minutesToTime(lastNewStart);
          const updates = [
            api.slots.update({ id: slot.id, start_time: newStartTime, end_time: slot.end_time }),
            ...childSlotIds.map(cid =>
              api.slots.update({ id: cid, start_time: newStartTime, end_time: slot.end_time })
            ),
          ];
          Promise.all(updates).then(() => loadSlots());
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
    block.appendChild(resizeHandleTop);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'time-block-resize';
    resizeHandle.title = 'Drag to resize';
    let resizeStartY = 0;
    let resizeStartEndMin = 0;
    resizeHandle.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStartY = e.clientY;
      resizeStartEndMin = endMin;
      let lastNewEnd = endMin;
      const onMove = (e2: PointerEvent) => {
        const dy = e2.clientY - resizeStartY;
        const slotDelta = Math.round(dy / ROW_HEIGHT) * slotDurationMinutes;
        let newEnd = resizeStartEndMin + slotDelta;
        newEnd = snapToSlot(newEnd);
        if (newEnd <= startMin + slotDurationMinutes) newEnd = startMin + slotDurationMinutes;
        lastNewEnd = newEnd;
        block.style.height = ((newEnd - startMin) / slotDurationMinutes) * ROW_HEIGHT + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (lastNewEnd !== endMin) {
          const newEndTime = minutesToTime(lastNewEnd);
          const updates = [
            api.slots.update({ id: slot.id, start_time: slot.start_time, end_time: newEndTime }),
            ...childSlotIds.map(cid =>
              api.slots.update({ id: cid, start_time: slot.start_time, end_time: newEndTime })
            ),
          ];
          Promise.all(updates).then(() => loadSlots());
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
    block.appendChild(resizeHandle);

    block.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, .time-block-resize, .time-block-children, .time-block-links')) return;
      if (target.closest('.time-block-title')) return;
      e.preventDefault();
      block.setPointerCapture(e.pointerId);
      block.classList.add('time-block-moving');
      block.style.cursor = 'grabbing';
      const schedulePanel = block.closest('.left-bottom') as HTMLElement | null;
      schedulePanel?.classList.add('schedule-drag-active');
      window.dispatchEvent(new Event('daytracker-slot-move-start'));
      const moveStartY = e.clientY;
      const duration = endMin - startMin;
      let lastNewStart = startMin;

      const AUTO_SCROLL_EDGE = 48;
      const AUTO_SCROLL_SPEED = 10;
      let autoScrollDir = 0;
      let scrollInterval: number | null = null;
      const startScrollInterval = () => {
        if (scrollInterval != null) return;
        scrollInterval = window.setInterval(() => {
          if (schedulePanel && autoScrollDir !== 0) {
            schedulePanel.scrollTop += autoScrollDir * AUTO_SCROLL_SPEED;
          }
        }, 50);
      };
      const stopScrollInterval = () => {
        if (scrollInterval != null) {
          window.clearInterval(scrollInterval);
          scrollInterval = null;
        }
        autoScrollDir = 0;
      };

      const onMove = (e2: PointerEvent) => {
        const dy = e2.clientY - moveStartY;
        const slotDelta = Math.round(dy / ROW_HEIGHT) * slotDurationMinutes;
        let newStart = startMin + slotDelta;
        newStart = snapToSlot(newStart);
        if (newStart + duration > settings.end_hour * 60) newStart = settings.end_hour * 60 - duration;
        if (newStart < settings.start_hour * 60) newStart = settings.start_hour * 60;
        lastNewStart = newStart;
        block.style.top = ((newStart - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT + 'px';

        if (schedulePanel) {
          const rect = schedulePanel.getBoundingClientRect();
          if (e2.clientY <= rect.top + AUTO_SCROLL_EDGE) {
            autoScrollDir = -1;
            startScrollInterval();
          } else if (e2.clientY >= rect.bottom - AUTO_SCROLL_EDGE) {
            autoScrollDir = 1;
            startScrollInterval();
          } else {
            stopScrollInterval();
          }
        }
      };

      const onUp = (e2: PointerEvent) => {
        stopScrollInterval();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        block.classList.remove('time-block-moving');
        block.style.cursor = '';
        (block.closest('.left-bottom') as HTMLElement | null)?.classList.remove('schedule-drag-active');
        window.dispatchEvent(new Event('daytracker-slot-move-end'));
        const taskListArea = document.querySelector('.left-top');
        let zone: 'unassigned' | 'pending' = 'unassigned';
        if (taskListArea) {
          const tlRect = taskListArea.getBoundingClientRect();
          if (e2.clientX >= tlRect.left && e2.clientX <= tlRect.right &&
              e2.clientY >= tlRect.top && e2.clientY <= tlRect.bottom) {
            const zoneBySlide = ['unassigned', 'pending'] as const;
            // Dragged block is under the pointer; hide it from hit-testing so we get the drop target underneath
            const prevPointerEvents = block.style.pointerEvents;
            block.style.pointerEvents = 'none';
            const section = document.elementFromPoint(e2.clientX, e2.clientY)?.closest('.task-list-section') as HTMLElement | null;
            block.style.pointerEvents = prevPointerEvents;
            const zoneFromPoint = section?.dataset.dropZone;
            zone = (zoneFromPoint === 'unassigned' || zoneFromPoint === 'pending')
              ? zoneFromPoint
              : (isMobileView() ? zoneBySlide[Math.min(getTaskSlideIndex(), 1)] : 'unassigned');
            const slotDeletes = [api.slots.delete(slot.id), ...childSlotIds.map(id => api.slots.delete(id))];
            Promise.all(slotDeletes).then(() => {
              if (zone === 'unassigned') {
                loadSlots();
                window.dispatchEvent(new Event('daytracker-refresh'));
                window.dispatchEvent(new Event('daytracker-unschedule'));
              } else {
                window.dispatchEvent(new CustomEvent('daytracker-slot-dropped-on-list', {
                  detail: { taskId: slot.task_id, zone },
                }));
                loadSlots();
                window.dispatchEvent(new Event('daytracker-refresh'));
              }
            });
            return;
          }
        }
        if (lastNewStart !== startMin) {
          const newEnd = lastNewStart + duration;
          const newStartTime = minutesToTime(lastNewStart);
          const newEndTime = minutesToTime(newEnd);
          const updates = [
            api.slots.update({ id: slot.id, start_time: newStartTime, end_time: newEndTime }),
            ...childSlotIds.map(cid =>
              api.slots.update({ id: cid, start_time: newStartTime, end_time: newEndTime })
            ),
          ];
          Promise.all(updates).then(() => loadSlots());
        }
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });

    block.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      if (target.closest('button, input, .time-block-resize, .time-block-children, .time-block-links')) return;
      if (!target.closest('.time-block-title')) return;
      openBlockTitleEdit(block, slot.task_id);
    });

    blocksCol.appendChild(block);

    if (openEditForTaskId === slot.task_id) {
      openEditForTaskId = null;
      openBlockTitleEdit(block, slot.task_id);
    }
  });

  const viewDayStart = new Date(viewDate + 'T00:00:00').getTime();
  const viewDayEnd = new Date(viewDate + 'T23:59:59.999').getTime();
  const viewStartMin = settings.start_hour * 60;
  const viewEndMin = settings.end_hour * 60;
  const timedFeed: Array<{ ev: IcalFeedEvent; startMin: number; endMin: number }> = [];
  feedEvents.filter((e) => !e.allDay).forEach((ev) => {
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    if (endMs <= viewDayStart || startMs >= viewDayEnd) return;
    const displayStart = Math.max(startMs, viewDayStart);
    const displayEnd = Math.min(endMs, viewDayEnd);
    const dStart = new Date(displayStart);
    const dEnd = new Date(displayEnd);
    let startMin = dStart.getHours() * 60 + dStart.getMinutes();
    let endMin = dEnd.getHours() * 60 + dEnd.getMinutes();
    if (dEnd.getDate() !== dStart.getDate()) endMin = 24 * 60;
    if (startMin >= viewEndMin || endMin <= viewStartMin) return;
    startMin = Math.max(startMin, viewStartMin);
    endMin = Math.min(endMin, viewEndMin);
    if (startMin >= endMin) return;
    timedFeed.push({ ev, startMin, endMin });
  });
  const feedCols = new Map<IcalFeedEvent, number>();
  const feedSorted = [...timedFeed].sort((a, b) => a.startMin - b.startMin);
  const feedColumns: Array<{ endMin: number }> = [];
  feedSorted.forEach(({ ev, startMin, endMin }) => {
    let col = 0;
    while (col < feedColumns.length && feedColumns[col].endMin > startMin) col++;
    if (col === feedColumns.length) feedColumns.push({ endMin: 0 });
    feedColumns[col].endMin = endMin;
    feedCols.set(ev, col);
  });
  const feedNumCols = feedColumns.length || 1;
  const totalCols = maxCol + feedNumCols;
  const widthPct = 100 / totalCols;
  timedFeed.forEach(({ ev, startMin, endMin }) => {
    const col = feedCols.get(ev) ?? 0;
    const leftPct = (maxCol + col) * widthPct;
    const top = ((startMin - viewStartMinutes) / slotDurationMinutes) * ROW_HEIGHT;
    const height = ((endMin - startMin) / slotDurationMinutes) * ROW_HEIGHT;
    const block = document.createElement('div');
    block.className = 'time-block time-block-feed';
    block.dataset.feedUid = ev.uid;
    block.style.top = top + 'px';
    block.style.height = height + 'px';
    block.style.left = leftPct + '%';
    block.style.width = (widthPct - 1) + '%';
    const header = document.createElement('div');
    header.className = 'time-block-header';
    const title = document.createElement('div');
    title.className = 'time-block-title';
    title.textContent = ev.title || 'Event';
    header.appendChild(title);
    block.appendChild(header);
    blocksCol.appendChild(block);
  });

  let dragCounter = 0;
  blocksCol.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    blocksCol.classList.add('drag-active');
  });
  blocksCol.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      blocksCol.classList.remove('drag-active');
    }
  });
  blocksCol.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  });
  blocksCol.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    blocksCol.classList.remove('drag-active');
    if ((e.target as HTMLElement).closest?.('.time-block-feed')) return;
    const taskIdStr = e.dataTransfer?.getData('text/plain');
    const taskId = taskIdStr ? parseInt(taskIdStr, 10) : NaN;
    if (!currentDay || !Number.isFinite(taskId)) return;
    const allTasks = getTasks();
    const droppedTask = allTasks.find(t => t.id === taskId);
    if (droppedTask?.parent_id != null) return;
    const rect = blocksCol.getBoundingClientRect();
    const y = e.clientY - rect.top + blocksCol.scrollTop;
    const slotIndex = Math.floor(y / ROW_HEIGHT);
    if (slotIndex < 0 || slotIndex >= slotLabels.length) return;
    const dropStartMin = viewStartMinutes + slotIndex * slotDurationMinutes;
    const dropEndMin = dropStartMin + slotDurationMinutes;
    const startTime = minutesToTime(dropStartMin);
    const endTime = minutesToTime(dropEndMin);
    const childIds = getChildTaskIds(taskId);
    const allIds = [taskId, ...childIds];
    const dayId = currentDay.id;
    Promise.all(allIds.map(id =>
      api.slots.create({ day_record_id: dayId, task_id: id, start_time: startTime, end_time: endTime })
    )).then(() => loadSlots());
  });

  blocksCol.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.time-block')) return;
    const rect = blocksCol.getBoundingClientRect();
    const y = e.clientY - rect.top + blocksCol.scrollTop;
    const slotIndex = Math.floor(y / ROW_HEIGHT);
    if (slotIndex < 0 || slotIndex >= slotLabels.length) return;
    ensureDay().then((day) => {
      const dropStartMin = viewStartMinutes + slotIndex * slotDurationMinutes;
      const dropEndMin = dropStartMin + slotDurationMinutes;
      const startTime = minutesToTime(dropStartMin);
      const endTime = minutesToTime(dropEndMin);
      api.tasks.create({ title: 'New task' }).then((created) => {
        const taskId = created.id;
        api.slots.create({
          day_record_id: day.id,
          task_id: taskId,
          start_time: startTime,
          end_time: endTime,
        }).then(() => {
          openEditForTaskId = taskId;
          loadSlots();
          window.dispatchEvent(new Event('daytracker-refresh'));
        });
      });
    });
  });

  container.appendChild(blocksCol);
  timeViewEl.appendChild(container);

  updateScheduleDate();
  renderCurrentTimeLine(blocksCol);
}

function refresh(): void {
  api.dataIntegrity.ensure().catch(() => {}).then(() => ensureDay().then(() => loadSettings().then(() => loadSlots())));
}

function moveSlotAndChildrenToDate(slotId: number, newDate: string): Promise<void> {
  return api.slots.get(slotId).then(({ slot, childSlots }) => {
    if (!slot) return Promise.resolve();
    const children = childSlots ?? [];
    return api.day.getOrCreate(newDate).then((day) => {
      const creates = [
        api.slots.create({
          day_record_id: day.id,
          task_id: slot.task_id,
          start_time: slot.start_time,
          end_time: slot.end_time,
        }),
        ...children.map((c) =>
          api.slots.create({
            day_record_id: day.id,
            task_id: c.task_id,
            start_time: c.start_time ?? slot.start_time,
            end_time: c.end_time ?? slot.end_time,
          })
        ),
      ];
      return Promise.all(creates).then(() => {
        const deletes = [api.slots.delete(slot.id), ...children.map((c) => api.slots.delete(c.id))];
        return Promise.all(deletes).then(() => undefined);
      });
    });
  }).then(() => {
    loadSlots();
    window.dispatchEvent(new Event('daytracker-refresh'));
  }).catch(() => {});
}

export function setScheduleViewDate(date: string): void {
  scheduleViewDate = date;
}

export function initTimeView(slotsCallback?: (ids: Set<number>, extra?: SlotsChangedExtra) => void): {
  scheduleTask: (task: Task) => void;
  scheduleTaskOnDate: (task: Task, date: string) => void;
  moveSlotAndChildrenToDate: (slotId: number, newDate: string) => Promise<void>;
  refresh: () => void;
  getScheduleViewDate: () => string;
  setScheduleViewDateAndRefresh: (date: string) => void;
  getTodayDate: () => string;
  getNextAvailableTimeForDay: (dayId: number) => Promise<{ start_time: string; end_time: string }>;
} {
  onSlotsChanged = slotsCallback ?? null;

  if (timeStartInput) timeStartInput.addEventListener('change', saveSettingsFromInputs);
  if (timeEndInput) timeEndInput.addEventListener('change', saveSettingsFromInputs);
  if (timeIncrementInput) timeIncrementInput.addEventListener('change', saveSettingsFromInputs);
  if (timeIncrementUnitSelect) timeIncrementUnitSelect.addEventListener('change', saveSettingsFromInputs);

  if (timeLineInterval) clearInterval(timeLineInterval);
  timeLineInterval = window.setInterval(() => {
    const blocksCol = document.querySelector('.time-view-blocks') as HTMLElement | null;
    if (blocksCol) renderCurrentTimeLine(blocksCol);
  }, 60000);

  refresh();

  return {
    scheduleTask(task: Task) {
      if (task.parent_id != null) return;
      ensureDay().then((day) => {
        const startTime = minutesToTime(viewStartMinutes);
        const endMinVal = viewStartMinutes + slotDurationMinutes;
        const endTime = minutesToTime(endMinVal);
        const childIds = getChildTaskIds(task.id);
        const allIds = [task.id, ...childIds];
        Promise.all(allIds.map(id =>
          api.slots.create({
            day_record_id: day.id,
            task_id: id,
            start_time: startTime,
            end_time: endTime,
          })
        )).then(() => loadSlots());
      });
    },
    scheduleTaskOnDate(task: Task, date: string) {
      if (task.parent_id != null) return;
      setScheduleViewDate(date);
      ensureDay().then((day) => {
        const startTime = minutesToTime(viewStartMinutes);
        const endMinVal = viewStartMinutes + slotDurationMinutes;
        const endTime = minutesToTime(endMinVal);
        const childIds = getChildTaskIds(task.id);
        const allIds = [task.id, ...childIds];
        return Promise.all(allIds.map(id =>
          api.slots.create({
            day_record_id: day.id,
            task_id: id,
            start_time: startTime,
            end_time: endTime,
          })
        ));
      }).then(() => loadSlots());
    },
    refresh,
    getScheduleViewDate,
    setScheduleViewDateAndRefresh: (date: string) => {
      setScheduleViewDate(date);
      refresh();
    },
    getTodayDate: getCurrentDate,
    getNextAvailableTimeForDay,
    moveSlotAndChildrenToDate,
  };
}
