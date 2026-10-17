import React, { useState } from 'react';
import { api } from '../api.js';
import { redirect } from '../nav.js';
import { Field, ErrorBox } from '../ui.jsx';
import { money } from '../format.js';

export default function NewOrganisation({ me }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { amount, currency, paymentsEnabled } = me.pricing;

  async function pay(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { link } = await api.checkout(name);
      redirect(link); // Flutterwave's page; it sends the customer back here when done
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="large-title">New organisation</h1>
      <p className="subtitle">
        Pay once and you get your own dashboard: up to {me.limits.maxStations} stations, your own staff logins, and a role for each person at each station.
      </p>
      <form className="card" onSubmit={pay}>
        <Field label="Organisation name" value={name} onChange={setName} placeholder="e.g. Sitto Prince Energy" autoComplete="organization" />
        <div style={{ height: '1rem' }} />
        <div className="stat"><span>One-time payment</span><b>{money(amount, currency)}</b></div>
        <ErrorBox error={error} />
        {!paymentsEnabled && <div className="msg warn">Payments are not switched on yet. Please try again later.</div>}
        <div style={{ height: '0.75rem' }} />
        <button className="btn block" disabled={busy || !paymentsEnabled || name.trim().length < 2}>
          {busy ? 'Opening Flutterwave…' : `Pay ${money(amount, currency)} with Flutterwave`}
        </button>
      </form>
      <p className="footnote">You will be taken to Flutterwave to pay by card, bank transfer or USSD. Your organisation is created as soon as the payment is confirmed.</p>
    </div>
  );
}
