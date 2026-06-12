'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Download, ExternalLink, Table2 } from 'lucide-react';
import { api, type TaskLink, type TaskListItem } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { DT } from '@/lib/uiIdentifiers';
import { contactLinkPrefsFromSettings } from '@/lib/contactLinks';
import { isSpecialTaskLink, openTaskLink, taskLinkGlyph, taskLinkHref, type ContactLinkPrefs } from '@/lib/taskLinks';

type SummaryTag = { id: number; name: string; color?: string | null };

type SummaryTask = {
  task_id: number;
  title: string;
  hours: number;
  links: TaskLink[];
  list_items: TaskListItem[];
  tags?: SummaryTag[];
  /**
   * Names of schedule-strip blocks the task was completed inside on this
   * date. Comes from the server, computed by slot-start contained in
   * [block_start, block_end). Empty when the task wasn't in any block.
   */
  block_names?: string[];
};

type SummaryRow = {
  category: string;
  subcategory: string | null;
  hours: number;
  titles: string[];
  tasks?: SummaryTask[];
};

type DayBlock = {
  date: string;
  rows: SummaryRow[];
};

type BlockDayRow = { block_name: string; hours: number };
type BlockDay = { date: string; rows: BlockDayRow[]; total_hours: number };

type MergedDay = { date: string; rows: SummaryRow[]; blocks: BlockDay | null };

type Props = {
  open: boolean;
  onClose: () => void;
};

function linkTooltip(link: TaskLink): string {
  const d = link.description?.trim();
  return d || link.url;
}

function tasksForRow(row: SummaryRow): SummaryTask[] {
  if (row.tasks && row.tasks.length > 0) return row.tasks;
  return (row.titles ?? []).map((title, i) => ({
    task_id: -1 - i,
    title,
    hours: 0,
    links: [],
    list_items: [],
    tags: [],
    block_names: [],
  }));
}

function taskVisible(qNorm: string, row: SummaryRow, task: SummaryTask): boolean {
  if (!qNorm) return true;
  if (row.category.toLowerCase().includes(qNorm)) return true;
  if (row.subcategory != null && String(row.subcategory).toLowerCase().includes(qNorm)) return true;
  if ((task.title || '').toLowerCase().includes(qNorm)) return true;
  for (const tg of task.tags ?? []) {
    if (tg.name.toLowerCase().includes(qNorm)) return true;
  }
  return false;
}

function filterSummaryDays(source: DayBlock[], qRaw: string): DayBlock[] {
  const qNorm = qRaw.trim().toLowerCase();
  if (!qNorm) return source;
  return source
    .map((d) => {
      const rows = d.rows
        .map((row) => {
          const tasks = tasksForRow(row);
          const filtered = tasks.filter((task) => taskVisible(qNorm, row, task));
          if (filtered.length === 0) return null;
          const hours = filtered.reduce((s, t) => s + (Number(t.hours) || 0), 0);
          const next: SummaryRow = {
            ...row,
            tasks: filtered,
            titles: filtered.map((t) => t.title).filter(Boolean),
            hours,
          };
          return next;
        })
        .filter((r): r is SummaryRow => r != null);
      return rows.length === 0 ? null : { ...d, rows };
    })
    .filter((d): d is DayBlock => d != null);
}

function filterBlockDayBySearch(b: BlockDay, qNorm: string): BlockDay | null {
  if (!qNorm) return b;
  const rows = b.rows.filter((r) => r.block_name.toLowerCase().includes(qNorm));
  if (rows.length === 0) return null;
  const total_hours = Math.round(rows.reduce((s, r) => s + (Number(r.hours) || 0), 0) * 100) / 100;
  return { ...b, rows, total_hours };
}

function mergedDisplayDays(days: DayBlock[], blockDays: BlockDay[], qRaw: string): MergedDay[] {
  const qNorm = qRaw.trim().toLowerCase();
  const catFiltered = filterSummaryDays(days, qRaw);
  const blockFiltered = blockDays.map((b) => filterBlockDayBySearch(b, qNorm)).filter((x): x is BlockDay => x != null);

  const map = new Map<string, { rows: SummaryRow[]; blocks: BlockDay | null }>();
  for (const d of catFiltered) {
    map.set(d.date, { rows: d.rows, blocks: null });
  }
  for (const b of blockFiltered) {
    const cur = map.get(b.date);
    if (cur) {
      cur.blocks = b;
    } else {
      map.set(b.date, { rows: [], blocks: b });
    }
  }
  return Array.from(map.entries())
    .sort(([da], [db]) => db.localeCompare(da))
    .map(([date, v]) => ({ date, rows: v.rows, blocks: v.blocks }));
}

