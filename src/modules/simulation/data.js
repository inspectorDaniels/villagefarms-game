// Static economic reference data for Harvest Valley (EU / Belgian flavour, "game scale" euros).
// Everything here is plain data: no DOM, no ctx, safe to import headlessly.

export const YEAR_DAYS = 36;      // 12 months × 3 days
export const MONTH_DAYS = 3;
export const DAY_SECONDS = 86400;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// r2 numbers (director decision after review r1). Annual figures ÷ 36 per game day.
export const CONST = {
  startMoney: 18000,
  loanRate: 0.045,            // per year
  loanRateRange: [0.02, 0.12],
  overdraftRate: 0.12,        // per year, charged on a negative balance
  creditLimitBase: 25000,     // unsecured credit line …
  creditIncomeMult: 0.6,      // … + 60 % of the last 12 months' operating result (the bank reads your accounts)
  creditLandLTV: 0.6,         // + 60 % of owned land market value
  creditMachineLTV: 0.5,      // + 50 % of owned machinery value
  mortgageLTV: 0.75,          // buyParcel({mortgage}) lends at most 75 % of the price (15 years); you bring 25 % + fees
  mortgageMonths: 180,
  machineFinanceLTV: 0.75,    // purchase(id, {finance}) : dealer finance, 25 % down, 5 years, secured on the machine
  machineFinanceMonths: 60,
  fixedCostsMonthly: 85,      // farm insurance, accountant, phone, electricity
  fixedCostsPerHaMonthly: 5,  // liability/crop insurance scales with farmed area
  capPaymentPerHa: 450,       // CAP basic income support + eco-schemes + young-farmer & redistributive top-ups per ha-year (game scale), pro rata by days held
  capPaymentDayOfYear: 27,    // 1 October
  landFees: 0.04,             // purchase fees
  landResale: 0.97,           // selling nets 97 % of market value
  landPerHa: [12000, 22000],  // market value by soil quality 0..1 (× regional land index)
  rentPerHaYear: [450, 650],  // by soil quality (× land index at signing) ≈ 3.5 % of value
  landGrowthYear: 0.03,       // mean appreciation of the land index
  landGrowthSd: 0.012,        // monthly noise (log)
  leaseMinDays: 36,           // minimum lease term: one game year
  leaseEarlyExitMonths: 3,    // ending early costs min(rest of the minimum term, 3 months' rent)
  maxRentListings: 3,         // scarce: at most this many parcels to let at once
  maxSaleListings: 2,
  listingMonths: [3, 8],      // an unanswered listing is withdrawn after this many months
  wageRange: [150, 220],      // r3: € per game day a hand actually works (by skill)
  retainer: 35,               // € per idle game day
  hoursPerDayHand: 10,        // a hand's full working day (game hours) — work.js HOURS_PER_DAY
  jobCapBase: 2,              // active jobs = 2 + hired hands
  callout: [60, 110],         // € call-out fee on machine jobs (small jobs still pay the trip)
  bulkItems: ['wheat', 'barley', 'oats', 'rapeseed', 'maize'],
  bulkBase: 80,               // t: the old barn, before any grain store is bought
  overLimitBlockDays: 30,     // insolvency: purchases blocked
  overLimitSeizeDays: 60,     // insolvency: the bank sells the least valuable asset …
  seizeValue: 0.85,           // … at 85 % of value, every 3 days while still over the limit
  historyDays: 144,           // price history kept (4 years)
  ledgerMax: 600,
  saturationDecay: 0.7,       // per day (half-life ≈ 2 days)
  saturationMaxDrop: 0.25,    // at most −25 % when one buyer is flooded
  retailMarkup: 1.15,         // buying a commodity back costs more than selling it
  assetResaleNew: 0.9,        // machinery is worth 90 % of list once it leaves the dealer …
  assetDepreciationYear: 0.05,// … minus 5 % of list per year, floor 20 %
  upkeepYear: 0.015,          // default upkeep: 1.5 % of list per year
  maxOpenOffers: 8,
  maxActiveJobs: 3,
  catchUpMaxDays: 72,
};

