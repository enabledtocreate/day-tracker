/**
 * Semantic class/id hooks for the Day Tracker UI (`dt-` prefix).
 * See `docs/UI_IDENTIFIERS.md`.
 */
/** `id` values — must remain unique per page */
export const DT_ID = {
  appShell: 'dt-app-shell',
  sessionLoading: 'dt-session-loading',
  panelTasksSchedule: 'dt-panel-tasks-schedule',
  panelSmartPlanning: 'dt-panel-smart-planning',
} as const;

/** `className` tokens — repeatable, additive */
export const DT = {
  appMount: 'dt-app-mount',
  page: 'dt-page',
  pageBootstrapping: 'dt-page-bootstrapping',
  loginRoot: 'dt-login-root',
  mainPanels: 'dt-main-panels',
  userSettingsContainer: 'dt-user-settings-container',
  adminSettingsContainer: 'dt-admin-settings-container',
  userSettingsInner: 'dt-user-settings-inner',
  adminSettingsInner: 'dt-admin-settings-inner',
  appBar: 'dt-app-bar',
  panelCompletedSlide: 'dt-panel-completed',
  panelMainColumn: 'dt-panel-main-column',
  scheduleColumn: 'dt-schedule-column',
  scheduleContent: 'dt-schedule-content',
  smartPlanningShell: 'dt-smart-planning-shell',
  taskNewRow: 'dt-task-new-row',
  taskListToolbar: 'dt-task-list-toolbar',
  taskListSections: 'dt-task-list-sections',
  taskListSection: 'dt-task-list-section',
  modalCompletedSummary: 'dt-modal-completed-summary',
} as const;
