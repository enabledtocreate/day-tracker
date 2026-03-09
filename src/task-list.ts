/**
 * Task list: card layout with bordered containers, collapsible children,
 * drag-to-subtask, drag-out-to-unparent, schedule all.
 */
import type { Task } from './api';
import { api } from './api';
import { openLinkModalForTask, renderLinksUnderElement } from './links';
import { appendTaskListItemsUI } from './task-list-items-ui';
import { isMobileView } from './mobile';
import { confirmUnschedulePartiallyComplete } from './unschedule-modal';

const unassignedListEl = document.getElementById('task-list-unassigned');
const unassignedSectionEl = document.querySelector('.task-list-section[data-drop-zone="unassigned"]') as HTMLElement | null;
const pendingSectionEl = document.querySelector('.task-list-section[data-drop-zone="pending"]') as HTMLElement | null;
const incompleteSectionEl = document.querySelector('.task-list-section[data-drop-zone="incomplete"]') as HTMLElement | null;
const newTaskInput = document.getElementById('new-task-input') as HTMLInputElement | null;
const newTaskAddBtn = document.getElementById('new-task-add-btn') as HTMLButtonElement | null;
const taskListSortSelect = document.getElementById('task-list-sort') as HTMLSelectElement | null;
const unassignZoneEl = document.getElementById('task-list-unassign-zone');

let tasks: Task[] = [];
let scheduledTaskIds: Set<number> = new Set();
let pendingRootIds: Set<number> = new Set();
let incompleteRootIds: Set<number> = new Set();
let completedNonRecurringRootIds: Set<number> = new Set();
let taskListSortOrder: 'id' | 'priority' | 'alphabetical' | 'date_added' = 'id';
let dragSourceTaskId: number | null = null;
let isDragActive = false;
let isSlotDrag = false;
let dragTaskIdForUI: number | null = null;

/** Counts are from current render (actual roots length). Omit to use ID-set sizes and show unassigned (e.g. during drag). */
function updateSectionVisibility(counts?: { unassigned: number; pending: number; incomplete: number }): void {
  const nUnassigned = counts?.unassigned ?? 1; // when unknown (e.g. drag), keep unassigned visible
  const nPending = counts?.pending ?? pendingRootIds.size;
  const nIncomplete = counts?.incomplete ?? incompleteRootIds.size;

  const showUnassigned =
    nUnassigned > 0 || (isDragActive && (isSlotDrag || dragTaskIdForUI != null));
  /* Show Pending when we have roots to display OR stored IDs (so section stays visible on mobile even if tree is briefly empty). */
  const showPending =
    nPending > 0 || pendingRootIds.size > 0 || (isDragActive && (isSlotDrag || dragTaskIdForUI != null));
  const showIncomplete =
    nIncomplete > 0 ||
    incompleteRootIds.size > 0 ||
    (isDragActive && (isSlotDrag || (dragTaskIdForUI != null && incompleteRootIds.has(getRootTaskId(dragTaskIdForUI!)))));

  /* Only show sections that have tasks (same on desktop and mobile). */
  unassignedSectionEl?.classList.toggle('task-list-section-hidden', !showUnassigned);
  pendingSectionEl?.classList.toggle('task-list-section-hidden', !showPending);
  incompleteSectionEl?.classList.toggle('task-list-section-hidden', !showIncomplete);

  const mobileNav = document.getElementById('task-list-sections-mobile-nav');
  const navBtns = mobileNav?.querySelectorAll<HTMLButtonElement>('button[data-task-slide]');
  if (navBtns?.length === 3) {
    navBtns[0].classList.toggle('task-list-nav-hidden', !showUnassigned);
    navBtns[1].classList.toggle('task-list-nav-hidden', !showPending);
    navBtns[2].classList.toggle('task-list-nav-hidden', !showIncomplete);
  }

  const sectionsEl = document.getElementById('task-list-sections');
  const visibleIndices: number[] = [showUnassigned && 0, showPending && 1, showIncomplete && 2].filter((x): x is number => x !== false);
  sectionsEl?.setAttribute('data-visible-task-slides', visibleIndices.join(','));
  window.dispatchEvent(new Event('daytracker-task-sections-visibility-changed'));
}

