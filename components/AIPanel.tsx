'use client';

import { useState, useRef } from 'react';
import { api, type Priority } from '@/lib/api';

const RIGHT_PANEL_STORAGE_KEY = 'daytracker_right_panel_width';
const DEFAULT_RIGHT_WIDTH = 320;

function getStoredRightPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RIGHT_WIDTH;
  const w = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
  if (w == null) return DEFAULT_RIGHT_WIDTH;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 280 ? n : DEFAULT_RIGHT_WIDTH;
}

type Props = {
  aiEnabled: boolean;
  viewDate: string;
  onRefresh: () => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  collapsed?: boolean;
};

function buildTaskContext(viewDate: string): Promise<Record<string, unknown>> {
  return Promise.all([
    api.accomplished.listByDate(viewDate),
    api.tasks.list(),
    api.day.getOrCreate(viewDate),
  ]).then(([accomplishedRes, tasksRes, dayRes]) =>
    api.slots.list(dayRes.id).then((slotsRes) => {
      const tasks = tasksRes.tasks;
      const slots = slotsRes.slots;
      const accomplished = accomplishedRes.accomplished;
      const taskListWithFlags = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        recurring: t.recurring,
        parent_id: t.parent_id,
      }));
      const scheduledTaskIds = new Set(slots.filter((s) => !s.completed).map((s) => s.task_id));
      const unaccomplishedToday: string[] = [];
      tasks.forEach((t) => {
        if (!scheduledTaskIds.has(t.id)) unaccomplishedToday.push(t.title);
      });
      slots.filter((s) => !s.completed).forEach((s) => {
        if (s.title) unaccomplishedToday.push(s.title);
      });
      return {
        date: viewDate,
        accomplished: accomplished.map((a) => ({ title: a.title, completed_at: a.completed_at })),
        taskList: taskListWithFlags,
        unaccomplishedToday: [...new Set(unaccomplishedToday)],
        slotsToday: slots.map((s) => ({
          task_id: s.task_id,
          title: s.title,
          start_time: s.start_time,
          end_time: s.end_time,
          completed: !!s.completed,
        })),
      };
    })
  );
}

export function AIPanel({ aiEnabled, viewDate, onRefresh, width: controlledWidth, collapsed: controlledCollapsed }: Props) {
  const [message, setMessage] = useState('');
  const [advice, setAdvice] = useState('');
  const [suggestedTasks, setSuggestedTasks] = useState<Array<{ title: string; priority?: string; suggestedSlot?: string }>>([]);
  const [sending, setSending] = useState(false);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsedControlled = controlledCollapsed !== undefined;
  const collapsed = isCollapsedControlled ? controlledCollapsed : internalCollapsed;
  const setCollapsed = isCollapsedControlled ? () => {} : setInternalCollapsed;
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const width = controlledWidth ?? getStoredRightPanelWidth();

  const handleSend = async () => {
    if (!aiEnabled || !message.trim()) return;
    setSending(true);
    setAdvice('Loading…');
    setSuggestedTasks([]);
    try {
      const taskContext = await buildTaskContext(viewDate);
      const res = await api.chat.send(message.trim(), taskContext);
      setAdvice(res.advice || 'No advice returned.');
      setSuggestedTasks(res.suggestedTasks ?? []);
      setMessage('');
    } catch (err) {
      setAdvice(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSending(false);
    }
  };

  const addToList = (title: string, priority: string) => {
    api.tasks
      .create({ title, priority: (priority as Priority) || 'medium' })
      .then(onRefresh)
      .catch(console.error);
  };

  const addToSlot = async (title: string, priority: string) => {
    const day = await api.day.getOrCreate(viewDate);
    const settings = await api.settings.get();
    const startMin = settings.start_hour * 60;
    const inc = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
    const startTime = String(settings.start_hour).padStart(2, '0') + ':00';
    const endMin = startMin + inc;
    const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
    const created = await api.tasks.create({ title, priority: (priority as Priority) || 'medium' });
    await api.slots.create({ day_record_id: day.id, task_id: created.id, start_time: startTime, end_time: endTime });
    onRefresh();
  };

  return (
    <div
      ref={rightPanelRef}
      className={'right-panel' + (collapsed ? ' chat-collapsed' : '')}
      style={!collapsed ? { flex: `0 0 ${width}px` } : undefined}
    >
      <button
        type="button"
        className="chat-toggle-float"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? 'Show AI' : 'Hide AI'}
      </button>
        <div className={'right-top panel-section' + (!aiEnabled ? ' chat-panel-disabled' : '')} data-tooltip={!aiEnabled ? 'AI is currently disabled' : undefined}>
          <div className="section-header">
            <h2>AI</h2>
          </div>
          <textarea
            id="chat-input"
            className="chat-input"
            placeholder="Ask for advice or task suggestions…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!aiEnabled}
            rows={3}
          />
          <button
            type="button"
            id="chat-send"
            className="button-primary"
            style={{ marginTop: '0.35rem' }}
            disabled={!aiEnabled || sending || !message.trim()}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
        <div className="right-bottom panel-section">
          {advice && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Advice</div>
              <div id="chat-advice" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{advice}</div>
            </div>
          )}
          {suggestedTasks.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Suggested tasks</div>
              <div id="suggested-tasks">
                {suggestedTasks.map((sug, i) => (
                  <div key={i} className="suggested-task-item" style={{ marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                    <span className="suggested-task-title" style={{ flex: '1 1 100%', minWidth: 0 }}>{sug.title}</span>
                    <button type="button" className="button-secondary" style={{ fontSize: '0.8rem' }} onClick={() => addToList(sug.title, sug.priority ?? 'medium')}>
                      Add to list
                    </button>
                    <button type="button" className="button-secondary" style={{ fontSize: '0.8rem' }} onClick={() => addToSlot(sug.title, sug.priority ?? 'medium')}>
                      Add to slot
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
