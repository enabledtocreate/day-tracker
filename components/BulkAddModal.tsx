'use client';

import { useCallback, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { MobileAwareSelect } from '@/components/mobile/MobileAwareSelect';
import { api } from '@/lib/api';
import type { TimeSettings } from '@/lib/api';
import { parseBulkImportSettingsJson } from '@/lib/bulkImportSettings';
import {
  buildBulkImportTemplate,
  downloadBulkImportTemplate,
  parseBulkImportFile,
} from '@/lib/bulkImportCsv';
import { BulkImportErrorModal, type BulkImportErrorPayload } from '@/components/BulkImportErrorModal';

type BulkAddMode = 'choose' | 'quick' | 'upload';

type Props = {
  open: boolean;
  onClose: () => void;
  settings: TimeSettings;
  buckets: Array<{ id: string; label: string }>;
  defaultBucketId: string;
  priorityLevels: readonly string[];
  priorityLabel: (id: string) => string;
  organizationCategories: Array<{ id: number; name: string }>;
  organizationSubcategories: Array<{ id: number; category_id: number; name: string }>;
  organizationTags: Array<{ id: number; name: string; color?: string | null }>;
  organizationBlocks: Array<{ id: number; name: string }>;
  slotDurationMinutes: number;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
};

export function BulkAddModal({
  open,
  onClose,
  settings,
  buckets,
  defaultBucketId,
  priorityLevels,
  priorityLabel,
  organizationCategories,
  organizationSubcategories,
  organizationTags,
  organizationBlocks,
  slotDurationMinutes,
  onSuccess,
  onError,
  onReload,
}: Props) {
  const [mode, setMode] = useState<BulkAddMode>('choose');
  const [quickText, setQuickText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [listState, setListState] = useState(defaultBucketId);
  const [priority, setPriority] = useState(priorityLevels[priorityLevels.length - 1] ?? 'low');
  const [dueDate, setDueDate] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoCompleteEod, setAutoCompleteEod] = useState(false);
  const [defaultBlockId, setDefaultBlockId] = useState<number | null>(null);
  const [durationIntervals, setDurationIntervals] = useState(1);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<BulkImportErrorPayload | null>(null);
  const [importErrorOpen, setImportErrorOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const bulkSettings = parseBulkImportSettingsJson(settings.bulk_import_json ?? null);
  const subcategoryOptions = organizationSubcategories.filter((s) => s.category_id === (categoryId ?? 0));

  const tagSuggestions = tagInput.trim()
    ? organizationTags.filter(
        (t) => t.name.toLowerCase().includes(tagInput.trim().toLowerCase()) && !tagIds.includes(t.id)
      )
    : organizationTags.filter((t) => !tagIds.includes(t.id));

  const resetFields = useCallback(() => {
    setListState(defaultBucketId);
    setPriority(priorityLevels[priorityLevels.length - 1] ?? 'low');
    setDueDate('');
    setCategoryId(null);
    setSubcategoryId(null);
    setTagIds([]);
    setAutoEnabled(false);
    setAutoCompleteEod(false);
    setDefaultBlockId(null);
    setDurationIntervals(1);
    setTagInput('');
  }, [defaultBucketId, priorityLevels]);

  const resetAndClose = useCallback(() => {
    setMode('choose');
    setQuickText('');
    setPasteText('');
    resetFields();
    setBusy(false);
    onClose();
  }, [onClose, resetFields]);

  const addTag = (tag: { id: number; name: string }) => {
    if (!tagIds.includes(tag.id)) setTagIds((prev) => [...prev, tag.id]);
    setTagInput('');
    setTagSuggestOpen(false);
  };

  const createAndAddTag = () => {
    const name = tagInput.trim();
    if (!name) return;
    const existing = organizationTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      addTag(existing);
      return;
    }
    api.organization.createTag({ name }).then((created) => {
      onReload();
      addTag(created);
    }).catch(() => {});
  };

  const sharedFields = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.75rem' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Bucket
        <MobileAwareSelect<string>
          value={listState}
          onChange={setListState}
          title="Bucket"
          options={buckets.map((b) => ({ value: b.id, label: b.label }))}
          style={{ padding: '0.35rem' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Priority (all tasks)
        <MobileAwareSelect<string>
          value={priority}
          onChange={setPriority}
          title="Priority"
          options={priorityLevels.map((p) => ({ value: p, label: priorityLabel(p) }))}
          style={{ padding: '0.35rem' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Due date (optional, all tasks)
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={{ padding: '0.35rem', maxWidth: '12rem' }}
        />
      </label>
      <label className="org-task-details-checkbox-row">
        <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} />
        <span>Auto-prioritize upward over time</span>
      </label>
      <label className="org-task-details-checkbox-row">
        <input type="checkbox" checked={autoCompleteEod} onChange={(e) => setAutoCompleteEod(e.target.checked)} />
        <span>Auto-complete uncompleted slots at end of day</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Category
        <MobileAwareSelect<string>
          value={categoryId == null ? '' : String(categoryId)}
          onChange={(v) => {
            setCategoryId(v === '' ? null : Number(v));
            setSubcategoryId(null);
          }}
          title="Category"
          options={[
            { value: '', label: '— None —' },
            ...organizationCategories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          style={{ padding: '0.35rem' }}
        />
      </label>
      {categoryId != null && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
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
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Default block (Auto Block)
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
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        Default duration ({slotDurationMinutes} min per step)
        <input
          type="number"
          min={1}
          step={1}
          value={durationIntervals}
          onChange={(e) => setDurationIntervals(Math.max(1, parseInt(e.target.value, 10) || 1))}
          style={{ padding: '0.35rem', maxWidth: '6rem' }}
        />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
        <span>Tags (all tasks)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
          {tagIds.map((tid) => {
            const t = organizationTags.find((x) => x.id === tid);
            if (!t) return null;
            return (
              <span
                key={t.id}
                className="task-org-tag-chip"
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.85rem',
                  backgroundColor: t.color ?? 'var(--surface)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                {t.name}
                <button
                  type="button"
                  aria-label={`Remove tag ${t.name}`}
                  onClick={() => setTagIds((prev) => prev.filter((id) => id !== tid))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => {
            setTagInput(e.target.value);
            setTagSuggestOpen(true);
          }}
          onFocus={() => setTagSuggestOpen(true)}
          placeholder="Add tag…"
          style={{ padding: '0.35rem' }}
        />
        {tagSuggestOpen && tagSuggestions.length > 0 && (
          <ul style={{ margin: 0, padding: '0.25rem 0', listStyle: 'none', maxHeight: '8rem', overflowY: 'auto' }}>
            {tagSuggestions.slice(0, 12).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => addTag(t)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.25rem 0.5rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {tagInput.trim() && !organizationTags.some((t) => t.name.toLowerCase() === tagInput.trim().toLowerCase()) && (
          <button type="button" className="add-task-btn" style={{ alignSelf: 'flex-start' }} onClick={createAndAddTag}>
            Create &quot;{tagInput.trim()}&quot;
          </button>
        )}
      </div>
    </div>
  );

  const handleQuickAdd = () => {
    const titles = quickText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (titles.length === 0) return;
    setBusy(true);
    api.tasksBulk
      .quickAdd({
        titles,
        list_state: listState,
        priority,
        due_date: dueDate.trim() !== '' ? dueDate.trim() : null,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        tag_ids: tagIds,
        auto_priority_enabled: autoEnabled,
        auto_complete_eod: autoCompleteEod,
        default_block_id: defaultBlockId,
        default_duration_intervals: durationIntervals,
      })
      .then((res) => {
        onReload();
        onSuccess(`Added ${res.created} task${res.created === 1 ? '' : 's'}.`);
        resetAndClose();
      })
      .catch((e) => {
        onError(e instanceof Error ? e.message : String(e));
        onReload();
      })
      .finally(() => setBusy(false));
  };

  const runImport = async (content: string) => {
    const parsed = parseBulkImportFile(content, bulkSettings.delimiter);
    if (parsed.parseError) {
      onError(parsed.parseError);
      return;
    }
    const rows = parsed.rows.map((r) => ({ ...r } as Record<string, string>));
    setBusy(true);
    try {
      const res = await api.tasksBulk.import(rows, false);
      if (!res.ok) {
        setImportError({
          errors: res.errors ?? ['Import failed validation.'],
          cell_errors: res.cell_errors,
          grid_headers: res.grid_headers ?? [],
          grid_rows: res.grid_rows ?? [],
        });
        setImportErrorOpen(true);
        return;
      }
      const n = res.imported ?? 0;
      onReload();
      onSuccess(`Imported ${n} task${n === 1 ? '' : 's'}.`);
      resetAndClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadTemplate = () => {
    const content = buildBulkImportTemplate({
      settings,
      bulkSettings,
      categories: organizationCategories,
      subcategories: organizationSubcategories,
      tags: organizationTags,
    });
    const ext = bulkSettings.delimiter === 'tab' ? 'tsv' : 'csv';
    downloadBulkImportTemplate(`day-tracker-tasks-template.${ext}`, content);
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      void runImport(text);
    };
    reader.readAsText(file);
  };

  if (!open) return null;

  return (
    <>
      <Modal
        open={open && !importErrorOpen}
        onClose={resetAndClose}
        title="Add bulk"
        actions={
          mode === 'quick' ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setMode('choose')} disabled={busy}>
                Back
              </Button>
              <Button type="button" variant="secondary" onClick={resetAndClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={handleQuickAdd} disabled={busy || !quickText.trim()}>
                Add
              </Button>
            </>
          ) : mode === 'upload' ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setMode('choose')} disabled={busy}>
                Back
              </Button>
              <Button type="button" variant="secondary" onClick={resetAndClose} disabled={busy}>
                Close
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={resetAndClose}>
              Cancel
            </Button>
          )
        }
      >
        {mode === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Add many tasks at once using a pasted list or a spreadsheet file. Quick Add supports the same task details as the task details modal.
            </p>
            <button
              type="button"
              className="add-task-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setMode('quick')}
            >
              Quick Add — paste one task per line
            </button>
            <button
              type="button"
              className="add-task-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setMode('upload')}
            >
              Bulk upload — CSV / TSV file
            </button>
          </div>
        )}

        {mode === 'quick' && (
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Enter one task title per line. Shared settings below apply to every task.
            </p>
            {sharedFields}
            <textarea
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              rows={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
              placeholder={'Buy milk\nCall dentist\n…'}
            />
          </div>
        )}

        {mode === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Download the template, fill in task rows only (remove instructions and reference rows), then upload.
              Delimiter: <strong>{bulkSettings.delimiter === 'tab' ? 'Tab' : bulkSettings.delimiter}</strong>.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <Button type="button" variant="secondary" onClick={handleDownloadTemplate} disabled={busy}>
                Download template
              </Button>
              <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                Upload tasks
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                Or paste file contents
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <Button
                type="button"
                style={{ marginTop: '0.5rem' }}
                disabled={busy || !pasteText.trim()}
                onClick={() => void runImport(pasteText)}
              >
                Import pasted text
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <BulkImportErrorModal
        open={importErrorOpen}
        payload={importError}
        onClose={() => {
          setImportErrorOpen(false);
          setImportError(null);
        }}
      />
    </>
  );
}
