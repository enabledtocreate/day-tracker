/**
 * Modal when unscheduling a partially completed task (parent with some subtasks done).
 */
import { api } from './api';

const modal = document.getElementById('unschedule-partial-modal') as HTMLDialogElement | null;
const messageEl = document.getElementById('unschedule-partial-message');
const okBtn = document.getElementById('unschedule-partial-ok');
const cancelBtn = document.getElementById('unschedule-partial-cancel');
const orphanBtn = document.getElementById('unschedule-partial-orphan');

export type UnscheduleChoice = 'ok' | 'cancel' | 'orphan';

export type UnscheduleResult = { choice: UnscheduleChoice; slotId: number; taskId?: number; childSlots?: Array<{ id: number; completed: number }> };

export function confirmUnschedulePartiallyComplete(slotId: number): Promise<UnscheduleResult> {
  return api.slots.get(slotId).then(({ slot, childSlots }) => {
    const isRoot = slot && (slot.parent_id == null);
    const hasChildren = (childSlots?.length ?? 0) > 0;
    const rootCompleted = slot?.completed === 1;
    const childCompleted = childSlots?.filter((c) => c.completed === 1).length ?? 0;
    const completedCount = childCompleted + (rootCompleted ? 1 : 0);
    const totalCount = 1 + (childSlots?.length ?? 0);
    const partiallyComplete = isRoot && hasChildren && completedCount > 0 && completedCount < totalCount;
    const taskId = slot?.task_id;
    if (!partiallyComplete) return Promise.resolve({ choice: 'ok', slotId, taskId });

    return new Promise<UnscheduleResult>((resolve) => {
      if (!modal || !messageEl) {
        resolve({ choice: 'ok', slotId });
        return;
      }
      messageEl.textContent = completedCount > 0
        ? 'This task has completed subtasks. All finished subtasks will be reset if you remove it. Remove from schedule anyway? Use "Orphan completed" to leave completed subtasks on the schedule.'
        : 'Remove this task from the schedule?';
      (orphanBtn as HTMLButtonElement).style.display = completedCount > 0 ? '' : 'none';
      const done = (choice: UnscheduleChoice) => {
        modal.close();
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        orphanBtn?.removeEventListener('click', onOrphan);
        resolve({ choice, slotId, taskId: slot?.task_id, childSlots: childSlots ?? [] });
      };
      const onOk = () => done('ok');
      const onCancel = () => done('cancel');
      const onOrphan = () => done('orphan');
      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);
      orphanBtn?.addEventListener('click', onOrphan);
      modal.showModal();
    });
  });
}
