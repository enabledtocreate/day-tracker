import { describe, it, expect } from 'vitest';
import type { TimeSettings } from '@/lib/api';
import {
  PRIORITY_LEVELS,
  parsePriorityThemeJson,
  parseBucketLabelsJson,
  priorityThemeToJson,
  bucketLabelsToJson,
  buildPriorityDisplay,
  getDefaultPriorityDisplay,
  priorityDisplayFromSettings,
  bucketLabelsFromSettings,
  dueAutoPriorityTarget,
  DEFAULT_BUCKET_LABELS,
  resolvePriorityLayout,
} from './priorityTheme';

describe('parsePriorityThemeJson', () => {
  it('returns defaults for null, empty, and invalid JSON', () => {
    const a = parsePriorityThemeJson(null);
    const b = parsePriorityThemeJson('');
    const c = parsePriorityThemeJson('not json');
    for (const t of [a, b, c]) {
      expect(t.commitment.label).toBe('Commitment');
      expect(t.low.icon).toBe('↓');
    }
    expect(PRIORITY_LEVELS).toEqual(['commitment', 'high', 'medium', 'low']);
  });

  it('merges partial custom label and icon', () => {
    const raw = JSON.stringify({
      high: { label: 'Urgent', icon: '!' },
    });
    const t = parsePriorityThemeJson(raw);
    expect(t.high.label).toBe('Urgent');
    expect(t.high.icon).toBe('!');
    expect(t.commitment.label).toBe('Commitment');
  });

  it('accepts valid hex colors and drops invalid', () => {
    const raw = JSON.stringify({
      low: { label: 'Low', icon: '↓', color: '#abc' },
      medium: { label: 'M', icon: '●', color: 'not-a-color' },
    });
    const t = parsePriorityThemeJson(raw);
    expect(t.low.color).toBe('#abc');
    expect(t.medium.color).toBeUndefined();
  });
});

describe('parseBucketLabelsJson', () => {
  it('returns defaults when empty or invalid', () => {
    expect(parseBucketLabelsJson(null)).toEqual(DEFAULT_BUCKET_LABELS);
    expect(parseBucketLabelsJson('')).toEqual(DEFAULT_BUCKET_LABELS);
    expect(parseBucketLabelsJson('x')).toEqual(DEFAULT_BUCKET_LABELS);
  });

  it('parses custom labels with length clamping implied by parser', () => {
    const j = JSON.stringify({ unassigned: 'Inbox', pending: 'Later' });
    const b = parseBucketLabelsJson(j);
    expect(b.unassigned).toBe('Inbox');
    expect(b.pending).toBe('Later');
  });
});

describe('priorityThemeToJson and round-trip', () => {
  it('serializes all four levels and parse restores display', () => {
    const a = parsePriorityThemeJson(null);
    a.high = { label: 'H2', icon: 'H', color: '#112233' };
    const json = priorityThemeToJson(a);
    const b = parsePriorityThemeJson(json);
    expect(b.high).toEqual(a.high);
  });
});

describe('bucketLabelsToJson', () => {
  it('round-trips with parseBucketLabelsJson', () => {
    const labels = { unassigned: 'A', pending: 'B' };
    expect(parseBucketLabelsJson(bucketLabelsToJson(labels))).toEqual(labels);
  });
});

describe('buildPriorityDisplay and helpers', () => {
  it('getDefaultPriorityDisplay has stable levels order', () => {
    const d = getDefaultPriorityDisplay();
    expect(d.levels).toEqual(PRIORITY_LEVELS);
    expect(d.label('high')).toBe('High');
    expect(d.icon('commitment')).toBe('★');
    expect(d.colorStyle('low')).toBeUndefined();
    expect(d.priorityRank('high')).toBeLessThan(d.priorityRank('low'));
  });

  it('colorStyle returns inline color when theme has hex', () => {
    const theme = parsePriorityThemeJson(
      JSON.stringify({ low: { label: 'L', icon: '↓', color: '#00ff00' } })
    );
    const d = buildPriorityDisplay(theme);
    expect(d.colorStyle('low')).toEqual({ color: '#00ff00' });
  });

  it('priorityDisplayFromSettings reads priority_theme_json string', () => {
    const settings = {
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min' as const,
      priority_theme_json: JSON.stringify({
        commitment: { label: 'Must', icon: '★' },
        high: { label: 'H', icon: '↑' },
        medium: { label: 'M', icon: '●' },
        low: { label: 'L', icon: '↓' },
      }),
    } satisfies TimeSettings;
    const d = priorityDisplayFromSettings(settings);
    expect(d.label('commitment')).toBe('Must');
  });

  it('bucketLabelsFromSettings reads bucket_labels_json', () => {
    const settings = {
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min' as const,
      bucket_labels_json: JSON.stringify({ unassigned: 'Queue', pending: 'Someday' }),
    } satisfies TimeSettings;
    expect(bucketLabelsFromSettings(settings)).toEqual({ unassigned: 'Queue', pending: 'Someday' });
  });

  it('resolvePriorityLayout uses custom ids when priority_layout_json is set', () => {
    const settings = {
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min' as const,
      priority_layout_json: JSON.stringify({
        version: 2,
        mode: 'custom',
        priorities: [
          { id: 'alpha', label: 'Alpha', icon: 'A' },
          { id: 'beta', label: 'Beta', icon: 'B' },
        ],
      }),
    } satisfies TimeSettings;
    const r = resolvePriorityLayout(settings);
    expect(r.mode).toBe('custom');
    expect(r.levels).toEqual(['alpha', 'beta']);
    expect(r.byId.alpha?.label).toBe('Alpha');
  });

  it('dueAutoPriorityTarget defaults to high and accepts all levels', () => {
    const base = {
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min' as const,
    } satisfies TimeSettings;
    expect(dueAutoPriorityTarget(base)).toBe('high');
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: 'medium' })).toBe('medium');
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: 'commitment' })).toBe('commitment');
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: null })).toBe('high');
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: undefined })).toBe('high');
  });

  it('dueAutoPriorityTarget respects custom layout slugs', () => {
    const base = {
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min' as const,
      priority_layout_json: JSON.stringify({
        version: 2,
        mode: 'custom',
        priorities: [
          { id: 'alpha', label: 'Alpha', icon: 'A' },
          { id: 'beta', label: 'Beta', icon: 'B' },
        ],
      }),
    } satisfies TimeSettings;
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: 'beta' })).toBe('beta');
    expect(dueAutoPriorityTarget({ ...base, due_auto_priority_target: 'high' })).toBe('alpha');
  });
});
