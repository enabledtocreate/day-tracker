/**
 * Calendar view: month grid with day cards listing scheduled tasks and feed events.
 * Description only; double-click opens task edit modal. Subtasks collapsible.
 */
import { api } from './api';
import type { ScheduledSlot, IcalFeedEvent } from './api';
import { getTasks, getChildTaskIds, loadTasks } from './task-list';

const container = document.getElementById('calendar-view');
const taskEditModal = document.getElementById('task-edit-modal') as HTMLDialogElement | null;
const taskEditId = document.getElementById('task-edit-id') as HTMLInputElement | null;
const taskEditTitle = document.getElementById('task-edit-title') as HTMLInputElement | null;
const taskEditPriority = document.getElementById('task-edit-priority') as HTMLSelectElement | null;
const taskEditRecurring = document.getElementById('task-edit-recurring') as HTMLInputElement | null;
const taskEditSave = document.getElementById('task-edit-save');
const taskEditCancel = document.getElementById('task-edit-cancel');

let calendarDisplayDate: string = new Date().toISOString().slice(0, 10);

function getMonthRange(date: string): { from: string; to: string } {
  const d = new Date(date + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const from = first.toISOString().slice(0, 10);
  const to = last.toISOString().slice(0, 10);
  return { from, to };
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

let getNextAvailableTimeForDay: (dayId: number) => Promise<{ start_time: string; end_time: string }> = () =>
  Promise.resolve({ start_time: '09:00', end_time: '09:15' });

let getTodayDate: () => string = () => new Date().toISOString().slice(0, 10);

function renderDayCard(
  dateStr: string,
  slots: ScheduledSlot[],
  onDayDoubleClick?: (date: string) => void,
  feedEventsForDay: IcalFeedEvent[] = []
): HTMLElement {
  const card = document.createElement('div');
  const today = getTodayDate();
  if (dateStr) {
    if (dateStr < today) card.className = 'calendar-day calendar-day-past';
    else if (dateStr === today) card.className = 'calendar-day calendar-day-today';
    else card.className = 'calendar-day';
  } else {
    card.className = 'calendar-day';
  }
  const dayNum = dateStr ? new Date(dateStr + 'T00:00:00').getDate() : '';
  const numEl = document.createElement('div');
  numEl.className = 'calendar-day-num';
  numEl.textContent = dateStr ? String(dayNum) : '';
  card.appendChild(numEl);
  if (!dateStr) return card;
  card.dataset.date = dateStr;
  if (onDayDoubleClick) {
    card.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.calendar-day-task')) return;
      e.stopPropagation();
      onDayDoubleClick(dateStr);
    });
  }
  card.addEventListener('dragover', (e) => {
    const t = e.dataTransfer;
    if (t?.types.includes('application/x-daytracker-task')) {
      e.preventDefault();
      t.dropEffect = 'copy';
      card.classList.add('calendar-day-drag-over');
    }
  });
  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget as Node)) card.classList.remove('calendar-day-drag-over');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('calendar-day-drag-over');
    const taskIdStr = e.dataTransfer?.getData('application/x-daytracker-task');
    const date = card.dataset.date;
    if (!taskIdStr || !date) return;
    const taskId = parseInt(taskIdStr, 10);
    if (!taskId) return;
    const tasks = getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    api.day.getOrCreate(date).then((day) =>
      getNextAvailableTimeForDay(day.id).then(({ start_time, end_time }) => {
        const ids = task.parent_id == null ? [task.id, ...getChildTaskIds(task.id)] : [task.id];
        return Promise.all(ids.map((id) =>
          api.slots.create({
            day_record_id: day.id,
            task_id: id,
            start_time,
            end_time,
          })
        ));
      })
    ).then(() => {
      loadTasks();
      refresh();
      window.dispatchEvent(new Event('daytracker-refresh'));
    }).catch(console.error);
  });
  const taskList = document.createElement('ul');
  taskList.className = 'calendar-day-tasks';
  const rootSlots = slots.filter((s) => !s.parent_id || !slots.some((o) => o.task_id === s.parent_id));
  rootSlots.forEach((slot) => {
    const childSlots = slots.filter((s) => s.parent_id === slot.task_id);
    const li = document.createElement('li');
    const p = (slot.priority || 'low') as 'commitment' | 'high' | 'medium' | 'low';
    li.className = 'calendar-day-task calendar-day-task-priority-' + p + (slot.completed ? ' calendar-day-task-completed' : '');
    li.dataset.taskId = String(slot.task_id);
    li.dataset.slotId = String(slot.id);
    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-daytracker-slot', String(slot.id));
      e.dataTransfer!.effectAllowed = 'move';
    });
    const titleSpan = document.createElement('span');
    titleSpan.className = 'calendar-task-desc';
    titleSpan.textContent = slot.title ?? 'Task';
    if (slot.completed) titleSpan.style.textDecoration = 'line-through';
    li.appendChild(titleSpan);
    if (childSlots.length > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'calendar-subtask-toggle';
      toggle.textContent = '▶';
      toggle.title = 'Expand subtasks';
      const subList = document.createElement('div');
      subList.className = 'task-subtasks';
      subList.style.display = 'none';
      childSlots.forEach((c) => {
        const sub = document.createElement('div');
        sub.className = 'calendar-subtask' + (c.completed ? ' calendar-subtask-completed' : '');
        sub.textContent = c.title ?? '';
        if (c.completed) sub.style.textDecoration = 'line-through';
        subList.appendChild(sub);
      });
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = subList.style.display !== 'none';
        subList.style.display = open ? 'none' : 'block';
        toggle.textContent = open ? '▶' : '▼';
      });
      li.append(toggle, subList);
    }
    li.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openTaskEditModal(slot.task_id);
    });
    taskList.appendChild(li);
  });
  feedEventsForDay.forEach((ev) => {
    const li = document.createElement('li');
    li.className = 'calendar-day-task calendar-day-feed-event';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'calendar-task-desc';
    titleSpan.textContent = ev.title || 'Event';
    li.appendChild(titleSpan);
    taskList.appendChild(li);
  });
  card.appendChild(taskList);
  return card;
}

