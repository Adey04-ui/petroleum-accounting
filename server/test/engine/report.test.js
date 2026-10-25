import { describe, it, expect } from 'vitest';
import { calculateMonth, validateMonth } from '../../src/engine/index.js';

// The station's own daily report for Tue 01/09/2026 (PMS 1,310, AGO 1,880).
const cfg = {
  pms: { openingCostPerLitre: 1200, toleranceRate: 0.04, tanks: [{ id: 't1', name: 'PMS Tank 1', openingStock: 470 }] },
  ago: { toleranceRate: 0.085, tanks: [{ id: 't1', name: 'AGO Tank 1', openingStock: 0 }] },
};
const sept1 = {
  date: '2026-09-01',
  pms: {
    pumps: [
      { id: '1', opening: 4352.97, closing: 4409.14, rtt: 34.01 },
      { id: '2', idle: true },
      { id: '3', opening: 42246.74, closing: 42403.28, rtt: 12.16 },
    ],
    deliveries: [{ litres: 5530, costPerLitre: 1200, tankId: 't1' }],
    tankClosings: { t1: 5780 },
    sellingPrice: 1310,
  },
  ago: { pumps: [{ id: '1', opening: 3717.55, closing: 3717.55 }], tankClosings: { t1: 0 }, sellingPrice: 1880 },
  payments: [{ label: 'Moniepoint POS', amount: 166800 }, { label: 'Zenith', amount: 0 }],
  expenses: [{ label: 'Data to POS', amount: 2000 }],
};

describe('the station\'s own report (1 Sept 2026)', () => {
  const { days: [r] } = calculateMonth(cfg, [sept1]);

  it('works out each pump after its own return-to-tank', () => {
    const [p1, p2, p3] = r.pms.pumps;
    expect(p1.sales).toBeCloseTo(22.16, 2);
    expect(p3.sales).toBeCloseTo(144.38, 2);
    expect(p2.used).toBe(false);
    expect(r.pms.pumpSales).toBeCloseTo(166.54, 2);
    expect(r.pms.rtt).toBeCloseTo(46.17, 2);
  });

  it('matches the report: sales value and available balance', () => {
    expect(r.pms.revenue).toBeCloseTo(218167.4, 2);
    expect(r.banking.expectedCash).toBeCloseTo(218167.4, 2);
    expect(r.banking.availableBalance).toBeCloseTo(49367.4, 2);
    expect(r.banking.cashToLodge).toBeCloseTo(49367.4, 2); // same thing under its older name
    expect(r.banking.expenses).toBe(2000);
    expect(r.banking.nonCash).toBe(166800);
  });

  it('shows the 53.46 L gap between the tank and the pumps', () => {
    expect(r.pms.openingStock).toBe(470);
    expect(r.pms.received).toBe(5530);
    expect(r.pms.tankSales).toBeCloseTo(220, 6);
    expect(r.pms.actualTolerance).toBeCloseTo(-53.46, 2);
    expect(r.pms.tanks[0]).toMatchObject({ name: 'PMS Tank 1', opening: 470, received: 5530, closing: 5780 });
  });

  it('diesel with no sales is a quiet zero', () => {
    expect(r.ago.pumpSales).toBe(0);
    expect(r.ago.revenue).toBe(0);
  });
});

describe('several tanks, and fuel that moves', () => {
  const config = {
    pms: { openingCostPerLitre: 1000, toleranceRate: 0, tanks: [{ id: 'a', name: 'Tank A', openingStock: 3000 }, { id: 'b', name: 'Tank B', openingStock: 1000 }] },
  };
  const day = (extra, closings, sold = 0) => ({
    date: '2026-11-01',
    pms: { pumps: [{ id: '1', opening: 0, closing: sold }], tankClosings: closings, sellingPrice: 1100, ...extra },
  });

  it('adds the tanks up and tracks each one', () => {
    const { days: [r] } = calculateMonth(config, [day({ deliveries: [{ litres: 2000, costPerLitre: 1000, tankId: 'b' }] }, { a: 2800, b: 2900 }, 300)]);
    expect(r.pms.openingStock).toBe(4000);
    expect(r.pms.closingStock).toBe(5700);
    expect(r.pms.tankSales).toBe(300);
    expect(r.pms.tanks.map((t) => [t.name, t.litresOut])).toEqual([['Tank A', 200], ['Tank B', 100]]);
  });

  it('moving fuel between your own tanks changes the tanks but not the totals', () => {
    const { days: [r] } = calculateMonth(config, [day({ transfers: [{ litres: 500, fromTankId: 'a', toTankId: 'b' }] }, { a: 2500, b: 1500 })]);
    expect(r.pms.tankSales).toBe(0);
    expect(r.pms.transferredOut).toBe(0);
    expect(r.pms.tanks.map((t) => [t.transferOut, t.transferIn, t.litresOut])).toEqual([[500, 0, 0], [0, 500, 0]]);
    expect(r.warnings).toEqual([]);
  });

  it('fuel transferred out of the station is not a sale, not a loss, and has no effect on profit', () => {
    const { days: [r] } = calculateMonth(config, [day({ transfers: [{ litres: 400, fromTankId: 'a', note: 'to the other branch' }] }, { a: 2600, b: 1000 })]);
    expect(r.pms.transferredOut).toBe(400);
    expect(r.pms.transferCost).toBeCloseTo(400000, 2); // left stock at its cost
    expect(r.pms.tankSales).toBe(0);
    expect(r.pms.actualTolerance).toBe(0); // without the record this would look like a 400 L loss
    expect(r.pms.profit).toBe(0);
    expect(r.pms.stockValue).toBeCloseTo(3600 * 1000, 2);
  });

  it('asks for what is missing', () => {
    const errs = (d) => validateMonth(config, [d]).map((e) => e.message).join(' | ');
    expect(errs(day({}, { a: 3000 }))).toMatch(/closing dip is missing/i); // tank B has no dip
    expect(errs(day({ deliveries: [{ litres: 10, costPerLitre: 1000 }] }, { a: 3000, b: 1010 }))).toMatch(/Choose which tank/);
    expect(errs(day({ transfers: [{ litres: 10, fromTankId: 'a', toTankId: 'a' }] }, { a: 3000, b: 1000 }))).toMatch(/different tank/);
  });
});

