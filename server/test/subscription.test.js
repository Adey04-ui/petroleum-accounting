import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/createApp.js';
import { createFakeFlutterwave } from '../src/fakeFlutterwave.js';
import { storeKinds, makeStore } from './helpers.js';

const PRICE = { amount: 120000, currency: 'NGN', interval: 'yearly' };
const DAY = 24 * 3600 * 1000;

describe.each(storeKinds)('subscriptions, tanks and owner-only editing (%s store)', (kind) => {
  let server, base, store, close, flw;
  let admin, kemi, org1, org2, st, manager, attendant, signupRef;

  async function api(method, path, { token, body, headers } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: 'password123' } })).body.token;
  const me = async (token) => (await api('GET', '/api/me', { token })).body;
  const sub = async (token, orgId) => (await me(token)).organisations.find((o) => o.id === orgId).subscription;
  const daysFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / DAY;

  async function pay(token, path, body) {
    const c = await api('POST', path, { token, body });
    if (c.status !== 200) return { checkout: c };
    const q = new URL(c.body.link).searchParams;
    const v = await api('GET', `/api/billing/verify?tx_ref=${q.get('tx_ref')}&transaction_id=${q.get('transaction_id')}`, { token });
    return { checkout: c, verify: v, txRef: q.get('tx_ref') };
  }
  const webhook = (event, hash = 'whsec') => api('POST', '/api/billing/webhook', { body: event, headers: { 'verif-hash': hash } });

  beforeAll(async () => {
    ({ store, close } = await makeStore(kind));
    flw = createFakeFlutterwave();
    const app = createApp(store, { jwtSecret: 'test-secret-test-secret', flutterwave: flw, webhookHash: 'whsec', pricing: PRICE, planId: 'PLAN1', webUrl: 'http://app.test', loginLimit: 100 });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    await store.createUser({ name: 'Admin', email: 'admin@test.com', passwordHash: await bcrypt.hash('password123', 4), isPlatformAdmin: true });
    admin = await login('admin@test.com');
    kemi = (await api('POST', '/api/auth/register', { body: { name: 'Kemi', email: 'kemi@test.com', password: 'password123' } })).body.token;
  });
  afterAll(async () => {
    server.close();
    await close();
  });

  describe('paying with automatic renewal', () => {
    it('is offered, and a signup pays through the recurring plan', async () => {
      expect((await me(kemi)).pricing).toMatchObject({ amount: 120000, currency: 'NGN', interval: 'yearly', autoRenewAvailable: true });
      const r = await pay(kemi, '/api/billing/checkout', { organisationName: 'Alpha Energy' });
      expect(flw.calls.at(-1)).toMatchObject({ amount: 120000, paymentPlan: 'PLAN1' });
      expect(r.verify.body.status).toBe('successful');
      org1 = r.verify.body.organisation;
      signupRef = r.txRef;
      const s = await sub(kemi, org1.id);
      expect(s).toMatchObject({ state: 'active', autoRenew: true, interval: 'yearly', amount: 120000 });
      expect(daysFromNow(s.paidUntil)).toBeGreaterThan(363);
      expect(daysFromNow(s.paidUntil)).toBeLessThan(367);
    });

    it('allows only one automatically renewing organisation per email, but a second can be paid for once', async () => {
      const second = await api('POST', '/api/billing/checkout', { token: kemi, body: { organisationName: 'Beta Energy' } });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('AUTO_RENEW_TAKEN');
      const r = await pay(kemi, '/api/billing/checkout', { organisationName: 'Beta Energy', autoRenew: false });
      expect(flw.calls.at(-1).paymentPlan).toBeUndefined();
      org2 = r.verify.body.organisation;
      expect((await sub(kemi, org2.id)).autoRenew).toBe(false);
    });

    it('does not let you pay again while automatic renewal is on, or renew someone else\'s organisation', async () => {
      const again = await api('POST', '/api/billing/renew', { token: kemi, body: { organisationId: org1.id } });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('AUTO_RENEW_ON');
      const other = await api('POST', '/api/auth/register', { body: { name: 'Zed', email: 'zed@test.com', password: 'password123' } });
      expect((await api('POST', '/api/billing/renew', { token: other.body.token, body: { organisationId: org2.id } })).status).toBe(404);
    });
  });

  describe('charges Flutterwave makes by itself', () => {
    it('extends the right organisation, once, whatever the number of times the webhook is delivered', async () => {
      const before = (await sub(kemi, org1.id)).paidUntil;
      const evt = flw.addCharge({ id: 7001, email: 'Kemi@test.com', amount: 120000 });
      expect((await webhook(evt, 'wrong')).status).toBe(401);
      expect((await webhook(evt)).status).toBe(200);
      expect((await webhook(evt)).status).toBe(200);
      const after = (await sub(kemi, org1.id)).paidUntil;
      expect(daysFromNow(after) - daysFromNow(before)).toBeGreaterThan(363);
      expect(daysFromNow(after) - daysFromNow(before)).toBeLessThan(367);
    });

    it('still works when Flutterwave reuses the reference of the first payment', async () => {
      const before = (await sub(kemi, org1.id)).paidUntil;
      await webhook(flw.addCharge({ id: 7002, txRef: signupRef, email: 'kemi@test.com', amount: 120000 }));
      expect(daysFromNow((await sub(kemi, org1.id)).paidUntil) - daysFromNow(before)).toBeGreaterThan(363);
    });

    it('ignores a charge for the wrong amount, or one that did not succeed', async () => {
      const before = (await sub(kemi, org1.id)).paidUntil;
      await webhook(flw.addCharge({ id: 7003, email: 'kemi@test.com', amount: 5000 }));
      await webhook(flw.addCharge({ id: 7004, email: 'kemi@test.com', amount: 120000, status: 'failed' }));
      expect((await sub(kemi, org1.id)).paidUntil).toBe(before);
    });

    it('keeps a charge from an unknown email for the platform admin to match', async () => {
      await webhook(flw.addCharge({ id: 7005, email: 'changed-address@test.com', amount: 120000 }));
      expect((await api('GET', '/api/platform/payments/unmatched', { token: kemi })).status).toBe(403);
      const list = (await api('GET', '/api/platform/payments/unmatched', { token: admin })).body.payments;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ email: 'changed-address@test.com', amount: 120000 });
      const before = (await sub(kemi, org1.id)).paidUntil;
      const done = await api('POST', `/api/platform/payments/${list[0].txRef}/assign`, { token: admin, body: { organisationId: org1.id } });
      expect(done.status).toBe(200);
      expect(daysFromNow(done.body.organisation.subscription.paidUntil) - daysFromNow(before)).toBeGreaterThan(363);
      expect((await api('POST', `/api/platform/payments/${list[0].txRef}/assign`, { token: admin, body: { organisationId: org1.id } })).status).toBe(404);
      expect((await api('GET', '/api/platform/payments/unmatched', { token: admin })).body.payments).toEqual([]);
    });

    it('turns automatic renewal off when the subscription is cancelled, after which the owner can pay by hand', async () => {
      expect((await webhook({ event: 'subscription.cancelled', data: { customer: { email: 'kemi@test.com' } } })).status).toBe(200);
      expect((await sub(kemi, org1.id)).autoRenew).toBe(false);
      const r = await pay(kemi, '/api/billing/renew', { organisationId: org1.id });
      expect(r.verify.body).toMatchObject({ status: 'successful', kind: 'renewal' });
    });
  });

  describe('when the subscription runs out', () => {
    let owner2; // owns org2, which has a station
    const S = (path) => `/api/stations/${st.id}${path}`;
    const setPaidUntil = (days) => api('PUT', `/api/platform/organisations/${org2.id}/paid-until`, { token: admin, body: { paidUntil: new Date(Date.now() + days * DAY).toISOString() } });

    it('is set up with a station', async () => {
      owner2 = kemi;
      st = (await api('POST', `/api/organisations/${org2.id}/stations`, { token: owner2, body: { name: 'Ikeja' } })).body.station;
      expect((await api('PUT', S('/config'), { token: owner2, body: { pms: { pumps: ['1'], openingStock: 1000, openingCostPerLitre: 1000, toleranceRate: 0.04 } } })).status).toBe(200);
    });

    it('a few days late is a grace period: everything still works', async () => {
      await setPaidUntil(-3);
      expect((await sub(kemi, org2.id)).state).toBe('grace');
      expect((await api('PUT', S('/config'), { token: owner2, body: { pms: { pumps: ['1'], openingStock: 1000, openingCostPerLitre: 1000, toleranceRate: 0.04 } } })).status).toBe(200);
    });

    it('after the grace period it is read-only: view and download, but no changes', async () => {
      await setPaidUntil(-10);
      expect((await sub(kemi, org2.id)).state).toBe('expired');
      const blocked = [
        api('PUT', S('/config'), { token: owner2, body: { pms: { pumps: ['1'], openingStock: 1000, openingCostPerLitre: 1000 } } }),
        api('PUT', S('/days/2026-11-01'), { token: owner2, body: { pms: { pumps: [{ id: '1', opening: 0, closing: 10 }], closingStock: 990, sellingPrice: 1100 } } }),
        api('POST', `/api/organisations/${org2.id}/stations`, { token: owner2, body: { name: 'Another' } }),
        api('POST', `/api/organisations/${org2.id}/members`, { token: owner2, body: { email: 'x@test.com', isOwner: true } }),
      ];
      for (const r of await Promise.all(blocked)) {
        expect(r.status).toBe(402);
        expect(r.body.code).toBe('SUBSCRIPTION_EXPIRED');
      }
      expect((await api('GET', S('/meta'), { token: owner2 })).body.subscription.state).toBe('expired');
      expect((await api('GET', S('/days?month=2026-11'), { token: owner2 })).status).toBe(200);
      expect((await api('GET', `/api/organisations/${org2.id}`, { token: owner2 })).body.subscription.state).toBe('expired');
    });

    it('paying brings it back, counting from today (not from the old date)', async () => {
      const r = await pay(owner2, '/api/billing/renew', { organisationId: org2.id });
      expect(r.verify.body.status).toBe('successful');
      const s = await sub(kemi, org2.id);
      expect(s.state).toBe('active');
      expect(daysFromNow(s.paidUntil)).toBeGreaterThan(363);
      expect(daysFromNow(s.paidUntil)).toBeLessThan(367);
      expect((await api('POST', `/api/organisations/${org2.id}/stations`, { token: owner2, body: { name: 'Ijebu' } })).status).toBe(201);
    });

    it('paying early adds a period on top of what is left, so nothing is lost', async () => {
      await setPaidUntil(30);
      await pay(owner2, '/api/billing/renew', { organisationId: org2.id });
      expect(daysFromNow((await sub(kemi, org2.id)).paidUntil)).toBeGreaterThan(30 + 363);
    });

    it('the platform admin can set a date by hand, or remove the expiry', async () => {
      expect((await api('PUT', `/api/platform/organisations/${org2.id}/paid-until`, { token: kemi, body: { paidUntil: null } })).status).toBe(403);
      expect((await api('PUT', `/api/platform/organisations/${org2.id}/paid-until`, { token: admin, body: { paidUntil: 'not a date' } })).status).toBe(400);
      await api('PUT', `/api/platform/organisations/${org2.id}/paid-until`, { token: admin, body: { paidUntil: null } });
      expect(await sub(kemi, org2.id)).toMatchObject({ state: 'active', paidUntil: null, daysLeft: null });
    });
  });

  describe('the daily report: tanks, per-pump RTT, named payments, owner-only editing', () => {
    const S = (path) => `/api/stations/${st.id}${path}`;
    const config = {
      carryBalance: false,
      paymentChannels: ['Moniepoint POS', 'Zenith POS'],
      pms: { pumps: ['1', '2', '3'], openingCostPerLitre: 1200, toleranceRate: 0.04, tanks: [{ id: 't1', name: 'PMS Tank 1', openingStock: 470 }] },
      ago: { pumps: ['1'], toleranceRate: 0.085, tanks: [{ id: 't1', name: 'AGO Tank 1', openingStock: 0 }] },
    };
    const sept1 = {
      pms: {
        pumps: [{ id: '1', opening: 4352.97, closing: 4409.14, rtt: 34.01 }, { id: '2', idle: true }, { id: '3', opening: 42246.74, closing: 42403.28, rtt: 12.16 }],
        deliveries: [{ litres: 5530, tankId: 't1' }],
        tankClosings: { t1: 5780 },
        sellingPrice: 1310,
      },
      ago: { pumps: [{ id: '1', opening: 3717.55, closing: 3717.55 }], tankClosings: { t1: 0 }, sellingPrice: 1880 },
      payments: [{ label: 'Moniepoint POS', amount: 166800 }],
      expenses: [{ label: 'Data to POS', amount: 2000 }],
    };

    it('is set up with tanks and a manager and an attendant', async () => {
      st = (await api('POST', `/api/organisations/${org1.id}/stations`, { token: kemi, body: { name: 'IJU Station' } })).body.station;
      expect((await api('PUT', S('/config'), { token: kemi, body: config })).status).toBe(200);
      for (const [name, role] of [['Mary Manager', 'manager'], ['Ade Attendant', 'attendant']]) {
        await api('POST', `/api/organisations/${org1.id}/members`, { token: kemi, body: { name, email: `${role}@test.com`, password: 'password123', assignments: [{ stationId: st.id, role }] } });
      }
      manager = await login('manager@test.com');
      attendant = await login('attendant@test.com');
      const meta = (await api('GET', S('/meta'), { token: attendant })).body;
      expect(meta.products.pms).toMatchObject({ pumps: ['1', '2', '3'], tanks: [{ id: 't1', name: 'PMS Tank 1' }], toleranceRate: 0.04, openingStock: 470 });
      expect(meta.paymentChannels).toEqual(['Moniepoint POS', 'Zenith POS']);
    });

    it('works out the station\'s own report to the naira', async () => {
      const r = await api('PUT', S('/days/2026-09-01'), { token: manager, body: sept1 });
      expect(r.status).toBe(200);
      expect(r.body.version).toBe(1);
      const { pms, banking } = r.body.day;
      expect(pms.pumpSales).toBeCloseTo(166.54, 2);
      expect(pms.revenue).toBeCloseTo(218167.4, 2);
      expect(pms.tankSales).toBeCloseTo(220, 6);
      expect(pms.actualTolerance).toBeCloseTo(-53.46, 2);
      expect(pms.tanks[0]).toMatchObject({ name: 'PMS Tank 1', opening: 470, received: 5530, closing: 5780 });
      expect(banking.availableBalance).toBeCloseTo(49367.4, 2);
      expect(pms.profit).toBeUndefined(); // staff never see profit
    });

    it('offers the next day the closing dips and meters of the day before', async () => {
      const ctx = (await api('GET', S('/days/2026-09-02'), { token: attendant })).body;
      expect(ctx.previous.pms.tankClose).toEqual({ t1: 5780 });
      expect(ctx.previous.pms.pumpClose).toEqual({ '1': 4409.14, '2': null, '3': 42403.28 });
      expect(ctx.previous.pms.sellingPrice).toBe(1310);
      expect(ctx.version).toBe(0);
    });

    it('lets staff add a day, but not change it afterwards', async () => {
      const sept2 = {
        pms: { pumps: [{ id: '1', closing: 4459.14 }, { id: '2', idle: true }, { id: '3', closing: 42403.28 }], tankClosings: { t1: 5730 }, sellingPrice: 1310, toleranceRate: 0.9 },
        ago: { pumps: [{ id: '1', closing: 3717.55 }], tankClosings: { t1: 0 }, sellingPrice: 1880 },
      };
      const first = await api('PUT', S('/days/2026-09-02'), { token: attendant, body: sept2 });
      expect(first.status).toBe(200);
      expect(first.body.day.pms.pumpSales).toBeCloseTo(50, 2);
      const again = await api('PUT', S('/days/2026-09-02'), { token: attendant, body: sept2 });
      expect(again.status).toBe(403);
      expect(again.body.code).toBe('OWNER_ONLY_EDIT');
      expect((await api('PUT', S('/days/2026-09-01'), { token: manager, body: sept1 })).status).toBe(403);
      // the tolerance an attendant tried to slip in was ignored
      expect((await api('GET', S('/days/2026-09-02'), { token: kemi })).body.entry.pms.toleranceRate).toBeUndefined();
    });

    it('lets the owner correct one day\'s tolerance (0.8 L per 20 L to 1.5 L per 20 L) without touching anything else', async () => {
      const day = (await api('GET', S('/days/2026-09-01'), { token: kemi })).body;
      expect(day.result.pms.expectedTolerance).toBeCloseTo(0.04 * 220, 6);
      const edited = { ...day.entry, pms: { ...day.entry.pms, toleranceRate: 1.5 / 20 }, baseVersion: day.version };
      const r = await api('PUT', S('/days/2026-09-01'), { token: kemi, body: edited });
      expect(r.status).toBe(200);
      expect(r.body.version).toBe(2);
      expect(r.body.day.pms.expectedTolerance).toBeCloseTo(0.075 * 220, 6);
      expect(r.body.day.pms.revenue).toBeCloseTo(218167.4, 2);
      expect(r.body.day.pms.tankSales).toBeCloseTo(220, 6);
      // and the next day keeps the station's normal allowance
      expect((await api('GET', S('/days?month=2026-09'), { token: kemi })).body.days[1].pms.toleranceRate).toBeCloseTo(0.04, 6);
    });

    it('refuses an edit made from an out-of-date copy, and shows what is there now', async () => {
      const day = (await api('GET', S('/days/2026-09-01'), { token: kemi })).body;
      const stale = await api('PUT', S('/days/2026-09-01'), { token: kemi, body: { ...day.entry, baseVersion: 1 } });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: 'CONFLICT', version: 2 });
      expect(stale.body.entry.pms.toleranceRate).toBeCloseTo(0.075, 6);
      expect((await api('PUT', S('/days/2026-09-01'), { token: kemi, body: { ...day.entry, baseVersion: day.version } })).body.version).toBe(3);
      const make = (n) => api('PUT', S('/days/2026-09-03'), { token: kemi, body: { pms: { pumps: [{ id: '1', closing: 4459.14 }, { id: '2', idle: true }, { id: '3', closing: 42403.28 }], tankClosings: { t1: 5730 }, sellingPrice: 1310 + n }, baseVersion: 0 } });
      expect((await make(0)).status).toBe(200); // a new day: "must not exist yet" holds
      expect((await make(1)).status).toBe(409); // the same again: it exists now
    });

    it('rejects things that do not add up', async () => {
      const bad = (mutate) => {
        const d = JSON.parse(JSON.stringify({ pms: { pumps: [{ id: '1', closing: 4600 }, { id: '2', idle: true }, { id: '3', closing: 42403.28 }], tankClosings: { t1: 5000 }, sellingPrice: 1310 } }));
        mutate(d);
        return api('PUT', S('/days/2026-09-10'), { token: kemi, body: d });
      };
      const rtt = await bad((d) => { d.pms.pumps[0].rtt = 500; });
      expect(JSON.stringify(rtt.body.errors)).toMatch(/more than the meter sales/);
      const forgot = await bad((d) => { delete d.pms.pumps[0].closing; });
      expect(JSON.stringify(forgot.body.errors)).toMatch(/Closing meter is missing/);
      const tank = await bad((d) => { d.pms.tankClosings = { nope: 5 }; });
      expect(tank.status).toBe(422);
    });

    it('changing the setup keeps old days valid: renaming a tank is fine, removing one that is used is refused', async () => {
      const renamed = JSON.parse(JSON.stringify(config));
      renamed.pms.tanks[0].name = 'Main PMS tank';
      renamed.paymentChannels = ['Moniepoint POS', 'Zenith POS', 'Transfer'];
      expect((await api('PUT', S('/config'), { token: kemi, body: renamed })).status).toBe(200);
      expect((await api('GET', S('/days?month=2026-09'), { token: kemi })).body.days[0].pms.tanks[0].name).toBe('Main PMS tank');
      const dup = JSON.parse(JSON.stringify(config));
      dup.pms.tanks = [{ id: 't1', name: 'Same', openingStock: 470 }, { id: 't2', name: 'same', openingStock: 0 }];
      expect((await api('PUT', S('/config'), { token: kemi, body: dup })).status).toBe(400);
      const removed = JSON.parse(JSON.stringify(config));
      removed.pms.tanks = [{ id: 't9', name: 'Different tank', openingStock: 470 }];
      expect((await api('PUT', S('/config'), { token: kemi, body: removed })).status).toBe(422);
    });

    it('still opens setups and days saved before tanks, per-pump RTT and named payments existed', async () => {
      const legacyStation = (await api('POST', `/api/organisations/${org1.id}/stations`, { token: kemi, body: { name: 'Old station' } })).body.station;
      const L = (path) => `/api/stations/${legacyStation.id}${path}`;
      // exactly what the previous version stored
      await store.setSetting(legacyStation.id, 'config', { costingMethod: 'WAC', pms: { pumps: ['1A', '2A'], openingStock: 5100, openingCostPerLitre: 1351, toleranceRate: 0.04 } });
      await store.saveDay(legacyStation.id, '2026-10-01', {
        pms: { pumps: [{ id: '1A', opening: 10426.25, closing: 10747.21 }, { id: '2A', opening: 44686.34, closing: 44686.34 }], rtt: 0, deliveries: [], closingStock: 4780, sellingPrice: 1390, replacementCost: null },
        expenses: 0,
        pos: 543200,
        transfer: 0,
      }, null);

      const meta = (await api('GET', L('/meta'), { token: kemi })).body;
      expect(meta.products.pms).toMatchObject({ tanks: [{ id: 't1', name: 'Tank 1' }], openingStock: 5100, toleranceRate: 0.04 });
      const month = (await api('GET', L('/days?month=2026-10'), { token: kemi })).body;
      expect(month.days[0].pms.profit).toBeCloseTo(320.96 * 1390 - 320 * 1351, 2); // 13,814.40, as on the sheet
      expect(month.days[0].banking.cashToLodge).toBeCloseTo(-97065.6, 2);
      const ctx = (await api('GET', L('/days/2026-10-02'), { token: kemi })).body;
      expect(ctx.previous.pms.tankClose).toEqual({ t1: 4780 });
      expect(ctx.previous.pms.pumpClose).toEqual({ '1A': 10747.21, '2A': 44686.34 });
      // and the next day can be entered in the new format on top of it
      const next = await api('PUT', L('/days/2026-10-02'), { token: kemi, body: { pms: { pumps: [{ id: '1A', closing: 10800 }, { id: '2A', idle: true }], tankClosings: { t1: 4730 }, sellingPrice: 1390 }, payments: [{ label: 'POS', amount: 1000 }] } });
      expect(next.status).toBe(200);
      expect(next.body.day.pms.pumpSales).toBeCloseTo(52.79, 2);
    });

    it('carries the cash balance forward only when the owner turns that on', async () => {
      const off = (await api('GET', S('/days?month=2026-09'), { token: kemi })).body.days;
      expect(off[1].banking.previousBalance).toBe(0);
      const on = JSON.parse(JSON.stringify(config));
      on.carryBalance = true;
      await api('PUT', S('/config'), { token: kemi, body: on });
      const days = (await api('GET', S('/days?month=2026-09'), { token: kemi })).body.days;
      expect(days[1].banking.previousBalance).toBeCloseTo(days[0].banking.availableBalance, 6);
      expect((await api('GET', S('/days/2026-09-04'), { token: attendant })).body.previous.balance).toBeCloseTo(days[2].banking.availableBalance, 6);
    });
  });
});
