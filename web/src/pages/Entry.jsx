import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Stat, ErrorBox, tone } from '../ui.jsx';
import { naira, litres, num, todayLocal, PRODUCT_NAMES } from '../format.js';
import { haptic } from '../motion.js';

function blankProduct(pumps, prev, saved) {
  return {
    pumps: Object.fromEntries(
      pumps.map((id) => {
        const sp = saved?.pumps?.find((x) => x.id === id);
        return [id, { opening: sp?.opening ?? '', closing: sp?.closing ?? '' }];
      })
    ),
    rtt: saved?.rtt ?? '',
    closingStock: saved?.closingStock ?? '',
    sellingPrice: saved?.sellingPrice ?? prev?.sellingPrice ?? '',
    replacementCost: saved?.replacementCost ?? '',
    deliveries: (saved?.deliveries ?? []).map((d) => ({ litres: d.litres, costPerLitre: d.costPerLitre ?? '' })),
  };
}

const n = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

export default function Entry({ meta }) {
  const [date, setDate] = useState(todayLocal());
  const [ctx, setCtx] = useState(null);
  const [form, setForm] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);
  const products = Object.keys(meta.products);
  const perm = meta.permissions;

  useEffect(() => {
    let live = true;
    setForm(null);
    setResult(null);
    setError(null);
    setSaved(false);
    api
      .getDay(date)
      .then((c) => {
        if (!live) return;
        setCtx(c);
        const f = {
          expenses: c.entry?.expenses ?? '',
          pos: c.entry?.pos ?? '',
          transfer: c.entry?.transfer ?? '',
          moniepointDeclared: c.entry?.moniepointDeclared ?? '',
        };
        for (const p of products) f[p] = blankProduct(meta.products[p].pumps, c.previous[p], c.entry?.[p]);
        setForm(f);
        setResult(c.result);
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [date, tick]);

  const setTop = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));
  const setProd = (p, patch) => setForm((f) => ({ ...f, [p]: { ...f[p], ...patch } }));
  const setPump = (p, id, patch) =>
    setForm((f) => ({ ...f, [p]: { ...f[p], pumps: { ...f[p].pumps, [id]: { ...f[p].pumps[id], ...patch } } } }));
  const setDelivery = (p, i, patch) =>
    setForm((f) => ({
      ...f,
      [p]: { ...f[p], deliveries: f[p].deliveries.map((d, j) => (j === i ? { ...d, ...patch } : d)) },
    }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = { expenses: form.expenses, pos: form.pos, transfer: form.transfer, moniepointDeclared: form.moniepointDeclared };
      for (const p of products) {
        const prev = ctx.previous[p];
        const f = form[p];
        body[p] = {
          pumps: meta.products[p].pumps.map((id) => ({
            id,
            opening: prev?.pumpClose?.[id] == null ? f.pumps[id].opening : '',
            closing: f.pumps[id].closing,
          })),
          rtt: f.rtt,
          closingStock: f.closingStock,
          sellingPrice: f.sellingPrice,
          replacementCost: f.replacementCost,
          deliveries: f.deliveries,
        };
      }
      const r = await api.saveDay(date, body);
      setResult(r.day);
      setSaved(true);
      haptic(10);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the entry for ${date}? Its sales will roll into the next day's meter readings.`)) return;
    try {
      await api.deleteDay(date);
      setTick((t) => t + 1);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="card">
        <Field label="Date" type="date" value={date} onChange={(v) => v && setDate(v)} />
        {ctx?.entry && <p className="muted" style={{ margin: '8px 0 0' }}>An entry already exists for this day. Saving will update it.</p>}
      </div>

      {!form && !error && <div className="muted">Loading…</div>}
      {!form && <ErrorBox error={error} />}

      {form &&
        products.map((p) => {
          const prev = ctx.previous[p];
          const f = form[p];
          const openingStock = prev?.closingStock ?? meta.products[p].openingStock;
          const received = f.deliveries.reduce((s, d) => s + (n(d.litres) || 0), 0);
          const tankSales = openingStock + received - n(f.closingStock);
          return (
            <div className="card" key={p}>
              <h2>{PRODUCT_NAMES[p]}</h2>

              <h3>Meter readings</h3>
              {meta.products[p].pumps.map((id) => {
                const prevClose = prev?.pumpClose?.[id];
                const opening = prevClose == null ? n(f.pumps[id].opening) : prevClose;
                const sold = n(f.pumps[id].closing) - opening;
                return (
                  <div className="grid2" key={id} style={{ marginBottom: 8 }}>
                    {prevClose == null ? (
                      <Field label={`Pump ${id} opening`} type="number" value={f.pumps[id].opening} onChange={(v) => setPump(p, id, { opening: v })} />
                    ) : (
                      <Field label={`Pump ${id} opening`} value={num(prevClose)} readOnly />
                    )}
                    <Field
                      label={`Pump ${id} closing`}
                      type="number"
                      value={f.pumps[id].closing}
                      onChange={(v) => setPump(p, id, { closing: v })}
                      hint={Number.isFinite(sold) ? `Sold: ${litres(sold)}` : undefined}
                    />
                  </div>
                );
              })}
              <div className="grid2">
                <Field label="Return to tank (L)" type="number" value={f.rtt} onChange={(v) => setProd(p, { rtt: v })} />
                <Field label="Selling price (₦/L)" type="number" value={f.sellingPrice} onChange={(v) => setProd(p, { sellingPrice: v })} />
              </div>

              <h3>Tank</h3>
              <div className="grid2">
                <Field label="Opening stock (L)" value={num(openingStock)} readOnly />
                <Field
                  label="Closing stock / dip (L)"
                  type="number"
                  value={f.closingStock}
                  onChange={(v) => setProd(p, { closingStock: v })}
                  hint={Number.isFinite(tankSales) ? `Tank sales: ${litres(tankSales)}` : undefined}
                />
              </div>

              {perm.enterDeliveries && (
                <>
                  <h3>Deliveries today</h3>
                  {f.deliveries.map((d, i) => (
                    <div className="row" key={i} style={{ marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <Field label="Litres" type="number" value={d.litres} onChange={(v) => setDelivery(p, i, { litres: v })} />
                      </div>
                      {perm.seeCost && (
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <Field label="Cost (₦/L)" type="number" value={d.costPerLitre} onChange={(v) => setDelivery(p, i, { costPerLitre: v })} />
                        </div>
                      )}
                      <button type="button" className="btn ghost small" onClick={() => setProd(p, { deliveries: f.deliveries.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn ghost small" onClick={() => setProd(p, { deliveries: [...f.deliveries, { litres: '', costPerLitre: '' }] })}>
                    + Add delivery
                  </button>
                  {!perm.seeCost && <p className="muted">The owner fills in the cost price of deliveries.</p>}
                </>
              )}

              {perm.seeCost && (
                <>
                  <h3>Price today</h3>
                  <Field
                    label="Replacement cost (₦/L)"
                    type="number"
                    value={f.replacementCost}
                    onChange={(v) => setProd(p, { replacementCost: v })}
                    hint="What a litre costs to buy today. Leave empty to use your latest delivery's cost."
                  />
                </>
              )}
            </div>
          );
        })}

      {form && (
        <div className="card">
          <h2>Banking</h2>
          <div className="grid3">
            <Field label="Expenses (₦)" type="number" value={form.expenses} onChange={setTop('expenses')} />
            <Field label="POS (₦)" type="number" value={form.pos} onChange={setTop('pos')} />
            <Field label="Transfer (₦)" type="number" value={form.transfer} onChange={setTop('transfer')} />
          </div>
          <div style={{ height: 10 }} />
          <Field label="Moniepoint declared (₦, optional)" type="number" value={form.moniepointDeclared} onChange={setTop('moniepointDeclared')} />
        </div>
      )}

      {form && <ErrorBox error={error} />}
      {form && (
        <div className="actionbar">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : ctx?.entry ? 'Update day' : 'Save day'}</button>
          {perm.admin && ctx?.entry && <button type="button" className="btn ghost danger" onClick={remove}>Delete day</button>}
        </div>
      )}

      {saved && <div className="msg ok">Saved.</div>}
      {result && <DayResult day={result} />}
    </form>
  );
}

export function DayResult({ day }) {
  const b = day.banking;
  return (
    <div className="card">
      <h2>Result for {day.date}</h2>
      {day.warnings?.length > 0 && (
        <div className="msg warn">
          <ul>{day.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {['pms', 'ago'].map((p) => {
        const d = day[p];
        if (!d) return null;
        return (
          <div key={p}>
            <h3>{PRODUCT_NAMES[p]}</h3>
            <Stat label="Pump sales" value={litres(d.pumpSales)} />
            <Stat label="Tank sales" value={litres(d.tankSales)} />
            <Stat label="Expected tolerance" value={litres(d.expectedTolerance)} />
            <Stat label="Actual tolerance" value={litres(d.actualTolerance)} />
            <Stat label="Variance (actual − expected)" value={litres(d.toleranceVariance)} tone={tone(d.toleranceVariance)} />
            <Stat label="Sales value" value={naira(d.revenue)} />
            {d.profit !== undefined && (
              <>
                <Stat label="Selling price" value={naira(d.sellingPrice)} />
                <Stat label="Cost price" value={naira(d.unitCost)} />
                <Stat label="Selling − cost (per litre)" value={naira(d.sellingPrice - d.unitCost)} />
                <Stat label="Price margin" value={naira(d.priceMargin)} tone={tone(d.priceMargin)} />
                <Stat label="Tolerance margin" value={naira(d.toleranceMargin)} tone={tone(d.toleranceMargin)} />
                <Stat label="Price margin + tolerance margin" value={naira(d.profit)} tone={tone(d.profit)} />
                <Stat label="of which price-change gain / loss" value={naira(d.priceChangeGain)} tone={tone(d.priceChangeGain)} />
              </>
            )}
          </div>
        );
      })}
      <h3>Banking</h3>
      <Stat label="Expected cash" value={naira(b.expectedCash)} />
      <Stat label="− Expenses" value={naira(b.expenses)} />
      <Stat label="− POS" value={naira(b.pos)} />
      <Stat label="− Transfer" value={naira(b.transfer)} />
      <Stat label="Cash to lodge" value={naira(b.cashToLodge)} tone={tone(b.cashToLodge)} />
      {b.moniepointDiff !== null && <Stat label="Moniepoint declared − POS" value={naira(b.moniepointDiff)} tone={tone(b.moniepointDiff)} />}
    </div>
  );
}
