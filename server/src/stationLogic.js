// Per-station calculation helpers (input cleaning, cost-price fill-in, running the engine).
import { calculateMonth, validateMonth } from './engine/index.js';
import { HttpError, isNum, toNum } from './http.js';

export const PRODUCTS = ['pms', 'ago'];

function sanitizeProduct(p, key) {
  if (!p) return undefined;
  return {
    pumps: (p.pumps ?? []).map((x, i) => ({
      id: String(x.id ?? ''),
      opening: toNum(x.opening, `${key} pump ${i + 1} opening`),
      closing: toNum(x.closing, `${key} pump ${x.id} closing`),
    })),
    rtt: toNum(p.rtt, `${key} return to tank`),
    closingStock: toNum(p.closingStock, `${key} closing stock`),
    sellingPrice: toNum(p.sellingPrice, `${key} selling price`),
    replacementCost: toNum(p.replacementCost, `${key} replacement cost`),
    deliveries: (p.deliveries ?? [])
      .filter((d) => d && toNum(d.litres, `${key} delivery litres`) !== undefined)
      .map((d) => ({
        litres: toNum(d.litres, `${key} delivery litres`),
        costPerLitre: toNum(d.costPerLitre, `${key} delivery cost`) ?? null,
      })),
  };
}

export function sanitizeDay(body) {
  const out = {
    expenses: toNum(body.expenses, 'expenses'),
    pos: toNum(body.pos, 'POS'),
    transfer: toNum(body.transfer, 'transfer'),
    moniepointDeclared: toNum(body.moniepointDeclared, 'Moniepoint declared'),
  };
  for (const p of PRODUCTS) {
    const v = sanitizeProduct(body[p], p.toUpperCase());
    if (v) out[p] = v;
  }
  return out;
}

export function sanitizeConfig(body) {
  const out = { costingMethod: body.costingMethod ?? 'WAC' };
  if (!['WAC', 'FIFO'].includes(out.costingMethod)) throw new HttpError(400, 'costingMethod must be WAC or FIFO');
  for (const p of PRODUCTS) {
    const c = body[p];
    if (!c) continue;
    const pumps = [...new Set((c.pumps ?? []).map((x) => String(x).trim()).filter(Boolean))];
    if (pumps.length === 0) throw new HttpError(400, `${p.toUpperCase()} needs at least one pump`);
    const openingStock = toNum(c.openingStock, `${p} opening stock`) ?? 0;
    const openingCostPerLitre = toNum(c.openingCostPerLitre, `${p} opening cost`);
    const toleranceRate = toNum(c.toleranceRate, `${p} tolerance`) ?? 0;
    if (openingStock < 0) throw new HttpError(400, `${p} opening stock cannot be negative`);
    if (openingStock > 0 && openingCostPerLitre === undefined) {
      throw new HttpError(400, `${p.toUpperCase()}: opening cost per litre is needed when there is opening stock`);
    }
    if (toleranceRate < 0 || toleranceRate > 1) throw new HttpError(400, `${p} tolerance must be between 0 and 1`);
    out[p] = { pumps, openingStock, openingCostPerLitre, toleranceRate };
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
