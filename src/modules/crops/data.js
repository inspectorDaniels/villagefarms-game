// crops — static data: cell states, crop table, growth calendar. Pure data + helpers, no DOM / ctx.
// Yields/straw/calendar default to the simulation module's CROPS table (data.js there) and are
// overwritten at init from `simulation.yieldTable()` so both modules always agree.

export const YEAR_DAYS = 36;
export const MONTH_DAYS = 3;

// ---- cell states (Uint8) ----
export const S = {
  NONE: 0,        // outside the field polygon
  GRASS: 1,       // unmanaged sward / pasture
  STUBBLE: 2,     // after a cereal/oilseed/maize harvest (straw may lie in swaths: mass > 0)
  CULTIVATED: 3,  // seedbed (also bare soil after lifting roots)
  PLOUGHED: 4,    // furrows
  SOWN: 5,        // growing crop; visual stage derived from growth 0..1
  RIPE: 6,        // ready to harvest (grass: ready to mow)
  WITHERED: 7,    // left too long after ripe (or frost-killed)
  MOWN: 8,        // cut grass lying in swaths (mass = hay kg)
  WINDROW: 9,     // raked hay rope (mass = hay kg)
};
export const STATE_NAMES = ['none', 'grass', 'stubble', 'cultivated', 'ploughed', 'sown', 'ripe', 'withered', 'mown', 'windrow'];

// growth units per game day by month (0 = January). One unit ≈ one "good growing day".
export const UNITS = {
  cool: [0.15, 0.2, 0.45, 0.75, 1.0, 1.1, 1.1, 1.0, 0.75, 0.45, 0.25, 0.15], // cereals, rape, grass
  warm: [0, 0, 0.1, 0.45, 0.9, 1.2, 1.3, 1.2, 0.85, 0.45, 0.1, 0],           // maize, potatoes, beet (frost tender)
};

// visual stage thresholds on growth (sown → s1 → s2 → s3 → s4 → ripe at 1)
const STAGES = [0.06, 0.25, 0.5, 0.75];

// yieldT/strawT (t/ha), months 0-based. `height` m at maturity. rows = row spacing in m (tile rows).
export const CROPS = {
  wheat: {
    name: 'Winter wheat', product: 'wheat', yieldT: 8.5, strawT: 3.5, sowMonths: [9, 10], harvestMonths: [7],
    units: 'cool', height: 0.9, rows: 0.25, witherDays: 6, kind: 'cereal',
    stageNames: ['drilled', 'emerged', 'tillering', 'stem extension', 'heading', 'ripe'],
  },
  barley: {
    name: 'Winter barley', product: 'barley', yieldT: 7.5, strawT: 3.0, sowMonths: [8, 9], harvestMonths: [6],
    units: 'cool', height: 0.8, rows: 0.25, witherDays: 6, kind: 'cereal',
    stageNames: ['drilled', 'emerged', 'tillering', 'stem extension', 'awns out', 'ripe'],
  },
  oats: {
    name: 'Spring oats', product: 'oats', yieldT: 6.0, strawT: 3.5, sowMonths: [2, 3], harvestMonths: [7],
    units: 'cool', height: 1.0, rows: 0.25, witherDays: 6, kind: 'cereal',
    stageNames: ['drilled', 'emerged', 'tillering', 'stem extension', 'panicles', 'ripe'],
  },
  rapeseed: {
    name: 'Oilseed rape', product: 'rapeseed', yieldT: 4.0, strawT: 0, sowMonths: [7], harvestMonths: [6],
    units: 'cool', height: 1.5, rows: 0.5, witherDays: 5, kind: 'oilseed', stages: [0.05, 0.3, 0.62, 0.72],
    stageNames: ['drilled', 'cotyledons', 'rosette', 'stem extension', 'in bloom', 'pods ripe'],
  },
  maize: {
    name: 'Grain maize', product: 'maize', yieldT: 11, strawT: 0, sowMonths: [3, 4], harvestMonths: [9],
    units: 'warm', height: 2.6, rows: 0.75 * 2 / 3, witherDays: 7, kind: 'maize', frostKill: true,
    stageNames: ['drilled', 'emerged', 'leaf stage', 'knee high', 'tasselling', 'ripe'],
  },
  potatoes: {
    name: 'Potatoes', product: 'potatoes', yieldT: 45, strawT: 0, sowMonths: [3], harvestMonths: [8, 9],
    units: 'warm', height: 0.6, rows: 1.0, witherDays: 9, kind: 'root', ridged: true, frostKill: true,
    stageNames: ['planted', 'emerged', 'canopy', 'rows closed', 'flowering', 'haulm dying'],
  },
  sugarBeet: {
    name: 'Sugar beet', product: 'sugarBeet', yieldT: 75, strawT: 0, sowMonths: [2, 3], harvestMonths: [9, 10],
    units: 'warm', height: 0.5, rows: 0.5, witherDays: 12, kind: 'root', frostKill: false,
    stageNames: ['drilled', 'cotyledons', '6 leaves', 'rows closed', 'full canopy', 'ready to lift'],
  },
  grass: {
    name: 'Grass (hay)', product: 'hay', yieldT: 9, strawT: 0, sowMonths: [2, 3, 7, 8], harvestMonths: [4, 5, 6, 7],
    units: 'cool', height: 0.6, rows: 0.15, witherDays: 0, kind: 'grass', cuts: 3,
    stageNames: ['sown', 'sward', 'leafy', 'long', 'heading', 'ready to mow'],
  },
};
export const CROP_IDS = Object.keys(CROPS);
export const REGROW = 0.22;          // grass growth after a cut
export const BALE_KG = { hay: 250, straw: 210 }; // round bales
export const MOW_MIN_GROWTH = 0.35;  // grass can be cut from here (lower yield)

