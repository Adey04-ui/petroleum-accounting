// On-phone storage: a small cache of what the app last saw from the server, and an outbox of days saved while
// there was no signal. Uses IndexedDB (the browser's built-in database), so it survives closing the app.
import { openDB } from 'idb';

let dbPromise;
const db = () =>
  (dbPromise ??= openDB('station-sales', 1, {
    upgrade(d) {
      d.createObjectStore('kv'); // key -> any JSON
      d.createObjectStore('outbox', { keyPath: 'key' }); // `${stationId}|${date}` -> queued day
    },
  }));

const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback; // private mode / storage blocked: the app still works, just without offline help
  }
};

export const kvGet = (key) => safe(async () => (await db()).get('kv', key), undefined);
export const kvSet = (key, value) => safe(async () => (await db()).put('kv', value, key), undefined);
export const kvDelete = (key) => safe(async () => (await db()).delete('kv', key), undefined);

export const outboxAll = () => safe(async () => (await db()).getAll('outbox'), []);
export const outboxGet = (key) => safe(async () => (await db()).get('outbox', key), undefined);
export const outboxPut = (item) => safe(async () => (await db()).put('outbox', item), undefined);
export const outboxDelete = (key) => safe(async () => (await db()).delete('outbox', key), undefined);

export const outboxKey = (stationId, date) => `${stationId}|${date}`;

/** Forget everything stored on this phone (sign out). */
export const clearAll = () =>
  safe(async () => {
    const d = await db();
    await Promise.all([d.clear('kv'), d.clear('outbox')]);
  }, undefined);
