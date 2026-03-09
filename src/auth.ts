/**
 * Auth: session check, login, register, logout, SSO redirect. Uses same base URL as api.
 */
const BASE = ((): string => {
  const app = document.getElementById('app');
  if (app?.dataset.baseurl) return (app.dataset.baseurl as string).replace(/\/$/, '') + '/';
  return '';
})();

export interface AuthUser {
  id: number;
  username: string;
  db_name: string;
  is_admin: boolean;
  force_password_reset: boolean;
  sso: Array<{ provider: string; email: string }>;
}

export interface MeResponse {
  user: AuthUser | null;
  ai_enabled?: boolean;
}

let currentUser: AuthUser | null = null;
let aiEnabled = true;

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isAdmin(): boolean {
  return currentUser?.is_admin ?? false;
}

export function isAiEnabled(): boolean {
  return aiEnabled;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch(BASE + 'api/auth.php?action=me', { credentials: 'include' });
  const data = (await res.json()) as MeResponse & { error?: string; code?: string };
  if (res.ok && data.user) {
    currentUser = data.user;
    aiEnabled = data.ai_enabled !== false;
  } else {
    currentUser = null;
  }
  return data;
}

export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string; force_password_reset?: boolean }> {
  const res = await fetch(BASE + 'api/auth.php?action=login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    await fetchMe();
    return { ok: true, force_password_reset: data.force_password_reset };
  }
  return { ok: false, error: data.error || 'Login failed' };
}

export async function register(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(BASE + 'api/auth.php?action=register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    await fetchMe();
    return { ok: true };
  }
  return { ok: false, error: data.error || 'Registration failed' };
}

export async function logout(): Promise<void> {
  await fetch(BASE + 'api/auth.php?action=logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
}

export function getSSOUrl(provider: 'google' | 'outlook'): string {
  return BASE + 'api/auth.php?action=sso&provider=' + provider;
}
