import { describe, it, expect } from 'vitest';
import { calculateMonth } from '../../server/src/engine/index.js';
import { sanitizeDay } from '../../server/src/stationLogic.js';
import { blankForm, hydrateForm, serializeForm, previewDay, nextContext } from '../src/entryForm.js';

// The station's own report, entered the way the form does.
const meta = {
  carryBalance: false,
  paymentChannels: ['Moniepoint POS', 'Zenith POS'],
  products: {
    pms: { pumps: ['1', '2', '3'], tanks: [{ id: 't1', name: 'PMS Tank 1' }], openingStock: 470, toleranceRate: 0.04 },
    ago: { pumps: ['1'], tanks: [{ id: 't1', name: 'AGO Tank 1' }], openingStock: 0, toleranceRate: 0.085 },
  },
};
const ctx = {
  version: 0,
  previous: {
    date: null,
    pms: { tankClose: { t1: 470 }, closingStock: 470, sellingPrice: null, pumpClose: { 1: null, 2: null, 3: null } },
    ago: { tankClose: { t1: 0 }, closingStock: 0, sellingPrice: null, pumpClose: { 1: null } },
  },
};

function filled() {
  const f = blankForm(meta, ctx);
  Object.assign(f.pms.pumps['1'], { opening: '4352.97', closing: '4409.14', rtt: '34.01' });
  f.pms.pumps['2'].idle = true;
  Object.assign(f.pms.pumps['3'], { opening: '42246.74', closing: '42403.28', rtt: '12.16' });
  f.pms.tanks.t1 = '5780';
  f.pms.deliveries = [{ litres: '5530', costPerLitre: '1200', tankId: 't1' }];
  f.pms.sellingPrice = '1310';
  Object.assign(f.ago.pumps['1'], { opening: '3717.55', closing: '3717.55' });
  f.ago.tanks.t1 = '0';
  f.ago.sellingPrice = '1880';
  f.payments[0].amount = '166800';
  f.expenses = [{ label: 'Data to POS', amount: '2000' }];
  return f;
}

describe('the phone and the server do the same sums', () => {
  const form = filled();
  const preview = previewDay(meta, ctx, form);
  const config = {
    pms: { openingCostPerLitre: 1200, toleranceRate: 0.04, tanks: [{ id: 't1', name: 'PMS Tank 1', openingStock: 470 }] },
    ago: { toleranceRate: 0.085, tanks: [{ id: 't1', name: 'AGO Tank 1', openingStock: 0 }] },
  };
  const body = serializeForm(meta, ctx, form, { owner: true });
  // the server turns the form's text into numbers before calculating; do the same here
  const server = calculateMonth(config, [{ date: '2026-09-01', ...JSON.parse(JSON.stringify(sanitizeDay(body))) }]).days[0];

  it('matches the engine on litres, tolerance and cash', () => {
    const a = preview.products.pms;
    const b = server.pms;
    for (const k of ['pumpSales', 'tankSales', 'actualTolerance', 'expectedTolerance', 'toleranceVariance', 'revenue']) expect(a[k]).toBeCloseTo(b[k], 6);
    expect(preview.banking.availableBalance).toBeCloseTo(server.banking.availableBalance, 6);
    expect(preview.banking.availableBalance).toBeCloseTo(49367.4, 2);
    expect(a.tankSales).toBeCloseTo(220, 6);
    expect(a.actualTolerance).toBeCloseTo(-53.46, 2);
  });

  it('a tolerance the owner sets for one day changes the allowance in the preview too', () => {
    const f = filled();
    f.pms.tolerancePer20 = '1.5';
    expect(previewDay(meta, ctx, f).products.pms.expectedTolerance).toBeCloseTo(0.075 * 220, 6);
    expect(serializeForm(meta, ctx, f, { owner: true }).pms.toleranceRate).toBeCloseTo(0.075, 6);
    expect(serializeForm(meta, ctx, f, { owner: false }).pms.toleranceRate).toBeUndefined(); // staff cannot send it
  });

  it('only owners send cost prices', () => {
    expect(serializeForm(meta, ctx, form, { owner: true }).pms.deliveries[0].costPerLitre).toBe('1200');
    expect(serializeForm(meta, ctx, form, { owner: false }).pms.deliveries[0].costPerLitre).toBeUndefined();
  });
});

describe('saving and loading a form', () => {
  it('comes back the same after a save', () => {
    const f = filled();
    const again = hydrateForm(meta, ctx, JSON.parse(JSON.stringify(serializeForm(meta, ctx, f, { owner: true }))));
    expect(again.pms.pumps['3']).toMatchObject({ closing: '42403.28', rtt: '12.16' });
    expect(again.pms.pumps['2'].idle).toBe(true);
    expect(again.pms.tanks.t1).toBe('5780');
    expect(again.payments.map((l) => [l.label, l.amount])).toEqual([['Moniepoint POS', '166800'], ['Zenith POS', '']]);
    expect(again.expenses).toEqual([{ label: 'Data to POS', amount: '2000' }]);
  });

  it('opens older single-number days (pos, transfer, expenses, closingStock) without losing them', () => {
    const old = { pms: { pumps: [{ id: '1', opening: 0, closing: 100 }], closingStock: 900, sellingPrice: 1000 }, pos: 30000, transfer: 5000, expenses: 800 };
    const simple = { carryBalance: false, paymentChannels: [], products: { pms: { pumps: ['1'], tanks: [{ id: 't1', name: 'Tank 1' }], openingStock: 1000, toleranceRate: 0 } } };
    const f = hydrateForm(simple, null, old);
    expect(f.pms.tanks.t1).toBe(900);
    expect(f.payments.map((l) => [l.label, l.amount])).toEqual([['POS', 30000], ['Transfer', 5000]]);
    expect(f.expenses).toEqual([{ label: 'Expenses', amount: 800 }]);
  });
});

describe('entering day after day with no signal', () => {
  it('the next day starts from where the saved-on-phone day ended', () => {
    const next = nextContext(meta, ctx, '2026-09-01', filled());
    expect(next.asOf).toBe('2026-09-01');
    expect(next.previous.pms.tankClose).toEqual({ t1: 5780 });
    expect(next.previous.pms.pumpClose).toEqual({ 1: 4409.14, 2: null, 3: 42403.28 });
    expect(next.previous.pms.sellingPrice).toBe(1310);
    expect(next.previous.balance).toBeCloseTo(49367.4, 2);

    const day2 = blankForm(meta, { previous: next.previous });
    expect(day2.pms.sellingPrice).toBe(1310); // yesterday's price is already there
    day2.pms.pumps['1'].closing = '4459.14';
    const body = serializeForm(meta, { previous: next.previous }, day2, { owner: false });
    expect(body.pms.pumps[0].opening).toBeUndefined(); // the opening meter is known, so it is not sent
    expect(previewDay(meta, { previous: next.previous }, day2).products.pms.openingStock).toBe(5780);
  });
});
