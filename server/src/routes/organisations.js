// The owner's dashboard: stations (max 5), staff, and what each person may do where.
import express from 'express';
import bcrypt from 'bcryptjs';
import { HttpError, wrap, cleanName } from '../http.js';
import { MAX_STATIONS_PER_ORG, STATION_ROLES } from '../limits.js';
import { createOrgContext } from '../middleware.js';
import { subscriptionView } from './billing.js';

export function organisationRoutes({ store, auth, pricing }) {
  const r = express.Router({ mergeParams: true });
  const readCtx = createOrgContext(store, { allowSuspended: true });
  const writeCtx = createOrgContext(store);

  async function members(orgId) {
    const ownerIds = await store.listOrgOwnerIds(orgId);
    const roles = await store.listStationRolesForOrg(orgId);
    const ids = [...new Set([...ownerIds, ...roles.map((x) => x.userId)])];
    const users = await store.listUsersByIds(ids);
    return users
      .map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        isOwner: ownerIds.includes(u.id),
        stations: roles.filter((x) => x.userId === u.id).map((x) => ({ stationId: x.stationId, role: x.role })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const stationView = (s) => ({ id: s.id, name: s.name, address: s.address });

  async function memberView(orgId, userId) {
    return (await members(orgId)).find((m) => m.userId === userId) ?? null;
  }

  async function validAssignments(orgId, raw) {
    const ids = new Set((await store.listStations(orgId)).map((s) => s.id));
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    for (const a of list) {
      if (!ids.has(a?.stationId)) throw new HttpError(400, 'One of the stations does not belong to this organisation');
      if (!STATION_ROLES.includes(a.role)) throw new HttpError(400, `Role must be one of: ${STATION_ROLES.join(', ')}`);
      if (seen.has(a.stationId)) throw new HttpError(400, 'A person can have only one role per station');
      seen.add(a.stationId);
    }
    return { list, ids };
  }

  async function requireMember(orgId, userId) {
    const m = await memberView(orgId, userId);
    if (!m) throw new HttpError(404, 'That person is not part of this organisation');
    return m;
  }

  async function ensureAnotherOwner(orgId, userId) {
    const owners = await store.listOrgOwnerIds(orgId);
    if (!owners.some((id) => id !== userId)) throw new HttpError(400, 'An organisation needs at least one owner');
  }

  r.get(
    '/',
    auth,
    readCtx,
    wrap(async (req, res) => {
      const stations = await store.listStations(req.org.id);
      res.json({
        organisation: { id: req.org.id, name: req.org.name, status: req.org.status },
        subscription: subscriptionView(req.org, pricing),
        stations: stations.map(stationView),
        members: await members(req.org.id),
        limits: { maxStations: MAX_STATIONS_PER_ORG },
      });
    })
  );

  r.put(
    '/',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const org = await store.updateOrganisation(req.org.id, { name: cleanName(req.body.name, 'Organisation name') });
      res.json({ organisation: { id: org.id, name: org.name, status: org.status } });
    })
  );

  // ---- stations
  r.post(
    '/stations',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const name = cleanName(req.body.name, 'Station name');
      const address = req.body.address ? cleanName(req.body.address, 'Address', { min: 1, max: 160 }) : null;
      const station = await store.createStation({ organisationId: req.org.id, name, address, max: MAX_STATIONS_PER_ORG });
      if (!station) {
        throw new HttpError(409, `You have reached the limit of ${MAX_STATIONS_PER_ORG} stations`, { code: 'STATION_LIMIT' });
      }
      res.status(201).json({ station: stationView(station) });
    })
  );

  async function ownStation(req) {
    const station = await store.getStation(req.params.stationId);
    if (!station || station.organisationId !== req.org.id) throw new HttpError(404, 'Station not found');
    return station;
  }

  r.put(
    '/stations/:stationId',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const station = await ownStation(req);
      const patch = {};
      if (req.body.name !== undefined) patch.name = cleanName(req.body.name, 'Station name');
      if (req.body.address !== undefined) patch.address = req.body.address ? cleanName(req.body.address, 'Address', { min: 1, max: 160 }) : null;
      res.json({ station: stationView(await store.updateStation(station.id, patch)) });
    })
  );

  // Deleting a station deletes ALL of its entries, so the owner must type its name.
  r.delete(
    '/stations/:stationId',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const station = await ownStation(req);
      if (String(req.body?.confirmName ?? '').trim() !== station.name) {
        throw new HttpError(400, 'Type the station name exactly to confirm. All its entries will be deleted.');
      }
      await store.deleteStation(station.id);
      res.json({ ok: true });
    })
  );

  // ---- staff
  r.post(
    '/members',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const email = String(req.body.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
      const isOwner = req.body.isOwner === true;
      const { list } = await validAssignments(req.org.id, req.body.assignments);
      if (!isOwner && list.length === 0) throw new HttpError(400, 'Choose at least one station, or make them an owner');

      let user = await store.findUserByEmail(email);
      if (!user) {
        const password = String(req.body.password ?? '');
        if (password.length < 8) throw new HttpError(400, 'Give them a password of at least 8 characters');
        user = await store.createUser({ name: cleanName(req.body.name, 'Name'), email, passwordHash: await bcrypt.hash(password, 10) });
      }
      for (const a of list) await store.setStationRole(user.id, a.stationId, a.role);
      if (isOwner) await store.addOrgOwner(req.org.id, user.id);
      res.status(201).json({ member: await memberView(req.org.id, user.id) });
    })
  );

  r.put(
    '/members/:userId',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const userId = Number(req.params.userId);
      const current = await requireMember(req.org.id, userId);
      const isOwner = req.body.isOwner === undefined ? current.isOwner : req.body.isOwner === true;
      const { list, ids } = await validAssignments(req.org.id, req.body.assignments ?? current.stations);
      if (!isOwner && list.length === 0) throw new HttpError(400, 'They need at least one station or the owner role. To remove them, use Remove.');
      if (current.isOwner && !isOwner) await ensureAnotherOwner(req.org.id, userId);

      const keep = new Set(list.map((a) => a.stationId));
      for (const s of current.stations) if (ids.has(s.stationId) && !keep.has(s.stationId)) await store.removeStationRole(userId, s.stationId);
      for (const a of list) await store.setStationRole(userId, a.stationId, a.role);
      if (isOwner && !current.isOwner) await store.addOrgOwner(req.org.id, userId);
      if (!isOwner && current.isOwner) await store.removeOrgOwner(req.org.id, userId);
      res.json({ member: await memberView(req.org.id, userId) });
    })
  );

  r.delete(
    '/members/:userId',
    auth,
    writeCtx,
    wrap(async (req, res) => {
      const userId = Number(req.params.userId);
      const current = await requireMember(req.org.id, userId);
      if (current.isOwner) await ensureAnotherOwner(req.org.id, userId);
      await store.removeUserFromOrg(req.org.id, userId);
      res.json({ ok: true });
    })
  );

  return r;
}
