/**
 * Flatten AI proposals, preview slot helpers, and sequential Apply (tasks, org PATCH, links, list items, slots).
 */
import { api, type Priority, type ListStyle, type TimeSettings } from './api';
import type {
  AiAssistantResponse,
  AiFlattenedProposalTask,
  AiProposedOrgCreate,
  AiProposedTask,
  AiSuggestedSlot,
} from './aiTypes';

const PRIORITIES: Priority[] = ['commitment', 'high', 'medium', 'low'];

export type PreviewProposedSlot = {
  key: string;
  date: string;
  title: string;
  start: string;
  end: string;
};

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function normalizeAiPriority(p: string | undefined): Priority {
  const x = (p || 'medium').toLowerCase();
  if (PRIORITIES.includes(x as Priority)) return x as Priority;
  return 'medium';
}

export function mapListStyle(style: 'bullet' | 'checkbox' | undefined): ListStyle | undefined {
  if (!style) return undefined;
  if (style === 'checkbox') return 'checklist';
  return 'bullet';
}

function normalizeProposedTask(t: Partial<AiProposedTask>): AiProposedTask {
  const tagTempIds = Array.isArray(t.tagTempIds)
    ? t.tagTempIds.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const catTemp =
    t.categoryTempId != null && String(t.categoryTempId).trim() !== ''
      ? String(t.categoryTempId).trim()
      : null;
  const subTemp =
    t.subcategoryTempId != null && String(t.subcategoryTempId).trim() !== ''
      ? String(t.subcategoryTempId).trim()
      : null;
  return {
    title: String(t.title || '').trim(),
    priority: t.priority,
    recurrence: t.recurrence,
    suggestedSlot: {
      date: t.suggestedSlot?.date ?? null,
      start: t.suggestedSlot?.start ?? null,
      end: t.suggestedSlot?.end ?? null,
    },
    groupWithTaskId: t.groupWithTaskId ?? null,
    tagIds: Array.isArray(t.tagIds) ? t.tagIds.map(Number) : [],
    tagTempIds,
    newTagSuggestions: Array.isArray(t.newTagSuggestions) ? t.newTagSuggestions : [],
    categoryId: t.categoryId ?? null,
    subcategoryId: t.subcategoryId ?? null,
    categoryTempId: catTemp,
    subcategoryTempId: subTemp,
    linkAttachments: Array.isArray(t.linkAttachments) ? t.linkAttachments : [],
    listItems: t.listItems,
  };
}

export function flattenProposals(res: AiAssistantResponse): AiFlattenedProposalTask[] {
  const out: AiFlattenedProposalTask[] = [];
  for (const g of res.proposals || []) {
    for (const raw of g.tasks || []) {
      if (!raw || typeof raw !== 'object') continue;
      const t = normalizeProposedTask(raw);
      if (!t.title) continue;
      out.push({
        proposalGroupId: g.id || '',
        groupTitle: g.groupTitle || '',
        task: t,
      });
    }
  }
  return out;
}

export function isApplyBlocked(res: AiAssistantResponse | null): boolean {
  if (!res) return true;
  if ((res.dataRequests?.length ?? 0) > 0) return true;
  for (const g of res.proposals || []) {
    for (const q of g.questionsForUser || []) {
      if (q.blocksProposalApply) return true;
    }
  }
  return false;
}

export function wantsScheduleSlot(t: AiProposedTask): boolean {
  const s = t.suggestedSlot;
  if (!s) return false;
  return s.date != null || s.start != null || s.end != null;
}

/**
 * Resolve calendar times for a proposed task; uses schedule grid defaults when times omitted.
 */
export function resolveSlotTimesForProposal(
  slot: AiSuggestedSlot | undefined,
  viewDateFallback: string,
  settings: TimeSettings
): { date: string; start: string; end: string } {
  const rawDate = slot?.date?.trim();
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : viewDateFallback;
  const inc = settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
  const dayStartMin = settings.start_hour * 60;
  let startMin = dayStartMin;
  let endMin = dayStartMin + Math.max(5, inc);
  if (slot?.start && slot.start.includes(':')) {
    startMin = timeToMinutes(slot.start);
  }
  if (slot?.end && slot.end.includes(':')) {
    endMin = timeToMinutes(slot.end);
  } else if (slot?.start && slot.start.includes(':')) {
    endMin = startMin + Math.max(5, inc);
  }
  if (endMin <= startMin) {
    endMin = startMin + Math.max(5, inc);
  }
  return { date, start: minutesToTime(startMin), end: minutesToTime(endMin) };
}

