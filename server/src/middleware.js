import jwt from 'jsonwebtoken';
import { HttpError, wrap } from './http.js';
import { can } from './permissions.js';

export function createAuth(store, jwtSecret) {
  return wrap(async (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const user = await store.findUserById(payload.sub);
    if (!user) throw new HttpError(401, 'Account no longer exists');
    req.user = user;
    next();
  });
}

/** Loads the station from the URL and works out what THIS user may do there. Never trusts the request body. */
export function createStationContext(store) {
  return wrap(async (req, res, next) => {
    const station = await store.getStation(req.params.stationId);
    // Same answer for "does not exist" and "not yours", so ids cannot be probed.
    if (!station) throw new HttpError(404, 'Station not found');
    const org = await store.getOrganisation(station.organisationId);
    const role = (await store.isOrgOwner(req.user.id, org.id)) ? 'owner' : await store.getStationRole(req.user.id, station.id);
    if (!role) throw new HttpError(404, 'Station not found');
    if (org.status !== 'active') throw new HttpError(403, 'This organisation is suspended. Please contact support.');
    req.station = station;
    req.org = org;
    req.role = role;
    next();
  });
}

/** Organisation routes: owners only. */
export function createOrgContext(store, { allowSuspended = false } = {}) {
  return wrap(async (req, res, next) => {
    const org = await store.getOrganisation(req.params.orgId);
    if (!org || !(await store.isOrgOwner(req.user.id, org.id))) throw new HttpError(404, 'Organisation not found');
    if (!allowSuspended && org.status !== 'active') throw new HttpError(403, 'This organisation is suspended. Please contact support.');
    req.org = org;
    next();
  });
}

export const needPermission = (permission) => (req, res, next) =>
  can(req.role, permission) ? next() : next(new HttpError(403, 'You are not allowed to do that'));
