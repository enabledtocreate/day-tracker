'use client';

import { useState } from 'react';
import { login, register, getSSOUrl } from '@/lib/auth';
import { DT } from '@/lib/uiIdentifiers';

type Props = { onSuccess: () => void };

export function LoginScreen({ onSuccess }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

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
