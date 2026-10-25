// Flutterwave v3 "Standard" checkout: we ask for a hosted payment link, the customer pays there, and we
// then VERIFY the transaction with Flutterwave before giving anything in return.
import crypto from 'node:crypto';

export function createFlutterwave({ secretKey, baseUrl = 'https://api.flutterwave.com', fetchImpl = fetch } = {}) {
  async function call(path, init = {}) {
    if (!secretKey) throw new Error('Flutterwave is not configured (FLW_SECRET_KEY is missing)');
    const res = await fetchImpl(baseUrl + path, {
      ...init,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || data?.status !== 'success') {
      throw new Error(`Flutterwave error: ${data?.message ?? res.status}`);
    }
    return data.data;
  }

  return {
    enabled: Boolean(secretKey),

    /** Returns { link } - send the customer there to pay. */
    async initiate({ txRef, amount, currency, redirectUrl, customer, title, description, meta, paymentPlan }) {
      const data = await call('/v3/payments', {
        method: 'POST',
        body: JSON.stringify({
          tx_ref: txRef,
          amount,
          currency,
          redirect_url: redirectUrl,
          customer,
          customizations: { title, description },
          meta,
          // With a plan, Flutterwave takes the card payment now and charges the card again every period.
          ...(paymentPlan ? { payment_plan: paymentPlan } : {}),
        }),
      });
      return { link: data.link };
    },

    /** Creates the recurring plan once (see `npm run create-plan`). Returns { id }. */
    async createPlan({ name, amount, interval, currency }) {
      const data = await call('/v3/payment-plans', { method: 'POST', body: JSON.stringify({ name, amount, interval, currency }) });
      return { id: data.id };
    },

    /** Looks the transaction up at Flutterwave. Never trust the redirect or webhook alone. */
    async verify(transactionId) {
      const d = await call(`/v3/transactions/${encodeURIComponent(transactionId)}/verify`);
      return { id: d.id, txRef: d.tx_ref, status: d.status, amount: d.amount, currency: d.currency, email: d.customer?.email?.toLowerCase() };
    },
  };
}

/** Constant-time comparison for the webhook's `verif-hash` header. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
