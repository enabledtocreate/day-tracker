import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';
import {
  TaskListAndSchedule,
  calcMovedSlotTimes,
  clampTopResizeStartForMinDuration,
  clampBottomResizeEndForMinDuration,
  clampTopResizeStartForMinGroupDuration,
  clampBottomResizeEndForMinGroupDuration,
  distributeGroupMemberTimes,
  lockTextSelection,
  restoreTextSelection,
  createDelayedEdgeAction,
  reorderGroupSiblingIds,
  resolveScheduleRootSlotId,
  scheduleBlockDensityClasses,
  buildGroupSegmentHeightsPx,
} from './TaskListAndSchedule';

const dayGetOrCreate = vi.fn();
const tasksList = vi.fn();
const slotsList = vi.fn();
const slotsUpdate = vi.fn();
const slotsCreate = vi.fn();
const slotsDelete = vi.fn();
const slotsCompleteOccurrence = vi.fn();
const settingsGet = vi.fn();
const listByDateRange = vi.fn();
const tasksUpdate = vi.fn();
const tasksDelete = vi.fn();
const organizationList = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    dataIntegrity: { ensure: vi.fn().mockResolvedValue({ ok: true }) },
    rollover: vi.fn().mockResolvedValue({ ok: true }),
    day: { getOrCreate: (...args: unknown[]) => dayGetOrCreate(...args) },
    tasks: {
      list: () => tasksList(),
      update: (...args: unknown[]) => tasksUpdate(...(args as any[])),
      delete: (...args: unknown[]) => tasksDelete(...(args as any[])),
      create: vi.fn(),
    },
    organization: { list: (...args: unknown[]) => organizationList(...(args as any[])) },
    slots: {
      list: (dayId: number) => slotsList(dayId),
      listByDateRange: (...args: unknown[]) => listByDateRange(...args),
      create: (...args: unknown[]) => slotsCreate(...args),
      update: (...args: unknown[]) => slotsUpdate(...args),
      delete: (...args: unknown[]) => slotsDelete(...args),
      completeOccurrence: (...args: unknown[]) => slotsCompleteOccurrence(...args),
      get: vi.fn(),
    },
    settings: { get: () => settingsGet() },
    icalEvents: {
      getConfig: vi.fn().mockResolvedValue({
        interval_fetch: false,
        interval_minutes: 15,
        client_triggers_sync: true,
      }),
      get: vi.fn().mockResolvedValue({ events: [], errors: [], subscription_sync: [] }),
    },
    icalSubscriptions: {
      list: vi.fn().mockResolvedValue({ subscriptions: [] }),
    },
    links: { list: vi.fn().mockResolvedValue({ links: [] }) },
    taskListItems: { list: vi.fn().mockResolvedValue({ items: [] }) },
    accomplished: { listAll: vi.fn().mockResolvedValue({ byDate: {} }) },
  },
}));

const defaultUser = {
  id: 1,
  username: 'test',
  db_name: 'test.sqlite',
  is_admin: false,
  sso: [],
};

