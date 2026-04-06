'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';

type DayBlock = {
  date: string;
  rows: Array<{ category: string; subcategory: string | null; hours: number; titles: string[] }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CompletedSummaryModal({ open, onClose }: Props) {
  const [days, setDays] = useState<DayBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [titlesMode, setTitlesMode] = useState<'list' | 'comma'>('list');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.accomplished
      .summaryByOrganization()
      .then((r) => setDays(r.days ?? []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Time by category" aria-label="Completed time summary by category">
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No completed scheduled slots with times yet.</p>
        )}
        {!loading &&
          days.map((d) => (
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
                    {row.titles.length > 0 && (
                      <div style={{ marginTop: '0.25rem', paddingLeft: '0.15rem' }}>
                        {titlesMode === 'list' ? (
                          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {row.titles.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.4 }}>{row.titles.join(', ')}</div>
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
  );
}
