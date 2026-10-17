// Calculation engine for the station sheet (meter reading -> tolerance ->
// banking -> profitability -> summary), plus stock costing and price-change gain.
//
// Pure functions, no UI and no database. Dates are 'YYYY-MM-DD' strings.
//
// INPUT
//   config = {
//     costingMethod: 'WAC' | 'FIFO',            // default 'WAC'
//     pms: { openingStock, openingCostPerLitre, toleranceRate },  // toleranceRate 0.04 = the sheet's 0.8/20
//     ago: { ... },                              // optional, same shape
//     adjustments: [{ label, amount }],          // month-level deductions (e.g. Moniepoint shortage)
//   }
//   days = [{
//     date,
//     pms: {
//       pumps: [{ id, opening?, closing }],      // opening defaults to that pump's previous closing
//       rtt,                                     // return-to-tank litres (default 0)
//       deliveries: [{ litres, costPerLitre }],
//       closingStock,                            // tank dip at close of day
//       sellingPrice,
//       replacementCost?,                        // what a litre costs to buy NOW (defaults to latest delivery cost)
//       toleranceRate?,                          // override for this day
//     },
//     ago: { ... },                              // optional
//     expenses, pos, transfer,                   // banking, all optional (default 0)
//     moniepointDeclared?,
//   }]
//
// PROFIT
//   profit = pumpSales * sellingPrice - costOfGoodsSold   (cost of the litres that left the tank)
//   This equals the sheet's  priceMargin + toleranceMargin  when cost price is constant.
//   priceChangeGain = tankSales * (replacementCost - unitCostOfThoseLitres)
//   normalProfit    = profit - priceChangeGain   (what you'd have made with no price movement)

import { Inventory, EPS } from './inventory.js';

const PRODUCTS = ['pms', 'ago'];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

