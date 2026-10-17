import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError, wrap, cleanName } from '../http.js';
import { MAX_STATIONS_PER_ORG } from '../limits.js';

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, isPlatformAdmin: u.isPlatformAdmin });

export function authRoutes({ store, jwtSecret, auth, pricing, flutterwave, loginLimit = 10 }) {
  const r = express.Router();
  // Counted in the database, so the limit holds even when requests land on different serverless instances.
  const limit = async (key, max, windowMs) => {
    if (!(await store.hitRateLimit(key, max, windowMs))) throw new HttpError(429, 'Too many attempts, try again later');
  };
  const sign = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '12h' });

  r.post(
    '/auth/register',
    wrap(async (req, res) => {
      await limit(`register:${req.ip}`, 10, 60 * 60 * 1000);
      const name = cleanName(req.body.name, 'Name');
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const password = String(req.body.password ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
      if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      if (await store.findUserByEmail(email)) throw new HttpError(409, 'That email already has an account. Try signing in.');
      const user = await store.createUser({ name, email, passwordHash: await bcrypt.hash(password, 10) });
      res.status(201).json({ token: sign(user), user: publicUser(user) });
    })
  );

  r.post(
    '/auth/login',
    wrap(async (req, res) => {
      await limit(`login:${req.ip}`, loginLimit, 15 * 60 * 1000);
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const user = email ? await store.findUserByEmail(email) : null;
      const ok = user && (await bcrypt.compare(String(req.body.password ?? ''), user.passwordHash));
      if (!ok) throw new HttpError(401, 'Wrong email or password');
      await store.clearRateLimit(`login:${req.ip}`);
      res.json({ token: sign(user), user: publicUser(user) });
    })
  );

  // Everything the app needs right after sign-in: who you are, what you can open, what an organisation costs.
  r.get(
    '/me',
    auth,
    wrap(async (req, res) => {
      const user = req.user;
      const orgs = await store.listOrganisationsForUser(user.id);
      const stations = new Map();
      for (const o of orgs) {
        for (const s of await store.listStations(o.id)) {
          stations.set(s.id, { id: s.id, name: s.name, address: s.address, organisationId: o.id, organisationName: o.name, role: 'owner' });
        }
      }
      for (const row of await store.listStationRolesForUser(user.id)) {
        if (stations.has(row.stationId)) continue;
        const s = await store.getStation(row.stationId);
        const o = s && (await store.getOrganisation(s.organisationId));
        if (s && o && o.status === 'active') {
          stations.set(s.id, { id: s.id, name: s.name, address: s.address, organisationId: o.id, organisationName: o.name, role: row.role });
        }
      }
      res.json({
        user: publicUser(user),
        organisations: orgs.map((o) => ({ id: o.id, name: o.name, status: o.status, stationCount: o.stationCount })),
        stations: [...stations.values()],
        limits: { maxStations: MAX_STATIONS_PER_ORG },
        pricing: { ...pricing, paymentsEnabled: flutterwave.enabled },
      });
    })
  );

  return r;
}