/** stage index 0..5 for a growth value (5 = ripe) */
export function stageOf(crop, growth) {
  const th = (CROPS[crop] && CROPS[crop].stages) || STAGES;
  if (growth >= 1) return 5;
  let s = 0;
  while (s < 4 && growth >= th[s]) s++;
  return s;
}
/** growth value at the middle of a visual stage (for forceStage / plantAll) */
export function growthForStage(crop, stage) {
  const th = (CROPS[crop] && CROPS[crop].stages) || STAGES;
  const edges = [0, ...th, 1];
  if (stage >= 5) return 1;
  const s = Math.max(0, Math.min(4, stage | 0));
  return (edges[s] + edges[s + 1]) / 2;
}

export const monthOfDoy = (doy) => Math.floor((((doy % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / MONTH_DAYS);
export const unitsOn = (crop, doy) => UNITS[CROPS[crop].units][monthOfDoy(doy)];

/**
 * growth units needed from sowing to ripe, derived from the calendar so that a crop sown in
 * the middle of its first sowing month under good conditions ripens in the middle of its first
 * harvest month. Grass: one regrowth cycle (~1.5 summer months).
 */
export function computeNeeds() {
  for (const id of CROP_IDS) {
    const c = CROPS[id];
    if (c.kind === 'grass') { c.need = 5.0; continue; }
    const start = c.sowMonths[0] * MONTH_DAYS + 1;
    let end = c.harvestMonths[0] * MONTH_DAYS + 1;
    if (end <= start) end += YEAR_DAYS;
    let sum = 0;
    for (let d = start + 1; d <= end; d++) sum += unitsOn(id, d);
    c.need = +sum.toFixed(3);
  }
}
computeNeeds();

/** is doy inside the sowing window of crop? */
export function inSowWindow(crop, doy) { return CROPS[crop].sowMonths.includes(monthOfDoy(doy)); }

/**
 * growth a crop sown on schedule would have on day-of-year `doy` (for NPC fields at mixed stages).
 * Returns null if the crop would not be in the ground then.
 */
export function calendarGrowth(crop, doy) {
  const c = CROPS[crop];
  if (!c) return null;
  if (c.kind === 'grass') {
    const m = monthOfDoy(doy);
    return m >= 3 && m <= 8 ? 0.4 + 0.6 * ((doy % 5) / 5) : 0.3;
  }
  const start = c.sowMonths[0] * MONTH_DAYS + 1;
  let d = ((doy - start) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
  let g = 0;
  for (let k = 1; k <= d; k++) g += unitsOn(crop, start + k) / c.need;
  if (g >= 1) {
    // past ripe: harvested one harvest-month later
    const ripeFor = d - Math.ceil(c.need); // rough
    if (ripeFor > c.witherDays) return null;
    return 1;
  }
  return g;
}

// how tools map to simulation job types, and what counts as "done" for a job on a field
export const TOOL_JOB = { plough: 'plough', cultivate: 'plough', harvest: 'harvest', mow: 'mow' }; // + seed:* → sow
