import Papa from 'papaparse';
import type { BulkImportColumnKey } from '@/lib/bulkImportColumns';
import { BULK_IMPORT_COLUMNS, headerToBulkColumnKey } from '@/lib/bulkImportColumns';
import type { BulkImportDelimiter, BulkImportSettings } from '@/lib/bulkImportSettings';
import {
  bulkImportDelimiterChar,
  columnHeaderList,
  DEFAULT_BULK_INSTRUCTION_LINES,
} from '@/lib/bulkImportSettings';
import { bucketLayoutFromSettings } from '@/lib/taskBuckets';
import { parsePriorityLayoutJson, parsePriorityThemeJson, PRIORITY_LEVELS } from '@/lib/priorityTheme';
import type { TimeSettings } from '@/lib/api';

export type BulkImportParsedRow = Partial<Record<BulkImportColumnKey, string>> & { task: string };

/** Escape a value for CSV/TSV (RFC 4180). */
export function escapeBulkImportCell(value: string, delimiter: BulkImportDelimiter): string {
  const d = bulkImportDelimiterChar(delimiter);
  const needsQuote =
    value.includes(d) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    (delimiter === 'comma' && value.includes(','));
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function unparseBulkRows(headers: string[], rows: string[][], delimiter: BulkImportDelimiter): string {
  return Papa.unparse(
    { fields: headers, data: rows },
    { delimiter: bulkImportDelimiterChar(delimiter), newline: '\r\n', quotes: true, quoteChar: '"' }
  );
}

function priorityLabelsForTemplate(settings: TimeSettings): string[] {
  const custom = parsePriorityLayoutJson(settings.priority_layout_json ?? null);
  if (custom) return custom.priorities.map((p) => p.label);
  const th = parsePriorityThemeJson(settings.priority_theme_json ?? null);
  return PRIORITY_LEVELS.map((id) => th[id]?.label ?? id);
}

function bucketLabelsForTemplate(settings: TimeSettings): string[] {
  return bucketLayoutFromSettings(settings).map((b) => b.label);
}

/** Build downloadable template (instructions + reference + empty sample row). */
export function buildBulkImportTemplate(params: {
  settings: TimeSettings;
  bulkSettings: BulkImportSettings;
  categories: Array<{ id: number; name: string }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
}): string {
  const { settings, bulkSettings, categories, subcategories, tags } = params;
  const enabled = bulkSettings.columns_enabled;
  const headers = columnHeaderList(enabled);
  const delim = bulkSettings.delimiter;
  const lines: string[][] = [];

  lines.push(headers);
  lines.push(headers.map(() => ''));

  const instructionLines =
    bulkSettings.instruction_text.trim() !== ''
      ? bulkSettings.instruction_text.split(/\r?\n/).filter((l) => l.trim() !== '')
      : DEFAULT_BULK_INSTRUCTION_LINES;
  for (const text of instructionLines) {
    const row = headers.map((_h, i) => (i === 0 ? text : ''));
    lines.push(row);
  }
  lines.push(headers.map(() => ''));

  const refHeaderRow = headers.map((h) => {
    const col = BULK_IMPORT_COLUMNS.find((c) => c.header === h);
    return col && col.key !== 'task' ? `(values) ${h}` : h;
  });
  lines.push(refHeaderRow);

  const withSubs = categories.filter((c) => subcategories.some((s) => s.category_id === c.id));
  const withoutSubs = categories.filter((c) => !subcategories.some((s) => s.category_id === c.id));

  for (const cat of withSubs) {
    const subs = subcategories.filter((s) => s.category_id === cat.id);
    for (const sub of subs) {
      const row = headers.map((h) => {
        if (h === 'Category') return cat.name;
        if (h === 'Subcategory') return sub.name;
        return '';
      });
      lines.push(row);
    }
  }
  for (const cat of withoutSubs) {
    const row = headers.map((h) => {
      if (h === 'Category') return cat.name;
      if (h === 'Subcategory') return '';
      return '';
    });
    lines.push(row);
  }

  const tagNames = tags.map((t) => t.name).join(', ');
  const priLabels = priorityLabelsForTemplate(settings).join(', ');
  const bucketLabels = bucketLabelsForTemplate(settings).join(', ');
  const metaRow = headers.map((h) => {
    if (h === 'Tags' && tagNames) return tagNames;
    if (h === 'Priority' && priLabels) return priLabels;
    if (h === 'List' && bucketLabels) return bucketLabels;
    if (h === 'List style') return 'bullet, checklist';
    if (h === 'Recurring') return 'yes, no';
    return '';
  });
  if (metaRow.some((c) => c !== '')) lines.push(metaRow);

  lines.push(headers.map(() => ''));
  const sample = headers.map((h) => (h === 'Task' ? '' : ''));
  lines.push(sample);

  return unparseBulkRows(headers, lines, delim);
}

export function downloadBulkImportTemplate(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse uploaded text; returns rows keyed by canonical column keys. Skips rows with empty Task. */
export function parseBulkImportFile(
  content: string,
  delimiter: BulkImportDelimiter
): { headers: string[]; rows: BulkImportParsedRow[]; parseError?: string } {
  const parsed = Papa.parse<string[]>(content, {
    delimiter: bulkImportDelimiterChar(delimiter),
    skipEmptyLines: false,
    quoteChar: '"',
    escapeChar: '"',
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return {
      headers: [],
      rows: [],
      parseError: first?.message ?? 'Could not parse file',
    };
  }
  const data = parsed.data.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));
  if (data.length === 0) {
    return { headers: [], rows: [], parseError: 'File is empty' };
  }
  const headerRow = data[0]!.map((h) => String(h ?? '').trim());
  const keyByIndex: Array<BulkImportColumnKey | null> = headerRow.map((h) => headerToBulkColumnKey(h));
  if (!keyByIndex.includes('task')) {
    return { headers: headerRow, rows: [], parseError: 'Missing required column: Task' };
  }
  const rows: BulkImportParsedRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const raw = data[i]!;
    const row: Partial<Record<BulkImportColumnKey, string>> = {};
    let hasTask = false;
    keyByIndex.forEach((key, colIdx) => {
      if (!key) return;
      const val = String(raw[colIdx] ?? '').trim();
      if (key === 'task') {
        if (val !== '') {
          row.task = val;
          hasTask = true;
        }
      } else if (val !== '') {
        row[key] = val;
      }
    });
    if (hasTask && row.task) rows.push(row as BulkImportParsedRow);
  }
  return { headers: headerRow, rows };
}

export function splitMultiCell(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function splitLinksCell(value: string): Array<{ url: string; description: string }> {
  return splitMultiCell(value).map((part) => {
    const pipe = part.indexOf('|');
    if (pipe >= 0) {
      return { url: part.slice(0, pipe).trim(), description: part.slice(pipe + 1).trim() };
    }
    return { url: part, description: '' };
  });
}
