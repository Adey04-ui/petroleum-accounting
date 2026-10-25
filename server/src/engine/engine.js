// Calculation engine for the station report: meters -> tanks -> tolerance -> cash -> profit -> summary,
// plus stock costing and price-change gain/loss. Pure functions, no UI and no database.
// Dates are 'YYYY-MM-DD' strings.
//
// CONFIG
//   {
//     costingMethod: 'WAC' | 'FIFO',
//     carryBalance: false,                      // true: yesterday's unbanked cash balance is carried into today
//     pms: {
//       openingCostPerLitre, toleranceRate,     // toleranceRate 0.04 = 0.8 L allowed per 20 L sold
//       tanks: [{ id, name, openingStock }],    // optional; without it there is one tank, 't1', holding `openingStock`
//     },
//     ago: { ... },                             // optional, same shape
//     adjustments: [{ label, amount }],         // month-level deductions
//   }
//
// DAY
//   {
//     date,
//     pms: {
//       pumps: [{ id, opening?, closing?, rtt?, idle? }], // idle: true = pump not used today. opening defaults to its last closing.
//       rtt,                                         // extra return-to-tank litres not tied to one pump (optional)
//       deliveries: [{ litres, costPerLitre, tankId? }],
//       transfers: [{ litres, fromTankId?, toTankId?, note? }],
//          // with toTankId: moved between two of this station's tanks (no effect on product totals).
//          // without it: fuel LEFT the station's stock without being sold (another station, own use...).
//       tankClosings: { [tankId]: litres },          // dip per tank at close   (or `closingStock` when there is one tank)
//       sellingPrice, replacementCost?, toleranceRate?   // toleranceRate here overrides the station's, for this day only
//     },
//     ago: { ... },
//     payments: [{ label, amount }],        // non-cash: POS, transfers (Moniepoint, Zenith...)
//     pos, transfer,                        // older single-number versions of the above (still accepted)
//     creditSales, creditReceived, banked,  // credit given today, credit paid back today, cash lodged to the bank today
//     expenses: number | [{ label, amount }],
//     moniepointDeclared?,
//   }
//
// PROFIT
//   profit = pumpSales * sellingPrice - costOfGoodsSold   (cost of the litres that left the tank by being sold)
//   priceChangeGain = tankSales * (replacementCost - unitCostOfThoseLitres);  normalProfit = profit - priceChangeGain
//   Fuel transferred out is taken out of stock at its cost, but is neither a sale nor a cost of sales.
//
// CASH
//   availableBalance = previousBalance + sales - payments(non-cash) - creditSales + creditReceived - expenses - banked

import { Inventory, EPS } from './inventory.js';

const PRODUCTS = ['pms', 'ago'];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const has = (x) => x !== undefined && x !== null;
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

