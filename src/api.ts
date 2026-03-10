/**
 * API client for Day Tracker PHP backend.
 * Uses relative paths (api/...) so the app works at the domain root or in a subfolder (e.g. /DayTracker/).
 * Override with data-baseurl on #app if you need an absolute API base.
 */

const BASE = ((): string => {
  const app = document.getElementById('app');
  if (app?.dataset.baseurl) return (app.dataset.baseurl as string).replace(/\/$/, '') + '/';
  return '';
})();

type ApiRequestInit = Omit<RequestInit, 'body'> & { method?: string; body?: unknown };

async function request<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { method = 'GET', body, ...rest } = options;
  const headers: Record<string, string> = {
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  if (body != null && typeof body === 'object' && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, {
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
  parent_id: number | null;
  created_at: string;
  list_state?: 'unassigned' | 'pending';
  list_style?: ListStyle;
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
  start_time: string;
  end_time: string;
  completed: number;
  order_index: number;
  title?: string;
  priority?: string;
  recurring?: number;
  parent_id?: number | null;
  list_style?: ListStyle;
  has_list?: number;
}

export interface TimeSettings {
  start_hour: number;
  end_hour: number;
  increment_value: number;
  increment_unit: 'min' | 'hr';
}

/** Read-only event from a subscribed iCal feed (for time blocking display). */
export interface IcalFeedEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  subscription_id?: number;
}

export const api = {
  tasks: {
    list: () => request<{ tasks: Task[] }>('api/tasks.php'),
    create: (data: { title: string; priority?: Priority; recurring?: boolean; parent_id?: number | null }) =>
      request<Task & { id: number }>('api/tasks.php', { method: 'POST', body: data }),
    update: (data: { id: number; title?: string; priority?: Priority; recurring?: boolean; parent_id?: number | null; list_state?: 'unassigned' | 'pending'; list_style?: ListStyle }) =>
      request<{ ok: boolean }>('api/tasks.php', { method: 'PATCH', body: data }),
    delete: (id: number) => request<{ ok: boolean }>(`api/tasks.php?id=${id}`, { method: 'DELETE' }),
  },
  day: {
    getOrCreate: (date: string) => request<DayRecord>(`api/day.php?date=${encodeURIComponent(date)}`),
  },
  rollover: (date: string) => request<{ ok: boolean }>(`api/rollover.php?date=${encodeURIComponent(date)}`, { method: 'POST' }),
  slots: {
    list: (dayId: number) => request<{ slots: ScheduledSlot[] }>(`api/slots.php?day_id=${dayId}`),
    get: (id: number) =>
      request<{ slot: (ScheduledSlot & { parent_id?: number | null }) | null; childSlots: Array<{ id: number; task_id: number; completed: number; start_time?: string; end_time?: string }> }>(`api/slots.php?id=${id}`),
    listByDateRange: (fromDate: string, toDate: string) =>
      request<{ byDate: Record<string, ScheduledSlot[]> }>(`api/slots.php?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`),
    create: (data: { day_record_id: number; task_id: number; start_time: string; end_time: string; order_index?: number }) =>
      request<ScheduledSlot & { id: number }>('api/slots.php', { method: 'POST', body: data }),
    update: (data: { id: number; completed?: boolean; start_time?: string; end_time?: string; order_index?: number }) => {
      const body: Record<string, unknown> = { id: data.id };
      if (data.completed !== undefined) body.completed = data.completed ? 1 : 0;
      if (data.start_time !== undefined) body.start_time = data.start_time;
      if (data.end_time !== undefined) body.end_time = data.end_time;
      if (data.order_index !== undefined) body.order_index = data.order_index;
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
        },
      }),
  },
  accomplished: {
    listByDate: (date: string) => request<{ accomplished: Array<{ id: number; task_id: number; title: string; completed_at: string }> }>(`api/accomplished.php?date=${encodeURIComponent(date)}`),
    listAll: () => request<{ byDate: Record<string, Array<{ id: number; day_record_id: number; task_id: number; title: string; start_time?: string; completed_at: string }>> }>('api/accomplished.php?list_all=1'),
  },
  debug: {
    clearTasks: () => request<{ ok: boolean }>('api/debug.php', { method: 'POST', body: { action: 'clear_tasks' } }),
    resetAll: () => request<{ ok: boolean }>('api/debug.php', { method: 'POST', body: { action: 'reset_all' } }),
  },
  dataIntegrity: {
    ensure: () =>
      request<{ ok: boolean; fixed: Record<string, Array<{ id: number; before: Record<string, string>; after: Record<string, string> }>> }>('api/data_integrity.php'),
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
    getDownloadUrl: (id: number) => BASE + `api/ical_subscriptions.php?preview=1&id=${id}&download=1`,
    getStreamUrl: (id: number) => BASE + `api/ical_subscriptions.php?stream=1&id=${id}`,
  },
  icalEvents: {
    get: (fromDate: string, toDate: string) =>
      request<{ events: IcalFeedEvent[]; errors?: Array<{ feed_url: string; message: string }> }>(`api/ical_events.php?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`),
  },
  user: {
    get: () => request<{ user: { id: number; username: string; db_name: string; is_admin: boolean; sso: Array<{ id?: number; provider: string; email: string }> } }>('api/user.php'),
    changePassword: (password: string) => request<{ ok: boolean }>('api/user.php', { method: 'PATCH', body: { password } }),
    disconnectSso: (ssoId: number, newPassword: string) =>
      request<{ ok: boolean }>('api/user.php', { method: 'PATCH', body: { disconnect_sso: ssoId, new_password: newPassword } }),
  },
  admin: {
    getSettings: () => request<{ debug: boolean; ai_enabled: boolean; ical_fetch_timeout: number; ical_stream_debug?: boolean }>('api/admin.php?action=settings'),
    setDebug: (debug: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { debug } }),
    setAiEnabled: (aiEnabled: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ai_enabled: aiEnabled } }),
    setIcalFetchTimeout: (seconds: number) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_fetch_timeout: seconds } }),
    setIcalStreamDebug: (on: boolean) => request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { ical_stream_debug: on } }),
    getUsers: () => request<{ users: Array<{ id: number; username: string; db_name: string; force_password_reset: boolean; is_admin: boolean; created_at: string; sso_providers: string[] }> }>('api/admin.php?action=users'),
    setForcePasswordReset: (userId: number, force: boolean) =>
      request<{ ok: boolean }>('api/admin.php', { method: 'PATCH', body: { user_id: userId, force_password_reset: force } }),
    getErrorLog: () => request<{ lines: string[] }>('api/admin.php?action=error_log'),
  },
};
