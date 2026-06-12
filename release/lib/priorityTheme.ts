import type { CSSProperties } from 'react';
import type { Priority, TimeSettings } from '@/lib/api';

export const PRIORITY_LEVELS: readonly Priority[] = ['commitment', 'high', 'medium', 'low'];

export type PriorityLevelStyle = {
  label: string;
  icon: string;
  /** CSS color (e.g. #c62828); empty = use built-in theme variables */
  color?: string;
};

export type PriorityThemeMap = Record<Priority, PriorityLevelStyle>;

export type BucketLabels = { unassigned: string; pending: string };

const DEFAULT_THEME: PriorityThemeMap = {
  commitment: { label: 'Commitment', icon: '!' },
  high: { label: 'High', icon: '↑' },
  medium: { label: 'Medium', icon: '●' },
  low: { label: 'Low', icon: '↓' },
};

export const DEFAULT_BUCKET_LABELS: BucketLabels = {
  unassigned: 'Unassigned',
  pending: 'Pending',
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SLUG = /^[a-z0-9_-]{1,32}$/;

function clampStr(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function sanitizeColor(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;
  return HEX.test(t) ? t : undefined;
}

/** Merge stored JSON with defaults; invalid JSON → defaults only. */
export function parsePriorityThemeJson(raw: string | null | undefined): PriorityThemeMap {
  if (raw == null || raw === '') return { ...DEFAULT_THEME };
  let obj: unknown;
  try {
    obj = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_THEME };
  }
  if (obj == null || typeof obj !== 'object') return { ...DEFAULT_THEME };
  const o = obj as Record<string, unknown>;
  const out: PriorityThemeMap = { ...DEFAULT_THEME };
  for (const key of PRIORITY_LEVELS) {
    const row = o[key];
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const label = clampStr(r.label, 48);
    const icon = clampStr(r.icon, 16);
    const colorRaw = clampStr(r.color, 32);
    const color = sanitizeColor(colorRaw);
    out[key] = {
      label: label || DEFAULT_THEME[key].label,
      icon: icon || DEFAULT_THEME[key].icon,
      ...(color ? { color } : {}),
    };
  }
  return out;
}

export function parseBucketLabelsJson(raw: string | null | undefined): BucketLabels {
  if (raw == null || raw === '') return { ...DEFAULT_BUCKET_LABELS };
  let obj: unknown;
  try {
    obj = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_BUCKET_LABELS };
  }
  if (obj == null || typeof obj !== 'object') return { ...DEFAULT_BUCKET_LABELS };
  const o = obj as Record<string, unknown>;
  const unassigned = clampStr(o.unassigned, 40) || DEFAULT_BUCKET_LABELS.unassigned;
  const pending = clampStr(o.pending, 40) || DEFAULT_BUCKET_LABELS.pending;
  return { unassigned, pending };
}

export function priorityThemeToJson(theme: PriorityThemeMap): string {
  const o: Record<string, { label: string; icon: string; color?: string }> = {};
  for (const key of PRIORITY_LEVELS) {
    const t = theme[key];
    o[key] = {
      label: t.label,
      icon: t.icon,
      ...(t.color ? { color: t.color } : {}),
    };
  }
  return JSON.stringify(o);
}

export function bucketLabelsToJson(labels: BucketLabels): string {
  return JSON.stringify({ unassigned: labels.unassigned, pending: labels.pending });
}

export type PriorityLayoutCustom = {
  version: 2;
  mode: 'custom';
  priorities: Array<{ id: string; label: string; icon: string; color?: string }>;
};

export function parsePriorityLayoutJson(raw: string | null | undefined): PriorityLayoutCustom | null {
  if (raw == null || raw === '') return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.mode !== 'custom' || !Array.isArray(o.priorities)) return null;
  const priorities: PriorityLayoutCustom['priorities'] = [];
  for (const row of o.priorities) {
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!SLUG.test(id)) continue;
    const label = clampStr(r.label, 48) || id;
    const icon = clampStr(r.icon, 16) || '●';
    const color = sanitizeColor(clampStr(r.color, 32));
    priorities.push({ id, label, icon, ...(color ? { color } : {}) });
  }
  const seen = new Set<string>();
  const uniq = priorities.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  if (uniq.length < 2 || uniq.length > 24) return null;
  return { version: 2, mode: 'custom', priorities: uniq };
}

