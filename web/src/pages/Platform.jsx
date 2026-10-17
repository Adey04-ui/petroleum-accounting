import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox } from '../ui.jsx';

export default function Platform() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.platformOrgs().then((r) => setOrgs(r.organisations)).catch(setError);
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

  return (
    <div className="page">
      <h1 className="large-title">All organisations</h1>
      <p className="subtitle">{orgs ? `${orgs.length} paying ${orgs.length === 1 ? 'customer' : 'customers'}` : 'Loading…'}</p>
      <ErrorBox error={error} />
      <div className="list">
        {orgs?.map((o) => (
          <div className="item" key={o.id}>
            <span className="grow">
              <span className="t1">{o.name}</span>
              <span className="t2">{o.owners.map((x) => x.email).join(', ')} · {o.stationCount} stations</span>
            </span>
            {o.status !== 'active' && <span className="pill warn">Suspended</span>}
            <button className="btn ghost small" onClick={() => toggle(o)}>{o.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
