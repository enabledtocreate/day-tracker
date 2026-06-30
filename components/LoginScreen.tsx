'use client';

import { useEffect, useState } from 'react';
import { login, register, getSSOUrl } from '@/lib/auth';
import { DT } from '@/lib/uiIdentifiers';

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_callback: 'Sign-in was interrupted. Please try again.',
  sso_failed: 'Sign-in with your provider failed. Please try again.',
  user_not_found: 'Account not found.',
  sso_link_session: 'Link your account while signed in. Open User settings and try Connect again.',
  sso_already_linked: 'That sign-in is already linked to another account.',
  sso_other_sso_only:
    'That sign-in is on an account with no password. Sign in with that provider first and set a password, then connect it from the account you want to use.',
  sso_provider_taken: 'You already have that provider linked to this account.',
};

type Props = { onSuccess: () => void; initialMessage?: string };

export function LoginScreen({ onSuccess, initialMessage = '' }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const loginError = params.get('login_error');
    if (loginError) {
      setMessage(LOGIN_ERROR_MESSAGES[loginError] ?? 'Sign-in failed. Please try again.');
      params.delete('login_error');
      const next = params.toString();
      const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
      window.history.replaceState(null, '', url);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const result = isRegister
        ? await register(username, password)
        : await login(username, password);
      if (result.ok) {
        onSuccess();
        return;
      }
      setMessage(result.error || 'Failed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-screen ${DT.loginRoot}`}>
      <div className="login-card">
        <h2>Day Tracker</h2>
        {message && <p id="login-message" className="login-message">{message}</p>}
        <form
          id="login-form"
          className="login-form"
          style={{ display: isRegister ? 'none' : 'block' }}
          onSubmit={handleSubmit}
        >
          <label>
            Username <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="login-form-actions">
            <button type="submit" disabled={loading}>Log in</button>
            <button type="button" onClick={() => { setIsRegister(true); setMessage(''); }}>Create account</button>
          </div>
        </form>
        <form
          id="register-form"
          className="login-form"
          style={{ display: isRegister ? 'block' : 'none' }}
          onSubmit={handleSubmit}
        >
          <label>
            Username <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
          </label>
          <div className="login-form-actions">
            <button type="submit" disabled={loading}>Create account</button>
            <button type="button" onClick={() => { setIsRegister(false); setMessage(''); }}>Back to login</button>
          </div>
        </form>
        <div className="login-sso">
          <p>Or sign in with:</p>
          <a href={getSSOUrl('google')} className="login-sso-btn">Google</a>
          <a href={getSSOUrl('outlook')} className="login-sso-btn">Outlook</a>
        </div>
      </div>
    </div>
  );
}
