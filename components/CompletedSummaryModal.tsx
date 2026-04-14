'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, type TaskLink, type TaskListItem } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { DT } from '@/lib/uiIdentifiers';

type SummaryTag = { id: number; name: string; color?: string | null };

type SummaryTask = {
  task_id: number;
  title: string;
  hours: number;
  links: TaskLink[];
  list_items: TaskListItem[];
  tags?: SummaryTag[];
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

export function CompletedSummaryModal({ open, onClose }: Props) {
  const [days, setDays] = useState<DayBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [titlesMode, setTitlesMode] = useState<'list' | 'comma'>('list');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [listModal, setListModal] = useState<{ taskTitle: string; items: TaskListItem[] } | null>(null);

  const displayDays = useMemo(() => filterSummaryDays(days, searchQuery), [days, searchQuery]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      return;
    }
    setDraftFrom(appliedFrom);
    setDraftTo(appliedTo);
  }, [open, appliedFrom, appliedTo]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.accomplished
      .summaryByOrganization({
        from_date: appliedFrom.trim() || undefined,
        to_date: appliedTo.trim() || undefined,
      })
      .then((r) => setDays(r.days ?? []))
      .catch(() => setDays([]))
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
            placeholder="Filter by task, tag, category…"
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
          {!loading && days.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No completed scheduled slots with times in this range.</p>
          )}
          {!loading &&
            days.length > 0 &&
            displayDays.length === 0 &&
            searchQuery.trim() !== '' && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No rows match your search.</p>
            )}
          {!loading &&
            displayDays.map((d) => (
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
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="completed-summary-icon-link"
                                        title={linkTooltip(link)}
                                        aria-label={linkTooltip(link)}
                                      >
                                        🔗
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
              </div>
            ))}
        </div>
      </Modal>

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
