'use client';

import { useState, useCallback, useRef } from 'react';
import { useDrag } from '@use-gesture/react';
import type { AuthUser } from '@/lib/auth';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { UserSettingsView } from '@/components/UserSettingsView';
import { AdminSettingsView } from '@/components/AdminSettingsView';
import { TaskListAndSchedule } from '@/components/TaskListAndSchedule';
import { DT } from '@/lib/uiIdentifiers';

const MOBILE_BREAKPOINT = '(max-width: 768px)';
const SWIPE_THRESHOLD = 60;
/** Only main panel swipes (Completed | Tasks | AI) when gesture starts in left/right edge of screen */
const PANEL_EDGE_BUFFER_PX = 72;

type Props = {
  user: AuthUser;
  aiEnabled: boolean;
  showUserSettings: boolean;
  showAdminSettings: boolean;
  onCloseSettings: () => void;
  onLogout: () => void;
  onUserUpdated: () => void;
};

export function AppPanels({
  user,
  aiEnabled,
  showUserSettings,
  showAdminSettings,
  onCloseSettings,
  onLogout,
  onUserUpdated,
}: Props) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const [mainSlideIndex, setMainSlideIndex] = useState(1); // 0=Completed, 1=Tasks, 2=AI
  const refetchOrganizationRef = useRef<(() => void) | null>(null);

  const applyMainSlide = useCallback(
    (index: number) => {
      const maxIndex = aiEnabled ? 2 : 1;
      setMainSlideIndex(Math.max(0, Math.min(maxIndex, index)));
    },
    [aiEnabled]
  );

  const panelSwipeStartedInEdgeRef = useRef(false);

  const bindPanelsDrag = useDrag(
    ({ movement: [mx], velocity: [vx], first, last, initial }) => {
      if (first && typeof window !== 'undefined') {
        const startX = initial?.[0] ?? 0;
        const w = window.innerWidth;
        panelSwipeStartedInEdgeRef.current =
          startX < PANEL_EDGE_BUFFER_PX || startX > w - PANEL_EDGE_BUFFER_PX;
      }
      if (!last || !isMobile || !panelSwipeStartedInEdgeRef.current) return;
      const threshold = SWIPE_THRESHOLD;
      const minVelocity = 0.2;
      // Swipe left (finger moves left, mx < 0) = screen moves left = next panel (index++)
      // Swipe right (finger moves right, mx > 0) = screen moves right = previous panel (index--)
      if (mx > threshold || vx > minVelocity) {
        setMainSlideIndex((i) => Math.max(0, i - 1));
      } else if (mx < -threshold || vx < -minVelocity) {
        setMainSlideIndex((i) => Math.min(aiEnabled ? 2 : 1, i + 1));
      }
    },
    {
      axis: 'x',
      pointer: { touch: true },
      touch: true,
      filter: () => isMobile,
    }
  );

  const panelsClassName =
    'panels' +
    (isMobile ? ` mobile-slide-${mainSlideIndex}` : '') +
    (isMobile && !aiEnabled ? ' mobile-ai-disabled' : '');

  return (
    <>
      <div
        id="user-settings-view"
        className="settings-view"
        hidden={!showUserSettings}
        aria-hidden={!showUserSettings}
      >
        <UserSettingsView
          user={user}
          onClose={onCloseSettings}
          onLogout={onLogout}
          onUserUpdated={onUserUpdated}
          onOrganizationChange={() => refetchOrganizationRef.current?.()}
        />
      </div>
      <div
        id="admin-settings-view"
        className={`settings-view ${DT.adminSettingsContainer}`}
        hidden={!showAdminSettings}
        aria-hidden={!showAdminSettings}
      >
        <AdminSettingsView user={user} onClose={onCloseSettings} />
      </div>
      <div
        className={`${panelsClassName} ${DT.mainPanels}`}
        id="main-panels"
        style={{ display: 'flex' }}
        {...(isMobile ? bindPanelsDrag() : {})}
      >
        <TaskListAndSchedule
          user={user}
          aiEnabled={aiEnabled}
          isMobile={isMobile}
          mainSlideIndex={mainSlideIndex}
          onMainSlideChange={applyMainSlide}
          refetchOrganizationRef={refetchOrganizationRef}
        />
      </div>
    </>
  );
}
