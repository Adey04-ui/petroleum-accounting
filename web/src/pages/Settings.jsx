import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox } from '../ui.jsx';
import { PRODUCT_NAMES } from '../format.js';

const blankProduct = { enabled: false, pumps: '', openingStock: '', openingCostPerLitre: '', tolerancePer20: '0.8' };

function toForm(config) {
  const form = { costingMethod: config?.costingMethod ?? 'WAC' };
  for (const p of ['pms', 'ago']) {
    const c = config?.[p];
    form[p] = c
      ? {
          enabled: true,
          pumps: c.pumps.join(', '),
          openingStock: c.openingStock,
          openingCostPerLitre: c.openingCostPerLitre ?? '',
          tolerancePer20: Number((c.toleranceRate * 20).toFixed(4)),
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

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const body = { costingMethod: form.costingMethod };
      for (const p of ['pms', 'ago']) {
        const f = form[p];
        if (!f.enabled) continue;
        body[p] = {
          pumps: f.pumps.split(',').map((x) => x.trim()).filter(Boolean),
          openingStock: f.openingStock,
          openingCostPerLitre: f.openingCostPerLitre,
          toleranceRate: f.tolerancePer20 === '' ? 0 : Number(f.tolerancePer20) / 20,
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
              <Field label="Pump names (comma separated)" value={form[p].pumps} onChange={(v) => setProd(p, { pumps: v })} hint="e.g. 1A, 1B, 2A, 2B" />
              <div style={{ height: 8 }} />
              <div className="grid3">
                <Field label="Opening stock (L)" type="number" value={form[p].openingStock} onChange={(v) => setProd(p, { openingStock: v })} />
                <Field label="Opening cost (₦/L)" type="number" value={form[p].openingCostPerLitre} onChange={(v) => setProd(p, { openingCostPerLitre: v })} />
                <Field label="Allowed tolerance (L per 20 L)" type="number" value={form[p].tolerancePer20} onChange={(v) => setProd(p, { tolerancePer20: v })} />
              </div>
            </>
          )}
        </div>
      ))}
      <p className="muted">
        Opening stock and cost are what was in the tank before your first entered day. Changing them recalculates every past day.
      </p>
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
