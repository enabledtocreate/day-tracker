/**
 * API client for Day Tracker PHP backend.
 * Uses getBaseUrl() so the app works at the domain root or in a subfolder (e.g. /DayTracker/).
 */
import { getBaseUrl } from './getBaseUrl';

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
  priority: Priority;
  recurring: boolean;
  recurrence_rule?: string | null;
  parent_id: number | null;
  group_order?: number;
  created_at: string;
  due_date?: string | null;
  list_state?: 'unassigned' | 'pending';
  list_style?: ListStyle;
  /** True when task is a Common Tasks template (orange border); scheduling uses a copy. */
  is_common?: boolean;
  category_id?: number | null;
  subcategory_id?: number | null;
  tag_ids?: number[];
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
}

export interface TimeSettings {
  start_hour: number;
  end_hour: number;
  increment_value: number;
  increment_unit: 'min' | 'hr';
  /** IANA timezone for iCal/schedule display (e.g. America/Los_Angeles). Empty = use browser timezone. */
  timezone?: string;
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

export const api = {
  tasks: {
    list: (params?: { list_state?: 'unassigned' | 'pending'; common?: boolean; view?: 'incomplete'; day?: string; with?: string }) => {
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
      priority?: Priority;
      recurring?: boolean;
      parent_id?: number | null;
      list_style?: ListStyle;
      is_common?: boolean;
      copy_from?: number;
      list_state?: 'unassigned' | 'pending';
    }) => request<Task & { id: number }>('api/tasks.php', { method: 'POST', body: data }),
    update: (data: { id: number; title?: string; priority?: Priority; recurring?: boolean; recurrence_rule?: string | null; parent_id?: number | null; group_order?: number; due_date?: string | null; list_state?: 'unassigned' | 'pending'; list_style?: ListStyle; is_common?: boolean; category_id?: number | null; subcategory_id?: number | null; tag_ids?: number[] }) =>
      request<{ ok: boolean; task?: Task }>('api/tasks.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/tasks.php?id=${id}`, { method: 'DELETE' }),
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
    completeOccurrence: (taskId: number, date: string) =>
      request<ScheduledSlot & { id: number }>('api/slots.php', { method: 'POST', body: { task_id: taskId, date, complete_occurrence: true } }),
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
    update: (data: Partial<TimeSettings>) =>
      request<{ ok: boolean }>('api/settings.php', {
        method: 'PATCH',
        body: {
          start_hour: data.start_hour,
          end_hour: data.end_hour,
          increment_value: data.increment_value,
          increment_unit: data.increment_unit,
          timezone: data.timezone,
        },
      }),
  },
  accomplished: {
    listByDate: (date: string) => request<{ accomplished: Array<{ id: number; task_id: number; title: string; completed_at: string }> }>(`api/accomplished.php?date=${encodeURIComponent(date)}`),
    listAll: (params?: { with?: string }) => {
      const q = new URLSearchParams({ list_all: '1' });
      if (params?.with) q.set('with', params.with);
      return request<{ byDate: Record<string, Array<{ id: number; day_record_id: number; task_id: number; title: string; start_time?: string; completed_at: string; subtasks?: Array<{ id: number; task_id: number; title: string; start_time?: string; completed_at: string }> }>>; linksByTaskId?: Record<number, TaskLink[]>; listItemsByTaskId?: Record<number, TaskListItem[]> }>(`api/accomplished.php?${q.toString()}`);
    },
    /** Per-day rollup of completed scheduled time by category / subcategory (from slot start/end). */
    summaryByOrganization: () =>
      request<{
        days: Array<{
          date: string;
          rows: Array<{ category: string; subcategory: string | null; hours: number; titles: string[] }>;
        }>;
      }>('api/accomplished.php?summary_org=1'),
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
  organization: {
    list: () =>
      request<{ categories: Array<{ id: number; name: string; color?: string | null }>; subcategories: Array<{ id: number; category_id: number; name: string }>; tags: Array<{ id: number; name: string; color?: string | null }> }>('api/organization.php'),
    createCategory: (data: { name: string; color?: string | null }) =>
      request<{ id: number; name: string; color?: string | null }>('api/organization.php', { method: 'POST', body: { type: 'category', ...data } }),
    createSubcategory: (data: { category_id: number; name: string }) =>
      request<{ id: number; category_id: number; name: string }>('api/organization.php', { method: 'POST', body: { type: 'subcategory', ...data } }),
    createTag: (data: { name: string; color?: string | null }) =>
      request<{ id: number; name: string; color?: string | null }>('api/organization.php', { method: 'POST', body: { type: 'tag', ...data } }),
    updateCategory: (id: number, data: { name?: string; color?: string | null }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'category', id, ...data } }),
    updateSubcategory: (id: number, data: { name?: string; category_id?: number }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'subcategory', id, ...data } }),
    updateTag: (id: number, data: { name?: string; color?: string | null }) =>
      request<{ ok: boolean }>('api/organization.php', { method: 'PATCH', body: { type: 'tag', id, ...data } }),
    deleteCategory: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=category&id=${id}`, { method: 'DELETE' }),
    deleteSubcategory: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=subcategory&id=${id}`, { method: 'DELETE' }),
    deleteTag: (id: number) => request<{ ok: boolean }>(`api/organization.php?type=tag&id=${id}`, { method: 'DELETE' }),
  },
  chat: {
    send: (message: string, taskContext: Record<string, unknown>) =>
      request<{ advice: string; suggestedTasks: Array<{ title: string; priority?: string; suggestedSlot?: string }> }>('api/chat.php', {
        method: 'POST',
        body: { message, taskContext },
      }),
  },
  icalFeed: {
    getUrl: () => request<{ token: string }>('api/ical_feed.php'),
  },
  icalSubscriptions: {
    list: () => request<{ subscriptions: Array<{ id: number; feed_url: string; created_at: string; enabled: boolean }> }>('api/ical_subscriptions.php'),
    add: (feedUrl: string) => request<{ id: number; feed_url: string }>('api/ical_subscriptions.php', { method: 'POST', body: { feed_url: feedUrl } }),
    setEnabled: (id: number, enabled: boolean) =>
      request<{ ok: boolean }>('api/ical_subscriptions.php', { method: 'PATCH', body: { id, enabled } }),
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
      request<{ interval_fetch?: boolean; interval_minutes?: number }>('api/ical_events.php?config=1'),
    get: (fromDate: string, toDate: string, options?: { force_sync?: boolean; sync_if_stale?: boolean }) => {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (options?.force_sync) params.set('force_sync', '1');
      if (options?.sync_if_stale) params.set('sync_if_stale', '1');
      return request<{ events: IcalFeedEvent[]; errors?: Array<{ feed_url: string; message: string }> }>(
        `api/ical_events.php?${params.toString()}`
      );
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
      }>('api/admin.php?action=settings'),
    setDebug: (debug: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { debug } }),
    setAiEnabled: (aiEnabled: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ai_enabled: aiEnabled } }),
    setIcalFetchTimeout: (seconds: number) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_fetch_timeout: seconds } }),
    setIcalSubscriptionsEnabled: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_subscriptions_enabled: on } }),
    setIcalSaveFolder: (folder: string) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_save_folder: folder } }),
    setIcalSaveLastFetch: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_save_last_fetch: on } }),
    setIcalIntervalFetch: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_interval_fetch: on } }),
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
};
