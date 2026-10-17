const BASE = import.meta.env.VITE_API_URL ?? '';
const KEY = 'station-token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error ?? `Request failed (${status})`);
    this.status = status;
    this.code = data?.code;
    this.errors = data?.errors ?? [];
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
const st = (path) => `/api/stations/${stationId}${path}`;
const org = (id, path = '') => `/api/organisations/${id}${path}`;

export const api = {
  // accounts
  register: (name, email, password) => request('POST', '/api/auth/register', { name, email, password }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  me: () => request('GET', '/api/me'),

  // paying for an organisation
  checkout: (organisationName) => request('POST', '/api/billing/checkout', { organisationName }),
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

  // inside the open station
  meta: () => request('GET', st('/meta')),
  getDay: (date) => request('GET', st(`/days/${date}`)),
  saveDay: (date, body) => request('PUT', st(`/days/${date}`), body),
  deleteDay: (date) => request('DELETE', st(`/days/${date}`)),
  month: (month) => request('GET', st(`/days?month=${month}`)),
  getConfig: () => request('GET', st('/config')),
  saveConfig: (config) => request('PUT', st('/config'), config),
  getAdjustments: (month) => request('GET', st(`/adjustments/${month}`)),
  saveAdjustments: (month, adjustments) => request('PUT', st(`/adjustments/${month}`), { adjustments }),
};

export async function downloadExport(month) {
  const res = await fetch(`${BASE}${st(`/export?month=${month}`)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
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
