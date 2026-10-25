// Who can do and see what. This is the ONE place to change it.
// e.g. to let managers see cost price and profit, set manager.seeCost = true.

export const ROLES = ['owner', 'manager', 'attendant'];

// editExistingDays: may change a day that has already been saved. Staff can only add a NEW day; once it is saved,
// only an owner can correct it (and only an owner can set a day's own tolerance allowance).
export const PERMISSIONS = {
  attendant: { enterDays: true, enterDeliveries: false, editExistingDays: false, seeCost: false, admin: false },
  manager: { enterDays: true, enterDeliveries: true, editExistingDays: false, seeCost: false, admin: false },
  owner: { enterDays: true, enterDeliveries: true, editExistingDays: true, seeCost: true, admin: true },
};

export const can = (role, what) => Boolean(PERMISSIONS[role]?.[what]);

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

const PRODUCT_COST_FIELDS = [
  'transferCost', 'unitCost', 'replacementCost', 'costOfGoodsSold', 'priceMargin', 'toleranceMargin',
  'profit', 'priceChangeGain', 'normalProfit', 'stockAverageCost', 'stockValue',
];
const SUMMARY_PRODUCT_COST_FIELDS = [
  'transferCost', 'costOfGoodsSold', 'priceMargin', 'toleranceMargin', 'profit', 'priceChangeGain', 'closingStockValue',
];
const SUMMARY_COST_FIELDS = [
  'profitBeforeExpenses', 'adjustments', 'totalExpenses', 'profitAfterExpenses', 'priceChangeGain', 'normalProfit',
];

/** Remove cost/profit figures from one calculated day for roles that may not see them. */
export function redactDay(day, role) {
  if (!day || can(role, 'seeCost')) return day;
  const out = omit(day, ['profit', 'priceChangeGain']);
  for (const p of ['pms', 'ago']) if (out[p]) out[p] = omit(out[p], PRODUCT_COST_FIELDS);
  return out;
}

export function redactSummary(summary, role) {
  if (!summary || can(role, 'seeCost')) return summary;
  const out = omit(summary, SUMMARY_COST_FIELDS);
  out.products = Object.fromEntries(
    Object.entries(summary.products).map(([p, v]) => [p, omit(v, SUMMARY_PRODUCT_COST_FIELDS)])
  );
  return out;
}

/** Remove cost inputs from a stored day entry (for roles that may not see them). */
export function redactEntry(entry, role) {
  if (!entry || can(role, 'seeCost')) return entry;
  const out = { ...entry };
  for (const p of ['pms', 'ago']) {
    if (!out[p]) continue;
    out[p] = {
      ...omit(out[p], ['replacementCost']),
      deliveries: (out[p].deliveries ?? []).map((d) => omit(d, ['costPerLitre'])),
    };
  }
  return out;
}
