import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminSettingsView } from './AdminSettingsView';

const getSettings = vi.fn();
const getUsers = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getSettings: () => getSettings(),
      getUsers: () => getUsers(),
      getErrorLog: vi.fn(),
      setDebug: vi.fn(),
      setAiEnabled: vi.fn(),
    },
  },
}));

const defaultUser = {
  id: 1,
  username: 'test',
  db_name: 'test.sqlite',
  is_admin: false,
  sso: [],
};

describe('AdminSettingsView', () => {
  beforeEach(() => {
    getSettings.mockReset();
    getUsers.mockReset();
  });

  it('does not call admin getSettings/getUsers when user is not admin', () => {
    render(<AdminSettingsView user={{ ...defaultUser, is_admin: false }} onClose={() => {}} />);
    expect(getSettings).not.toHaveBeenCalled();
    expect(getUsers).not.toHaveBeenCalled();
  });

  it('calls getSettings and getUsers when user is admin and shows Admin settings', async () => {
    getSettings.mockResolvedValue({
      debug: false,
      ai_enabled: true,
      ical_fetch_timeout: 60,
    });
    getUsers.mockResolvedValue({ users: [] });
    render(<AdminSettingsView user={{ ...defaultUser, is_admin: true }} onClose={() => {}} />);

    expect(getSettings).toHaveBeenCalled();
    expect(getUsers).toHaveBeenCalled();
    await screen.findByRole('heading', { name: /admin settings/i });
    expect(screen.getByText(/app settings/i)).toBeInTheDocument();
  });
});
