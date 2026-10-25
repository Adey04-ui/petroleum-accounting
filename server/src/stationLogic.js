// Per-station calculation helpers (input cleaning, cost-price fill-in, running the engine).
import { calculateMonth, validateMonth } from './engine/index.js';
import { HttpError, isNum, toNum } from './http.js';

export const PRODUCTS = ['pms', 'ago'];

const idOf = (v) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim());

function cleanLines(arr, what) {
  if (!Array.isArray(arr)) return undefined;
  return arr
    .filter((l) => l && toNum(l.amount, `${what} amount`) !== undefined)
    .map((l) => ({ label: String(l.label ?? '').trim().slice(0, 60) || what, amount: toNum(l.amount, `${what} amount`) }));
}

function sanitizeProduct(p, key) {
  if (!p) return undefined;
  const closings =
    p.tankClosings && typeof p.tankClosings === 'object'
      ? Object.fromEntries(Object.entries(p.tankClosings).map(([id, v]) => [id, toNum(v, `${key} dip`)]).filter(([, v]) => v !== undefined))
      : undefined;
  return {
    pumps: (p.pumps ?? []).map((x, i) => {
      const idle = x.idle === true;
      return {
        id: String(x.id ?? ''),
        idle: idle || undefined,
        opening: idle ? undefined : toNum(x.opening, `${key} pump ${i + 1} opening`),
        closing: idle ? undefined : toNum(x.closing, `${key} pump ${x.id} closing`),
        rtt: idle ? undefined : toNum(x.rtt, `${key} pump ${x.id} return to tank`),
      };
    }),
    rtt: toNum(p.rtt, `${key} return to tank`),
    tankClosings: closings,
    closingStock: closings ? undefined : toNum(p.closingStock, `${key} closing stock`),
    sellingPrice: toNum(p.sellingPrice, `${key} selling price`),
    replacementCost: toNum(p.replacementCost, `${key} replacement cost`),
    toleranceRate: toNum(p.toleranceRate, `${key} tolerance`),
    deliveries: (p.deliveries ?? [])
      .filter((d) => d && toNum(d.litres, `${key} delivery litres`) !== undefined)
      .map((d) => ({
        litres: toNum(d.litres, `${key} delivery litres`),
        costPerLitre: toNum(d.costPerLitre, `${key} delivery cost`) ?? null,
        tankId: idOf(d.tankId),
      })),
    transfers: (p.transfers ?? [])
      .filter((x) => x && toNum(x.litres, `${key} transfer litres`) !== undefined)
      .map((x) => ({
        litres: toNum(x.litres, `${key} transfer litres`),
        fromTankId: idOf(x.fromTankId),
        toTankId: idOf(x.toTankId),
        note: idOf(x.note)?.slice(0, 120),
      })),
  };
}

export function sanitizeDay(body) {
  const out = {
    payments: cleanLines(body.payments, 'payment'),
    expenses: Array.isArray(body.expenses) ? cleanLines(body.expenses, 'expense') : toNum(body.expenses, 'expenses'),
    pos: toNum(body.pos, 'POS'),
    transfer: toNum(body.transfer, 'transfer'),
    creditSales: toNum(body.creditSales, 'credit sales'),
    creditReceived: toNum(body.creditReceived, 'credit received'),
    banked: toNum(body.banked, 'banked'),
    moniepointDeclared: toNum(body.moniepointDeclared, 'Moniepoint declared'),
  };
  for (const p of PRODUCTS) {
    const v = sanitizeProduct(body[p], p.toUpperCase());
    if (v) out[p] = v;
  }
  return out;
}

export function sanitizeConfig(body) {
  const out = {
    costingMethod: body.costingMethod ?? 'WAC',
    carryBalance: body.carryBalance === true,
    paymentChannels: [...new Set((Array.isArray(body.paymentChannels) ? body.paymentChannels : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 12),
  };
  if (!['WAC', 'FIFO'].includes(out.costingMethod)) throw new HttpError(400, 'costingMethod must be WAC or FIFO');
  for (const p of PRODUCTS) {
    const c = body[p];
    if (!c) continue;
    const pumps = [...new Set((c.pumps ?? []).map((x) => String(x).trim()).filter(Boolean))];
    if (pumps.length === 0) throw new HttpError(400, `${p.toUpperCase()} needs at least one pump`);

    // Tanks: keep the ids the client sends (days refer to them); give new tanks a fresh id.
    const given = Array.isArray(c.tanks) && c.tanks.length > 0 ? c.tanks : [{ id: 't1', name: 'Tank 1', openingStock: c.openingStock ?? 0 }];
    const used = new Set();
    let next = 1;
    const tanks = given.map((t) => {
      let id = idOf(t.id);
      if (!id || used.has(id)) {
        while (used.has(`t${next}`)) next += 1;
        id = `t${next}`;
      }
      used.add(id);
      const name = String(t.name ?? '').trim().slice(0, 40);
      if (!name) throw new HttpError(400, `Every ${p.toUpperCase()} tank needs a name`);
      const openingStock = toNum(t.openingStock, `${name} opening stock`) ?? 0;
      if (openingStock < 0) throw new HttpError(400, `${name}: opening stock cannot be negative`);
      return { id, name, openingStock };
    });
    if (new Set(tanks.map((t) => t.name.toLowerCase())).size !== tanks.length) throw new HttpError(400, `${p.toUpperCase()} tanks must have different names`);
    if (tanks.length > 8) throw new HttpError(400, 'At most 8 tanks per product');

    const openingCostPerLitre = toNum(c.openingCostPerLitre, `${p} opening cost`);
    const toleranceRate = toNum(c.toleranceRate, `${p} tolerance`) ?? 0;
    if (tanks.some((t) => t.openingStock > 0) && openingCostPerLitre === undefined) {
      throw new HttpError(400, `${p.toUpperCase()}: opening cost per litre is needed when there is opening stock`);
    }
    if (toleranceRate < 0 || toleranceRate > 1) throw new HttpError(400, `${p} tolerance must be between 0 and 1`);
    out[p] = { pumps, tanks, openingCostPerLitre, toleranceRate };
  }
  if (!out.pms && !out.ago) throw new HttpError(400, 'Set up at least one product');
  return out;
}

/**
 * Deliveries entered without a cost price (e.g. by a manager) get the last known cost so everything else still
 * calculates. The dates are reported so the owner can fill them in.
 */
export function prepare(config, entries) {
  const missing = [];
  const last = { pms: config.pms?.openingCostPerLitre ?? null, ago: config.ago?.openingCostPerLitre ?? null };
  const days = entries.map(({ date, data }) => {
    const day = structuredClone(data);
    day.date = date;
    for (const p of PRODUCTS) {
      if (!day[p]) continue;
      day[p].deliveries = (day[p].deliveries ?? []).map((x) => {
        if (isNum(x.costPerLitre)) {
          last[p] = x.costPerLitre;
          return x;
        }
        missing.push(date);
        return { ...x, costPerLitre: last[p] ?? 0 };
      });
    }
    return day;
  });
  return { days, missing: [...new Set(missing)] };
}

export async function computeAll(store, stationId) {
  const config = await store.getSetting(stationId, 'config');
  const entries = await store.listDays(stationId);
  if (!config || entries.length === 0) return { config, results: [], missing: [] };
  const { days, missing } = prepare(config, entries);
  const { days: results } = calculateMonth(config, days);
  return { config, results, missing };
}

export function checkEntries(config, entries) {
  const { days } = prepare(config, entries);
  const errors = days.length ? validateMonth(config, days) : [];
  if (errors.length) throw new HttpError(422, 'These numbers do not add up', { errors });
}
