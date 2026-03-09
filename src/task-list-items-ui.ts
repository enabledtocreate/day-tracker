/**
 * Shared UI for task list items (bullet or checklist): used in schedule modal and task list cards.
 */
import type { TaskListItem } from './api';
import type { ListStyle } from './api';
import { api } from './api';

export interface TaskListItemsUIOptions {
  listStyle: ListStyle;
  onListStyleChange?: (style: ListStyle) => void;
  /** When 'local', list re-fetches and re-renders on change instead of calling onRefresh. Use for modal. */
  refreshStrategy?: 'parent' | 'local';
  /** When true, list body starts expanded (e.g. when opening list on demand in task view). */
  startExpanded?: boolean;
  /** Header action button: default is 'add' (clipboard+plus). 'delete' shows a trash icon; 'none' hides it. */
  headerAction?: 'add' | 'delete' | 'none';
  /** When true, list cannot be collapsed (toggle is hidden). */
  noCollapse?: boolean;
}

/**
 * Appends the list section into wrapper. When options.listStyle is 'checklist', items show a checkbox
 * and completed state. Optional style toggle (Bullet / Checklist) when onListStyleChange is set.
 */
export function appendTaskListItemsUI(
  wrapper: HTMLElement,
  taskId: number,
  onRefresh: () => void,
  options?: TaskListItemsUIOptions
): void {
  wrapper.className = 'time-block-list';
  wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());

  let currentListStyle: ListStyle = options?.listStyle ?? 'bullet';
  const refreshStrategy = options?.refreshStrategy ?? 'parent';
  const doRefresh = (): void => {
    if (refreshStrategy === 'local') {
      api.taskListItems.list(taskId).then((res) => renderListItems(res.items || []));
    } else {
      onRefresh();
    }
  };
  const noCollapse = options?.noCollapse ?? false;

  const listHeader = document.createElement('div');
  listHeader.className = 'time-block-list-header';
  const listToggle = document.createElement('button');
  listToggle.type = 'button';
  listToggle.className = 'time-block-list-toggle';
  listToggle.setAttribute('aria-label', 'Expand or collapse list');
  listToggle.textContent = '▶';
  const listAddBtn = document.createElement('button');
  listAddBtn.type = 'button';
  listAddBtn.className = 'time-block-list-add-btn';
  const headerAction = options?.headerAction ?? 'add';
  if (headerAction === 'delete') {
    listAddBtn.title = 'Delete list';
    listAddBtn.textContent = '🗑';
  } else if (headerAction === 'none') {
    listAddBtn.style.display = 'none';
  } else {
    listAddBtn.title = 'Add list / Add item';
    listAddBtn.innerHTML = '📋<sub>+</sub>';
  }

  const styleToggleWrap = document.createElement('span');
  styleToggleWrap.className = 'time-block-list-style-toggle';
  const bulletStyleBtn = document.createElement('button');
  bulletStyleBtn.type = 'button';
  bulletStyleBtn.className = 'time-block-list-style-btn';
  bulletStyleBtn.textContent = 'Bullet';
  bulletStyleBtn.title = 'Show as bullet list';
  const checklistStyleBtn = document.createElement('button');
  checklistStyleBtn.type = 'button';
  checklistStyleBtn.className = 'time-block-list-style-btn';
  checklistStyleBtn.textContent = 'Checklist';
  checklistStyleBtn.title = 'Show as checklist';
  function updateStyleButtons(): void {
    bulletStyleBtn.classList.toggle('active', currentListStyle === 'bullet');
    checklistStyleBtn.classList.toggle('active', currentListStyle === 'checklist');
  }
  updateStyleButtons();
  bulletStyleBtn.addEventListener('click', () => {
    if (currentListStyle === 'bullet') return;
    currentListStyle = 'bullet';
    api.tasks.update({ id: taskId, list_style: 'bullet' }).then(() => {
      options?.onListStyleChange?.('bullet');
      api.taskListItems.list(taskId).then((res) => renderListItems(res.items || []));
    });
    updateStyleButtons();
  });
  checklistStyleBtn.addEventListener('click', () => {
    if (currentListStyle === 'checklist') return;
    currentListStyle = 'checklist';
    api.tasks.update({ id: taskId, list_style: 'checklist' }).then(() => {
      options?.onListStyleChange?.('checklist');
      api.taskListItems.list(taskId).then((res) => renderListItems(res.items || []));
    });
    updateStyleButtons();
  });
  styleToggleWrap.append(bulletStyleBtn, checklistStyleBtn);

  if (noCollapse) listToggle.style.display = 'none';
  listHeader.append(listToggle, listAddBtn, styleToggleWrap);

  const listBody = document.createElement('div');
  listBody.className = 'time-block-list-body' + (options?.startExpanded ? '' : ' time-block-list-collapsed');
  if (options?.startExpanded) listToggle.textContent = '▼';
  wrapper.append(listHeader, listBody);

  function renderListItems(items: TaskListItem[]): void {
    const hasNewRow = listBody.querySelector('.time-block-list-item-new');
    if (hasNewRow) return;
    let itemsContainer = listBody.querySelector('.time-block-list-items');
    listBody.querySelectorAll('.time-block-list-add-row').forEach((el) => el.remove());
    if (!itemsContainer) {
      itemsContainer = document.createElement('div');
      itemsContainer.className = 'time-block-list-items';
      listBody.appendChild(itemsContainer);
    }
    itemsContainer.innerHTML = '';
    const isChecklist = currentListStyle === 'checklist';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'time-block-list-item-wrap' + (isChecklist && item.completed ? ' time-block-list-item-completed' : '');
      row.draggable = true;
      row.dataset.itemId = String(item.id);
      const dragHandle = document.createElement('span');
      dragHandle.className = 'time-block-list-drag';
      dragHandle.textContent = '⋮⋮';
      dragHandle.setAttribute('aria-label', 'Drag to reorder');
      if (isChecklist) {
        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'time-block-list-item-check';
        check.textContent = item.completed ? '✓' : '';
        check.title = item.completed ? 'Mark incomplete' : 'Mark complete';
        check.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = item.completed ? 0 : 1;
          api.taskListItems.update({ id: item.id, completed: next }).then(() => doRefresh());
        });
        row.appendChild(check);
      }
      const bullet = document.createElement('span');
      bullet.className = 'time-block-list-bullet';
      bullet.textContent = isChecklist ? '' : '•';
      const textSpan = document.createElement('span');
      textSpan.className = 'time-block-list-item-text';
      textSpan.textContent = item.content || '\u00A0';
      if (isChecklist && item.completed) textSpan.style.textDecoration = 'line-through';
      const trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.className = 'time-block-list-item-trash';
      trashBtn.textContent = '🗑';
      trashBtn.title = 'Delete item';
      trashBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.taskListItems.delete(item.id).then(() => doRefresh());
      });
      textSpan.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'time-block-list-item-edit';
        input.value = item.content;
        textSpan.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          const v = input.value.trim();
          if (v !== item.content) {
            api.taskListItems.update({ id: item.id, content: v }).then(() => onRefresh());
          } else {
            input.replaceWith(textSpan);
          }
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') input.blur();
          if (ke.key === 'Escape') {
            input.removeEventListener('blur', commit);
            input.replaceWith(textSpan);
          }
        });
      });
      row.append(dragHandle, bullet, textSpan, trashBtn);
      itemsContainer.appendChild(row);
    });
    const addRow = document.createElement('div');
    addRow.className = 'time-block-list-add-row';
    const addPlus = document.createElement('button');
    addPlus.type = 'button';
    addPlus.className = 'time-block-list-add-plus';
    addPlus.textContent = '+';
    addPlus.title = 'Add item';
    addPlus.addEventListener('click', () => addEmptyListItem(taskId, items.length));
    addRow.appendChild(addPlus);
    listBody.appendChild(addRow);
  }

  function addEmptyListItem(taskIdParam: number, orderIndex: number): void {
    listBody.classList.remove('time-block-list-collapsed');
    const itemsContainer = listBody.querySelector('.time-block-list-items');
    if (!itemsContainer) return;
    const row = document.createElement('div');
    row.className = 'time-block-list-item-wrap time-block-list-item-new';
    if (currentListStyle === 'checklist') {
      const check = document.createElement('span');
      check.className = 'time-block-list-item-check';
      row.appendChild(check);
    }
    const bullet = document.createElement('span');
    bullet.className = 'time-block-list-bullet';
    bullet.textContent = currentListStyle === 'checklist' ? '' : '•';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'time-block-list-item-edit';
    input.placeholder = 'New item…';
    row.append(bullet, input);
    itemsContainer.appendChild(row);
    input.focus();
    const removeRow = () => {
      row.remove();
    };
    const saveAndReplace = (content: string) => {
      api.taskListItems.create({ task_id: taskIdParam, content, order_index: orderIndex }).then(() => doRefresh());
    };
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v === '') removeRow();
      else saveAndReplace(v);
    });
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        const v = input.value.trim();
        if (v === '') removeRow();
        else saveAndReplace(v);
      }
      if (ke.key === 'Escape') {
        removeRow();
      }
    });
  }

  listToggle.addEventListener('click', () => {
    if (noCollapse) return;
    listBody.classList.toggle('time-block-list-collapsed');
    listToggle.textContent = listBody.classList.contains('time-block-list-collapsed') ? '▶' : '▼';
  });
  if (headerAction === 'delete') {
    // In task view: trash icon deletes all list items and hides the list area.
    listAddBtn.addEventListener('click', () => {
      api.taskListItems.list(taskId).then((res) => {
        const items = res.items || [];
        if (items.length === 0) {
          wrapper.remove();
          return;
        }
        return Promise.all(items.map((item) => api.taskListItems.delete(item.id))).then(() => {
          wrapper.remove();
          doRefresh();
        });
      }).catch(() => {
        wrapper.remove();
        doRefresh();
      });
    });
  } else if (headerAction === 'add') {
    // Default: clipboard+plus to add items.
    listAddBtn.addEventListener('click', () => {
      listBody.classList.remove('time-block-list-collapsed');
      let itemsContainer = listBody.querySelector('.time-block-list-items');
      if (!itemsContainer) {
        const div = document.createElement('div');
        div.className = 'time-block-list-items';
        listBody.appendChild(div);
        itemsContainer = div;
        const addRow = document.createElement('div');
        addRow.className = 'time-block-list-add-row';
        const addPlus = document.createElement('button');
        addPlus.type = 'button';
        addPlus.className = 'time-block-list-add-plus';
        addPlus.textContent = '+';
        addPlus.title = 'Add item';
        addPlus.addEventListener('click', () => addEmptyListItem(taskId, itemsContainer!.querySelectorAll('.time-block-list-item-wrap').length));
        addRow.appendChild(addPlus);
        listBody.appendChild(addRow);
        addEmptyListItem(taskId, 0);
        return;
      }
      const count = itemsContainer.querySelectorAll('.time-block-list-item-wrap').length;
      addEmptyListItem(taskId, count);
    });
  } else {
    // headerAction === 'none' -> no header button behavior
  }

  let draggedItemId: number | null = null;
  listBody.addEventListener('dragstart', (e) => {
    const wrap = (e.target as HTMLElement).closest('.time-block-list-item-wrap') as HTMLElement | null;
    if (!wrap || wrap.classList.contains('time-block-list-item-new')) return;
    const id = wrap.dataset.itemId;
    if (id) {
      draggedItemId = parseInt(id, 10);
      e.dataTransfer!.setData('text/plain', id);
      e.dataTransfer!.effectAllowed = 'move';
    }
  });
  listBody.addEventListener('dragend', () => { draggedItemId = null; });
  listBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const wrap = (e.target as HTMLElement).closest('.time-block-list-item-wrap') as HTMLElement | null;
    if (wrap && wrap.dataset.itemId) {
      wrap.classList.add('time-block-list-drag-over');
    }
  });
  listBody.addEventListener('dragleave', (e) => {
    (e.target as HTMLElement).closest('.time-block-list-item-wrap')?.classList.remove('time-block-list-drag-over');
  });
  listBody.addEventListener('drop', (e) => {
    e.preventDefault();
    const wrap = (e.target as HTMLElement).closest('.time-block-list-item-wrap') as HTMLElement | null;
    (e.target as HTMLElement).closest('.time-block-list-item-wrap')?.classList.remove('time-block-list-drag-over');
    if (!wrap || !wrap.dataset.itemId || draggedItemId == null) return;
    const dropId = parseInt(wrap.dataset.itemId, 10);
    if (dropId === draggedItemId) return;
    const items = Array.from(listBody.querySelectorAll<HTMLElement>('.time-block-list-item-wrap[data-item-id]'))
      .map((el) => parseInt(el.dataset.itemId!, 10));
    const fromIdx = items.indexOf(draggedItemId);
    const toIdx = items.indexOf(dropId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = items.slice();
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedItemId);
    api.taskListItems.reorder(taskId, newOrder).then(() => onRefresh());
  });

  api.taskListItems.list(taskId).then((res) => {
    const items = res.items || [];
    if (items.length > 0 || options?.startExpanded) {
      listToggle.textContent = '▼';
      listBody.classList.remove('time-block-list-collapsed');
    } else {
      listToggle.textContent = '▶';
    }
    renderListItems(items);
  });
}

