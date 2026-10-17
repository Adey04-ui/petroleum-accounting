import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, Chevron, Sheet, Segmented, Switch } from '../ui.jsx';
import { ROLE_NAMES } from '../format.js';

function StationForm({ orgId, station, onSaved, close }) {
  const [name, setName] = useState(station?.name ?? '');
  const [address, setAddress] = useState(station?.address ?? '');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (station) await api.editStation(orgId, station.id, { name, address });
      else await api.addStation(orgId, { name, address });
      await onSaved();
      close();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteStation(orgId, station.id, confirm);
      await onSaved();
      close();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="card">
        <Field label="Station name" value={name} onChange={setName} placeholder="e.g. Ikeja Station" />
        <div style={{ height: '0.625rem' }} />
        <Field label="Address (optional)" value={address} onChange={setAddress} />
      </div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy || name.trim().length < 2}>{station ? 'Save' : 'Add station'}</button>

      {station && (
        <div className="destructive">
          <h3>Delete this station</h3>
          <p className="footnote">This permanently deletes every entry and setting for {station.name}. Type its name to confirm.</p>
          <Field label="Station name" value={confirm} onChange={setConfirm} />
          <div style={{ height: '0.625rem' }} />
          <button type="button" className="btn danger block" disabled={busy || confirm.trim() !== station.name} onClick={remove}>
            Delete {station.name}
          </button>
        </div>
      )}
    </form>
  );
}

