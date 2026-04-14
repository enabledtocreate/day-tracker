'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type Priority } from '@/lib/api';
import type {
  AiAssistantResponse,
  AiContextFragment,
  AiDataRequest,
  AiFlattenedProposalTask,
  AiMessageRow,
} from '@/lib/aiTypes';
import { Modal } from '@/components/Modal';
import { SchedulePreviewGrid } from '@/components/SchedulePreviewGrid';
import {
  applyAiAssistantPlan,
  buildProposedPreviewSlots,
  collectPreviewDates,
  flattenProposals,
  isApplyBlocked,
  normalizeAiPriority,
  slotPreviewRequired,
  type PreviewProposedSlot,
} from '@/lib/aiApply';
import type { ScheduledSlot, TimeSettings } from '@/lib/api';
import { DT } from '@/lib/uiIdentifiers';

const RIGHT_PANEL_STORAGE_KEY = 'daytracker_right_panel_width';
const DEFAULT_RIGHT_WIDTH = 320;
const ACTIVE_THREAD_KEY = 'daytracker_ai_active_thread_id';

function transcriptEntryFromMessageRow(m: AiMessageRow): TranscriptEntry | null {
  try {
    const p = JSON.parse(m.payload_json) as Record<string, unknown>;
    const at = typeof p.at === 'number' ? p.at : Date.parse(m.created_at) || Date.now();
    if (m.role === 'user') {
      const text = typeof p.text === 'string' ? p.text : '';
      if (!text) return null;
      return { role: 'user', text, at };
    }
    const summary = typeof p.summary === 'string' ? p.summary : '';
    const envRaw = p.envelope;
    let envelope: AiAssistantResponse;
    if (envRaw && typeof envRaw === 'object' && envRaw !== null && 'advice' in envRaw) {
      envelope = envRaw as AiAssistantResponse;
    } else {
      envelope = {
        schemaVersion: 1,
        kind: 'plan',
        advice: { summary, bullets: [] },
        dataRequests: [],
        proposals: [],
      };
    }
    return { role: 'assistant', text: summary || envelope.advice.summary, at, envelope };
  } catch {
    return null;
  }
}

function lastAssistantEnvelopeFromMessages(messages: AiMessageRow[]): AiAssistantResponse | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    const e = transcriptEntryFromMessageRow(messages[i]);
    if (e?.role === 'assistant') return e.envelope;
  }
  return null;
}

function getStoredRightPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RIGHT_WIDTH;
  const w = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
  if (w == null) return DEFAULT_RIGHT_WIDTH;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 280 ? n : DEFAULT_RIGHT_WIDTH;
}

type TranscriptEntry =
  | { role: 'user'; text: string; at: number }
  | { role: 'assistant'; text: string; at: number; envelope: AiAssistantResponse };

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
    api.organization.list(),
  ]).then(([accomplishedRes, tasksRes, dayRes, organization]) =>
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
        organization: {
          categories: organization.categories.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null })),
          subcategories: organization.subcategories.map((s) => ({
            id: s.id,
            category_id: s.category_id,
            name: s.name,
          })),
          tags: organization.tags.map((t) => ({ id: t.id, name: t.name, color: t.color ?? null })),
        },
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

