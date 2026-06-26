/** Master user id — scopes cache entries per account. */
export type ScheduleUserScope = number;

export const scheduleKeys = {
  all: (userId: ScheduleUserScope) => ['schedule', userId] as const,
  core: (userId: ScheduleUserScope) => [...scheduleKeys.all(userId), 'core'] as const,
  day: (userId: ScheduleUserScope, date: string) => [...scheduleKeys.all(userId), 'day', date] as const,
  week: (userId: ScheduleUserScope, anchorSunday: string, scope: string) =>
    [...scheduleKeys.all(userId), 'week', anchorSunday, scope] as const,
  month: (userId: ScheduleUserScope, from: string, to: string) =>
    [...scheduleKeys.all(userId), 'month', from, to] as const,
};
