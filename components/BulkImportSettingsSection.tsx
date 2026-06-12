'use client';

import { useEffect, useState } from 'react';
import { api, type TimeSettings } from '@/lib/api';
import { Button } from '@/components/Button';
import {
  BULK_IMPORT_COLUMNS,
  type BulkImportColumnKey,
} from '@/lib/bulkImportColumns';
import {
  bulkImportSettingsToJson,
  parseBulkImportSettingsJson,
  type BulkImportDelimiter,
  type BulkImportSettings,
} from '@/lib/bulkImportSettings';
import { escapeBulkImportCell } from '@/lib/bulkImportCsv';

type Props = {
  settings: TimeSettings | null;
  onSettingsChange: (s: TimeSettings) => void;
};

export function BulkImportSettingsSection({ settings, onSettingsChange }: Props) {
  const [bulk, setBulk] = useState<BulkImportSettings>(() => parseBulkImportSettingsJson(null));
  const [escapeInput, setEscapeInput] = useState('');
  const [escapeOutput, setEscapeOutput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setBulk(parseBulkImportSettingsJson(settings.bulk_import_json ?? null));
  }, [settings]);

  const save = () => {
    if (!settings) return;
    setSaving(true);
    api.settings
      .update({ bulk_import_json: bulkImportSettingsToJson(bulk) })
      .then(() => api.settings.get())
      .then((s) => {
        onSettingsChange(s);
        alert('Bulk import settings saved.');
      })
      .catch((e) => alert(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  const updateEscape = (text: string, delim: BulkImportDelimiter) => {
    setEscapeInput(text);
    setEscapeOutput(text === '' ? '' : escapeBulkImportCell(text, delim));
  };

  const toggleColumn = (key: BulkImportColumnKey, on: boolean) => {
    if (key === 'task') return;
    setBulk((b) => ({
      ...b,
      columns_enabled: { ...b.columns_enabled, [key]: on },
    }));
  };

  return (
    <div className="user-settings-section">
      <h3 style={{ marginTop: 0 }}>Bulk import</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Configure CSV/TSV templates, Quick Add behavior, and upload validation. Subcategory always requires Category on
        the same row. Tags are independent (not tied to a category). Priority and List columns follow your custom
        labels from Schedule / task list settings.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '32rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>Delimiter</span>
          <select
            value={bulk.delimiter}
            onChange={(e) => setBulk((b) => ({ ...b, delimiter: e.target.value as BulkImportDelimiter }))}
          >
            <option value="tab">Tab (default)</option>
            <option value="comma">Comma</option>
            <option value="semicolon">Semicolon</option>
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={bulk.allow_duplicates_quick_add}
            onChange={(e) => setBulk((b) => ({ ...b, allow_duplicates_quick_add: e.target.checked }))}
          />
          Allow duplicate titles in Quick Add
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={bulk.add_new_values}
            onChange={(e) => setBulk((b) => ({ ...b, add_new_values: e.target.checked }))}
          />
          Add new values on upload (create unknown categories, subcategories, tags)
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={bulk.ignore_case}
            onChange={(e) => setBulk((b) => ({ ...b, ignore_case: e.target.checked }))}
          />
          Ignore case when matching names
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>Custom instruction text (optional)</span>
          <textarea
            rows={6}
            value={bulk.instruction_text}
            onChange={(e) => setBulk((b) => ({ ...b, instruction_text: e.target.value }))}
            placeholder="Leave blank to use default instructions in the downloaded template."
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.9rem' }}
          />
        </label>

        <fieldset style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '0.75rem' }}>
          <legend style={{ padding: '0 0.35rem' }}>Template columns</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {BULK_IMPORT_COLUMNS.map((col) => (
              <label key={col.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={bulk.columns_enabled[col.key] !== false}
                  disabled={col.key === 'task'}
                  onChange={(e) => toggleColumn(col.key, e.target.checked)}
                />
                <span>
                  <strong>{col.header}</strong>
                  {col.key !== 'task' && (
                    <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {col.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '0.75rem' }}>
          <legend style={{ padding: '0 0.35rem' }}>CSV escape helper</legend>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Paste text to get a cell-safe value for your chosen delimiter (quotes doubled per RFC 4180).
          </p>
          <textarea
            rows={3}
            value={escapeInput}
            onChange={(e) => updateEscape(e.target.value, bulk.delimiter)}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.9rem' }}
          />
          <textarea
            readOnly
            rows={2}
            value={escapeOutput}
            style={{ width: '100%', marginTop: '0.35rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
            placeholder="Escaped output"
          />
          <Button
            type="button"
            variant="secondary"
            style={{ marginTop: '0.35rem' }}
            disabled={!escapeOutput}
            onClick={() => void navigator.clipboard.writeText(escapeOutput)}
          >
            Copy escaped value
          </Button>
        </fieldset>

        <Button type="button" onClick={save} disabled={saving || !settings}>
          {saving ? 'Saving…' : 'Save bulk import settings'}
        </Button>
      </div>
    </div>
  );
}