export function AIPanel({
  aiEnabled,
  viewDate,
  onRefresh,
  width: controlledWidth,
  collapsed: controlledCollapsed,
}: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [threadHydrating, setThreadHydrating] = useState(false);
  const [lastUserText, setLastUserText] = useState('');
  const [contextFragments, setContextFragments] = useState<AiContextFragment[]>([]);
  const [lastAssistantEnvelope, setLastAssistantEnvelope] = useState<AiAssistantResponse | null>(null);
  const [editedRows, setEditedRows] = useState<AiFlattenedProposalTask[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    settings: TimeSettings;
    dates: string[];
    baseline: Record<string, ScheduledSlot[]>;
    proposed: PreviewProposedSlot[];
  } | null>(null);
  const collapsed = controlledCollapsed ?? false;
  const width = controlledWidth ?? getStoredRightPanelWidth();

  useEffect(() => {
    if (!aiEnabled) {
      setActiveThreadId(null);
      setThreadHydrating(false);
      return;
    }
    let cancelled = false;
    setThreadHydrating(true);
    setLocalError(null);
    (async () => {
      try {
        const { threads } = await api.ai.threads.list();
        if (cancelled) return;
        const stored =
          typeof window !== 'undefined' ? parseInt(localStorage.getItem(ACTIVE_THREAD_KEY) || '', 10) : NaN;
        let tid: number | null = null;
        if (Number.isFinite(stored) && threads.some((t) => t.id === stored)) {
          tid = stored;
        } else if (threads.length > 0) {
          tid = threads[0].id;
        }
        if (tid == null) {
          const { thread } = await api.ai.threads.create();
          if (cancelled) return;
          tid = thread.id;
        }
        if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_THREAD_KEY, String(tid));
        const { messages } = await api.ai.threads.get(tid);
        if (cancelled) return;
        setActiveThreadId(tid);
        const entries: TranscriptEntry[] = [];
        for (const m of messages) {
          const e = transcriptEntryFromMessageRow(m);
          if (e) entries.push(e);
        }
        setTranscript(entries);
        const env = lastAssistantEnvelopeFromMessages(messages);
        if (env) {
          setLastAssistantEnvelope(env);
          setEditedRows(flattenProposals(env));
          setPreviewAccepted(false);
        } else {
          setLastAssistantEnvelope(null);
          setEditedRows([]);
          setPreviewAccepted(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Could not load AI conversation.');
          setActiveThreadId(null);
        }
      } finally {
        if (!cancelled) setThreadHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiEnabled]);

  useEffect(() => {
    const reqs = lastAssistantEnvelope?.dataRequests ?? [];
    setSelectedRequestIds(new Set(reqs.map((r) => r.id)));
  }, [lastAssistantEnvelope?.dataRequests]);

  const syncRowsFromEnvelope = useCallback((env: AiAssistantResponse) => {
    setLastAssistantEnvelope(env);
    setEditedRows(flattenProposals(env));
    setPreviewAccepted(false);
  }, []);

  const sendChat = useCallback(
    async (userText: string, fragments: AiContextFragment[], threadId: number | null) => {
      const taskContext = await buildTaskContext(viewDate);
      return api.chat.send({
        message: userText,
        viewDate,
        useServerContext: true,
        ...(threadId != null && threadId > 0
          ? { threadId, threadHistoryMax: 24 }
          : {}),
        contextOptions: { includeIcal: false, historyDays: 7 },
        taskContext,
        contextFragments: fragments,
      });
    },
    [viewDate]
  );

  const handleSend = async () => {
    if (!aiEnabled || !message.trim() || activeThreadId == null) return;
    setSending(true);
    setLocalError(null);
    const text = message.trim();
    setMessage('');
    setContextFragments([]);
    setLastUserText(text);
    const at = Date.now();
    try {
      await api.ai.threads.append(activeThreadId, 'user', { text, at });
      setTranscript((t) => [...t, { role: 'user', text, at }]);
      const res = await sendChat(text, [], activeThreadId);
      await api.ai.threads.append(activeThreadId, 'assistant', {
        summary: res.advice.summary,
        envelope: res,
        at: Date.now(),
      });
      setTranscript((t) => [...t, { role: 'assistant', text: res.advice.summary, at: Date.now(), envelope: res }]);
      syncRowsFromEnvelope(res);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSending(false);
    }
  };

  const toggleRequest = (id: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApproveContext = async () => {
    const reqs = lastAssistantEnvelope?.dataRequests ?? [];
    if (!reqs.length || !lastUserText) return;
    const picked = reqs.filter((r) => selectedRequestIds.has(r.id));
    if (!picked.length) {
      setLocalError('Select at least one data request.');
      return;
    }
    setResolving(true);
    setLocalError(null);
    try {
      const body = {
        dataRequests: picked.map((r: AiDataRequest) => ({
          id: r.id,
          queryId: r.queryId,
          params: r.params ?? {},
        })),
      };
      const resolved = await api.ai.contextResolve(body);
      const merged = [...contextFragments, ...resolved.contextFragments];
      setContextFragments(merged);
      const followUp =
        'The user approved the requested data. Use contextFragments to continue.\n\nOriginal request:\n' + lastUserText;
      const res = await sendChat(followUp, merged, activeThreadId);
      if (activeThreadId != null) {
        await api.ai.threads.append(activeThreadId, 'assistant', {
          summary: res.advice.summary,
          envelope: res,
          at: Date.now(),
        });
      }
      setTranscript((t) => [...t, { role: 'assistant', text: res.advice.summary, at: Date.now(), envelope: res }]);
      syncRowsFromEnvelope(res);
      if (resolved.truncated) {
        setLocalError('Some context was truncated server-side (row cap).');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Context resolve failed.');
    } finally {
      setResolving(false);
    }
  };

  const openPreview = async () => {
    setLocalError(null);
    try {
      const settings = await api.settings.get();
      const proposed = buildProposedPreviewSlots(editedRows, viewDate, settings);
      const dates = collectPreviewDates(proposed, viewDate);
      const from = dates[0];
      const to = dates[dates.length - 1];
      const range = await api.slots.listByDateRange(from, to);
      setPreviewData({ settings, dates, baseline: range.byDate, proposed });
      setPreviewOpen(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not load preview.');
    }
  };

  const handlePreviewAccept = () => {
    setPreviewAccepted(true);
    setPreviewOpen(false);
  };

  /** Reject dismisses preview only; proposals remain editable/appliable. */
  const handlePreviewReject = () => {
    setPreviewAccepted(false);
    setPreviewOpen(false);
  };

  const handleApply = async () => {
    if (!editedRows.length || applyDisabled) return;
    setApplying(true);
    setLocalError(null);
    try {
      const settings = await api.settings.get();
      if (!lastAssistantEnvelope) return;
      await applyAiAssistantPlan(lastAssistantEnvelope, editedRows, viewDate, settings);
      onRefresh();
      setLastAssistantEnvelope(null);
      setEditedRows([]);
      setPreviewAccepted(false);
      setPreviewData(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Apply stopped on error.');
    } finally {
      setApplying(false);
    }
  };

  const updateRowTitle = (index: number, title: string) => {
    setPreviewAccepted(false);
    setEditedRows((rows) => {
      const copy = [...rows];
      const row = copy[index];
      if (!row) return rows;
      copy[index] = { ...row, task: { ...row.task, title } };
      return copy;
    });
  };

  const needPreviewGate = slotPreviewRequired(editedRows);
  const applyDisabled =
    !lastAssistantEnvelope ||
    isApplyBlocked(lastAssistantEnvelope) ||
    editedRows.length === 0 ||
    (needPreviewGate && !previewAccepted) ||
    applying;

  const pendingData = lastAssistantEnvelope?.dataRequests ?? [];

  return (
    <div
      className={`right-panel ${DT.smartPlanningShell}${collapsed ? ' chat-collapsed' : ''}`}
      style={!collapsed ? { flex: `0 0 ${width}px` } : undefined}
    >
      <div
        className={'right-top panel-section' + (!aiEnabled ? ' chat-panel-disabled' : '')}
        data-tooltip={!aiEnabled ? 'AI is currently disabled' : undefined}
      >
        <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2>Smart Planning</h2>
          <button
            type="button"
            className="button-secondary"
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.45rem' }}
            disabled={!aiEnabled || threadHydrating}
            onClick={async () => {
              if (!aiEnabled) return;
              setLocalError(null);
              try {
                const { thread } = await api.ai.threads.create();
                if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_THREAD_KEY, String(thread.id));
                setActiveThreadId(thread.id);
                setTranscript([]);
                setLastAssistantEnvelope(null);
                setEditedRows([]);
                setPreviewAccepted(false);
                setContextFragments([]);
                setLastUserText('');
                setPreviewData(null);
                setPreviewOpen(false);
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Could not start new chat.');
              }
            }}
          >
            New chat
          </button>
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
          disabled={!aiEnabled || sending || !message.trim() || threadHydrating || activeThreadId == null}
          onClick={handleSend}
        >
          Send
        </button>
      </div>
      <div className="right-bottom panel-section">
        {localError && (
          <p className="task-list-error" role="alert" style={{ marginBottom: '0.5rem' }}>
            {localError}
          </p>
        )}
        <div id="ai-transcript" className="ai-transcript" aria-label="Chat transcript">
          {threadHydrating ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading conversation…</div>
          ) : transcript.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No messages yet.</div>
          ) : (
            transcript.map((e, i) =>
              e.role === 'user' ? (
                <div key={i} className="ai-transcript-entry-user">
                  {e.text}
                </div>
              ) : (
                <div key={i} className="ai-transcript-entry-assistant" id={i === transcript.length - 1 ? 'chat-advice' : undefined}>
                  {e.text}
                </div>
              )
            )
          )}
        </div>

        {pendingData.length > 0 && (
          <div className="ai-data-requests">
            <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Data requests</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Select what to share with the assistant, then approve.
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {pendingData.map((r) => (
                <li key={r.id} style={{ marginBottom: '0.35rem' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={selectedRequestIds.has(r.id)}
                      onChange={() => toggleRequest(r.id)}
                    />
                    <span>
                      <strong>{r.queryId}</strong>
                      {r.userFacingReason ? ` — ${r.userFacingReason}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="button-secondary"
              style={{ marginTop: '0.5rem' }}
              disabled={!aiEnabled || resolving || sending}
              onClick={handleApproveContext}
            >
              {resolving ? 'Resolving…' : 'Approve context'}
            </button>
          </div>
        )}

        {lastAssistantEnvelope && (lastAssistantEnvelope.advice.bullets?.length ?? 0) > 0 && (
          <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            {(lastAssistantEnvelope.advice.bullets ?? []).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}

        {lastAssistantEnvelope &&
          (lastAssistantEnvelope.proposals ?? []).some((g) => (g.questionsForUser?.length ?? 0) > 0) && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 600 }}>Questions</div>
              {(lastAssistantEnvelope.proposals ?? []).flatMap((g) =>
                (g.questionsForUser ?? []).map((q, i) => (
                  <div key={g.id + i} style={{ marginTop: '0.25rem' }}>
                    {q.text}
                    {q.blocksProposalApply ? <span style={{ color: 'var(--high)' }}> (blocks Apply)</span> : null}
                  </div>
                ))
              )}
            </div>
          )}

        {lastAssistantEnvelope && (lastAssistantEnvelope.proposedOrgCreates?.length ?? 0) > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <div style={{ fontWeight: 600 }}>New labels to create on apply</div>
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
              {(lastAssistantEnvelope.proposedOrgCreates ?? []).map((o, i) => (
                <li key={i}>
                  <strong>{o.kind}</strong>: {o.name}
                  {o.tempId ? ` (${o.tempId})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {editedRows.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Proposed tasks (edit before apply)
            </div>
            {editedRows.map((row, i) => (
              <div key={i} style={{ marginBottom: '0.65rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{row.groupTitle || row.proposalGroupId}</div>
                <input
                  className="ai-proposal-edit"
                  aria-label={`Proposed task title ${i + 1}`}
                  value={row.task.title}
                  onChange={(e) => updateRowTitle(i, e.target.value)}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem' }}>Priority</span>
                  <select
                    className="ai-proposal-edit"
                    aria-label={`Priority for ${row.task.title || 'task'}`}
                    style={{ width: 'auto', minWidth: '7rem' }}
                    value={normalizeAiPriority(row.task.priority)}
                    onChange={(e) => {
                      setPreviewAccepted(false);
                      const p = e.target.value as Priority;
                      setEditedRows((rows) => {
                        const c = [...rows];
                        if (c[i]) c[i] = { ...c[i], task: { ...c[i].task, priority: p } };
                        return c;
                      });
                    }}
                  >
                    <option value="commitment">commitment</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                </div>
                {(row.task.newTagSuggestions?.length ?? 0) > 0 && (
                  <div className="ai-manual-note">New tags (created on apply if missing): {row.task.newTagSuggestions.join(', ')}</div>
                )}
                {row.task.groupWithTaskId != null && (
                  <div className="ai-manual-note">Group with task #{row.task.groupWithTaskId} — not applied automatically.</div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
              {needPreviewGate && (
                <button type="button" className="button-secondary" onClick={openPreview} disabled={sending}>
                  Preview schedule
                </button>
              )}
              <button
                type="button"
                id="ai-apply"
                className="button-primary"
                disabled={!aiEnabled || applyDisabled}
                onClick={handleApply}
              >
                {applying ? 'Applying…' : 'Apply proposals'}
              </button>
            </div>
            {needPreviewGate && !previewAccepted && (
              <p className="ai-manual-note">Open preview and accept before applying schedule changes.</p>
            )}
          </div>
        )}
      </div>

      {previewData && (
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="Preview schedule"
          aria-label="Preview schedule changes"
          actions={
            <>
              <button type="button" className="button-primary" onClick={handlePreviewAccept}>
                Accept
              </button>
              <button type="button" className="button-secondary" onClick={handlePreviewReject}>
                Reject
              </button>
            </>
          }
        >
          <SchedulePreviewGrid
            settings={previewData.settings}
            dates={previewData.dates}
            baselineByDate={previewData.baseline}
            proposedSlots={previewData.proposed}
          />
        </Modal>
      )}
    </div>
  );
}