// kind: 'carry' = storable harvest crop (cheapest at harvest, rising until the next one)
//       'wave'  = smooth yearly cosine (peakDoy = day-of-year of the maximum)
//       'flat'  = contract price (sugar beet)
// amp = half the peak-to-trough seasonal swing; sigma = daily log-volatility; theta = mean reversion/day
// common = weight of the shared grain-market factor; depth = units one buyer absorbs before the price sags
export const ITEMS = {
  wheat:     { name: 'Wheat',       unit: 't', base: 210,  kind: 'carry', harvestDoy: 21, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.7, depth: 160, color: '#c99a2e' },
  barley:    { name: 'Barley',      unit: 't', base: 185,  kind: 'carry', harvestDoy: 19, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.7, depth: 150, color: '#b8a25a' },
  oats:      { name: 'Oats',        unit: 't', base: 200,  kind: 'carry', harvestDoy: 22, amp: 0.06, sigma: 0.03,  theta: 0.07, common: 0.5, depth: 90, color: '#a89468' },
  rapeseed:  { name: 'Rapeseed',    unit: 't', base: 430,  kind: 'carry', harvestDoy: 20, amp: 0.06, sigma: 0.03,  theta: 0.07, common: 0.5, depth: 80, color: '#d9b62a' },
  maize:     { name: 'Maize',       unit: 't', base: 195,  kind: 'carry', harvestDoy: 29, amp: 0.07, sigma: 0.026, theta: 0.07, common: 0.6, depth: 160, color: '#e0a531' },
  potatoes:  { name: 'Potatoes',    unit: 't', base: 160,  kind: 'carry', harvestDoy: 26, amp: 0.16, sigma: 0.06,  theta: 0.09, common: 0,   depth: 250, color: '#a2723f' },
  sugarBeet: { name: 'Sugar beet',  unit: 't', base: 42,   kind: 'flat',  amp: 0,     sigma: 0.004, theta: 0.1,  common: 0,   depth: 3000, color: '#b86b6b' },
  hay:       { name: 'Hay',         unit: 't', base: 120,  kind: 'carry', harvestDoy: 16, amp: 0.15, sigma: 0.03,  theta: 0.08, common: 0,   depth: 60, color: '#9aa25a' },
  straw:     { name: 'Straw',       unit: 't', base: 70,   kind: 'carry', harvestDoy: 22, amp: 0.18, sigma: 0.035, theta: 0.08, common: 0,   depth: 70, color: '#d6c07a' },
  milk:      { name: 'Milk',        unit: 'l', base: 0.46, kind: 'wave',  peakDoy: 32, amp: 0.05, sigma: 0.012, theta: 0.06, common: 0,   depth: 25000, color: '#e6e0cf' },
  eggs:      { name: 'Eggs',        unit: 'ea', base: 0.22, kind: 'wave', peakDoy: 10, amp: 0.04, sigma: 0.01,  theta: 0.08, common: 0,   depth: 6000, color: '#e8c89a' },
  wool:      { name: 'Wool',        unit: 'kg', base: 1.8, kind: 'wave',  peakDoy: 4,  amp: 0.06, sigma: 0.02,  theta: 0.06, common: 0,   depth: 600, color: '#d8d2c2' },
  diesel:    { name: 'Farm diesel', unit: 'l', base: 1.25, kind: 'wave',  peakDoy: 1,  amp: 0.04, sigma: 0.02,  theta: 0.05, common: 0,   depth: Infinity, color: '#4a4c50' },
  fertiliser:{ name: 'Fertiliser (CAN)', unit: 't', base: 420, kind: 'wave', peakDoy: 5, amp: 0.07, sigma: 0.025, theta: 0.05, common: 0, depth: Infinity, color: '#7d8a8f' },
};
export const ITEM_ALIASES = { grass: 'hay' };
export const CONSUMABLES = ['diesel', 'fertiliser']; // buy-only: no buyer takes them back

// Per-hectare agronomy and input costs (€/ha, litres/ha). Months are 0-based (0 = January).
export const CROPS = {
  wheat:     { name: 'Winter wheat', product: 'wheat',    yield: 8.5, straw: 3.5, seed: 70,  fertiliser: 180, spray: 95, dieselL: 95,  sowMonths: [9, 10], harvestMonths: [7] },
  barley:    { name: 'Winter barley', product: 'barley',  yield: 7.5, straw: 3.0, seed: 60,   fertiliser: 150, spray: 80, dieselL: 90,  sowMonths: [8, 9], harvestMonths: [6] },
  oats:      { name: 'Spring oats', product: 'oats',      yield: 6.0, straw: 3.5, seed: 50,   fertiliser: 100, spray: 40,  dieselL: 85,  sowMonths: [2, 3], harvestMonths: [7] },
  rapeseed:  { name: 'Oilseed rape', product: 'rapeseed', yield: 4.0, straw: 0,   seed: 100,  fertiliser: 180, spray: 115, dieselL: 90,  sowMonths: [7], harvestMonths: [6] },
  maize:     { name: 'Grain maize', product: 'maize',     yield: 11,  straw: 0,   seed: 170,  fertiliser: 170, spray: 60, dieselL: 110, sowMonths: [3, 4], harvestMonths: [9] },
  potatoes:  { name: 'Potatoes', product: 'potatoes',     yield: 45,  straw: 0,   seed: 850, fertiliser: 250, spray: 350, dieselL: 260, sowMonths: [3], harvestMonths: [8, 9] },
  sugarBeet: { name: 'Sugar beet', product: 'sugarBeet',  yield: 75,  straw: 0,   seed: 190,  fertiliser: 180, spray: 210, dieselL: 170, sowMonths: [2, 3], harvestMonths: [9, 10] },
  grass:     { name: 'Grass (hay)', product: 'hay',       yield: 9,   straw: 0,   seed: 25,   fertiliser: 120, spray: 10,  dieselL: 120, sowMonths: [2, 3, 7, 8], harvestMonths: [4, 5, 6, 7] },
};

