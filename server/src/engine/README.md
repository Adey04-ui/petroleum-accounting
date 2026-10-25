# Calculation engine

Pure functions (no screens, no database) that turn a station's raw daily inputs into every figure in the report:
pump sales, tank sales, tolerance, tank-by-tank movement, cash, stock cost, profit and price-change gain or loss.

The input format, the formulas and the rules are written at the top of `engine.js`. In short:

- **Pumps:** `closing - opening - return-to-tank`; a pump can be marked `idle` ("not used today"). A forgotten closing meter is an error, never a silent zero.
- **Tanks:** each product has one or more named tanks with a dip each. `tank sales = opening + received - moved out of the station - closing`.
  Moving fuel between your own tanks changes the tanks, not the product totals.
- **Tolerance:** `actual = pump sales - tank sales`, `expected = rate x tank sales`; a single day may carry its own `toleranceRate`.
- **Cash:** `available balance = previous balance + sales - card/POS/transfer - credit sales + credit paid back - expenses - banked`.
  The previous balance is only carried forward when the station turns that on.
- **Profit:** `pump sales x price - cost of the litres that left by being sold`. Fuel moved out is taken out of stock at its cost and is neither a sale nor a cost of sales.
  `price-change gain = tank sales x (today's supplier price - cost of those litres)`.
- **Costing:** weighted average (default) or FIFO. Deliveries are blended in before the day's sales.

Older data (one tank, `closingStock`, a single `pos` / `transfer` / `expenses` number) is still read correctly.
Tests: `server/test/engine/` (the October sheet, costing scenarios, and the station's own daily report to the naira).
