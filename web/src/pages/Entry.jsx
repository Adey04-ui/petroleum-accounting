import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, NetworkError } from '../api.js';
import { kvGet, kvSet, outboxGet, outboxDelete, outboxKey } from '../offline.js';
import { queueDay, syncNow } from '../sync.js';
import { blankForm, hydrateForm, serializeForm, previewDay, nextContext, productsOf } from '../entryForm.js';
import { Field, Select, Stat, Switch, ErrorBox, tone } from '../ui.jsx';
import { naira, litres, num, todayLocal, PRODUCT_NAMES } from '../format.js';
import { haptic } from '../motion.js';
import DayResult from './DayResult.jsx';

const patchAt = (arr, i, patch) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
const dropAt = (arr, i) => arr.filter((_, j) => j !== i);

export default function Entry({ meta, initialDate }) {
  const sid = meta.station.id;
  const uid = meta.user.id;
  const perm = meta.permissions;
  const owner = perm.seeCost;
  const products = productsOf(meta);

  const [date, setDate] = useState(initialDate ?? todayLocal());
  const [ctx, setCtx] = useState(null);
  const [form, setForm] = useState(null);
  const [queued, setQueued] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [dateChecking, setDateChecking] = useState(false);
  const [dateReady, setDateReady] = useState(false);
  const dateRequest = useRef(0);

  useEffect(() => {
    let live = true;
    const requestId = ++dateRequest.current;
    setDateChecking(true);
    setDateReady(false);
    setError(null);
    setConflict(null);
    (async () => {
      const q = await outboxGet(outboxKey(sid, date));
      let c;
      try {
        c = await api.getDay(date);
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        // Offline fallback is only safe for a future, unsaved date whose previous context is known locally.
        const known = await kvGet(`ctx:${sid}`);
        if (!known || date <= known.asOf) throw new Error('You are offline and this day could not be verified on this phone. Your current form has been preserved.');
        c = { date, entry: null, version: 0, previous: known.previous, result: null, offline: true };
      }
      if (!live || requestId !== dateRequest.current) return;
      if (!c.entry && !c.offline) await kvSet(`ctx:${sid}`, { asOf: c.previous.date ?? '0000-00-00', previous: c.previous });
      setCtx(c);
      setQueued(q ?? null);
      // Empty destination: keep the form exactly as the user left it. Saved/outbox destination: load its data.
      if (c.entry || q || !form) setForm(hydrateForm(meta, c, q ? q.body : c.entry));
      setDateReady(true);
    })()
      .catch((e) => {
        if (live && requestId === dateRequest.current) setError(e);
      })
      .finally(() => {
        if (live && requestId === dateRequest.current) setDateChecking(false);
      });
    return () => {
      live = false;
    };
  }, [date, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => (form && ctx ? previewDay(meta, ctx, form) : null), [form, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !dateChecking && Boolean(ctx?.entry) && !perm.editExistingDays;

  const changeDate = (nextDate) => {
    if (!nextDate || nextDate === date) return;
    setDateReady(false);
    setDateChecking(true);
    setDate(nextDate);
    setSaved(null);
  };

  const setProd = (p, patch) => setForm((f) => ({ ...f, [p]: { ...f[p], ...patch } }));
  const setPump = (p, id, patch) => setForm((f) => ({ ...f, [p]: { ...f[p], pumps: { ...f[p].pumps, [id]: { ...f[p].pumps[id], ...patch } } } }));
  const setTop = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save(e) {
    e.preventDefault();
    if (!dateReady || dateChecking || busy) return;
    if (!window.confirm(`Are you sure you want to save this data for ${date}?`)) return;
    setBusy(true);
    setError(null);
    setConflict(null);
    setSaved(null);
    const body = serializeForm(meta, ctx, form, { owner });
    const baseVersion = ctx.version;
    const key = outboxKey(sid, date);
    try {
      const r = await api.saveDay(date, { ...body, baseVersion });
      await outboxDelete(key);
      await kvSet(`ctx:${sid}`, nextContext(meta, ctx, date, form));
      haptic(10);
      setSaved({ day: r.day });
      setTick((t) => t + 1);
    } catch (err) {
      if (err instanceof NetworkError) {
        // No signal: keep it on this phone. It uploads by itself when the signal is back.
        await queueDay({ userId: uid, stationId: sid, date, body, baseVersion });
        await kvSet(`ctx:${sid}`, nextContext(meta, ctx, date, form));
        haptic(10);
        setSaved({ queued: true });
        setQueued(await outboxGet(key));
        syncNow(uid);
      } else if (err.code === 'CONFLICT') {
        setConflict(err.data);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const deletingDate = date;
    if (!window.confirm(`Delete the entry for ${deletingDate}? Its sales will roll into the next day's meter readings.`)) return;
    setBusy(true);
    try {
      await api.deleteDay(deletingDate);
      setForm(null);
      setCtx(null);
      setQueued(null);
      setSaved(null);
      setTick((t) => t + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <Field label="Date" type="date" value={date} onChange={changeDate} disabled={busy} />
        {dateChecking && <p className="footnote" style={{ margin: '0.5rem 0 0' }}>Checking selected date…</p>}
        {ctx?.offline && <p className="footnote" style={{ margin: '0.5rem 0 0' }}>You are offline. Days you save are kept on this phone and upload when the signal is back.</p>}
      </div>

      {!form && !error && <div className="muted">Loading…</div>}
      {!form && <ErrorBox error={error} />}

      {form && locked && (
        <>
          <div className="msg ok">This day is saved. Only the owner can change it. If something is wrong, ask the owner to correct it.</div>
          {ctx.result && <DayResult day={ctx.result} />}
        </>
      )}

      {form && !locked && (
        <form onSubmit={save}>
          <fieldset disabled={dateChecking || busy} className="entry-fields">
          {queued && (
            <div className={`msg ${queued.status === 'pending' ? 'warn' : 'error'}`}>
              {queued.status === 'pending' && 'This day is saved on this phone and waiting to upload.'}
              {queued.status === 'conflict' && `Someone else changed this day. ${queued.message ?? ''} Open the sync list to choose.`}
              {queued.status === 'rejected' && `The server did not accept this day: ${queued.message ?? ''} Fix it below and save again.`}
            </div>
          )}
          {ctx.entry && owner && <div className="msg warn">You are changing a saved day. Everything after it is recalculated.</div>}

          {products.map((p) => {
            const m = meta.products[p];
            const f = form[p];
            const pv = preview?.products[p];
            const prev = ctx.previous?.[p];
            const multiTank = m.tanks.length > 1;
            const tankOptions = m.tanks.map((t) => ({ value: t.id, label: t.name }));
            return (
              <div className="card" key={p}>
                <h2>{PRODUCT_NAMES[p]}</h2>

                <h3>Pumps</h3>
                {m.pumps.map((id, i) => {
                  const x = f.pumps[id];
                  const before = prev?.pumpClose?.[id];
                  const known = before !== null && before !== undefined;
                  const sold = pv?.pumps[i];
                  return (
                    <div className="pump" key={id}>
                      <div className="head">
                        <span>Pump {id}</span>
                        <span className="row">
                          <small>Not used today</small>
                          <Switch checked={x.idle} onChange={(v) => setPump(p, id, { idle: v })} label={`Pump ${id} not used today`} />
                        </span>
                      </div>
                      {!x.idle && (
                        <div className="grid3">
                          {known ? <Field label="Opening" value={num(before)} readOnly aria-label={`Pump ${id} opening`} /> : <Field label="Opening" type="number" value={x.opening} onChange={(v) => setPump(p, id, { opening: v })} aria-label={`Pump ${id} opening`} />}
                          <Field label="Closing" type="number" value={x.closing} onChange={(v) => setPump(p, id, { closing: v })} aria-label={`Pump ${id} closing`} hint={sold?.ok ? `Sold: ${litres(sold.sold)}` : undefined} />
                          <Field label="Returned to tank (L)" type="number" value={x.rtt} onChange={(v) => setPump(p, id, { rtt: v })} aria-label={`Pump ${id} returned to tank`} />
                        </div>
                      )}
                    </div>
                  );
                })}

                <h3>Price</h3>
                <Field label="Selling price (₦/L)" type="number" value={f.sellingPrice} onChange={(v) => setProd(p, { sellingPrice: v })} />

                <h3>{multiTank ? 'Tanks' : 'Tank'}</h3>
                {m.tanks.map((t) => (
                  <div key={t.id} style={{ marginBottom: '0.5rem' }}>
                    <Field
                      label={`${t.name}: dip now (L)`}
                      type="number"
                      value={f.tanks[t.id]}
                      onChange={(v) => setProd(p, { tanks: { ...f.tanks, [t.id]: v } })}
                      hint={`Opening ${litres(prev?.tankClose?.[t.id])}`}
                      aria-label={`${t.name} dip`}
                    />
                  </div>
                ))}

                {perm.enterDeliveries && (
                  <>
                    <h3>Received today</h3>
                    {f.deliveries.map((d, i) => (
                      <div className={`line ${multiTank && owner ? 'four' : multiTank || owner ? 'three' : ''}`} key={i}>
                        <Field label="Litres" type="number" value={d.litres} onChange={(v) => setProd(p, { deliveries: patchAt(f.deliveries, i, { litres: v }) })} aria-label="Delivery litres" />
                        {multiTank && <Select label="Into tank" value={d.tankId} options={tankOptions} onChange={(v) => setProd(p, { deliveries: patchAt(f.deliveries, i, { tankId: v }) })} />}
                        {owner && <Field label="Cost (₦/L)" type="number" value={d.costPerLitre} onChange={(v) => setProd(p, { deliveries: patchAt(f.deliveries, i, { costPerLitre: v }) })} />}
                        <button type="button" className="linkbtn" onClick={() => setProd(p, { deliveries: dropAt(f.deliveries, i) })}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn ghost small" onClick={() => setProd(p, { deliveries: [...f.deliveries, { litres: '', costPerLitre: '', tankId: m.tanks[0].id }] })}>+ Add delivery</button>
                    {!owner && <p className="footnote">The owner fills in the cost price of deliveries.</p>}
                  </>
                )}

                <h3>Fuel moved, not sold</h3>
                {f.transfers.map((x, i) => (
                  <div className={`line ${multiTank ? 'four' : 'three'}`} key={i}>
                    <Field label="Litres" type="number" value={x.litres} onChange={(v) => setProd(p, { transfers: patchAt(f.transfers, i, { litres: v }) })} aria-label="Transfer litres" />
                    {multiTank && <Select label="From" value={x.fromTankId} options={tankOptions} onChange={(v) => setProd(p, { transfers: patchAt(f.transfers, i, { fromTankId: v }) })} />}
                    <Select
                      label="To"
                      value={x.toTankId}
                      options={[{ value: '', label: 'Out of the station' }, ...tankOptions.filter((t) => t.value !== x.fromTankId)]}
                      onChange={(v) => setProd(p, { transfers: patchAt(f.transfers, i, { toTankId: v }) })}
                    />
                    <button type="button" className="linkbtn" onClick={() => setProd(p, { transfers: dropAt(f.transfers, i) })}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn ghost small" onClick={() => setProd(p, { transfers: [...f.transfers, { litres: '', fromTankId: m.tanks[0].id, toTankId: '', note: '' }] })}>+ Add transfer</button>
                <p className="footnote">Use this when fuel left a tank without being sold: moved to another tank, sent to another station, or used by you.</p>

                {owner && (
                  <>
                    <h3>Owner only</h3>
                    <div className="grid2">
                      <Field label="Replacement cost today (₦/L)" type="number" value={f.replacementCost} onChange={(v) => setProd(p, { replacementCost: v })} hint="Leave empty to use your latest delivery's cost." />
                      <Field label="Allowed tolerance, this day only (L per 20 L)" type="number" value={f.tolerancePer20} onChange={(v) => setProd(p, { tolerancePer20: v })} hint={`Empty = the station's ${+(m.toleranceRate * 20).toFixed(4)}`} />
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div className="card">
            <h2>Money</h2>
            {meta.carryBalance && <Stat label="Previous balance (carried forward)" value={naira(ctx.previous?.balance ?? 0)} />}
            <h3>Paid by card, POS or transfer</h3>
            {form.payments.map((l, i) => {
              const isPos = /pos/i.test(l.label);
              return (
                <div className="line" key={i}>
                  <div className={isPos ? 'grid2' : undefined}>
                    <Field label={l.label || 'Name'} type="number" value={l.amount} onChange={(v) => setTop({ payments: patchAt(form.payments, i, { amount: v }) })} aria-label={l.label || 'Payment'} />
                    {isPos && <Field label={`${l.label} declared (₦)`} type="number" value={l.declaration ?? ''} onChange={(v) => setTop({ payments: patchAt(form.payments, i, { declaration: v }) })} aria-label={`${l.label} declaration`} />}
                  </div>
                  {!(meta.paymentChannels ?? []).includes(l.label) && <button type="button" className="linkbtn" onClick={() => setTop({ payments: dropAt(form.payments, i) })}>Remove</button>}
                </div>
              );
            })}
            <button type="button" className="btn ghost small" onClick={() => { const label = window.prompt('Name of this payment (for example OPay POS for a POS channel):'); if (label?.trim()) setTop({ payments: [...form.payments, { label: label.trim(), amount: '', declaration: '' }] }); }}>+ Another payment type</button>

            <h3>Credit and banking</h3>
            <div className="grid3">
              <Field label="Credit sales (₦)" type="number" value={form.creditSales} onChange={(v) => setTop({ creditSales: v })} hint="Sold, not yet paid" />
              <Field label="Credit paid back (₦)" type="number" value={form.creditReceived} onChange={(v) => setTop({ creditReceived: v })} />
              <Field label="Banked today (₦)" type="number" value={form.banked} onChange={(v) => setTop({ banked: v })} hint="Cash taken to the bank" />
            </div>

            <h3>Expenses</h3>
            {form.expenses.map((l, i) => (
              <div className="line three" key={i}>
                <Field label="What for" value={l.label} onChange={(v) => setTop({ expenses: patchAt(form.expenses, i, { label: v }) })} aria-label="Expense name" />
                <Field label="Amount (₦)" type="number" value={l.amount} onChange={(v) => setTop({ expenses: patchAt(form.expenses, i, { amount: v }) })} aria-label="Expense amount" />
                <button type="button" className="linkbtn" onClick={() => setTop({ expenses: form.expenses.length > 1 ? dropAt(form.expenses, i) : [{ label: '', amount: '' }] })}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setTop({ expenses: [...form.expenses, { label: '', amount: '' }] })}>+ Add expense</button>

          </div>

          {preview && (
            <div className="card live">
              <h2>Check before saving</h2>
              {products.map((p) => {
                const v = preview.products[p];
                return (
                  <div key={p}>
                    <h3>{PRODUCT_NAMES[p]}</h3>
                    <Stat label="Pump sales" value={litres(v.pumpSales)} />
                    <Stat label="Tank sales" value={v.complete ? litres(v.tankSales) : '–'} />
                    <Stat label="Variance (actual − expected)" value={v.complete ? litres(v.toleranceVariance) : '–'} tone={v.complete ? tone(v.toleranceVariance) : undefined} />
                    <Stat label="Sales value" value={naira(v.revenue)} />
                  </div>
                );
              })}
              <h3>Cash</h3>
              <Stat label="Available balance" value={naira(preview.banking.availableBalance)} tone={tone(preview.banking.availableBalance)} />
              {preview.banking.posLabels.length > 0 && (
                <>
                  <Stat label="Total POS sales" value={naira(preview.banking.posTotal)} />
                  <Stat label="Total POS declared" value={naira(preview.banking.posDeclared)} />
                  <Stat label="POS charges" value={preview.banking.posDeclarationsComplete ? naira(preview.banking.posCharges) : 'Incomplete — declarations missing'} />
                </>
              )}
            </div>
          )}

          {conflict && (
            <div className="msg error banner">
              <span>Someone else changed this day while you were working. Load the latest, then make your change again.</span>
              <button type="button" className="btn small" onClick={() => setTick((t) => t + 1)}>Load latest</button>
            </div>
          )}
          <ErrorBox error={error} />
          {saved?.queued && <div className="msg warn">Saved on this phone. It will upload by itself when you are back online.</div>}
          {saved?.day && <div className="msg ok">Saved.</div>}

          <div className="actionbar">
            <button className="btn" disabled={busy || dateChecking || !dateReady}>{busy ? 'Saving…' : ctx.entry ? 'Update day' : 'Save day'}</button>
            {perm.admin && ctx.entry && <button type="button" className="btn ghost danger" onClick={remove}>Delete day</button>}
          </div>
          </fieldset>
        </form>
      )}

      {saved?.day && !locked && ctx?.result && owner && <DayResult day={saved.day} />}
    </div>
  );
}
