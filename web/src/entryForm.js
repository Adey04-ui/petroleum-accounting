// Everything the daily entry form does with numbers, as plain functions (no screens), so it can be tested and
// can also run with no signal. The preview uses the same formulas as the server's engine for the figures staff
// are allowed to see (litres, tolerance, cash). Cost prices and profit are never calculated on the phone.

const PRODUCTS = ['pms', 'ago'];
const blank = (v) => v === '' || v === null || v === undefined;
export const toNumber = (v) => (blank(v) ? NaN : Number(v));
const n0 = (v) => (Number.isFinite(toNumber(v)) ? toNumber(v) : 0);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const per20 = (rate) => (rate === undefined || rate === null ? '' : Number((rate * 20).toFixed(4)));

export const productsOf = (meta) => PRODUCTS.filter((p) => meta.products?.[p]);

/** A fresh form for a day with nothing saved yet. */
export function blankForm(meta, ctx) {
  const form = {
    payments: (meta.paymentChannels ?? []).map((label) => ({ label, amount: '' })),
    creditSales: '',
    creditReceived: '',
    banked: '',
    expenses: [{ label: '', amount: '' }],
    moniepointDeclared: '',
  };
  for (const p of productsOf(meta)) {
    const m = meta.products[p];
    const prev = ctx?.previous?.[p];
    form[p] = {
      pumps: Object.fromEntries(m.pumps.map((id) => [id, { idle: false, opening: '', closing: '', rtt: '' }])),
      tanks: Object.fromEntries(m.tanks.map((t) => [t.id, ''])),
      deliveries: [],
      transfers: [],
      sellingPrice: prev?.sellingPrice ?? '',
      replacementCost: '',
      tolerancePer20: '',
    };
  }
  return form;
}

/** A form filled in from a day that was saved earlier (or is waiting in the outbox). */
export function hydrateForm(meta, ctx, entry) {
  const form = blankForm(meta, ctx);
  if (!entry) return form;
  for (const p of productsOf(meta)) {
    const e = entry[p];
    if (!e) continue;
    const m = meta.products[p];
    const f = form[p];
    for (const id of m.pumps) {
      const x = e.pumps?.find((q) => q.id === id);
      if (x) f.pumps[id] = { idle: x.idle === true, opening: x.opening ?? '', closing: x.closing ?? '', rtt: x.rtt ?? '' };
    }
    for (const t of m.tanks) f.tanks[t.id] = e.tankClosings?.[t.id] ?? (m.tanks.length === 1 ? e.closingStock : undefined) ?? '';
    f.deliveries = (e.deliveries ?? []).map((d) => ({ litres: d.litres, costPerLitre: d.costPerLitre ?? '', tankId: d.tankId ?? m.tanks[0].id }));
    f.transfers = (e.transfers ?? []).map((x) => ({ litres: x.litres, fromTankId: x.fromTankId ?? m.tanks[0].id, toTankId: x.toTankId ?? '', note: x.note ?? '' }));
    f.sellingPrice = e.sellingPrice ?? f.sellingPrice;
    f.replacementCost = e.replacementCost ?? '';
    f.tolerancePer20 = per20(e.toleranceRate);
  }
  const lines = [...(entry.payments ?? [])];
  if (entry.pos > 0) lines.push({ label: 'POS', amount: entry.pos });
  if (entry.transfer > 0) lines.push({ label: 'Transfer', amount: entry.transfer });
  const channels = (meta.paymentChannels ?? []).map((label) => ({ label, amount: lines.find((l) => l.label === label)?.amount ?? '' }));
  const extra = lines.filter((l) => !(meta.paymentChannels ?? []).includes(l.label));
  form.payments = [...channels, ...extra];
  form.expenses = Array.isArray(entry.expenses) && entry.expenses.length ? entry.expenses.map((l) => ({ ...l })) : entry.expenses > 0 ? [{ label: 'Expenses', amount: entry.expenses }] : [{ label: '', amount: '' }];
  form.creditSales = entry.creditSales ?? '';
  form.creditReceived = entry.creditReceived ?? '';
  form.banked = entry.banked ?? '';
  form.moniepointDeclared = entry.moniepointDeclared ?? '';
  return form;
}

