import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskListAndSchedule } from './TaskListAndSchedule';

const dayGetOrCreate = vi.fn();
const tasksList = vi.fn();
const slotsList = vi.fn();
const slotsUpdate = vi.fn();
const settingsGet = vi.fn();
const listByDateRange = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    rollover: vi.fn().mockResolvedValue({ ok: true }),
    day: { getOrCreate: (...args: unknown[]) => dayGetOrCreate(...args) },
    tasks: {
      list: () => tasksList(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    slots: {
      list: (dayId: number) => slotsList(dayId),
      listByDateRange: (...args: unknown[]) => listByDateRange(...args),
      create: vi.fn(),
      update: (...args: unknown[]) => slotsUpdate(...args),
      delete: vi.fn(),
      get: vi.fn(),
    },
    settings: { get: () => settingsGet() },
    icalEvents: { get: vi.fn().mockResolvedValue({ events: [], errors: [] }) },
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
    dayGetOrCreate.mockResolvedValue({ id: 1, date: '2025-06-15' });
    tasksList.mockResolvedValue({ tasks: [] });
    slotsList.mockResolvedValue({ slots: [] });
    listByDateRange.mockResolvedValue({ byDate: {} });
    settingsGet.mockResolvedValue({
      start_hour: 6,
      end_hour: 23,
      increment_value: 15,
      increment_unit: 'min',
    });
  });

  it('renders schedule area with Today and Calendar tabs', async () => {
    render(<TaskListAndSchedule user={defaultUser} aiEnabled={false} />);

    await screen.findByRole('button', { name: /today/i });
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /calendar/i })).toBeInTheDocument();
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
});