export function priorityLayoutCustomToJson(priorities: PriorityLayoutCustom['priorities']): string {
  const clean = priorities
    .filter((p) => SLUG.test(p.id))
    .map((p) => ({
      id: p.id,
      label: (p.label || p.id).trim().slice(0, 48) || p.id,
      icon: (p.icon || '●').trim().slice(0, 16),
      ...(p.color && HEX.test(p.color) ? { color: p.color } : {}),
    }));
  return JSON.stringify({ version: 2, mode: 'custom', priorities: clean });
}

export type ResolvedPriorityLayout = {
  mode: 'default' | 'custom';
  levels: readonly string[];
  byId: Record<string, PriorityLevelStyle>;
};

export function resolvePriorityLayout(settings: TimeSettings): ResolvedPriorityLayout {
  const custom = parsePriorityLayoutJson(settings.priority_layout_json ?? null);
  if (custom && custom.priorities.length >= 2) {
    const byId: Record<string, PriorityLevelStyle> = {};
    for (const row of custom.priorities) {
      byId[row.id] = {
        label: row.label,
        icon: row.icon,
        ...(row.color ? { color: row.color } : {}),
      };
    }
    const levels = custom.priorities.map((p) => p.id);
    return { mode: 'custom', levels, byId };
  }
  const theme = parsePriorityThemeJson(settings.priority_theme_json ?? null);
  const byId: Record<string, PriorityLevelStyle> = {};
  for (const k of PRIORITY_LEVELS) {
    byId[k] = theme[k];
  }
  return { mode: 'default', levels: [...PRIORITY_LEVELS], byId };
}

export type PriorityDisplay = {
  mode: 'default' | 'custom';
  levels: readonly string[];
  theme: Record<string, PriorityLevelStyle>;
  label: (p: string | undefined) => string;
  icon: (p: string | undefined) => string;
  colorStyle: (p: string | undefined) => CSSProperties | undefined;
  priorityRank: (p: string | undefined) => number;
};

function makePriorityDisplay(mode: 'default' | 'custom', levels: readonly string[], byId: Record<string, PriorityLevelStyle>): PriorityDisplay {
  const fallback = levels[levels.length - 1] ?? 'low';
  return {
    mode,
    levels,
    theme: byId,
    label: (p) => {
      const k = p ?? fallback;
      return byId[k]?.label ?? DEFAULT_THEME[k as Priority]?.label ?? String(k);
    },
    icon: (p) => {
      const k = p ?? fallback;
      return byId[k]?.icon ?? DEFAULT_THEME[k as Priority]?.icon ?? '●';
    },
    colorStyle: (p) => {
      const k = p ?? fallback;
      const c = byId[k]?.color;
      return c ? { color: c } : undefined;
    },
    priorityRank: (p) => {
      const k = p ?? fallback;
      const i = levels.indexOf(k);
      return i >= 0 ? i : levels.length;
    },
  };
}

export function buildPriorityDisplay(theme: PriorityThemeMap): PriorityDisplay {
  const byId: Record<string, PriorityLevelStyle> = {};
  for (const k of PRIORITY_LEVELS) {
    byId[k] = theme[k];
  }
  return makePriorityDisplay('default', PRIORITY_LEVELS, byId);
}

let defaultDisplay: PriorityDisplay | null = null;
export function getDefaultPriorityDisplay(): PriorityDisplay {
  if (!defaultDisplay) defaultDisplay = buildPriorityDisplay({ ...DEFAULT_THEME });
  return defaultDisplay;
}

export function priorityDisplayFromSettings(settings: TimeSettings): PriorityDisplay {
  const { mode, levels, byId } = resolvePriorityLayout(settings);
  return makePriorityDisplay(mode, levels, byId);
}

export function bucketLabelsFromSettings(settings: TimeSettings): BucketLabels {
  return parseBucketLabelsJson(settings.bucket_labels_json ?? null);
}

export function dueAutoPriorityTarget(settings: TimeSettings): string {
  const { levels } = resolvePriorityLayout(settings);
  const t = settings.due_auto_priority_target;
  if (typeof t === 'string' && levels.includes(t)) return t;
  if (levels.includes('high')) return 'high';
  return levels[0] ?? 'high';
}
