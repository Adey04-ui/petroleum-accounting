// For the people running the platform (you): see every organisation and suspend or reactivate one.
import express from 'express';
import { HttpError, wrap } from '../http.js';

export function platformRoutes({ store, auth }) {
  const r = express.Router();
  const adminOnly = (req, res, next) => (req.user.isPlatformAdmin ? next() : next(new HttpError(403, 'You are not allowed to do that')));

  r.get(
    '/organisations',
    auth,
    adminOnly,
    wrap(async (req, res) => {
      const list = await store.listAllOrganisations();
      res.json({
        organisations: list.map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status,
          stationCount: o.stationCount,
          owners: o.owners,
          createdAt: o.createdAt,
        })),
      });
    })
  );

  r.put(
    '/organisations/:orgId',
    auth,
    adminOnly,
    wrap(async (req, res) => {
      const status = req.body?.status;
      if (!['active', 'suspended'].includes(status)) throw new HttpError(400, "Status must be 'active' or 'suspended'");
      const org = await store.updateOrganisation(req.params.orgId, { status });
      if (!org) throw new HttpError(404, 'Organisation not found');
      res.json({ organisation: { id: org.id, name: org.name, status: org.status } });
    })
  );

  return r;
}
