import { getBaseUrl } from './getBaseUrl';

export interface AuthUser {
  id: number;
  username: string;
  db_name: string;
  is_admin: boolean;
  force_password_reset?: boolean;
  /** 0 = indefinite; otherwise days until auto-logout. */
  session_lifetime_days?: number;
  session_expires_at?: string | null;
  sso: Array<{ id?: number; provider: string; email: string }>;
}

export interface MeResponse {
  user: AuthUser | null;
  ai_enabled?: boolean;
}

export async function fetchMe(): Promise<MeResponse> {
  const base = getBaseUrl();
  const res = await fetch(`${base}api/auth.php?action=me`, { credentials: 'include' });
  const data = (await res.json()) as MeResponse & { error?: string; code?: string };
  return data;
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string; force_password_reset?: boolean }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}api/auth.php?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    return { ok: true, force_password_reset: data.force_password_reset };
  }
  return { ok: false, error: data.error || 'Login failed' };
}

export async function register(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}api/auth.php?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    return { ok: true };
  }
  return { ok: false, error: data.error || 'Registration failed' };
}

export async function logout(): Promise<void> {
  const base = getBaseUrl();
  await fetch(`${base}api/auth.php?action=logout`, { method: 'POST', credentials: 'include' });
}

export function getSSOUrl(provider: 'google' | 'outlook', options?: { link?: boolean }): string {
  const params = new URLSearchParams({ action: 'sso', provider });
  if (options?.link) {
    params.set('link', '1');
  }
  return getBaseUrl() + 'api/auth.php?' + params.toString();
}

export type SsoTransferPendingInfo = {
  provider: string;
  email: string;
  other_username: string;
};

export async function fetchSsoTransferPending(): Promise<SsoTransferPendingInfo | null> {
  const base = getBaseUrl();
  const res = await fetch(`${base}api/auth.php?action=sso_transfer_pending`, { credentials: 'include' });
  const data = (await res.json()) as { pending?: SsoTransferPendingInfo | null; error?: string };
  if (!res.ok) {
    return null;
  }
  return data.pending ?? null;
}

export async function confirmSsoTransfer(): Promise<{ ok: boolean; error?: string; code?: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}api/auth.php?action=confirm_sso_transfer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    return { ok: true };
  }
  return { ok: false, error: data.error, code: data.code };
}

export async function cancelSsoTransfer(): Promise<void> {
  const base = getBaseUrl();
  await fetch(`${base}api/auth.php?action=cancel_sso_transfer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
