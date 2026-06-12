/**
 * AI assistant JSON protocol — see docs/Application-Spec.md §5.2 and contracts/ai/assistant-response.schema.json.
 */
export type AiResponseKind = 'plan' | 'need_context' | 'mixed';

export interface AiDataRequest {
  id: string;
  queryId: string;
  params?: Record<string, unknown>;
  userFacingReason?: string;
}

export interface AiListItems {
  listStyle: 'bullet' | 'checkbox';
  items: string[];
}

export interface AiSuggestedSlot {
  date: string | null;
  start: string | null;
  end: string | null;
}

/** Declares a category, subcategory, or tag to create; tasks reference these via *TempId fields. */
export interface AiProposedOrgCreate {
  tempId: string;
  kind: 'category' | 'subcategory' | 'tag';
  name: string;
  color?: string | null;
  parentCategoryId?: number | null;
  parentCategoryTempId?: string | null;
}

export interface AiProposedTask {
  title: string;
  priority?: string;
  recurrence?: unknown;
  suggestedSlot: AiSuggestedSlot;
  groupWithTaskId: number | null;
  tagIds: number[];
  /** Maps to proposedOrgCreates[].tempId where kind === "tag". */
  tagTempIds: string[];
  newTagSuggestions: string[];
  categoryId: number | null;
  subcategoryId: number | null;
  categoryTempId?: string | null;
  subcategoryTempId?: string | null;
  linkAttachments: Array<{ label: string; url: string }>;
  listItems?: AiListItems;
}

export interface AiCadence {
  frequency: string;
  dayOfWeek: string | null;
  timeOfDay: string | null;
  notes?: string;
}

export interface AiProposalGroup {
  id: string;
  groupTitle: string;
  groupSummary: string;
  horizon: string;
  prioritization: string;
  cadence: AiCadence;
  tasks: AiProposedTask[];
  questionsForUser: Array<{ text: string; blocksProposalApply?: boolean }>;
}

export interface AiAdvice {
  summary: string;
  bullets?: string[];
}

export interface AiClientHints {
  includeIcalEvents?: boolean;
  icalRangeDays?: number;
}

/** Assistant HTTP response (§5.2). */
export interface AiAssistantResponse {
  schemaVersion: number;
  kind: AiResponseKind;
  advice: AiAdvice;
  dataRequests: AiDataRequest[];
  proposals: AiProposalGroup[];
  /** New org rows to resolve before applying tasks (Spec §4.8 / SRS §3.8). */
  proposedOrgCreates?: AiProposedOrgCreate[];
  clientHints?: AiClientHints;
}

export interface AiContextFragment {
  dataRequestId: string;
  queryId: string;
  data: unknown;
}

export interface AiChatRequestBody {
  schemaVersion?: number;
  message: string;
  viewDate?: string;
  /** When true, PHP merges a server-built taskContext (server keys override client). */
  useServerContext?: boolean;
  /** Active thread; enables prior-turn summaries in the model request (see api/chat.php). */
  threadId?: number;
  /** Max prior user+assistant pairs loaded from thread DB (0–40, default 24). */
  threadHistoryMax?: number;
  contextOptions?: { includeIcal?: boolean; historyDays?: number };
  /** See contracts/ai/task-context.schema.json */
  taskContext?: Record<string, unknown>;
  contextFragments?: AiContextFragment[];
}

export interface AiContextResolveRequestBody {
  dataRequests: Array<{ id: string; queryId: string; params?: Record<string, unknown> }>;
}

export interface AiContextResolveResponse {
  contextFragments: AiContextFragment[];
  truncated?: boolean;
}

/** Normalized row for preview + apply (flattened from proposals). */
export interface AiFlattenedProposalTask {
  proposalGroupId: string;
  groupTitle: string;
  task: AiProposedTask;
}

/** Row from api/ai/threads.php (GET list). */
export interface AiThreadSummary {
  id: number;
  created_at: string;
  updated_at: string;
  title: string | null;
}

/** Message row from api/ai/threads.php (GET by id). */
export interface AiMessageRow {
  id: number;
  thread_id: number;
  role: 'user' | 'assistant';
  created_at: string;
  payload_json: string;
}
