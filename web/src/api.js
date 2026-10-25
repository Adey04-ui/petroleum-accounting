import { kvGet, kvSet } from './offline.js';

const BASE = import.meta.env.VITE_API_URL ?? '';
const KEY = 'station-token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

/** The request never reached the server (no signal, server asleep, address wrong). */
export class NetworkError extends Error {
  constructor() {
    super('No internet connection');
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error ?? `Request failed (${status})`);
    this.status = status;
    this.code = data?.code;
    this.errors = data?.errors ?? [];
    this.data = data;
  }
}

export async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Everything inside a station goes through /api/stations/:id. The app sets which one is open.
let stationId = null;
export const setStation = (id) => {
  stationId = id;
};
export const currentStation = () => stationId;
const st = (path) => `/api/stations/${stationId}${path}`;
const org = (id, path = '') => `/api/organisations/${id}${path}`;

/**
 * A read that remembers its answer on the phone. With no signal it returns the last answer it saw
 * (marked `offline: true`) instead of failing.
 */
async function cachedRead(key, fn) {
  try {
    const fresh = await fn();
    await kvSet(key, fresh);
    return fresh;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const old = await kvGet(key);
    if (old === undefined) throw e;
    return { ...old, offline: true };
  }
}

export const api = {
  // accounts
  register: (name, email, password) => request('POST', '/api/auth/register', { name, email, password }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  me: () => cachedRead('me', () => request('GET', '/api/me')),

  // paying for an organisation (and renewing it)
  checkout: (organisationName, autoRenew) => request('POST', '/api/billing/checkout', { organisationName, autoRenew }),
  renew: (organisationId, autoRenew) => request('POST', '/api/billing/renew', { organisationId, autoRenew }),
  verifyPayment: (params) => request('GET', `/api/billing/verify?${new URLSearchParams(params)}`),

  // organisation dashboard (owners)
  org: (id) => request('GET', org(id)),
  renameOrg: (id, name) => request('PUT', org(id), { name }),
  addStation: (id, body) => request('POST', org(id, '/stations'), body),
  editStation: (id, stationId_, body) => request('PUT', org(id, `/stations/${stationId_}`), body),
  deleteStation: (id, stationId_, confirmName) => request('DELETE', org(id, `/stations/${stationId_}`), { confirmName }),
  addMember: (id, body) => request('POST', org(id, '/members'), body),
  saveMember: (id, userId, body) => request('PUT', org(id, `/members/${userId}`), body),
  removeMember: (id, userId) => request('DELETE', org(id, `/members/${userId}`)),

  // platform admin
  platformOrgs: () => request('GET', '/api/platform/organisations'),
  setOrgStatus: (id, status) => request('PUT', `/api/platform/organisations/${id}`, { status }),
  setPaidUntil: (id, paidUntil) => request('PUT', `/api/platform/organisations/${id}/paid-until`, { paidUntil }),
  unmatchedPayments: () => request('GET', '/api/platform/payments/unmatched'),
  assignPayment: (txRef, organisationId) => request('POST', `/api/platform/payments/${encodeURIComponent(txRef)}/assign`, { organisationId }),

  // inside the open station
  meta: () => {
    const id = stationId;
    return cachedRead(`meta:${id}`, () => request('GET', st('/meta')));
  },
  getDay: (date) => {
    const id = stationId;
    return cachedRead(`day:${id}:${date}`, () => request('GET', st(`/days/${date}`)));
  },
  saveDay: (date, body) => request('PUT', st(`/days/${date}`), body),
  deleteDay: (date) => request('DELETE', st(`/days/${date}`)),
  month: (month) => {
    const id = stationId;
    return cachedRead(`month:${id}:${month}`, () => request('GET', st(`/days?month=${month}`)));
  },
  getConfig: () => request('GET', st('/config')),
  saveConfig: (config) => request('PUT', st('/config'), config),
  getAdjustments: (month) => request('GET', st(`/adjustments/${month}`)),
  saveAdjustments: (month, adjustments) => request('PUT', st(`/adjustments/${month}`), { adjustments }),
};

export async function downloadExport(month) {
  let res;
  try {
    res = await fetch(`${BASE}${st(`/export?month=${month}`)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    throw new ApiError(res.status, data);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `station-${month}.xlsx`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
