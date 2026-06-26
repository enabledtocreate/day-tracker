'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { adoptServerDataRevision } from '@/lib/useDataSyncPoll';
import { getMonthRange } from '@/lib/scheduleDateUtils';
import {
  fetchDayScheduleBundle,
  fetchMonthSlots,
  fetchScheduleCoreData,
  fetchWeekScheduleBundle,
} from '@/lib/scheduleData/fetchers';
import { scheduleKeys } from '@/lib/scheduleData/keys';
import { clearScheduleQueriesForUser } from '@/lib/scheduleData/cache';
import type {
  DayScheduleBundle,
  MonthSlotsBundle,
  ScheduleCoreData,
  WeekScheduleBundle,
} from '@/lib/scheduleData/types';

export type ScheduleTab = 'today' | 'week' | 'calendar';

export type ScheduleDataSyncHandlers = {
  applyCoreData: (data: ScheduleCoreData) => void;
  applyDayBundle: (data: DayScheduleBundle) => void;
  applyWeekBundle: (data: WeekScheduleBundle) => void;
  applyMonthSlots: (data: MonthSlotsBundle) => void;
  setLoading: (loading: boolean) => void;
  setInitialDataReady: (ready: boolean) => void;
  setError: (error: string | null) => void;
};

export type UseScheduleDataQueriesOptions = {
  userId: number;
  viewDate: string;
  scheduleTab: ScheduleTab;
  calendarMonth: string;
  weekAnchorSunday: string;
  weekScope: '7-day' | 'weekday';
  isMobile: boolean;
  handlers: ScheduleDataSyncHandlers;
  lastDataRevisionRef: React.MutableRefObject<string | null>;
  initialLoadRef: React.MutableRefObject<boolean>;
};