export function buildProposedPreviewSlots(
  rows: AiFlattenedProposalTask[],
  viewDateFallback: string,
  settings: TimeSettings
): PreviewProposedSlot[] {
  const out: PreviewProposedSlot[] = [];
  rows.forEach((row, i) => {
    const t = row.task;
    if (!wantsScheduleSlot(t)) return;
    const { date, start, end } = resolveSlotTimesForProposal(t.suggestedSlot, viewDateFallback, settings);
    out.push({
      key: `${row.proposalGroupId}-${i}-${t.title}`,
      date,
      title: t.title,
      start,
      end,
    });
  });
  return out;
}

export function collectPreviewDates(
  proposed: PreviewProposedSlot[],
  viewDateFallback: string
): string[] {
  const set = new Set<string>();
  for (const p of proposed) {
    set.add(p.date);
  }
  set.add(viewDateFallback);
  return Array.from(set).sort();
}

export function slotPreviewRequired(rows: AiFlattenedProposalTask[]): boolean {
  return rows.some((r) => wantsScheduleSlot(r.task));
}

type OrgListState = {
  categories: Array<{ id: number; name: string; color?: string | null }>;
  subcategories: Array<{ id: number; category_id: number; name: string }>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
};

type OrgTempMaps = {
  cat: Record<string, number>;
  sub: Record<string, number>;
  tag: Record<string, number>;
  org: OrgListState;
};

/**
 * Create or reuse categories, subcategories, and tags from the assistant envelope.
 * Order: categories → subcategories (parents may be numeric ids or temp ids) → tags.
 */
export async function resolveProposedOrgCreates(creates: AiProposedOrgCreate[] | undefined): Promise<OrgTempMaps> {
  const initial = await api.organization.list();
  const org: OrgListState = {
    categories: [...initial.categories],
    subcategories: [...initial.subcategories],
    tags: [...initial.tags],
  };
  const cat: Record<string, number> = {};
  const sub: Record<string, number> = {};
  const tag: Record<string, number> = {};

  const findCat = (name: string) =>
    org.categories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;
  const findSub = (categoryId: number, name: string) =>
    org.subcategories.find(
      (s) => s.category_id === categoryId && s.name.trim().toLowerCase() === name.trim().toLowerCase()
    )?.id;
  const findTag = (name: string) =>
    org.tags.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;

  const list = (creates ?? []).filter(Boolean).slice(0, 25);

  for (const raw of list) {
    if (raw.kind !== 'category') continue;
    const tempId = String(raw.tempId ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!tempId || !name) continue;
    let id = findCat(name);
    if (id == null) {
      const r = await api.organization.createCategory({
        name,
        ...(raw.color != null && String(raw.color).trim() !== '' ? { color: String(raw.color).trim() } : {}),
      });
      id = r.id;
      org.categories.push({ id: r.id, name: r.name, color: r.color });
    }
    cat[tempId] = id;
  }

  for (const raw of list) {
    if (raw.kind !== 'subcategory') continue;
    const tempId = String(raw.tempId ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!tempId || !name) continue;
    let parentId: number | undefined;
    if (raw.parentCategoryId != null && Number(raw.parentCategoryId) > 0) {
      parentId = Number(raw.parentCategoryId);
    } else if (raw.parentCategoryTempId) {
      const pid = cat[String(raw.parentCategoryTempId).trim()];
      if (pid != null && pid > 0) parentId = pid;
    }
    if (parentId == null || parentId <= 0) continue;
    let id = findSub(parentId, name);
    if (id == null) {
      const r = await api.organization.createSubcategory({ category_id: parentId, name });
      id = r.id;
      org.subcategories.push({ id: r.id, category_id: r.category_id, name: r.name });
    }
    sub[tempId] = id;
  }

  for (const raw of list) {
    if (raw.kind !== 'tag') continue;
    const tempId = String(raw.tempId ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!tempId || !name) continue;
    let id = findTag(name);
    if (id == null) {
      const r = await api.organization.createTag({
        name,
        ...(raw.color != null && String(raw.color).trim() !== '' ? { color: String(raw.color).trim() } : {}),
      });
      id = r.id;
      org.tags.push({ id: r.id, name: r.name, color: r.color });
    }
    tag[tempId] = id;
  }

  return { cat, sub, tag, org };
}

