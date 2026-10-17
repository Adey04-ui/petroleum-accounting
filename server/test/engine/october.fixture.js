// Oct 1-8 2026 from IJU_SITTOPRINCE_OCT_2026.xlsx (PMS only; AGO was all zeros).
// Only pumps 1A and 2A had readings.
const c1A = [10747.21, 10802.38, 10802.38, 10802.38, 10802.38, 10802.38, 10802.38, 11101.53];
const c2A = [44686.34, 44903.68, 45245.22, 45536.13, 45867.47, 46249.84, 46632.67, 46662.66];
const dips = [4780, 4500, 4180, 3900, 3600, 3200, 2800, 2480];
const pos = [543200, 366900, 418820, 419010, 371490, 605900, 466800, 430700];
const expenses = { 2: 93000, 4: 800 }; // Oct 3 and Oct 5

export const config = {
  costingMethod: 'WAC',
  pms: { openingStock: 5100, openingCostPerLitre: 1351, toleranceRate: 0.04 },
};

export const days = c1A.map((close1A, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, '0')}`,
  pms: {
    pumps: [
      { id: '1A', ...(i === 0 ? { opening: 10426.25 } : {}), closing: close1A },
      { id: '2A', ...(i === 0 ? { opening: 44686.34 } : {}), closing: c2A[i] },
    ],
    closingStock: dips[i],
    sellingPrice: 1390,
    ...(i === 0 ? { toleranceRate: 1.3 / 20 } : {}), // the sheet used 1.3/20 on day 1 only
  },
  expenses: expenses[i] ?? 0,
  pos: pos[i],
}));

// Values read straight from the spreadsheet (Profitability!I, Banking!O, Tolerant!I)
export const sheet = {
  dailyProfit: [13814.4, 508.9, 42420.6, 26084.9, 55262.6, -8905.7, -8266.3],
  netProfit: 120919.4,
  cashToLodgeDay1: -97065.6,
  cashToLodgeDay3: -37079.4,
  toleranceVarianceDay1: -19.84,
};
