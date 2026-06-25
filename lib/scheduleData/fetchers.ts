import { api } from '@/lib/api';
import type { ScheduledSlot, TaskLink, TaskListItem } from '@/lib/api';
import { bucketLayoutFromSettings } from '@/lib/taskBuckets';
import { buildWeekDates, todayLocalYmd } from '@/lib/scheduleDateUtils';
import type { DayScheduleBundle, MonthSlotsBundle, ScheduleCoreData, WeekScheduleBundle } from '@/lib/scheduleData/types';

const withExt = 'links,list_items,organization';

function mergeLinksAndListItems(
  sources: Array<{ linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>
): {
  taskLinksByTaskId: Record<number, TaskLink[]>;
  taskListItemsByTaskId: Record<number, TaskListItem[]>;
} {
  const taskLinksByTaskId: Record<number, TaskLink[]> = {};
  const taskListItemsByTaskId: Record<number, TaskListItem[]> = {};
  for (const res of sources) {
    if (res.linksByTaskId) Object.assign(taskLinksByTaskId, res.linksByTaskId);
    if (res.listItemsByTaskId) {
      for (const [tid, arr] of Object.entries(res.listItemsByTaskId)) {
        const id = Number(tid);
        taskListItemsByTaskId[id] = (taskListItemsByTaskId[id] ?? []).concat(arr);
      }
    }
  }
  const sortedListItems: Record<number, TaskListItem[]> = {};
  Object.keys(taskListItemsByTaskId).forEach((tid) => {
    const arr = taskListItemsByTaskId[Number(tid)]!;
    const seen = new Set<number>();
    sortedListItems[Number(tid)] = arr
      .filter((i) => {
        if (seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      })
      .sort((a, b) => a.order_index - b.order_index);
  });
  return { taskLinksByTaskId, taskListItemsByTaskId: sortedListItems };
}

export async function fetchScheduleCoreData(): Promise<ScheduleCoreData> {
  await api.dataIntegrity.ensure().catch(() => {});

  const todayStr = todayLocalYmd();
  const future = new Date(todayStr + 'T12:00:00');
  future.setFullYear(future.getFullYear() + 1);
  const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

  const [allTasksRes, accomplishedRes, scheduledRangeRes, settingsRes, organizationRes, favoriteFoldersRes] =
    await Promise.all([
      api.tasks.list({ with: withExt }),
      api.accomplished.listAll({ with: withExt }),
      api.slots.listByDateRange(todayStr, futureStr),
      api.settings.get(),
      api.organization.list().catch(() => ({ categories: [], subcategories: [], tags: [], blocks: [] })),
      api.favoriteFolders.list().catch(() => ({ folders: [] as import('@/lib/api').FavoriteFolder[] })),
    ]);

  const bucketsForFetch = bucketLayoutFromSettings(settingsRes);
  const bucketTaskRes = await Promise.all(
    bucketsForFetch.map((b) => api.tasks.list({ list_state: b.id, with: withExt }))
  );

  const allTasks = allTasksRes.tasks ?? [];
  const { taskLinksByTaskId, taskListItemsByTaskId } = mergeLinksAndListItems([
    allTasksRes,
    ...bucketTaskRes,
    accomplishedRes,
  ]);

  const permanentlyCompletedIds = new Set<number>();
  Object.entries(accomplishedRes.byDate ?? {}).forEach(([day, arr]) => {
    if (day < todayStr) {
      arr.forEach((a) => permanentlyCompletedIds.add(a.task_id));
    }
  });

  const schedIds = new Set<number>();
  Object.values(scheduledRangeRes.byDate ?? {}).forEach((arr: ScheduledSlot[]) =>
    arr.forEach((s) => schedIds.add(s.task_id))
  );

  return {
    tasks: allTasks,
    commonTasks: allTasks.filter((t) => !!t.is_common && t.parent_id == null),
    settings: settingsRes,
    organizationCategories: organizationRes.categories ?? [],
    organizationSubcategories: organizationRes.subcategories ?? [],
    organizationTags: organizationRes.tags ?? [],
    organizationBlocks: organizationRes.blocks ?? [],
    favoriteFolders: favoriteFoldersRes.folders ?? [],
    taskLinksByTaskId,
    taskListItemsByTaskId,
    accomplishedTaskIds: permanentlyCompletedIds,
    scheduledTaskIdsFromTodayOnward: schedIds,
  };
}

export async function fetchDayScheduleBundle(date: string): Promise<DayScheduleBundle> {
  const todayStr = todayLocalYmd();
  if (date === todayStr) await api.rollover(date);
  const day = await api.day.getOrCreate(date);
  const [slotRes, scheduleBlockRes] = await Promise.all([
    api.slots.list(day.id, { with: 'links,list_items' }),
    api.scheduleBlocks.list(day.id).catch(() => ({ blocks: [] })),
  ]);
  const slotDayByRecordId: Record<number, string> = {};
  slotRes.slots.forEach((s) => {
    const drId = Number(s.day_record_id);
    if (Number.isFinite(drId)) slotDayByRecordId[drId] = date;
  });
  const { taskLinksByTaskId, taskListItemsByTaskId } = mergeLinksAndListItems([slotRes]);
  return {
    date,
    slots: slotRes.slots,
    scheduleBlocks: scheduleBlockRes.blocks ?? [],
    slotDayByRecordId,
    linksByTaskId: taskLinksByTaskId,
    listItemsByTaskId: taskListItemsByTaskId,
  };
}

export async function fetchWeekScheduleBundle(
  anchorSunday: string,
  scope: '7-day' | 'weekday'
): Promise<WeekScheduleBundle> {
  const weekDatesList = buildWeekDates(anchorSunday, scope);
  const todayStr = todayLocalYmd();
  if (weekDatesList.includes(todayStr)) await api.rollover(todayStr);

  const results = await Promise.all(
    weekDatesList.map(async (ds) => {
      const dr = await api.day.getOrCreate(ds);
      return api.slots.list(dr.id, { with: 'links,list_items' });
    })
  );

  const mergedSlots: ScheduledSlot[] = [];
  const slotDayByRecordId: Record<number, string> = {};
  const linkSources: Array<{ linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }> =
    [];

  for (let i = 0; i < results.length; i++) {
    const ds = weekDatesList[i]!;
    const r = results[i]!;
    for (const s of r.slots) {
      mergedSlots.push(s);
      const drId = Number(s.day_record_id);
      if (Number.isFinite(drId)) slotDayByRecordId[drId] = ds;
    }
    linkSources.push(r);
  }

  const { taskLinksByTaskId, taskListItemsByTaskId } = mergeLinksAndListItems(linkSources);

  return {
    dates: weekDatesList,
    slots: mergedSlots,
    slotDayByRecordId,
    linksByTaskId: taskLinksByTaskId,
    listItemsByTaskId: taskListItemsByTaskId,
  };
}

export async function fetchMonthSlots(from: string, to: string): Promise<MonthSlotsBundle> {
  const r = await api.slots.listByDateRange(from, to);
  return { from, to, byDate: r.byDate ?? {} };
}
