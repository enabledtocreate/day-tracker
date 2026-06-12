'use client';

/**
 * Sticky banner that appears at the top of the mobile shell while the user is in
 * Move mode (spec: `.apm/_WORKSPACE/TODO-mobile.md §0.3 Move mode`). It surfaces:
 *   - "Moving N task(s)" — count includes the originating task + every group member
 *   - "Tap a drop zone or a time slot to drop. Double-tap to exit."
 *   - A persistent "Cancel" button so the user can always escape Move mode.
 *
 * Renders nothing when not in Move mode, so the parent can keep it mounted
 * unconditionally on the mobile shell.
 */

import { useMobileMode } from '@/lib/mobileMode';
import { haptic } from '@/lib/mobileHaptics';

export function MobileMoveBanner({ visible }: { visible: boolean }) {
  const { mode, actions } = useMobileMode();
  if (!visible || mode.kind !== 'move') return null;

  const totalCount = mode.groupMemberIds.length + 1;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mobile-move-banner"
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 80,
        padding: '0.5rem 0.75rem',
        background: 'var(--accent, #2563eb)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        fontSize: '0.85rem',
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
        <strong style={{ fontWeight: 600 }}>Moving {totalCount} task{totalCount === 1 ? '' : 's'}</strong>
        <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
          Tap a drop zone or time slot to drop · Double-tap the held task to exit
        </span>
      </div>
      <button
        type="button"
        className="mobile-move-banner-cancel"
        onClick={() => {
          actions.exitMove();
          haptic('transition');
        }}
        style={{
          flex: '0 0 auto',
          padding: '0.4rem 0.7rem',
          background: 'rgba(255,255,255,0.18)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 4,
          fontSize: '0.85rem',
          minHeight: 36,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