function MemberForm({ orgId, member, stations, onSaved, close }) {
  const editing = Boolean(member);
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState('');
  const [isOwner, setIsOwner] = useState(member?.isOwner ?? false);
  const [roles, setRoles] = useState(() => Object.fromEntries((member?.stations ?? []).map((s) => [s.stationId, s.role])));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const assignments = Object.entries(roles).filter(([, r]) => r && r !== 'none').map(([stationId, role]) => ({ stationId, role }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.saveMember(orgId, member.userId, { isOwner, assignments });
      else await api.addMember(orgId, { name, email, password, isOwner, assignments });
      await onSaved();
      close();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function remove() {
    if (!sure) {
      setSure(true);
      setTimeout(() => setSure(false), 4000);
      return;
    }
    setBusy(true);
    try {
      await api.removeMember(orgId, member.userId);
      await onSaved();
      close();
    } catch (err) {
      setError(err);
      setBusy(false);
      setSure(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="card">
        {editing ? (
          <>
            <div className="t1" style={{ fontWeight: 600 }}>{member.name}</div>
            <div className="footnote">{member.email}</div>
          </>
        ) : (
          <>
            <Field label="Name" value={name} onChange={setName} autoComplete="off" />
            <div style={{ height: '0.625rem' }} />
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="off" />
            <div style={{ height: '0.625rem' }} />
            <Field label="Password for them (8 or more characters)" type="password" value={password} onChange={setPassword} autoComplete="new-password"
              hint="If this email already has an account, their password is not changed." />
          </>
        )}
      </div>

      <div className="section-title">Role</div>
      <div className="card">
        <div className="assign">
          <span>
            <span className="name">Owner</span>
            <span className="footnote" style={{ display: 'block' }}>Full access to every station, staff and cost prices.</span>
          </span>
          <Switch checked={isOwner} onChange={setIsOwner} label="Owner" />
        </div>
        {!isOwner && stations.map((s) => (
          <div className="assign" key={s.id}>
            <span className="name">{s.name}</span>
            <Segmented
              small
              label={`Role at ${s.name}`}
              value={roles[s.id] ?? 'none'}
              onChange={(v) => setRoles((r) => ({ ...r, [s.id]: v }))}
              options={[{ value: 'none', label: 'None' }, { value: 'manager', label: 'Manager' }, { value: 'attendant', label: 'Attendant' }]}
            />
          </div>
        ))}
        {!isOwner && stations.length === 0 && <p className="footnote">Add a station first, then give people a role there.</p>}
      </div>
      <p className="footnote">Attendants enter daily figures. Managers can also record deliveries. Only owners see cost prices and profit.</p>

      <ErrorBox error={error} />
      <button className="btn block" disabled={busy || (!editing && (name.trim().length < 2 || !email.includes('@')))}>
        {editing ? 'Save' : 'Add person'}
      </button>
      {editing && (
        <div className="destructive">
          <button type="button" className="btn danger block" disabled={busy} onClick={remove}>
            {sure ? 'Tap again to remove' : 'Remove from organisation'}
          </button>
        </div>
      )}
    </form>
  );
}

function RenameForm({ org, onSaved, close }) {
  const [name, setName] = useState(org.name);
  const [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault();
    try {
      await api.renameOrg(org.id, name);
      await onSaved();
      close();
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="card"><Field label="Organisation name" value={name} onChange={setName} /></div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={name.trim().length < 2}>Save</button>
    </form>
  );
}

export default function Org({ orgId, go, refreshMe }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.org(orgId));
    } catch (e) {
      setError(e);
    }
  }, [orgId]);
  const saved = useCallback(async () => {
    await load();
    await refreshMe();
  }, [load, refreshMe]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page muted">Loading…</div>;

  const { organisation, stations, members, limits } = data;
  const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
  const atLimit = stations.length >= limits.maxStations;
  const suspended = organisation.status !== 'active';
  const summary = (m) =>
    m.isOwner ? 'Owner · every station' : m.stations.map((s) => `${ROLE_NAMES[s.role]} at ${byId[s.stationId]?.name ?? 'a station'}`).join(', ');

  return (
    <div className="page">
      <h1 className="large-title">{organisation.name}</h1>
      <p className="subtitle">
        {stations.length} of {limits.maxStations} stations · {members.length} {members.length === 1 ? 'person' : 'people'}{' '}
        <button className="linkbtn" style={{ padding: 0 }} onClick={() => setSheet({ type: 'org' })}>Rename</button>
      </p>
      {suspended && <div className="msg warn">This organisation is suspended, so changes are switched off. Please contact support.</div>}

      <div className="section-title">Stations</div>
      <div className="list">
        {stations.map((s) => (
          <div className="item" key={s.id}>
            <button className="rowbtn" onClick={() => go({ name: 'station', stationId: s.id })} disabled={suspended}>
              <span className="t1">{s.name}</span>
              <span className="t2">{s.address || 'Open to enter figures and see results'}</span>
            </button>
            <button className="linkbtn" onClick={() => setSheet({ type: 'station', station: s })} disabled={suspended}>Edit</button>
            <Chevron />
          </div>
        ))}
        <button className="item" disabled={atLimit || suspended} onClick={() => setSheet({ type: 'station' })}>
          <span className="grow t1" style={{ color: atLimit ? 'var(--label-3)' : 'var(--accent)' }}>Add a station</span>
        </button>
      </div>
      {atLimit && <p className="footnote">You have reached the limit of {limits.maxStations} stations.</p>}

      <div className="section-title">Staff</div>
      <div className="list">
        {members.map((m) => (
          <button key={m.userId} className="item" disabled={suspended} onClick={() => setSheet({ type: 'member', member: m })}>
            <span className="grow">
              <span className="t1">{m.name}</span>
              <span className="t2">{summary(m)}</span>
            </span>
            <Chevron />
          </button>
        ))}
        <button className="item" disabled={suspended} onClick={() => setSheet({ type: 'member' })}>
          <span className="grow t1" style={{ color: 'var(--accent)' }}>Add a person</span>
        </button>
      </div>

      {sheet?.type === 'station' && (
        <Sheet title={sheet.station ? 'Edit station' : 'New station'} onClose={() => setSheet(null)}>
          {(close) => <StationForm orgId={orgId} station={sheet.station} onSaved={saved} close={close} />}
        </Sheet>
      )}
      {sheet?.type === 'member' && (
        <Sheet title={sheet.member ? 'Roles' : 'New person'} onClose={() => setSheet(null)}>
          {(close) => <MemberForm orgId={orgId} member={sheet.member} stations={stations} onSaved={saved} close={close} />}
        </Sheet>
      )}
      {sheet?.type === 'org' && (
        <Sheet title="Rename" onClose={() => setSheet(null)}>
          {(close) => <RenameForm org={organisation} onSaved={saved} close={close} />}
        </Sheet>
      )}
    </div>
  );
}
