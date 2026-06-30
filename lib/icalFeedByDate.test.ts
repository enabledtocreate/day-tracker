import { describe, expect, it } from 'vitest';
import { replaceIcalFeedByDateInRange } from '@/lib/icalFeedByDate';

describe('replaceIcalFeedByDateInRange', () => {
  it('clears dates in range when byDate omits them', () => {
    const prev = {
      '2026-06-01': [{ id: 1 }],
      '2026-06-06': [{ id: 2 }],
      '2026-05-30': [{ id: 3 }],
    };
    const result = replaceIcalFeedByDateInRange(prev, { '2026-06-01': [{ id: 9 }] }, '2026-06-01', '2026-06-07');
    expect(result['2026-06-01']).toEqual([{ id: 9 }]);
    expect(result['2026-06-06']).toBeUndefined();
    expect(result['2026-05-30']).toEqual([{ id: 3 }]);
  });
});