// Contract job types (machine-rate pay). rate = € per unit; transport also pays perTkm × km.
// needs = machine category required; months = offer weight by month (12 entries).
export const JOB_TYPES = {
  plough:     { title: 'Plough', unit: 'ha', rate: 105, spread: 0.15, amount: [1.5, 6], machine: true, needs: 'tillage',
    months: [0.2, 0.6, 1.0, 0.8, 0.2, 0, 0, 0.5, 1.0, 1.0, 0.7, 0.2] },
  sow:        { title: 'Drill', unit: 'ha', rate: 72, spread: 0.15, amount: [1.5, 7], machine: true, needs: 'tillage',
    months: [0, 0.2, 1.0, 1.0, 0.7, 0, 0, 0.4, 0.9, 1.0, 0.3, 0] },
  harvest:    { title: 'Combine', unit: 'ha', rate: 160, spread: 0.13, amount: [2, 7], machine: true, needs: 'combine',
    months: [0, 0, 0, 0, 0, 0.2, 1.0, 1.0, 0.8, 0.7, 0.3, 0] },
  mow:        { title: 'Mow', unit: 'ha', rate: 58, spread: 0.15, amount: [1.5, 6], machine: true, needs: 'mower',
    months: [0, 0, 0, 0.3, 1.0, 1.0, 0.8, 0.6, 0.4, 0.1, 0, 0] },
  transport:  { title: 'Haul', unit: 't', rate: 4.5, perTkm: 1.2, spread: 0.12, amount: [20, 60], machine: true, needs: 'trailer',
    months: [0.4, 0.4, 0.5, 0.5, 0.4, 0.6, 1.0, 1.0, 1.0, 1.0, 0.7, 0.4] },
  deliver:    { title: 'Deliver', unit: 'load', rate: 110, spread: 0.2, amount: [1, 3], machine: true, needs: 'trailer',
    months: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.9] },
  animalCare: { title: 'Mind livestock', unit: 'h', rate: 19, spread: 0.1, amount: [4, 10], machine: false,
    months: [0.7, 0.7, 0.8, 0.8, 0.6, 0.6, 0.7, 0.7, 0.6, 0.6, 0.7, 0.9] },
  shopHelp:   { title: 'Help at the shop', unit: 'h', rate: 14.5, spread: 0.1, amount: [3, 7], machine: false,
    months: [0.5, 0.5, 0.6, 0.6, 0.6, 0.7, 0.8, 0.8, 0.6, 0.6, 0.7, 1.0] },
  villageWork:{ title: 'Village odd jobs', unit: 'h', rate: 16.5, spread: 0.1, amount: [3, 8], machine: false,
    months: [0.4, 0.4, 0.6, 0.7, 0.7, 0.7, 0.6, 0.6, 0.7, 0.7, 0.5, 0.4] },
  snowClear:  { title: 'Clear snow', unit: 'h', rate: 26, spread: 0.1, amount: [2, 5], machine: true, needs: 'tractor',
    months: [1.0, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.9] },
};

// Field-work rates live in work.js (workRates()).

// Machinery catalog (registered by default; other modules may override entries by id).
export const MACHINES = [
  { id: 'tractor_t1', category: 'tractor', name: 'Used 95 hp tractor', price: 26000, meta: { tier: 1 } },
  { id: 'tractor_t2', category: 'tractor', name: '180 hp tractor', price: 64000, meta: { tier: 2 } },
  { id: 'tractor_t3', category: 'tractor', name: '300 hp tractor', price: 150000, meta: { tier: 3 } },
  { id: 'tillage_s', category: 'tillage', name: 'Plough & 3 m drill', price: 9000, meta: { size: 1 } },
  { id: 'tillage_l', category: 'tillage', name: '5-furrow plough & 4 m drill', price: 20000, meta: { size: 2 } },
  { id: 'sprayer', category: 'sprayer', name: 'Sprayer & spreader', price: 14000, meta: {} },
  { id: 'trailer', category: 'trailer', name: '14 t tipping trailer', price: 11000, meta: {} },
  { id: 'mower', category: 'mower', name: 'Disc mower', price: 12000, meta: {} },
  { id: 'combine_s', category: 'combine', name: 'Compact combine (used)', price: 92000, meta: {} },
  { id: 'combine_l', category: 'combine', name: 'Large combine', price: 260000, meta: {} },
  { id: 'root_harvester', category: 'harvester', name: 'Trailed beet & potato lifter', price: 68000, meta: {} },
  { id: 'baler', category: 'baler', name: 'Round baler', price: 30000, meta: {} },
  { id: 'cultivator', category: 'cultivator', name: 'Power harrow / cultivator', price: 12000, meta: {} },
  { id: 'grain_store', category: 'storage', name: 'Grain store (400 t)', price: 40000, meta: { capacity: 400 } },
  { id: 'grain_store_l', category: 'storage', name: 'Grain store & dryer (1000 t)', price: 85000, meta: { capacity: 1000 } },
];

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
