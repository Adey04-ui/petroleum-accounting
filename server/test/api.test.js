import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/createApp.js';
import { createFakeFlutterwave } from '../src/fakeFlutterwave.js';
import { storeKinds, makeStore } from './helpers.js';
import { config as octConfig, days as octDays } from './engine/october.fixture.js';

const PRICE = { amount: 15000, currency: 'NGN' };
const stationConfig = {
  costingMethod: 'WAC',
  pms: { pumps: ['1A', '2A'], openingStock: 5100, openingCostPerLitre: 1351, toleranceRate: 0.04 },
};
const dayBody = (i) => ({
  pms: { pumps: octDays[i].pms.pumps, closingStock: octDays[i].pms.closingStock, sellingPrice: 1390 },
  expenses: octDays[i].expenses,
  pos: octDays[i].pos,
});

describe.each(storeKinds)('API (%s store)', (kind) => {
  let server, base, store, close, flw;
  let ownerA, ownerB, staff, other, admin; // tokens
  let orgA, orgB, stA1, stA2, stB1;

  async function api(method, path, { token, body, headers } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const register = async (name, email) => (await api('POST', '/api/auth/register', { body: { name, email, password: 'password123' } })).body.token;
  const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: 'password123' } })).body.token;

  /** The full customer journey: checkout, "pay", come back and verify. */
  async function buyOrganisation(token, name) {
    const c = await api('POST', '/api/billing/checkout', { token, body: { organisationName: name } });
    expect(c.status).toBe(200);
    const q = new URL(c.body.link).searchParams;
    const v = await api('GET', `/api/billing/verify?tx_ref=${q.get('tx_ref')}&transaction_id=${q.get('transaction_id')}&status=${q.get('status')}`, { token });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('successful');
    return v.body.organisation;
  }

  beforeAll(async () => {
    ({ store, close } = await makeStore(kind));
    flw = createFakeFlutterwave();
    const app = createApp(store, { jwtSecret: 'test-secret-test-secret', flutterwave: flw, webhookHash: 'whsec', pricing: PRICE, webUrl: 'http://app.test', loginLimit: 50 });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
    await store.createUser({ name: 'Admin', email: 'admin@test.com', passwordHash: await bcrypt.hash('password123', 4), isPlatformAdmin: true });
    admin = await login('admin@test.com');
    ownerA = await register('Owner A', 'a@test.com');
    ownerB = await register('Owner B', 'b@test.com');
    staff = await register('Staff', 'staff@test.com');
    other = await register('Other', 'other@test.com');
  });
  afterAll(async () => {
    server.close();
    await close();
  });

  describe('accounts', () => {
    it('validates registration and refuses duplicates', async () => {
      expect((await api('POST', '/api/auth/register', { body: { name: 'X', email: 'nope', password: 'password123' } })).status).toBe(400);
      expect((await api('POST', '/api/auth/register', { body: { name: 'Xavier', email: 'x@test.com', password: 'short' } })).status).toBe(400);
      expect((await api('POST', '/api/auth/register', { body: { name: 'Again', email: 'A@test.com', password: 'password123' } })).status).toBe(409);
    });

    it('logs in, rejects a wrong password, and protects /me', async () => {
      expect((await api('POST', '/api/auth/login', { body: { email: 'a@test.com', password: 'nope' } })).status).toBe(401);
      expect((await api('GET', '/api/me')).status).toBe(401);
      const me = await api('GET', '/api/me', { token: ownerA });
      expect(me.body.user.email).toBe('a@test.com');
      expect(me.body.organisations).toEqual([]);
      expect(me.body.pricing).toMatchObject({ amount: 15000, currency: 'NGN', paymentsEnabled: true });
      expect(me.body.limits.maxStations).toBe(5);
      expect(me.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('paying for an organisation', () => {
    it('needs a name and a signed-in user', async () => {
      expect((await api('POST', '/api/billing/checkout', { body: { organisationName: 'X Fuels' } })).status).toBe(401);
      expect((await api('POST', '/api/billing/checkout', { token: ownerA, body: { organisationName: ' ' } })).status).toBe(400);
    });

    it('creates the organisation only after a verified payment, and only once', async () => {
      const c = await api('POST', '/api/billing/checkout', { token: ownerA, body: { organisationName: 'Alpha Fuels' } });
      expect(c.body.link).toContain('payment=return');
      expect(flw.calls.at(-1)).toMatchObject({ amount: 15000, currency: 'NGN', customer: { email: 'a@test.com' } });
      expect((await api('GET', '/api/me', { token: ownerA })).body.organisations).toHaveLength(0); // not paid yet

      const q = new URL(c.body.link).searchParams;
      const url = `/api/billing/verify?tx_ref=${q.get('tx_ref')}&transaction_id=${q.get('transaction_id')}`;
      const first = await api('GET', url, { token: ownerA });
      const again = await api('GET', url, { token: ownerA });
      expect(first.body.organisation.name).toBe('Alpha Fuels');
      expect(again.body.organisation.id).toBe(first.body.organisation.id);
      const me = await api('GET', '/api/me', { token: ownerA });
      expect(me.body.organisations).toHaveLength(1);
      orgA = first.body.organisation;
    });

    it('does not create an organisation when the payment is not successful, too small, or someone else\'s', async () => {
      const c = await api('POST', '/api/billing/checkout', { token: ownerB, body: { organisationName: 'Beta Fuels' } });
      const q = new URL(c.body.link).searchParams;
      const url = `/api/billing/verify?tx_ref=${q.get('tx_ref')}&transaction_id=${q.get('transaction_id')}`;

      expect((await api('GET', url, { token: ownerA })).status).toBe(404); // someone else's payment
      expect((await api('GET', url + '&status=cancelled', { token: ownerB })).body.status).toBe('cancelled');

      flw.outcome = 'failed';
      expect((await api('GET', url, { token: ownerB })).body.status).toBe('failed');
      flw.outcome = 'successful';

      flw.amountOverride = 100;
      expect((await api('GET', url, { token: ownerB })).status).toBe(400);
      flw.amountOverride = null;

      expect((await api('GET', '/api/me', { token: ownerB })).body.organisations).toHaveLength(0);
      const ok = await api('GET', url, { token: ownerB });
      expect(ok.body.status).toBe('successful'); // the genuine payment still works afterwards
      orgB = ok.body.organisation;
    });

    it('accepts Flutterwave\'s webhook only with the secret hash, and never creates a second organisation', async () => {
      const c = await api('POST', '/api/billing/checkout', { token: other, body: { organisationName: 'Gamma Fuels' } });
      const q = new URL(c.body.link).searchParams;
      const event = { event: 'charge.completed', data: { id: q.get('transaction_id'), tx_ref: q.get('tx_ref'), status: 'successful' } };

      expect((await api('POST', '/api/billing/webhook', { body: event })).status).toBe(401);
      expect((await api('POST', '/api/billing/webhook', { body: event, headers: { 'verif-hash': 'wrong' } })).status).toBe(401);
      expect((await api('GET', '/api/me', { token: other })).body.organisations).toHaveLength(0);

      expect((await api('POST', '/api/billing/webhook', { body: event, headers: { 'verif-hash': 'whsec' } })).status).toBe(200);
      expect((await api('POST', '/api/billing/webhook', { body: event, headers: { 'verif-hash': 'whsec' } })).status).toBe(200);
      const url = `/api/billing/verify?tx_ref=${q.get('tx_ref')}&transaction_id=${q.get('transaction_id')}`;
      expect((await api('GET', url, { token: other })).body.status).toBe('successful');
      expect((await api('GET', '/api/me', { token: other })).body.organisations).toHaveLength(1);
    });

    it('reports a payment provider failure without keeping a half-made organisation', async () => {
      const broken = createApp(store, { jwtSecret: 'x'.repeat(20), flutterwave: { enabled: true, initiate: async () => { throw new Error('down'); } }, pricing: PRICE });
      const srv = await new Promise((r) => { const s = broken.listen(0, () => r(s)); });
      const b = `http://127.0.0.1:${srv.address().port}`;
      const t = (await (await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staff@test.com', password: 'password123' }) })).json()).token;
      const res = await fetch(b + '/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ organisationName: 'Delta' }) });
      expect(res.status).toBe(502);
      srv.close();
    });
  });

  describe('organisation dashboard: stations', () => {
    it('lets the owner add up to 5 stations and no more', async () => {
      const created = [];
      for (let i = 1; i <= 5; i++) {
        const r = await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerA, body: { name: `Station ${i}`, address: `Road ${i}` } });
        expect(r.status).toBe(201);
        created.push(r.body.station);
      }
      const sixth = await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerA, body: { name: 'Station 6' } });
      expect(sixth.status).toBe(409);
      expect(sixth.body.code).toBe('STATION_LIMIT');
      [stA1, stA2] = created;
      const b1 = await api('POST', `/api/organisations/${orgB.id}/stations`, { token: ownerB, body: { name: 'B One' } });
      stB1 = b1.body.station;
      expect((await api('GET', `/api/organisations/${orgA.id}`, { token: ownerA })).body.stations).toHaveLength(5);
    });

    it('keeps other people out of the dashboard', async () => {
      for (const token of [ownerB, staff, undefined]) {
        const r = await api('GET', `/api/organisations/${orgA.id}`, { token });
        expect([401, 404]).toContain(r.status);
      }
      expect((await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerB, body: { name: 'Sneaky' } })).status).toBe(404);
    });

    it('renames a station, and refuses to touch another organisation\'s station', async () => {
      const r = await api('PUT', `/api/organisations/${orgA.id}/stations/${stA2.id}`, { token: ownerA, body: { name: 'Ikeja Main' } });
      expect(r.body.station.name).toBe('Ikeja Main');
      expect((await api('PUT', `/api/organisations/${orgA.id}/stations/${stB1.id}`, { token: ownerA, body: { name: 'Hijacked' } })).status).toBe(404);
    });
  });

  describe('organisation dashboard: staff and roles', () => {
    it('creates a login for a new person and assigns a role per station', async () => {
      const r = await api('POST', `/api/organisations/${orgA.id}/members`, {
        token: ownerA,
        body: { name: 'Ade Attendant', email: 'ade@test.com', password: 'password123', assignments: [{ stationId: stA1.id, role: 'attendant' }] },
      });
      expect(r.status).toBe(201);
      expect(r.body.member.stations).toEqual([{ stationId: stA1.id, role: 'attendant' }]);
      expect((await login('ade@test.com'))).toBeTruthy();
    });

    it('gives an existing person a role without changing their password, and different roles at different stations', async () => {
      const r = await api('POST', `/api/organisations/${orgA.id}/members`, {
        token: ownerA,
        body: { email: 'staff@test.com', password: 'differentpass1', assignments: [{ stationId: stA1.id, role: 'manager' }, { stationId: stA2.id, role: 'attendant' }] },
      });
      expect(r.status).toBe(201);
      expect(await login('staff@test.com')).toBeTruthy(); // still the old password
      const me = await api('GET', '/api/me', { token: staff });
      expect(me.body.stations.map((s) => [s.id, s.role]).sort()).toEqual([[stA1.id, 'manager'], [stA2.id, 'attendant']].sort());
    });

    it('rejects bad assignments', async () => {
      const post = (body) => api('POST', `/api/organisations/${orgA.id}/members`, { token: ownerA, body: { email: 'z@test.com', name: 'Zed', password: 'password123', ...body } });
      expect((await post({ assignments: [] })).status).toBe(400);
      expect((await post({ assignments: [{ stationId: stA1.id, role: 'owner' }] })).status).toBe(400);
      expect((await post({ assignments: [{ stationId: stB1.id, role: 'manager' }] })).status).toBe(400); // another organisation's station
    });

    it('changes roles, protects the last owner, and removes people', async () => {
      const ade = (await store.findUserByEmail('ade@test.com')).id;
      const up = await api('PUT', `/api/organisations/${orgA.id}/members/${ade}`, { token: ownerA, body: { assignments: [{ stationId: stA1.id, role: 'manager' }, { stationId: stA2.id, role: 'attendant' }] } });
      expect(up.body.member.stations).toHaveLength(2);
      const less = await api('PUT', `/api/organisations/${orgA.id}/members/${ade}`, { token: ownerA, body: { assignments: [{ stationId: stA2.id, role: 'attendant' }] } });
      expect(less.body.member.stations).toEqual([{ stationId: stA2.id, role: 'attendant' }]);

      const ownerId = (await store.findUserByEmail('a@test.com')).id;
      expect((await api('DELETE', `/api/organisations/${orgA.id}/members/${ownerId}`, { token: ownerA })).status).toBe(400); // last owner
      expect((await api('PUT', `/api/organisations/${orgA.id}/members/${ownerId}`, { token: ownerA, body: { isOwner: false, assignments: [{ stationId: stA1.id, role: 'manager' }] } })).status).toBe(400);

      expect((await api('DELETE', `/api/organisations/${orgA.id}/members/${ade}`, { token: ownerA })).status).toBe(200);
      expect((await api('GET', '/api/me', { token: await login('ade@test.com') })).body.stations).toHaveLength(0);
      expect((await api('DELETE', `/api/organisations/${orgA.id}/members/${ade}`, { token: ownerA })).status).toBe(404);
    });

    it('lets an owner add a co-owner who then sees every station', async () => {
      const r = await api('POST', `/api/organisations/${orgA.id}/members`, { token: ownerA, body: { email: 'other@test.com', isOwner: true } });
      expect(r.status).toBe(201);
      const me = await api('GET', '/api/me', { token: other });
      expect(me.body.stations.filter((s) => s.organisationId === orgA.id)).toHaveLength(5);
      expect((await api('DELETE', `/api/organisations/${orgA.id}/members/${r.body.member.userId}`, { token: ownerA })).status).toBe(200);
    });
  });

  describe('inside a station: roles and calculations', () => {
    const S = (st, path) => `/api/stations/${st.id}${path}`;

    it('only the owner can set up the station', async () => {
      expect((await api('PUT', S(stA1, '/config'), { token: staff, body: stationConfig })).status).toBe(403); // manager
      expect((await api('GET', S(stA1, '/days/2026-10-01'), { token: ownerA })).status).toBe(409); // not set up yet
      expect((await api('PUT', S(stA1, '/config'), { token: ownerA, body: stationConfig })).status).toBe(200);
      expect((await api('PUT', S(stA2, '/config'), { token: ownerA, body: stationConfig })).status).toBe(200);
    });

    it('a manager enters days and sees cash and tolerance but no cost or profit', async () => {
      let r;
      for (let i = 0; i < 3; i++) {
        r = await api('PUT', S(stA1, `/days/2026-10-0${i + 1}`), { token: staff, body: dayBody(i) });
        expect(r.status).toBe(200);
      }
      const first = (await api('PUT', S(stA1, '/days/2026-10-01'), { token: staff, body: dayBody(0) })).body.day;
      expect(first.pms.pumpSales).toBeCloseTo(320.96, 2);
      expect(first.banking.cashToLodge).toBeCloseTo(-97065.6, 2);
      expect(first.pms.profit).toBeUndefined();
      expect(first.pms.unitCost).toBeUndefined();
      expect(first.profit).toBeUndefined();
    });

    it('the owner sees the same days with profit, matching the spreadsheet', async () => {
      const r = await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA });
      expect(r.body.days).toHaveLength(3);
      expect(r.body.days[0].pms.profit).toBeCloseTo(13814.4, 2);
      expect(r.body.summary.profitBeforeExpenses).toBeCloseTo(13814.4 + 508.9 + 42420.6, 2);
      const staffView = await api('GET', S(stA1, '/days?month=2026-10'), { token: staff });
      expect(staffView.body.summary.profitBeforeExpenses).toBeUndefined();
      expect(staffView.body.summary.products.pms.priceMargin).toBeUndefined();
    });

    it('stations of the same organisation have separate data', async () => {
      expect((await api('GET', S(stA2, '/days?month=2026-10'), { token: ownerA })).body.days).toHaveLength(0);
      const r = await api('PUT', S(stA2, '/days/2026-10-01'), { token: ownerA, body: dayBody(0) });
      expect(r.status).toBe(200);
      expect((await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA })).body.days).toHaveLength(3);
    });

    it('rejects numbers that do not add up', async () => {
      const bad = dayBody(3);
      bad.pms.pumps = [{ id: '1A', closing: 100 }, { id: '2A', closing: 45536.13 }];
      const r = await api('PUT', S(stA1, '/days/2026-10-04'), { token: staff, body: bad });
      expect(r.status).toBe(422);
      expect(JSON.stringify(r.body.errors)).toMatch(/lower than opening/);
    });

    it('keeps cost prices owner-only: a manager records litres, the owner fills in the cost', async () => {
      const body = dayBody(3);
      body.pms.deliveries = [{ litres: 10000 }];
      body.pms.closingStock = 4180 + 10000 - 320;
      let r = await api('PUT', S(stA1, '/days/2026-10-04'), { token: staff, body });
      expect(r.status).toBe(200);
      expect((await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA })).body.missingCosts).toEqual(['2026-10-04']);

      const entry = (await api('GET', S(stA1, '/days/2026-10-04'), { token: ownerA })).body.entry;
      entry.pms.deliveries = [{ litres: 10000, costPerLitre: 1400 }];
      r = await api('PUT', S(stA1, '/days/2026-10-04'), { token: ownerA, body: entry });
      expect(r.body.day.pms.replacementCost).toBe(1400);
      expect(r.body.day.pms.priceChangeGain).toBeGreaterThan(0);

      const view = (await api('GET', S(stA1, '/days/2026-10-04'), { token: staff })).body.entry;
      expect(view.pms.deliveries[0].costPerLitre).toBeUndefined();
      await api('PUT', S(stA1, '/days/2026-10-04'), { token: staff, body: view });
      expect((await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA })).body.missingCosts).toEqual([]);
    });

    it('an attendant cannot change deliveries and cannot set up the station', async () => {
      const ade = await api('POST', `/api/organisations/${orgA.id}/members`, { token: ownerA, body: { name: 'Ade', email: 'ade2@test.com', password: 'password123', assignments: [{ stationId: stA1.id, role: 'attendant' }] } });
      expect(ade.status).toBe(201);
      const t = await login('ade2@test.com');
      const view = (await api('GET', S(stA1, '/days/2026-10-04'), { token: t })).body.entry;
      view.pms.deliveries = [];
      const r = await api('PUT', S(stA1, '/days/2026-10-04'), { token: t, body: view });
      expect(r.body.day.pms.received).toBe(10000);
      expect((await api('PUT', S(stA1, '/config'), { token: t, body: stationConfig })).status).toBe(403);
      expect((await api('GET', S(stA1, '/export?month=2026-10'), { token: t })).status).toBe(403);
    });

    it('monthly deductions reduce profit after expenses', async () => {
      const before = (await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA })).body.summary;
      await api('PUT', S(stA1, '/adjustments/2026-10'), { token: ownerA, body: { adjustments: [{ label: 'Moniepoint shortage', amount: 5000 }] } });
      const after = (await api('GET', S(stA1, '/days?month=2026-10'), { token: ownerA })).body.summary;
      expect(after.profitAfterExpenses).toBeCloseTo(before.profitAfterExpenses - 5000, 2);
    });

    it('downloads a station\'s month as Excel (owner only)', async () => {
      const ok = await fetch(base + S(stA1, '/export?month=2026-10'), { headers: { Authorization: `Bearer ${ownerA}` } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toMatch(/spreadsheetml/);
      expect(ok.headers.get('content-disposition')).toMatch(/station-1-2026-10\.xlsx/);
      const bytes = new Uint8Array(await ok.arrayBuffer());
      expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
      expect((await api('GET', S(stA1, '/export?month=2025-01'), { token: ownerA })).status).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('one organisation can never read or write another\'s station', async () => {
      await api('PUT', `/api/stations/${stB1.id}/config`, { token: ownerB, body: stationConfig });
      await api('PUT', `/api/stations/${stB1.id}/days/2026-10-01`, { token: ownerB, body: dayBody(0) });

      const attempts = [
        ['GET', `/api/stations/${stB1.id}/meta`], ['GET', `/api/stations/${stB1.id}/config`],
        ['GET', `/api/stations/${stB1.id}/days?month=2026-10`], ['GET', `/api/stations/${stB1.id}/days/2026-10-01`],
        ['GET', `/api/stations/${stB1.id}/export?month=2026-10`], ['PUT', `/api/stations/${stB1.id}/days/2026-10-02`, dayBody(1)],
        ['PUT', `/api/stations/${stB1.id}/config`, stationConfig], ['DELETE', `/api/stations/${stB1.id}/days/2026-10-01`],
      ];
      for (const token of [ownerA, staff]) {
        for (const [method, path, body] of attempts) {
          const r = await api(method, path, { token, body });
          expect([403, 404], `${method} ${path}`).toContain(r.status);
          expect(r.body.pms ?? r.body.days ?? r.body.entry).toBeUndefined();
        }
      }
      expect((await api('GET', `/api/stations/${stB1.id}/days?month=2026-10`, { token: ownerB })).body.days).toHaveLength(1);
    });

    it('a staff member can use only the stations they were given', async () => {
      const stA3 = (await api('GET', `/api/organisations/${orgA.id}`, { token: ownerA })).body.stations[2];
      expect((await api('GET', `/api/stations/${stA3.id}/meta`, { token: staff })).status).toBe(404);
      expect((await api('GET', `/api/stations/${stA1.id}/meta`, { token: staff })).body.role).toBe('manager');
    });

    it('a station id that does not exist looks the same as one that is not yours', async () => {
      expect((await api('GET', '/api/stations/does-not-exist/meta', { token: ownerA })).status).toBe(404);
    });
  });

  describe('platform admin and suspension', () => {
    it('only the platform admin sees all organisations', async () => {
      expect((await api('GET', '/api/platform/organisations', { token: ownerA })).status).toBe(403);
      const r = await api('GET', '/api/platform/organisations', { token: admin });
      expect(r.body.organisations.map((o) => o.name).sort()).toEqual(['Alpha Fuels', 'Beta Fuels', 'Gamma Fuels']);
      expect(r.body.organisations.find((o) => o.name === 'Alpha Fuels')).toMatchObject({ stationCount: 5, owners: [{ email: 'a@test.com' }] });
    });

    it('a suspended organisation is locked out until it is reactivated', async () => {
      expect((await api('PUT', `/api/platform/organisations/${orgA.id}`, { token: ownerA, body: { status: 'suspended' } })).status).toBe(403);
      expect((await api('PUT', `/api/platform/organisations/${orgA.id}`, { token: admin, body: { status: 'suspended' } })).status).toBe(200);
      expect((await api('GET', `/api/stations/${stA1.id}/meta`, { token: ownerA })).status).toBe(403);
      expect((await api('GET', `/api/stations/${stA1.id}/meta`, { token: staff })).status).toBe(403);
      expect((await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerA, body: { name: 'x' } })).status).toBe(403);
      expect((await api('GET', `/api/organisations/${orgA.id}`, { token: ownerA })).status).toBe(200); // can still look
      expect((await api('PUT', `/api/platform/organisations/${orgA.id}`, { token: admin, body: { status: 'active' } })).status).toBe(200);
      expect((await api('GET', `/api/stations/${stA1.id}/meta`, { token: ownerA })).status).toBe(200);
    });
  });

  describe('deleting a station', () => {
    it('needs the name typed in, removes all its data, and frees the slot', async () => {
      const del = (body) => api('DELETE', `/api/organisations/${orgA.id}/stations/${stA2.id}`, { token: ownerA, body });
      expect((await del({})).status).toBe(400);
      expect((await del({ confirmName: 'wrong' })).status).toBe(400);
      expect((await api('GET', `/api/stations/${stA2.id}/days?month=2026-10`, { token: ownerA })).body.days).toHaveLength(1);
      expect((await del({ confirmName: 'Ikeja Main' })).status).toBe(200);
      expect((await api('GET', `/api/stations/${stA2.id}/meta`, { token: ownerA })).status).toBe(404);
      expect((await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerA, body: { name: 'Replacement' } })).status).toBe(201);
      expect((await api('POST', `/api/organisations/${orgA.id}/stations`, { token: ownerA, body: { name: 'One too many' } })).status).toBe(409);
    });
  });
});

describe.each(storeKinds)('rate limiting (%s store)', (kind) => {
  it('blocks repeated failed logins, counted per client address in the store', async () => {
    const { store, close } = await makeStore(kind);
    await store.createUser({ name: 'A', email: 'a@test.com', passwordHash: await bcrypt.hash('password123', 4) });
    const app = createApp(store, { jwtSecret: 'x'.repeat(20), flutterwave: createFakeFlutterwave(), loginLimit: 3 });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const attempt = async (password, ip) =>
      (await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email: 'a@test.com', password }),
      })).status;

    expect([await attempt('bad', '203.0.113.9'), await attempt('bad', '203.0.113.9'), await attempt('bad', '203.0.113.9')]).toEqual([401, 401, 401]);
    expect(await attempt('bad', '203.0.113.9')).toBe(429);
    expect(await attempt('password123', '203.0.113.9')).toBe(429); // even the right password waits out the window
    expect(await attempt('password123', '198.51.100.7')).toBe(200); // a different address is unaffected
    expect(await attempt('bad', '198.51.100.7')).toBe(401);
    expect(await attempt('password123', '198.51.100.7')).toBe(200); // a good login resets that address's count
    server.close();
    await close();
  });
});
