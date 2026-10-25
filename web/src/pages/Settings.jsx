import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, Switch } from '../ui.jsx';
import { PRODUCT_NAMES } from '../format.js';

const per20 = (rate) => Number(((rate ?? 0) * 20).toFixed(4));
const blankProduct = { enabled: false, pumps: '', openingCostPerLitre: '', tolerancePer20: '0.8', tanks: [{ id: undefined, name: 'Tank 1', openingStock: '' }] };

function toForm(config) {
  const form = { costingMethod: config?.costingMethod ?? 'WAC', carryBalance: config?.carryBalance ?? false, paymentChannels: (config?.paymentChannels ?? []).join(', ') };
  for (const p of ['pms', 'ago']) {
    const c = config?.[p];
    form[p] = c
      ? {
          enabled: true,
          pumps: c.pumps.join(', '),
          openingCostPerLitre: c.openingCostPerLitre ?? '',
          tolerancePer20: per20(c.toleranceRate),
          tanks: (c.tanks ?? [{ id: 't1', name: 'Tank 1', openingStock: c.openingStock ?? 0 }]).map((t) => ({ ...t })),
        }
      : { ...blankProduct, enabled: p === 'pms' && !config };
  }
  return form;
}

function ConfigCard({ onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfig().then((r) => setForm(toForm(r.config))).catch(setError);
  }, []);

  const setProd = (p, patch) => setForm((f) => ({ ...f, [p]: { ...f[p], ...patch } }));
  const setTank = (p, i, patch) => setProd(p, { tanks: form[p].tanks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const body = {
        costingMethod: form.costingMethod,
        carryBalance: form.carryBalance,
        paymentChannels: form.paymentChannels.split(',').map((x) => x.trim()).filter(Boolean),
      };
      for (const p of ['pms', 'ago']) {
        const f = form[p];
        if (!f.enabled) continue;
        body[p] = {
          pumps: f.pumps.split(',').map((x) => x.trim()).filter(Boolean),
          openingCostPerLitre: f.openingCostPerLitre,
          toleranceRate: f.tolerancePer20 === '' ? 0 : Number(f.tolerancePer20) / 20,
          tanks: f.tanks.map((t) => ({ id: t.id, name: t.name, openingStock: t.openingStock })),
        };
      }
      await api.saveConfig(body);
      setOk(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!form) return <div className="card muted">{error ? <ErrorBox error={error} /> : 'Loading…'}</div>;

  return (
    <form className="card" onSubmit={save}>
      <h2>How this station works</h2>
      <label className="field">
        How is the cost of fuel worked out when stock is mixed?
        <select value={form.costingMethod} onChange={(e) => setForm({ ...form, costingMethod: e.target.value })}>
          <option value="WAC">Weighted average (all fuel in the tank blended)</option>
          <option value="FIFO">FIFO (oldest delivery sells first)</option>
        </select>
      </label>

      {['pms', 'ago'].map((p) => (
        <div key={p}>
          <h3>{PRODUCT_NAMES[p]}</h3>
          <label className="row" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={form[p].enabled} onChange={(e) => setProd(p, { enabled: e.target.checked })} />
            This station sells {p.toUpperCase()}
          </label>
          {form[p].enabled && (
            <>
              <Field label="Pump names (comma separated)" value={form[p].pumps} onChange={(v) => setProd(p, { pumps: v })} hint="e.g. 1, 2, 3" />
              <div style={{ height: 8 }} />
              <div className="grid2">
                <Field label="Opening cost (₦/L)" type="number" value={form[p].openingCostPerLitre} onChange={(v) => setProd(p, { openingCostPerLitre: v })} />
                <Field label="Allowed tolerance (L per 20 L)" type="number" value={form[p].tolerancePer20} onChange={(v) => setProd(p, { tolerancePer20: v })} />
              </div>
              <h3>Tanks</h3>
              {form[p].tanks.map((t, i) => (
                <div className="line three" key={t.id ?? `new${i}`}>
                  <Field label="Tank name" value={t.name} onChange={(v) => setTank(p, i, { name: v })} aria-label={`${p} tank ${i + 1} name`} />
                  <Field label="Opening stock (L)" type="number" value={t.openingStock} onChange={(v) => setTank(p, i, { openingStock: v })} aria-label={`${p} tank ${i + 1} opening stock`} />
                  {form[p].tanks.length > 1 ? <button type="button" className="linkbtn" onClick={() => setProd(p, { tanks: form[p].tanks.filter((_, j) => j !== i) })}>Remove</button> : <span />}
                </div>
              ))}
              <button type="button" className="btn ghost small" onClick={() => setProd(p, { tanks: [...form[p].tanks, { id: undefined, name: `Tank ${form[p].tanks.length + 1}`, openingStock: '' }] })}>+ Add a tank</button>
            </>
          )}
        </div>
      ))}

      <h3>Money</h3>
      <Field label="Card, POS and transfer types (comma separated)" value={form.paymentChannels} onChange={(v) => setForm({ ...form, paymentChannels: v })} hint="e.g. Moniepoint POS, Zenith POS, Transfer. Staff get a box for each." />
      <div className="assign" style={{ marginTop: '0.5rem' }}>
        <span>
          <span className="name">Carry the cash balance forward</span>
          <span className="footnote" style={{ display: 'block' }}>Off: each day stands alone. On: cash not banked yesterday counts toward today's available balance.</span>
        </span>
        <Switch checked={form.carryBalance} onChange={(v) => setForm({ ...form, carryBalance: v })} label="Carry the cash balance forward" />
      </div>

      <p className="muted">Opening stock and cost are what was in the tanks before your first entered day. Changing them recalculates every past day.</p>
      <ErrorBox error={error} />
      {ok && <div className="msg ok">Saved.</div>}
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save setup'}</button>
    </form>
  );
}

function AdjustmentsCard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setOk(false);
    api.getAdjustments(month).then((r) => setRows(r.adjustments)).catch(setError);
  }, [month]);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    setOk(false);
    try {
      const r = await api.saveAdjustments(month, rows);
      setRows(r.adjustments);
      setOk(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card">
      <h2>Monthly deductions</h2>
      <p className="muted">Things taken off the month's profit that are not daily expenses (e.g. Moniepoint shortage, a shortage on a delivery).</p>
      <Field label="Month" type="month" value={month} onChange={(v) => v && setMonth(v)} />
      <div style={{ height: 10 }} />
      {rows.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 8 }}>
          <div style={{ flex: 2, minWidth: 140 }}><Field label="What for" value={r.label} onChange={(v) => setRow(i, { label: v })} /></div>
          <div style={{ flex: 1, minWidth: 100 }}><Field label="Amount (₦)" type="number" value={r.amount} onChange={(v) => setRow(i, { amount: v })} /></div>
          <button type="button" className="btn ghost small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn ghost small" onClick={() => setRows([...rows, { label: '', amount: '' }])}>+ Add deduction</button>
        <button type="button" className="btn small" onClick={save}>Save deductions</button>
      </div>
      <ErrorBox error={error} />
      {ok && <div className="msg ok">Saved.</div>}
    </div>
  );
}

export default function Settings({ meta, onSaved }) {
  return (
    <div>
      <ConfigCard onSaved={onSaved} />
      {meta.configured && <AdjustmentsCard />}
    </div>
  );
}
