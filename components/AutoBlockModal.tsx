'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { MobileAwareSelect } from '@/components/mobile/MobileAwareSelect';
import type { ScheduledSlot, ScheduleBlock, Task } from '@/lib/api';
import type { PriorityDisplay } from '@/lib/priorityTheme';
import { computeAutoBlockPlacements, type AutoBlockSortMode } from '@/lib/autoBlock';
import { api } from '@/lib/api';

type Props = {
  open: boolean;
  onClose: () => void;
  bucketId: string;
  bucketLabel: string;
  viewDate: string;
  dayRecordId: number | null;
  tasks: Task[];
  scheduleBlocks: ScheduleBlock[];
  slotsOnViewDay: ScheduledSlot[];
  scheduledTaskIdsOnViewDay: Set<number>;
  slotDurationMinutes: number;
  priorityDisplay: PriorityDisplay;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
};

const SORT_OPTIONS: Array<{ value: AutoBlockSortMode; label: string }> = [
  { value: 'added_asc', label: 'Added (oldest first)' },
  { value: 'added_desc', label: 'Added (newest first)' },
  { value: 'priority', label: 'Priority (highest first)' },
  { value: 'due_date', label: 'Due date (soonest first)' },
];

export function AutoBlockModal({
  open,
  onClose,
  bucketId,
  bucketLabel,
  viewDate,
  dayRecordId,
  tasks,
  scheduleBlocks,
  slotsOnViewDay,
  scheduledTaskIdsOnViewDay,
  slotDurationMinutes,
  priorityDisplay,
  onSuccess,
  onError,
  onReload,
}: Props) {
  const [sortMode, setSortMode] = useState<AutoBlockSortMode>('added_asc');
  const [busy, setBusy] = useState(false);

  const bucketTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.list_state ?? 'unassigned') === bucketId &&
          !t.parent_id &&
          !t.is_common &&
          t.default_block_id != null &&
          t.default_block_id > 0 &&
          !scheduledTaskIdsOnViewDay.has(t.id)
      ),
    [tasks, bucketId, scheduledTaskIdsOnViewDay]
  );

  const preview = useMemo(
    () =>
      computeAutoBlockPlacements({
        tasks: bucketTasks,
        scheduleBlocks,
        existingSlots: slotsOnViewDay,
        scheduledTaskIds: scheduledTaskIdsOnViewDay,
        slotDurationMinutes,
        sortMode,
        priorityDisplay,
      }),
    [bucketTasks, scheduleBlocks, slotsOnViewDay, scheduledTaskIdsOnViewDay, slotDurationMinutes, sortMode, priorityDisplay]
  );

  const handleRun = async () => {
    if (!dayRecordId) {
      onError('Day record not loaded.');
      return;
    }
    if (preview.placements.length === 0) {
      window.alert('No tasks can be placed. Add schedule blocks for today and assign default blocks to tasks.');
      return;
    }
    setBusy(true);
    try {
      for (const p of preview.placements) {
        await api.slots.create({
          day_record_id: dayRecordId,
          task_id: p.task_id,
          start_time: p.start_time,
          end_time: p.end_time,
        });
      }
      onReload();
      const skippedMsg = preview.skipped > 0 ? ` ${preview.skipped} skipped (no room or no matching block).` : '';
      onSuccess(`Scheduled ${preview.placements.length} task${preview.placements.length === 1 ? '' : 's'} into blocks.${skippedMsg}`);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auto Block"
      actions={
        <>
          <Button onClick={() => void handleRun()} disabled={busy || preview.placements.length === 0}>
            {busy ? 'Scheduling…' : 'Populate blocks'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
          Place unscheduled tasks from <strong>{bucketLabel}</strong> into matching schedule blocks on{' '}
          <strong>{viewDate}</strong>. Only tasks with a default block assigned are included.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          Order
          <MobileAwareSelect<AutoBlockSortMode>
            value={sortMode}
            onChange={setSortMode}
            title="Sort order"
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            style={{ padding: '0.35rem' }}
          />
        </label>
        <p style={{ fontSize: '0.85rem', margin: 0 }}>
          Eligible: <strong>{bucketTasks.length}</strong> · Will schedule: <strong>{preview.placements.length}</strong>
          {preview.skipped > 0 && (
            <>
              {' '}
              · Skipped: <strong>{preview.skipped}</strong>
            </>
          )}
        </p>
        {scheduleBlocks.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--warning, #c90)', margin: 0 }}>
            No schedule blocks on this day. Add blocks on the schedule first.
          </p>
        )}
      </div>
    </Modal>
  );
}
