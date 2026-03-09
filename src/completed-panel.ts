/**
 * Completed panel: list of accomplished tasks grouped by day.
 */
import { api } from './api';

const panel = document.getElementById('completed-panel');
const listEl = document.getElementById('completed-list');
const tabBtn = document.getElementById('completed-tab-btn');
const closeBtn = document.getElementById('completed-panel-close');

type CompletedItem = { id: number; task_id: number; title: string; start_time?: string; completed_at: string; subtasks?: Array<{ id: number; task_id: number; title: string; start_time?: string; completed_at: string }> };

function timeToHours(start: string | undefined, end: string): number {
  if (!start) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

function render(byDate: Record<string, CompletedItem[]>): void {
  if (!listEl) return;
  listEl.innerHTML = '';
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  dates.forEach((date) => {
    const group = document.createElement('div');
    group.className = 'completed-day-group';
    group.dataset.date = date;
    const d = new Date(date + 'T00:00:00');
    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const ul = document.createElement('ul');
    ul.className = 'completed-day-list';
    byDate[date].forEach((item) => {
      const li = document.createElement('li');
      li.className = 'completed-item';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'completed-item-row';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'completed-item-title';
      titleSpan.textContent = item.title ?? '';
      titleWrap.appendChild(titleSpan);
      const durationSpan = document.createElement('span');
      durationSpan.className = 'completed-item-duration';
      const hours = timeToHours(item.start_time, item.completed_at);
      durationSpan.textContent = hours > 0 ? String(hours) + 'h' : '';
      titleWrap.appendChild(durationSpan);
      li.appendChild(titleWrap);
      if (item.subtasks && item.subtasks.length > 0) {
        const subUl = document.createElement('ul');
        subUl.className = 'completed-subtasks';
        item.subtasks.forEach((sub) => {
          const subLi = document.createElement('li');
          subLi.className = 'completed-subtask';
          subLi.textContent = sub.title ?? '';
          subUl.appendChild(subLi);
        });
        li.appendChild(subUl);
      }
      ul.appendChild(li);
    });
    group.appendChild(label);
    group.appendChild(ul);
    listEl.appendChild(group);
  });
}

export function initCompletedPanel(): void {
  tabBtn?.addEventListener('click', () => {
    panel?.classList.toggle('visible');
    if (panel?.classList.contains('visible')) {
      api.accomplished.listAll().then((r) => render(r.byDate)).catch(console.error);
    }
  });
  closeBtn?.addEventListener('click', () => panel?.classList.remove('visible'));
}

export function openCompletedPanelAndScrollToDate(date: string): void {
  if (!panel || !listEl) return;
  panel.classList.add('visible');
  api.accomplished.listAll().then((r) => {
    render(r.byDate);
    const group = listEl.querySelector(`.completed-day-group[data-date="${date}"]`);
    if (group) {
      group.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }).catch(console.error);
}

/** Show completed panel and load data (e.g. for mobile when sliding to Completed). */
export function showCompletedPanelAndLoad(): void {
  if (!panel) return;
  panel.classList.add('visible');
  api.accomplished.listAll().then((r) => render(r.byDate)).catch(console.error);
}
