// Everything inside one station: setup, daily entry, results, Excel export.
import express from 'express';
import { summarise, productTanks } from '../engine/index.js';
import { buildWorkbook } from '../exportXlsx.js';
import { HttpError, wrap, isNum, toNum, checkDate, checkMonth } from '../http.js';
import { PERMISSIONS, can, redactDay, redactSummary, redactEntry } from '../permissions.js';
import { PRODUCTS, sanitizeDay, sanitizeConfig, computeAll, checkEntries } from '../stationLogic.js';
import { needPermission, EXPIRED_MESSAGE } from '../middleware.js';

export function stationRoutes(store) {
  const r = express.Router({ mergeParams: true });
  const need = needPermission;

  // Once the subscription (and its grace period) has run out, everything can be read and downloaded but nothing changed.
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.subscription === 'expired') return next(new HttpError(402, EXPIRED_MESSAGE, { code: 'SUBSCRIPTION_EXPIRED' }));
    next();
  });

  r.get(
    '/meta',
    wrap(async (req, res) => {
      const config = await store.getSetting(req.station.id, 'config');
      const products = {};
      for (const p of PRODUCTS) {
        if (!config?.[p]) continue;
        const tanks = productTanks(config[p]);
        products[p] = {
          pumps: config[p].pumps,
          tanks: tanks.map((t) => ({ id: t.id, name: t.name })),
          openingStock: tanks.reduce((s, t) => s + t.openingStock, 0),
          toleranceRate: config[p].toleranceRate ?? 0,
        };
      }
      const owner = can(req.role, 'seeCost');
      res.json({
        user: { id: req.user.id, name: req.user.name, email: req.user.email },
        role: req.role,
        permissions: PERMISSIONS[req.role],
        configured: Boolean(config),
        products,
        carryBalance: Boolean(config?.carryBalance),
        paymentChannels: config?.paymentChannels ?? [],
        station: { id: req.station.id, name: req.station.name },
        organisation: { id: req.org.id, name: req.org.name },
        subscription: { state: req.subscription, ...(owner ? { paidUntil: req.org.paidUntil ?? null, autoRenew: Boolean(req.org.autoRenewEmail) } : {}) },
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

  // ---- one day: read (with what the entry form needs from the days before it)
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
        const tanks = productTanks(config[p]);
        const last = before.find((e) => e.data[p]);
        const tankClose = Object.fromEntries(
          tanks.map((t) => {
            const d = last?.data[p];
            const v = d?.tankClosings?.[t.id] ?? (tanks.length === 1 ? d?.closingStock : undefined);
            return [t.id, isNum(v) ? v : t.openingStock];
          })
        );
        previous[p] = {
          tankClose,
          closingStock: Object.values(tankClose).reduce((s, v) => s + v, 0),
          sellingPrice: before.find((e) => e.data[p]?.sellingPrice)?.data[p].sellingPrice ?? null,
          pumpClose: Object.fromEntries(
            config[p].pumps.map((id) => {
              const hit = before.find((e) => e.data[p]?.pumps?.some((x) => x.id === id && isNum(x.closing)));
              return [id, hit ? hit.data[p].pumps.find((x) => x.id === id).closing : null];
            })
          ),
        };
      }

      const existing = entries.find((e) => e.date === date);
      const { results } = entries.length ? await computeAll(store, sid) : { results: [] };
      const result = existing ? results.find((x) => x.date === date) ?? null : null;
      if (config.carryBalance) {
        const prior = [...results].reverse().find((x) => x.date < date);
        previous.balance = prior ? prior.banking.availableBalance : 0;
      }
      const stored = existing ? await store.getDay(sid, date) : null;
      res.json({
        date,
        entry: redactEntry(existing?.data ?? null, req.role),
        version: stored?.version ?? 0,
        previous,
        result: redactDay(result, req.role),
      });
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

      const existingDay = await store.getDay(sid, date);
      // Staff can add a day; once it is saved only an owner can correct it.
      if (existingDay && !can(role, 'editExistingDays')) {
        throw new HttpError(403, 'This day has already been saved. Only the owner can change it.', { code: 'OWNER_ONLY_EDIT' });
      }

      const data = sanitizeDay(req.body ?? {});
      const baseVersion = toNum(req.body?.baseVersion, 'baseVersion');
      const existing = existingDay?.data;

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
            ...d,
            costPerLitre: old?.deliveries?.find((o) => o.litres === d.litres)?.costPerLitre ?? null,
          }));
        }
        if (!can(role, 'seeCost')) data[p].replacementCost = old?.replacementCost;
        if (!can(role, 'admin')) data[p].toleranceRate = old?.toleranceRate; // a day's own tolerance allowance is the owner's call
      }

      const entries = (await store.listDays(sid)).filter((e) => e.date !== date);
      entries.push({ date, data });
      entries.sort((a, b) => (a.date < b.date ? -1 : 1));
      checkEntries(config, entries);

      const saved = await store.saveDay(sid, date, data, req.user.id, baseVersion);
      if (saved.conflict) {
        throw new HttpError(409, 'Someone else changed this day while you were working on it.', {
          code: 'CONFLICT',
          version: saved.current?.version ?? 0,
          entry: redactEntry(saved.current?.data ?? null, role),
        });
      }
      const result = (await computeAll(store, sid)).results.find((x) => x.date === date);
      res.json({ day: redactDay(result, role), warnings: result.warnings, version: saved.version });
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