/** The request body for saving. `owner` unlocks the fields only an owner may set. */
export function serializeForm(meta, ctx, form, { owner = false } = {}) {
  const body = {
    payments: form.payments.filter((l) => !blank(l.amount)).map((l) => ({ label: l.label, amount: l.amount })),
    expenses: form.expenses.filter((l) => !blank(l.amount)).map((l) => ({ label: l.label, amount: l.amount })),
    creditSales: form.creditSales,
    creditReceived: form.creditReceived,
    banked: form.banked,
    moniepointDeclared: form.moniepointDeclared,
  };
  for (const p of productsOf(meta)) {
    const m = meta.products[p];
    const f = form[p];
    const prev = ctx?.previous?.[p];
    body[p] = {
      pumps: m.pumps.map((id) => {
        const x = f.pumps[id];
        if (x.idle) return { id, idle: true };
        const hasOpening = prev?.pumpClose?.[id] !== null && prev?.pumpClose?.[id] !== undefined;
        return { id, opening: hasOpening ? undefined : x.opening, closing: x.closing, rtt: x.rtt };
      }),
      tankClosings: Object.fromEntries(m.tanks.map((t) => [t.id, f.tanks[t.id]])),
      deliveries: f.deliveries.filter((d) => !blank(d.litres)).map((d) => ({ litres: d.litres, costPerLitre: owner ? d.costPerLitre : undefined, tankId: m.tanks.length > 1 ? d.tankId : undefined })),
      transfers: f.transfers
        .filter((x) => !blank(x.litres))
        .map((x) => ({ litres: x.litres, fromTankId: m.tanks.length > 1 ? x.fromTankId : undefined, toTankId: x.toTankId || undefined, note: x.note || undefined })),
      sellingPrice: f.sellingPrice,
    };
    if (owner) {
      body[p].replacementCost = f.replacementCost;
      body[p].toleranceRate = blank(f.tolerancePer20) ? undefined : toNumber(f.tolerancePer20) / 20;
    }
  }
  return body;
}

/** Live figures while typing (and the result shown when saving with no signal). Mirrors the engine. */
export function previewDay(meta, ctx, form) {
  const out = { products: {}, banking: null };
  let sales = 0;
  for (const p of productsOf(meta)) {
    const m = meta.products[p];
    const f = form[p];
    const prev = ctx?.previous?.[p];
    const pumps = m.pumps.map((id) => {
      const x = f.pumps[id];
      if (x.idle) return { id, sold: 0, idle: true };
      const opening = prev?.pumpClose?.[id] ?? toNumber(x.opening);
      const metered = toNumber(x.closing) - opening;
      return { id, sold: metered - n0(x.rtt), metered, ok: Number.isFinite(metered) };
    });
    const pumpSales = sum(pumps, (x) => (Number.isFinite(x.sold) ? x.sold : 0));
    const opening = prev?.closingStock ?? m.openingStock;
    const received = sum(f.deliveries, (d) => n0(d.litres));
    const out_ = sum(f.transfers.filter((x) => !x.toTankId), (x) => n0(x.litres));
    const closings = m.tanks.map((t) => toNumber(f.tanks[t.id]));
    const complete = closings.every(Number.isFinite);
    const closing = sum(closings, (v) => (Number.isFinite(v) ? v : 0));
    const tankSales = opening + received - out_ - closing;
    const rate = blank(f.tolerancePer20) ? m.toleranceRate : toNumber(f.tolerancePer20) / 20;
    const price = n0(f.sellingPrice);
    const revenue = pumpSales * price;
    sales += revenue;
    out.products[p] = {
      pumps,
      pumpSales,
      openingStock: opening,
      received,
      transferredOut: out_,
      closingStock: closing,
      tankSales,
      complete,
      actualTolerance: pumpSales - tankSales,
      expectedTolerance: rate * tankSales,
      toleranceVariance: pumpSales - tankSales - rate * tankSales,
      revenue,
    };
  }
  const nonCash = sum(form.payments, (l) => n0(l.amount));
  const expenses = sum(form.expenses, (l) => n0(l.amount));
  const previousBalance = meta.carryBalance ? ctx?.previous?.balance ?? 0 : 0;
  const availableBalance = previousBalance + sales - nonCash - n0(form.creditSales) + n0(form.creditReceived) - expenses - n0(form.banked);
  out.banking = {
    expectedCash: sales,
    previousBalance,
    nonCash,
    creditSales: n0(form.creditSales),
    creditReceived: n0(form.creditReceived),
    banked: n0(form.banked),
    expenses,
    availableBalance,
  };
  return out;
}

/**
 * What the NEXT day's form needs to know, once this day exists (even only on this phone). Lets someone enter
 * day after day with no signal.
 */
export function nextContext(meta, ctx, date, form) {
  const preview = previewDay(meta, ctx, form);
  const previous = { date, balance: preview.banking.availableBalance };
  for (const p of productsOf(meta)) {
    const m = meta.products[p];
    const prev = ctx?.previous?.[p];
    const f = form[p];
    const tankClose = Object.fromEntries(m.tanks.map((t) => [t.id, n0(f.tanks[t.id])]));
    previous[p] = {
      tankClose,
      closingStock: sum(Object.values(tankClose), (v) => v),
      sellingPrice: blank(f.sellingPrice) ? prev?.sellingPrice ?? null : toNumber(f.sellingPrice),
      pumpClose: Object.fromEntries(
        m.pumps.map((id) => [id, !f.pumps[id].idle && Number.isFinite(toNumber(f.pumps[id].closing)) ? toNumber(f.pumps[id].closing) : prev?.pumpClose?.[id] ?? null])
      ),
    };
  }
  return { asOf: date, previous };
}
