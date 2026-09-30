import { createModel } from '../../src/modules/crops/model.js';
import { YEAR_DAYS } from '../../src/modules/crops/data.js';
const DAY = 86400;
function mk(day) { const W = {}; const clock = { day }; const ev = [];
  const M = createModel(W, { seed: 'x', emit: (t, p) => ev.push([t, p]), sim: () => null,
    now: () => ({ t: clock.day * DAY + 36000, day: clock.day, doy: ((clock.day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS }), moistureAt: () => 0.5 });
  return { W, M, clock, ev }; }
const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
function run({ mm = 6, fert = 1, spray = 1, days = 8, start = YEAR_DAYS * 2 + 9, crop = 'wheat', stage = 1 }) {
  const { M, clock } = mk(start);
  const id = M.createField(sq, { state: 'ploughed', soil: 0.6 });
  M.plantAll(id, crop, stage);
  for (let i = 0; i < fert; i++) M.workField(id, 'fertilise');
  if (spray) M.workField(id, 'spray');
  const g0 = M.stats(id).growth;
  for (let d = 1; d <= days; d++) { clock.day++; M.dayTick(clock.day, typeof mm === 'function' ? mm(d) : mm); }
  // run on to ripe with 6 mm, then harvest
  let n = 0; while (M.stats(id).state !== 'ripe' && n++ < 40) { clock.day++; M.dayTick(clock.day, 6); }
  const s = M.stats(id); const r = M.workField(id, 'harvest');
  return { g8: M && +(s.growth).toFixed(2), daysExtra: n, tPerHa: +(r.yieldKg / 1000 / s.ha).toFixed(2), weeds: s.weeds, fertility: s.fertility };
}
const out = {};
for (const mm of [0, 2, 6, 15, 40]) out['rain' + mm] = run({ mm, days: 8 });
for (const fert of [0, 1, 2]) out['fert' + fert] = run({ fert });
out.noSpray = run({ spray: 0 });
out.noSprayNoFert = run({ spray: 0, fert: 0 });
out.drought20 = run({ mm: 0, days: 20 });
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), JSON.stringify(v));
