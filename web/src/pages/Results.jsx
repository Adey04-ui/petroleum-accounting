import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { ErrorBox, tone } from '../ui.jsx';
import { naira, litres, num, PRODUCT_NAMES } from '../format.js';

export default function Results({ meta }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const products = Object.keys(meta.products);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.month(month).then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [month]);

  const s = data?.summary;
  const showProfit = s?.profitBeforeExpenses !== undefined;
  const cls = (v) => (tone(v) === 'neg' ? 'neg' : tone(v) === 'pos' ? 'pos' : undefined);

  return (
    <div>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1 }}>
            Month
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
          {meta.permissions.admin && data?.days.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                setError(null);
                try {
                  await downloadExport(month);
                } catch (err) {
                  setError(err);
                }
              }}
            >
              Download Excel
            </button>
          )}
        </div>
      </div>

      <ErrorBox error={error} />
      {!data && !error && <div className="muted">Loading…</div>}

      {data?.missingCosts?.length > 0 && (
        <div className="msg warn">
          Cost price missing on deliveries for {data.missingCosts.join(', ')}. Profit for those days uses the last known cost until you fill it in under Daily entry.
        </div>
      )}

      {data && data.days.length === 0 && <div className="card muted">No entries for this month yet.</div>}

      {data && data.days.length > 0 && (
        <>
          <div className="cards">
            <div className="card"><div className="k">Total sales</div><div className="v">{naira(s.totalSales)}</div></div>
            {showProfit && (
              <>
                <div className="card"><div className="k">Profit before expenses</div><div className="v">{naira(s.profitBeforeExpenses)}</div></div>
                <div className="card"><div className="k">Total expenses</div><div className="v">{naira(s.totalExpenses)}</div></div>
                <div className="card"><div className="k">Profit after expenses</div><div className="v">{naira(s.profitAfterExpenses)}</div></div>
                <div className="card"><div className="k">Price-change gain / loss</div><div className="v">{naira(s.priceChangeGain)}</div></div>
                <div className="card"><div className="k">Profit with no price movement</div><div className="v">{naira(s.normalProfit)}</div></div>
              </>
            )}
            {!showProfit && <div className="card"><div className="k">Expenses</div><div className="v">{naira(s.expenses)}</div></div>}
          </div>

          {showProfit && s.adjustments.length > 0 && (
            <div className="card">
              <h2>Adjustments</h2>
              {s.adjustments.map((a, i) => (
                <div className="stat" key={i}><span>{a.label}</span><b>{naira(a.amount)}</b></div>
              ))}
            </div>
          )}

          {products.map((p) => {
            const t = s.products[p];
            return (
              t && (
                <div className="card" key={p}>
                  <h2>{PRODUCT_NAMES[p]} – month totals</h2>
                  <div className="stat"><span>Pump litres</span><b>{litres(t.pumpLitres)}</b></div>
                  <div className="stat"><span>Tank litres</span><b>{litres(t.tankLitres)}</b></div>
                  <div className="stat"><span>Expected tolerance</span><b>{litres(t.expectedTolerance)}</b></div>
                  <div className="stat"><span>Actual tolerance</span><b>{litres(t.actualTolerance)}</b></div>
                  <div className="stat"><span>Variance (actual − expected)</span><b className={tone(t.toleranceVariance)}>{litres(t.toleranceVariance)}</b></div>
                  <div className="stat"><span>Sales value</span><b>{naira(t.revenue)}</b></div>
                  <div className="stat"><span>Stock in tank at month end</span><b>{litres(t.closingStockLitres)}</b></div>
                  {t.profit !== undefined && (
                    <>
                      <div className="stat"><span>Price margin</span><b className={tone(t.priceMargin)}>{naira(t.priceMargin)}</b></div>
                      <div className="stat"><span>Tolerance margin</span><b className={tone(t.toleranceMargin)}>{naira(t.toleranceMargin)}</b></div>
                      <div className="stat"><span>Price margin + tolerance margin</span><b className={tone(t.profit)}>{naira(t.profit)}</b></div>
                      <div className="stat"><span>Stock value at month end</span><b>{naira(t.closingStockValue)}</b></div>
                    </>
                  )}
                </div>
              )
            );
          })}

          <div className="card">
            <h2>Day by day</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    {products.map((p) => (
                      <React.Fragment key={p}>
                        <th>{p.toUpperCase()} pump L</th>
                        <th>{p.toUpperCase()} tank L</th>
                        <th>{p.toUpperCase()} expected tol.</th>
                        <th>{p.toUpperCase()} actual tol.</th>
                        <th>{p.toUpperCase()} variance</th>
                        {showProfit && <th>{p.toUpperCase()} cost price</th>}
                        {showProfit && <th>{p.toUpperCase()} sell − cost</th>}
                        {showProfit && <th>{p.toUpperCase()} price margin</th>}
                        {showProfit && <th>{p.toUpperCase()} tol. margin</th>}
                      </React.Fragment>
                    ))}
                    <th>Expected cash</th>
                    <th>Cash to lodge</th>
                    {showProfit && <th>Price + tol. margin</th>}
                    {showProfit && <th>Price-change</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date.slice(5)}</td>
                      {products.map((p) => (
                        <React.Fragment key={p}>
                          <td>{num(d[p]?.pumpSales)}</td>
                          <td>{num(d[p]?.tankSales)}</td>
                          <td>{num(d[p]?.expectedTolerance)}</td>
                          <td>{num(d[p]?.actualTolerance)}</td>
                          <td className={cls(d[p]?.toleranceVariance)}>{num(d[p]?.toleranceVariance)}</td>
                          {showProfit && <td>{num(d[p]?.unitCost)}</td>}
                          {showProfit && <td>{num(d[p]?.sellingPrice - d[p]?.unitCost)}</td>}
                          {showProfit && <td className={cls(d[p]?.priceMargin)}>{num(d[p]?.priceMargin)}</td>}
                          {showProfit && <td className={cls(d[p]?.toleranceMargin)}>{num(d[p]?.toleranceMargin)}</td>}
                        </React.Fragment>
                      ))}
                      <td>{num(d.banking.expectedCash)}</td>
                      <td className={cls(d.banking.cashToLodge)}>{num(d.banking.cashToLodge)}</td>
                      {showProfit && <td className={cls(d.profit)}>{num(d.profit)}</td>}
                      {showProfit && <td className={cls(d.priceChangeGain)}>{num(d.priceChangeGain)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.days.some((d) => d.warnings.length > 0) && (
            <div className="msg warn">
              <b>Warnings</b>
              <ul>
                {data.days.flatMap((d) => d.warnings.map((w, i) => <li key={d.date + i}>{d.date}: {w}</li>))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
