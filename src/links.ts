/**
 * Link modal: add/edit/remove links for a task. Show links below task in list.
 */
import { api } from './api';
import type { TaskLink } from './api';

const modal = document.getElementById('link-modal') as HTMLDialogElement | null;
const form = document.getElementById('link-form');
const linkUrlInput = document.getElementById('link-url') as HTMLInputElement | null;
const linkDescInput = document.getElementById('link-desc') as HTMLInputElement | null;
const linkEditIdInput = document.getElementById('link-edit-id') as HTMLInputElement | null;
const linkModalTitle = document.getElementById('link-modal-title');
const linkAddBtn = document.getElementById('link-add');
const cancelBtn = document.getElementById('link-cancel');

function getCurrentTaskId(): number | null {
  if (!modal) return null;
  const id = (modal as unknown as { dataset: { taskId?: string } }).dataset.taskId;
  return id ? parseInt(id, 10) : null;
}

function setEditMode(link: TaskLink | null): void {
  if (link) {
    if (linkEditIdInput) linkEditIdInput.value = String(link.id);
    if (linkUrlInput) linkUrlInput.value = link.url;
    if (linkDescInput) linkDescInput.value = link.description || '';
    if (linkModalTitle) linkModalTitle.textContent = 'Edit Link';
    if (linkAddBtn) linkAddBtn.textContent = 'Save';
  } else {
    if (linkEditIdInput) linkEditIdInput.value = '';
    if (linkUrlInput) linkUrlInput.value = '';
    if (linkDescInput) linkDescInput.value = '';
    if (linkModalTitle) linkModalTitle.textContent = 'Add Link';
    if (linkAddBtn) linkAddBtn.textContent = 'Add';
  }
}

function getLinkListContainer(): HTMLElement | null {
  return document.getElementById('link-list-in-modal');
}

function loadAndShowLinks(taskId: number): void {
  const container = getLinkListContainer();
  if (!container) return;
  api.links.list(taskId).then((res) => {
    container.innerHTML = '';
    res.links.forEach((link) => {
      const item = document.createElement('div');
      item.className = 'link-item';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = '🔗';
      openBtn.title = 'Open link';
      openBtn.addEventListener('click', () => window.open(link.url, '_blank'));
      const desc = document.createElement('span');
      desc.textContent = link.description || link.url;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit link';
      editBtn.addEventListener('click', () => setEditMode(link));
      const trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.textContent = '🗑';
      trashBtn.title = 'Delete link';
      trashBtn.addEventListener('click', () => {
        api.links.delete(link.id).then(() => {
          loadAndShowLinks(taskId);
          refreshLinksInTaskList(taskId);
          window.dispatchEvent(new Event('daytracker-refresh'));
        });
      });
      item.append(openBtn, desc, editBtn, trashBtn);
      container.appendChild(item);
    });
  });
}

function refreshLinksInTaskList(taskId: number): void {
  const taskEl = document.querySelector(`[data-task-id="${taskId}"]`);
  if (taskEl) {
    api.links.list(taskId).then((r) => renderLinksUnderElement(taskEl as HTMLElement, r.links, taskId)).catch(() => {});
  }
}

export function initLinkModal(): void {
  if (!modal) return;
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const taskId = getCurrentTaskId();
      if (taskId == null || !linkUrlInput?.value.trim()) return;
      const url = linkUrlInput.value.trim();
      const description = (linkDescInput?.value ?? '').trim();
      const editId = linkEditIdInput?.value ? parseInt(linkEditIdInput.value, 10) : 0;

      if (editId > 0) {
        api.links.update({ id: editId, url, description }).then(() => {
          setEditMode(null);
          modal.close();
          refreshLinksInTaskList(taskId);
          window.dispatchEvent(new Event('daytracker-refresh'));
        }).catch(console.error);
      } else {
        api.links.add({ task_id: taskId, url, description }).then(() => {
          setEditMode(null);
          modal.close();
          refreshLinksInTaskList(taskId);
          window.dispatchEvent(new Event('daytracker-refresh'));
        }).catch(console.error);
      }
    });
  }
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    setEditMode(null);
    modal?.close();
  });
}

export function openLinkModalForTask(taskId: number, initialUrl?: string): void {
  if (!modal) return;
  (modal as unknown as { dataset: { taskId?: string } }).dataset.taskId = String(taskId);
  setEditMode(null);
  if (initialUrl && linkUrlInput) linkUrlInput.value = initialUrl;
  getLinkListContainer()?.replaceChildren();
  modal.showModal();
  loadAndShowLinks(taskId);
}

export function openLinkModalForEdit(taskId: number, link: TaskLink): void {
  if (!modal) return;
  (modal as unknown as { dataset: { taskId?: string } }).dataset.taskId = String(taskId);
  getLinkListContainer()?.replaceChildren();
  modal.showModal();
  loadAndShowLinks(taskId);
  setEditMode(link);
}

export function renderLinksUnderElement(parent: HTMLElement, links: TaskLink[], taskId: number): void {
  let wrap = parent.querySelector(':scope > .task-links-inline') as HTMLElement | null;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'task-links-inline';
    parent.appendChild(wrap);
  }
  wrap.innerHTML = '';
  if (links.length === 0) return;
  links.forEach((link) => {
    const item = document.createElement('div');
    item.className = 'link-item';
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'link-action-btn';
    openBtn.textContent = '🔗';
    openBtn.title = 'Open link';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(link.url, '_blank');
    });
    const desc = document.createElement('span');
    desc.className = 'link-desc';
    desc.textContent = link.description || link.url;
    desc.title = link.url;
    desc.style.cursor = 'pointer';
    desc.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(link.url, '_blank');
    });
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'link-action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit link';
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLinkModalForEdit(taskId, link);
    });
    const trashBtn = document.createElement('button');
    trashBtn.type = 'button';
    trashBtn.className = 'link-action-btn';
    trashBtn.textContent = '🗑';
    trashBtn.title = 'Delete link';
    trashBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      api.links.delete(link.id).then(() => {
        api.links.list(taskId).then((r) => renderLinksUnderElement(parent, r.links, taskId)).catch(() => {});
        window.dispatchEvent(new Event('daytracker-refresh'));
      });
    });
    item.append(openBtn, desc, editBtn, trashBtn);
    wrap!.appendChild(item);
  });
}