const PRIORITY_ORDER: Array<Task['priority']> = ['commitment', 'high', 'medium', 'low'];

function priorityIcon(p: Task['priority']): string {
  if (p === 'commitment') return '★';
  if (p === 'high') return '↑';
  if (p === 'medium') return '●';
  return '↓';
}

function priorityClass(p: Task['priority']): string {
  return `priority-${p}`;
}

export type Priority = Task['priority'];

export function showPriorityPicker(
  anchor: HTMLElement,
  currentPriority: Task['priority'] | undefined,
  onSelect: (priority: Task['priority']) => void
): void {
  const picker = document.createElement('div');
  picker.className = 'priority-picker';
  picker.setAttribute('role', 'listbox');
  const priorities: Array<Task['priority']> = ['commitment', 'high', 'medium', 'low'];
  const labels: Record<Task['priority'], string> = { commitment: 'Commitment', high: 'High', medium: 'Medium', low: 'Low' };
  priorities.forEach((p) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'priority-picker-option ' + priorityClass(p);
    option.textContent = labels[p] + ' ' + priorityIcon(p);
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String((currentPriority || 'low') === p));
    if ((currentPriority || 'low') === p) option.classList.add('selected');
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(p);
      close();
    });
    picker.appendChild(option);
  });
  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom + 2}px`;
  const close = () => {
    picker.remove();
    document.removeEventListener('click', closeHandler, true);
  };
  const closeHandler = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node) && anchor !== e.target && !anchor.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
}

type TreeNode = Task & { children: TreeNode[] };

function buildTree(items: Task[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  items.forEach((t) => byId.set(t.id, { ...t, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((t) => {
    const node = byId.get(t.id)!;
    if (t.parent_id == null) {
      roots.push(node);
    } else {
      const parent = byId.get(t.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  });
  if (taskListSortOrder === 'priority') {
    const order = (p: Task['priority']) => PRIORITY_ORDER.indexOf(p ?? 'low');
    roots.sort((a, b) => order(a.priority) - order(b.priority) || a.id - b.id);
  } else if (taskListSortOrder === 'alphabetical') {
    roots.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }) || a.id - b.id);
  } else if (taskListSortOrder === 'date_added') {
    roots.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id);
  } else {
    roots.sort((a, b) => a.id - b.id);
  }
  return roots;
}

function renderTaskCard(node: TreeNode, isChild: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'task-card' + (isChild ? ' task-card-child' : '');
  li.dataset.taskId = String(node.id);
  li.draggable = true;

  /* Allow dropping a URL (e.g. from Chrome address bar) to open link modal with URL pre-filled */
  li.addEventListener('dragover', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.types.includes('application/x-daytracker-task')) return;
    if (dt.types.includes('text/uri-list') || dt.types.includes('text/plain')) {
      e.preventDefault();
      dt.dropEffect = 'link';
      li.classList.add('task-card-drop-url');
    }
  });
  li.addEventListener('dragleave', () => li.classList.remove('task-card-drop-url'));
  li.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    li.classList.remove('task-card-drop-url');
    if (!dt || dt.types.includes('application/x-daytracker-task')) return;
    let url = (dt.types.includes('text/uri-list') ? dt.getData('text/uri-list') : dt.getData('text/plain') || '').trim();
    if (url) url = url.split(/[\r\n]+/)[0].trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
    e.preventDefault();
    e.stopPropagation();
    openLinkModalForTask(node.id, url);
  });

  const topSection = document.createElement('div');
  topSection.className = 'task-card-top';

  const row = document.createElement('div');
  row.className = 'task-row';

  const priorityBtn = document.createElement('button');
  priorityBtn.type = 'button';
  priorityBtn.className = `priority-btn ${priorityClass(node.priority)}`;
  priorityBtn.title = `Priority: ${node.priority} (click to select)`;
  priorityBtn.textContent = priorityIcon(node.priority);
  priorityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showPriorityPicker(priorityBtn, node.priority, (p) => {
      api.tasks.update({ id: node.id, priority: p }).then(() => loadTasks());
    });
  });

  const titleWrap = document.createElement('span');
  titleWrap.className = 'task-title-wrap';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = node.title;
  const dateAddedSpan = document.createElement('span');
  dateAddedSpan.className = 'task-date-added';
  if (node.created_at) {
    const d = new Date(node.created_at);
    dateAddedSpan.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  titleWrap.append(titleSpan, dateAddedSpan);
  titleSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-title-edit';
    input.value = node.title;
    titleSpan.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== node.title) {
        api.tasks.update({ id: node.id, title: v }).then(() => loadTasks());
      } else {
        input.replaceWith(titleSpan);
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') input.blur();
      if (ke.key === 'Escape') {
        input.removeEventListener('blur', commit);
        input.replaceWith(titleSpan);
      }
    });
  });

  const cycleBtn = document.createElement('button');
  cycleBtn.type = 'button';
  cycleBtn.className = 'cycle-btn' + (node.recurring ? ' depressed' : '');
  cycleBtn.title = 'Recurring: re-add to list when completed';
  cycleBtn.textContent = '↻';
  cycleBtn.addEventListener('click', () => {
    api.tasks.update({ id: node.id, recurring: !node.recurring }).then(() => loadTasks());
  });

  const linksBtn = document.createElement('button');
  linksBtn.type = 'button';
  linksBtn.className = 'links-btn';
  linksBtn.innerHTML = '🔗<span class="link-plus">+</span>';
  linksBtn.title = 'Add link';
  linksBtn.addEventListener('click', () => openLinkModalForTask(node.id));

  const listAddBtn = document.createElement('button');
  listAddBtn.type = 'button';
  listAddBtn.className = 'task-list-add-btn';
  listAddBtn.innerHTML = '📋<span class="link-plus">+</span>';
  listAddBtn.title = 'Add list';
  listAddBtn.addEventListener('click', () => {
    let listWrap = topSection.querySelector('.time-block-list') as HTMLElement | null;
    if (!listWrap) {
      listWrap = document.createElement('div');
      const childSection = topSection.querySelector('.task-children');
      if (childSection) topSection.insertBefore(listWrap, childSection);
      else topSection.appendChild(listWrap);
      appendTaskListItemsUI(listWrap, node.id, () => loadTasks(), {
        listStyle: node.list_style ?? 'bullet',
        onListStyleChange: () => loadTasks(),
        startExpanded: true,
        headerAction: 'delete',
      });
    } else {
      const body = listWrap.querySelector('.time-block-list-body');
      if (body) {
        body.classList.remove('time-block-list-collapsed');
        listWrap.querySelector('.time-block-list-toggle')?.replaceChildren('▼');
      }
    }
  });

  const calendarBtn = document.createElement('button');
  calendarBtn.type = 'button';
  calendarBtn.className = 'task-calendar-btn';
  calendarBtn.title = 'Schedule on a date';
  calendarBtn.textContent = '📅';
  calendarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('daytracker-schedule-task-date', { detail: { taskId: node.id } }));
  });

  const trashBtn = document.createElement('button');
  trashBtn.type = 'button';
  trashBtn.className = 'trash-btn';
  trashBtn.title = 'Delete';
  trashBtn.textContent = '🗑';
  trashBtn.addEventListener('click', () => {
    if (confirm('Delete this task?')) api.tasks.delete(node.id).then(() => loadTasks());
  });

  row.append(priorityBtn, titleWrap, cycleBtn, linksBtn, listAddBtn, calendarBtn, trashBtn);
  topSection.appendChild(row);

  if (node.children.length > 0) {
    const childSection = document.createElement('div');
    childSection.className = 'task-children';

    const toggleRow = document.createElement('div');
    toggleRow.className = 'child-toggle-row';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'child-toggle';
    toggle.textContent = '▼';
    toggle.title = 'Toggle subtasks';
    const childLabel = document.createElement('span');
    childLabel.className = 'child-label';
    childLabel.textContent = node.children.length + ' subtask' + (node.children.length > 1 ? 's' : '');
    toggleRow.append(toggle, childLabel);
    childSection.appendChild(toggleRow);

    const childList = document.createElement('div');
    childList.className = 'child-list';
    node.children.forEach((child) => {
      childList.appendChild(renderTaskCard(child, true));
    });
    childSection.appendChild(childList);

    toggle.addEventListener('click', () => {
      const collapsed = childSection.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
    });

    topSection.appendChild(childSection);
  }

  li.appendChild(topSection);

  api.links.list(node.id).then((r) => renderLinksUnderElement(li, r.links, node.id)).catch(() => {});

  // Drag handlers
  li.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    dragSourceTaskId = node.id;
    e.dataTransfer!.setData('text/plain', String(node.id));
    e.dataTransfer!.setData('application/x-daytracker-task', String(node.id));
    e.dataTransfer!.effectAllowed = 'move';
    window.dispatchEvent(new CustomEvent('daytracker-task-drag-start', { detail: { taskId: node.id } }));
  });

  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSourceTaskId !== null && dragSourceTaskId !== node.id) {
      e.dataTransfer!.dropEffect = 'move';
      li.classList.add('drop-target');
    }
  });

  li.addEventListener('dragleave', (e) => {
    if (!li.contains(e.relatedTarget as Node)) li.classList.remove('drop-target');
  });

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.remove('drop-target');
    const src = dragSourceTaskId;
    dragSourceTaskId = null;
    if (src == null || src === node.id) return;
    api.tasks.update({ id: src, parent_id: node.id }).then(() => loadTasks());
  });

  return li;
}

export function getChildTaskIds(taskId: number): number[] {
  const findChildren = (pid: number): number[] => {
    const children = tasks.filter(t => t.parent_id === pid);
    const ids: number[] = [];
    children.forEach(c => {
      ids.push(c.id);
      ids.push(...findChildren(c.id));
    });
    return ids;
  };
  return findChildren(taskId);
}

function getRootTaskId(taskId: number): number {
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.parent_id == null) return taskId;
  return getRootTaskId(task.parent_id);
}

export function setScheduledTaskIds(ids: Set<number>, extra?: { unassignedRootIds: Set<number>; incompleteRootIds: Set<number> }): void {
  scheduledTaskIds = ids;
  incompleteRootIds = extra?.incompleteRootIds ?? new Set();
  render();
}

function computeCompletedNonRecurringRootIds(pastFrom: string, pastTo: string): Promise<void> {
  return api.slots.listByDateRange(pastFrom, pastTo)
    .then((r) => {
      const byDate = r.byDate || {};
      const allPastSlots: Array<{ task_id: number; completed: number; parent_id?: number | null }> = [];
      Object.values(byDate).forEach((arr: { task_id: number; completed: number; parent_id?: number | null }[]) => {
        arr.forEach((s) => allPastSlots.push(s));
      });
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      const rootTaskIds = new Set<number>();
      allPastSlots.forEach((s) => {
        if (s.parent_id == null || !allPastSlots.some((o) => o.task_id === s.parent_id)) rootTaskIds.add(s.task_id);
      });
      completedNonRecurringRootIds = new Set();
      rootTaskIds.forEach((rootId) => {
        const task = taskById.get(rootId);
        if (!task || task.recurring) return;
        const rootAndChildSlots = allPastSlots.filter((s) => s.task_id === rootId || s.parent_id === rootId);
        if (rootAndChildSlots.length === 0) return;
        if (rootAndChildSlots.every((s) => s.completed === 1)) completedNonRecurringRootIds.add(rootId);
      });
    })
    .catch(() => { completedNonRecurringRootIds = new Set(); });
}

export function loadTasks(): Promise<void> {
  return api.tasks.list()
    .then((r) => {
      tasks = r.tasks;
      pendingRootIds = new Set(
        tasks.filter((t) => t.parent_id == null && (t.list_state || 'unassigned') === 'pending').map((t) => t.id)
      );
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const past = new Date(yesterday);
      past.setDate(past.getDate() - 365);
      const pastStr = past.toISOString().slice(0, 10);
      return computeCompletedNonRecurringRootIds(pastStr, yesterdayStr).then(() => render());
    })
    .catch((err) => {
      if (unassignedListEl) unassignedListEl.innerHTML = '<li class="task-list-error">Failed to load tasks. Is the server running?</li>';
      console.error(err);
    });
}

function render(): void {
  const allScheduled = new Set(scheduledTaskIds);
  scheduledTaskIds.forEach(id => {
    getChildTaskIds(id).forEach(cid => allScheduled.add(cid));
  });
  const tree = buildTree(tasks);
  const unassignedRoots = tree.filter(
    (n) =>
      !allScheduled.has(n.id) &&
      !pendingRootIds.has(n.id) &&
      !incompleteRootIds.has(n.id) &&
      !completedNonRecurringRootIds.has(n.id)
  );
  const pendingRoots = tree.filter((n) => pendingRootIds.has(n.id));
  const incompleteRoots = tree.filter((n) => incompleteRootIds.has(n.id));

  function fillList(el: HTMLElement | null, nodes: TreeNode[]): void {
    if (!el) return;
    el.innerHTML = '';
    nodes.forEach((node) => el.appendChild(renderTaskCard(node, false)));
  }

  /* Use fresh element refs in case DOM wasn't ready at module load (e.g. mobile) */
  const unassignedEl = document.getElementById('task-list-unassigned');
  const pendingEl = document.getElementById('task-list-pending');
  const incompleteEl = document.getElementById('task-list-incomplete');
  fillList(unassignedEl, unassignedRoots);
  fillList(pendingEl, pendingRoots);
  fillList(incompleteEl, incompleteRoots);
  updateSectionVisibility({
    unassigned: unassignedRoots.length,
    pending: pendingRoots.length,
    incomplete: incompleteRoots.length,
  });
  /* Re-run visibility on next frame when in mobile so viewport is correct after layout. */
  if (isMobileView()) {
    requestAnimationFrame(() => updateSectionVisibility());
  }
}

export function initTaskList(): void {
  let isAdding = false;
  if (taskListSortSelect) {
    taskListSortSelect.value = taskListSortOrder;
    taskListSortSelect.addEventListener('change', () => {
      const v = taskListSortSelect.value;
      taskListSortOrder = (v === 'priority' ? 'priority' : v === 'alphabetical' ? 'alphabetical' : v === 'date_added' ? 'date_added' : 'id') as 'id' | 'priority' | 'alphabetical' | 'date_added';
      render();
    });
  }
  function submitNewTask(): void {
    if (!newTaskInput || isAdding) return;
    const title = newTaskInput.value.trim();
    if (!title) return;
    isAdding = true;
    newTaskInput.disabled = true;
    if (newTaskAddBtn) newTaskAddBtn.disabled = true;
    api.tasks.create({ title }).then(() => {
      newTaskInput.value = '';
      loadTasks();
    }).catch(console.error).finally(() => {
      isAdding = false;
      newTaskInput.disabled = false;
      if (newTaskAddBtn) newTaskAddBtn.disabled = false;
      newTaskInput.focus();
    });
  }
  if (newTaskInput) {
    newTaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitNewTask();
    });
  }
  if (newTaskAddBtn) {
    newTaskAddBtn.addEventListener('click', () => submitNewTask());
  }

  const pendingZoneEl = document.querySelector('.task-list-drop-zone-pending') as HTMLElement | null;
  const incompleteZoneEl = document.querySelector('.task-list-drop-zone-incomplete') as HTMLElement | null;

  function showZone(el: HTMLElement | null): void {
    if (el) {
      el.classList.add('visible');
      el.setAttribute('aria-hidden', 'false');
    }
  }
  function hideZone(el: HTMLElement | null): void {
    if (el) {
      el.classList.remove('visible');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function setCanDropSections(slotDrag: boolean, taskId: number | null): void {
    unassignedSectionEl?.classList.add('can-drop');
    pendingSectionEl?.classList.add('can-drop');
    if (slotDrag) {
      incompleteSectionEl?.classList.add('can-drop');
    } else if (taskId != null && incompleteRootIds.has(getRootTaskId(taskId))) {
      incompleteSectionEl?.classList.add('can-drop');
    }
  }
  function clearCanDropSections(): void {
    document.querySelectorAll('.task-list-section.can-drop').forEach((el) => el.classList.remove('can-drop'));
  }

  function showZonesForSlotDrag(): void {
    isDragActive = true;
    isSlotDrag = true;
    dragTaskIdForUI = null;
    updateSectionVisibility();
    setCanDropSections(true, null);
    showZone(unassignZoneEl as HTMLElement);
    showZone(pendingZoneEl);
    showZone(incompleteZoneEl);
  }
  function showZonesForTaskDrag(taskId: number): void {
    isDragActive = true;
    isSlotDrag = false;
    dragTaskIdForUI = taskId;
    updateSectionVisibility();
    setCanDropSections(false, taskId);
    showZone(unassignZoneEl as HTMLElement);
    showZone(pendingZoneEl);
    const rootId = getRootTaskId(taskId);
    if (incompleteRootIds.has(rootId)) showZone(incompleteZoneEl);
  }
  function hideAllZones(): void {
    isDragActive = false;
    isSlotDrag = false;
    dragTaskIdForUI = null;
    updateSectionVisibility();
    clearCanDropSections();
    hideZone(unassignZoneEl as HTMLElement);
    hideZone(pendingZoneEl);
    hideZone(incompleteZoneEl);
    document.querySelectorAll('.task-list-section.drop-target').forEach((el) => el.classList.remove('drop-target'));
  }

  /* Re-run visibility on resize/orientation so mobile gets all three tabs when viewport is ≤768px. */
  function onViewportChange(): void {
    if (isMobileView()) updateSectionVisibility();
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

  window.addEventListener('daytracker-slot-move-start', showZonesForSlotDrag);
  window.addEventListener('daytracker-slot-move-end', hideAllZones);
  window.addEventListener('daytracker-task-drag-start', ((e: CustomEvent<{ taskId: number }>) => {
    showZonesForTaskDrag(e.detail?.taskId ?? 0);
  }) as EventListener);
  window.addEventListener('daytracker-slot-dropped-on-list', ((e: CustomEvent<{ taskId: number; zone: string }>) => {
    const { taskId, zone } = e.detail ?? {};
    if (zone === 'pending' && taskId != null) {
      const rootId = getRootTaskId(taskId);
      api.tasks.update({ id: rootId, list_state: 'pending' }).then(() => loadTasks()).catch(console.error);
    } else if (zone === 'incomplete') {
      loadTasks();
    }
  }) as EventListener);
  document.addEventListener('dragend', hideAllZones);

  function handleSlotDropOnUnassigned(slotIdStr: string): void {
    const slotId = parseInt(slotIdStr, 10);
    if (!slotId) return;
    confirmUnschedulePartiallyComplete(slotId).then(({ choice, taskId, childSlots }) => {
      if (choice === 'cancel') return;
      const afterSlotsDeleted = () => {
        if (taskId != null) {
          api.tasks.delete(taskId).then(() => {
            loadTasks();
            window.dispatchEvent(new Event('daytracker-refresh'));
          }).catch(console.error);
        } else {
          loadTasks();
          window.dispatchEvent(new Event('daytracker-refresh'));
        }
      };
      if (choice === 'orphan' && childSlots?.length) {
        const incomplete = childSlots.filter((c) => c.completed !== 1);
        Promise.all(incomplete.map((c) => api.slots.delete(c.id)))
          .then(() => api.slots.delete(slotId))
          .then(afterSlotsDeleted)
          .catch(console.error);
      } else {
        api.slots.delete(slotId).then(afterSlotsDeleted).catch(console.error);
      }
    });
  }

  function handleSlotDropOnPending(slotIdStr: string): void {
    const slotId = parseInt(slotIdStr, 10);
    if (!slotId) return;
    confirmUnschedulePartiallyComplete(slotId).then(({ choice, taskId, childSlots }) => {
      if (choice === 'cancel') return;
      const afterSlotsDeleted = (rootTaskId: number | undefined) => {
        if (rootTaskId != null) {
          api.tasks.update({ id: rootTaskId, list_state: 'pending' }).then(() => {
            loadTasks();
            window.dispatchEvent(new Event('daytracker-refresh'));
          }).catch(console.error);
        } else {
          loadTasks();
          window.dispatchEvent(new Event('daytracker-refresh'));
        }
      };
      const rootTaskId = taskId != null ? getRootTaskId(taskId) : undefined;
      if (choice === 'orphan' && childSlots?.length) {
        const incomplete = childSlots.filter((c) => c.completed !== 1);
        Promise.all(incomplete.map((c) => api.slots.delete(c.id)))
          .then(() => api.slots.delete(slotId))
          .then(() => afterSlotsDeleted(rootTaskId))
          .catch(console.error);
      } else {
        api.slots.delete(slotId).then(() => afterSlotsDeleted(rootTaskId)).catch(console.error);
      }
    });
  }

  function handleSlotDropOnIncomplete(slotIdStr: string): void {
    const slotId = parseInt(slotIdStr, 10);
    if (!slotId) return;
    confirmUnschedulePartiallyComplete(slotId).then(({ choice, childSlots }) => {
      if (choice === 'cancel') return;
      const afterSlotsDeleted = () => {
        loadTasks();
        window.dispatchEvent(new Event('daytracker-refresh'));
      };
      if (choice === 'orphan' && childSlots?.length) {
        const incomplete = childSlots.filter((c) => c.completed !== 1);
        Promise.all(incomplete.map((c) => api.slots.delete(c.id)))
          .then(() => api.slots.delete(slotId))
          .then(afterSlotsDeleted)
          .catch(console.error);
      } else {
        api.slots.delete(slotId).then(afterSlotsDeleted).catch(console.error);
      }
    });
  }

  document.querySelectorAll('.task-list-section[data-drop-zone]').forEach((sectionEl) => {
    const section = sectionEl as HTMLElement;
    const zone = section.dataset.dropZone;
    section.addEventListener('dragenter', (e) => {
      if (
        e.dataTransfer?.types.includes('application/x-daytracker-slot') ||
        e.dataTransfer?.types.includes('application/x-daytracker-task')
      ) {
        if (zone === 'incomplete' && e.dataTransfer?.types.includes('application/x-daytracker-task')) {
          const taskIdStr = e.dataTransfer?.getData('application/x-daytracker-task');
          const taskId = taskIdStr ? parseInt(taskIdStr, 10) : NaN;
          if (!incompleteRootIds.has(getRootTaskId(taskId))) return;
        }
        section.classList.add('drop-target');
      }
    });
    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget as Node)) section.classList.remove('drop-target');
    });
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (
        e.dataTransfer?.types.includes('application/x-daytracker-slot') ||
        e.dataTransfer?.types.includes('application/x-daytracker-task')
      ) {
        if (zone === 'incomplete' && e.dataTransfer?.types.includes('application/x-daytracker-task')) {
          const taskIdStr = e.dataTransfer?.getData('application/x-daytracker-task');
          const taskId = taskIdStr ? parseInt(taskIdStr, 10) : NaN;
          if (!incompleteRootIds.has(getRootTaskId(taskId))) return;
        }
        e.dataTransfer.dropEffect = 'move';
      }
    });
    section.addEventListener('drop', (e) => {
      section.classList.remove('drop-target');
      hideAllZones();
      const slotIdStr = e.dataTransfer?.getData('application/x-daytracker-slot');
      if (slotIdStr) {
        e.preventDefault();
        e.stopPropagation();
        if (zone === 'unassigned') handleSlotDropOnUnassigned(slotIdStr);
        else if (zone === 'pending') handleSlotDropOnPending(slotIdStr);
        else if (zone === 'incomplete') handleSlotDropOnIncomplete(slotIdStr);
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('.task-card')) return;
      e.preventDefault();
      const src = dragSourceTaskId;
      dragSourceTaskId = null;
      if (src == null) return;
      const task = tasks.find((t) => t.id === src);
      if (!task) return;
      const rootId = getRootTaskId(src);
      if (zone === 'unassigned') {
        const updates: Promise<unknown>[] = [api.tasks.update({ id: rootId, list_state: 'unassigned' })];
        if (task.parent_id != null) updates.push(api.tasks.update({ id: src, parent_id: null }));
        Promise.all(updates).then(() => loadTasks()).catch(console.error);
      } else if (zone === 'pending') {
        api.tasks.update({ id: rootId, list_state: 'pending' }).then(() => loadTasks()).catch(console.error);
      } else if (zone === 'incomplete' && incompleteRootIds.has(rootId)) {
        api.tasks.update({ id: rootId, list_state: 'unassigned' }).then(() => loadTasks()).catch(console.error);
      }
    });
  });

  loadTasks();
}

export function getVisibleRootTasks(): Task[] {
  const allScheduled = new Set(scheduledTaskIds);
  scheduledTaskIds.forEach(id => {
    getChildTaskIds(id).forEach(cid => allScheduled.add(cid));
  });
  return tasks.filter(t => !allScheduled.has(t.id) && t.parent_id == null);
}

export function getTasks(): Task[] {
  return tasks;
}
