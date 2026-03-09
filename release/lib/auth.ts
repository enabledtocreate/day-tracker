import { getBaseUrl } from './getBaseUrl';

export interface AuthUser {
  id: number;
  username: string;
  db_name: string;
  is_admin: boolean;
  force_password_reset?: boolean;
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

export function getSSOUrl(provider: 'google' | 'outlook'): string {
  return getBaseUrl() + `api/auth.php?action=sso&provider=${provider}`;
}
