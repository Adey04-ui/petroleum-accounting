# fuel-engine

Calculation engine for the IJU station sheet: meter readings, tolerance, banking,
profit and monthly summary, plus fuel stock costing and price-change gain/loss.

Plain JavaScript (ES modules). No UI, no database. It takes raw daily inputs and
returns every calculated figure, so the API and the screens never do their own maths.

## Setup

```bash
npm install
npm test
```

## Usage

```js
import { calculateMonth, ValidationError } from './index.js';

const config = {
  costingMethod: 'WAC',                 // 'WAC' (weighted average) or 'FIFO'
  pms: { openingStock: 5100, openingCostPerLitre: 1351, toleranceRate: 0.04 },
  // ago: { ... }                       // optional, same shape
  adjustments: [{ label: 'Moniepoint shortage', amount: 0 }],
};

const days = [
  {
    date: '2026-10-01',                 // YYYY-MM-DD, ascending, no duplicates
    pms: {
      pumps: [
        { id: '1A', opening: 10426.25, closing: 10747.21 }, // opening only needed on a pump's first day
        { id: '2A', opening: 44686.34, closing: 44686.34 },
      ],
      rtt: 0,                                   // return-to-tank litres
      deliveries: [],                           // [{ litres, costPerLitre }]
      closingStock: 4780,                       // tank dip at close
      sellingPrice: 1390,
      // replacementCost: 1400,                 // today's supplier price; defaults to latest delivery cost
      // toleranceRate: 0.065,                  // per-day override
    },
    expenses: 0, pos: 543200, transfer: 0,
  },
];

try {
  const { days: results, summary } = calculateMonth(config, days);
} catch (e) {
  if (e instanceof ValidationError) console.log(e.errors); // [{ date, field, message }]
}
```

`toleranceRate` is the sheet's `0.8/20`, written as `0.04`.

## Output

Each day in `results`:

- `pms` / `ago`: `pumpSales`, `tankSales`, `actualTolerance`, `expectedTolerance`,
  `toleranceVariance`, `revenue`, `costOfGoodsSold`, `unitCost`, `priceMargin`,
  `toleranceMargin`, `profit`, `priceChangeGain`, `normalProfit`, `closingStock`,
  `stockAverageCost`, `stockValue`
- `banking`: `expectedCash`, `cashToLodge`, `totalInBank`, `cumulativeCashToLodge`,
  `moniepointDiff`
- `profit`, `priceChangeGain`, `warnings[]`

`summary`: per-product totals, `totalSales`, `profitBeforeExpenses` (sheet: "Net Profit"),
`totalExpenses`, `profitAfterExpenses` (sheet: "Gross Profit"), `priceChangeGain`, `normalProfit`.

## How profit is calculated

```
profit          = pumpSales x sellingPrice - costOfGoodsSold
costOfGoodsSold = cost of the litres that left the tank (tankSales)
priceChangeGain = tankSales x (replacementCost - unitCost)
normalProfit    = profit - priceChangeGain
```

With a constant cost price, `profit` equals the sheet's `priceMargin + toleranceMargin`.
`priceChangeGain` is positive when supplier prices rose while you held cheaper stock,
and negative when they fell.

## Costing methods

- **WAC**: everything in the tank is blended into one average cost per litre.
  Example: 2,000 L at 1351 + 10,000 L at 1400 gives 1391.83 per litre.
- **FIFO**: the oldest delivery is assumed to sell first.

## Assumptions

- Deliveries are blended into stock before that day's sales are taken out.
- Each day's opening stock is the previous day's closing dip. Only the first day uses `openingStock`.
- A pump's opening meter defaults to its previous closing. A mismatch produces a warning.
- Meter rollover (counter resetting to 0) is not handled.

## Validation

Missing or backwards meter readings, missing dips or prices, and bad delivery data throw a
`ValidationError`. Warnings (opening/closing mismatch, dip higher than opening + deliveries)
do not stop the calculation and appear in `warnings`.

## Known issues in the original sheet

- 9 Oct: closing meters blank, giving about -57,764 L sold.
- 8 Oct: cost price blank, so profit shows 0.
- Banking: the Moniepoint declaration block has `#REF!` / `#VALUE!` errors.
