// In-memory store: used by the tests and by `npm run dev:memory`. Same interface as store/prisma.js.
export function createMemoryStore() {
  const clone = (x) => (x === undefined ? undefined : structuredClone(x));
  let seq = 0;
  const newId = (p) => `${p}${++seq}`;

  const users = new Map(); // id -> user
  const orgs = new Map();
  const owners = new Set(); // `${userId}|${orgId}`
  const stations = new Map();
  const roles = new Map(); // `${userId}|${stationId}` -> role
  const settings = new Map(); // `${stationId}|${key}` -> value
  const days = new Map(); // `${stationId}|${date}` -> { data, updatedById }
  const payments = new Map(); // txRef -> payment
  const limits = new Map(); // key -> { count, resetAt }

  const ownersOf = (orgId) => [...owners].filter((k) => k.endsWith(`|${orgId}`)).map((k) => Number(k.split('|')[0]));
  const stationsOf = (orgId) => [...stations.values()].filter((s) => s.organisationId === orgId);
  const withCount = (o) => ({ ...clone(o), stationCount: stationsOf(o.id).length });

  return {
    // ---- rate limiting
    /** Counts one attempt. Returns true while the caller is still within `max` attempts per window. */
    async hitRateLimit(key, max, windowMs) {
      const now = Date.now();
      const e = limits.get(key);
      const cur = e && e.resetAt > now ? e : { count: 0, resetAt: now + windowMs };
      cur.count += 1;
      limits.set(key, cur);
      return cur.count <= max;
    },
    async clearRateLimit(key) {
      limits.delete(key);
    },

    // ---- users
    async findUserByEmail(email) {
      return clone([...users.values()].find((u) => u.email === email)) ?? null;
    },
    async findUserById(id) {
      return clone(users.get(id)) ?? null;
    },
    async listUsersByIds(ids) {
      return ids.map((i) => users.get(i)).filter(Boolean).map(clone);
    },
    async createUser({ name, email, passwordHash, isPlatformAdmin = false }) {
      const user = { id: ++seq, name, email, passwordHash, isPlatformAdmin, createdAt: new Date() };
      users.set(user.id, user);
      return clone(user);
    },

    // ---- payments
    async createPayment({ txRef, userId, organisationName, amount, currency }) {
      const p = { id: newId('pay'), txRef, userId, organisationName, amount, currency, status: 'pending', flwTransactionId: null, createdAt: new Date() };
      payments.set(txRef, p);
      return clone(p);
    },
    async getPaymentByTxRef(txRef) {
      return clone(payments.get(txRef)) ?? null;
    },
    async markPaymentFailed(txRef) {
      const p = payments.get(txRef);
      if (p && p.status === 'pending') p.status = 'failed';
    },
    /** Creates the organisation for a verified payment, once. Safe to call repeatedly. */
    async fulfilPayment(txRef, flwTransactionId) {
      const p = payments.get(txRef);
      if (!p) throw new Error('Unknown payment');
      const existing = [...orgs.values()].find((o) => o.paymentId === p.id);
      if (existing) return { organisation: clone(existing), created: false };
      const organisation = { id: newId('org'), name: p.organisationName, status: 'active', paymentId: p.id, createdAt: new Date() };
      orgs.set(organisation.id, organisation);
      owners.add(`${p.userId}|${organisation.id}`);
      p.status = 'successful';
      p.flwTransactionId = flwTransactionId;
      return { organisation: clone(organisation), created: true };
    },

    // ---- organisations
    async getOrganisation(id) {
      return clone(orgs.get(id)) ?? null;
    },
    async updateOrganisation(id, patch) {
      const o = orgs.get(id);
      if (!o) return null;
      if (patch.name !== undefined) o.name = patch.name;
      if (patch.status !== undefined) o.status = patch.status;
      return clone(o);
    },
    async listOrganisationsForUser(userId) {
      return [...orgs.values()].filter((o) => owners.has(`${userId}|${o.id}`)).map(withCount);
    },
    async listAllOrganisations() {
      return [...orgs.values()].map((o) => ({
        ...withCount(o),
        owners: ownersOf(o.id).map((id) => {
          const u = users.get(id);
          return { id, name: u.name, email: u.email };
        }),
      }));
    },
    async isOrgOwner(userId, orgId) {
      return owners.has(`${userId}|${orgId}`);
    },
    async listOrgOwnerIds(orgId) {
      return ownersOf(orgId);
    },
    async addOrgOwner(orgId, userId) {
      owners.add(`${userId}|${orgId}`);
    },
    async removeOrgOwner(orgId, userId) {
      owners.delete(`${userId}|${orgId}`);
    },

    // ---- stations
    /** Returns null when the organisation already has `max` stations. */
    async createStation({ organisationId, name, address, max }) {
      if (stationsOf(organisationId).length >= max) return null;
      const s = { id: newId('st'), organisationId, name, address: address ?? null, createdAt: new Date() };
      stations.set(s.id, s);
      return clone(s);
    },
    async getStation(id) {
      return clone(stations.get(id)) ?? null;
    },
    async listStations(orgId) {
      return stationsOf(orgId).map(clone);
    },
    async updateStation(id, patch) {
      const s = stations.get(id);
      if (!s) return null;
      if (patch.name !== undefined) s.name = patch.name;
      if (patch.address !== undefined) s.address = patch.address;
      return clone(s);
    },
    async deleteStation(id) {
      stations.delete(id);
      for (const k of [...roles.keys()]) if (k.endsWith(`|${id}`)) roles.delete(k);
      for (const k of [...settings.keys()]) if (k.startsWith(`${id}|`)) settings.delete(k);
      for (const k of [...days.keys()]) if (k.startsWith(`${id}|`)) days.delete(k);
    },

    // ---- station roles (staff)
    async getStationRole(userId, stationId) {
      return roles.get(`${userId}|${stationId}`) ?? null;
    },
    async setStationRole(userId, stationId, role) {
      roles.set(`${userId}|${stationId}`, role);
    },
    async removeStationRole(userId, stationId) {
      roles.delete(`${userId}|${stationId}`);
    },
    async listStationRolesForUser(userId) {
      return [...roles].filter(([k]) => k.startsWith(`${userId}|`)).map(([k, role]) => ({ userId, stationId: k.split('|')[1], role }));
    },
    async listStationRolesForOrg(orgId) {
      const ids = new Set(stationsOf(orgId).map((s) => s.id));
      return [...roles]
        .map(([k, role]) => ({ userId: Number(k.split('|')[0]), stationId: k.split('|')[1], role }))
        .filter((r) => ids.has(r.stationId));
    },
    async removeUserFromOrg(orgId, userId) {
      owners.delete(`${userId}|${orgId}`);
      for (const s of stationsOf(orgId)) roles.delete(`${userId}|${s.id}`);
    },

    // ---- per-station settings and days
    async getSetting(stationId, key) {
      return clone(settings.get(`${stationId}|${key}`)) ?? null;
    },
    async setSetting(stationId, key, value) {
      settings.set(`${stationId}|${key}`, clone(value));
    },
    async listDays(stationId) {
      return [...days]
        .filter(([k]) => k.startsWith(`${stationId}|`))
        .map(([k, v]) => ({ date: k.split('|')[1], data: clone(v.data) }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async getDay(stationId, date) {
      const v = days.get(`${stationId}|${date}`);
      return v ? { date, data: clone(v.data) } : null;
    },
    async upsertDay(stationId, date, data, updatedById) {
      days.set(`${stationId}|${date}`, { data: clone(data), updatedById: updatedById ?? null });
    },
    async deleteDay(stationId, date) {
      days.delete(`${stationId}|${date}`);
    },
  };
}