/**
 * Opens a modal that shows the task list items with full edit (add/edit/delete/reorder)
 * and Bullet/Checklist style toggle. onClose is called when the modal is closed.
 */
export function openTaskListModal(
  taskId: number,
  initialListStyle: ListStyle,
  onClose: () => void
): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'task-list-modal link-modal';
  const header = document.createElement('div');
  header.className = 'task-list-modal-header';
  const title = document.createElement('h3');
  title.textContent = 'List items';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'task-list-modal-delete-btn';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Delete list';
  deleteBtn.addEventListener('click', () => {
    api.taskListItems.list(taskId).then((res) => {
      const items = res.items || [];
      if (items.length === 0) {
        dialog.close();
        return;
      }
      if (!confirm('Delete all list items for this task?')) return;
      return Promise.all(items.map((item) => api.taskListItems.delete(item.id))).then(() => {
        dialog.close();
      });
    }).catch(() => dialog.close());
  });
  header.append(title, deleteBtn);
  const body = document.createElement('div');
  body.className = 'task-list-modal-body';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.append(header, body, closeBtn);
  document.body.appendChild(dialog);
  appendTaskListItemsUI(body, taskId, () => {}, {
    listStyle: initialListStyle,
    refreshStrategy: 'local',
    startExpanded: true,
    noCollapse: true,
    headerAction: 'none',
  });
  dialog.showModal();
  dialog.addEventListener('close', () => {
    onClose();
    dialog.remove();
  });
}
