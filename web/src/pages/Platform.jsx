import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Sheet, Field, Select } from '../ui.jsx';
import { dateLong, naira } from '../format.js';

function DateForm({ org, onDone, close }) {
  const [date, setDate] = useState(org.subscription.paidUntil ? org.subscription.paidUntil.slice(0, 10) : '');
  const [error, setError] = useState(null);
  async function save(value) {
    try {
      await api.setPaidUntil(org.id, value ? new Date(`${value}T23:59:59Z`).toISOString() : null);
      await onDone();
      close();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div>
      <div className="card"><Field label="Paid until" type="date" value={date} onChange={setDate} /></div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={!date} onClick={() => save(date)}>Save date</button>
      <div style={{ height: '0.625rem' }} />
      <button className="btn ghost block" onClick={() => save(null)}>No expiry</button>
    </div>
  );
}

function AssignForm({ payment, orgs, onDone, close }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '');
  const [error, setError] = useState(null);
  async function go() {
    try {
      await api.assignPayment(payment.txRef, orgId);
      await onDone();
      close();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div>
      <div className="card">
        <p className="footnote" style={{ marginTop: 0 }}>{naira(payment.amount)} was charged to {payment.email}. Flutterwave charged it automatically but no organisation uses that email. Pick the organisation it was for.</p>
        <Select label="Organisation" value={orgId} onChange={setOrgId} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
      </div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={!orgId} onClick={go}>Add a period to this organisation</button>
    </div>
  );
}

export default function Platform() {
  const [orgs, setOrgs] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null);

  const load = async () => {
    try {
      const [o, u] = await Promise.all([api.platformOrgs(), api.unmatchedPayments()]);
      setOrgs(o.organisations);
      setUnmatched(u.payments);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    load();
  }, []);

  async function toggle(o) {
    try {
      await api.setOrgStatus(o.id, o.status === 'active' ? 'suspended' : 'active');
      await load();
    } catch (e) {
      setError(e);
    }
  }

  const stateText = (s) =>
    !s.paidUntil ? 'no expiry' : s.state === 'active' ? `paid until ${dateLong(s.paidUntil)}` : `${s.state === 'grace' ? 'ended, in grace' : 'ended'} ${dateLong(s.paidUntil)}`;

  return (
    <div className="page">
      <h1 className="large-title">All organisations</h1>
      <p className="subtitle">{orgs ? `${orgs.length} ${orgs.length === 1 ? 'customer' : 'customers'}` : 'Loading…'}</p>
      <ErrorBox error={error} />

      {unmatched.length > 0 && (
        <>
          <div className="section-title">Payments to match</div>
          <div className="list">
            {unmatched.map((p) => (
              <div className="item" key={p.txRef}>
                <span className="grow">
                  <span className="t1">{naira(p.amount)} from {p.email}</span>
                  <span className="t2">Charged automatically, no organisation matches this email</span>
                </span>
                <button className="btn small" onClick={() => setSheet({ type: 'assign', payment: p })}>Match</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="list">
        {orgs?.map((o) => (
          <div className="item" key={o.id}>
            <span className="grow">
              <span className="t1">{o.name}</span>
              <span className="t2">{o.owners.map((x) => x.email).join(', ')} · {o.stationCount} stations · {stateText(o.subscription)}{o.subscription.autoRenew ? ' · auto' : ''}</span>
            </span>
            {o.status !== 'active' && <span className="pill warn">Suspended</span>}
            <button className="btn ghost small" onClick={() => setSheet({ type: 'date', org: o })}>Date</button>
            <button className="btn ghost small" onClick={() => toggle(o)}>{o.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
          </div>
        ))}
      </div>

      {sheet?.type === 'date' && (
        <Sheet title="Paid until" onClose={() => setSheet(null)}>{(close) => <DateForm org={sheet.org} onDone={load} close={close} />}</Sheet>
      )}
      {sheet?.type === 'assign' && (
        <Sheet title="Match a payment" onClose={() => setSheet(null)}>{(close) => <AssignForm payment={sheet.payment} orgs={orgs ?? []} onDone={load} close={close} />}</Sheet>
      )}
    </div>
  );
}
