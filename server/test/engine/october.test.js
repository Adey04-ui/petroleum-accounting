import { describe, it, expect } from 'vitest';
import { calculateMonth, ValidationError } from '../../src/engine/index.js';
import { config, days, sheet } from './october.fixture.js';

describe('October sheet (days 1-7)', () => {
  const { days: out, summary } = calculateMonth(config, days.slice(0, 7));

  it('matches daily PMS profit', () => {
    out.forEach((d, i) => expect(d.pms.profit).toBeCloseTo(sheet.dailyProfit[i], 2));
  });

  it('matches the sheet net profit', () => {
    expect(summary.profitBeforeExpenses).toBeCloseTo(sheet.netProfit, 2);
  });

  it('priceMargin + toleranceMargin equals profit when cost is constant', () => {
    out.forEach((d) => expect(d.pms.priceMargin + d.pms.toleranceMargin).toBeCloseTo(d.pms.profit, 6));
  });

  it('matches tolerance variance and cash to lodge', () => {
    expect(out[0].pms.toleranceVariance).toBeCloseTo(sheet.toleranceVarianceDay1, 2);
    expect(out[0].banking.cashToLodge).toBeCloseTo(sheet.cashToLodgeDay1, 2);
    expect(out[2].banking.cashToLodge).toBeCloseTo(sheet.cashToLodgeDay3, 2);
  });

  it('has no price-change gain when cost never moves', () => {
    expect(summary.priceChangeGain).toBeCloseTo(0, 6);
  });

  it('tank stock carries over day to day', () => {
    expect(out[6].pms.closingStock).toBe(2800);
    expect(out[7 - 1].pms.openingStock).toBeCloseTo(3200, 6);
  });
});

describe('Oct 8', () => {
  it('is profitable once a cost price exists (the sheet showed 0 because cost was blank)', () => {
    const { days: out } = calculateMonth(config, days.slice(0, 8));
    expect(out[7].pms.profit).toBeCloseTo(329.14 * 1390 - 320 * 1351, 1);
  });
});

describe('validation', () => {
  it('rejects a missing closing meter (the Oct 9 problem in the sheet)', () => {
    const bad = [
      ...days.slice(0, 8),
      {
        date: '2026-10-09',
        pms: { pumps: [{ id: '1A' }, { id: '2A' }], closingStock: 2480, sellingPrice: 1390 },
      },
    ];
    expect(() => calculateMonth(config, bad)).toThrow(ValidationError);
    try {
      calculateMonth(config, bad);
    } catch (e) {
      expect(e.errors.map((x) => x.date)).toContain('2026-10-09');
    }
  });

  it('rejects closing meter lower than opening', () => {
    const bad = structuredClone(days.slice(0, 2));
    bad[1].pms.pumps[0].closing = 100;
    expect(() => calculateMonth(config, bad)).toThrow(/lower than opening/);
  });

  it('warns when an opening meter does not match yesterday\'s closing', () => {
    const odd = structuredClone(days.slice(0, 2));
    odd[1].pms.pumps[0].opening = 10800;
    const { days: out } = calculateMonth(config, odd);
    expect(out[1].warnings.join(' ')).toMatch(/differs/);
  });
});
