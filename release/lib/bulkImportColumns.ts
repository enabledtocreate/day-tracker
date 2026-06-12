/** Canonical bulk-import column keys (match template headers). */
export type BulkImportColumnKey =
  | 'task'
  | 'category'
  | 'subcategory'
  | 'tags'
  | 'priority'
  | 'due_date'
  | 'list'
  | 'recurring'
  | 'list_style'
  | 'links'
  | 'checklist'
  | 'category_color'
  | 'tag_colors';

export type BulkImportColumnDef = {
  key: BulkImportColumnKey;
  header: string;
  description: string;
};

export const BULK_IMPORT_COLUMNS: BulkImportColumnDef[] = [
  { key: 'task', header: 'Task', description: 'Required. Task title.' },
  { key: 'category', header: 'Category', description: 'Optional. Must match an existing category unless “Add new values” is on.' },
  { key: 'subcategory', header: 'Subcategory', description: 'Optional. Requires Category on the same row.' },
  { key: 'tags', header: 'Tags', description: 'Optional. Comma-separated inside one cell, e.g. "urgent, home".' },
  { key: 'priority', header: 'Priority', description: 'Optional. Label or slug from your priority settings.' },
  { key: 'due_date', header: 'Due date', description: 'Optional. YYYY-MM-DD.' },
  { key: 'list', header: 'List', description: 'Optional. Bucket display label; defaults to your first list.' },
  { key: 'recurring', header: 'Recurring', description: 'Optional. yes/no, true/false, or 1/0.' },
  { key: 'list_style', header: 'List style', description: 'Optional. bullet or checklist (checklist also implied if Checklist items are set).' },
  { key: 'links', header: 'Links', description: 'Optional. Comma-separated URLs or url|description pairs.' },
  { key: 'checklist', header: 'Checklist', description: 'Optional. Comma-separated checklist item texts.' },
  { key: 'category_color', header: 'Category color', description: 'Optional. Used when creating a new category (ignored for existing).' },
  { key: 'tag_colors', header: 'Tag colors', description: 'Optional. Comma-separated colors parallel to Tags when creating new tags.' },
];

const HEADER_TO_KEY: Record<string, BulkImportColumnKey> = {};
for (const col of BULK_IMPORT_COLUMNS) {
  HEADER_TO_KEY[col.header.toLowerCase()] = col.key;
  HEADER_TO_KEY[col.key] = col.key;
  HEADER_TO_KEY[col.key.replace('_', ' ')] = col.key;
}
HEADER_TO_KEY['due date'] = 'due_date';
HEADER_TO_KEY['list style'] = 'list_style';
HEADER_TO_KEY['category color'] = 'category_color';
HEADER_TO_KEY['tag colors'] = 'tag_colors';
HEADER_TO_KEY['tag color'] = 'tag_colors';

export function headerToBulkColumnKey(header: string): BulkImportColumnKey | null {
  const n = header.trim().toLowerCase();
  return HEADER_TO_KEY[n] ?? null;
}

export function enabledBulkColumns(
  enabled: Partial<Record<BulkImportColumnKey, boolean>> | undefined
): BulkImportColumnDef[] {
  return BULK_IMPORT_COLUMNS.filter((c) => c.key === 'task' || enabled?.[c.key] !== false);
}