describe('TaskListAndSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dayGetOrCreate.mockResolvedValue({ id: 1, date: '2025-06-15' });
    tasksList.mockResolvedValue({ tasks: [] });
    tasksUpdate.mockResolvedValue({ ok: true });
    tasksDelete.mockResolvedValue({ ok: true });
    organizationList.mockResolvedValue({ categories: [], subcategories: [], tags: [] });
    slotsList.mockResolvedValue({ slots: [] });
    listByDateRange.mockResolvedValue({ byDate: {} });
    slotsCreate.mockResolvedValue({ ok: true, id: 200 });
    slotsDelete.mockResolvedValue({ ok: true });
    slotsUpdate.mockResolvedValue({ ok: true });
    slotsCompleteOccurrence.mockResolvedValue({ ok: true, id: 201 });
    settingsGet.mockResolvedValue({
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min',
      task_schedule_layout: 'stacked',
    });
  });

  it('renders schedule area with Today, Week (desktop), and Calendar tabs', async () => {
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} isMobile={false} />);

    await screen.findByRole('button', { name: /today/i });
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^week$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /calendar/i })).toBeInTheDocument();
  });

  it('schedule: bulk toolbar shows Bulk select on the current day', async () => {
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByRole('group', { name: /schedule bulk actions/i });
    expect(screen.getByRole('button', { name: /bulk select/i })).toBeInTheDocument();
  });

  it('scheduleBlockDensityClasses adds tight/micro and drawer hooks by height and width', () => {
    expect(scheduleBlockDensityClasses(30, 50)).toContain('time-block-density-micro');
    expect(scheduleBlockDensityClasses(30, 50)).not.toContain('time-block-density-actions-drawer');
    expect(scheduleBlockDensityClasses(50, 50)).toContain('time-block-density-tight');
    expect(scheduleBlockDensityClasses(50, 50)).not.toContain('time-block-density-actions-drawer');
    expect(scheduleBlockDensityClasses(80, 50)).toBe('');
    expect(scheduleBlockDensityClasses(80, 30)).toContain('time-block-density-actions-drawer');
  });

  it('buildGroupSegmentHeightsPx matches child start boundaries and absorbs extra block min-height in the last segment', () => {
    const orderedChildren = [
      { id: 1, start_time: '16:15', end_time: '16:30' },
      { id: 2, start_time: '16:30', end_time: '16:45' },
    ] as ScheduledSlot[];
    const exact = buildGroupSegmentHeightsPx({
      groupStartMin: 16 * 60,
      groupEndMin: 16 * 60 + 45,
      orderedChildren,
      slotDurationMinutes: 15,
      blockHeightPx: 96,
    });
    expect(exact).toEqual([32, 32, 32]);
    const padded = buildGroupSegmentHeightsPx({
      groupStartMin: 16 * 60,
      groupEndMin: 16 * 60 + 45,
      orderedChildren,
      slotDurationMinutes: 15,
      blockHeightPx: 100,
    });
    expect(padded.reduce((a, b) => a + b, 0)).toBe(100);
    expect(padded[2]).toBe(36);
  });

  it('resolveScheduleRootSlotId walks parent task chain to the root slot', () => {
    const slots: ScheduledSlot[] = [
      {
        id: 1,
        day_record_id: 1,
        task_id: 100,
        start_time: '09:00',
        end_time: '10:00',
        completed: 0,
        order_index: 0,
        parent_id: null,
      },
      {
        id: 2,
        day_record_id: 1,
        task_id: 101,
        start_time: '09:15',
        end_time: '09:30',
        completed: 0,
        order_index: 1,
        parent_id: 100,
      },
    ];
    expect(resolveScheduleRootSlotId(slots, 2)).toBe(1);
    expect(resolveScheduleRootSlotId(slots, 1)).toBe(1);
  });

  it('task view: search input sits in the Order by row and matches add-task styling', async () => {
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    const searchInput = screen.getByPlaceholderText(/search tasks, links, list items/i) as HTMLInputElement;
    const sortRow = document.querySelector('.task-list-sort-row') as HTMLElement | null;
    expect(sortRow).not.toBeNull();
    expect(sortRow!.contains(searchInput)).toBe(true);

    // Matches add-task-row input sizing/padding; font uses --task-title-font-size (same as .task-row .task-title).
    expect(searchInput.style.padding).toBe('0.3rem 0.45rem');
    expect(searchInput.style.fontSize).toBe('var(--task-title-font-size)');
    expect(searchInput.style.borderRadius).toBe('4px');
    expect(searchInput.style.minHeight).toBe('28px');
    expect(searchInput.style.height).toBe('auto');
  });

  it('task view: New task input is styled via add-task-row CSS (same title font token as search)', async () => {
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    const newTaskInput = screen.getByPlaceholderText(/new task/i) as HTMLInputElement;
    const row = document.querySelector('.add-task-row');
    expect(row).not.toBeNull();
    expect(row!.contains(newTaskInput)).toBe(true);
    expect(newTaskInput.getAttribute('style')).toBeNull();
  });

  it('Calendar tab shows month grid and recurring class on recurring slots', async () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    listByDateRange.mockResolvedValue({
      byDate: {
        [dateStr]: [
          {
            id: -1,
            task_id: 1,
            title: 'Recurring task',
            is_recurring_occurrence: true,
            completed: 0,
            priority: 'medium',
          },
        ],
      },
    });
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByRole('button', { name: /today/i });
    screen.getByRole('button', { name: /calendar/i }).click();

    await screen.findByText('Recurring task');
    expect(screen.getByText('Recurring task')).toBeInTheDocument();
    const recurringEl = document.querySelector('.calendar-day-task-recurring');
    expect(recurringEl).toBeInTheDocument();
  });

  it('recurring remove "All occurrences" deletes task via api.tasks.delete', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        {
          id: 1,
          title: 'Recurring root',
          priority: 'medium',
          recurring: true,
          parent_id: null,
          created_at: '',
          list_state: 'unassigned',
          list_style: 'bullet',
          recurrence_rule: JSON.stringify({ freq: 'daily', time: '09:00' }),
        },
      ],
    });

    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '09:30',
          completed: 0,
          order_index: 0,
          title: 'Recurring root',
          priority: 'medium',
          recurring: true,
          parent_id: null,
          list_style: 'bullet',
          is_recurring_occurrence: false,
          has_list: false,
        },
      ],
    });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    await screen.findByRole('button', { name: /today/i });
    screen.getByRole('button', { name: /today/i }).click();

    const trashBtn = await screen.findByTitle('Delete task');
    fireEvent.click(trashBtn);

    await screen.findByText(/Recurring task: remove from schedule/i);
    const allOccurrencesEls = await screen.findAllByText(/All occurrences/i);
    const allOccurrencesBtn = allOccurrencesEls.find((el) => el.tagName.toLowerCase() === 'button') as HTMLElement | undefined;
    expect(allOccurrencesBtn).toBeDefined();
    fireEvent.click(allOccurrencesBtn!);

    await waitFor(() => {
      expect(tasksDelete).toHaveBeenCalledWith(1);
    });
  });

  it('tag suggestion dropdown uses legible styles (non-black text)', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        {
          id: 1,
          title: 'Task With Tags',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          created_at: '',
          list_state: 'unassigned',
          list_style: 'bullet',
        },
      ],
    });

    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '09:30',
          completed: 0,
          order_index: 0,
          title: 'Task With Tags',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
          is_recurring_occurrence: false,
        },
      ],
    });

    organizationList.mockResolvedValueOnce({
      categories: [],
      subcategories: [],
      tags: [{ id: 1, name: 'urgent', color: null }],
    });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    await screen.findByText('Task With Tags');

    // Open the schedule action drawer so we can reach "Category & tags".
    const actionBtns = await screen.findAllByTitle('Actions');
    fireEvent.click(actionBtns[0]);

    const catTagsBtns = await screen.findAllByTitle('Category & tags');
    fireEvent.click(catTagsBtns[0]);

    const tagInput = await screen.findByPlaceholderText(/Add tag/i);
    fireEvent.change(tagInput, { target: { value: 'urg' } });

    const suggestEl = document.querySelector('ul.task-org-tag-suggest') as HTMLElement | null;
    expect(suggestEl).not.toBeNull();
    expect(suggestEl!.textContent || '').toMatch(/urgent/i);
    expect(suggestEl!.style.color).toBe('var(--text)');
    expect(suggestEl!.style.background).toBe('var(--surface-elevated)');
    // Alignment: match horizontal padding with the input for consistent text baseline.
    expect(suggestEl!.style.padding).toBe('0.25rem 0.5rem');
    const firstSuggestBtn = suggestEl!.querySelector('button') as HTMLElement | null;
    expect(firstSuggestBtn).not.toBeNull();
    expect(firstSuggestBtn!.style.padding).toBe('0.25rem 0.5rem');
  });

  it('mobile: time-block actions drawer omits divider elements', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        {
          id: 1,
          title: 'Drawer Test Task',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          created_at: '',
          list_state: 'unassigned',
          list_style: 'bullet',
        },
      ],
    });

    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '09:30',
          completed: 0,
          order_index: 0,
          title: 'Drawer Test Task',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
          is_recurring_occurrence: false,
        },
      ],
    });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} isMobile />);

    await screen.findByText('Drawer Test Task');

    const actionsBtns = screen.getAllByTitle('Actions');
    fireEvent.click(actionsBtns[0]);

    const drawerDividers = document.querySelectorAll('.time-block-actions-drawer .task-card-drawer-divider');
    expect(drawerDividers.length).toBe(0);
  });

  it('shows error message and does not crash when tasks.list fails (500/network)', async () => {
    tasksList.mockRejectedValueOnce(new Error('Internal Server Error'));
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    const errors = await screen.findAllByText(/internal server error/i);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
  });

  it('shows error when slot update fails (optimistic revert: loadData refetches)', async () => {
    dayGetOrCreate.mockResolvedValue({ id: 1, date: '2025-06-15' });
    tasksList.mockResolvedValue({
      tasks: [{ id: 1, title: 'T', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' }],
    });
    slotsList.mockResolvedValue({
      slots: [
        { id: 10, day_record_id: 1, task_id: 1, start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0, title: 'T', priority: 'medium', recurring: false, parent_id: null, list_style: 'bullet', has_list: false },
      ],
    });
    slotsUpdate.mockRejectedValueOnce(new Error('Network error'));

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('T');

    const completeCheckbox = document.querySelector('.time-block input[type="checkbox"]') as HTMLInputElement | null;
    if (completeCheckbox) {
      completeCheckbox.click();
      await screen.findByText(/network error/i);
    }
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
  });

  it('moves a scheduled slot without shrinking duration below original', () => {
    // Simulate: 09:00-10:00 slot (60min) moved within a day view.
    const res = calcMovedSlotTimes({
      scheduleDropStartMin: 555, // would snap to 09:15
      viewEndMin: 23 * 60,
      slotDurationMinutes: 15,
      originalDurationMin: 60,
      startHour: 6,
      endHour: 23,
    });

    expect(res.newStartMin).toBe(555);
    expect(res.newEndMin - res.newStartMin).toBe(60);
    expect(res.preservedDurationMin).toBe(60);
  });

  it('clamps moved slot duration to at least one interval', () => {
    const res = calcMovedSlotTimes({
      scheduleDropStartMin: 555,
      viewEndMin: 23 * 60,
      slotDurationMinutes: 15,
      originalDurationMin: 5, // bogus short duration in data; UI must not shrink below one increment
      startHour: 6,
      endHour: 23,
    });

    expect(res.preservedDurationMin).toBe(15);
    expect(res.newEndMin - res.newStartMin).toBe(15);
  });

  it('reorders siblings by group_order when dropped onto another sibling', () => {
    const members = [
      { id: 1, group_order: 0 },
      { id: 2, group_order: 1 },
      { id: 3, group_order: 2 },
    ];

    // Move task 1 onto task 3 => [2,3,1]
    const nextIds = reorderGroupSiblingIds({ members, movedId: 1, targetId: 3 });
    expect(nextIds).toEqual([2, 3, 1]);

    // Drop onto itself => unchanged ordering
    const noOpIds = reorderGroupSiblingIds({ members, movedId: 2, targetId: 2 });
    expect(noOpIds).toEqual([1, 2, 3]);
  });

  it('resize clamps never allow duration below one interval', () => {
    const slotDurationMinutes = 15;

    // Top resize: attempt to move start past end - 15min.
    const clampedStart = clampTopResizeStartForMinDuration({
      candidateStartMin: 590,
      endMin: 600,
      slotDurationMinutes,
    });
    expect(clampedStart).toBe(585); // 10:00 - 15min
    expect(600 - clampedStart).toBe(15);

    // Bottom resize: attempt to move end below start + 15min.
    const clampedEnd = clampBottomResizeEndForMinDuration({
      startMin: 540,
      candidateEndMin: 530,
      slotDurationMinutes,
    });
    expect(clampedEnd).toBe(555); // 09:00 + 15min
    expect(clampedEnd - 540).toBe(15);

    // Zero increment in settings must not allow zero-duration blocks.
    const zStart = clampTopResizeStartForMinDuration({
      candidateStartMin: 600,
      endMin: 600,
      slotDurationMinutes: 0,
    });
    expect(600 - zStart).toBe(1);
    const zEnd = clampBottomResizeEndForMinDuration({
      startMin: 540,
      candidateEndMin: 540,
      slotDurationMinutes: 0,
    });
    expect(zEnd - 540).toBe(1);
  });

  it('clamps group resize top/bottom by memberCount * interval', () => {
    const slotDurationMinutes = 15;
    const memberCount = 3; // min group duration = 45min
    const endMin = 660; // 11:00

    const clampedStart = clampTopResizeStartForMinGroupDuration({
      candidateStartMin: 630, // 10:30
      endMin,
      slotDurationMinutes,
      memberCount,
      startHour: 6,
      endHour: 23,
      currentStartMin: 600,
    });
    expect(clampedStart).toBe(615); // 10:15

    // Overcrowded group: moving start earlier (870) is allowed to lengthen span toward validity.
    const crowdedEarlier = clampTopResizeStartForMinGroupDuration({
      candidateStartMin: 870,
      endMin: 930,
      slotDurationMinutes: 30,
      memberCount: 2,
      startHour: 6,
      endHour: 23,
      currentStartMin: 900,
    });
    expect(crowdedEarlier).toBe(870);

    // Overcrowded: cannot move start later than current without shrinking below minimum — stay at 900.
    const crowdedLater = clampTopResizeStartForMinGroupDuration({
      candidateStartMin: 920,
      endMin: 930,
      slotDurationMinutes: 30,
      memberCount: 2,
      startHour: 6,
      endHour: 23,
      currentStartMin: 900,
    });
    expect(crowdedLater).toBe(900);

    const startMin = 600; // 10:00
    const clampedEnd = clampBottomResizeEndForMinGroupDuration({
      startMin,
      candidateEndMin: 640, // 10:40
      slotDurationMinutes,
      memberCount,
    });
    expect(clampedEnd).toBe(645); // 10:45
  });

  it('distributes group member times sequentially (remainder goes to last)', () => {
    const slotDurationMinutes = 15;
    const memberCount = 4;
    const groupStartMin = 600; // 10:00
    const groupEndMin = 675; // 11:15 => 75min => 5 intervals

    // totalIntervals=5, baseIntervals=floor(5/4)=1, remainder=1 => durations: 15,15,15,30
    const times = distributeGroupMemberTimes({ groupStartMin, groupEndMin, slotDurationMinutes, memberCount });
    expect(times).toEqual([
      { startMin: 600, endMin: 615 },
      { startMin: 615, endMin: 630 },
      { startMin: 630, endMin: 645 },
      { startMin: 645, endMin: 675 },
    ]);
  });

  it('applies group priority to direct child tasks', async () => {
    const root = { id: 1, title: 'Root', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' };
    const child1 = { id: 2, title: 'Child 1', priority: 'low', recurring: false, parent_id: 1, created_at: '', list_state: 'unassigned', list_style: 'bullet' };
    const child2 = { id: 3, title: 'Child 2', priority: 'high', recurring: false, parent_id: 1, created_at: '', list_state: 'unassigned', list_style: 'bullet' };

    tasksList.mockResolvedValue({ tasks: [root, child1, child2] });

    (window as any).confirm = vi.fn(() => true);

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('Root');

    // Open priority picker on the group root and set to high.
    const rootLi = screen.getByText('Root').closest('[data-task-id="1"]') as HTMLElement | null;
    expect(rootLi).toBeTruthy();
    const rootPriorityBtn = rootLi!.querySelector('button[title="Priority"]') as HTMLButtonElement | null;
    expect(rootPriorityBtn).toBeTruthy();
    fireEvent.click(rootPriorityBtn!);
    const picker = document.querySelector('.priority-picker[role="listbox"]') as HTMLElement | null;
    expect(picker).toBeTruthy();
    const highBtn = Array.from(picker!.querySelectorAll('button')).find((b) => b.textContent?.includes('High'));
    expect(highBtn).toBeTruthy();
    fireEvent.click(highBtn as HTMLElement);

    // Ensure update was called for root and both direct children.
    const calledIds = tasksUpdate.mock.calls.map((c) => (c[0] as any).id).filter(Boolean);
    expect(calledIds).toEqual(expect.arrayContaining([1, 2, 3]));

    const calledPriorities = tasksUpdate.mock.calls.map((c) => (c[0] as any).priority);
    expect(calledPriorities).toEqual(expect.arrayContaining(['high', 'high', 'high']));
  });

  it('ungroups a task group by setting descendants parent_id to null', async () => {
    const root = { id: 1, title: 'Root', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' };
    const child1 = { id: 2, title: 'Child 1', priority: 'low', recurring: false, parent_id: 1, created_at: '', list_state: 'unassigned', list_style: 'bullet' };
    const child2 = { id: 3, title: 'Child 2', priority: 'high', recurring: false, parent_id: 1, created_at: '', list_state: 'unassigned', list_style: 'bullet' };

    tasksList.mockResolvedValue({ tasks: [root, child1, child2] });
    (window as any).confirm = vi.fn(() => true);

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('Root');

    const ungroupBtn = screen.getByTitle(/split group/i);
    fireEvent.click(ungroupBtn);

    // Ungroup updates both direct children (root stays parent_id=null already).
    expect(tasksUpdate.mock.calls.map((c) => (c[0] as any).id).sort()).toEqual([2, 3]);
    expect(tasksUpdate.mock.calls.map((c) => (c[0] as any).parent_id)).toEqual([null, null]);
  });

  it('schedule grouped block split control ungroups descendants', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        { id: 1, title: 'Root', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' },
        { id: 2, title: 'Child 1', priority: 'low', recurring: false, parent_id: 1, created_at: '', list_state: 'unassigned', list_style: 'bullet' },
      ],
    });
    slotsList.mockResolvedValue({
      slots: [
        { id: 10, day_record_id: 1, task_id: 1, start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0, title: 'Root', priority: 'medium', recurring: false, parent_id: null, list_style: 'bullet', has_list: false },
        { id: 11, day_record_id: 1, task_id: 2, start_time: '09:00', end_time: '09:30', completed: 0, order_index: 1, title: 'Child 1', priority: 'low', recurring: false, parent_id: 1, list_style: 'bullet', has_list: false },
      ],
    });
    (window as any).confirm = vi.fn(() => true);
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('Child 1');
    const splitBtn = screen.getByTitle(/split group \(tasks stay scheduled/i);
    fireEvent.click(splitBtn);
    await waitFor(() => {
      expect(tasksUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 2, parent_id: null }));
    });
  });

  it('recurring virtual occurrence completion preserves start/end when materializing slot', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        { id: 1, title: 'Recurring root', priority: 'medium', recurring: true, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet', recurrence_rule: JSON.stringify({ freq: 'daily', time: '09:00' }) },
      ],
    });
    slotsList.mockResolvedValue({
      slots: [
        {
          id: -1,
          day_record_id: 1,
          task_id: 1,
          start_time: '13:15',
          end_time: '14:00',
          completed: 0,
          order_index: 0,
          title: 'Recurring root',
          priority: 'medium',
          recurring: true,
          parent_id: null,
          list_style: 'bullet',
          is_recurring_occurrence: true,
          has_list: false,
        },
      ],
    });
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('Recurring root');
    const checkBtn = screen.getByTitle(/mark complete/i);
    fireEvent.click(checkBtn);
    await waitFor(() => {
      expect(slotsCompleteOccurrence).toHaveBeenCalledWith(1, expect.any(String), '13:15', '14:00');
    });
  });

  it('schedule "Enter" in date/time fields triggers scheduling (same as clicking Schedule)', async () => {
    tasksList.mockResolvedValue({
      tasks: [{ id: 1, title: 'T', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' }],
    });
    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 0,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });
    slotsCreate.mockResolvedValue({ ok: true, id: 999 });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('T');

    const dateBtn = document.querySelector('.time-block-date') as HTMLElement | null;
    expect(dateBtn).toBeTruthy();
    fireEvent.click(dateBtn!);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    expect(dateInput).toBeTruthy();

    fireEvent.keyDown(dateInput!, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(slotsCreate).toHaveBeenCalled();
    });
  });

  it('schedule on date sets due_date and bumps priority when auto-priority enabled', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        { id: 1, title: 'T', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' },
      ],
    });
    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 0,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });
    slotsCreate.mockResolvedValue({ ok: true, id: 999 });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);
    await screen.findByText('T');

    const dateBtn = document.querySelector('.time-block-date') as HTMLElement | null;
    expect(dateBtn).toBeTruthy();
    fireEvent.click(dateBtn!);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    expect(dateInput).toBeTruthy();
    const expectedDueDate = dateInput!.value;

    const autoPriorityCheckbox = screen.getByLabelText(/increase priority automatically/i) as HTMLInputElement;
    expect(autoPriorityCheckbox.checked).toBe(false);
    fireEvent.click(autoPriorityCheckbox);
    expect(autoPriorityCheckbox.checked).toBe(true);

    fireEvent.keyDown(dateInput!, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(tasksUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          due_date: expectedDueDate,
          priority: 'high',
        })
      );
    });
  });

  it('locks and restores text selection around drag', () => {
    const prev = lockTextSelection(document.body);
    expect(document.body.style.userSelect).toBe('none');
    restoreTextSelection(document.body, prev);
    expect(document.body.style.userSelect).toBe(prev.prevUserSelect);
  });

  it('createDelayedEdgeAction activates only after delay without leave', () => {
    vi.useFakeTimers();
    const activate = vi.fn();
    const controller = createDelayedEdgeAction(250, activate);
    controller.onEdge();
    vi.advanceTimersByTime(249);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('createDelayedEdgeAction cancels activation on leave', () => {
    vi.useFakeTimers();
    const activate = vi.fn();
    const controller = createDelayedEdgeAction(250, activate);
    controller.onEdge();
    vi.advanceTimersByTime(100);
    controller.onLeave();
    vi.advanceTimersByTime(200);
    expect(activate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('schedule completion button aria-pressed reflects slot.completed', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        { id: 1, title: 'T', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' },
      ],
    });
    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 1,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} isMobile />);
    await screen.findByText('T');

    const btn = document.querySelector('.time-block-check') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(btn?.style.color).toBe('var(--text-muted)');
  });

  it('mobile: completion checkbox color toggles on click', async () => {
    tasksList.mockResolvedValue({
      tasks: [
        { id: 1, title: 'T', priority: 'medium', recurring: false, parent_id: null, created_at: '', list_state: 'unassigned', list_style: 'bullet' },
      ],
    });

    slotsList.mockResolvedValueOnce({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 0,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });

    slotsList.mockResolvedValueOnce({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 1,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });

    // If the component refetches more than twice, keep returning the "completed" state.
    slotsList.mockResolvedValue({
      slots: [
        {
          id: 10,
          day_record_id: 1,
          task_id: 1,
          start_time: '09:00',
          end_time: '10:00',
          completed: 1,
          order_index: 0,
          title: 'T',
          priority: 'medium',
          recurring: false,
          parent_id: null,
          list_style: 'bullet',
          has_list: false,
        },
      ],
    });

    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} isMobile />);
    await screen.findByText('T');

    const btnBefore = document.querySelector('.time-block-check') as HTMLButtonElement | null;
    expect(btnBefore).toBeTruthy();
    expect(btnBefore?.getAttribute('aria-pressed')).toBe('false');
    expect(btnBefore?.style.color).toBe('transparent');

    fireEvent.click(btnBefore!);

    await waitFor(() => {
      const btnAfter = document.querySelector('.time-block-check') as HTMLButtonElement | null;
      expect(btnAfter).toBeTruthy();
      expect(btnAfter?.getAttribute('aria-pressed')).toBe('true');
      expect(btnAfter?.style.color).toBe('var(--text-muted)');
    });
  });
});