export function useScheduleDataQueries({
  userId,
  viewDate,
  scheduleTab,
  calendarMonth,
  weekAnchorSunday,
  weekScope,
  isMobile,
  handlers,
  lastDataRevisionRef,
  initialLoadRef,
}: UseScheduleDataQueriesOptions) {
  const queryClient = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const prevUserIdRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevUserIdRef.current;
    if (prev != null && prev !== userId) {
      clearScheduleQueriesForUser(queryClient, prev);
    }
    prevUserIdRef.current = userId;
  }, [userId, queryClient]);

  const monthRange = useMemo(() => getMonthRange(calendarMonth), [calendarMonth]);
  const isWeekDesktop = scheduleTab === 'week' && !isMobile;

  const coreQuery = useQuery({
    queryKey: scheduleKeys.core(userId),
    queryFn: fetchScheduleCoreData,
    placeholderData: keepPreviousData,
  });

  const dayQuery = useQuery({
    queryKey: scheduleKeys.day(userId, viewDate),
    queryFn: () => fetchDayScheduleBundle(viewDate),
    enabled: scheduleTab === 'today',
    placeholderData: keepPreviousData,
  });

  const weekQuery = useQuery({
    queryKey: scheduleKeys.week(userId, weekAnchorSunday, weekScope),
    queryFn: () => fetchWeekScheduleBundle(weekAnchorSunday, weekScope),
    enabled: scheduleTab === 'week' && !isMobile,
    placeholderData: keepPreviousData,
  });

  const monthQuery = useQuery({
    queryKey: scheduleKeys.month(userId, monthRange.from, monthRange.to),
    queryFn: () => fetchMonthSlots(monthRange.from, monthRange.to),
    enabled: scheduleTab === 'calendar',
    placeholderData: keepPreviousData,
  });

  /** Prefetch adjacent views so tab switches feel instant. */
  useEffect(() => {
    const todayAnchor = weekAnchorSunday;
    void queryClient.prefetchQuery({
      queryKey: scheduleKeys.week(userId, todayAnchor, weekScope),
      queryFn: () => fetchWeekScheduleBundle(todayAnchor, weekScope),
    });
    const calRange = getMonthRange(viewDate);
    void queryClient.prefetchQuery({
      queryKey: scheduleKeys.month(userId, calRange.from, calRange.to),
      queryFn: () => fetchMonthSlots(calRange.from, calRange.to),
    });
  }, [queryClient, userId, weekAnchorSunday, weekScope, viewDate]);

  useEffect(() => {
    if (coreQuery.data) handlersRef.current.applyCoreData(coreQuery.data);
  }, [coreQuery.data]);

  useEffect(() => {
    if (scheduleTab === 'today' && dayQuery.data) handlersRef.current.applyDayBundle(dayQuery.data);
  }, [dayQuery.data, scheduleTab]);

  useEffect(() => {
    if (isWeekDesktop && weekQuery.data) handlersRef.current.applyWeekBundle(weekQuery.data);
  }, [weekQuery.data, isWeekDesktop, scheduleTab]);

  useEffect(() => {
    if (scheduleTab === 'calendar' && monthQuery.data) handlersRef.current.applyMonthSlots(monthQuery.data);
  }, [monthQuery.data, scheduleTab]);

  const activeViewFetching =
    scheduleTab === 'today'
      ? dayQuery.isFetching && !dayQuery.data
      : isWeekDesktop
        ? weekQuery.isFetching && !weekQuery.data
        : scheduleTab === 'calendar'
          ? monthQuery.isFetching && !monthQuery.data
          : false;

  const isBootstrapping = (coreQuery.isLoading && !coreQuery.data) || activeViewFetching;

  useEffect(() => {
    if (initialLoadRef.current && isBootstrapping) {
      handlersRef.current.setLoading(true);
    } else {
      handlersRef.current.setLoading(false);
      if (coreQuery.isSuccess) {
        handlersRef.current.setInitialDataReady(true);
        void adoptServerDataRevision(lastDataRevisionRef);
      }
    }
  }, [
    isBootstrapping,
    coreQuery.isSuccess,
    initialLoadRef,
    lastDataRevisionRef,
  ]);

  useEffect(() => {
    if (initialLoadRef.current && coreQuery.isSuccess && !isBootstrapping) {
      initialLoadRef.current = false;
    }
  }, [coreQuery.isSuccess, isBootstrapping, initialLoadRef]);

  useEffect(() => {
    const err = coreQuery.error ?? dayQuery.error ?? weekQuery.error ?? monthQuery.error;
    if (err) {
      handlersRef.current.setError(err instanceof Error ? err.message : String(err));
    }
  }, [coreQuery.error, dayQuery.error, weekQuery.error, monthQuery.error]);

  const reload = useCallback(
    async (opts?: { silent?: boolean } | unknown) => {
      const silent =
        typeof opts === 'object' &&
        opts !== null &&
        'silent' in opts &&
        (opts as { silent?: boolean }).silent === true;
      if (!silent) handlersRef.current.setError(null);
      await queryClient.invalidateQueries({ queryKey: scheduleKeys.all(userId) });
    },
    [queryClient, userId]
  );

  const reloadSilent = useCallback(() => {
    void reload({ silent: true });
  }, [reload]);

  const invalidateDay = useCallback(
    (date: string) => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.day(userId, date) });
    },
    [queryClient, userId]
  );

  const invalidateWeek = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: scheduleKeys.week(userId, weekAnchorSunday, weekScope),
    });
  }, [queryClient, userId, weekAnchorSunday, weekScope]);

  const invalidateCore = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.core(userId) });
  }, [queryClient, userId]);

  const invalidateFromSync = useCallback(
    async (hint?: { tasks?: boolean; slots?: boolean }) => {
      if (hint?.tasks !== false) {
        void queryClient.invalidateQueries({ queryKey: scheduleKeys.core(userId) });
      }
      if (hint?.slots !== false) {
        void queryClient.invalidateQueries({ queryKey: [...scheduleKeys.all(userId), 'day'] });
        void queryClient.invalidateQueries({ queryKey: [...scheduleKeys.all(userId), 'week'] });
        void queryClient.invalidateQueries({ queryKey: [...scheduleKeys.all(userId), 'month'] });
      }
    },
    [queryClient, userId]
  );

  const invalidateMonth = useCallback(
    (from: string, to: string) => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.month(userId, from, to) });
    },
    [queryClient, userId]
  );

  return {
    reload,
    reloadSilent,
    invalidateDay,
    invalidateWeek,
    invalidateMonth,
    invalidateCore,
    invalidateFromSync,
    queryClient,
    isFetching: coreQuery.isFetching || dayQuery.isFetching || weekQuery.isFetching || monthQuery.isFetching,
  };
}
