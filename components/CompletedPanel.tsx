'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { CompletedSummaryModal } from '@/components/CompletedSummaryModal';
import { DT } from '@/lib/uiIdentifiers';

type CompletedItem = {
  id: number;
  task_id: number;
  title: string;
  start_time?: string;
  completed_at: string;
};

function timeToHours(start: string | undefined, end: string): number {
  if (!start) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

type Props = {
  open?: boolean;
  onClose?: () => void;
};

export function CompletedPanel({ open: controlledOpen, onClose }: Props = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined && onClose !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const [byDate, setByDate] = useState<Record<string, CompletedItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [visibleDays, setVisibleDays] = useState(7);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const fetchCompleted = async () => {
    setLoading(true);
    try {
      const r = await api.accomplished.listAll();
      setByDate(r.byDate ?? {});
      setLoaded(true);
      setVisibleDays(7);
    } catch {
      setByDate({});
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !loaded && !loading) void fetchCompleted();
  }, [open, loaded, loading]);

  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const shownDates = dates.slice(0, visibleDays);

  return (
    <>
    <div className={`panel-slide panel-slide-completed ${DT.panelCompletedSlide}`}>
      <button
        type="button"
        className="completed-tab-btn"
        title="Completed tasks by day"
        onClick={() => {
          if (isControlled) return onClose();
          if (open) return setInternalOpen(false);
          // Load first, then expand panel.
          if (!loaded) {
            void fetchCompleted().then(() => setInternalOpen(true));
            return;
          }
          setInternalOpen(true);
        }}
      >
        Completed Tasks
      </button>
      <div
        id="completed-panel"
        className={'completed-panel' + (open ? ' visible' : '')}
        aria-hidden={!open}
      >
        <div className="completed-panel-header">
          <h3>Completed Tasks</h3>
          <div className="completed-panel-header-actions">
            <button type="button" className="completed-summary-open-btn" title="Summary by category and date" onClick={() => setSummaryOpen(true)}>
              Summary
            </button>
          </div>
        </div>
        <div
          id="completed-list"
          className="completed-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (visibleDays >= dates.length) return;
            const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (remaining < 40) setVisibleDays((n) => n + 7);
          }}
        >
          {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!loading && dates.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No completed tasks yet.</p>}
          {!loading && shownDates.map((date) => (
            <div key={date} className="completed-day-group" data-date={date}>
              <div className="day-label">
                {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
              </div>
              <ul className="completed-day-list">
                {(byDate[date] ?? []).map((item) => (
                  <li key={item.id} className="completed-item">
                    <div className="completed-item-row">
                      <span className="completed-item-title">{item.title ?? ''}</span>
                      <span className="completed-item-duration">
                        {timeToHours(item.start_time, item.completed_at) > 0
                          ? String(timeToHours(item.start_time, item.completed_at)) + 'h'
                          : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!loading && shownDates.length < dates.length && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Scroll for older days…</p>
          )}
        </div>
      </div>
    </div>
    <CompletedSummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} />
    </>
  );
}
