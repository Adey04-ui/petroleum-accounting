// A stand-in for Flutterwave used by the tests and by `npm run dev:memory`: nobody is charged.
// "Paying" just means following the returned link back to the web app.
export function createFakeFlutterwave() {
  const sessions = new Map(); // txRef -> { amount, currency, email, plan }
  const charges = new Map(); // flutterwave transaction id -> what verify() reports (renewals made "by Flutterwave")
  const fake = {
    enabled: true,
    calls: [],
    /** What verify() will report for checkouts. Tests change these to simulate failures. */
    outcome: 'successful',
    amountOverride: null,

    async initiate(p) {
      fake.calls.push(p);
      sessions.set(p.txRef, { amount: p.amount, currency: p.currency, email: p.customer?.email?.toLowerCase(), plan: p.paymentPlan });
      return { link: `${p.redirectUrl}&status=successful&tx_ref=${p.txRef}&transaction_id=fake_${p.txRef}` };
    },

    async createPlan(p) {
      fake.calls.push({ createPlan: p });
      return { id: 4242 };
    },

    /** Pretend Flutterwave charged a subscriber's card by itself. Then deliver `webhookFor(id)` to the API. */
    addCharge({ id, txRef = `plan-${id}`, email, amount, currency = 'NGN', status = 'successful' }) {
      charges.set(String(id), { id, txRef, status, amount, currency, email: email.toLowerCase() });
      return { event: 'charge.completed', data: { id, tx_ref: txRef, status, amount, currency, customer: { email } } };
    },

    async verify(transactionId) {
      const charge = charges.get(String(transactionId));
      if (charge) return { ...charge };
      const txRef = String(transactionId).replace(/^fake_/, '');
      const s = sessions.get(txRef);
      if (!s) throw new Error('Flutterwave error: No transaction was found for this id');
      return { id: transactionId, txRef, status: fake.outcome, amount: fake.amountOverride ?? s.amount, currency: s.currency, email: s.email };
    },
  };
  return fake;
}
