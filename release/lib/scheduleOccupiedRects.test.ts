import { describe, expect, it } from 'vitest';
import { computeOverlapLayouts, computeOverlapMaps } from '@/lib/scheduleOccupiedRects';

describe('computeOverlapMaps', () => {
  it('places non-overlapping events in the same column', () => {
    // 5:45–7:15, 6:45–8:45, 7:45–8:45 (minutes from midnight)
    const blocks = [
      { key: 'a', startMin: 17 * 60 + 45, endMin: 19 * 60 + 15 },
      { key: 'b', startMin: 18 * 60 + 45, endMin: 20 * 60 + 45 },
      { key: 'c', startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 },
    ];
    const map = computeOverlapMaps(blocks);
    expect(map.get('a')).toEqual({ col: 0, total: 2 });
    expect(map.get('b')).toEqual({ col: 1, total: 2 });
    // c does not overlap a — shares column 0
    expect(map.get('c')).toEqual({ col: 0, total: 2 });
  });

  it('uses one column when nothing overlaps', () => {
    const blocks = [
      { key: 1, startMin: 540, endMin: 600 },
      { key: 2, startMin: 720, endMin: 780 },
    ];
    const map = computeOverlapMaps(blocks);
    expect(map.get(1)).toEqual({ col: 0, total: 1 });
    expect(map.get(2)).toEqual({ col: 0, total: 1 });
  });
});

describe('computeOverlapLayouts', () => {
  it('splits side-by-side when start times match', () => {
    const blocks = [
      { key: 'a', startMin: 11 * 60, endMin: 12 * 60 },
      { key: 'b', startMin: 11 * 60, endMin: 21 * 60 },
    ];
    const map = computeOverlapLayouts(blocks);
    const a = map.get('a')!;
    const b = map.get('b')!;
    expect(a.stacked).toBe(false);
    expect(b.stacked).toBe(false);
    expect(a.widthPct).toBe(49.5);
    expect(b.widthPct).toBe(49.5);
    expect(Math.min(a.leftPct, b.leftPct)).toBe(0);
    expect(Math.max(a.leftPct, b.leftPct)).toBe(50);
  });

  it('stacks later-start events full-width under + indented on top', () => {
    const blocks = [
      { key: 'ferry', startMin: 11 * 60, endMin: 21 * 60 },
      { key: 'cg', startMin: 19 * 60, endMin: 21 * 60 },
    ];
    const map = computeOverlapLayouts(blocks);
    expect(map.get('ferry')).toMatchObject({ leftPct: 0, widthPct: 99.5, stacked: false, zIndex: 1 });
    expect(map.get('cg')).toMatchObject({ leftPct: 100 / 3, stacked: true, zIndex: 2 });
    expect(map.get('cg')!.widthPct).toBeCloseTo(100 - 100 / 3 - 0.5, 5);
  });
});
