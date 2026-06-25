export const scheduleKeys = {
  all: ['schedule'] as const,
  core: () => [...scheduleKeys.all, 'core'] as const,
  day: (date: string) => [...scheduleKeys.all, 'day', date] as const,
  week: (anchorSunday: string, scope: string) =>
    [...scheduleKeys.all, 'week', anchorSunday, scope] as const,
  month: (from: string, to: string) => [...scheduleKeys.all, 'month', from, to] as const,
};
