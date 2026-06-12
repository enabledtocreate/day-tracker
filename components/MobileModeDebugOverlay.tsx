'use client';

/**
 * Tiny corner overlay that shows the current MobileMode + modal count.
 * Only render when admin debug + showDebugOverlays are both on (see
 * `TaskListAndSchedule.tsx` for how those flags are toggled).
 */

import { useMobileMode } from '@/lib/mobileMode';

export function MobileModeDebugOverlay({ visible }: { visible: boolean }) {
  const { mode, modalOpenCount, isGestureSuppressed } = useMobileMode();
  if (!visible) return null;

  const summary = (() => {
    switch (mode.kind) {
      case 'normal':
        return 'normal';
      case 'move':
        return `move t#${mode.originatingTaskId} src=${mode.source} group=${mode.groupMemberIds.length} moved=${mode.hasMoved ? 'y' : 'n'}`;
      case 'resize':
        return `resize ${mode.targetKind}#${mode.targetId} edge=${mode.edge}`;
      case 'edit':
        return `edit t#${mode.taskId}`;
      case 'bulkSelect':
        return 'bulkSelect';
    }
  })();

  return (
    <div
      className="mobile-mode-debug-overlay"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        zIndex: 9999,
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    >
      mode: {summary}
      {modalOpenCount > 0 && ` | modals=${modalOpenCount}${isGestureSuppressed ? ' (suppress)' : ''}`}
    </div>
  );
}
