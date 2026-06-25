'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/** Stale-while-revalidate: show cached view data instantly; refetch after 60s. */
export const SCHEDULE_QUERY_STALE_MS = 60_000;
export const SCHEDULE_QUERY_GC_MS = 30 * 60_000;

function makeScheduleQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: SCHEDULE_QUERY_STALE_MS,
        gcTime: SCHEDULE_QUERY_GC_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });
}

export function ScheduleQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeScheduleQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
