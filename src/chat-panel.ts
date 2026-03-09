/**
 * Right panel: chat input, send to ChatGPT with task context, show advice and suggested tasks.
 */
import { api } from './api';

function getCurrentDate(): string {
  const checkbox = document.getElementById('debug-mode-checkbox') as HTMLInputElement | null;
  if (checkbox?.checked) {
    const input = document.getElementById('debug-date') as HTMLInputElement | null;
    if (input?.value) return input.value;
  }
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function buildTaskContext(): Promise<Record<string, unknown>> {
  const date = getCurrentDate();
  const [accomplishedRes, tasksRes, dayRes] = await Promise.all([
    api.accomplished.listByDate(date),
    api.tasks.list(),
    api.day.getOrCreate(date),
  ]);
  const slotsRes = await api.slots.list(dayRes.id);
  const tasks = tasksRes.tasks;
  const slots = slotsRes.slots;
  const accomplished = accomplishedRes.accomplished;

  const taskListWithFlags = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    recurring: t.recurring,
    parent_id: t.parent_id,
  }));

  const unaccomplishedToday: string[] = [];
  const scheduledTaskIds = new Set(slots.filter((s) => !s.completed).map((s) => s.task_id));
  tasks.forEach((t) => {
    if (!scheduledTaskIds.has(t.id)) unaccomplishedToday.push(t.title);
  });
  slots.filter((s) => !s.completed).forEach((s) => {
    if (s.title) unaccomplishedToday.push(s.title);
  });

  return {
    date,
    accomplished: accomplished.map((a) => ({ title: a.title, completed_at: a.completed_at })),
    taskList: taskListWithFlags,
    unaccomplishedToday: [...new Set(unaccomplishedToday)],
    slotsToday: slots.map((s) => ({ task_id: s.task_id, title: s.title, start_time: s.start_time, end_time: s.end_time, completed: !!s.completed })),
  };
}

const AI_DISABLED_TOOLTIP = 'AI is currently disabled';
const RIGHT_PANEL_STORAGE_KEY = 'daytracker_right_panel_width';
const DEFAULT_RIGHT_WIDTH = 320;

function getStoredRightPanelWidth(): number {
  const w = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
  if (w == null) return DEFAULT_RIGHT_WIDTH;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 280 ? n : DEFAULT_RIGHT_WIDTH;
}

export function initChatPanel(aiEnabled: boolean = true): void {
  const rightPanel = document.querySelector('.right-panel') as HTMLElement | null;
  const rightTop = document.querySelector('.right-panel .right-top');
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('chat-send');
  const adviceEl = document.getElementById('chat-advice');
  const suggestedEl = document.getElementById('suggested-tasks');
  const resizeHandle = document.getElementById('resize-handle') as HTMLElement | null;

  const toggleBtn = document.getElementById('chat-toggle') as HTMLButtonElement | null;

  if (rightPanel && toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = '1';
    const applyState = (collapsed: boolean) => {
      rightPanel.classList.toggle('chat-collapsed', collapsed);
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleBtn.textContent = collapsed ? 'Show AI' : 'Hide AI';
      if (collapsed) {
        rightPanel.style.flex = '0 0 28px';
        if (resizeHandle) resizeHandle.style.display = 'none';
      } else {
        const w = getStoredRightPanelWidth();
        rightPanel.style.flex = `0 0 ${w}px`;
        if (resizeHandle) resizeHandle.style.display = '';
      }
    };
    applyState(false);
    toggleBtn.addEventListener('click', () => {
      const collapsed = !rightPanel.classList.contains('chat-collapsed');
      applyState(collapsed);
    });
  }

  if (rightTop) {
    if (!aiEnabled) {
      rightTop.classList.add('chat-panel-disabled');
      rightTop.setAttribute('data-tooltip', AI_DISABLED_TOOLTIP);
      if (chatInput) chatInput.disabled = true;
      if (sendBtn) (sendBtn as HTMLButtonElement).disabled = true;
    } else {
      rightTop.classList.remove('chat-panel-disabled');
      rightTop.removeAttribute('data-tooltip');
      if (chatInput) chatInput.disabled = false;
      if (sendBtn) (sendBtn as HTMLButtonElement).disabled = false;
    }
  }

  if (!sendBtn || !chatInput) return;

  sendBtn.addEventListener('click', async () => {
    if (!aiEnabled) return;
    const message = chatInput.value.trim();
    if (!message) return;
    sendBtn.setAttribute('disabled', 'true');
    if (adviceEl) adviceEl.textContent = 'Loading…';
    if (suggestedEl) suggestedEl.innerHTML = '';

    try {
      const taskContext = await buildTaskContext();
      const res = await api.chat.send(message, taskContext);
      if (adviceEl) adviceEl.textContent = res.advice || 'No advice returned.';
      if (suggestedEl && res.suggestedTasks?.length) {
        suggestedEl.innerHTML = '';
        res.suggestedTasks.forEach((sug) => {
          const item = document.createElement('div');
          item.className = 'suggested-task-item';
          const title = document.createElement('span');
          title.className = 'suggested-task-title';
          title.textContent = sug.title;
          const addListBtn = document.createElement('button');
          addListBtn.type = 'button';
          addListBtn.textContent = 'Add to list';
          addListBtn.addEventListener('click', () => {
            api.tasks.create({
              title: sug.title,
              priority: (sug.priority as 'high' | 'medium' | 'low') || 'medium',
            }).then(() => window.dispatchEvent(new CustomEvent('daytracker-refresh'))).catch(console.error);
          });
          const addSlotBtn = document.createElement('button');
          addSlotBtn.type = 'button';
          addSlotBtn.textContent = 'Add to slot';
          addSlotBtn.addEventListener('click', async () => {
            const date = getCurrentDate();
            const day = await api.day.getOrCreate(date);
            const settings = await api.settings.get();
            const startMin = settings.start_hour * 60;
            const inc = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
            const startTime = String(settings.start_hour).padStart(2, '0') + ':00';
            const endMin = startMin + inc;
            const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
            const created = await api.tasks.create({
              title: sug.title,
              priority: (sug.priority as 'high' | 'medium' | 'low') || 'medium',
            });
            await api.slots.create({
              day_record_id: day.id,
              task_id: created.id,
              start_time: startTime,
              end_time: endTime,
            });
            window.dispatchEvent(new CustomEvent('daytracker-refresh'));
          });
          item.append(title, addListBtn, addSlotBtn);
          suggestedEl.appendChild(item);
        });
      }
    } catch (err) {
      if (adviceEl) adviceEl.textContent = err instanceof Error ? err.message : 'Request failed.';
    } finally {
      sendBtn.removeAttribute('disabled');
    }
  });
}
