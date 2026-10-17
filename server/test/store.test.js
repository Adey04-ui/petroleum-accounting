import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { storeKinds, makeStore } from './helpers.js';

describe.each(storeKinds)('store: %s', (kind) => {
  let store, close, owner, org, s1, s2;

  beforeAll(async () => {
    ({ store, close } = await makeStore(kind));
    owner = await store.createUser({ name: 'Owner', email: 'o@x.com', passwordHash: 'h' });
    await store.createPayment({ txRef: 'tx1', userId: owner.id, organisationName: 'Acme Fuels', amount: 10000, currency: 'NGN' });
  });
  afterAll(() => close());

  it('finds users by email and id', async () => {
    expect((await store.findUserByEmail('o@x.com')).id).toBe(owner.id);
    expect((await store.findUserById(owner.id)).email).toBe('o@x.com');
    expect(await store.findUserByEmail('nobody@x.com')).toBeNull();
  });

  it('creates the organisation exactly once, even when two requests race', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => store.fulfilPayment('tx1', 'flw-1')));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.organisation.id)).size).toBe(1);
    org = results[0].organisation;
    expect(org.name).toBe('Acme Fuels');
    expect((await store.getPaymentByTxRef('tx1')).status).toBe('successful');
    expect(await store.isOrgOwner(owner.id, org.id)).toBe(true);
    expect((await store.listOrganisationsForUser(owner.id))).toHaveLength(1);
    expect((await store.listAllOrganisations())[0].owners[0].email).toBe('o@x.com');
  });

  it('never lets an organisation exceed its station limit, even under parallel requests', async () => {
    const made = await Promise.all(
      Array.from({ length: 9 }, (_, i) => store.createStation({ organisationId: org.id, name: `Station ${i}`, max: 5 }))
    );
    expect(made.filter(Boolean)).toHaveLength(5);
    const list = await store.listStations(org.id);
    expect(list).toHaveLength(5);
    [s1, s2] = list;
    expect((await store.listOrganisationsForUser(owner.id))[0].stationCount).toBe(5);
  });

  it('keeps settings and days separate per station', async () => {
    await store.setSetting(s1.id, 'config', { a: 1 });
    await store.setSetting(s2.id, 'config', { a: 2 });
    await store.setSetting(s1.id, 'config', { a: 3 });
    expect(await store.getSetting(s1.id, 'config')).toEqual({ a: 3 });
    expect(await store.getSetting(s2.id, 'config')).toEqual({ a: 2 });
    expect(await store.getSetting(s1.id, 'missing')).toBeNull();

    await store.upsertDay(s1.id, '2026-10-02', { n: 2 }, owner.id);
    await store.upsertDay(s1.id, '2026-10-01', { n: 1 }, owner.id);
    await store.upsertDay(s2.id, '2026-10-01', { n: 99 }, owner.id);
    await store.upsertDay(s1.id, '2026-10-01', { n: 11 }, owner.id);
    expect((await store.listDays(s1.id)).map((d) => [d.date, d.data.n])).toEqual([['2026-10-01', 11], ['2026-10-02', 2]]);
    expect((await store.getDay(s2.id, '2026-10-01')).data.n).toBe(99);
    expect(await store.getDay(s2.id, '2026-10-02')).toBeNull();
    await store.deleteDay(s1.id, '2026-10-02');
    expect(await store.listDays(s1.id)).toHaveLength(1);
  });

  it('manages staff roles and removes someone from the whole organisation', async () => {
    const staff = await store.createUser({ name: 'Staff', email: 's@x.com', passwordHash: 'h' });
    await store.setStationRole(staff.id, s1.id, 'attendant');
    await store.setStationRole(staff.id, s2.id, 'manager');
    await store.setStationRole(staff.id, s1.id, 'manager');
    expect(await store.getStationRole(staff.id, s1.id)).toBe('manager');
    expect(await store.listStationRolesForUser(staff.id)).toHaveLength(2);
    expect((await store.listStationRolesForOrg(org.id)).filter((r) => r.userId === staff.id)).toHaveLength(2);
    await store.addOrgOwner(org.id, staff.id);
    expect((await store.listOrgOwnerIds(org.id)).sort()).toEqual([owner.id, staff.id].sort());
    await store.removeUserFromOrg(org.id, staff.id);
    expect(await store.getStationRole(staff.id, s1.id)).toBeNull();
    expect(await store.isOrgOwner(staff.id, org.id)).toBe(false);
    expect(await store.listOrgOwnerIds(org.id)).toEqual([owner.id]);
  });

  it('updates names and status; deleting a station removes its data', async () => {
    expect((await store.updateOrganisation(org.id, { name: 'Acme Energy', status: 'suspended' }))).toMatchObject({ name: 'Acme Energy', status: 'suspended' });
    expect(await store.updateOrganisation('nope', { name: 'x' })).toBeNull();
    expect((await store.updateStation(s2.id, { name: 'Renamed', address: 'Ikeja' }))).toMatchObject({ name: 'Renamed', address: 'Ikeja' });
    await store.deleteStation(s2.id);
    expect(await store.getStation(s2.id)).toBeNull();
    expect(await store.getSetting(s2.id, 'config')).toBeNull();
    expect(await store.listDays(s2.id)).toEqual([]);
    expect(await store.getStation(s1.id)).not.toBeNull();
    expect((await store.createStation({ organisationId: org.id, name: 'Again', max: 5 }))).not.toBeNull(); // a slot is free again
  });

  it('marks only pending payments as failed', async () => {
    await store.createPayment({ txRef: 'tx2', userId: owner.id, organisationName: 'Other', amount: 1, currency: 'NGN' });
    await store.markPaymentFailed('tx2');
    expect((await store.getPaymentByTxRef('tx2')).status).toBe('failed');
    await store.markPaymentFailed('tx1');
    expect((await store.getPaymentByTxRef('tx1')).status).toBe('successful');
  });
});
