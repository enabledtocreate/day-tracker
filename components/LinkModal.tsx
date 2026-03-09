'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { TaskLink } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  taskId: number | null;
  initialUrl?: string;
  onLinksChange?: () => void;
};

export function LinkModal({ open, onClose, taskId, initialUrl = '', onLinksChange }: Props) {
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && taskId != null) {
      setUrl(initialUrl);
      setDescription('');
      setEditingId(null);
      setLoading(true);
      api.links
        .list(taskId)
        .then((r) => setLinks(r.links ?? []))
        .catch(() => setLinks([]))
        .finally(() => setLoading(false));
    }
  }, [open, taskId, initialUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (taskId == null || !url.trim()) return;
    const u = url.trim();
    const d = description.trim();
    if (editingId) {
      api.links
        .update({ id: editingId, url: u, description: d })
        .then(() => {
          setLinks((prev) => prev.map((l) => (l.id === editingId ? { ...l, url: u, description: d } : l)));
          setEditingId(null);
          setUrl('');
          setDescription('');
          onLinksChange?.();
        })
        .catch(alert);
    } else {
      api.links
        .add({ task_id: taskId, url: u, description: d })
        .then((added) => {
          setLinks((prev) => [...prev, { ...added, description: d }]);
          setUrl('');
          setDescription('');
          onLinksChange?.();
        })
        .catch(alert);
    }
  };

  const startEdit = (link: TaskLink) => {
    setEditingId(link.id);
    setUrl(link.url);
    setDescription(link.description ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setUrl(initialUrl);
    setDescription('');
  };

  const removeLink = (id: number) => {
    api.links.delete(id).then(() => {
      setLinks((prev) => prev.filter((l) => l.id !== id));
      if (editingId === id) cancelEdit();
      onLinksChange?.();
    }).catch(alert);
  };

  return (
    <Modal open={open} onClose={onClose} title={editingId ? 'Edit Link' : 'Add Link'}>
      {taskId == null ? (
        <p>No task selected.</p>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="link-form" style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                style={{ width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Description (optional)
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%', marginTop: '0.25rem', padding: '0.35rem' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button type="submit" disabled={!url.trim()}>
                {editingId ? 'Save' : 'Add'}
              </Button>
              {editingId && <Button type="button" onClick={cancelEdit}>Cancel</Button>}
            </div>
          </form>
          <div id="link-list-in-modal">
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : links.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No links yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {links.map((link) => (
                  <li key={link.id} className="link-item" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <button type="button" title="Open link" onClick={() => window.open(link.url, '_blank')}>🔗</button>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{link.description || link.url}</span>
                    <button type="button" title="Edit" onClick={() => startEdit(link)}>✏️</button>
                    <button type="button" title="Delete" onClick={() => removeLink(link.id)}>🗑</button>
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
