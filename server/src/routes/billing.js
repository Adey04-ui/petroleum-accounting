// Paying for an organisation with Flutterwave, and keeping it paid. Nothing is created or extended until the
// payment has been VERIFIED with Flutterwave (amount, currency and reference all checked).
import crypto from 'node:crypto';
import express from 'express';
import { HttpError, wrap, cleanName } from '../http.js';
import { safeEqual } from '../flutterwave.js';
import { subscriptionState } from '../subscription.js';

export function billingRoutes({ store, auth, flutterwave, pricing, planId, webUrl, webhookHash }) {
  const r = express.Router();
  const { interval } = pricing;
  const autoRenewAvailable = Boolean(planId);

  /** Verifies with Flutterwave and, if genuinely paid, creates the organisation or extends it (once). */
  async function settle(txRef, transactionId) {
    const payment = await store.getPaymentByTxRef(txRef);
    if (!payment) throw new HttpError(404, 'Unknown payment reference');
    if (payment.status === 'successful') {
      if (payment.kind === 'renewal') return { status: 'successful', organisation: await store.getOrganisation(payment.organisationId) };
      const { organisation } = await store.fulfilPayment(txRef, payment.flwTransactionId, { interval }); // returns the existing one
      return { status: 'successful', organisation };
    }
    if (!transactionId) throw new HttpError(400, 'transaction_id is required');
    const v = await flutterwave.verify(transactionId);
    if (v.txRef !== payment.txRef) throw new HttpError(400, 'This transaction does not belong to this payment');
    if (v.status !== 'successful') return { status: v.status ?? 'failed' };
    if (v.currency !== payment.currency || Number(v.amount) < payment.amount) {
      console.error(`Payment ${txRef}: paid ${v.amount} ${v.currency}, expected ${payment.amount} ${payment.currency}`);
      throw new HttpError(400, 'The amount paid does not match the price');
    }
    if (payment.kind === 'renewal') {
      const { organisation } = await store.applyRenewal(txRef, String(v.id), { interval });
      return { status: 'successful', organisation };
    }
    const { organisation } = await store.fulfilPayment(txRef, String(v.id), { interval });
    return { status: 'successful', organisation };
  }

  /** A charge Flutterwave made by itself on the recurring plan: verify it, then extend whichever organisation it belongs to. */
  async function settleAutoRenewal(transactionId) {
    const v = await flutterwave.verify(transactionId);
    if (v.status !== 'successful') return;
    if (v.currency !== pricing.currency || Number(v.amount) < pricing.amount) {
      console.error(`Renewal charge ${transactionId}: ${v.amount} ${v.currency} is not the price (${pricing.amount} ${pricing.currency}); ignored`);
      return;
    }
    const out = await store.recordAutoRenewal({ flwTransactionId: v.id, email: v.email, amount: Math.round(v.amount), currency: v.currency, interval });
    if (!out.duplicate && !out.matched) console.error(`Renewal charge ${transactionId} from ${v.email} matches no organisation; it is waiting for the platform admin`);
  }

  const view = (o) => ({ id: o.id, name: o.name });

  async function startPayment(req, { kind, organisationName, organisationId, wantPlan }) {
    if (!flutterwave.enabled) throw new HttpError(503, 'Payments are not set up yet');
    let withPlan = false;
    if (wantPlan) {
      if (!autoRenewAvailable) throw new HttpError(503, 'Automatic renewal is not set up yet');
      // A Flutterwave subscription belongs to an email address, so one email can only renew one organisation automatically.
      if (await store.findOrganisationByAutoRenewEmail(req.user.email)) {
        throw new HttpError(409, 'This email already has an organisation that renews automatically. Pay for this one without automatic renewal, or use another email.', { code: 'AUTO_RENEW_TAKEN' });
      }
      withPlan = true;
    }
    const txRef = `fuel_${crypto.randomUUID()}`;
    await store.createPayment({ txRef, userId: req.user.id, organisationName, amount: pricing.amount, currency: pricing.currency, kind, organisationId, withPlan });
    try {
      const { link } = await flutterwave.initiate({
        txRef,
        amount: pricing.amount,
        currency: pricing.currency,
        redirectUrl: `${webUrl}/?payment=return`,
        customer: { email: req.user.email, name: req.user.name },
        title: kind === 'renewal' ? 'Renew subscription' : 'New organisation',
        description: organisationName,
        meta: { userId: req.user.id, kind },
        paymentPlan: withPlan ? planId : undefined,
      });
      return { link, txRef };
    } catch (e) {
      console.error(e);
      await store.markPaymentFailed(txRef);
      throw new HttpError(502, 'Could not start the payment. Please try again.');
    }
  }

  // 1a. The owner-to-be chooses a name; we return Flutterwave's payment page.
  r.post(
    '/checkout',
    auth,
    wrap(async (req, res) => {
      const organisationName = cleanName(req.body.organisationName, 'Organisation name');
      const wantPlan = req.body.autoRenew === undefined ? autoRenewAvailable : req.body.autoRenew === true;
      res.json(await startPayment(req, { kind: 'signup', organisationName, wantPlan }));
    })
  );

  // 1b. An owner pays for another period (card, transfer or USSD), or re-starts automatic renewal.
  r.post(
    '/renew',
    auth,
    wrap(async (req, res) => {
      const org = await store.getOrganisation(String(req.body.organisationId ?? ''));
      if (!org || !(await store.isOrgOwner(req.user.id, org.id))) throw new HttpError(404, 'Organisation not found');
      if (org.status !== 'active') throw new HttpError(403, 'This organisation is suspended. Please contact support.');
      if (org.autoRenewEmail) throw new HttpError(409, 'Automatic renewal is on, so the next payment is taken for you. Nothing to pay now.', { code: 'AUTO_RENEW_ON' });
      res.json(await startPayment(req, { kind: 'renewal', organisationName: org.name, organisationId: org.id, wantPlan: req.body.autoRenew === true }));
    })
  );

  // 2. Flutterwave sends the customer back; the web app calls this with the tx_ref and transaction_id it was given.
  r.get(
    '/verify',
    auth,
    wrap(async (req, res) => {
      const txRef = String(req.query.tx_ref ?? '');
      const payment = txRef ? await store.getPaymentByTxRef(txRef) : null;
      if (!payment || payment.userId !== req.user.id) throw new HttpError(404, 'Unknown payment reference');
      if (req.query.status === 'cancelled') return res.json({ status: 'cancelled', kind: payment.kind });
      const result = await settle(txRef, req.query.transaction_id ? String(req.query.transaction_id) : undefined);
      res.json({ status: result.status, kind: payment.kind, ...(result.organisation ? { organisation: view(result.organisation) } : {}) });
    })
  );

  // 3. Flutterwave's own notifications: our checkouts (in case the customer closed the page), the automatic
  //    renewal charges, and a subscription being cancelled.
  r.post(
    '/webhook',
    wrap(async (req, res) => {
      if (!webhookHash || !safeEqual(req.get('verif-hash'), webhookHash)) throw new HttpError(401, 'Invalid signature');
      const { event, data } = req.body ?? {};
      try {
        if (event === 'charge.completed' && data?.id && data?.status === 'successful') {
          const known = data.tx_ref ? await store.getPaymentByTxRef(String(data.tx_ref)) : null;
          const ours = known && !(known.status === 'successful' && String(known.flwTransactionId) !== String(data.id));
          if (ours) await settle(known.txRef, String(data.id));
          else await settleAutoRenewal(String(data.id)); // a later charge on the plan (even if it reuses our reference)
        } else if (event === 'subscription.cancelled' && data?.customer?.email) {
          const org = await store.findOrganisationByAutoRenewEmail(data.customer.email);
          if (org) await store.setAutoRenewEmail(org.id, null);
        }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e; // unexpected: let Flutterwave retry
        console.error(`Webhook not accepted: ${e.message}`);
      }
      res.json({ ok: true });
    })
  );

  return r;
}

/** What the app shows about an organisation's subscription. */
export function subscriptionView(org, pricing, now = new Date()) {
  const daysLeft = org.paidUntil ? Math.ceil((new Date(org.paidUntil).getTime() - now.getTime()) / 86400000) : null;
  return {
    state: subscriptionState(org, now),
    paidUntil: org.paidUntil ? new Date(org.paidUntil).toISOString() : null,
    daysLeft,
    autoRenew: Boolean(org.autoRenewEmail),
    interval: pricing.interval,
    amount: pricing.amount,
    currency: pricing.currency,
  };
}
