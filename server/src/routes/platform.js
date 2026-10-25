// For the people running the platform (you): see every organisation and suspend or reactivate one.
import express from 'express';
import { HttpError, wrap } from '../http.js';
import { subscriptionView } from './billing.js';

export function platformRoutes({ store, auth, pricing }) {
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
          subscription: subscriptionView(o, pricing),
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

  // Set an organisation's paid-until date by hand (a gift, a bank transfer you received, fixing a missed payment).
  r.put(
    '/organisations/:orgId/paid-until',
    auth,
    adminOnly,
    wrap(async (req, res) => {
      const raw = req.body?.paidUntil;
      const date = raw === null ? null : new Date(String(raw));
      if (date !== null && Number.isNaN(date.getTime())) throw new HttpError(400, 'paidUntil must be a date, or null for no expiry');
      const org = await store.setPaidUntil(req.params.orgId, date);
      if (!org) throw new HttpError(404, 'Organisation not found');
      res.json({ organisation: { id: org.id, name: org.name, subscription: subscriptionView(org, pricing) } });
    })
  );

  // Automatic charges Flutterwave made that we could not tie to an organisation.
  r.get(
    '/payments/unmatched',
    auth,
    adminOnly,
    wrap(async (req, res) => {
      const list = await store.listUnmatchedPayments();
      res.json({ payments: list.map((p) => ({ txRef: p.txRef, email: p.organisationName, amount: p.amount, currency: p.currency, createdAt: p.createdAt })) });
    })
  );

  r.post(
    '/payments/:txRef/assign',
    auth,
    adminOnly,
    wrap(async (req, res) => {
      const org = await store.assignPayment(req.params.txRef, String(req.body?.organisationId ?? ''), { interval: pricing.interval });
      if (!org) throw new HttpError(404, 'That payment is not waiting to be matched, or the organisation does not exist');
      res.json({ organisation: { id: org.id, name: org.name, subscription: subscriptionView(org, pricing) } });
    })
  );

  return r;
}
