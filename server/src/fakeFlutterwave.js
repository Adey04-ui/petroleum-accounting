// A stand-in for Flutterwave used by the tests and by `npm run dev:memory`: nobody is charged.
// "Paying" just means following the returned link back to the web app.
export function createFakeFlutterwave() {
  const sessions = new Map(); // txRef -> { amount, currency }
  const fake = {
    enabled: true,
    calls: [],
    /** What verify() will report. Tests change these to simulate failures. */
    outcome: 'successful',
    amountOverride: null,

    async initiate(p) {
      fake.calls.push(p);
      sessions.set(p.txRef, { amount: p.amount, currency: p.currency });
      return { link: `${p.redirectUrl}&status=successful&tx_ref=${p.txRef}&transaction_id=fake_${p.txRef}` };
    },

    async verify(transactionId) {
      const txRef = String(transactionId).replace(/^fake_/, '');
      const s = sessions.get(txRef);
      if (!s) throw new Error('Flutterwave error: No transaction was found for this id');
      return { id: transactionId, txRef, status: fake.outcome, amount: fake.amountOverride ?? s.amount, currency: s.currency, email: 'x@x.com' };
    },
  };
  return fake;
}
