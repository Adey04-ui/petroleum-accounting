import React, { useState } from 'react';
import { api } from '../api.js';
import { redirect } from '../nav.js';
import { Field, ErrorBox, Segmented } from '../ui.jsx';
import { money, PERIOD } from '../format.js';

export default function NewOrganisation({ me }) {
  const [name, setName] = useState('');
  const [how, setHow] = useState(me.pricing.autoRenewAvailable ? 'auto' : 'once');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { amount, currency, interval, paymentsEnabled, autoRenewAvailable } = me.pricing;
  const period = PERIOD[interval];

  async function pay(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { link } = await api.checkout(name, how === 'auto');
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
        You get your own dashboard: up to {me.limits.maxStations} stations, your own staff logins, and a role for each person at each station.
      </p>
      <form className="card" onSubmit={pay}>
        <Field label="Organisation name" value={name} onChange={setName} placeholder="e.g. Sitto Prince Energy" autoComplete="organization" />
        <div style={{ height: '1rem' }} />
        {autoRenewAvailable && (
          <>
            <Segmented
              label="How to pay"
              value={how}
              onChange={setHow}
              options={[{ value: 'auto', label: 'Card, renews itself' }, { value: 'once', label: `Pay for one ${period}` }]}
            />
            <p className="footnote" style={{ margin: '0.5rem 0 0' }}>
              {how === 'auto'
                ? `Your card is charged ${money(amount, currency)} now and again every ${period}. Flutterwave emails you before each charge, and you can cancel from that email.`
                : 'Card, bank transfer or USSD. It does not renew by itself, so you pay again when the year is up.'}
            </p>
            <div style={{ height: '0.75rem' }} />
          </>
        )}
        <div className="stat"><span>{money(amount, currency)} per {period}</span><b>{money(amount, currency)}</b></div>
        <ErrorBox error={error} />
        {!paymentsEnabled && <div className="msg warn">Payments are not switched on yet. Please try again later.</div>}
        <div style={{ height: '0.75rem' }} />
        <button className="btn block" disabled={busy || !paymentsEnabled || name.trim().length < 2}>
          {busy ? 'Opening Flutterwave…' : `Pay ${money(amount, currency)} with Flutterwave`}
        </button>
      </form>
      <p className="footnote">Your organisation is created as soon as the payment is confirmed.</p>
    </div>
  );
}
