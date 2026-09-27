// r3 time model — the single source of field-work rates (workRates()).
// Physical rate (ha per REAL hour) = width m × km/h × efficiency / 10.
// Player driving is real-time physics: ha per GAME hour = physical / clockScale (60).
// Hands and contractors work abstractly: ha per GAME hour = physical × aiWorkFactor.

export const CLOCK_SCALE = 60;
export const AI_WORK_FACTOR = 0.25;
export const HOURS_PER_DAY = 10;   // a hand's / contractor's working game-hours per game day
export const FIELD_EFF = 0.8;

export const KIT = {
  plough: { widthM: [3, 4.2, 6], kmh: [8, 8, 8] },
  cultivate: { widthM: [3, 4, 6], kmh: [10, 10, 10] },
  sow: { widthM: [3, 4, 6], kmh: [10, 10, 10], eff: 0.75 },
  spray: { widthM: 18, kmh: 10, eff: 0.6 },
  mow: { widthM: 3, kmh: 12 },
  harvest: { combine_s: { widthM: 4.5, kmh: 5, eff: 0.75 }, combine_l: { widthM: 7.5, kmh: 6, eff: 0.75 } },
  lift: { widthM: 1.5, kmh: 5, eff: 0.7 },
  bale: { widthM: 3, kmh: 12 },
  haul: { trailerT: 14, kmh: 25, loadH: 0.05 },
};

// contractor service: €/ha (spray = per pass), lead time in days (longer in peak months)
export const CONTRACTOR = {
  plough:    { perHa: 110, leadDays: [1, 2], peakLeadDays: [2, 3], peakMonths: [8, 9, 10] },
  cultivate: { perHa: 65,  leadDays: [1, 2], peakLeadDays: [2, 3], peakMonths: [2, 3, 8, 9] },
  sow:       { perHa: 75,  leadDays: [1, 2], peakLeadDays: [2, 3], peakMonths: [2, 3, 8, 9] },
  spray:     { perHa: 28,  leadDays: [1, 1], peakLeadDays: [1, 2], peakMonths: [3, 4, 5] },
  mow:       { perHa: 60,  leadDays: [1, 2], peakLeadDays: [2, 3], peakMonths: [4, 5, 6] },
  harvest:   { perHa: 180, leadDays: [1, 2], peakLeadDays: [2, 4], peakMonths: [6, 7] },
  lift:      { perHa: 430, leadDays: [1, 3], peakLeadDays: [2, 4], peakMonths: [9, 10] },
  bale:      { perHa: 55,  leadDays: [1, 2], peakLeadDays: [2, 3], peakMonths: [6, 7] },
};
export const OPS = Object.keys(CONTRACTOR);
/** which owned machine category an op needs (besides a tractor for the trailed ones) */
export const OP_NEEDS = { plough: 'tillage', cultivate: 'cultivator', sow: 'tillage', spray: 'sprayer', mow: 'mower', harvest: 'combine', lift: 'harvester', bale: 'baler' };
export const SELF_PROPELLED = { harvest: true };

const eff = (k) => (k.eff != null ? k.eff : FIELD_EFF);
const r2 = (x) => Math.round(x * 1000) / 1000;

/** physical ha per real hour; tiered ops return [t1,t2,t3] */
export function physicalRates() {
  const out = {};
  for (const op of ['plough', 'cultivate', 'sow']) { const k = KIT[op]; out[op] = k.widthM.map((w, i) => r2(w * k.kmh[i] * eff(k) / 10)); }
  for (const op of ['spray', 'mow', 'lift', 'bale']) { const k = KIT[op]; out[op] = r2(k.widthM * k.kmh * eff(k) / 10); }
  out.harvest = {};
  for (const [id, k] of Object.entries(KIT.harvest)) out.harvest[id] = r2(k.widthM * k.kmh * eff(k) / 10);
  return out;
}
function scale(rates, f) {
  const out = {};
  for (const [k, v] of Object.entries(rates)) out[k] = Array.isArray(v) ? v.map((x) => r2(x * f)) : typeof v === 'object' ? scale(v, f) : r2(v * f);
  return out;
}

/** full workRates() object for a given AI factor */
export function buildWorkRates(aiFactor = AI_WORK_FACTOR) {
  const physical = physicalRates();
  const ai = scale(physical, aiFactor);
  const player = scale(physical, 1 / CLOCK_SCALE);
  const inv = (a) => a.map((x) => r2(1 / x));
  return {
    clockScale: CLOCK_SCALE, aiWorkFactor: aiFactor, hoursPerDay: HOURS_PER_DAY, fieldEff: FIELD_EFF,
    kit: JSON.parse(JSON.stringify(KIT)), physical, ai, player,
    contractor: JSON.parse(JSON.stringify(CONTRACTOR)), needs: { ...OP_NEEDS },
    // legacy (r2 shape): AI game-hours per ha by tractor tier
    plough: inv(ai.plough), sow: inv(ai.sow), mow: [1, 1, 1].map(() => r2(1 / ai.mow)),
  };
}

/** ha per game hour for `op`, worker kind 'ai'|'player', tractor tier 1..3, combine id for harvest */
export function haPerGameHour(rates, op, who, tier = 1, combineId = 'combine_s') {
  const R = who === 'player' ? rates.player : rates.ai;
  const v = R[op];
  if (v == null) return 0;
  if (Array.isArray(v)) return v[Math.max(1, Math.min(3, tier)) - 1];
  if (op === 'harvest') return v[combineId] || v.combine_s;
  return v;
}

/** game hours for one trailer trip of `km` (player drives in real time: × clockScale / aiFactor ratio handled by caller) */
export function haulTripHours(km) { return (2 * km) / KIT.haul.kmh + KIT.haul.loadH; }
