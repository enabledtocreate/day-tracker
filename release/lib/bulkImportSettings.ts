import type { BulkImportColumnKey } from '@/lib/bulkImportColumns';
import { BULK_IMPORT_COLUMNS } from '@/lib/bulkImportColumns';

export type BulkImportDelimiter = 'tab' | 'comma' | 'semicolon';

export type BulkImportSettings = {
  delimiter: BulkImportDelimiter;
  allow_duplicates_quick_add: boolean;
  add_new_values: boolean;
  ignore_case: boolean;
  instruction_text: string;
  columns_enabled: Record<BulkImportColumnKey, boolean>;
};

const DEFAULT_COLUMNS: Record<BulkImportColumnKey, boolean> = {
  task: true,
  category: true,
  subcategory: true,
  tags: true,
  priority: true,
  due_date: true,
  list: true,
  recurring: true,
  list_style: true,
  links: true,
  checklist: true,
  category_color: true,
  tag_colors: true,
};

export const DEFAULT_BULK_IMPORT_SETTINGS: BulkImportSettings = {
  delimiter: 'tab',
  allow_duplicates_quick_add: true,
  add_new_values: true,
  ignore_case: false,
  instruction_text: '',
  columns_enabled: { ...DEFAULT_COLUMNS },
};

export function parseBulkImportSettingsJson(raw: string | null | undefined): BulkImportSettings {
  if (raw == null || raw === '') return { ...DEFAULT_BULK_IMPORT_SETTINGS, columns_enabled: { ...DEFAULT_COLUMNS } };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const delim = o.delimiter;
    const delimiter: BulkImportDelimiter =
      delim === 'comma' || delim === 'semicolon' || delim === 'tab' ? delim : 'tab';
    const colsIn = o.columns_enabled;
    const columns_enabled = { ...DEFAULT_COLUMNS };
    if (colsIn && typeof colsIn === 'object') {
      for (const key of Object.keys(DEFAULT_COLUMNS) as BulkImportColumnKey[]) {
        if (typeof (colsIn as Record<string, unknown>)[key] === 'boolean') {
          columns_enabled[key] = (colsIn as Record<string, boolean>)[key];
        }
      }
    }
    columns_enabled.task = true;
    return {
      delimiter,
      allow_duplicates_quick_add: o.allow_duplicates_quick_add !== false,
      add_new_values: o.add_new_values !== false,
      ignore_case: o.ignore_case === true,
      instruction_text: typeof o.instruction_text === 'string' ? o.instruction_text : '',
      columns_enabled,
    };
  } catch {
    return { ...DEFAULT_BULK_IMPORT_SETTINGS, columns_enabled: { ...DEFAULT_COLUMNS } };
  }
}

export function bulkImportSettingsToJson(s: BulkImportSettings): string {
  return JSON.stringify({
    delimiter: s.delimiter,
    allow_duplicates_quick_add: s.allow_duplicates_quick_add,
    add_new_values: s.add_new_values,
    ignore_case: s.ignore_case,
    instruction_text: s.instruction_text,
    columns_enabled: s.columns_enabled,
  });
}

export const DEFAULT_BULK_INSTRUCTION_LINES = [
  'Delete everything above the first task row before uploading.',
  'Only the header row and task rows should remain in the file you upload.',
  'Task is the only required column. All other columns are optional.',
  'Use comma-separated values inside a single cell for Tags, Links, Checklist, and Tag colors.',
  'Wrap a cell in double quotes if it contains the delimiter, a comma, or a line break. Double quotes inside a cell are written as "".',
  'Subcategory requires Category on the same row.',
  'List column uses your bucket display labels (see reference rows below).',
  'Priority accepts labels or slugs from your priority settings.',
];

export function bulkImportDelimiterChar(d: BulkImportDelimiter): string {
  if (d === 'tab') return '\t';
  if (d === 'semicolon') return ';';
  return ',';
}

export function columnHeaderList(enabled: Record<BulkImportColumnKey, boolean>): string[] {
  return BULK_IMPORT_COLUMNS.filter((c) => enabled[c.key] !== false).map((c) => c.header);
}
