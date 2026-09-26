// Static economic reference data for Harvest Valley (EU / Belgian flavour, 2026 euro levels).
// Everything here is plain data: no DOM, no ctx, safe to import headlessly.

export const YEAR_DAYS = 36;      // 12 months × 3 days
export const MONTH_DAYS = 3;
export const DAY_SECONDS = 86400;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export const CONST = {
  startMoney: 18000,
  starterLoanMax: 50000,
  loanRate: 0.045,            // per year
  overdraftRate: 0.12,        // per year, charged on negative balance
  creditLimitBase: 50000,     // max total debt without collateral
  creditLandLTV: 0.6,         // + 60 % of owned land value
  fixedCostsMonthly: 85,      // farm insurance, accountant, phone, electricity
  fixedCostsPerHaMonthly: 5,  // liability/crop insurance scales with farmed area
  capPaymentPerHa: 235,       // CAP basic + eco-scheme payment, paid once a year (October)
  capPaymentDayOfYear: 27,    // 1 October
  landTransferTax: 0.115,     // Flemish registration duty 10 % + notary ≈ 1.5 %
  landResale: 0.95,           // selling land nets 95 % of list price (agent, notary)
  rentPerHaYear: [350, 650],  // by soil quality 0..1
  landPerHa: [38000, 65000],  // by soil quality 0..1
  wageRange: [110, 160],      // € per game day per hired hand
  historyDays: 144,           // kept price history (4 years)
  ledgerMax: 500,
  saturationDecay: 0.7,       // per day (half-life ≈ 2 days)
  saturationMaxDrop: 0.25,    // at most −25 % when a point is flooded
  retailMarkup: 1.12,         // buying a commodity back costs more than selling it
  assetResale: 0.55,          // used machinery sells for 55 % of list …
  assetDepreciationYear: 0.08,// … minus 8 % per year of ownership
  maxOpenOffers: 9,
};

// kind: 'carry' = storable harvest crop (cheapest at harvest, rising until the next one)
//       'wave'  = smooth yearly cosine (peakDoy = day-of-year of the maximum)
//       'flat'  = contract price (sugar beet)
// amp = half the peak-to-trough seasonal swing; sigma = daily log-volatility; theta = mean reversion/day
// common = weight of the shared grain-market factor
export const ITEMS = {
  wheat:     { name: 'Wheat',       unit: 't', base: 210,  kind: 'carry', harvestDoy: 21, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.7, depth: 80, color: '#c99a2e' },
  barley:    { name: 'Barley',      unit: 't', base: 185,  kind: 'carry', harvestDoy: 19, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.7, depth: 60, color: '#b8a25a' },
  oats:      { name: 'Oats',        unit: 't', base: 200,  kind: 'carry', harvestDoy: 22, amp: 0.06, sigma: 0.03,  theta: 0.07, common: 0.5, depth: 40, color: '#a89468' },
  rapeseed:  { name: 'Rapeseed',    unit: 't', base: 430,  kind: 'carry', harvestDoy: 20, amp: 0.06, sigma: 0.03,  theta: 0.07, common: 0.5, depth: 30, color: '#d9b62a' },
  maize:     { name: 'Maize',       unit: 't', base: 195,  kind: 'carry', harvestDoy: 29, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.6, depth: 70, color: '#e0a531' },
  potatoes:  { name: 'Potatoes',    unit: 't', base: 160,  kind: 'carry', harvestDoy: 26, amp: 0.16, sigma: 0.06,  theta: 0.09, common: 0,   depth: 90, color: '#a2723f' },
  sugarBeet: { name: 'Sugar beet',  unit: 't', base: 42,   kind: 'flat',  amp: 0,     sigma: 0.004, theta: 0.1,  common: 0,   depth: 400, color: '#b86b6b' },
  hay:       { name: 'Hay',         unit: 't', base: 120,  kind: 'carry', harvestDoy: 16, amp: 0.15, sigma: 0.03,  theta: 0.08, common: 0,   depth: 30, color: '#9aa25a' },
  straw:     { name: 'Straw',       unit: 't', base: 70,   kind: 'carry', harvestDoy: 22, amp: 0.18, sigma: 0.035, theta: 0.08, common: 0,   depth: 35, color: '#d6c07a' },
  milk:      { name: 'Milk',        unit: 'l', base: 0.46, kind: 'wave',  peakDoy: 32, amp: 0.05, sigma: 0.012, theta: 0.06, common: 0,   depth: 25000, color: '#e6e0cf' },
  eggs:      { name: 'Eggs',        unit: 'ea', base: 0.22, kind: 'wave', peakDoy: 10, amp: 0.04, sigma: 0.01,  theta: 0.08, common: 0,   depth: 6000, color: '#e8c89a' },
  wool:      { name: 'Wool',        unit: 'kg', base: 1.8, kind: 'wave',  peakDoy: 4,  amp: 0.06, sigma: 0.02,  theta: 0.06, common: 0,   depth: 600, color: '#d8d2c2' },
  diesel:    { name: 'Farm diesel', unit: 'l', base: 1.25, kind: 'wave',  peakDoy: 1,  amp: 0.04, sigma: 0.02,  theta: 0.05, common: 0,   depth: Infinity, color: '#4a4c50' },
  fertiliser:{ name: 'Fertiliser (CAN)', unit: 't', base: 420, kind: 'wave', peakDoy: 5, amp: 0.07, sigma: 0.025, theta: 0.05, common: 0, depth: Infinity, color: '#7d8a8f' },
};
export const ITEM_ALIASES = { grass: 'hay' };

