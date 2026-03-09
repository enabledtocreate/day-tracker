'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type CompletedItem = {
  id: number;
  task_id: number;
  title: string;
  start_time?: string;
  completed_at: string;
  subtasks?: Array<{ id: number; task_id: number; title: string; start_time?: string; completed_at: string }>;
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

  useEffect(() => {
    if (open) {
      setLoading(true);
      api.accomplished.listAll()
        .then((r) => setByDate(r.byDate ?? {}))
        .catch(() => setByDate({}))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="panel-slide panel-slide-completed">
      <button
        type="button"
        className="completed-tab-btn"
        title="Completed tasks by day"
        onClick={() => (isControlled ? onClose() : setInternalOpen((o) => !o))}
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
          <button type="button" className="completed-panel-close" aria-label="Close" onClick={() => (isControlled ? onClose() : setInternalOpen(false))}>
            &#215;
          </button>
        </div>
        <div id="completed-list" className="completed-list">
          {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!loading && dates.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No completed tasks yet.</p>}
          {!loading && dates.map((date) => (
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
                    {item.subtasks && item.subtasks.length > 0 && (
                      <ul className="completed-subtasks">
                        {item.subtasks.map((sub) => (
                          <li key={sub.id} className="completed-subtask">
                            {sub.title ?? ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
