/**
 * Day Tracker - main entry. Auth gate: login or app with top bar, user/admin settings.
 */
import { initTaskList, loadTasks, setScheduledTaskIds, getTasks } from './task-list';
import { initTimeView } from './time-view';
import { initLinkModal } from './links';
import { initChatPanel } from './chat-panel';
import { initCalendarView } from './calendar-view';
import { initCompletedPanel, openCompletedPanelAndScrollToDate } from './completed-panel';
// Legacy mobile.ts gesture handlers were removed in favor of the React
// `lib/mobileGestures.ts` coordinator. See `.apm/_WORKSPACE/TODO-mobile.md §0.9 Step 2`.
const initMobile = (): void => undefined;
import { api } from './api';
import * as auth from './auth';

const RIGHT_PANEL_STORAGE_KEY = 'daytracker_right_panel_width';
const DEFAULT_RIGHT_WIDTH = 320;
let adminLogsModalInitialized = false;
const TASK_VIEW_HEIGHT_KEY = 'daytracker_task_view_height';
const TASK_VIEW_MIN_HEIGHT = 120;
const TASK_VIEW_SCHEDULE_MIN_HEIGHT = 200;

function getStoredRightPanelWidth(): number {
  const w = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
  if (w == null) return DEFAULT_RIGHT_WIDTH;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 280 ? n : DEFAULT_RIGHT_WIDTH;
}

function setStoredRightPanelWidth(width: number): void {
  localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(width));
}

function initResizeHandle(): void {
  const handle = document.getElementById('resize-handle');
  const rightPanel = document.querySelector('.right-panel') as HTMLElement;
  if (!handle || !rightPanel) return;
  let startX = 0;
  let startW = 0;
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !handle) return;
    startX = e.clientX;
    startW = rightPanel.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp, { once: true });
  }
  function onPointerMove(e: PointerEvent): void {
    const delta = startX - e.clientX;
    const newW = Math.max(280, Math.min(window.innerWidth - 400, startW + delta));
    rightPanel.style.flex = `0 0 ${newW}px`;
    setStoredRightPanelWidth(newW);
  }
  function onPointerUp(): void {
    handle?.removeEventListener('pointermove', onPointerMove);
  }
  handle?.addEventListener('pointerdown', onPointerDown);
  rightPanel.style.flex = `0 0 ${getStoredRightPanelWidth()}px`;
}

function initTaskScheduleResize(): void {
  const handleEl = document.getElementById('task-schedule-resize');
  const leftTop = document.querySelector('.panel-slide-tasks .left-top') as HTMLElement;
  const leftMain = document.querySelector('.panel-slide-tasks .left-main') as HTMLElement;
  if (!handleEl || !leftTop || !leftMain) return;
  const handle = handleEl as HTMLElement;
  const stored = localStorage.getItem(TASK_VIEW_HEIGHT_KEY);
  if (stored != null) {
    const px = parseInt(stored, 10);
    if (Number.isFinite(px) && px >= TASK_VIEW_MIN_HEIGHT) {
      leftTop.style.height = `${px}px`;
      leftTop.style.flex = `0 0 ${px}px`;
    }
  }
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const startY = e.clientY;
    const startH = leftTop.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    function onPointerMove(e2: PointerEvent): void {
      const dy = e2.clientY - startY;
      const maxH = leftMain.offsetHeight - TASK_VIEW_SCHEDULE_MIN_HEIGHT - handle.offsetHeight;
      const newH = Math.max(TASK_VIEW_MIN_HEIGHT, Math.min(maxH, startH + dy));
      leftTop.style.height = `${newH}px`;
      leftTop.style.flex = `0 0 ${newH}px`;
      localStorage.setItem(TASK_VIEW_HEIGHT_KEY, String(newH));
    }
    function onPointerUp(): void {
      handle.removeEventListener('pointermove', onPointerMove);
    }
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp, { once: true });
  }
  handle.addEventListener('pointerdown', onPointerDown);
}

function initDebugPanel(timeViewRefresh: () => void): void {
  const debugPanel = document.getElementById('debug-panel');
  if (!debugPanel || !auth.isAdmin()) {
    if (debugPanel) debugPanel.style.display = 'none';
    return;
  }
  const checkbox = document.getElementById('debug-mode-checkbox') as HTMLInputElement | null;
  const dateRow = document.getElementById('debug-date-row');
  const debugInput = document.getElementById('debug-date') as HTMLInputElement | null;
  const clearTasksBtn = document.getElementById('debug-clear-tasks');
  const resetAllBtn = document.getElementById('debug-reset-all');
  if (checkbox && dateRow) {
    checkbox.addEventListener('change', () => {
      dateRow.style.display = checkbox.checked ? '' : 'none';
      if (!checkbox.checked && debugInput) {
        debugInput.value = '';
        sessionStorage.removeItem('daytracker_debug_date');
      }
      timeViewRefresh();
      loadTasks();
    });
  }
  if (debugInput) {
    debugInput.addEventListener('change', () => {
      if (debugInput.value) sessionStorage.setItem('daytracker_debug_date', debugInput.value);
      else sessionStorage.removeItem('daytracker_debug_date');
      timeViewRefresh();
      loadTasks();
    });
  }
  if (clearTasksBtn) {
    clearTasksBtn.addEventListener('click', () => {
      if (confirm('Delete all tasks and scheduled items?')) {
        api.debug.clearTasks().then(() => {
          timeViewRefresh();
          loadTasks();
        });
      }
    });
  }
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      if (confirm('Reset everything? This will delete ALL data.')) {
        api.debug.resetAll().then(() => {
          timeViewRefresh();
          loadTasks();
        });
      }
    });
  }
}

