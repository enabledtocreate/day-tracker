import type {
  FavoriteFolder,
  ScheduledSlot,
  ScheduleBlock,
  Task,
  TaskLink,
  TaskListItem,
  TimeSettings,
} from '@/lib/api';

export type ScheduleCoreData = {
  tasks: Task[];
  commonTasks: Task[];
  settings: TimeSettings;
  organizationCategories: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
  organizationSubcategories: Array<{ id: number; category_id: number; name: string }>;
  organizationTags: Array<{ id: number; name: string; color?: string | null }>;
  organizationBlocks: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
  favoriteFolders: FavoriteFolder[];
  taskLinksByTaskId: Record<number, TaskLink[]>;
  taskListItemsByTaskId: Record<number, TaskListItem[]>;
  accomplishedTaskIds: Set<number>;
  scheduledTaskIdsFromTodayOnward: Set<number>;
};

export type DayScheduleBundle = {
  date: string;
  slots: ScheduledSlot[];
  scheduleBlocks: ScheduleBlock[];
  slotDayByRecordId: Record<number, string>;
  linksByTaskId: Record<number, TaskLink[]>;
  listItemsByTaskId: Record<number, TaskListItem[]>;
};

export type WeekScheduleBundle = {
  dates: string[];
  slots: ScheduledSlot[];
  slotDayByRecordId: Record<number, string>;
  linksByTaskId: Record<number, TaskLink[]>;
  listItemsByTaskId: Record<number, TaskListItem[]>;
};

export type MonthSlotsBundle = {
  from: string;
  to: string;
  byDate: Record<string, ScheduledSlot[]>;
};
