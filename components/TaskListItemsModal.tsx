'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { Task, TaskListItem as Item, ListStyle } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  taskId: number | null;
  listStyle: ListStyle;
  onRefresh: () => void;
  onTaskPatched?: (task: Task) => void;
};

export function TaskListItemsModal({ open, onClose, taskId, listStyle: initialListStyle, onRefresh, onTaskPatched }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [listStyle, setListStyle] = useState<ListStyle>(initialListStyle);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && taskId != null) {
      setListStyle(initialListStyle);
      setNewContent('');
      setEditingId(null);
      setLoading(true);
      api.taskListItems
        .list(taskId)
        .then((r) => setItems((r.items ?? []).sort((a, b) => a.order_index - b.order_index)))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  }, [open, taskId, initialListStyle]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (taskId == null) return;
    const content = newContent.trim();
    if (!content) return;
    api.taskListItems
      .create({ task_id: taskId, content, order_index: items.length })
      .then((added) => {
        setItems((prev) => [...prev, { ...added, order_index: prev.length }].sort((a, b) => a.order_index - b.order_index));
        setNewContent('');
        onRefresh();
      })
      .catch(alert);
  };

  const handleSaveEdit = (id: number) => {
    const content = editingContent.trim();
    api.taskListItems
      .update({ id, content })
      .then(() => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, content } : it)));
        setEditingId(null);
        setEditingContent('');
        onRefresh();
      })
      .catch(alert);
  };

  const toggleCompleted = (item: Item) => {
    if (listStyle !== 'checklist') return;
    api.taskListItems
      .update({ id: item.id, completed: item.completed ? 0 : 1 })
      .then(() => {
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, completed: it.completed ? 0 : 1 } : it)));
        onRefresh();
      })
      .catch(alert);
  };

  const removeItem = (id: number) => {
    api.taskListItems.delete(id).then(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (editingId === id) setEditingId(null);
      onRefresh();
    }).catch(alert);
  };

  const setStyle = (style: ListStyle) => {
    if (taskId == null) return;
    api.tasks.update({ id: taskId, list_style: style }).then((res) => {
      setListStyle(style);
      if (res?.task) onTaskPatched?.(res.task);
      onRefresh();
    }).catch(alert);
  };

  return (
    <Modal open={open} onClose={onClose} title="List items">
      {taskId == null ? (
        <p>No task selected.</p>
      ) : (
        <>
          <div className="time-block-list-style-toggle task-card-list-style-selector" style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <button
              type="button"
              className={'task-card-list-style-btn time-block-list-style-btn' + (listStyle === 'bullet' ? ' active' : '')}
              title="Bullet list"
              onClick={() => setStyle('bullet')}
              aria-label="Bullet list"
            >
              •
            </button>
            <button
              type="button"
              className={'task-card-list-style-btn time-block-list-style-btn' + (listStyle === 'checklist' ? ' active' : '')}
              title="Checklist"
              onClick={() => setStyle('checklist')}
              aria-label="Checklist"
            >
              ☐
            </button>
          </div>
          <form onSubmit={handleAdd} style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.35rem' }}>
            <input
              type="text"
              placeholder="New item…"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              style={{ flex: 1, padding: '0.35rem' }}
            />
            <Button type="submit">Add</Button>
          </form>
          <div className="time-block-list-items">
            {loading ? (
              <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No items yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={'time-block-list-item-wrap' + (listStyle === 'checklist' && item.completed ? ' time-block-list-item-completed' : '')}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem' }}
                  >
                    {listStyle === 'checklist' && (
                      <button
                        type="button"
                        className="time-block-list-item-check"
                        title={item.completed ? 'Mark incomplete' : 'Mark complete'}
                        onClick={() => toggleCompleted(item)}
                        aria-pressed={!!item.completed}
                      >
                        {item.completed ? '☑' : '☐'}
                      </button>
                    )}
                    {(listStyle === 'bullet' || !listStyle) && <span className="time-block-list-bullet">•</span>}
                    {editingId === item.id ? (
                      <>
                        <input
                          type="text"
                          className="time-block-list-item-edit"
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(item.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          style={{ flex: 1 }}
                        />
                        <Button type="button" onClick={() => handleSaveEdit(item.id)}>Save</Button>
                        <Button type="button" onClick={() => setEditingId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span
                          className="time-block-list-item-text"
                          style={{ flex: 1, color: item.completed ? 'var(--text-muted)' : undefined, textDecoration: item.completed ? 'line-through' : undefined }}
                          onDoubleClick={() => {
                            setEditingId(item.id);
                            setEditingContent(item.content);
                          }}
                        >
                          {item.content || '(empty)'}
                        </span>
                        <button type="button" className="time-block-list-item-trash" title="Delete" onClick={() => removeItem(item.id)}>🗑</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
