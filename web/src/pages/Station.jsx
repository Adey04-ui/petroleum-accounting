import React, { useEffect, useState } from 'react';
import { api, setStation } from '../api.js';
import { Segmented, Sheet, ErrorBox, Chevron } from '../ui.jsx';
import { ROLE_NAMES } from '../format.js';
import Entry from './Entry.jsx';
import Results from './Results.jsx';
import Settings from './Settings.jsx';

export default function Station({ stationId, me, go }) {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('entry');
  const [switcher, setSwitcher] = useState(false);

  const load = () =>
    api
      .meta()
      .then((m) => {
        setMeta(m);
        return m;
      })
      .catch(setError);

  useEffect(() => {
    setStation(stationId);
    setMeta(null);
    setError(null);
    load().then((m) => m && !m.configured && m.permissions.admin && setTab('settings'));
  }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!meta) return <div className="page muted">Loading…</div>;

  const admin = meta.permissions.admin;
  const tabs = [{ value: 'entry', label: 'Daily entry' }, { value: 'results', label: 'Results' }, ...(admin ? [{ value: 'settings', label: 'Settings' }] : [])];

  return (
    <div className="page">
      <h1 className="large-title">{meta.station.name}</h1>
      <p className="subtitle">
        {meta.organisation.name} · {ROLE_NAMES[meta.role]}
        {me.stations.length > 1 && (
          <>
            {' '}
            <button className="linkbtn" style={{ padding: 0 }} onClick={() => setSwitcher(true)}>Switch station</button>
          </>
        )}
      </p>

      <div className="tabs"><Segmented label="Sections" options={tabs} value={tab} onChange={setTab} /></div>

      {!meta.configured && !admin && <div className="msg warn">This station has not been set up yet. Ask the owner to finish the setup.</div>}
      {!meta.configured && admin && tab !== 'settings' && <div className="msg warn">Finish setting up this station in Settings first.</div>}

      {meta.configured && tab === 'entry' && <Entry meta={meta} />}
      {meta.configured && tab === 'results' && <Results meta={meta} />}
      {admin && tab === 'settings' && <Settings meta={meta} onSaved={load} />}

      {switcher && (
        <Sheet title="Switch station" onClose={() => setSwitcher(false)}>
          {(close) => (
            <div className="list">
              {me.stations.map((s) => (
                <button key={s.id} className="item" onClick={() => { close(); if (s.id !== stationId) go({ name: 'station', stationId: s.id }, { replace: true }); }}>
                  <span className="grow">
                    <span className="t1">{s.name}</span>
                    <span className="t2">{s.organisationName} · {ROLE_NAMES[s.role]}</span>
                  </span>
                  {s.id === stationId ? <span className="pill">Open</span> : <Chevron />}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
