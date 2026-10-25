import React from 'react';
import { Chevron } from '../ui.jsx';
import { ROLE_NAMES } from '../format.js';

const subPill = (sub) => {
  if (!sub) return null;
  if (sub.state === 'expired') return <span className="pill warn">Ended</span>;
  if (sub.state === 'grace') return <span className="pill warn">Ended, grace</span>;
  if (!sub.autoRenew && sub.daysLeft !== null && sub.daysLeft <= 30) return <span className="pill warn">{sub.daysLeft} days left</span>;
  return null;
};

export default function Home({ me, go }) {
  const { stations, organisations, user } = me;
  const none = stations.length === 0 && organisations.length === 0;

  return (
    <div className="page">
      <h1 className="large-title">{none ? `Welcome, ${user.name.split(' ')[0]}` : 'Your stations'}</h1>

      {none && (
        <div className="card">
          <div className="empty">
            <div className="big">Start with an organisation</div>
            <p style={{ margin: '0 0 1.1rem' }}>
              An organisation holds your stations and your staff. If your employer is adding you to theirs, ask them to use <b>{user.email}</b>.
            </p>
            <button className="btn" onClick={() => go({ name: 'new-org' })}>Create an organisation</button>
          </div>
        </div>
      )}

      {stations.length > 0 && (
        <>
          <p className="subtitle">Pick one to enter figures or see results.</p>
          <div className="list">
            {stations.map((s) => (
              <button key={s.id} className="item" onClick={() => go({ name: 'station', stationId: s.id })}>
                <span className="grow">
                  <span className="t1">{s.name}</span>
                  <span className="t2">{s.organisationName}{s.address ? ` · ${s.address}` : ''}</span>
                </span>
                <span className="pill">{ROLE_NAMES[s.role]}</span>
                <Chevron />
              </button>
            ))}
          </div>
        </>
      )}

      {organisations.length > 0 && (
        <>
          <div className="section-title">Organisations you own</div>
          <div className="list">
            {organisations.map((o) => (
              <button key={o.id} className="item" onClick={() => go({ name: 'org', orgId: o.id })}>
                <span className="grow">
                  <span className="t1">{o.name}</span>
                  <span className="t2">{o.stationCount} of {me.limits.maxStations} stations · staff and roles</span>
                </span>
                {o.status !== 'active' ? <span className="pill warn">Suspended</span> : subPill(o.subscription)}
                <Chevron />
              </button>
            ))}
          </div>
        </>
      )}

      {!none && (
        <div className="list">
          <button className="item" onClick={() => go({ name: 'new-org' })}>
            <span className="grow t1" style={{ color: 'var(--accent)' }}>Create another organisation</span>
            <Chevron />
          </button>
        </div>
      )}

      {user.isPlatformAdmin && (
        <>
          <div className="section-title">Platform</div>
          <div className="list">
            <button className="item" onClick={() => go({ name: 'platform' })}>
              <span className="grow t1">All organisations</span>
              <Chevron />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