function tagChipStyle(tg: SummaryTag): CSSProperties {
  const c = tg.color;
  return {
    backgroundColor: c ?? 'var(--surface-elevated, var(--surface))',
    color: c ? (c.startsWith('hsl') && c.includes('65%') ? '#fff' : '#000') : 'var(--text-muted)',
  };
}

function commaLineWithTags(tasks: SummaryTask[]): string {
  return tasks
    .map((t) => {
      const tagNames = (t.tags ?? []).map((x) => x.name).filter(Boolean);
      if (tagNames.length === 0) return t.title;
      return `${t.title} (${tagNames.join(', ')})`;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Sanitize a single cell so it can sit inside a tab-delimited row without
 * corrupting the spreadsheet shape. Tabs become a single space (would split
 * the row), CR / LF become a space (would split into a new record),
 * surrounding whitespace is trimmed. Numbers / booleans round-trip via
 * String(); null / undefined become "".
 */
function tsvCell(value: unknown): string {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s.replace(/[\t\r\n]+/g, ' ').trim();
}

function buildSummaryExportTable(displayDays: MergedDay[]): { headers: string[]; rows: string[][] } {
  let maxLinks = 0;
  for (const d of displayDays) {
    for (const row of d.rows) {
      for (const t of tasksForRow(row)) {
        const n = (t.links ?? []).length;
        if (n > maxLinks) maxLinks = n;
      }
    }
  }

  const headers: string[] = [
    'Date',
    'Block',
    'Category',
    'Subcategory',
    'Task',
    'Tags',
    'Lists',
    'Hours',
  ];
  for (let i = 1; i <= maxLinks; i++) {
    headers.push(`Link ${i} URL`);
    headers.push(`Link ${i} Description`);
  }

  const rows: string[][] = [];
  for (const d of displayDays) {
    for (const row of d.rows) {
      const tasks = tasksForRow(row);
      if (tasks.length === 0) continue;
      for (const t of tasks) {
        const blocks = (t.block_names ?? []).filter(Boolean).join(', ');
        const tagNames = (t.tags ?? []).map((x) => x.name).filter(Boolean).join(', ');
        const lists = (t.list_items ?? [])
          .map((it) => (it.content ?? '').trim())
          .filter(Boolean)
          .join(', ');

        const cells: string[] = [
          tsvCell(d.date),
          tsvCell(blocks),
          tsvCell(row.category),
          tsvCell(row.subcategory ?? ''),
          tsvCell(t.title),
          tsvCell(tagNames),
          tsvCell(lists),
          tsvCell(t.hours ?? 0),
        ];
        const links = t.links ?? [];
        for (let i = 0; i < maxLinks; i++) {
          const lk = links[i];
          cells.push(tsvCell(lk?.url ?? ''));
          cells.push(tsvCell(lk?.description ?? ''));
        }
        rows.push(cells);
      }
    }
  }
  return { headers, rows };
}

/**
 * Build a tab-delimited spreadsheet from the currently displayed summary
 * (honors both the date range and the text-search filter). Exactly one row
 * per task inside each (date, category, subcategory) bucket — no separate
 * block rows, because each task already carries the name(s) of the
 * schedule-strip block it was completed inside via the `Block` column.
 *
 * Column layout:
 *   Date | Block | Category | Subcategory | Task | Tags | Lists | Hours |
 *   Link 1 URL | Link 1 Description | Link 2 URL | Link 2 Description | …
 */
function buildSummaryTsv(displayDays: MergedDay[]): string {
  const { headers, rows } = buildSummaryExportTable(displayDays);
  const lines = [headers.join('\t'), ...rows.map((r) => r.join('\t'))];
  return lines.join('\n') + '\n';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function summaryRangeLabel(from: string, to: string): string {
  if (from.trim() && to.trim()) return `${from.trim()} – ${to.trim()}`;
  if (from.trim()) return `from ${from.trim()}`;
  if (to.trim()) return `through ${to.trim()}`;
  return 'all dates';
}

function buildSummaryTableHtml(displayDays: MergedDay[], from: string, to: string): string {
  const { headers, rows } = buildSummaryExportTable(displayDays);
  const rangeLabel = summaryRangeLabel(from, to);

  const headerHtml = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const bodyHtml =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" style="text-align:center;color:#666;padding:1.5rem">No rows to display</td></tr>`
      : rows
          .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Day Tracker summary — ${escapeHtml(rangeLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1rem 1.25rem 2rem;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: #1a1a1a;
      background: #fafafa;
    }
    h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem; }
    .meta { color: #555; font-size: 0.85rem; margin-bottom: 1rem; }
    .wrap {
      overflow: auto;
      max-width: 100%;
      border: 1px solid #ccc;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    table { border-collapse: collapse; width: max-content; min-width: 100%; }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #e8f5e9;
      border-bottom: 2px solid #a5d6a7;
      padding: 0.45rem 0.65rem;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
    }
    tbody td {
      border-bottom: 1px solid #eee;
      padding: 0.4rem 0.65rem;
      vertical-align: top;
      max-width: 280px;
      word-break: break-word;
    }
    tbody tr:nth-child(even) td { background: #f9f9f9; }
    tbody tr:hover td { background: #f0f7f0; }
    td:nth-child(8) { text-align: right; font-variant-numeric: tabular-nums; }
    @media print {
      body { background: #fff; padding: 0; }
      .wrap { border: none; box-shadow: none; }
      thead th { background: #eee; }
    }
  </style>
</head>
<body>
  <h1>Completed time summary</h1>
  <p class="meta">${escapeHtml(rangeLabel)} · ${rows.length} task row${rows.length === 1 ? '' : 's'} · Same columns as Export (.tsv)</p>
  <div class="wrap">
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>
</body>
</html>`;
}

/** Opens summary HTML in a new tab via blob URL (no popup null-check; modern browsers return null with noopener but still open). */
function tryOpenSummaryTableInNewTab(html: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function SummarySpreadsheetModal({
  open,
  onClose,
  headers,
  rows,
  rangeLabel,
  onOpenInNewTab,
}: {
  open: boolean;
  onClose: () => void;
  headers: string[];
  rows: string[][];
  rangeLabel: string;
  onOpenInNewTab: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Summary spreadsheet"
      aria-label="Completed summary spreadsheet table"
      className="completed-summary-spreadsheet-modal"
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onOpenInNewTab}>
            <ExternalLink size={14} aria-hidden strokeWidth={2} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
            Open in new tab
          </Button>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p className="completed-summary-spreadsheet-meta">
        {rangeLabel} · {rows.length} task row{rows.length === 1 ? '' : 's'} · Same columns as Export (.tsv)
      </p>
      <div className="completed-summary-spreadsheet-wrap">
        <table className="completed-summary-spreadsheet-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="completed-summary-spreadsheet-empty">
                  No rows to display
                </td>
              </tr>
            ) : (
              rows.map((cells, ri) => (
                <tr key={ri}>
                  {cells.map((c, ci) => (
                    <td key={ci} data-col={headers[ci]}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/**
 * Trigger a browser download for a string payload. Uses a transient Blob URL
 * + a synthetic <a> click so the file lands wherever the user's browser saves
 * downloads. The URL is revoked on the next tick so the blob can be GC'd.
 */
function downloadTextFile(filename: string, mime: string, content: string): void {
  if (typeof window === 'undefined') return;
  // BOM not added — TSV is plain ASCII for our column names and most user
  // content is UTF-8; adding the BOM breaks numeric typing in some importers.
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildSummaryExportFilename(from: string, to: string): string {
  const safe = (s: string) => s.trim().replace(/[^\d-]/g, '');
  const f = safe(from);
  const t = safe(to);
  if (f && t) return `daytracker-summary-${f}-to-${t}.tsv`;
  if (f) return `daytracker-summary-from-${f}.tsv`;
  if (t) return `daytracker-summary-through-${t}.tsv`;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `daytracker-summary-${yyyy}-${mm}-${dd}.tsv`;
}

export function CompletedSummaryModal({ open, onClose }: Props) {
  const [days, setDays] = useState<DayBlock[]>([]);
  const [blockDays, setBlockDays] = useState<BlockDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [titlesMode, setTitlesMode] = useState<'list' | 'comma'>('list');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [listModal, setListModal] = useState<{ taskTitle: string; items: TaskListItem[] } | null>(null);
  const [spreadsheetOpen, setSpreadsheetOpen] = useState(false);
  const [contactLinkPrefs, setContactLinkPrefs] = useState<ContactLinkPrefs | null>(null);

  const mergedDays = useMemo(() => mergedDisplayDays(days, blockDays, searchQuery), [days, blockDays, searchQuery]);
  const exportTable = useMemo(() => buildSummaryExportTable(mergedDays), [mergedDays]);
  const exportRangeLabel = useMemo(() => summaryRangeLabel(appliedFrom, appliedTo), [appliedFrom, appliedTo]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSpreadsheetOpen(false);
      return;
    }
    setDraftFrom(appliedFrom);
    setDraftTo(appliedTo);
  }, [open, appliedFrom, appliedTo]);

  useEffect(() => {
    if (!open) return;
    api.settings
      .get()
      .then((s) => setContactLinkPrefs(contactLinkPrefsFromSettings(s)))
      .catch(() => setContactLinkPrefs(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.accomplished
      .summaryByOrganization({
        from_date: appliedFrom.trim() || undefined,
        to_date: appliedTo.trim() || undefined,
      })
      .then((r) => {
        setDays(r.days ?? []);
        setBlockDays(r.block_days ?? []);
      })
      .catch(() => {
        setDays([]);
        setBlockDays([]);
      })
      .finally(() => setLoading(false));
  }, [open, appliedFrom, appliedTo]);

  const applyDateFilter = () => {
    setAppliedFrom(draftFrom.trim());
    setAppliedTo(draftTo.trim());
  };

  const clearDateFilter = () => {
    setDraftFrom('');
    setDraftTo('');
    setAppliedFrom('');
    setAppliedTo('');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Time by category"
        aria-label="Completed time summary by category"
        className={DT.modalCompletedSummary}
      >
        <div className="completed-summary-date-filter">
          <span className="completed-summary-date-filter-label">Date range (optional)</span>
          <div className="completed-summary-date-inputs">
            <label className="completed-summary-date-field">
              <span className="completed-summary-date-field-label">From</span>
              <input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                aria-label="Filter from date"
              />
            </label>
            <label className="completed-summary-date-field">
              <span className="completed-summary-date-field-label">To</span>
              <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} aria-label="Filter to date" />
            </label>
            <button type="button" className="completed-summary-apply-btn" onClick={applyDateFilter}>
              Apply
            </button>
            {(appliedFrom || appliedTo) && (
              <button type="button" className="completed-summary-clear-dates-btn" onClick={clearDateFilter}>
                Clear
              </button>
            )}
            {/* Export the currently displayed summary (date range + search) as a
                tab-delimited spreadsheet file. .tsv opens directly in Excel /
                Google Sheets / Numbers; one row per task and per block. */}
            <button
              type="button"
              className="completed-summary-export-btn"
              title="View visible summary as a spreadsheet table (same columns as Export)"
              aria-label="View summary spreadsheet table"
              disabled={loading || mergedDays.length === 0}
              onClick={() => setSpreadsheetOpen(true)}
            >
              <Table2 size={14} aria-hidden strokeWidth={2} />
              <span style={{ marginLeft: '0.25rem' }}>Table</span>
            </button>
            <button
              type="button"
              className="completed-summary-export-btn"
              title="Export visible summary as a tab-delimited spreadsheet (.tsv)"
              aria-label="Export summary as tab-delimited spreadsheet"
              disabled={loading || mergedDays.length === 0}
              onClick={() => {
                const tsv = buildSummaryTsv(mergedDays);
                const filename = buildSummaryExportFilename(appliedFrom, appliedTo);
                downloadTextFile(filename, 'text/tab-separated-values', tsv);
              }}
            >
              <Download size={14} aria-hidden strokeWidth={2} />
              <span style={{ marginLeft: '0.25rem' }}>Export</span>
            </button>
          </div>
        </div>
        <div className="completed-summary-search-row">
          <label className="completed-summary-search-label" htmlFor="completed-summary-search">
            Search
          </label>
          <input
            id="completed-summary-search"
            type="search"
            className="completed-summary-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by task, tag, category, block name…"
            autoComplete="off"
            aria-label="Search summary"
          />
        </div>
        <div className="completed-summary-mode-row">
          <span className="completed-summary-mode-label">Task titles</span>
          <button type="button" className={'completed-summary-mode-btn' + (titlesMode === 'list' ? ' active' : '')} onClick={() => setTitlesMode('list')}>
            List
          </button>
          <button type="button" className={'completed-summary-mode-btn' + (titlesMode === 'comma' ? ' active' : '')} onClick={() => setTitlesMode('comma')}>
            Comma-separated
          </button>
        </div>
        <div className="completed-summary-body" style={{ maxHeight: 'min(70vh, 520px)', overflowY: 'auto', fontSize: '0.9rem' }}>
          {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!loading && days.length === 0 && blockDays.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No completed scheduled slots or organization blocks in this range.</p>
          )}
          {!loading &&
            (days.length > 0 || blockDays.length > 0) &&
            mergedDays.length === 0 &&
            searchQuery.trim() !== '' && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No rows match your search.</p>
            )}
          {!loading &&
            mergedDays.map((d) => (
              <div key={d.date} className="completed-summary-day" style={{ marginBottom: '1.25rem' }}>
                <div
                  className="completed-summary-day-label"
                  style={{ fontWeight: 600, marginBottom: '0.5rem', paddingBottom: '0.35rem', borderBottom: '1px solid var(--border)' }}
                >
                  {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                {d.rows.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {d.rows.map((row, i) => (
                    <li
                      key={`${d.date}-${row.category}-${row.subcategory ?? ''}-${i}`}
                      style={{ marginBottom: '0.65rem', paddingLeft: '0.25rem' }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text)' }}>{row.category}</span>
                        {row.subcategory != null && (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>›</span>
                            <span style={{ color: 'var(--text-muted)' }}>{row.subcategory}</span>
                          </>
                        )}
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{row.hours}h</span>
                      </div>
                      {tasksForRow(row).length > 0 && (
                        <div style={{ marginTop: '0.25rem', paddingLeft: '0.15rem' }}>
                          {titlesMode === 'list' ? (
                            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              {tasksForRow(row).map((task) => (
                                <li key={task.task_id} className="completed-summary-task-line">
                                  <span className="completed-summary-task-main">
                                    <span className="completed-summary-task-title">{task.title || '—'}</span>
                                    {(task.tags ?? []).length > 0 && (
                                      <span className="completed-summary-task-tags">
                                        {(task.tags ?? []).map((tg) => (
                                          <span key={tg.id} className="completed-summary-tag-chip" style={tagChipStyle(tg)} title={tg.name}>
                                            {tg.name}
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                  </span>
                                  <span className="completed-summary-task-actions">
                                    {(task.links ?? []).map((link) => (
                                      <a
                                        key={link.id}
                                        href={
                                          contactLinkPrefs
                                            ? taskLinkHref(link.url, contactLinkPrefs)
                                            : link.url
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="completed-summary-icon-link"
                                        title={linkTooltip(link)}
                                        aria-label={linkTooltip(link)}
                                        onClick={(e) => {
                                          if (contactLinkPrefs && isSpecialTaskLink(link.url)) {
                                            e.preventDefault();
                                            openTaskLink(link.url, contactLinkPrefs);
                                          }
                                        }}
                                      >
                                        {taskLinkGlyph(link.url)}
                                      </a>
                                    ))}
                                    {(task.list_items?.length ?? 0) > 0 && (
                                      <button
                                        type="button"
                                        className="completed-summary-icon-list"
                                        title="View list"
                                        aria-label={`List for ${task.title}`}
                                        onClick={() => setListModal({ taskTitle: task.title, items: task.list_items })}
                                      >
                                        📋
                                      </button>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.4 }}>
                              {commaLineWithTags(tasksForRow(row))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                )}
                {d.blocks && d.blocks.rows.length > 0 && (
                  <div style={{ marginTop: d.rows.length > 0 ? '0.85rem' : 0, paddingTop: d.rows.length > 0 ? '0.65rem' : 0, borderTop: d.rows.length > 0 ? '1px solid var(--border-subtle)' : undefined }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Time in blocks
                    </div>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: 'var(--text-dim, var(--text-muted))', lineHeight: 1.35 }}>
                      Hours from your schedule strip (organization blocks), not task completion.
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {d.blocks.rows.map((br) => (
                        <li key={`${d.date}-block-${br.block_name}`} style={{ marginBottom: '0.35rem', paddingLeft: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'baseline' }}>
                          <span style={{ color: 'var(--text)' }}>{br.block_name}</span>
                          <span style={{ color: 'var(--accent-cyan, var(--accent))', fontWeight: 600 }}>{br.hours}h</span>
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: '0.4rem', fontWeight: 600, color: 'var(--text)' }}>
                      Blocks total: <span style={{ color: 'var(--accent)' }}>{d.blocks.total_hours}h</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      </Modal>

      <SummarySpreadsheetModal
        open={spreadsheetOpen}
        onClose={() => setSpreadsheetOpen(false)}
        headers={exportTable.headers}
        rows={exportTable.rows}
        rangeLabel={exportRangeLabel}
        onOpenInNewTab={() =>
          tryOpenSummaryTableInNewTab(buildSummaryTableHtml(mergedDays, appliedFrom, appliedTo))
        }
      />

      <Modal
        open={listModal != null}
        onClose={() => setListModal(null)}
        title={listModal ? `List — ${listModal.taskTitle}` : 'List'}
        aria-label="Task list read-only"
      >
        {listModal && (
          <ul className="completed-summary-list-readonly">
            {listModal.items.map((item) => (
              <li key={item.id} className={item.completed ? 'completed-summary-list-item done' : 'completed-summary-list-item'}>
                <span className="completed-summary-list-marker" aria-hidden>
                  {item.completed ? '☑' : '☐'}
                </span>
                <span>{item.content || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
