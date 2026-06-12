'use client';

import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

const FIELD_TO_HEADER: Record<string, string> = {
  task: 'Task',
  category: 'Category',
  subcategory: 'Subcategory',
  tags: 'Tags',
  priority: 'Priority',
  due_date: 'Due date',
  list: 'List',
  recurring: 'Recurring',
  list_style: 'List style',
  links: 'Links',
  checklist: 'Checklist',
};

export type BulkImportErrorPayload = {
  errors: string[];
  cell_errors?: Record<number, Record<string, string>>;
  grid_headers: string[];
  grid_rows: Array<Record<string, string>>;
};

type Props = {
  open: boolean;
  payload: BulkImportErrorPayload | null;
  onClose: () => void;
};

export function BulkImportErrorModal({ open, payload, onClose }: Props) {
  if (!open || !payload) return null;

  return (
    <Modal open={open} onClose={onClose} title="Import rejected">
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        {payload.errors.length > 0 && (
          <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem', color: 'var(--text)' }}>
            {payload.errors.map((err, i) => (
              <li key={i} style={{ marginBottom: '0.35rem' }}>
                {err}
              </li>
            ))}
          </ul>
        )}
        {payload.grid_rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table
              className="bulk-import-error-grid"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.85rem',
              }}
            >
              <thead>
                <tr>
                  {payload.grid_headers.map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '0.35rem 0.5rem',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payload.grid_rows.map((row, rowIdx) => {
                  const rowCells = payload.cell_errors?.[rowIdx] ?? {};
                  return (
                    <tr key={rowIdx}>
                      {payload.grid_headers.map((h) => {
                        const fieldKey = Object.entries(FIELD_TO_HEADER).find(([, hdr]) => hdr === h)?.[0];
                        const bad = fieldKey && rowCells[fieldKey];
                        return (
                          <td
                            key={h}
                            style={{
                              padding: '0.35rem 0.5rem',
                              borderBottom: '1px solid var(--border-subtle)',
                              background: bad ? 'rgba(220, 60, 60, 0.25)' : undefined,
                              color: bad ? '#ffb4b4' : 'var(--text)',
                              maxWidth: '14rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={bad ? String(bad) : undefined}
                          >
                            {row[h] ?? ''}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="button" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
