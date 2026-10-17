// Clicks through the real screens against the real API (in-memory store, fake Flutterwave, no database).
import React from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, configure, createEvent } from '@testing-library/react';
import { createApp } from '../../server/src/createApp.js';
import { createMemoryStore } from '../../server/src/store/memory.js';
import { createFakeFlutterwave } from '../../server/src/fakeFlutterwave.js';
import { redirect } from '../src/nav.js';

vi.mock('../src/nav.js', () => ({ redirect: vi.fn() }));
configure({ asyncUtilTimeout: 4000 });

let server, App, store;
const HASH = '$2b$04$3Uek4RAJD7hmTQJfJOBS.ebiz54q9kSBvZZ3SjF8XEhhsi7i2tKim'; // bcrypt of 'password123'

beforeAll(async () => {
  store = createMemoryStore();
  await store.createUser({ name: 'Admin', email: 'admin@test.com', passwordHash: HASH, isPlatformAdmin: true });
  server = await new Promise((resolve) => {
    const s = createApp(store, { jwtSecret: 'test-secret-test-secret', flutterwave: createFakeFlutterwave(), webUrl: 'http://app.test', pricing: { amount: 15000, currency: 'NGN' } }).listen(0, () => resolve(s));
  });
  vi.stubEnv('VITE_API_URL', `http://127.0.0.1:${server.address().port}`);
  App = (await import('../src/App.jsx')).default;
});
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (role, name) => fireEvent.click(screen.getByRole(role, { name }));
const fresh = () => {
  localStorage.clear();
  render(<App />);
};
// On the home screen the organisation row is the one that mentions "staff and roles".
const openOrg = async () => fireEvent.click(await screen.findByRole('button', { name: /Alpha Energy.*staff and roles/ }));
const signIn = async (email) => {
  fresh();
  type(/^Email/, email);
  type(/^Password/, 'password123');
  click('button', 'Sign in');
};
// a synthetic pointer event with a controlled clock, so velocity is deterministic
// (React treats a timeStamp of 0 as "missing", and browsers never report 0, so the clock starts at 1000 ms)
const pointer = (kind, el, y, t) => {
  const ev = createEvent[kind](el, { clientY: y, pointerId: 1, button: 0 });
  Object.defineProperty(ev, 'timeStamp', { value: 1000 + t });
  fireEvent(el, ev);
};

describe('the customer journey', () => {
  it('creates an account, pays for an organisation, and lands on its dashboard', async () => {
    fresh();
    click('tab', 'Create account');
    type(/Your name/, 'Kemi Adeyemi');
    type(/^Email/, 'kemi@test.com');
    type(/^Password/, 'password123');
    click('button', 'Create account');

    await screen.findByText('Start with an organisation');
    click('button', 'Create an organisation');
    await screen.findByText('One-time payment');
    expect(screen.getByRole('button', { name: /Pay ₦15,000 with Flutterwave/ }).disabled).toBe(true); // needs a name first
    type(/Organisation name/, 'Alpha Energy');
    click('button', /Pay ₦15,000 with Flutterwave/);

    await waitFor(() => expect(redirect).toHaveBeenCalled());
    const link = new URL(redirect.mock.calls.at(-1)[0]);
    expect(link.searchParams.get('status')).toBe('successful');

    // Flutterwave sends the customer back to the app
    cleanup();
    window.history.pushState({}, '', `/?payment=return&status=successful&tx_ref=${link.searchParams.get('tx_ref')}&transaction_id=${link.searchParams.get('transaction_id')}`);
    render(<App />);
    await screen.findByText('Payment confirmed');
    click('button', 'Open your dashboard');
    await screen.findByRole('heading', { name: 'Alpha Energy' });
    expect(window.location.search).toBe(''); // payment parameters cleared from the address bar
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

  it('owner sets up a station and enters a day: the figures match the spreadsheet', async () => {
    await signIn('kemi@test.com');
    await openOrg();
    await screen.findByText(/5 of 5 stations/);
    fireEvent.click(screen.getAllByRole('button', { name: /^Station 1/ })[0]);

    await screen.findByText('How this station works');
    type(/Pump names/, '1A, 2A');
    type(/^Opening stock/, '5100');
    type(/^Opening cost/, '1351');
    type(/Allowed tolerance/, '1.3');
    click('button', 'Save setup');
    await screen.findByText('Saved.');

    click('tab', 'Daily entry');
    await screen.findByText('PMS (Petrol)');
    type(/^Date/, '2026-10-01');
    await waitFor(() => expect(screen.getByLabelText(/Pump 1A opening/).hasAttribute('readonly')).toBe(false));
    type(/Pump 1A opening/, '10426.25');
    type(/Pump 1A closing/, '10747.21');
    type(/Pump 2A opening/, '44686.34');
    type(/Pump 2A closing/, '44686.34');
    type(/Selling price/, '1390');
    type(/Closing stock/, '4780');
    type(/^POS/, '543200');
    click('button', 'Save day');

    await screen.findByText('Result for 2026-10-01');
    expect(screen.getByText('-₦97,065.6')).toBeTruthy(); // cash to lodge
    expect(screen.getAllByText('₦13,814.4').length).toBeGreaterThan(0); // price margin + tolerance margin
    expect(screen.getByText('Expected tolerance')).toBeTruthy();
    expect(screen.getByText('Price margin')).toBeTruthy();
    expect(screen.getByText('Tolerance margin')).toBeTruthy();
  });

  it('an attendant goes straight to their station and never sees cost, profit or settings', async () => {
    await signIn('ade@test.com');
    await screen.findByRole('heading', { name: 'Station 1' });
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();

    click('tab', 'Results');
    type(/^Month/, '2026-10');
    await screen.findByText('Day by day');
    expect(screen.queryByText('Profit after expenses')).toBeNull();
    expect(screen.queryByText('Price + tol. margin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download Excel' })).toBeNull();
    expect(screen.getByText('PMS expected tol.')).toBeTruthy(); // tolerance is visible to everyone
  });

  it('the owner can download the Excel file for a station', async () => {
    await signIn('kemi@test.com');
    await openOrg();
    await screen.findByText(/5 of 5 stations/);
    fireEvent.click(screen.getAllByRole('button', { name: /^Station 1/ })[0]);
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
