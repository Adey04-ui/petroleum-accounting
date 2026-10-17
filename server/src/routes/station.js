// Everything inside one station: setup, daily entry, results, Excel export.
import express from 'express';
import { summarise } from '../engine/index.js';
import { buildWorkbook } from '../exportXlsx.js';
import { HttpError, wrap, isNum, checkDate, checkMonth } from '../http.js';
import { PERMISSIONS, can, redactDay, redactSummary, redactEntry } from '../permissions.js';
import { PRODUCTS, sanitizeDay, sanitizeConfig, computeAll, checkEntries } from '../stationLogic.js';
import { needPermission } from '../middleware.js';

export function stationRoutes(store) {
  const r = express.Router({ mergeParams: true });
  const need = needPermission;

  r.get(
    '/meta',
    wrap(async (req, res) => {
      const config = await store.getSetting(req.station.id, 'config');
      const products = {};
      for (const p of PRODUCTS) {
        if (config?.[p]) products[p] = { pumps: config[p].pumps, openingStock: config[p].openingStock };
      }
      res.json({
        user: { id: req.user.id, name: req.user.name, email: req.user.email },
        role: req.role,
        permissions: PERMISSIONS[req.role],
        configured: Boolean(config),
        products,
        station: { id: req.station.id, name: req.station.name },
        organisation: { id: req.org.id, name: req.org.name },
      });
    })
  );

  // ---- station setup (owner)
  r.get('/config', need('admin'), wrap(async (req, res) => res.json({ config: await store.getSetting(req.station.id, 'config') })));

  r.put(
    '/config',
    need('admin'),
    wrap(async (req, res) => {
      const config = sanitizeConfig(req.body ?? {});
      checkEntries(config, await store.listDays(req.station.id));
      await store.setSetting(req.station.id, 'config', config);
      res.json({ config });
    })
  );

  r.get(
    '/adjustments/:month',
    need('admin'),
    wrap(async (req, res) => {
      checkMonth(req.params.month);
      res.json({ adjustments: (await store.getSetting(req.station.id, `adjustments:${req.params.month}`)) ?? [] });
    })
  );

  r.put(
    '/adjustments/:month',
    need('admin'),
    wrap(async (req, res) => {
      checkMonth(req.params.month);
      const list = (Array.isArray(req.body.adjustments) ? req.body.adjustments : [])
        .map((a) => ({ label: String(a.label ?? '').trim(), amount: a.amount === '' || a.amount == null ? undefined : Number(a.amount) }))
        .filter((a) => a.label && isNum(a.amount));
      await store.setSetting(req.station.id, `adjustments:${req.params.month}`, list);
      res.json({ adjustments: list });
    })
  );

  // ---- one day: read (with context for the form)
  r.get(
    '/days/:date',
    wrap(async (req, res) => {
      const { date } = req.params;
      checkDate(date);
      const sid = req.station.id;
      const config = await store.getSetting(sid, 'config');
      if (!config) throw new HttpError(409, 'This station has not been set up yet');

      const entries = await store.listDays(sid);
      const before = entries.filter((e) => e.date < date).reverse();
      const previous = { date: before[0]?.date ?? null };
      for (const p of PRODUCTS) {
        if (!config[p]) continue;
        previous[p] = {
          closingStock: before[0]?.data[p]?.closingStock ?? null,
          sellingPrice: before.find((e) => e.data[p]?.sellingPrice)?.data[p].sellingPrice ?? null,
          pumpClose: Object.fromEntries(
            config[p].pumps.map((id) => {
              const hit = before.find((e) => e.data[p]?.pumps?.some((x) => x.id === id && isNum(x.closing)));
              return [id, hit ? hit.data[p].pumps.find((x) => x.id === id).closing : null];
            })
          ),
        };
      }

      const entry = entries.find((e) => e.date === date)?.data ?? null;
      let result = null;
      if (entry) result = (await computeAll(store, sid)).results.find((x) => x.date === date) ?? null;
      res.json({ date, entry: redactEntry(entry, req.role), previous, result: redactDay(result, req.role) });
    })
  );

  // ---- one day: save
  r.put(
    '/days/:date',
    need('enterDays'),
    wrap(async (req, res) => {
      const { date } = req.params;
      checkDate(date);
      const sid = req.station.id;
      const role = req.role;
      const config = await store.getSetting(sid, 'config');
      if (!config) throw new HttpError(409, 'This station has not been set up yet');

      const data = sanitizeDay(req.body ?? {});
      const existing = (await store.getDay(sid, date))?.data;

      for (const p of PRODUCTS) {
        if (!data[p]) continue;
        if (!config[p]) throw new HttpError(400, `${p.toUpperCase()} is not set up for this station`);
        for (const pump of data[p].pumps) {
          if (!config[p].pumps.includes(pump.id)) throw new HttpError(400, `Unknown pump "${pump.id}" for ${p.toUpperCase()}`);
        }
        const old = existing?.[p];
        if (!can(role, 'enterDeliveries')) {
          data[p].deliveries = old?.deliveries ?? [];
        } else if (!can(role, 'seeCost')) {
          // cost prices are owner-only: keep what the owner already entered
          data[p].deliveries = data[p].deliveries.map((d) => ({
            litres: d.litres,
            costPerLitre: old?.deliveries?.find((o) => o.litres === d.litres)?.costPerLitre ?? null,
          }));
        }
        if (!can(role, 'seeCost')) data[p].replacementCost = old?.replacementCost;
      }

      const entries = (await store.listDays(sid)).filter((e) => e.date !== date);
      entries.push({ date, data });
      entries.sort((a, b) => (a.date < b.date ? -1 : 1));
      checkEntries(config, entries);

      await store.upsertDay(sid, date, data, req.user.id);
      const result = (await computeAll(store, sid)).results.find((x) => x.date === date);
      res.json({ day: redactDay(result, role), warnings: result.warnings });
    })
  );

  // ---- one day: delete (owner)
  r.delete(
    '/days/:date',
    need('admin'),
    wrap(async (req, res) => {
      const { date } = req.params;
      checkDate(date);
      const sid = req.station.id;
      const config = await store.getSetting(sid, 'config');
      const entries = (await store.listDays(sid)).filter((e) => e.date !== date);
      if (config) checkEntries(config, entries);
      await store.deleteDay(sid, date);
      res.json({ ok: true });
    })
  );

  // ---- a month of results
  r.get(
    '/days',
    wrap(async (req, res) => {
      const month = req.query.month ?? new Date().toISOString().slice(0, 7);
      checkMonth(month);
      const role = req.role;
      const { results, missing } = await computeAll(store, req.station.id);
      const monthResults = results.filter((x) => x.date.startsWith(month));
      const adjustments = (await store.getSetting(req.station.id, `adjustments:${month}`)) ?? [];
      const summary = summarise({ adjustments }, monthResults);
      res.json({
        month,
        days: monthResults.map((x) => redactDay(x, role)),
        summary: redactSummary(summary, role),
        missingCosts: can(role, 'seeCost') ? missing.filter((d) => d.startsWith(month)) : undefined,
      });
    })
  );

  // ---- download a month as Excel (owner)
  r.get(
    '/export',
    need('admin'),
    wrap(async (req, res) => {
      const month = req.query.month ?? new Date().toISOString().slice(0, 7);
      checkMonth(month);
      const { results } = await computeAll(store, req.station.id);
      const monthResults = results.filter((x) => x.date.startsWith(month));
      if (monthResults.length === 0) throw new HttpError(404, 'There are no entries for that month');
      const adjustments = (await store.getSetting(req.station.id, `adjustments:${month}`)) ?? [];
      const summary = summarise({ adjustments }, monthResults);
      const buffer = await buildWorkbook({ month, days: monthResults, summary });
      const safe = req.station.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'station';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}-${month}.xlsx"`);
      res.send(Buffer.from(buffer));
    })
  );

  return r;
}
