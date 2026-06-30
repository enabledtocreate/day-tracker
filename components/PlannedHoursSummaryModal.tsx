'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { api } from '@/lib/api';
import {
  computePlannedBlockSummary,
  computePlannedCategorySummary,
  mergePlannedSummaries,
  type PlannedHoursSummary,
} from '@/lib/plannedHoursSummary';
import type { ScheduledSlot, Task } from '@/lib/api';
import { DT } from '@/lib/uiIdentifiers';

export type PlannedSummaryScope = 'today' | 'week' | 'calendar';

type Props = {
  open: boolean;
  onClose: () => void;
  scope: PlannedSummaryScope;
  scopeLabel: string;
  fromDate: string;
  toDate: string;
  slots: ScheduledSlot[];
  tasks: Task[];
  categories: Array<{ id: number; name: string }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  /** Today view: blocks already loaded for the day. */
  todayScheduleBlocks?: Array<{ block_name?: string | null; start_time: string; end_time: string }>;
};

export function PlannedHoursSummaryModal({
  open,
  onClose,
  scope,
  scopeLabel,
  fromDate,
  toDate,
  slots,
  tasks,
  categories,
  subcategories,
  todayScheduleBlocks,
}: Props) {
  const [summary, setSummary] = useState<PlannedHoursSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSummary(null);
      return;
    }
    setLoading(true);

    const loadSlots = async (): Promise<ScheduledSlot[]> => {
      if (scope === 'today') return slots;
      try {
        const r = await api.slots.listByDateRange(fromDate, toDate);
        return Object.values(r.byDate ?? {}).flat();
      } catch {
        return slots;
      }
    };

    const loadBlocks = async () => {
      if (scope === 'today' && todayScheduleBlocks) {
        return computePlannedBlockSummary(todayScheduleBlocks);
      }
      try {
        const r = await api.scheduleBlocks.listByDateRange(fromDate, toDate);
        const flat = Object.values(r.byDate ?? {}).flat();
        return computePlannedBlockSummary(flat);
      } catch {
        return computePlannedBlockSummary([]);
      }
    };

    void loadSlots().then(async (scopeSlots) => {
      const category = computePlannedCategorySummary(scopeSlots, tasks, categories, subcategories);
      const blocks = await loadBlocks();
      setSummary(mergePlannedSummaries(category, blocks));
      setLoading(false);
    });
  }, [open, scope, fromDate, toDate, slots, tasks, categories, subcategories, todayScheduleBlocks]);

  const title =
    scope === 'today' ? 'Hours planned — day' : scope === 'week' ? 'Hours planned — week' : 'Hours planned — month';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      aria-label="Planned hours summary"
      className={DT.modalPlannedSummary}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{scopeLabel}</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-dim, var(--text-muted))', lineHeight: 1.4 }}>
        All timed tasks on the schedule for this period, whether completed or not. Tasks marked
        &ldquo;Exclude from planned hours summary&rdquo; in Task details are omitted. Block hours come from your schedule strip.
      </p>
      {loading || !summary ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {summary.categoryRows.length === 0 && summary.blockRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No timed tasks planned for this period.</p>
          ) : (
            <>
              {summary.categoryRows.length > 0 && (
                <section style={{ marginBottom: '1rem' }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Time by category
                  </div>
                  {summary.categoryRows.map((row) => (
                    <div key={`${row.category}-${row.subcategory ?? ''}`} style={{ marginBottom: '0.65rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {row.category}
                        {row.subcategory ? ` › ${row.subcategory}` : ''}{' '}
                        <span style={{ color: 'var(--accent-cyan, var(--accent))' }}>{row.hours}h</span>
                      </div>
                      <ul style={{ listStyle: 'none', margin: '0.25rem 0 0', padding: 0 }}>
                        {row.tasks.map((t) => (
                          <li
                            key={t.task_id}
                            style={{
                              fontSize: '0.88rem',
                              color: t.completed ? 'var(--text-muted)' : 'var(--text)',
                              textDecoration: t.completed ? 'line-through' : undefined,
                              paddingLeft: '0.5rem',
                            }}
                          >
                            {t.title}{' '}
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>({t.hours}h)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>
                    Category total:{' '}
                    <span style={{ color: 'var(--accent)' }}>{summary.categoryTotalHours}h</span>
                  </div>
                </section>
              )}
              {summary.blockRows.length > 0 && (
                <section>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Time in blocks
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {summary.blockRows.map((br) => (
                      <li
                        key={br.block_name}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.35rem',
                          alignItems: 'baseline',
                          marginBottom: '0.35rem',
                        }}
                      >
                        <span>{br.block_name}</span>
                        <span style={{ color: 'var(--accent-cyan, var(--accent))', fontWeight: 600 }}>{br.hours}h</span>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: '0.4rem', fontWeight: 600 }}>
                    Blocks total: <span style={{ color: 'var(--accent)' }}>{summary.blockTotalHours}h</span>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
