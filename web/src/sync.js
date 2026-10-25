// Uploads days that were saved on the phone while there was no signal.
//
// Every queued day is one record per station-and-date, so uploading it twice can never create two entries.
// The server stays the judge: it re-checks the meter chain and every rule. If it refuses a day, or someone else
// changed that day meanwhile, the day stays on the phone with the reason until a person decides what to do.
import { request, ApiError, NetworkError } from './api.js';
import { outboxAll, outboxPut, outboxDelete, outboxKey, kvDelete } from './offline.js';

const listeners = new Set();
export const onSyncChange = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const notify = () => listeners.forEach((cb) => cb());

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Everything waiting on this phone for this person, oldest day first. */
export async function queuedItems(userId) {
  return (await outboxAll()).filter((i) => i.userId === userId).sort(byDate);
}

export async function queueDay({ userId, stationId, date, body, baseVersion }) {
  await outboxPut({ key: outboxKey(stationId, date), userId, stationId, date, body, baseVersion, savedAt: Date.now(), status: 'pending', message: null });
  notify();
}

const forget = async (item) => {
  await outboxDelete(item.key);
  await kvDelete(`day:${item.stationId}:${item.date}`);
  await kvDelete(`month:${item.stationId}:${item.date.slice(0, 7)}`);
};

let running = false;

/** Tries to upload every pending day, oldest first. Stops quietly if the signal is still missing. */
export async function syncNow(userId) {
  if (running) return;
  running = true;
  try {
    for (const item of await queuedItems(userId)) {
      if (item.status !== 'pending') continue;
      try {
        await request('PUT', `/api/stations/${item.stationId}/days/${item.date}`, { ...item.body, baseVersion: item.baseVersion });
        await forget(item);
      } catch (e) {
        if (e instanceof NetworkError) break; // still offline
        if (!(e instanceof ApiError)) throw e;
        if (e.status === 401 || e.status === 429 || e.status >= 500) break; // sign in again / try later: keep everything
        if (e.status === 409 && e.code === 'CONFLICT') {
          await outboxPut({ ...item, status: 'conflict', message: e.message, serverEntry: e.data?.entry ?? null, serverVersion: e.data?.version ?? 0 });
        } else {
          await outboxPut({ ...item, status: 'rejected', message: e.message, errors: e.errors });
        }
      }
    }
  } finally {
    running = false;
    notify();
  }
}

export async function retryItem(item, userId) {
  await outboxPut({ ...item, status: 'pending', message: null });
  notify();
  await syncNow(userId);
}

/** "Keep mine": send my version on top of what is there now. */
export async function keepMine(item, userId) {
  await outboxPut({ ...item, status: 'pending', message: null, baseVersion: item.serverVersion ?? 0 });
  notify();
  await syncNow(userId);
}

export async function discardItem(item) {
  await outboxDelete(item.key);
  notify();
}

/** Upload when signal returns, when the app is opened, and every half minute while something is waiting. */
export function startAutoSync(userId) {
  const go = () => syncNow(userId);
  window.addEventListener('online', go);
  const timer = setInterval(async () => {
    if ((await queuedItems(userId)).some((i) => i.status === 'pending')) go();
  }, 30000);
  go();
  return () => {
    window.removeEventListener('online', go);
    clearInterval(timer);
  };
}