export class ValidationError extends Error {
  constructor(errors) {
    super('Invalid input:\n' + errors.map((e) => `  ${e.date} ${e.field}: ${e.message}`).join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** The tanks of a product. With none configured there is one tank holding the product's opening stock. */
export function productTanks(cfg) {
  if (Array.isArray(cfg?.tanks) && cfg.tanks.length > 0) {
    return cfg.tanks.map((t) => ({ id: String(t.id), name: t.name ?? String(t.id), openingStock: t.openingStock ?? 0 }));
  }
  return [{ id: 't1', name: 'Tank 1', openingStock: cfg?.openingStock ?? 0 }];
}

/** Dips per tank for a day, from `tankClosings` or (single tank) the older `closingStock`. */
function closingsOf(d, tanks) {
  if (d.tankClosings && typeof d.tankClosings === 'object') return d.tankClosings;
  if (tanks.length === 1 && has(d.closingStock)) return { [tanks[0].id]: d.closingStock };
  return null;
}

const lines = (v, legacyLabel) => {
  if (Array.isArray(v)) return v.filter((x) => x && isNum(x.amount)).map((x) => ({ label: String(x.label ?? legacyLabel), amount: x.amount }));
  return isNum(v) && v > 0 ? [{ label: legacyLabel, amount: v }] : [];
};

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
    const tanks = productTanks(c);
    const ids = new Set();
    for (const t of tanks) {
      if (ids.has(t.id)) err('-', `${p}.tanks`, `Two tanks share the id "${t.id}"`);
      ids.add(t.id);
      if (!isNum(t.openingStock) || t.openingStock < 0) err('-', `${p}.tanks`, `${t.name}: opening stock must be a number, 0 or more`);
    }
    if (sum(tanks, (t) => t.openingStock) > 0 && !isNum(c.openingCostPerLitre)) {
      err('-', `${p}.openingCostPerLitre`, 'Needed because there is opening stock in the tanks');
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

    for (const key of ['pos', 'transfer', 'creditSales', 'creditReceived', 'banked']) {
      if (has(day[key]) && (!isNum(day[key]) || day[key] < 0)) err(date, key, 'Must be a number, 0 or more');
    }
    if (has(day.expenses) && !Array.isArray(day.expenses) && (!isNum(day.expenses) || day.expenses < 0)) err(date, 'expenses', 'Must be a number, 0 or more');
    for (const key of ['payments', 'expenses']) {
      if (Array.isArray(day[key])) for (const l of day[key]) if (!isNum(l?.amount) || l.amount < 0) err(date, key, 'Every line needs an amount of 0 or more');
    }

    for (const p of PRODUCTS) {
      const d = day[p];
      if (!d) continue;
      if (!config[p]) {
        err(date, p, 'Product is not set up in config');
        continue;
      }
      const tanks = productTanks(config[p]);
      const tankIds = new Set(tanks.map((t) => t.id));

      if (!Array.isArray(d.pumps) || d.pumps.length === 0) {
        err(date, `${p}.pumps`, 'At least one pump is required');
      } else {
        for (const pump of d.pumps) {
          const label = `${p}.pump ${pump.id}`;
          if (!pump.id) err(date, `${p}.pumps`, 'Every pump needs an id');
          if (has(pump.rtt) && (!isNum(pump.rtt) || pump.rtt < 0)) err(date, label, 'Return to tank must be a number, 0 or more');
          if (pump.idle === true) continue; // marked "not used today"
          if (!has(pump.closing)) {
            err(date, label, "Closing meter is missing. If this pump was not used today, mark it as not used.");
            continue;
          }
          if (!isNum(pump.closing) || pump.closing < 0) {
            err(date, label, 'Closing meter is invalid');
            continue;
          }
          const opening = isNum(pump.opening) ? pump.opening : lastClose[p][pump.id];
          if (!isNum(opening)) {
            err(date, label, 'No opening meter (first reading for this pump needs one)');
          } else if (pump.closing < opening) {
            err(date, label, `Closing meter ${pump.closing} is lower than opening ${opening}`);
          } else if (isNum(pump.rtt) && pump.rtt > pump.closing - opening + 0.005) {
            err(date, label, `Return to tank (${pump.rtt}) is more than the meter sales (${+(pump.closing - opening).toFixed(2)})`);
          }
          lastClose[p][pump.id] = pump.closing;
        }
      }
      if (has(d.rtt) && (!isNum(d.rtt) || d.rtt < 0)) err(date, `${p}.rtt`, 'Must be a number, 0 or more');

      const closings = closingsOf(d, tanks);
      if (!closings) {
        err(date, `${p}.tankClosings`, tanks.length > 1 ? 'Enter the dip of every tank' : 'Closing stock is missing');
      } else {
        for (const t of tanks) {
          if (!isNum(closings[t.id]) || closings[t.id] < 0) err(date, `${p}.${t.name}`, 'Closing dip is missing or invalid');
        }
      }
      if (!isNum(d.sellingPrice) || d.sellingPrice <= 0) err(date, `${p}.sellingPrice`, 'Selling price is missing or invalid');
      if (has(d.toleranceRate) && (!isNum(d.toleranceRate) || d.toleranceRate < 0 || d.toleranceRate > 1)) err(date, `${p}.toleranceRate`, 'Tolerance must be between 0 and 1');

      for (const x of d.deliveries ?? []) {
        if (!isNum(x.litres) || x.litres <= 0) err(date, `${p}.deliveries`, 'Delivery litres must be more than 0');
        if (!isNum(x.costPerLitre) || x.costPerLitre < 0) err(date, `${p}.deliveries`, 'Delivery cost per litre is missing or invalid');
        if (has(x.tankId) ? !tankIds.has(x.tankId) : tanks.length > 1) err(date, `${p}.deliveries`, 'Choose which tank the delivery went into');
      }
      for (const x of d.transfers ?? []) {
        if (!isNum(x.litres) || x.litres <= 0) err(date, `${p}.transfers`, 'Transfer litres must be more than 0');
        if (has(x.fromTankId) ? !tankIds.has(x.fromTankId) : tanks.length > 1) err(date, `${p}.transfers`, 'Choose which tank the fuel came from');
        if (has(x.toTankId) && (!tankIds.has(x.toTankId) || x.toTankId === (x.fromTankId ?? tanks[0].id))) err(date, `${p}.transfers`, 'The destination tank must be a different tank');
      }
    }
  }
  return errors;
}

function calcProduct(p, d, cfg, st, warnings) {
  const P = p.toUpperCase();
  const inv = st.inventory;
  const tanks = st.tanks;
  const only = tanks.length === 1 ? tanks[0].id : null;
  const openingStock = inv.litres;

  // --- meters -> pump sales (each pump's own return-to-tank comes off its sales)
  let pumpTotal = 0;
  let rttTotal = d.rtt ?? 0;
  const pumps = d.pumps.map((pump) => {
    const prev = st.lastClose[pump.id];
    if (pump.idle === true) return { id: pump.id, opening: prev ?? null, closing: null, rtt: 0, sales: 0, used: false };
    const opening = isNum(pump.opening) ? pump.opening : prev;
    if (isNum(pump.opening) && isNum(prev) && Math.abs(pump.opening - prev) > 0.005) {
      warnings.push(`${P} pump ${pump.id}: opening meter ${pump.opening} differs from yesterday's closing ${prev}`);
    }
    st.lastClose[pump.id] = pump.closing;
    const metered = pump.closing - opening;
    const rtt = pump.rtt ?? 0;
    pumpTotal += metered - rtt;
    rttTotal += rtt;
    return { id: pump.id, opening, closing: pump.closing, rtt, metered, sales: metered - rtt, used: true };
  });
  const pumpSales = pumpTotal - (d.rtt ?? 0);

  // --- stock movements: deliveries are blended in first, then fuel that left the station, then sales
  const deliveries = d.deliveries ?? [];
  for (const x of deliveries) inv.receive(x.litres, x.costPerLitre);
  const received = sum(deliveries, (x) => x.litres);

  const transfers = d.transfers ?? [];
  const external = transfers.filter((x) => !has(x.toTankId));
  let transferredOut = sum(external, (x) => x.litres);
  if (transferredOut > inv.litres + EPS) {
    warnings.push(`${P}: ${transferredOut} L transferred out is more than the ${+inv.litres.toFixed(2)} L in stock. Check the transfer.`);
    transferredOut = inv.litres;
  }
  const transferCost = inv.consume(transferredOut);

  // --- per-tank view (litres that left each tank: sold through pumps, plus any dip/pump difference)
  const closings = closingsOf(d, tanks);
  const tankRows = tanks.map((t) => {
    const recv = sum(deliveries.filter((x) => (x.tankId ?? only) === t.id), (x) => x.litres);
    const tIn = sum(transfers.filter((x) => x.toTankId === t.id), (x) => x.litres);
    const tOut = sum(transfers.filter((x) => (x.fromTankId ?? only) === t.id), (x) => x.litres);
    const opening = st.tankClose[t.id];
    const closing = closings[t.id];
    const litresOut = opening + recv + tIn - tOut - closing;
    if (tanks.length > 1 && litresOut < -0.5) warnings.push(`${P} ${t.name}: closing dip ${closing} L is higher than opening + deliveries (${+(opening + recv + tIn - tOut).toFixed(2)} L). Check the dip or an unrecorded delivery.`);
    st.tankClose[t.id] = closing;
    return { id: t.id, name: t.name, opening, received: recv, transferIn: tIn, transferOut: tOut, closing, litresOut };
  });
  const closingStock = sum(tankRows, (t) => t.closing);

  let tankSales = openingStock + received - transferredOut - closingStock;
  if (tankSales < -EPS) {
    warnings.push(
      `${P}: closing stock ${closingStock} L is higher than opening + deliveries (${+(openingStock + received - transferredOut).toFixed(2)} L). ` +
        'Check the dip or whether a delivery was not recorded.'
    );
    inv.receive(-tankSales, inv.averageCost ?? st.replacement ?? 0);
    tankSales = 0;
  }

  const costOfGoodsSold = inv.consume(tankSales);
  const unitCost = tankSales > EPS ? costOfGoodsSold / tankSales : inv.averageCost ?? st.replacement ?? 0;

  // --- tolerance (pump litres vs tank litres). A day can carry its own allowance (the owner sets it).
  const rate = d.toleranceRate ?? cfg.toleranceRate ?? 0;
  const actualTolerance = pumpSales - tankSales;
  const expectedTolerance = rate * tankSales;
  const toleranceVariance = actualTolerance - expectedTolerance;

  // --- profit
  const revenue = pumpSales * d.sellingPrice;
  const profit = revenue - costOfGoodsSold;
  const priceMargin = tankSales * (d.sellingPrice - unitCost);
  const toleranceMargin = actualTolerance * d.sellingPrice;

  // --- price-change gain / loss
  if (isNum(d.replacementCost)) st.replacement = d.replacementCost;
  else if (deliveries.length) st.replacement = deliveries[deliveries.length - 1].costPerLitre;
  const replacementCost = st.replacement ?? unitCost;
  const priceChangeGain = tankSales * (replacementCost - unitCost);

  return {
    pumps,
    rtt: rttTotal,
    pumpSales,
    openingStock,
    received,
    transferredOut,
    transferCost,
    closingStock,
    tanks: tankRows,
    tankSales,
    toleranceRate: rate,
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

function calcBanking(day, config, r, prevAvailable, cumulative) {
  const expectedCash = sum(PRODUCTS, (p) => r[p]?.revenue ?? 0);
  const payments = lines(day.payments, 'Payment');
  const nonCash = sum(payments, (l) => l.amount) + (day.pos ?? 0) + (day.transfer ?? 0);
  const expenseLines = lines(day.expenses, 'Expenses');
  const expenses = sum(expenseLines, (l) => l.amount);
  const creditSales = day.creditSales ?? 0;
  const creditReceived = day.creditReceived ?? 0;
  const banked = day.banked ?? 0;
  const previousBalance = config.carryBalance ? prevAvailable : 0;
  const availableBalance = previousBalance + expectedCash - nonCash - creditSales + creditReceived - expenses - banked;
  const monie = sum(payments.filter((l) => /moniepoint/i.test(l.label)), (l) => l.amount) + (day.pos ?? 0);
  return {
    expectedCash,
    previousBalance,
    payments,
    pos: day.pos ?? 0,
    transfer: day.transfer ?? 0,
    nonCash,
    creditSales,
    creditReceived,
    banked,
    expenseLines,
    expenses,
    availableBalance,
    cashToLodge: availableBalance,
    totalInBank: nonCash + availableBalance,
    cumulativeCashToLodge: config.carryBalance ? availableBalance : cumulative + availableBalance,
    moniepointDeclared: day.moniepointDeclared ?? null,
    moniepointDiff: isNum(day.moniepointDeclared) ? day.moniepointDeclared - monie : null,
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
    const tanks = productTanks(c);
    state[p] = {
      inventory: new Inventory(method, { litres: sum(tanks, (t) => t.openingStock), costPerLitre: c.openingCostPerLitre }),
      tanks,
      tankClose: Object.fromEntries(tanks.map((t) => [t.id, t.openingStock])),
      lastClose: {},
      replacement: c.openingCostPerLitre ?? null,
    };
  }

  let cumulative = 0;
  let prevAvailable = 0;
  const results = days.map((day) => {
    const warnings = [];
    const r = { date: day.date };
    for (const p of PRODUCTS) {
      if (day[p]) r[p] = calcProduct(p, day[p], config[p], state[p], warnings);
    }
    r.banking = calcBanking(day, config, r, prevAvailable, cumulative);
    cumulative = r.banking.cumulativeCashToLodge;
    prevAvailable = r.banking.availableBalance;
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
      transferredOut: total('transferredOut'),
      transferCost: total('transferCost'),
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
    creditSales: sum(results, (r) => r.banking.creditSales),
    profitBeforeExpenses,
    expenses,
    adjustments,
    totalExpenses: expenses + adjustmentsTotal,
    profitAfterExpenses: profitBeforeExpenses - expenses - adjustmentsTotal, // sheet: "Gross Profit"
    priceChangeGain,
    normalProfit: profitBeforeExpenses - priceChangeGain,
  };
}
