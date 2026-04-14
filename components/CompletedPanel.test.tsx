import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompletedPanel } from './CompletedPanel';

const listAll = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    accomplished: {
      listAll: () => listAll(),
    },
  },
}));

describe('CompletedPanel', () => {
  beforeEach(() => {
    listAll.mockReset();
  });

  it('renders Completed Tasks tab and shows loading then content when opened', async () => {
    listAll.mockResolvedValue({ byDate: {} });
    render(<CompletedPanel />);
    expect(screen.getByRole('button', { name: /completed tasks/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /completed tasks/i }));

    expect(listAll).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /completed tasks/i })).toBeInTheDocument();
  });

  it('shows day label and task title when accomplished data provided', async () => {
    listAll.mockResolvedValue({
      byDate: {
        '2025-06-15': [
          {
            id: 1,
            task_id: 1,
            title: 'Done task',
            completed_at: '17:00',
            subtasks: [],
          },
        ],
      },
    });
    render(<CompletedPanel />);
    fireEvent.click(screen.getByRole('button', { name: /completed tasks/i }));

    await screen.findByText('Done task');
    expect(screen.getByText('Done task')).toBeInTheDocument();
  });

  it('shows empty message when no completed tasks', async () => {
    listAll.mockResolvedValue({ byDate: {} });
    render(<CompletedPanel />);
    fireEvent.click(screen.getByRole('button', { name: /completed tasks/i }));

    await screen.findByText(/no completed tasks yet/i);
    expect(screen.getByText(/no completed tasks yet/i)).toBeInTheDocument();
  });
});
