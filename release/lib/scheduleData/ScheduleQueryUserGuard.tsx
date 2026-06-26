'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { clearScheduleQueriesForUser } from '@/lib/scheduleData/cache';

/**
 * Clears TanStack Query schedule cache when the signed-in user changes or logs out.
 * Mount inside ScheduleQueryProvider (e.g. from MainApp).
 */
export function ScheduleQueryUserGuard({
  userId,
}: {
  /** undefined = session still loading; null = logged out; number = active user */
  userId: number | null | undefined;
}) {
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (userId === undefined) return;

    const prev = prevUserIdRef.current;
    if (typeof prev === 'number' && prev !== userId) {
      clearScheduleQueriesForUser(queryClient, prev);
    }
    if (userId === null && typeof prev === 'number') {
      clearScheduleQueriesForUser(queryClient, prev);
    }

    prevUserIdRef.current = userId;
  }, [userId, queryClient]);

  return null;
}
