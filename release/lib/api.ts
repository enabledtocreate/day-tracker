/**
 * API client for Day Tracker PHP backend.
 * Uses getBaseUrl() so the app works at the domain root or in a subfolder (e.g. /DayTracker/).
 */
import { getBaseUrl } from './getBaseUrl';
import type {
  AiAssistantResponse,
  AiChatRequestBody,
  AiContextResolveRequestBody,
  AiContextResolveResponse,
  AiMessageRow,
  AiThreadSummary,
} from './aiTypes';

type ApiRequestInit = Omit<RequestInit, 'body'> & { method?: string; body?: unknown };

async function request<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { method = 'GET', body, ...rest } = options;
  const headers: Record<string, string> = {
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  if (body != null && typeof body === 'object' && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  const base = getBaseUrl();
  const res = await fetch(base + path, {
    ...rest,
    method,
    headers,
    credentials: 'include',
    body: body != null && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = JSON.parse(text);
      if (j && typeof j.error === 'string') msg = j.error;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

export type Priority = 'commitment' | 'high' | 'medium' | 'low';

export type ListStyle = 'bullet' | 'checklist';

export interface Task {
  id: number;
  title: string;
  /** Priority slug: built-in `commitment`|`high`|`medium`|`low`, or custom ids from `priority_layout_json`. */
  priority: string;
  recurring: boolean;
  recurrence_rule?: string | null;
  parent_id: number | null;
  group_order?: number;
  created_at: string;
  updated_at?: string | null;
  due_date?: string | null;
  /** Bucket slug: default `unassigned`|`pending`, or custom ids from `bucket_layout_json`. */
  list_state?: string;
  list_style?: ListStyle;
  /** True when task is a Common Tasks template (orange border); scheduling uses a copy. */
  is_common?: boolean;
  /**
   * Opt-in: at end of day, any uncompleted slots for this task on the day that just
   * ended are auto-marked complete by the client EOD runner. See
   * `.apm/_WORKSPACE/TODO-mobile.md §0.7 / §0.9 Step 8`.
   */
  auto_complete_eod?: boolean;
  /** Favorites subfolder (common root tasks only); null = unfiled. */
  favorite_folder_id?: number | null;
  category_id?: number | null;
  subcategory_id?: number | null;
  tag_ids?: number[];
  /** Per-task auto-raise (rollover applies daily). */
  auto_priority_enabled?: number | boolean;
  auto_priority_mode?: 'days' | 'due_date';
  auto_priority_days_per_step?: number;
  auto_priority_anchor_date?: string | null;
  /** Default organization block type for Auto Block scheduling. */
  default_block_id?: number | null;
  /** Duration on schedule in increment steps (default 1). */
  default_duration_intervals?: number;
}

export interface TaskLink {
  id: number;
  task_id: number;
  url: string;
  description: string;
}

export interface TaskListItem {
  id: number;
  task_id: number;
  content: string;
  order_index: number;
  completed?: number;
}

export interface DayRecord {
  id: number;
  date: string;
}

export interface ScheduledSlot {
  id: number;
  day_record_id: number;
  task_id: number;
  start_time: string | null;
  end_time: string | null;
  completed: number;
  order_index: number;
  title?: string;
  priority?: string;
  recurring?: number;
  parent_id?: number | null;
  list_style?: ListStyle;
  has_list?: number;
  /** True when slot is a recurring occurrence on this day (no real slot row); show in orange. */
  is_recurring_occurrence?: boolean;
  updated_at?: string | null;
}

export interface ScheduleBlock {
  id: number;
  day_record_id: number;
  block_id: number;
  start_time: string;
  end_time: string;
  block_name?: string;
  block_color?: string | null;
  /** Lucide icon name from task_blocks.icon */
  block_icon?: string | null;
}

export interface FavoriteFolder {
  id: number;
  name: string;
  sort_order: number;
}

export interface TimeSettings {
  start_hour: number;
  end_hour: number;
  increment_value: number;
  increment_unit: 'min' | 'hr';
  /** IANA timezone for iCal/schedule display (e.g. America/Los_Angeles). Empty = use browser timezone. */
  timezone?: string;
  /** Desktop: `stacked` = tasks above schedule (default); `split` = task column left, schedule right. */
  task_schedule_layout?: 'stacked' | 'split';
  /** `dark` (default) or `light` day mode for the main UI shell. */
  ui_theme?: 'dark' | 'light';
  /** JSON object: per-priority { label, icon, color? } for task list & schedule UI (DB key `priority_theme_json`). */
  priority_theme_json?: string | null;
  /** JSON v2: `{ version:2, mode:"custom", priorities:[{id,label,icon,color?}] }` — arbitrary priority slugs on tasks. */
  priority_layout_json?: string | null;
  /** JSON { unassigned, pending } section titles (DB key `bucket_labels_json`). */
  bucket_labels_json?: string | null;
  /** JSON v2: `{ version:2, mode:"custom", buckets:[{id,label}] }` — arbitrary list buckets. */
  bucket_layout_json?: string | null;
  /** When scheduling with “increase priority automatically”, set task priority to this slug (default high when present). */
  due_auto_priority_target?: string | null;
  /** Global auto-priority algorithm (Schedule Settings). Per-task only toggles participation. */
  auto_priority_default_mode?: 'days' | 'due_date';
  auto_priority_default_days_per_step?: number;
  /** Open-Meteo latitude / longitude for schedule weather lane. */
  weather_latitude?: number | null;
  weather_longitude?: number | null;
  /** Display label for weather location (city search or "My location"). */
  weather_location_label?: string | null;
  /** Temperature display unit for weather lane (default Celsius). */
  weather_temp_unit?: 'C' | 'F' | string;
  /** Hide category / subcategory line on schedule time blocks. */
  schedule_hide_category_subcategory?: boolean;
  /** Hide tag pills on schedule time blocks. */
  schedule_hide_tags?: boolean;
  /** Mobile-only: simplified read-only schedule view (see TODO-mobile.md §0.6). */
  mobile_schedule_glance?: boolean;
  /** JSON bulk import / quick-add preferences. */
  bulk_import_json?: string | null;
  /** JSON contact-link open preferences (email/phone handlers, Gmail slot). */
  contact_link_json?: string | null;
}

export type BulkImportResult = {
  ok: boolean;
  imported?: number;
  created?: number;
  validated?: number;
  errors: string[];
  cell_errors?: Record<number, Record<string, string>>;
  grid_headers?: string[];
  grid_rows?: Array<Record<string, string>>;
};

export interface GeocodeResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
}

export interface WeatherForecastResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    weather_code: (number | null)[];
  };
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

export interface IcalSubscriptionRow {
  id: number;
  feed_url: string;
  created_at: string;
  enabled: boolean;
  /** User-defined label shown on the schedule (optional). */
  display_name?: string | null;
}

export interface IcalFeedEvent {
  id?: number;
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  subscription_id?: number;
  user_completed?: boolean;
  event_type?: 'event' | 'todo';
}

/** Per-subscription outcome from ical_events.php (multi-calendar sync visibility). */
export interface IcalSubscriptionSyncEntry {
  subscription_id: number;
  attempted: boolean;
  skip_reason?: string;
  trigger_reason?: string;
  feed_errors?: Array<{ feed_url: string; message: string }>;
}

export const api = {
  tasks: {
    list: (params?: { list_state?: string; common?: boolean; view?: 'incomplete'; day?: string; with?: string }) => {
      const q = new URLSearchParams();
      if (params?.list_state) q.set('list_state', params.list_state);
      if (params?.common) q.set('common', '1');
      if (params?.view) q.set('view', params.view);
      if (params?.day) q.set('day', params.day);
      if (params?.with) q.set('with', params.with);
      const suffix = q.toString() ? '?' + q.toString() : '';
      return request<{ tasks: Task[]; incompleteRootIds?: number[]; linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>('api/tasks.php' + suffix);
    },
    create: (data: {
      title?: string;
      priority?: string;
      recurring?: boolean;
      parent_id?: number | null;
      list_style?: ListStyle;
      is_common?: boolean;
      favorite_folder_id?: number | null;
      copy_from?: number;
      list_state?: string;
      due_date?: string | null;
      auto_complete_eod?: boolean;
      default_block_id?: number | null;
      default_duration_intervals?: number;
    }) => request<Task & { id: number }>('api/tasks.php', { method: 'POST', body: data }),
    update: (data: {
      id: number;
      title?: string;
      priority?: string;
      recurring?: boolean;
      recurrence_rule?: string | null;
      parent_id?: number | null;
      group_order?: number;
      due_date?: string | null;
      list_state?: string;
      list_style?: ListStyle;
      is_common?: boolean;
      favorite_folder_id?: number | null;
      category_id?: number | null;
      subcategory_id?: number | null;
      tag_ids?: number[];
      auto_priority_enabled?: boolean;
      auto_complete_eod?: boolean;
      default_block_id?: number | null;
      default_duration_intervals?: number;
    }) =>
      request<{ ok: boolean; task?: Task }>('api/tasks.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/tasks.php?id=${id}`, { method: 'DELETE' }),
  },
  tasksBulk: {
    import: (rows: Array<Record<string, string>>, validateOnly?: boolean) =>
      request<BulkImportResult>('api/tasks_bulk_import.php', {
        method: 'POST',
        body: { rows, validate_only: !!validateOnly },
      }),
    quickAdd: (payload: {
      titles: string[];
      list_state?: string;
      priority?: string;
      due_date?: string | null;
      category_id?: number | null;
      subcategory_id?: number | null;
      tag_ids?: number[];
      auto_priority_enabled?: boolean;
      auto_complete_eod?: boolean;
      default_block_id?: number | null;
      default_duration_intervals?: number;
    }) =>
      request<{ ok: boolean; created: number }>('api/tasks_quick_add.php', {
        method: 'POST',
        body: payload,
      }),
  },
  day: {
    getOrCreate: (date: string) => request<DayRecord>(`api/day.php?date=${encodeURIComponent(date)}`),
  },
  rollover: (date: string) => request<{ ok: boolean }>(`api/rollover.php?date=${encodeURIComponent(date)}`, { method: 'POST' }),
  slots: {
    list: (dayId: number, params?: { with?: string }) => {
      const q = new URLSearchParams({ day_id: String(dayId) });
      if (params?.with) q.set('with', params.with);
      return request<{ slots: ScheduledSlot[]; linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>(`api/slots.php?${q.toString()}`);
    },
    get: (id: number) =>
      request<{ slot: (ScheduledSlot & { parent_id?: number | null }) | null; childSlots: Array<{ id: number; task_id: number; completed: number; start_time?: string; end_time?: string }> }>(`api/slots.php?id=${id}`),
    listByDateRange: (fromDate: string, toDate: string, params?: { with?: string }) => {
      const q = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (params?.with) q.set('with', params.with);
      return request<{ byDate: Record<string, ScheduledSlot[]>; linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>(`api/slots.php?${q.toString()}`);
    },
    create: (data: { day_record_id: number; task_id: number; start_time?: string | null; end_time?: string | null; order_index?: number; completed?: boolean }) =>
      request<ScheduledSlot & { id: number }>('api/slots.php', { method: 'POST', body: data }),
    completeOccurrence: (taskId: number, date: string, startTime?: string, endTime?: string) =>
      request<ScheduledSlot & { id: number }>('api/slots.php', {
        method: 'POST',
        body: {
          task_id: taskId,
          date,
          complete_occurrence: true,
          ...(startTime ? { start_time: startTime } : {}),
          ...(endTime ? { end_time: endTime } : {}),
        },
      }),
    markOccurrenceOverride: (taskId: number, date: string, overrideTaskId?: number) =>
      request<{ ok: boolean }>('api/slots.php', {
        method: 'POST',
        body: {
          task_id: taskId,
          date,
          mark_occurrence_override: true,
          ...(overrideTaskId && overrideTaskId > 0 ? { override_task_id: overrideTaskId } : {}),
        },
      }),
    update: (data: { id: number; completed?: boolean; start_time?: string | null; end_time?: string | null; order_index?: number; parent_id?: number | null }) => {
      const body: Record<string, unknown> = { id: data.id };
      if (data.completed !== undefined) body.completed = data.completed ? 1 : 0;
      if (data.start_time !== undefined) body.start_time = data.start_time;
      if (data.end_time !== undefined) body.end_time = data.end_time;
      if (data.order_index !== undefined) body.order_index = data.order_index;
      if (data.parent_id !== undefined) body.parent_id = data.parent_id;
      return request<{ ok: boolean }>('api/slots.php', { method: 'PATCH', body });
    },
    delete: (id: number) => request<{ ok: boolean }>(`api/slots.php?id=${id}`, { method: 'DELETE' }),
  },
  scheduleBlocks: {
    list: (dayId: number) =>
      request<{ blocks: ScheduleBlock[] }>(`api/schedule_blocks.php?day_id=${encodeURIComponent(String(dayId))}`),
    listByDateRange: (fromDate: string, toDate: string) =>
      request<{ byDate: Record<string, ScheduleBlock[]> }>(
        `api/schedule_blocks.php?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`
      ),
    create: (data: { day_record_id: number; block_id: number; start_time: string; end_time: string }) =>
      request<ScheduleBlock>('api/schedule_blocks.php', { method: 'POST', body: data }),
    update: (data: { id: number; block_id?: number; start_time?: string; end_time?: string }) =>
      request<{ ok: boolean }>('api/schedule_blocks.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/schedule_blocks.php?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
  },
  links: {
    list: (taskId: number) => request<{ links: TaskLink[] }>(`api/links.php?task_id=${taskId}`),
    add: (data: { task_id: number; url: string; description?: string }) =>
      request<TaskLink & { id: number }>('api/links.php', { method: 'POST', body: data }),
    update: (data: { id: number; url?: string; description?: string }) =>
      request<{ ok: boolean }>('api/links.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/links.php?id=${id}`, { method: 'DELETE' }),
  },
  taskListItems: {
    list: (taskId: number) => request<{ items: TaskListItem[] }>(`api/task_list_items.php?task_id=${taskId}`),
    create: (data: { task_id: number; content?: string; order_index?: number; completed?: number }) =>
      request<TaskListItem>('api/task_list_items.php', { method: 'POST', body: data }),
    update: (data: { id: number; content?: string; order_index?: number; completed?: number }) =>
      request<{ ok: boolean }>('api/task_list_items.php', { method: 'PATCH', body: data }),
    reorder: (taskId: number, order: number[]) =>
      request<{ ok: boolean }>('api/task_list_items.php', { method: 'PATCH', body: { task_id: taskId, order } }),
    delete: (id: number) => request<{ ok: boolean }>(`api/task_list_items.php?id=${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request<TimeSettings>('api/settings.php'),
    update: (data: Partial<TimeSettings>) => {
      const keys = [
        'start_hour',
        'end_hour',
        'increment_value',
        'increment_unit',
        'timezone',
        'task_schedule_layout',
        'priority_theme_json',
        'priority_layout_json',
        'bucket_labels_json',
        'bucket_layout_json',
        'due_auto_priority_target',
        'auto_priority_default_mode',
        'auto_priority_default_days_per_step',
        'ui_theme',
        'weather_latitude',
        'weather_longitude',
        'weather_location_label',
        'weather_temp_unit',
        'schedule_hide_category_subcategory',
        'schedule_hide_tags',
        'mobile_schedule_glance',
        'bulk_import_json',
        'contact_link_json',
      ] as const;
      const body: Record<string, unknown> = {};
      for (const key of keys) {
        if (data[key] !== undefined) body[key] = data[key];
      }
      return request<{ ok: boolean }>('api/settings.php', { method: 'PATCH', body });
    },
  },
  weather: {
    get: (lat: number, lon: number, from: string, to: string, tempUnit?: 'C' | 'F') => {
      const q = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        from,
        to,
      });
      if (tempUnit === 'F') q.set('temp_unit', 'fahrenheit');
      return request<WeatherForecastResponse>(`api/weather.php?${q.toString()}`);
    },
  },
  geocode: {
    search: (query: string) =>
      request<{ results: GeocodeResult[] }>(`api/geocode.php?q=${encodeURIComponent(query)}`),
  },
  accomplished: {
    listByDate: (date: string) => request<{ accomplished: Array<{ id: number; task_id: number; title: string; completed_at: string }> }>(`api/accomplished.php?date=${encodeURIComponent(date)}`),
    listAll: (params?: { with?: string }) => {
      const q = new URLSearchParams({ list_all: '1' });
      if (params?.with) q.set('with', params.with);
      return request<{ byDate: Record<string, Array<{ id: number; day_record_id: number; task_id: number; title: string; start_time?: string; completed_at: string }>>; linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>(`api/accomplished.php?${q.toString()}`);
    },
    /** Per-day rollup of completed scheduled time by category / subcategory (from slot start/end). */
    summaryByOrganization: (params?: { from_date?: string; to_date?: string }) => {
      const q = new URLSearchParams({ summary_org: '1' });
      if (params?.from_date) q.set('from_date', params.from_date);
      if (params?.to_date) q.set('to_date', params.to_date);
      return request<{
        days: Array<{
          date: string;
          rows: Array<{
            category: string;
            subcategory: string | null;
            hours: number;
            titles: string[];
            tasks: Array<{
              task_id: number;
              title: string;
              hours: number;
              links: TaskLink[];
              list_items: TaskListItem[];
              tags?: Array<{ id: number; name: string; color?: string | null }>;
              /**
               * Names of schedule-strip organization blocks that contained at
               * least one of this task's completed slots on this date. Empty
               * when the task's slot(s) didn't fall inside any block.
               */
              block_names?: string[];
            }>;
          }>;
        }>;
        /** Scheduled organization blocks (time strip), hours per block type per calendar day. */
        block_days: Array<{ date: string; rows: Array<{ block_name: string; hours: number }>; total_hours: number }>;
      }>(`api/accomplished.php?${q.toString()}`);
    },
  },
  debug: {
    clearTasks: () => request<{ ok: boolean }>('api/debug.php', { method: 'POST', body: { action: 'clear_tasks' } }),
    resetAll: () => request<{ ok: boolean }>('api/debug.php', { method: 'POST', body: { action: 'reset_all' } }),
  },
  dataIntegrity: {
    /** Run verification/coercion rules on load; fixes invalid data (e.g. zero-duration slots). */
    ensure: () =>
      request<{ ok: boolean; fixed: Record<string, Array<{ id: number; before: Record<string, string>; after: Record<string, string> }>> }>('api/data_integrity.php'),
  },
  favoriteFolders: {
    list: () => request<{ folders: FavoriteFolder[] }>('api/favorite_folders.php'),
    create: (data: { name: string }) =>
      request<{ id: number; name: string; sort_order: number }>('api/favorite_folders.php', { method: 'POST', body: data }),
    update: (data: { id: number; name?: string; sort_order?: number }) =>
      request<{ ok: boolean; folder?: FavoriteFolder }>('api/favorite_folders.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/favorite_folders.php?id=${id}`, { method: 'DELETE' }),
  },
  organization: {
    list: () =>
      request<{
        categories: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
        subcategories: Array<{ id: number; category_id: number; name: string }>;
        tags: Array<{ id: number; name: string; color?: string | null }>;
        blocks: Array<{ id: number; name: string; color?: string | null; icon?: string | null }>;
      }>('api/organization.php'),
    createCategory: (data: { name: string; color?: string | null; icon?: string | null }) =>
      request<{ id: number; name: string; color?: string | null; icon?: string | null }>('api/organization.php', { method: 'POST', body: { type: 'category', ...data } }),
    createSubcategory: (data: { category_id: number; name: string }) =>
      request<{ id: number; category_id: number; name: string }>('api/organization.php', { method: 'POST', body: { type: 'subcategory', ...data } }),
    createTag: (data: { name: string; color?: string | null }) =>
      request<{ id: number; name: string; color?: string | null }>('api/organization.php', { method: 'POST', body: { type: 'tag', ...data } }),
    createBlock: (data: { name: string; color?: string | null; icon?: string | null }) =>
      request<{ id: number; name: string; color?: string | null; icon?: string | null }>('api/organization.php', { method: 'POST', body: { type: 'block', ...data } }),
    updateCategory: (id: number, data: { name?: string; color?: string | null; icon?: string | null }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'category', id, ...data } }),
    updateSubcategory: (id: number, data: { name?: string; category_id?: number }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'subcategory', id, ...data } }),
    updateTag: (id: number, data: { name?: string; color?: string | null }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'tag', id, ...data } }),
    updateBlock: (id: number, data: { name?: string; color?: string | null; icon?: string | null }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'block', id, ...data } }),
    deleteCategory: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=category&id=${id}`, { method: 'DELETE' }),
    deleteSubcategory: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=subcategory&id=${id}`, { method: 'DELETE' }),
    deleteTag: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=tag&id=${id}`, { method: 'DELETE' }),
    deleteBlock: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=block&id=${id}`, { method: 'DELETE' }),
  },
  chat: {
    send: (body: AiChatRequestBody) =>
      request<AiAssistantResponse>('api/chat.php', {
        method: 'POST',
        body: { schemaVersion: 1, ...body },
      }),
  },
  ai: {
    contextResolve: (body: AiContextResolveRequestBody) =>
      request<AiContextResolveResponse>('api/ai/context_resolve.php', { method: 'POST', body }),
    threads: {
      list: () => request<{ threads: AiThreadSummary[] }>('api/ai/threads.php'),
      get: (id: number) =>
        request<{ thread: AiThreadSummary; messages: AiMessageRow[] }>(`api/ai/threads.php?id=${encodeURIComponent(String(id))}`),
      create: (title?: string) =>
        request<{ thread: AiThreadSummary }>('api/ai/threads.php', {
          method: 'POST',
          body: { action: 'create', ...(title !== undefined && title !== '' ? { title } : {}) },
        }),
      append: (threadId: number, role: 'user' | 'assistant', payload: Record<string, unknown>) =>
        request<{ message: { id: number; thread_id: number; role: string } }>('api/ai/threads.php', {
          method: 'POST',
          body: { action: 'append', thread_id: threadId, role, payload },
        }),
      delete: (id: number) =>
        request<{ ok: boolean; deleted: number }>(`api/ai/threads.php?id=${encodeURIComponent(String(id))}`, {
          method: 'DELETE',
        }),
    },
  },
  icalFeed: {
    getUrl: () => request<{ token: string }>('api/ical_feed.php'),
  },
  icalSubscriptions: {
    list: () =>
      request<{ subscriptions: IcalSubscriptionRow[] }>('api/ical_subscriptions.php'),
    add: (feedUrl: string) => request<{ id: number; feed_url: string }>('api/ical_subscriptions.php', { method: 'POST', body: { feed_url: feedUrl } }),
    setEnabled: (id: number, enabled: boolean) =>
      request<{ ok: boolean }>('api/ical_subscriptions.php', { method: 'PATCH', body: { id, enabled } }),
    setDisplayName: (id: number, displayName: string) =>
      request<{ ok: boolean }>('api/ical_subscriptions.php', { method: 'PATCH', body: { id, display_name: displayName } }),
    setFeedUrl: (id: number, feedUrl: string) =>
      request<{ ok: boolean }>('api/ical_subscriptions.php', { method: 'PATCH', body: { id, feed_url: feedUrl } }),
    delete: (id: number) => request<{ ok: boolean }>(`api/ical_subscriptions.php?id=${id}`, { method: 'DELETE' }),
    preview: (id: number, parse = true) =>
      request<{
        content: string;
        truncated?: boolean;
        parse_range?: { from: string; to: string };
        parsed_events?: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }>;
        raw?: string;
      } | { error: string }>(
        `api/ical_subscriptions.php?preview=1&id=${id}${parse ? '&parse=1' : ''}`
      ),
    getDownloadUrl: (id: number) => getBaseUrl() + `api/ical_subscriptions.php?preview=1&id=${id}&download=1`,
    getStreamUrl: (id: number) => getBaseUrl() + `api/ical_subscriptions.php?stream=1&id=${id}`,
  },
  icalEvents: {
    getConfig: () =>
      request<{
        interval_fetch?: boolean;
        interval_minutes?: number;
        use_cron_job?: boolean;
        client_triggers_sync?: boolean;
      }>('api/ical_events.php?config=1'),
    get: (fromDate: string, toDate: string, options?: { force_sync?: boolean; sync_if_stale?: boolean }) => {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (options?.force_sync) params.set('force_sync', '1');
      if (options?.sync_if_stale) params.set('sync_if_stale', '1');
      return request<{
        events: IcalFeedEvent[];
        errors?: Array<{ feed_url: string; message: string }>;
        subscription_sync?: IcalSubscriptionSyncEntry[];
      }>(`api/ical_events.php?${params.toString()}`);
    },
    setCompleted: (id: number, userCompleted: boolean) =>
      request<{ ok: boolean }>('api/ical_events.php', { method: 'PATCH', body: { id, user_completed: userCompleted } }),
  },
  icalExcluded: {
    list: () =>
      request<{ excluded: Array<{ uid: string; title: string }> }>('api/ical_excluded.php'),
    add: (uid: string, title: string) =>
      request<{ ok: boolean }>('api/ical_excluded.php', { method: 'POST', body: { uid, title: title || 'Event' } }),
    remove: (uid: string) =>
      request<{ ok: boolean }>('api/ical_excluded.php', { method: 'PATCH', body: { remove_uid: uid } }),
  },
  user: {
    get: () => request<{ user: { id: number; username: string; db_name: string; is_admin: boolean; sso: Array<{ id?: number; provider: string; email: string }> } }>('api/user.php'),
    changePassword: (password: string) => request<{ ok: boolean }>('api/user.php', { method: 'PATCH', body: { password } }),
    disconnectSso: (ssoId: number, newPassword: string) =>
      request<{ ok: boolean }>('api/user.php', { method: 'PATCH', body: { disconnect_sso: ssoId, new_password: newPassword } }),
  },
  admin: {
    getSettings: () =>
      request<{
        debug: boolean;
        ai_enabled: boolean;
        ical_fetch_timeout: number;
        ical_subscriptions_enabled?: boolean;
        ical_save_folder?: string;
        ical_save_folder_local?: string;
        ical_save_last_fetch?: boolean;
        ical_interval_fetch?: boolean;
        ical_sync_interval_minutes?: number;
        ical_event_range_days?: number;
        ical_omit_uids?: string;
        ical_use_cron_job?: boolean;
      }>('api/admin.php?action=settings'),
    setDebug: (debug: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { debug } }),
    setAiEnabled: (aiEnabled: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ai_enabled: aiEnabled } }),
    setIcalFetchTimeout: (seconds: number) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_fetch_timeout: seconds } }),
    setIcalSubscriptionsEnabled: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_subscriptions_enabled: on } }),
    setIcalSaveFolder: (folder: string) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_save_folder: folder } }),
    setIcalSaveLastFetch: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_save_last_fetch: on } }),
    setIcalIntervalFetch: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_interval_fetch: on } }),
    setIcalUseCronJob: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_use_cron_job: on } }),
    /** Mutually exclusive: browser interval polling vs server cron (sets both app flags atomically). */
    setIcalFetchTrigger: (mode: 'browser_interval' | 'server_cron') =>
      request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_fetch_trigger: mode } }),
    setIcalSyncIntervalMinutes: (minutes: number) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_sync_interval_minutes: minutes } }),
    setIcalEventRangeDays: (days: number) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_event_range_days: days } }),
    setIcalOmitUids: (value: string) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_omit_uids: value } }),
    getIcalLastFetch: () =>
      request<{
        path: string | null;
        content: string | null;
        subscription_id: number | null;
        saved_at: string | null;
        save_folder: string;
        sync_state: Record<string, unknown> | null;
        parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
        parse_range: { from: string; to: string } | null;
        subscriptions?: Array<{
          subscription_id: number;
          feed_url: string | null;
          sync_state: string | null;
          message: string | null;
          error: string | null;
          bytes_fetched: number | null;
          parsed_count: number | null;
          range_from: string | null;
          range_to: string | null;
          updated_at: string | null;
          path: string | null;
          content: string | null;
          parsed_events: Array<{ uid: string; title: string; start: string; end: string; allDay: boolean }> | null;
          parse_range: { from: string; to: string };
        }>;
      }>('api/admin.php?action=ical_last_fetch'),
    runMigrations: () =>
      request<{ ok: boolean; applied: string[] }>('api/migrate.php'),
    getUsers: () => request<{ users: Array<{ id: number; username: string; db_name: string; force_password_reset: boolean; is_admin: boolean; created_at: string; sso_providers: string[] }> }>('api/admin.php?action=users'),
    setForcePasswordReset: (userId: number, force: boolean) =>
      request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { user_id: userId, force_password_reset: force } }),
    getErrorLog: () => request<{ lines: string[] }>('api/admin.php?action=error_log'),
    clearIcalFeedEvents: () =>
      request<{ ok: boolean; deleted?: number }>('api/admin.php', { method: 'PATCH', body: { clear_ical_feed_events: true } }),
  },
  sync: {
    get: () =>
      request<{
        revision: string;
        server_time: string;
        tasks_updated_at?: string | null;
        slots_updated_at?: string | null;
      }>('api/sync.php'),
  },
};
