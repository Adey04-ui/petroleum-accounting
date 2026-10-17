import { describe, it, expect } from 'vitest';
import { createFlutterwave, safeEqual } from '../src/flutterwave.js';

function fakeFetch(reply, status = 200) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, init });
    return { ok: status < 400, status, json: async () => reply };
  };
  fn.seen = seen;
  return fn;
}

describe('Flutterwave v3 client', () => {
  it('asks for a hosted payment link with the secret key', async () => {
    const f = fakeFetch({ status: 'success', data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' } });
    const flw = createFlutterwave({ secretKey: 'FLWSECK_TEST-x', fetchImpl: f });
    const out = await flw.initiate({ txRef: 'ref1', amount: 15000, currency: 'NGN', redirectUrl: 'https://app/?payment=return', customer: { email: 'a@b.com', name: 'A' }, title: 'New organisation', description: 'Acme' });
    expect(out.link).toContain('checkout.flutterwave.com');
    const { url, init } = f.seen[0];
    expect(url).toBe('https://api.flutterwave.com/v3/payments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer FLWSECK_TEST-x');
    expect(JSON.parse(init.body)).toMatchObject({ tx_ref: 'ref1', amount: 15000, currency: 'NGN', redirect_url: 'https://app/?payment=return', customer: { email: 'a@b.com' }, customizations: { title: 'New organisation' } });
  });

  it('verifies a transaction by id and maps the fields', async () => {
    const f = fakeFetch({ status: 'success', data: { id: 4401, tx_ref: 'ref1', status: 'successful', amount: 15000, currency: 'NGN', customer: { email: 'a@b.com' } } });
    const flw = createFlutterwave({ secretKey: 'k', fetchImpl: f });
    expect(await flw.verify(4401)).toEqual({ id: 4401, txRef: 'ref1', status: 'successful', amount: 15000, currency: 'NGN', email: 'a@b.com' });
    expect(f.seen[0].url).toBe('https://api.flutterwave.com/v3/transactions/4401/verify');
    expect(f.seen[0].init.method).toBeUndefined(); // GET
  });

  it('turns an error reply into an exception and refuses to run without a key', async () => {
    const bad = createFlutterwave({ secretKey: 'k', fetchImpl: fakeFetch({ status: 'error', message: 'Invalid key' }, 401) });
    await expect(bad.verify(1)).rejects.toThrow(/Invalid key/);
    const none = createFlutterwave({});
    expect(none.enabled).toBe(false);
    await expect(none.verify(1)).rejects.toThrow(/not configured/);
  });

  it('compares webhook hashes safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });
});