function openTaskEditModal(taskId: number): void {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !taskEditModal || !taskEditId || !taskEditTitle || !taskEditPriority || !taskEditRecurring) return;
  taskEditId.value = String(task.id);
  taskEditTitle.value = task.title;
  taskEditPriority.value = task.priority;
  taskEditRecurring.checked = task.recurring;
  taskEditModal.showModal();
}

function closeTaskEditModal(): void {
  taskEditModal?.close();
}

function saveTaskEdit(): void {
  const id = taskEditId?.value ? parseInt(taskEditId.value, 10) : 0;
  const title = taskEditTitle?.value?.trim();
  if (!id || !title) return;
  api.tasks.update({
    id,
    title,
    priority: (taskEditPriority?.value as 'commitment' | 'high' | 'medium' | 'low') || 'medium',
    recurring: taskEditRecurring?.checked ?? false,
  }).then(() => {
    closeTaskEditModal();
    loadTasks();
    refresh();
  }).catch(console.error);
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function prevMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function nextMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function refresh(): void {
  if (!container) return;
  const date = calendarDisplayDate;
  const { from, to } = getMonthRange(date);
  container.innerHTML = '';

  const nav = document.createElement('div');
  nav.className = 'calendar-month-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'calendar-month-prev';
  prevBtn.textContent = '◀';
  prevBtn.title = 'Previous month';
  prevBtn.setAttribute('aria-label', 'Previous month');
  const monthLabel = document.createElement('span');
  monthLabel.className = 'calendar-month-label';
  monthLabel.textContent = formatMonthLabel(date);
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'calendar-month-next';
  nextBtn.textContent = '▶';
  nextBtn.title = 'Next month';
  nextBtn.setAttribute('aria-label', 'Next month');
  prevBtn.addEventListener('click', () => {
    calendarDisplayDate = prevMonth(calendarDisplayDate);
    refresh();
  });
  nextBtn.addEventListener('click', () => {
    calendarDisplayDate = nextMonth(calendarDisplayDate);
    refresh();
  });
  nav.appendChild(prevBtn);
  nav.appendChild(monthLabel);
  nav.appendChild(nextBtn);
  container.appendChild(nav);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const days = buildCalendarDays(date);
  Promise.all([
    api.slots.listByDateRange(from, to),
    api.icalEvents.get(from, to).catch(() => ({ events: [] as IcalFeedEvent[], errors: [] })),
  ]).then(([slotRes, eventRes]) => {
    const byDate = slotRes.byDate || {};
    const events = eventRes.events || [];
    const feedByDate: Record<string, IcalFeedEvent[]> = {};
    events.forEach((ev) => {
      const d = ev.start.substring(0, 10);
      if (!feedByDate[d]) feedByDate[d] = [];
      feedByDate[d].push(ev);
    });
    days.forEach((dateStr) => {
      const slots = dateStr ? byDate[dateStr] || [] : [];
      const feedForDay = dateStr ? feedByDate[dateStr] || [] : [];
      grid.appendChild(renderDayCard(dateStr, slots, onDayDoubleClick, feedForDay));
    });
    container.appendChild(grid);
  }).catch(console.error);
}

let onDayDoubleClick: ((date: string) => void) | undefined;

export function initCalendarView(
  getScheduleViewDate: () => string,
  _setScheduleViewDateAndRefresh: (date: string) => void,
  nextAvailableTimeForDay: (dayId: number) => Promise<{ start_time: string; end_time: string }>,
  getTodayDateFn?: () => string,
  onDayDoubleClickFn?: (date: string) => void
): { refresh: () => void; setMonthFromDate: (date: string) => void } {
  calendarDisplayDate = getScheduleViewDate();
  getNextAvailableTimeForDay = nextAvailableTimeForDay;
  if (getTodayDateFn) getTodayDate = getTodayDateFn;
  onDayDoubleClick = onDayDoubleClickFn;
  taskEditSave?.addEventListener('click', saveTaskEdit);
  taskEditCancel?.addEventListener('click', closeTaskEditModal);
  return {
    refresh,
    setMonthFromDate: (date: string) => {
      calendarDisplayDate = date;
      refresh();
    },
  };
}
