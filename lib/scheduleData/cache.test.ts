import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearAllScheduleQueries, clearScheduleQueriesForUser } from '@/lib/scheduleData/cache';
import { scheduleKeys } from '@/lib/scheduleData/keys';

describe('schedule query cache', () => {
  it('clearScheduleQueriesForUser removes only that account', () => {
    const client = new QueryClient();
    client.setQueryData(scheduleKeys.core(1), { tasks: [] });
    client.setQueryData(scheduleKeys.core(2), { tasks: [{ id: 1 }] });

    clearScheduleQueriesForUser(client, 1);

    expect(client.getQueryData(scheduleKeys.core(1))).toBeUndefined();
    expect(client.getQueryData(scheduleKeys.core(2))).toEqual({ tasks: [{ id: 1 }] });
  });

  it('clearAllScheduleQueries removes every account', () => {
    const client = new QueryClient();
    client.setQueryData(scheduleKeys.core(1), { tasks: [] });
    client.setQueryData(scheduleKeys.core(2), { tasks: [] });

    clearAllScheduleQueries(client);

    expect(client.getQueryData(scheduleKeys.core(1))).toBeUndefined();
    expect(client.getQueryData(scheduleKeys.core(2))).toBeUndefined();
  });
});
