// Clicks through the real screens against the real API (in-memory store, fake Flutterwave, no database).
import React from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, configure, createEvent } from '@testing-library/react';
import { createApp } from '../../server/src/createApp.js';
import { createMemoryStore } from '../../server/src/store/memory.js';
import { createFakeFlutterwave } from '../../server/src/fakeFlutterwave.js';
import { redirect } from '../src/nav.js';
import { clearAll } from '../src/offline.js';

vi.mock('../src/nav.js', () => ({ redirect: vi.fn() }));
configure({ asyncUtilTimeout: 4000 });

let server, App, store;
const flw = createFakeFlutterwave();
const HASH = '$2b$04$3Uek4RAJD7hmTQJfJOBS.ebiz54q9kSBvZZ3SjF8XEhhsi7i2tKim' // bcrypt of 'password123'

// Lets a test switch the "network" off: every request fails the way it does with no signal.
const realFetch = globalThis.fetch;
let offline = false;
globalThis.fetch = (...args) => (offline ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(...args));

beforeAll(async () => {
  store = createMemoryStore();
  await store.createUser({ name: 'Admin', email: 'admin@test.com', passwordHash: HASH, isPlatformAdmin: true });
  server = await new Promise((resolve) => {
    const s = createApp(store, {
      jwtSecret: 'test-secret-test-secret',
      flutterwave: flw,
      webUrl: 'http://app.test',
      pricing: { amount: 15000, currency: 'NGN', interval: 'yearly' },
      planId: 'PLAN1',
    }).listen(0, () => resolve(s));
  });
  vi.stubEnv('VITE_API_URL', `http://127.0.0.1:${server.address().port}`);
  App = (await import('../src/App.jsx')).default;
});
afterAll(() => server.close());
afterEach(() => {
  offline = false;
  cleanup();
  window.history.replaceState({}, '', '/');
});

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (role, name) => fireEvent.click(screen.getByRole(role, { name }));
const fresh = async () => {
  localStorage.clear();
  await clearAll();
  render(<App />);
};
// On the home screen the organisation row is the one that mentions "staff and roles".
const openOrg = async (name = 'Alpha Energy') => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${name}.*staff and roles`) }));
const signIn = async (email) => {
  await fresh();
  type(/^Email/, email);
  type(/^Password/, 'password123');
  click('button', 'Sign in');
};
const openStation1 = async () => {
  await openOrg();
  await screen.findByText(/5 of 5 stations/);
  fireEvent.click(screen.getAllByRole('button', { name: /^Station 1/ })[0]);
};
// a synthetic pointer event with a controlled clock, so velocity is deterministic
// (React treats a timeStamp of 0 as "missing", and browsers never report 0, so the clock starts at 1000 ms)
const pointer = (kind, el, y, t) => {
  const ev = createEvent[kind](el, { clientY: y, pointerId: 1, button: 0 });
  Object.defineProperty(ev, 'timeStamp', { value: 1000 + t });
  fireEvent(el, ev);
};
const returnFromFlutterwave = () => {
  const link = new URL(redirect.mock.calls.at(-1)[0]);
  cleanup();
  window.history.pushState({}, '', `/?payment=return&status=successful&tx_ref=${link.searchParams.get('tx_ref')}&transaction_id=${link.searchParams.get('transaction_id')}`);
  render(<App />);
};
const fillDay = (closings) => {
  for (const [id, v] of Object.entries(closings.pumps)) type(`Pump ${id} closing`, v);
  type('Tank 1 dip', closings.dip);
  type('Moniepoint POS', closings.pos);
};

describe('the customer journey', () => {
  it('creates an account, pays for an organisation with automatic renewal, and lands on its dashboard', async () => {
    await fresh();
    click('tab', 'Create account');
    type(/Your name/, 'Kemi Adeyemi');
    type(/^Email/, 'kemi@test.com');
    type(/^Password/, 'password123');
    click('button', 'Create account');

    await screen.findByText('Start with an organisation');
    click('button', 'Create an organisation');
    await screen.findByRole('heading', { name: 'New organisation' });
    expect(screen.getByRole('tab', { name: 'Card, renews itself' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: /Pay ₦15,000 with Flutterwave/ }).disabled).toBe(true); // needs a name first
    type(/Organisation name/, 'Alpha Energy');
    click('button', /Pay ₦15,000 with Flutterwave/);

    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(flw.calls.at(-1).paymentPlan).toBe('PLAN1'); // paid through the recurring plan
    returnFromFlutterwave();
    await screen.findByText('Payment confirmed');
    click('button', 'Open your dashboard');
    await screen.findByRole('heading', { name: 'Alpha Energy' });
    expect(window.location.search).toBe(''); // payment parameters cleared from the address bar
    await screen.findByText(/Renews automatically every year/);
    expect(screen.getByText('Paid until')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Renew subscription' })).toBeNull(); // nothing to do while it renews itself
  });

  it('adds stations up to the limit of five, then stops', async () => {
    await signIn('kemi@test.com');
    await openOrg();
    await screen.findByText(/0 of 5 stations/);

    for (let i = 1; i <= 5; i++) {
      click('button', 'Add a station');
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/^Station name/), { target: { value: `Station ${i}` } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add station' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await screen.findByText(`Station ${i}`);
    }
    await screen.findByText(/5 of 5 stations/);
    expect(screen.getByRole('button', { name: 'Add a station' }).disabled).toBe(true);
    screen.getByText('You have reached the limit of 5 stations.');
  });

  it('assigns a role to a new person at a station', async () => {
    await signIn('kemi@test.com');
    await openOrg();
    await screen.findByText(/5 of 5 stations/);
    click('button', 'Add a person');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ade Attendant' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'ade@test.com' } });
    fireEvent.change(within(dialog).getByLabelText(/Password for them/), { target: { value: 'password123' } });
    const group = within(dialog).getByRole('tablist', { name: 'Role at Station 1' });
    fireEvent.click(within(group).getByRole('tab', { name: 'Attendant' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    await screen.findByText('Attendant at Station 1');
  });

  it('the owner sets up a station and enters a day: the figures match the spreadsheet', async () => {
    await signIn('kemi@test.com');
    await openStation1();

    await screen.findByText('How this station works');
    type(/Pump names/, '1A, 2A');
    type(/pms tank 1 opening stock/i, '5100');
    type(/^Opening cost/, '1351');
    type(/Allowed tolerance/, '1.3');
    type(/Card, POS and transfer types/, 'Moniepoint POS');
    click('button', 'Save setup');
    await screen.findByText('Saved.');

    click('tab', 'Daily entry');
    await screen.findByRole('heading', { name: 'PMS (Petrol)', level: 2 });
    type(/^Date/, '2026-10-01');
    await waitFor(() => expect(screen.getByLabelText('Pump 1A opening').hasAttribute('readonly')).toBe(false));
    type('Pump 1A opening', '10426.25');
    type('Pump 1A closing', '10747.21');
    type('Pump 2A opening', '44686.34');
    type('Pump 2A closing', '44686.34');
    type(/Selling price/, '1390');
    type('Tank 1 dip', '4780');
    type('Moniepoint POS', '543200');
    click('button', 'Save day');

    await screen.findByText('Result for 2026-10-01');
    expect(screen.getAllByText('-₦97,065.6').length).toBeGreaterThan(0); // available balance, as on the sheet
    expect(screen.getAllByText('₦13,814.4').length).toBeGreaterThan(0); // price margin + tolerance margin
    expect(screen.getAllByText('Expected tolerance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Price margin').length).toBeGreaterThan(0);
  });

  it('the owner can correct one day\'s tolerance (0.8 to 1.5 L per 20 L) without touching anything else', async () => {
    await signIn('kemi@test.com');
    await openStation1();
    await screen.findByRole('tab', { name: 'Daily entry' });
    click('tab', 'Daily entry');
    type(/^Date/, '2026-10-01');
    await screen.findByText(/You are changing a saved day/);
    type(/this day only/, '1.5');
    click('button', 'Update day');
    await waitFor(() => expect(screen.getAllByText('24 L').length).toBeGreaterThan(0)); // 1.5/20 of the 320 L that left the tank
  });
});

describe('staff', () => {
  it('an attendant adds a day, then cannot change it; and never sees cost, profit or settings', async () => {
    await signIn('ade@test.com');
    await screen.findByRole('heading', { name: 'Station 1' });
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();

    type(/^Date/, '2026-10-02');
    await waitFor(() => expect(screen.getByLabelText('Pump 1A opening').value).toBe('10,747.21'));
    expect(screen.queryByLabelText(/this day only/)).toBeNull(); // the owner's tolerance field is not for staff
    fillDay({ pumps: { '1A': '10800', '2A': '44686.34' }, dip: '4600', pos: '100000' });
    click('button', 'Save day');
    await screen.findByText(/Only the owner can change it/);
    expect(screen.queryByRole('button', { name: 'Save day' })).toBeNull();
    expect(screen.queryByText('Price margin')).toBeNull();

    click('tab', 'Results');
    type(/^Month/, '2026-10');
    await screen.findByText('Day by day');
    expect(screen.queryByText('Profit after expenses')).toBeNull();
    expect(screen.queryByText('Price + tol. margin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download Excel' })).toBeNull();
    expect(screen.getByText('PMS expected tol.')).toBeTruthy(); // tolerance is visible to everyone
  });

  it('with no signal, days are kept on the phone and upload by themselves when it returns', async () => {
    await signIn('ade@test.com');
    await screen.findByRole('heading', { name: 'Station 1' });
    type(/^Date/, '2026-10-03');
    await waitFor(() => expect(screen.getByLabelText('Pump 1A opening').value).toBe('10,800'));

    offline = true; // the signal drops
    fillDay({ pumps: { '1A': '10850', '2A': '44686.34' }, dip: '4550', pos: '40000' });
    click('button', 'Save day');
    await screen.findByText(/Saved on this phone/);
    await screen.findByText('1 waiting');

    // the next day carries on from the day saved on the phone
    type(/^Date/, '2026-10-04');
    await waitFor(() => expect(screen.getByLabelText('Pump 1A opening').value).toBe('10,850'));
    fillDay({ pumps: { '1A': '10900', '2A': '44686.34' }, dip: '4500', pos: '10000' });
    click('button', 'Save day');
    await screen.findByText('2 waiting');
    expect((await store.listAllOrganisations()).length).toBeGreaterThan(0);
    const org = (await store.listAllOrganisations()).find((o) => o.name === 'Alpha Energy');
    const station1 = (await store.listStations(org.id)).find((s) => s.name === 'Station 1');
    expect((await store.listDays(station1.id)).map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']); // not on the server yet

    offline = false; // the signal returns
    fireEvent.click(screen.getByRole('button', { name: /2 days saved on this phone/ }));
    await screen.findByRole('dialog');
    click('button', 'Try uploading everything');
    await screen.findByText('All uploaded');
    expect((await store.listDays(station1.id)).map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect((await store.getDay(station1.id, '2026-10-04')).version).toBe(1);
  });

  it('the owner can download the Excel file for a station', async () => {
    await signIn('kemi@test.com');
    await openStation1();
    await screen.findByRole('tab', { name: 'Results' });
    click('tab', 'Results');
    type(/^Month/, '2026-10');
    await screen.findByText('Profit after expenses');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    click('button', 'Download Excel');
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
});

describe('renewing', () => {
  it('an organisation paid for once shows when it ends, and the owner can renew it', async () => {
    await signIn('kemi@test.com');
    fireEvent.click(await screen.findByRole('button', { name: 'Create another organisation' }));
    await screen.findByRole('heading', { name: 'New organisation' });
    click('tab', 'Pay for one year');
    type(/Organisation name/, 'Beta Energy');
    const redirectsBefore = redirect.mock.calls.length;
    click('button', /Pay ₦15,000 with Flutterwave/);
    await waitFor(() => expect(redirect.mock.calls.length).toBe(redirectsBefore + 1)); // the new payment has really started
    expect(flw.calls.at(-1).paymentPlan).toBeUndefined(); // no automatic renewal this time
    returnFromFlutterwave();
    await screen.findByText('Payment confirmed');
    click('button', 'Open your dashboard');
    await screen.findByRole('heading', { name: 'Beta Energy' });
    await screen.findByText(/Does not renew by itself/);

    click('button', 'Renew subscription');
    const dialog = await screen.findByRole('dialog');
    // this email already has an organisation renewing automatically, so only paying again is offered to start with
    const before = redirect.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: /Pay for another year/ }));
    await waitFor(() => expect(redirect.mock.calls.length).toBe(before + 1));
    expect(flw.calls.at(-1).title).toBe('Renew subscription');
    returnFromFlutterwave();
    await screen.findByText('Subscription renewed');
  });
});

describe('the sheet behaves like a physical object', () => {
  async function openSheet() {
    await signIn('kemi@test.com');
    await openOrg();
    await screen.findByText(/5 of 5 stations/);
    click('button', 'Add a person');
    const dialog = await screen.findByRole('dialog');
    await new Promise((r) => setTimeout(r, 800)); // let it finish arriving; grabbing it mid-flight would (correctly) pick it up from where it is
    return { dialog, grab: dialog.querySelector('.grab') };
  }

  it('a flick downward is projected to its destination and dismisses it', async () => {
    const { grab } = await openSheet();
    pointer('pointerDown', grab, 0, 0);
    pointer('pointerMove', grab, 100, 400);
    pointer('pointerMove', grab, 200, 800); // 250 px/s: it will glide a long way further
    pointer('pointerUp', grab, 200, 800);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 });
  });

  it('a small slow drag springs back instead of closing', async () => {
    const { grab } = await openSheet();
    pointer('pointerDown', grab, 0, 0);
    pointer('pointerMove', grab, 30, 500);
    pointer('pointerMove', grab, 60, 1000); // 60 px/s, projects to ~90px: well short of half the sheet
    pointer('pointerUp', grab, 60, 1000);
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes with Escape and is announced as a modal dialog', async () => {
    const { dialog } = await openSheet();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 });
  });
});
