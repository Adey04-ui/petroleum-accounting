import React, { useCallback, useEffect, useState } from 'react';
import { queuedItems, onSyncChange, syncNow, retryItem, keepMine, discardItem } from '../sync.js';

/** The little pill in the top bar: how many days are on this phone and not on the server yet. */
export function SyncBadge({ userId, onOpen }) {
  const [items, setItems] = useState([]);
  const refresh = useCallback(async () => setItems(await queuedItems(userId)), [userId]);

  useEffect(() => {
    refresh();
    const off = onSyncChange(refresh);
    window.addEventListener('focus', refresh);
    return () => {
      off();
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  if (items.length === 0) return null;
  const stuck = items.some((i) => i.status !== 'pending');
  return (
    <button className={`sync${stuck ? ' bad' : ''}`} onClick={onOpen} aria-label={`${items.length} days saved on this phone`}>
      <span className="dot" />
      {stuck ? 'Needs attention' : `${items.length} waiting`}
    </button>
  );
}

const STATUS = { pending: 'Waiting to upload', conflict: 'Someone else changed this day', rejected: 'Not accepted' };

/** Everything saved on this phone that the server has not taken yet, with what to do about each. */
export function SyncList({ me, go, close }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setItems(await queuedItems(me.user.id)), [me.user.id]);

  useEffect(() => {
    refresh();
    return onSyncChange(refresh);
  }, [refresh]);

  const stationName = (id) => me.stations.find((s) => s.id === id)?.name ?? 'Station';
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!items) return <div className="muted">Loading…</div>;
  return (
    <div>
      {items.length === 0 && <div className="card"><div className="empty"><div className="big">All uploaded</div>Nothing is waiting on this phone.</div></div>}
      {items.length > 0 && (
        <>
          <div className="list">
            {items.map((i) => (
              <div className="item" key={i.key} style={{ alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="t1">{stationName(i.stationId)} · {i.date}</span>
                  <span className="t2" style={{ whiteSpace: 'normal' }}>{STATUS[i.status]}{i.message ? `: ${i.message}` : ''}</span>
                  {i.errors?.map((e, k) => <span className="t2" style={{ whiteSpace: 'normal' }} key={k}>{e.date}: {e.message}</span>)}
                  <span className="row" style={{ marginTop: '0.5rem' }}>
                    {i.status === 'pending' && <button className="btn small" disabled={busy} onClick={() => run(() => retryItem(i, me.user.id))}>Upload now</button>}
                    {i.status === 'conflict' && <button className="btn small" disabled={busy} onClick={() => run(() => keepMine(i, me.user.id))}>Keep mine</button>}
                    {i.status === 'rejected' && <button className="btn small" onClick={() => { close(); go({ name: 'station', stationId: i.stationId, date: i.date }); }}>Fix it</button>}
                    <button className="btn ghost small" disabled={busy} onClick={() => run(() => discardItem(i))}>Discard</button>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <button className="btn ghost block" disabled={busy} onClick={() => run(() => syncNow(me.user.id))}>Try uploading everything</button>
        </>
      )}
    </div>
  );
}