// Per-hectare agronomy and input costs (€/ha, litres/ha). Months are 0-based (0 = January).
export const CROPS = {
  wheat:     { name: 'Winter wheat', product: 'wheat',    yield: 8.5, straw: 3.5, seed: 105,  fertiliser: 330, spray: 190, dieselL: 95,  sowMonths: [9, 10], harvestMonths: [7] },
  barley:    { name: 'Winter barley', product: 'barley',  yield: 7.5, straw: 3.0, seed: 95,   fertiliser: 270, spray: 160, dieselL: 90,  sowMonths: [8, 9], harvestMonths: [6] },
  oats:      { name: 'Spring oats', product: 'oats',      yield: 6.0, straw: 3.5, seed: 80,   fertiliser: 180, spray: 80,  dieselL: 85,  sowMonths: [2, 3], harvestMonths: [7] },
  rapeseed:  { name: 'Oilseed rape', product: 'rapeseed', yield: 4.0, straw: 0,   seed: 160,  fertiliser: 340, spray: 230, dieselL: 90,  sowMonths: [7], harvestMonths: [6] },
  maize:     { name: 'Grain maize', product: 'maize',     yield: 11,  straw: 0,   seed: 260,  fertiliser: 290, spray: 110, dieselL: 110, sowMonths: [3, 4], harvestMonths: [9] },
  potatoes:  { name: 'Potatoes', product: 'potatoes',     yield: 45,  straw: 0,   seed: 1400, fertiliser: 460, spray: 680, dieselL: 260, sowMonths: [3], harvestMonths: [8, 9] },
  sugarBeet: { name: 'Sugar beet', product: 'sugarBeet',  yield: 75,  straw: 0,   seed: 300,  fertiliser: 330, spray: 420, dieselL: 170, sowMonths: [2, 3], harvestMonths: [9, 10] },
  grass:     { name: 'Grass (hay)', product: 'hay',       yield: 9,   straw: 0,   seed: 30,   fertiliser: 220, spray: 20,  dieselL: 120, sowMonths: [2, 3, 7, 8], harvestMonths: [4, 5, 6, 7] },
};

