import { describe, it, expect } from 'vitest';
import {
  flattenProposals,
  isApplyBlocked,
  wantsScheduleSlot,
  buildProposedPreviewSlots,
  collectPreviewDates,
  resolveSlotTimesForProposal,
} from './aiApply';
import type { AiAssistantResponse } from './aiTypes';

const settings = { start_hour: 8, end_hour: 18, increment_value: 30, increment_unit: 'min' as const };

describe('aiApply', () => {
  it('flattenProposals skips empty titles', () => {
    const res: AiAssistantResponse = {
      schemaVersion: 1,
      kind: 'plan',
      advice: { summary: 'x', bullets: [] },
      dataRequests: [],
      proposals: [
        {
          id: 'g1',
          groupTitle: 'G',
          groupSummary: '',
          horizon: 'daily',
          prioritization: 'user_specified',
          cadence: { frequency: 'once', dayOfWeek: null, timeOfDay: null },
          tasks: [{ title: '' }, { title: '  Ok  ' }] as AiAssistantResponse['proposals'][0]['tasks'],
          questionsForUser: [],
        },
      ],
    };
    const rows = flattenProposals(res);
    expect(rows).toHaveLength(1);
    expect(rows[0].task.title).toBe('Ok');
  });

  it('isApplyBlocked on dataRequests or blocking question', () => {
    const base: AiAssistantResponse = {
      schemaVersion: 1,
      kind: 'plan',
      advice: { summary: 'x' },
      dataRequests: [],
      proposals: [],
    };
    expect(isApplyBlocked(null)).toBe(true);
    expect(isApplyBlocked({ ...base, dataRequests: [{ id: 'a', queryId: 'tasks.list' }] })).toBe(true);
    expect(
      isApplyBlocked({
        ...base,
        proposals: [
          {
            id: 'p',
            groupTitle: '',
            groupSummary: '',
            horizon: 'unspecified',
            prioritization: 'user_specified',
            cadence: { frequency: 'once', dayOfWeek: null, timeOfDay: null },
            tasks: [],
            questionsForUser: [{ text: 'q', blocksProposalApply: true }],
          },
        ],
      })
    ).toBe(true);
    expect(isApplyBlocked(base)).toBe(false);
  });

  it('wantsScheduleSlot', () => {
    expect(wantsScheduleSlot({ title: 't', suggestedSlot: { date: null, start: null, end: null } } as any)).toBe(false);
    expect(wantsScheduleSlot({ title: 't', suggestedSlot: { date: '2026-01-01', start: null, end: null } } as any)).toBe(
      true
    );
  });

  it('buildProposedPreviewSlots and collectPreviewDates', () => {
    const rows = flattenProposals({
      schemaVersion: 1,
      kind: 'plan',
      advice: { summary: '' },
      dataRequests: [],
      proposals: [
        {
          id: 'g',
          groupTitle: 'G',
          groupSummary: '',
          horizon: 'daily',
          prioritization: 'user_specified',
          cadence: { frequency: 'once', dayOfWeek: null, timeOfDay: null },
          tasks: [
            {
              title: 'A',
              suggestedSlot: { date: '2026-04-01', start: '09:00', end: '09:30' },
              groupWithTaskId: null,
              tagIds: [],
              tagTempIds: [],
              newTagSuggestions: [],
              categoryId: null,
              subcategoryId: null,
              linkAttachments: [],
            },
          ],
          questionsForUser: [],
        },
      ],
    });
    const props = buildProposedPreviewSlots(rows, '2026-04-05', settings);
    expect(props).toHaveLength(1);
    const dates = collectPreviewDates(props, '2026-04-05');
    expect(dates).toContain('2026-04-01');
    expect(dates).toContain('2026-04-05');
  });

  it('resolveSlotTimesForProposal defaults', () => {
    const t = resolveSlotTimesForProposal({ date: null, start: null, end: null }, '2026-04-05', settings);
    expect(t.date).toBe('2026-04-05');
    expect(t.start).toMatch(/^\d{2}:\d{2}$/);
  });
});
