import { describe, it, expect } from 'vitest';
import { calculateMonth } from '../../src/engine/index.js';

// One-day scenario where every litre sold passes through the pump (no tolerance).
function day({ stock, stockCost, deliveries = [], sold, price, replacementCost, method = 'WAC' }) {
  const closing = stock + deliveries.reduce((s, d) => s + d.litres, 0) - sold;
  const config = { costingMethod: method, pms: { openingStock: stock, openingCostPerLitre: stockCost } };
  const d = {
    date: '2026-11-01',
    pms: { pumps: [{ id: '1', opening: 0, closing: sold }], deliveries, closingStock: closing, sellingPrice: price, replacementCost },
  };
  const { days, summary } = calculateMonth(config, [d]);
  return { r: days[0].pms, summary };
}

describe('price change on stock already in the tank', () => {
  it('price rise = extra profit', () => {
    // 5000 L bought at 1351; replacement cost rises to 1400; pump price 1439 (still +39 margin)
    const { r } = day({ stock: 5000, stockCost: 1351, sold: 300, price: 1439, replacementCost: 1400 });
    expect(r.profit).toBeCloseTo(26400, 2);
    expect(r.normalProfit).toBeCloseTo(11700, 2);
    expect(r.priceChangeGain).toBeCloseTo(14700, 2);
  });

  it('price drop = loss', () => {
    const { r } = day({ stock: 5000, stockCost: 1351, sold: 300, price: 1339, replacementCost: 1300 });
    expect(r.profit).toBeCloseTo(-3600, 2);
    expect(r.normalProfit).toBeCloseTo(11700, 2);
    expect(r.priceChangeGain).toBeCloseTo(-15300, 2);
  });
});

describe('new delivery into a tank that still holds older stock', () => {
  const deliveries = [{ litres: 10000, costPerLitre: 1400 }];

  it('weighted average blends the two prices', () => {
    const { r } = day({ stock: 2000, stockCost: 1351, deliveries, sold: 300, price: 1439 });
    expect(r.unitCost).toBeCloseTo(16702000 / 12000, 4); // 1391.8333
    expect(r.profit).toBeCloseTo(300 * (1439 - 16702000 / 12000), 2); // 14150
    expect(r.replacementCost).toBe(1400); // defaults to the latest delivery
    expect(r.priceChangeGain).toBeCloseTo(300 * (1400 - 16702000 / 12000), 2); // 2450
    expect(r.stockValue).toBeCloseTo(16702000 - 300 * (16702000 / 12000), 2);
  });

  it('FIFO sells the older litres first, WAC does not', () => {
    const wac = day({ stock: 2000, stockCost: 1351, deliveries, sold: 3000, price: 1439, method: 'WAC' });
    const fifo = day({ stock: 2000, stockCost: 1351, deliveries, sold: 3000, price: 1439, method: 'FIFO' });
    expect(fifo.r.costOfGoodsSold).toBeCloseTo(2000 * 1351 + 1000 * 1400, 2);
    expect(wac.r.costOfGoodsSold).toBeCloseTo(3000 * (16702000 / 12000), 2);
  });

  it('FIFO carries the cheaper layer across days; WAC keeps the blend', () => {
    const mk = (method) => {
      const config = { costingMethod: method, pms: { openingStock: 2000, openingCostPerLitre: 1351 } };
      const days = [
        { date: '2026-11-01', pms: { pumps: [{ id: '1', opening: 0, closing: 2500 }], deliveries, closingStock: 9500, sellingPrice: 1439 } },
        { date: '2026-11-02', pms: { pumps: [{ id: '1', closing: 3500 }], closingStock: 8500, sellingPrice: 1439 } },
      ];
      return calculateMonth(config, days).days;
    };
    expect(mk('FIFO')[1].pms.unitCost).toBeCloseTo(1400, 4); // old 2000 L already used up on day 1
    expect(mk('WAC')[1].pms.unitCost).toBeCloseTo(16702000 / 12000, 4);
  });
});

describe('odd data', () => {
  it('closing dip above opening + deliveries produces a warning, not a crash', () => {
    const config = { pms: { openingStock: 1000, openingCostPerLitre: 1351 } };
    const days = [{ date: '2026-11-01', pms: { pumps: [{ id: '1', opening: 0, closing: 0 }], closingStock: 1200, sellingPrice: 1390 } }];
    const { days: out } = calculateMonth(config, days);
    expect(out[0].warnings.length).toBe(1);
    expect(out[0].pms.tankSales).toBe(0);
    expect(out[0].pms.stockValue).toBeCloseTo(1200 * 1351, 2);
  });
});
