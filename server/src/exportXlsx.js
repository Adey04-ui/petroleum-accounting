import ExcelJS from 'exceljs';

const PRODUCTS = [['pms', 'PMS'], ['ago', 'AGO']];
const MONEY = '#,##0.00;[Red]-#,##0.00';

// [field, heading, add up in the totals row?]
const PRODUCT_COLUMNS = [
  ['pumpSales', 'Pump litres', true],
  ['tankSales', 'Tank litres', true],
  ['rtt', 'Return to tank (L)', true],
  ['transferredOut', 'Transferred out (L)', true],
  ['expectedTolerance', 'Expected tolerance', true],
  ['actualTolerance', 'Actual tolerance', true],
  ['toleranceVariance', 'Variance', true],
  ['sellingPrice', 'Selling price', false],
  ['unitCost', 'Cost price', false],
  ['margin', 'Selling - cost (per litre)', false],
  ['priceMargin', 'Price margin', true],
  ['toleranceMargin', 'Tolerance margin', true],
  ['profit', 'Price margin + tolerance margin', true],
  ['priceChangeGain', 'Price-change gain/loss', true],
];

export async function buildWorkbook({ month, days, summary }) {
  const wb = new ExcelJS.Workbook();
  const present = PRODUCTS.filter(([key]) => days.some((d) => d[key]));

  // ---------- Daily sheet ----------
  const ws = wb.addWorksheet('Daily', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const header = ['Date'];
  const addUp = [false];
  for (const [, label] of present) {
    for (const [, heading, sum] of PRODUCT_COLUMNS) {
      header.push(`${label} ${heading}`);
      addUp.push(sum);
    }
  }
  for (const [heading, sum] of [
    ['Total sales', true], ['Previous balance', false], ['Card / POS / transfer payments', true], ['Credit sales', true], ['Credit received', true],
    ['Banked', true], ['Expenses', true], ['Available balance', false], ['Total profit (all products)', true],
  ]) {
    header.push(heading);
    addUp.push(sum);
  }

  const rows = days.map((d) => {
    const row = [d.date];
    for (const [key] of present) {
      const x = d[key];
      for (const [field] of PRODUCT_COLUMNS) {
        if (!x) row.push(undefined);
        else if (field === 'margin') row.push(x.sellingPrice - x.unitCost);
        else row.push(x[field]);
      }
    }
    const b = d.banking;
    row.push(b.expectedCash, b.previousBalance, b.nonCash, b.creditSales, b.creditReceived, b.banked, b.expenses, b.availableBalance, d.profit);
    return row;
  });

  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  const totals = header.map((_, i) => {
    if (i === 0) return 'TOTAL';
    return addUp[i] ? rows.reduce((s, r) => s + (typeof r[i] === 'number' ? r[i] : 0), 0) : undefined;
  });
  ws.addRow(totals);

  header.forEach((_, i) => {
    const col = ws.getColumn(i + 1);
    col.width = i === 0 ? 12 : 16;
    if (i > 0) col.numFmt = MONEY;
  });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(1).height = 45;
  ws.getRow(ws.rowCount).font = { bold: true };

  // ---------- Summary sheet ----------
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 44 }, { width: 22 }];
  s.getColumn(2).numFmt = MONEY;
  const title = s.addRow([`Station summary - ${month}`]);
  title.font = { bold: true, size: 14 };
  const add = (label, value, bold) => {
    const r = s.addRow([label, value]);
    if (bold) r.font = { bold: true };
  };

  for (const [key, label] of present) {
    const t = summary.products[key];
    if (!t) continue;
    s.addRow([]);
    s.addRow([label]).font = { bold: true, size: 12 };
    add('Pump litres', t.pumpLitres);
    add('Tank litres', t.tankLitres);
    add('Expected tolerance (L)', t.expectedTolerance);
    add('Actual tolerance (L)', t.actualTolerance);
    add('Tolerance variance (L)', t.toleranceVariance);
    add('Sales value', t.revenue);
    add('Cost of goods sold', t.costOfGoodsSold);
    add('Price margin', t.priceMargin);
    add('Tolerance margin', t.toleranceMargin);
    add('Price margin + tolerance margin', t.profit, true);
    add('  of which price-change gain/loss', t.priceChangeGain);
    add('Stock in tank at month end (L)', t.closingStockLitres);
    add('Stock value at month end', t.closingStockValue);
  }

  s.addRow([]);
  s.addRow(['Whole station']).font = { bold: true, size: 12 };
  add('Total sales', summary.totalSales);
  add('Profit before expenses', summary.profitBeforeExpenses, true);
  add('Daily expenses', summary.expenses);
  for (const a of summary.adjustments) add(a.label, a.amount);
  add('Total expenses', summary.totalExpenses);
  add('Profit after expenses', summary.profitAfterExpenses, true);
  add('Price-change gain/loss', summary.priceChangeGain);
  add('Profit with no price movement', summary.normalProfit);

  return wb.xlsx.writeBuffer();
}