export class ValidationError extends Error {
  constructor(errors) {
    super('Invalid input:\n' + errors.map((e) => `  ${e.date} ${e.field}: ${e.message}`).join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Returns a list of {date, field, message}. Empty list = input is usable. */
export function validateMonth(config, days) {
  const errors = [];
  const err = (date, field, message) => errors.push({ date, field, message });

  if (!config || typeof config !== 'object') {
    err('-', 'config', 'Missing config');
    return errors;
  }
  const method = config.costingMethod ?? 'WAC';
  if (method !== 'WAC' && method !== 'FIFO') err('-', 'costingMethod', `Unknown method "${method}"`);
  for (const p of PRODUCTS) {
    const c = config[p];
    if (!c) continue;
    const stock = c.openingStock ?? 0;
    if (!isNum(stock) || stock < 0) err('-', `${p}.openingStock`, 'Must be a number, 0 or more');
    if (stock > 0 && !isNum(c.openingCostPerLitre)) {
      err('-', `${p}.openingCostPerLitre`, 'Needed because there is opening stock in the tank');
    }
  }

  if (!Array.isArray(days) || days.length === 0) {
    err('-', 'days', 'No days to calculate');
    return errors;
  }

  const lastClose = { pms: {}, ago: {} };
  let prevDate = null;
  for (const day of days) {
    const date = day.date ?? '(no date)';
    if (!day.date) err(date, 'date', 'Missing date');
    if (prevDate && !(day.date > prevDate)) err(date, 'date', 'Dates must be in ascending order, no duplicates');
    prevDate = day.date;

    for (const key of ['expenses', 'pos', 'transfer']) {
      if (day[key] !== undefined && (!isNum(day[key]) || day[key] < 0)) err(date, key, 'Must be a number, 0 or more');
    }

    for (const p of PRODUCTS) {
      const d = day[p];
      if (!d) continue;
      if (!config[p]) {
        err(date, p, 'Product is not set up in config');
        continue;
      }
      if (!Array.isArray(d.pumps) || d.pumps.length === 0) {
        err(date, `${p}.pumps`, 'At least one pump reading is required');
      } else {
        for (const pump of d.pumps) {
          const label = `${p}.pump ${pump.id}`;
          if (!pump.id) err(date, `${p}.pumps`, 'Every pump needs an id');
          if (!isNum(pump.closing) || pump.closing < 0) {
            err(date, label, 'Closing meter is missing or invalid');
            continue;
          }
          const opening = isNum(pump.opening) ? pump.opening : lastClose[p][pump.id];
          if (!isNum(opening)) {
            err(date, label, 'No opening meter (first reading for this pump needs one)');
          } else if (pump.closing < opening) {
            err(date, label, `Closing meter ${pump.closing} is lower than opening ${opening}`);
          }
          lastClose[p][pump.id] = pump.closing;
        }
      }
      if (d.rtt !== undefined && (!isNum(d.rtt) || d.rtt < 0)) err(date, `${p}.rtt`, 'Must be a number, 0 or more');
      if (!isNum(d.closingStock) || d.closingStock < 0) err(date, `${p}.closingStock`, 'Closing stock is missing or invalid');
      if (!isNum(d.sellingPrice) || d.sellingPrice <= 0) err(date, `${p}.sellingPrice`, 'Selling price is missing or invalid');
      for (const x of d.deliveries ?? []) {
        if (!isNum(x.litres) || x.litres <= 0) err(date, `${p}.deliveries`, 'Delivery litres must be more than 0');
        if (!isNum(x.costPerLitre) || x.costPerLitre < 0) err(date, `${p}.deliveries`, 'Delivery cost per litre is missing or invalid');
      }
    }
  }
  return errors;
}

function calcProduct(p, d, cfg, st, warnings) {
  const P = p.toUpperCase();
  const inv = st.inventory;
  const openingStock = inv.litres;

  // --- meter readings -> pump sales
  let pumpTotal = 0;
  const pumps = d.pumps.map((pump) => {
    const prev = st.lastClose[pump.id];
    const opening = isNum(pump.opening) ? pump.opening : prev;
    if (isNum(pump.opening) && isNum(prev) && Math.abs(pump.opening - prev) > 0.005) {
      warnings.push(`${P} pump ${pump.id}: opening meter ${pump.opening} differs from yesterday's closing ${prev}`);
    }
    st.lastClose[pump.id] = pump.closing;
    const sales = pump.closing - opening;
    pumpTotal += sales;
    return { id: pump.id, opening, closing: pump.closing, sales };
  });
  const rtt = d.rtt ?? 0;
  const pumpSales = pumpTotal - rtt;

  // --- stock: deliveries are blended in before the day's sales are taken out
  const deliveries = d.deliveries ?? [];
  for (const x of deliveries) inv.receive(x.litres, x.costPerLitre);
  const received = sum(deliveries, (x) => x.litres);

  let tankSales = openingStock + received - d.closingStock;
  if (tankSales < -EPS) {
    warnings.push(
      `${P}: closing stock ${d.closingStock} L is higher than opening + deliveries (${openingStock + received} L). ` +
        'Check the dip or whether a delivery was not recorded.'
    );
    inv.receive(-tankSales, inv.averageCost ?? st.replacement ?? 0);
    tankSales = 0;
  }

  const costOfGoodsSold = inv.consume(tankSales);
  const unitCost = tankSales > EPS ? costOfGoodsSold / tankSales : inv.averageCost ?? st.replacement ?? 0;

  // --- tolerance (pump litres vs tank litres)
  const rate = d.toleranceRate ?? cfg.toleranceRate ?? 0;
  const actualTolerance = pumpSales - tankSales;
  const expectedTolerance = rate * tankSales;
  const toleranceVariance = actualTolerance - expectedTolerance;

  // --- profit
  const revenue = pumpSales * d.sellingPrice;
  const profit = revenue - costOfGoodsSold;
  const priceMargin = tankSales * (d.sellingPrice - unitCost); // the sheet's PRICE MARGIN
  const toleranceMargin = actualTolerance * d.sellingPrice; //     the sheet's TOLERANT MARGIN

  // --- price-change gain / loss
  if (isNum(d.replacementCost)) st.replacement = d.replacementCost;
  else if (deliveries.length) st.replacement = deliveries[deliveries.length - 1].costPerLitre;
  const replacementCost = st.replacement ?? unitCost;
  const priceChangeGain = tankSales * (replacementCost - unitCost);

  return {
    pumps,
    rtt,
    pumpSales,
    openingStock,
    received,
    closingStock: d.closingStock,
    tankSales,
    actualTolerance,
    expectedTolerance,
    toleranceVariance,
    sellingPrice: d.sellingPrice,
    unitCost,
    replacementCost,
    revenue,
    costOfGoodsSold,
    priceMargin,
    toleranceMargin,
    profit,
    priceChangeGain,
    normalProfit: profit - priceChangeGain,
    stockAverageCost: inv.averageCost,
    stockValue: inv.value,
  };
}

/**
 * @returns {{ days: object[], summary: object }}
 * @throws {ValidationError}
 */
export function calculateMonth(config, days) {
  const errors = validateMonth(config, days);
  if (errors.length) throw new ValidationError(errors);

  const method = config.costingMethod ?? 'WAC';
  const state = {};
  for (const p of PRODUCTS) {
    const c = config[p];
    if (!c) continue;
    state[p] = {
      inventory: new Inventory(method, { litres: c.openingStock ?? 0, costPerLitre: c.openingCostPerLitre }),
      lastClose: {},
      replacement: c.openingCostPerLitre ?? null,
    };
  }

  let cumulativeCashToLodge = 0;
  const results = days.map((day) => {
    const warnings = [];
    const r = { date: day.date };
    for (const p of PRODUCTS) {
      if (day[p]) r[p] = calcProduct(p, day[p], config[p], state[p], warnings);
    }

    // --- banking (money side of the day)
    const expectedCash = sum(PRODUCTS, (p) => r[p]?.revenue ?? 0);
    const expenses = day.expenses ?? 0;
    const pos = day.pos ?? 0;
    const transfer = day.transfer ?? 0;
    const cashToLodge = expectedCash - expenses - pos - transfer;
    cumulativeCashToLodge += cashToLodge;
    r.banking = {
      expectedCash,
      expenses,
      pos,
      transfer,
      cashToLodge,
      totalInBank: pos + transfer + cashToLodge,
      cumulativeCashToLodge,
      moniepointDeclared: day.moniepointDeclared ?? null,
      moniepointDiff: isNum(day.moniepointDeclared) ? day.moniepointDeclared - pos : null,
    };

    r.profit = sum(PRODUCTS, (p) => r[p]?.profit ?? 0);
    r.priceChangeGain = sum(PRODUCTS, (p) => r[p]?.priceChangeGain ?? 0);
    r.warnings = warnings;
    return r;
  });

  return { days: results, summary: summarise(config, results) };
}

export function summarise(config, results) {
  const products = {};
  for (const p of PRODUCTS) {
    const rows = results.filter((r) => r[p]).map((r) => r[p]);
    if (rows.length === 0) continue;
    const total = (key) => sum(rows, (x) => x[key]);
    const last = rows[rows.length - 1];
    products[p] = {
      pumpLitres: total('pumpSales'),
      tankLitres: total('tankSales'),
      actualTolerance: total('actualTolerance'),
      expectedTolerance: total('expectedTolerance'),
      toleranceVariance: total('toleranceVariance'),
      revenue: total('revenue'),
      costOfGoodsSold: total('costOfGoodsSold'),
      priceMargin: total('priceMargin'),
      toleranceMargin: total('toleranceMargin'),
      profit: total('profit'),
      priceChangeGain: total('priceChangeGain'),
      closingStockLitres: last.closingStock,
      closingStockValue: last.stockValue,
    };
  }

  const adjustments = config.adjustments ?? [];
  const totalSales = sum(Object.values(products), (x) => x.revenue);
  const profitBeforeExpenses = sum(Object.values(products), (x) => x.profit); // sheet: "Net Profit"
  const expenses = sum(results, (r) => r.banking.expenses);
  const adjustmentsTotal = sum(adjustments, (a) => a.amount);
  const priceChangeGain = sum(Object.values(products), (x) => x.priceChangeGain);

  return {
    products,
    totalSales,
    profitBeforeExpenses,
    expenses,
    adjustments,
    totalExpenses: expenses + adjustmentsTotal,
    profitAfterExpenses: profitBeforeExpenses - expenses - adjustmentsTotal, // sheet: "Gross Profit"
    priceChangeGain,
    normalProfit: profitBeforeExpenses - priceChangeGain,
  };
}