function resolveNumericCategoryId(t: AiProposedTask, maps: OrgTempMaps): number | null {
  const n = t.categoryId;
  if (n != null && Number(n) > 0) return Number(n);
  const tid = t.categoryTempId?.trim();
  if (tid && maps.cat[tid] != null) return maps.cat[tid];
  return null;
}

function resolveNumericSubcategoryId(t: AiProposedTask, maps: OrgTempMaps): number | null {
  const n = t.subcategoryId;
  if (n != null && Number(n) > 0) return Number(n);
  const tid = t.subcategoryTempId?.trim();
  if (tid && maps.sub[tid] != null) return maps.sub[tid];
  return null;
}

function collectTagIdsForTask(t: AiProposedTask, maps: OrgTempMaps): number[] {
  const set = new Set<number>();
  for (const id of t.tagIds ?? []) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  for (const tid of t.tagTempIds ?? []) {
    const k = String(tid).trim();
    if (!k) continue;
    const id = maps.tag[k];
    if (id != null && id > 0) set.add(id);
  }
  return [...set];
}

async function ensureTagIdsByName(names: string[], org: OrgListState): Promise<number[]> {
  const ids: number[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    let id = org.tags.find((t) => t.name.trim().toLowerCase() === name.toLowerCase())?.id;
    if (id == null) {
      const r = await api.organization.createTag({ name });
      id = r.id;
      org.tags.push({ id: r.id, name: r.name, color: r.color });
    }
    ids.push(id);
  }
  return ids;
}

export async function applyAiAssistantPlan(
  envelope: AiAssistantResponse,
  rows: AiFlattenedProposalTask[],
  viewDateFallback: string,
  settings: TimeSettings
): Promise<void> {
  const maps = await resolveProposedOrgCreates(envelope.proposedOrgCreates);

  for (const row of rows) {
    const t = row.task;
    if (!t.title?.trim()) continue;
    const priority = normalizeAiPriority(t.priority);
    const listStyle = mapListStyle(t.listItems?.listStyle);
    const created = await api.tasks.create({
      title: t.title.trim(),
      priority,
      ...(listStyle ? { list_style: listStyle } : {}),
    });
    const taskId = created.id;

    const categoryId = resolveNumericCategoryId(t, maps);
    const subcategoryId = resolveNumericSubcategoryId(t, maps);
    const tagIdsFromTask = collectTagIdsForTask(t, maps);
    const tagIdsFromSuggestions = await ensureTagIdsByName(t.newTagSuggestions ?? [], maps.org);
    const tagIds = [...new Set([...tagIdsFromTask, ...tagIdsFromSuggestions])];

    const hasOrg = categoryId != null || subcategoryId != null || tagIds.length > 0;
    if (hasOrg) {
      await api.tasks.update({
        id: taskId,
        ...(categoryId != null ? { category_id: categoryId } : {}),
        ...(subcategoryId != null ? { subcategory_id: subcategoryId } : {}),
        ...(tagIds.length ? { tag_ids: tagIds } : {}),
      });
    }

    for (const link of t.linkAttachments ?? []) {
      const url = link.url?.trim();
      if (!url) continue;
      await api.links.add({ task_id: taskId, url, description: link.label ?? link.url });
    }

    const items = t.listItems?.items ?? [];
    let order = 0;
    for (const line of items) {
      const content = String(line ?? '').trim();
      if (!content) continue;
      await api.taskListItems.create({ task_id: taskId, content, order_index: order });
      order += 1;
    }

    if (wantsScheduleSlot(t)) {
      const slotTimes = resolveSlotTimesForProposal(t.suggestedSlot, viewDateFallback, settings);
      const day = await api.day.getOrCreate(slotTimes.date);
      await api.slots.create({
        day_record_id: day.id,
        task_id: taskId,
        start_time: slotTimes.start,
        end_time: slotTimes.end,
      });
    }
  }
}

/** Apply flattened rows only (no proposedOrgCreates). Prefer {@link applyAiAssistantPlan} from the AI panel. */
export async function applyFlattenedProposals(
  rows: AiFlattenedProposalTask[],
  viewDateFallback: string,
  settings: TimeSettings
): Promise<void> {
  const empty: AiAssistantResponse = {
    schemaVersion: 1,
    kind: 'plan',
    advice: { summary: '', bullets: [] },
    dataRequests: [],
    proposals: [],
    proposedOrgCreates: [],
  };
  await applyAiAssistantPlan(empty, rows, viewDateFallback, settings);
}