// Contract job types. rate = € per unit of `unit`; amount range; seasons weight by month (12 entries).
const W = (arr) => arr; // readability
export const JOB_TYPES = {
  plough:     { title: 'Plough', unit: 'ha', rate: 115, amount: [1.2, 6], machine: true,
    months: W([0.2, 0.6, 1.0, 0.8, 0.2, 0, 0, 0.5, 1.0, 1.0, 0.7, 0.2]) },
  sow:        { title: 'Drill', unit: 'ha', rate: 68, amount: [1.5, 7], machine: true,
    months: W([0, 0.2, 1.0, 1.0, 0.7, 0, 0, 0.4, 0.9, 1.0, 0.3, 0]) },
  harvest:    { title: 'Combine', unit: 'ha', rate: 165, amount: [1.5, 6], machine: true,
    months: W([0, 0, 0, 0, 0, 0.2, 1.0, 1.0, 0.8, 0.7, 0.3, 0]) },
  mow:        { title: 'Mow', unit: 'ha', rate: 58, amount: [1, 5], machine: true,
    months: W([0, 0, 0, 0.3, 1.0, 1.0, 0.8, 0.6, 0.4, 0.1, 0, 0]) },
  transport:  { title: 'Haul', unit: 't', rate: 7.5, amount: [8, 36], machine: true,
    months: W([0.4, 0.4, 0.5, 0.5, 0.4, 0.6, 1.0, 1.0, 1.0, 1.0, 0.7, 0.4]) },
  deliver:    { title: 'Deliver', unit: 'load', rate: 70, amount: [1, 3], machine: true,
    months: W([0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.9]) },
  animalCare: { title: 'Mind livestock', unit: 'h', rate: 19, amount: [4, 10], machine: false,
    months: W([0.7, 0.7, 0.8, 0.8, 0.6, 0.6, 0.7, 0.7, 0.6, 0.6, 0.7, 0.9]) },
  shopHelp:   { title: 'Help at the shop', unit: 'h', rate: 14.5, amount: [3, 7], machine: false,
    months: W([0.5, 0.5, 0.6, 0.6, 0.6, 0.7, 0.8, 0.8, 0.6, 0.6, 0.7, 1.0]) },
  villageWork:{ title: 'Village odd jobs', unit: 'h', rate: 16.5, amount: [3, 8], machine: false,
    months: W([0.4, 0.4, 0.6, 0.7, 0.7, 0.7, 0.6, 0.6, 0.7, 0.7, 0.5, 0.4]) },
  snowClear:  { title: 'Clear snow', unit: 'h', rate: 72, amount: [2, 5], machine: true,
    months: W([1.0, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.9]) },
};

// Seeded NPC neighbours. Flemish + Walloon family names, farms and village people.
export const CLIENTS = [
  { name: 'Jef Vermeulen', farm: 'Hoeve Vermeulen', kind: 'farm' },
  { name: 'Marleen Peeters', farm: 'Peetershof', kind: 'farm' },
  { name: 'Luc Van den Broeck', farm: 'Broeckhoeve', kind: 'farm' },
  { name: 'Annelies De Smet', farm: 'Hof ter Smet', kind: 'farm' },
  { name: 'Wim Claes', farm: 'Claeshoeve', kind: 'farm' },
  { name: 'Josée Lambert', farm: 'Ferme Lambert', kind: 'farm' },
  { name: 'Philippe Dubois', farm: 'Ferme du Bois', kind: 'farm' },
  { name: 'Marie-Claire Renard', farm: 'Ferme des Renards', kind: 'farm' },
  { name: 'Didier Lejeune', farm: 'Ferme Lejeune', kind: 'farm' },
  { name: 'Bart Goossens', farm: 'Goossenshof', kind: 'farm' },
  { name: 'Hilde Maes', farm: 'Bakkerij Maes', kind: 'village' },
  { name: 'Koen Jacobs', farm: 'Garage Jacobs', kind: 'village' },
  { name: 'Nathalie Dupont', farm: 'Épicerie Dupont', kind: 'village' },
  { name: 'Rik Willems', farm: 'Café De Linde', kind: 'village' },
  { name: 'Gemeente Ter Beek', farm: 'Gemeentehuis', kind: 'village' },
];

export const WORKER_NAMES = ['Tom', 'Sofie', 'Pieter', 'Lotte', 'Arnaud', 'Julie', 'Dries', 'Emma',
  'Kobe', 'Camille', 'Jens', 'Manon', 'Stijn', 'Elise', 'Thibault', 'Noor'];
