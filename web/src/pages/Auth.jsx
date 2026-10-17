import React, { useState } from 'react';
import { api, setToken } from '../api.js';
import { Field, ErrorBox, Segmented } from '../ui.jsx';

export default function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const creating = mode === 'create';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = creating ? await api.register(name, email, password) : await api.login(email, password);
      setToken(token);
      onSignedIn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth page">
      <h1 className="large-title">Station Sales</h1>
      <p className="subtitle">Daily sales, tolerance and profit for your fuel stations.</p>
      <div style={{ marginBottom: '1rem' }}>
        <Segmented
          label="Sign in or create an account"
          value={mode}
          onChange={(m) => { setMode(m); setError(null); }}
          options={[{ value: 'signin', label: 'Sign in' }, { value: 'create', label: 'Create account' }]}
        />
      </div>
      <form className="card" onSubmit={submit}>
        <div className="fields">
          {creating && <Field label="Your name" value={name} onChange={setName} autoComplete="name" />}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
          <Field
            label={creating ? 'Password (8 or more characters)' : 'Password'}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={creating ? 'new-password' : 'current-password'}
          />
        </div>
        <ErrorBox error={error} />
        <div style={{ height: '0.875rem' }} />
        <button className="btn block" disabled={busy}>
          {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {creating && <p className="footnote" style={{ textAlign: 'center' }}>You pay when you create your organisation, not now.</p>}
    </div>
  );
}
