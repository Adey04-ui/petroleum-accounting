import React from 'react';
import { Stat, tone } from '../ui.jsx';
import { naira, litres, PRODUCT_NAMES } from '../format.js';

/** One day, as worked out by the server. Owners also see cost, margins and profit; staff never do. */
export default function DayResult({ day, title }) {
  const b = day.banking;
  return (
    <div className="card">
      <h2>{title ?? `Result for ${day.date}`}</h2>
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
            {d.pumps?.filter((x) => x.used).map((x) => (
              <Stat key={x.id} label={`Pump ${x.id}${x.rtt ? ` (after ${litres(x.rtt)} returned)` : ''}`} value={litres(x.sales)} />
            ))}
            <Stat label="Pump sales" value={litres(d.pumpSales)} />
            {d.tanks?.length > 1 && d.tanks.map((t) => <Stat key={t.id} label={`${t.name}: ${litres(t.opening)} → ${litres(t.closing)}`} value={`${litres(t.litresOut)} out`} />)}
            <Stat label="Tank sales" value={litres(d.tankSales)} />
            {d.transferredOut > 0 && <Stat label="Fuel moved out (not sold)" value={litres(d.transferredOut)} />}
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
      <h3>Cash</h3>
      {b.previousBalance > 0 && <Stat label="Previous balance" value={naira(b.previousBalance)} />}
      <Stat label="Total sales" value={naira(b.expectedCash)} />
      {b.payments?.map((l, i) => <Stat key={`p${i}`} label={`− ${l.label}`} value={naira(l.amount)} />)}
      {b.pos > 0 && <Stat label="− POS" value={naira(b.pos)} />}
      {b.transfer > 0 && <Stat label="− Transfer" value={naira(b.transfer)} />}
      {b.creditSales > 0 && <Stat label="− Credit sales" value={naira(b.creditSales)} />}
      {b.creditReceived > 0 && <Stat label="+ Credit paid back" value={naira(b.creditReceived)} />}
      {b.expenseLines?.map((l, i) => <Stat key={`e${i}`} label={`− ${l.label}`} value={naira(l.amount)} />)}
      {b.banked > 0 && <Stat label="− Banked" value={naira(b.banked)} />}
      <Stat label="Available balance" value={naira(b.availableBalance)} tone={tone(b.availableBalance)} />
      {b.moniepointDiff !== null && <Stat label="Moniepoint declared − POS" value={naira(b.moniepointDiff)} tone={tone(b.moniepointDiff)} />}
    </div>
  );
}
