import type { QueryClient } from '@tanstack/react-query';
import { scheduleKeys } from '@/lib/scheduleData/keys';

/** Drop all schedule queries for one account (e.g. on logout or account switch). */
export function clearScheduleQueriesForUser(queryClient: QueryClient, userId: number): void {
  queryClient.removeQueries({ queryKey: scheduleKeys.all(userId) });
}

/** Drop every schedule query regardless of account. */
export function clearAllScheduleQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: ['schedule'] });
}