function initApp(): void {
  initResizeHandle();
  initTaskScheduleResize();
  initLinkModal();
  initTaskList();
  const timeView = initTimeView((scheduledIds, extra) => {
    setScheduledTaskIds(scheduledIds, extra);
  });
  initDebugPanel(timeView.refresh);
  initChatPanel(auth.isAiEnabled());
  initCompletedPanel();
  initMobile();
  const calendarView = initCalendarView(
    timeView.getScheduleViewDate,
    timeView.setScheduleViewDateAndRefresh,
    timeView.getNextAvailableTimeForDay,
    timeView.getTodayDate,
    (date: string) => {
      const today = timeView.getTodayDate();
      if (date >= today) {
        setActiveTab('today');
        timeView.setScheduleViewDateAndRefresh(date);
        calendarView.setMonthFromDate(date);
        updateDayNavState();
      } else {
        openCompletedPanelAndScrollToDate(date);
      }
    }
  );

  const dayPrev = document.getElementById('day-prev');
  const dayNext = document.getElementById('day-next');
  function updateDayNavState() {
    const viewDate = timeView.getScheduleViewDate();
    const today = timeView.getTodayDate();
    (dayPrev as HTMLButtonElement).disabled = viewDate === today;
    const goTodayBtn = document.getElementById('day-go-today');
    if (goTodayBtn) {
      (goTodayBtn as HTMLButtonElement).style.display = viewDate === today ? 'none' : '';
    }
  }
  if (dayPrev) {
    dayPrev.addEventListener('click', () => {
      const viewDate = timeView.getScheduleViewDate();
      const today = timeView.getTodayDate();
      if (viewDate <= today) return;
      const d = new Date(viewDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const prev = d.toISOString().slice(0, 10);
      timeView.setScheduleViewDateAndRefresh(prev);
      calendarView.setMonthFromDate(prev);
      updateDayNavState();
    });
  }
  if (dayNext) {
    dayNext.addEventListener('click', () => {
      const viewDate = timeView.getScheduleViewDate();
      const d = new Date(viewDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const next = d.toISOString().slice(0, 10);
      timeView.setScheduleViewDateAndRefresh(next);
      calendarView.setMonthFromDate(next);
      updateDayNavState();
    });
  }
  window.addEventListener('daytracker-schedule-swipe-prev', () => {
    const viewDate = timeView.getScheduleViewDate();
    const today = timeView.getTodayDate();
    if (viewDate <= today) return;
    const d = new Date(viewDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const prev = d.toISOString().slice(0, 10);
    timeView.setScheduleViewDateAndRefresh(prev);
    calendarView.setMonthFromDate(prev);
    updateDayNavState();
  });
  window.addEventListener('daytracker-schedule-swipe-next', () => {
    const viewDate = timeView.getScheduleViewDate();
    const d = new Date(viewDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().slice(0, 10);
    timeView.setScheduleViewDateAndRefresh(next);
    calendarView.setMonthFromDate(next);
    updateDayNavState();
  });

  const tabToday = document.getElementById('tab-today');
  const tabCalendar = document.getElementById('tab-calendar');
  const timeViewEl = document.getElementById('time-view');
  const calendarViewEl = document.getElementById('calendar-view');
  const timeSettings = document.querySelector('.time-settings');
  const dayNav = document.querySelector('.day-nav');
  let currentScheduleTab: 'today' | 'calendar' = 'today';
  function setActiveTab(tab: 'today' | 'calendar') {
    currentScheduleTab = tab;
    tabToday?.classList.toggle('active', tab === 'today');
    tabCalendar?.classList.toggle('active', tab === 'calendar');
    timeViewEl?.classList.toggle('hidden', tab !== 'today');
    calendarViewEl?.classList.toggle('visible', tab === 'calendar');
    timeSettings?.classList.toggle('hidden', tab !== 'today');
    dayNav?.classList.toggle('hidden', tab !== 'today');
    if (tab === 'calendar') calendarView.refresh();
  }
  tabToday?.addEventListener('click', () => setActiveTab('today'));
  tabCalendar?.addEventListener('click', () => setActiveTab('calendar'));

  const datePickerModal = document.getElementById('date-picker-modal') as HTMLDialogElement | null;
  const datePickerInput = document.getElementById('date-picker-input') as HTMLInputElement | null;
  const datePickerOk = document.getElementById('date-picker-ok');
  const datePickerCancel = document.getElementById('date-picker-cancel');
  let scheduleTaskDatePendingTaskId: number | null = null;
  let changeSlotDatePendingSlotId: number | null = null;
  window.addEventListener('daytracker-schedule-task-date', ((e: CustomEvent<{ taskId: number }>) => {
    changeSlotDatePendingSlotId = null;
    scheduleTaskDatePendingTaskId = e.detail?.taskId ?? null;
    if (datePickerModal && datePickerInput && scheduleTaskDatePendingTaskId != null) {
      datePickerInput.value = timeView.getScheduleViewDate();
      datePickerModal.showModal();
    }
  }) as EventListener);
  window.addEventListener('daytracker-change-slot-date', ((e: CustomEvent<{ slotId: number }>) => {
    scheduleTaskDatePendingTaskId = null;
    changeSlotDatePendingSlotId = e.detail?.slotId ?? null;
    if (datePickerModal && datePickerInput && changeSlotDatePendingSlotId != null) {
      datePickerInput.value = timeView.getScheduleViewDate();
      datePickerModal.showModal();
    }
  }) as EventListener);
  if (datePickerModal && datePickerInput) {
    datePickerOk?.addEventListener('click', () => {
      const v = datePickerInput.value?.trim();
      if (!v) return;
      if (changeSlotDatePendingSlotId != null) {
        timeView.moveSlotAndChildrenToDate(changeSlotDatePendingSlotId, v);
        changeSlotDatePendingSlotId = null;
        datePickerModal.close();
      } else if (scheduleTaskDatePendingTaskId != null) {
        const task = getTasks().find(t => t.id === scheduleTaskDatePendingTaskId);
        if (task) {
          timeView.scheduleTaskOnDate(task, v);
          loadTasks();
        }
        scheduleTaskDatePendingTaskId = null;
        datePickerModal.close();
      }
    });
    datePickerCancel?.addEventListener('click', () => {
      scheduleTaskDatePendingTaskId = null;
      changeSlotDatePendingSlotId = null;
      datePickerModal.close();
    });
  }

  timeViewEl?.closest('.left-bottom')?.addEventListener('daytracker-refresh', updateDayNavState);
  window.addEventListener('daytracker-refresh', () => {
    const tabToRestore = currentScheduleTab;
    timeView.refresh();
    updateDayNavState();
    setActiveTab(tabToRestore);
  });
  window.addEventListener('daytracker-unschedule', () => {
    loadTasks();
  });
  const goTodayBtn = document.getElementById('day-go-today');
  if (goTodayBtn) {
    goTodayBtn.addEventListener('click', () => {
      const today = timeView.getTodayDate();
      timeView.setScheduleViewDateAndRefresh(today);
      calendarView.setMonthFromDate(today);
      updateDayNavState();
    });
  }
  updateDayNavState();
}

function showLoginScreen(): void {
  const loginScreen = document.getElementById('login-screen');
  const appBar = document.getElementById('app-bar');
  const mainPanels = document.getElementById('main-panels');
  const userView = document.getElementById('user-settings-view');
  const adminView = document.getElementById('admin-settings-view');
  if (loginScreen) loginScreen.hidden = false;
  if (loginScreen) loginScreen.setAttribute('aria-hidden', 'false');
  if (appBar) appBar.hidden = true;
  if (appBar) appBar.setAttribute('aria-hidden', 'true');
  if (mainPanels) mainPanels.style.display = 'none';
  if (userView) userView.hidden = true;
  if (adminView) adminView.hidden = true;
}

function showApp(): void {
  const loginScreen = document.getElementById('login-screen');
  const appBar = document.getElementById('app-bar');
  const mainPanels = document.getElementById('main-panels');
  if (loginScreen) loginScreen.hidden = true;
  if (loginScreen) loginScreen.setAttribute('aria-hidden', 'true');
  if (appBar) appBar.hidden = false;
  if (appBar) appBar.setAttribute('aria-hidden', 'false');
  if (mainPanels) mainPanels.style.display = 'flex';
  const adminBtn = document.getElementById('app-bar-admin');
  if (adminBtn) adminBtn.style.display = auth.isAdmin() ? '' : 'none';
}

function showUserSettingsView(): void {
  document.getElementById('user-settings-view')!.hidden = false;
  document.getElementById('user-settings-view')!.setAttribute('aria-hidden', 'false');
  renderUserSettings();
}

function showAdminSettingsView(): void {
  document.getElementById('admin-settings-view')!.hidden = false;
  document.getElementById('admin-settings-view')!.setAttribute('aria-hidden', 'false');
  renderAdminSettings();
}

function hideSettingsViews(): void {
  const userView = document.getElementById('user-settings-view');
  const adminView = document.getElementById('admin-settings-view');
  if (userView) userView.hidden = true;
  if (userView) userView.setAttribute('aria-hidden', 'true');
  if (adminView) adminView.hidden = true;
  if (adminView) adminView.setAttribute('aria-hidden', 'true');
}

function attachAppBarAndSettingsListeners(): void {
  document.getElementById('app-bar-user')?.addEventListener('click', () => showUserSettingsView());
  document.getElementById('app-bar-admin')?.addEventListener('click', () => showAdminSettingsView());
  document.getElementById('user-settings-close')?.addEventListener('click', hideSettingsViews);
  document.getElementById('admin-settings-close')?.addEventListener('click', hideSettingsViews);
}

function openIcalStreamDebugModal(subscriptionId: number): void {
  const modal = document.getElementById('feed-stream-debug-modal') as (HTMLDialogElement & { __icalRaw?: string }) | null;
  const bodyEl = document.getElementById('feed-stream-debug-body');
  const closeBtn = document.getElementById('feed-stream-debug-close');
  const parseBtn = document.getElementById('feed-stream-debug-parse') as HTMLButtonElement | null;
  if (!modal || !bodyEl) return;
  const modalEl = modal;
  modalEl.__icalRaw = '';
  bodyEl.textContent = 'Connecting…';
  modalEl.showModal();
  closeBtn?.addEventListener('click', () => modalEl.close(), { once: true });
  if (parseBtn) {
    parseBtn.style.display = '';
    parseBtn.textContent = 'Parse dates/titles';
    parseBtn.onclick = () => {
      parseIcalStreamDebug(modalEl, bodyEl);
    };
  }
  const body = bodyEl;
  fetch(api.icalSubscriptions.getStreamUrl(subscriptionId), { credentials: 'include' })
    .then((res) => {
      if (!res.ok) {
        body.textContent = `Error: ${res.status} ${res.statusText}`;
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        body.textContent = 'Stream not supported';
        return;
      }
      const streamReader = reader;
      const decoder = new TextDecoder();
      let text = '';
      function read(): Promise<void> {
        return streamReader.read().then(({ value, done }) => {
          if (value) {
            text += decoder.decode(value, { stream: !done });
            modalEl.__icalRaw = text;
            body.textContent = text;
            body.scrollTop = body.scrollHeight;
          }
          if (!done) return read();
        });
      }
      return read();
    })
    .catch((err) => {
      body.textContent += '\n\nError: ' + (err instanceof Error ? err.message : String(err));
    });
}

type DebugParsedEvent = { date: string; title: string };

function parseIcalStreamDebug(
  modal: HTMLDialogElement & { __icalRaw?: string },
  bodyEl: HTMLElement
): void {
  const rawSource = modal.__icalRaw ?? bodyEl.textContent ?? '';
  const raw = rawSource.trim();
  if (!raw) {
    bodyEl.textContent = 'No iCal content to parse.';
    return;
  }
  let normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
  }
  const rawLines = normalized.split('\n');
  const unfolded: string[] = [];
  let current = '';
  for (const line of rawLines) {
    if (!current) {
      current = line;
    } else if (line.startsWith(' ') || line.startsWith('\t')) {
      current += line.slice(1);
    } else {
      unfolded.push(current);
      current = line;
    }
  }
  if (current) unfolded.push(current);

  const events: DebugParsedEvent[] = [];
  let inEvent = false;
  let startDate: string | null = null;
  let summary: string | null = null;

  for (const line of unfolded) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      startDate = null;
      summary = null;
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (inEvent && startDate) {
        events.push({
          date: startDate,
          title: summary && summary.length > 0 ? summary : '(no title)',
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith('DTSTART')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const val = line.slice(idx + 1).trim();
        if (/^\d{8}/.test(val)) {
          const y = val.slice(0, 4);
          const m = val.slice(4, 6);
          const d = val.slice(6, 8);
          startDate = `${y}-${m}-${d}`;
        }
      }
    } else if (line.startsWith('SUMMARY')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        summary = line.slice(idx + 1).trim();
      }
    }
  }

  if (!events.length) {
    bodyEl.textContent = 'No events found in stream.';
    return;
  }

  // Newest to oldest (descending by date string YYYY-MM-DD)
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  bodyEl.textContent = events.map((ev) => `${ev.date}  ${ev.title}`).join('\n');
}

function renderUserSettings(): void {
  const container = document.getElementById('user-settings-content');
  if (!container) return;
  api.user.get().then(({ user }) => {
    container.innerHTML = '';
    const section = (title: string) => {
      const h = document.createElement('h3');
      h.textContent = title;
      h.style.marginTop = '1rem';
      container.appendChild(h);
    };
    section('Profile');
    const p = document.createElement('p');
    p.textContent = `Username: ${user.username}`;
    container.appendChild(p);

    if (user.sso.length > 0) {
      section('Linked accounts');
      user.sso.forEach((s: { id?: number; provider: string; email: string }) => {
        const div = document.createElement('div');
        div.style.marginBottom = '0.5rem';
        div.textContent = `${s.provider}: ${s.email}`;
        const disconnectBtn = document.createElement('button');
        disconnectBtn.textContent = 'Disconnect';
        disconnectBtn.type = 'button';
        disconnectBtn.style.marginLeft = '0.5rem';
        disconnectBtn.addEventListener('click', () => {
          const newPass = prompt('Set a new password (min 6 characters). You will use it to log in after disconnecting.');
          if (newPass && newPass.length >= 6 && s.id) {
            api.user.disconnectSso(s.id, newPass).then(() => renderUserSettings()).catch(alert);
          } else if (newPass !== null) alert('Password must be at least 6 characters.');
        });
        div.appendChild(disconnectBtn);
        container.appendChild(div);
      });
      const note = document.createElement('p');
      note.style.fontSize = '0.9rem';
      note.style.color = 'var(--text-muted)';
      note.textContent = 'If you disconnect, you must set a password to log in with username/password.';
      container.appendChild(note);
    }

    section('Change password');
    const form = document.createElement('form');
    form.innerHTML = '<label>New password <input type="password" id="user-new-password" minlength="6" /></label><button type="submit">Update password</button>';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('user-new-password') as HTMLInputElement;
      const v = input?.value?.trim();
      if (v && v.length >= 6) {
        api.user.changePassword(v).then(() => { input.value = ''; alert('Password updated.'); }).catch(alert);
      }
    });
    container.appendChild(form);

    section('Calendar feed');
    const feedDiv = document.createElement('div');
    feedDiv.style.marginBottom = '0.5rem';
    api.icalFeed.getUrl().then(({ token }) => {
      const base = ((): string => {
        const app = document.getElementById('app');
        if (app?.dataset.baseurl) return (app.dataset.baseurl as string).replace(/\/$/, '');
        return '';
      })();
      const feedUrl = base ? `${window.location.origin}${base}/ical.php?token=${encodeURIComponent(token)}` : `${window.location.origin}/ical.php?token=${encodeURIComponent(token)}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.value = feedUrl;
      input.style.width = '100%';
      input.style.maxWidth = '32rem';
      input.style.marginRight = '0.5rem';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(feedUrl).then(() => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }).catch(() => alert('Could not copy.'));
      });
      feedDiv.appendChild(input);
      feedDiv.appendChild(copyBtn);
      const note = document.createElement('p');
      note.style.fontSize = '0.9rem';
      note.style.color = 'var(--text-muted)';
      note.style.marginTop = '0.25rem';
      note.textContent = 'Add this URL in Google Calendar (Add by URL) or another calendar app to keep your schedule in sync.';
      feedDiv.appendChild(note);
    }).catch(() => {
      feedDiv.textContent = 'Could not load calendar feed.';
    });
    container.appendChild(feedDiv);

    section('Subscribed calendars');
    const subDiv = document.createElement('div');
    subDiv.style.marginBottom = '0.5rem';
    const subInput = document.createElement('input');
    subInput.type = 'url';
    subInput.placeholder = 'https://… iCal feed URL';
    subInput.style.width = '100%';
    subInput.style.maxWidth = '32rem';
    subInput.style.marginRight = '0.5rem';
    const subAddBtn = document.createElement('button');
    subAddBtn.type = 'button';
    subAddBtn.textContent = 'Add';
    const subList = document.createElement('div');
    subList.style.marginTop = '0.5rem';
    function renderSubscriptions(): void {
      api.icalSubscriptions.list().then(({ subscriptions }) => {
        subList.innerHTML = '';
        if (subscriptions.length === 0) {
          const p = document.createElement('p');
          p.style.fontSize = '0.9rem';
          p.style.color = 'var(--text-muted)';
          p.textContent = 'No feeds. Add an iCal URL to show events on your schedule (read-only).';
          subList.appendChild(p);
          return;
        }
        subscriptions.forEach((sub: { id: number; feed_url: string; enabled: boolean }) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '0.5rem';
          row.style.marginBottom = '0.25rem';
          row.style.flexWrap = 'wrap';
          const showLabel = document.createElement('label');
          showLabel.style.display = 'flex';
          showLabel.style.alignItems = 'center';
          showLabel.style.gap = '0.35rem';
          showLabel.style.flexShrink = '0';
          const showCheck = document.createElement('input');
          showCheck.type = 'checkbox';
          showCheck.checked = sub.enabled !== false;
          showCheck.title = 'Show this calendar on schedule';
          showCheck.addEventListener('change', () => {
            api.icalSubscriptions.setEnabled(sub.id, showCheck.checked).then(() => renderSubscriptions()).catch(alert);
          });
          showLabel.appendChild(showCheck);
          showLabel.append('Show on schedule');
          row.appendChild(showLabel);
          const urlSpan = document.createElement('span');
          urlSpan.textContent = sub.feed_url;
          urlSpan.style.overflow = 'hidden';
          urlSpan.style.textOverflow = 'ellipsis';
          urlSpan.style.whiteSpace = 'nowrap';
          urlSpan.style.minWidth = '0';
          urlSpan.style.flex = '1 1 8rem';
          row.appendChild(urlSpan);
          const viewParsedBtn = document.createElement('button');
          viewParsedBtn.type = 'button';
          viewParsedBtn.textContent = 'View parsed';
          viewParsedBtn.title = 'View parsed events only';
          viewParsedBtn.addEventListener('click', () => {
            api.admin.getSettings().then((s) => { if (s.ical_stream_debug) openIcalStreamDebugModal(sub.id); }).catch(() => {});
            const modal = document.getElementById('feed-parsed-modal') as HTMLDialogElement | null;
            const rangeEl = document.getElementById('feed-parsed-range');
            const bodyEl = document.getElementById('feed-parsed-body');
            const closeBtn = document.getElementById('feed-parsed-close');
            const dateListBtn = document.getElementById('feed-parsed-date-list-btn');
            const downloadLink = document.getElementById('feed-parsed-download') as HTMLAnchorElement | null;
            if (!modal || !bodyEl) return;
            if (dateListBtn) dateListBtn.style.display = 'none';
            if (rangeEl) rangeEl.textContent = '';
            if (downloadLink) {
              downloadLink.href = '#';
              downloadLink.style.display = 'none';
            }
            bodyEl.textContent = 'Loading…';
            modal.showModal();
            const revokeBlobUrl = (): void => {
              if (downloadLink?.href?.startsWith('blob:')) {
                URL.revokeObjectURL(downloadLink.href);
              }
            };
            const onClose = (): void => {
              revokeBlobUrl();
              modal?.removeEventListener('close', onClose);
            };
            modal.addEventListener('close', onClose);
            api.icalSubscriptions.preview(sub.id, true).then((res) => {
              if ('error' in res) {
                if (rangeEl) rangeEl.textContent = '';
                bodyEl.textContent = res.error;
                return;
              }
              if (downloadLink) {
                if (typeof res.raw === 'string' && res.raw.length > 0) {
                  downloadLink.href = URL.createObjectURL(new Blob([res.raw], { type: 'text/calendar' }));
                  downloadLink.download = 'feed.ics';
                } else {
                  downloadLink.href = api.icalSubscriptions.getDownloadUrl(sub.id);
                  downloadLink.download = 'feed.ics';
                }
                downloadLink.style.display = '';
              }
              if (res.parse_range && rangeEl) {
                rangeEl.textContent = `Range: ${res.parse_range.from} to ${res.parse_range.to}`;
              }
              if (res.parsed_events === undefined) {
                bodyEl.textContent = 'No parsed data.';
                return;
              }
              type ParsedEv = { uid: string; title: string; start: string; end: string; allDay: boolean };
              const events = res.parsed_events as ParsedEv[];
              const detailedText = events.length === 0
                ? 'No events in this range.'
                : events.map((ev, i) =>
                    (i + 1) + '. ' + (ev.allDay ? '[All day] ' : '') + ev.title + ' | ' + ev.start + ' – ' + ev.end
                  ).join('\n');
              bodyEl.textContent = detailedText;
              (modal as unknown as { __parsedEvents?: ParsedEv[]; __detailedText?: string }).__parsedEvents = events;
              (modal as unknown as { __parsedEvents?: ParsedEv[]; __detailedText?: string }).__detailedText = detailedText;
              if (dateListBtn) {
                dateListBtn.style.display = '';
                dateListBtn.textContent = 'Show date list';
                dateListBtn.onclick = () => {
                  const m = modal as HTMLDialogElement & { __parsedEvents?: ParsedEv[]; __detailedText?: string };
                  if (dateListBtn.textContent === 'Show date list') {
                    const list = (m.__parsedEvents ?? []).map((ev) => {
                      const date = ev.start.slice(0, 10);
                      return date + '  ' + (ev.title || '(no title)');
                    }).join('\n');
                    bodyEl.textContent = list || '(no events)';
                    dateListBtn.textContent = 'Show full detail';
                  } else {
                    bodyEl.textContent = m.__detailedText ?? '';
                    dateListBtn.textContent = 'Show date list';
                  }
                };
              }
              closeBtn?.addEventListener('click', () => modal.close(), { once: true });
            }).catch((err) => {
              if (rangeEl) rangeEl.textContent = '';
              bodyEl.textContent = err instanceof Error ? err.message : 'Could not load feed.';
              if (downloadLink) downloadLink.style.display = 'none';
              closeBtn?.addEventListener('click', () => modal.close(), { once: true });
            });
          });
          const viewBtn = document.createElement('button');
          viewBtn.type = 'button';
          viewBtn.textContent = 'View contents';
          viewBtn.title = 'View raw iCal feed (no parsing)';
          viewBtn.addEventListener('click', () => {
            api.admin.getSettings().then((s) => { if (s.ical_stream_debug) openIcalStreamDebugModal(sub.id); }).catch(() => {});
            const modal = document.getElementById('feed-contents-modal') as HTMLDialogElement | null;
            const bodyEl = document.getElementById('feed-contents-body');
            const closeBtn = document.getElementById('feed-contents-close');
            const downloadLink = document.getElementById('feed-contents-download') as HTMLAnchorElement | null;
            if (!modal || !bodyEl) return;
            if (downloadLink) {
              downloadLink.href = '#';
              downloadLink.style.display = 'none';
            }
            bodyEl.textContent = 'Loading…';
            modal.showModal();
            const revokeBlobUrl = (): void => {
              if (downloadLink?.href?.startsWith('blob:')) {
                URL.revokeObjectURL(downloadLink.href);
              }
            };
            const onClose = (): void => {
              revokeBlobUrl();
              modal?.removeEventListener('close', onClose);
            };
            modal.addEventListener('close', onClose);
            api.icalSubscriptions.preview(sub.id, true).then((res) => {
              if ('error' in res) {
                bodyEl.textContent = res.error;
                return;
              }
              if (downloadLink) {
                if (typeof res.raw === 'string' && res.raw.length > 0) {
                  downloadLink.href = URL.createObjectURL(new Blob([res.raw], { type: 'text/calendar' }));
                  downloadLink.download = 'feed.ics';
                } else {
                  downloadLink.href = api.icalSubscriptions.getDownloadUrl(sub.id);
                  downloadLink.download = 'feed.ics';
                }
                downloadLink.style.display = '';
              }
              bodyEl.textContent = res.content + (res.truncated ? '\n\n… (truncated)' : '');
            }).catch((err) => {
              bodyEl.textContent = err instanceof Error ? err.message : 'Could not load feed.';
              if (downloadLink) downloadLink.style.display = 'none';
            });
            closeBtn?.addEventListener('click', () => modal.close(), { once: true });
          });
          const rmBtn = document.createElement('button');
          rmBtn.type = 'button';
          rmBtn.textContent = 'Remove';
          rmBtn.addEventListener('click', () => {
            api.icalSubscriptions.delete(sub.id).then(() => renderSubscriptions()).catch(alert);
          });
          row.appendChild(viewParsedBtn);
          row.appendChild(viewBtn);
          row.appendChild(rmBtn);
          subList.appendChild(row);
        });
      }).catch(() => {
        subList.textContent = 'Could not load subscriptions.';
      });
    }
    subAddBtn.addEventListener('click', () => {
      const url = subInput.value.trim();
      if (!url) return;
      api.icalSubscriptions.add(url).then(() => {
        subInput.value = '';
        renderSubscriptions();
      }).catch(alert);
    });
    subDiv.appendChild(subInput);
    subDiv.appendChild(subAddBtn);
    subDiv.appendChild(subList);
    container.appendChild(subDiv);
    renderSubscriptions();

    section('Session');
    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Log out';
    logoutBtn.addEventListener('click', () => {
      auth.logout().then(() => window.location.reload());
    });
    container.appendChild(logoutBtn);
  }).catch(() => {
    container.textContent = 'Could not load profile.';
  });
}

function renderAdminSettings(): void {
  const container = document.getElementById('admin-settings-content');
  if (!container) return;
  container.innerHTML = '';
  api.admin.getSettings().then((settings) => {
    const section = (title: string) => {
      const h = document.createElement('h3');
      h.textContent = title;
      h.style.marginTop = '1rem';
      container.appendChild(h);
    };
    section('App settings');
    const debugLabel = document.createElement('label');
    const debugCheck = document.createElement('input');
    debugCheck.type = 'checkbox';
    debugCheck.checked = settings.debug;
    debugCheck.addEventListener('change', () => api.admin.setDebug(debugCheck.checked).catch(alert));
    debugLabel.appendChild(debugCheck);
    debugLabel.append(' Debug mode');
    container.appendChild(debugLabel);

    const aiLabel = document.createElement('label');
    aiLabel.style.display = 'block';
    aiLabel.style.marginTop = '0.5rem';
    const aiCheck = document.createElement('input');
    aiCheck.type = 'checkbox';
    aiCheck.checked = settings.ai_enabled;
    aiCheck.addEventListener('change', () => {
      api.admin.setAiEnabled(aiCheck.checked).then(() => {
        (window as unknown as { __daytrackerAiEnabled?: boolean }).__daytrackerAiEnabled = aiCheck.checked;
      }).catch(alert);
    });
    aiLabel.appendChild(aiCheck);
    aiLabel.append(' AI chat panel enabled');
    container.appendChild(aiLabel);

    const icalTimeoutLabel = document.createElement('label');
    icalTimeoutLabel.style.display = 'block';
    icalTimeoutLabel.style.marginTop = '0.5rem';
    icalTimeoutLabel.append(' iCal feed fetch timeout (seconds, 5–300): ');
    const icalTimeoutInput = document.createElement('input');
    icalTimeoutInput.type = 'number';
    icalTimeoutInput.min = '5';
    icalTimeoutInput.max = '300';
    icalTimeoutInput.value = String(settings.ical_fetch_timeout ?? 60);
    icalTimeoutInput.style.width = '4rem';
    icalTimeoutInput.style.marginLeft = '0.25rem';
    icalTimeoutInput.addEventListener('change', () => {
      const v = Math.max(5, Math.min(300, parseInt(icalTimeoutInput.value, 10) || 60));
      icalTimeoutInput.value = String(v);
      api.admin.setIcalFetchTimeout(v).catch(alert);
    });
    icalTimeoutLabel.appendChild(icalTimeoutInput);
    container.appendChild(icalTimeoutLabel);

    const streamDebugLabel = document.createElement('label');
    streamDebugLabel.style.display = 'block';
    streamDebugLabel.style.marginTop = '0.5rem';
    const streamDebugCheck = document.createElement('input');
    streamDebugCheck.type = 'checkbox';
    streamDebugCheck.checked = !!settings.ical_stream_debug;
    streamDebugCheck.addEventListener('change', () => api.admin.setIcalStreamDebug(streamDebugCheck.checked).catch(alert));
    streamDebugLabel.appendChild(streamDebugCheck);
    streamDebugLabel.append(' Show iCal stream when loading (opens modal with live feed as it’s read)');
    container.appendChild(streamDebugLabel);

    section('Users');
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.marginTop = '0.5rem';
    table.style.borderCollapse = 'collapse';
    api.admin.getUsers().then(({ users }) => {
      table.innerHTML = '<thead><tr><th>Username</th><th>SSO</th><th>Force password reset</th></tr></thead><tbody></tbody>';
      const tbody = table.querySelector('tbody')!;
      users.forEach((u) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${u.username}</td><td>${u.sso_providers.length ? u.sso_providers.join(', ') : '—'}</td><td></td>`;
        const td = tr.cells[2];
        if (u.sso_providers.length === 0) {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = u.force_password_reset;
          cb.addEventListener('change', () => api.admin.setForcePasswordReset(u.id, cb.checked).catch(alert));
          td.appendChild(cb);
        } else {
          td.textContent = '—';
        }
        tbody.appendChild(tr);
      });
      container.appendChild(table);
    }).catch(() => {
      container.appendChild(document.createTextNode('Could not load users.'));
    });

    section('Error log');
    const viewLogsBtn = document.createElement('button');
    viewLogsBtn.type = 'button';
    viewLogsBtn.textContent = 'View Logs';
    const logsModal = document.getElementById('admin-logs-modal') as HTMLDialogElement | null;
    const logsContent = document.getElementById('admin-logs-content');
    const logsRefreshBtn = document.getElementById('admin-logs-refresh');
    const logsCloseBtn = document.getElementById('admin-logs-close');
    function loadErrorLogIntoModal(): void {
      if (!logsContent) return;
      api.admin.getErrorLog().then(({ lines }) => {
        logsContent.textContent = lines.length > 0 ? lines.join('\n') : 'No log entries.';
      }).catch(() => {
        logsContent.textContent = 'Could not load log.';
      });
    }
    viewLogsBtn.addEventListener('click', () => {
      if (logsModal) {
        loadErrorLogIntoModal();
        logsModal.showModal();
      }
    });
    if (!adminLogsModalInitialized) {
      adminLogsModalInitialized = true;
      logsRefreshBtn?.addEventListener('click', loadErrorLogIntoModal);
      logsCloseBtn?.addEventListener('click', () => logsModal?.close());
    }
    container.appendChild(viewLogsBtn);
  }).catch(() => {
    container.textContent = 'Could not load admin settings.';
  });
}

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const loginError = params.get('login_error');
  if (loginError) {
    const msg = document.getElementById('login-message');
    if (msg) msg.textContent = loginError === 'sso_failed' ? 'SSO sign-in failed. Try again or use username/password.' : 'Sign-in failed.';
  }

  let data: { user: auth.AuthUser | null; error?: string; code?: string };
  try {
    const res = await auth.fetchMe();
    data = res as { user: auth.AuthUser | null; error?: string; code?: string };
  } catch {
    data = { user: null };
  }
  if (!data.user) {
    showLoginScreen();
    initLoginForm();
    return;
  }
  if (data.user.force_password_reset) {
    showApp();
    initApp();
    attachAppBarAndSettingsListeners();
    showUserSettingsView();
    const content = document.getElementById('user-settings-content');
    if (content) content.innerHTML = '<p>You must set a new password before continuing.</p>';
    renderUserSettings();
  } else {
    showApp();
    initApp();
    attachAppBarAndSettingsListeners();
  }

  function initLoginForm(): void {
    const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
    const registerForm = document.getElementById('register-form') as HTMLFormElement | null;
    const loginToggle = document.getElementById('login-toggle-register');
    const registerToggle = document.getElementById('register-toggle-login');
    const loginUsername = document.getElementById('login-username') as HTMLInputElement | null;
    const loginPassword = document.getElementById('login-password') as HTMLInputElement | null;
    const registerUsername = document.getElementById('register-username') as HTMLInputElement | null;
    const registerPassword = document.getElementById('register-password') as HTMLInputElement | null;
    const loginMessage = document.getElementById('login-message');

    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!loginUsername?.value?.trim() || !loginPassword?.value) return;
      const r = await auth.login(loginUsername.value.trim(), loginPassword.value);
      if (r.ok) {
        showApp();
        initApp();
        attachAppBarAndSettingsListeners();
        if (r.force_password_reset) showUserSettingsView();
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        if (loginMessage) loginMessage.textContent = r.error || 'Login failed';
      }
    });

    registerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!registerUsername?.value?.trim() || !registerPassword?.value) return;
      const r = await auth.register(registerUsername.value.trim(), registerPassword.value);
      if (r.ok) {
        showApp();
        initApp();
        attachAppBarAndSettingsListeners();
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        if (loginMessage) loginMessage.textContent = r.error || 'Registration failed';
      }
    });

    loginToggle?.addEventListener('click', () => {
      loginForm!.style.display = 'none';
      registerForm!.style.display = 'block';
      if (loginMessage) loginMessage.textContent = '';
    });
    registerToggle?.addEventListener('click', () => {
      registerForm!.style.display = 'none';
      loginForm!.style.display = 'block';
      if (loginMessage) loginMessage.textContent = '';
    });

    const ssoGoogle = document.getElementById('sso-google') as HTMLAnchorElement | null;
    const ssoOutlook = document.getElementById('sso-outlook') as HTMLAnchorElement | null;
    if (ssoGoogle) ssoGoogle.href = auth.getSSOUrl('google');
    if (ssoOutlook) ssoOutlook.href = auth.getSSOUrl('outlook');
  }
}

bootstrap();
