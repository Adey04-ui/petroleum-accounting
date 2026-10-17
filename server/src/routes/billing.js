// Paying for an organisation with Flutterwave. The organisation is created ONLY after the payment has been
// verified with Flutterwave (amount, currency and reference all checked).
import crypto from 'node:crypto';
import express from 'express';
import { HttpError, wrap, cleanName } from '../http.js';
import { safeEqual } from '../flutterwave.js';

export function billingRoutes({ store, auth, flutterwave, pricing, webUrl, webhookHash }) {
  const r = express.Router();

  /** Verifies with Flutterwave and, if genuinely paid, creates the organisation (once). */
  async function settle(txRef, transactionId) {
    const payment = await store.getPaymentByTxRef(txRef);
    if (!payment) throw new HttpError(404, 'Unknown payment reference');
    if (payment.status === 'successful') {
      const { organisation } = await store.fulfilPayment(txRef, payment.flwTransactionId); // returns the existing one
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
    const { organisation } = await store.fulfilPayment(txRef, String(v.id));
    return { status: 'successful', organisation };
  }

  const view = (o) => ({ id: o.id, name: o.name });

  // 1. The owner-to-be chooses a name; we return Flutterwave's payment page.
  r.post(
    '/checkout',
    auth,
    wrap(async (req, res) => {
      if (!flutterwave.enabled) throw new HttpError(503, 'Payments are not set up yet');
      const organisationName = cleanName(req.body.organisationName, 'Organisation name');
      const txRef = `fuel_${crypto.randomUUID()}`;
      await store.createPayment({ txRef, userId: req.user.id, organisationName, amount: pricing.amount, currency: pricing.currency });
      try {
        const { link } = await flutterwave.initiate({
          txRef,
          amount: pricing.amount,
          currency: pricing.currency,
          redirectUrl: `${webUrl}/?payment=return`,
          customer: { email: req.user.email, name: req.user.name },
          title: 'New organisation',
          description: organisationName,
          meta: { userId: req.user.id },
        });
        res.json({ link, txRef });
      } catch (e) {
        console.error(e);
        await store.markPaymentFailed(txRef);
        throw new HttpError(502, 'Could not start the payment. Please try again.');
      }
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
      if (req.query.status === 'cancelled') return res.json({ status: 'cancelled' });
      const result = await settle(txRef, req.query.transaction_id ? String(req.query.transaction_id) : undefined);
      res.json(result.organisation ? { status: result.status, organisation: view(result.organisation) } : { status: result.status });
    })
  );

  // 3. Flutterwave's own notification, in case the customer closed the browser before coming back.
  r.post(
    '/webhook',
    wrap(async (req, res) => {
      if (!webhookHash || !safeEqual(req.get('verif-hash'), webhookHash)) throw new HttpError(401, 'Invalid signature');
      const { event, data } = req.body ?? {};
      if (event === 'charge.completed' && data?.status === 'successful' && data?.tx_ref && data?.id) {
        try {
          await settle(String(data.tx_ref), String(data.id));
        } catch (e) {
          if (!(e instanceof HttpError)) throw e; // unexpected: let Flutterwave retry
          console.error(`Webhook for ${data.tx_ref} not accepted: ${e.message}`);
        }
      }
      res.json({ ok: true });
    })
  );

  return r;
}
