import type { TimeSettings } from '@/lib/api';
import { parseBucketLabelsJson } from '@/lib/priorityTheme';

const SLUG = /^[a-z0-9_-]{1,32}$/;

export type BucketDef = { id: string; label: string };

export function parseBucketLayoutJson(raw: string | null | undefined): { version: 2; mode: 'custom'; buckets: BucketDef[] } | null {
  if (raw == null || raw === '') return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.mode !== 'custom' || !Array.isArray(o.buckets)) return null;
  const buckets: BucketDef[] = [];
  for (const row of o.buckets) {
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!SLUG.test(id)) continue;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 48) : '';
    buckets.push({ id, label: label || id });
  }
  const seen = new Set<string>();
  const uniq = buckets.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
  if (uniq.length < 2 || uniq.length > 16) return null;
  return { version: 2, mode: 'custom', buckets: uniq };
}

/** Ordered task-list buckets (default: unassigned + pending with optional renamed labels). */
export function bucketLayoutFromSettings(settings: TimeSettings): BucketDef[] {
  const custom = parseBucketLayoutJson(settings.bucket_layout_json ?? null);
  if (custom) return custom.buckets;
  const bl = parseBucketLabelsJson(settings.bucket_labels_json ?? null);
  return [
    { id: 'unassigned', label: bl.unassigned },
    { id: 'pending', label: bl.pending },
  ];
}

export function bucketLayoutCustomToJson(buckets: BucketDef[]): string {
  const clean = buckets
    .filter((b) => SLUG.test(b.id))
    .map((b) => ({
      id: b.id,
      label: (b.label || b.id).trim().slice(0, 48) || b.id,
    }));
  return JSON.stringify({ version: 2, mode: 'custom', buckets: clean });
}

export function canDropTaskOnBucketZone(args: {
  targetBucketId: string;
  source: string;
  primaryBucketId: string;
  allBucketIds: readonly string[];
  taskIds: number[];
  tasks: Array<{ id: number; parent_id: number | null }>;
}): boolean {
  const { targetBucketId, source, primaryBucketId, allBucketIds, taskIds, tasks } = args;
  const idSet = new Set(allBucketIds);
  const draggingSubtaskFromPrimary =
    source === primaryBucketId && taskIds.some((id) => tasks.find((t) => t.id === id)?.parent_id != null);
  if (targetBucketId === primaryBucketId) {
    return (
      source === 'schedule' ||
      source === 'common' ||
      (source !== primaryBucketId && idSet.has(source)) ||
      draggingSubtaskFromPrimary
    );
  }
  return (
    source === primaryBucketId ||
    source === 'schedule' ||
    source === 'common' ||
    (idSet.has(source) && source !== targetBucketId)
  );
}
