'use client';

import { useState, useCallback, useRef } from 'react';
import type { AuthUser } from '@/lib/auth';
import { useMobileLayout } from '@/lib/layoutProfile';
import { MobileModeProvider } from '@/lib/mobileMode';
import { UserSettingsView } from '@/components/UserSettingsView';
import { AdminSettingsView } from '@/components/AdminSettingsView';
import { TaskListAndSchedule } from '@/components/TaskListAndSchedule';
import { DT } from '@/lib/uiIdentifiers';

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
  const isMobile = useMobileLayout();
  const [mainSlideIndex, setMainSlideIndex] = useState(1); // 0=Completed, 1=Tasks, 2=AI
  const refetchOrganizationRef = useRef<(() => void) | null>(null);

  const applyMainSlide = useCallback(
    (index: number) => {
      const maxIndex = aiEnabled ? 2 : 1;
      setMainSlideIndex(Math.max(0, Math.min(maxIndex, index)));
    },
    [aiEnabled]
  );

  // Panel swipes are deliberately gone until Step 4/5 install the new coordinator wiring.
  // Use the mobile tab UI or explicit chrome to switch panels in the meantime.

  const panelsClassName =
    'panels' +
    (isMobile ? ` mobile-slide-${mainSlideIndex}` : '') +
    (isMobile && !aiEnabled ? ' mobile-ai-disabled' : '');

  return (
    <MobileModeProvider>
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
        data-layout={isMobile ? 'mobile' : 'desktop'}
        className={`${panelsClassName} ${DT.mainPanels}`}
        id="main-panels"
        style={{ display: 'flex' }}
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
    </MobileModeProvider>
  );
}