describe('pumps', () => {
  const config = { pms: { openingCostPerLitre: 1000, toleranceRate: 0, openingStock: 1000 } };
  const run = (pumps) => validateMonth(config, [{ date: '2026-11-01', pms: { pumps, closingStock: 900, sellingPrice: 1100 } }]).map((e) => e.message).join(' | ');

  it('a forgotten closing meter is an error, but a pump marked "not used" is fine', () => {
    expect(run([{ id: '1', opening: 10 }])).toMatch(/Closing meter is missing/);
    expect(run([{ id: '1', opening: 10, closing: 110 }, { id: '2', idle: true }])).toBe('');
  });

  it('return-to-tank cannot be more than the meter sales', () => {
    expect(run([{ id: '1', opening: 10, closing: 20, rtt: 15 }])).toMatch(/more than the meter sales/);
  });
});

describe('a single day can carry its own tolerance', () => {
  const config = { pms: { openingCostPerLitre: 1000, toleranceRate: 0.04, openingStock: 1000 } };
  const mk = (rate) => ({ date: '2026-11-01', pms: { pumps: [{ id: '1', opening: 0, closing: 400 }], closingStock: 590, sellingPrice: 1100, ...(rate ? { toleranceRate: rate } : {}) } });

  it('changes the allowance and the variance for that day only, never the sales or profit', () => {
    const base = calculateMonth(config, [mk()]).days[0].pms;
    const fixed = calculateMonth(config, [mk(0.075)]).days[0].pms; // 1.5 L per 20 L instead of 0.8
    expect(base.expectedTolerance).toBeCloseTo(0.04 * 410, 6);
    expect(fixed.expectedTolerance).toBeCloseTo(0.075 * 410, 6);
    expect(fixed.toleranceVariance).toBeCloseTo(base.toleranceVariance - (0.075 - 0.04) * 410, 6); // a bigger allowance leaves a bigger shortfall to explain
    expect(fixed.profit).toBeCloseTo(base.profit, 6);
    expect(fixed.revenue).toBe(base.revenue);
    expect(validateMonth(config, [mk(1.5)]).map((e) => e.message).join()).toMatch(/between 0 and 1/);
  });
});

describe('the cash side of the report', () => {
  const config = { carryBalance: true, pms: { openingCostPerLitre: 1000, toleranceRate: 0, openingStock: 5000 } };
  const day = (date, closing, stock, extra) => ({ date, pms: { pumps: [{ id: '1', ...(date === '2026-11-01' ? { opening: 0 } : {}), closing }], closingStock: stock, sellingPrice: 1000 }, ...extra });

  it('carries yesterday\'s unbanked cash forward when the station turns that on', () => {
    const { days } = calculateMonth(config, [
      day('2026-11-01', 100, 4900, { payments: [{ label: 'POS', amount: 30000 }] }), // 100,000 sales - 30,000 POS = 70,000
      day('2026-11-02', 150, 4850, { banked: 100000 }), // +50,000 sales; banks 100,000
    ]);
    expect(days[0].banking.availableBalance).toBe(70000);
    expect(days[1].banking.previousBalance).toBe(70000);
    expect(days[1].banking.availableBalance).toBe(70000 + 50000 - 100000);
  });

  it('does not carry anything forward by default', () => {
    const off = { ...config, carryBalance: false };
    const { days } = calculateMonth(off, [day('2026-11-01', 100, 4900), day('2026-11-02', 150, 4850)]);
    expect(days[1].banking.previousBalance).toBe(0);
    expect(days[1].banking.availableBalance).toBe(50000);
  });

  it('credit sales are sales whose cash has not arrived; credit paid back brings it in', () => {
    const { days } = calculateMonth({ ...config, carryBalance: false }, [
      day('2026-11-01', 100, 4900, { creditSales: 20000 }),
      day('2026-11-02', 150, 4850, { creditReceived: 20000 }),
    ]);
    expect(days[0].banking.availableBalance).toBe(80000);
    expect(days[1].banking.availableBalance).toBe(70000);
  });
});
