'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { MobileAwareSelect } from '@/components/mobile/MobileAwareSelect';
import { api, type Task, type TaskLink, type TaskListItem } from '@/lib/api';
import { DefaultDurationMinutesField } from '@/components/DefaultDurationMinutesField';
import { durationIntervalsToMinutes, durationMinutesToIntervals } from '@/lib/taskDefaultDuration';
import type { PriorityDisplay } from '@/lib/priorityTheme';

export type CreateTaskFromTemplatePayload = {
  title: string;
  list_state: string;
  priority: string;
  due_date: string | null;
  auto_priority_enabled: boolean;
  auto_complete_eod: boolean;
  category_id: number | null;
  subcategory_id: number | null;
  tag_ids: number[];
  default_block_id: number | null;
  default_duration_intervals: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  template: Task | null;
  templateLinks?: TaskLink[];
  templateListItems?: TaskListItem[];
  buckets: Array<{ id: string; label: string }>;
  defaultBucketId: string;
  priorityDisplay: PriorityDisplay;
  categories: Array<{ id: number; name: string }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
  organizationBlocks: Array<{ id: number; name: string }>;
  slotDurationMinutes: number;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
};

export function CreateTaskFromTemplateModal({
  open,
  onClose,
  template,
  templateLinks = [],
  templateListItems = [],
  buckets,
  defaultBucketId,
  priorityDisplay,
  categories,
  subcategories,
  tags,
  organizationBlocks,
  slotDurationMinutes,
  onSuccess,
  onError,
  onReload,
}: Props) {
  const [title, setTitle] = useState('');
  const [listState, setListState] = useState(defaultBucketId);
  const [priority, setPriority] = useState('low');
  const [dueDate, setDueDate] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoCompleteEod, setAutoCompleteEod] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [defaultBlockId, setDefaultBlockId] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(slotDurationMinutes);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !template) return;
    setTitle(template.title ?? '');
    setListState(defaultBucketId);
    setPriority(template.priority ?? priorityDisplay.levels[priorityDisplay.levels.length - 1] ?? 'low');
    setDueDate(template.due_date && /^\d{4}-\d{2}-\d{2}$/.test(template.due_date) ? template.due_date : '');
    setAutoEnabled(Number(template.auto_priority_enabled) === 1);
    setAutoCompleteEod(Number(template.auto_complete_eod) === 1);
    setCategoryId(template.category_id ?? null);
    setSubcategoryId(template.subcategory_id ?? null);
    setTagIds(template.tag_ids ?? []);
    setDefaultBlockId(template.default_block_id ?? null);
    setDurationMinutes(
      durationIntervalsToMinutes(Math.max(1, template.default_duration_intervals ?? 1), slotDurationMinutes)
    );
  }, [open, template, defaultBucketId, priorityDisplay.levels, slotDurationMinutes]);

  const subcategoryOptions = subcategories.filter((s) => s.category_id === (categoryId ?? 0));

  const handleCreate = async () => {
    if (!template) return;
    const trimmed = title.trim();
    if (!trimmed) {
      window.alert('Title is required.');
      return;
    }
    let due: string | null = null;
    if (dueDate.trim() !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
        window.alert('Due date must be YYYY-MM-DD.');
        return;
      }
      due = dueDate.trim();
    }
    setBusy(true);
    try {
      const created = await api.tasks.create({
        copy_from: template.id,
        list_state: listState,
        title: trimmed,
        priority,
      });
      await api.tasks.update({
        id: created.id,
        title: trimmed,
        priority,
        due_date: due,
        auto_priority_enabled: autoEnabled,
        auto_complete_eod: autoCompleteEod,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        tag_ids: tagIds,
        default_block_id: defaultBlockId,
        default_duration_intervals: durationMinutesToIntervals(durationMinutes, slotDurationMinutes),
        list_state: listState,
      });
      onReload();
      onSuccess(`Created “${trimmed}” in ${buckets.find((b) => b.id === listState)?.label ?? listState}.`);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!template) return null;

  const linkCount = templateLinks.length;
  const itemCount = templateListItems.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add favorite to bucket"
      actions={
        <>
          <Button onClick={() => void handleCreate()} disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create task'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="org-task-details-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Pre-filled from favorite template. Links ({linkCount}) and list items ({itemCount}) copy automatically.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ padding: '0.35rem' }}
            autoFocus
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Bucket
          <MobileAwareSelect<string>
            value={listState}
            onChange={setListState}
            title="Bucket"
            options={buckets.map((b) => ({ value: b.id, label: b.label }))}
            style={{ padding: '0.35rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Priority
          <MobileAwareSelect<string>
            value={priority}
            onChange={setPriority}
            title="Priority"
            options={priorityDisplay.levels.map((p) => ({
              value: p,
              label: priorityDisplay.label(p),
            }))}
            style={{ padding: '0.35rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Due date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ padding: '0.35rem', maxWidth: '12rem' }} />
        </label>
        <label className="org-task-details-checkbox-row">
          <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} />
          <span>Auto-prioritize upward over time</span>
        </label>
        <label className="org-task-details-checkbox-row">
          <input type="checkbox" checked={autoCompleteEod} onChange={(e) => setAutoCompleteEod(e.target.checked)} />
          <span>Auto-complete uncompleted slots at end of day</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Category
          <MobileAwareSelect<string>
            value={categoryId == null ? '' : String(categoryId)}
            onChange={(v) => setCategoryId(v === '' ? null : Number(v))}
            title="Category"
            options={[
              { value: '', label: '— None —' },
              ...categories.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            style={{ padding: '0.35rem' }}
          />
        </label>
        {categoryId != null && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Subcategory
            <MobileAwareSelect<string>
              value={subcategoryId == null ? '' : String(subcategoryId)}
              onChange={(v) => setSubcategoryId(v === '' ? null : Number(v))}
              title="Subcategory"
              options={[
                { value: '', label: '— None —' },
                ...subcategoryOptions.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
              style={{ padding: '0.35rem' }}
            />
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Default block (for Auto Block)
          <MobileAwareSelect<string>
            value={defaultBlockId == null ? '' : String(defaultBlockId)}
            onChange={(v) => setDefaultBlockId(v === '' ? null : Number(v))}
            title="Default block"
            options={[
              { value: '', label: '— None —' },
              ...organizationBlocks.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            style={{ padding: '0.35rem' }}
          />
        </label>
        <DefaultDurationMinutesField
          slotDurationMinutes={slotDurationMinutes}
          minutes={durationMinutes}
          onMinutesChange={setDurationMinutes}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {tags
            .filter((t) => (template.tag_ids ?? []).includes(t.id))
            .map((t) => (
              <span
                key={t.id}
                className="task-org-tag-chip"
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.85rem',
                  backgroundColor: t.color ?? 'var(--surface)',
                }}
              >
                {t.name}
              </span>
            ))}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
          Tags copy from the template. Edit the favorite template to change default tags.
        </p>
      </div>
    </Modal>
  );
}
