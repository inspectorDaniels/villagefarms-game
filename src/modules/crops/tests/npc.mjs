// Headless neighbour-farm test (Node ≥ 14):  node src/modules/crops/tests/npc.mjs
// 36 NPC fields planted for "today" on the calendar, two game years of daily growth with a deterministic
// rain series, one NPC decision per field per day. Counts field states per month: the valley must never fill
// with withered fields, every arable field must be re-sown, and two runs must give the same digest.
import { createModel } from '../model.js';
import { createNpc } from '../npc.js';
import { CROP_IDS, YEAR_DAYS } from '../data.js';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) failures++; };
const rain = (d) => [9, 0, 4, 14, 2, 0, 7, 11, 3, 0, 6, 16, 1, 5, 0, 0, 3][d % 17] * 0.7;

function run(verbose) {
  const clock = { day: YEAR_DAYS + 6 };                      // 1 March, year 2
  const M = createModel({}, { seed: 'npc', emit() {}, sim: () => null, isNpc: () => true, now: () => ({ t: clock.day * 86400, day: clock.day, doy: clock.day % YEAR_DAYS }) });
  const npc = createNpc(M);
  const crops = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'oats', 'wheat', 'grass'];
  for (let i = 0; i < 36; i++) {
    const x = (i % 6) * 70, y = Math.floor(i / 6) * 70;
    const id = M.createField([[x, y], [x + 60, y], [x + 60, y + 60], [x, y + 60]], { state: 'stubble', soil: 0.5 + (i % 5) * 0.08 });
    M.plantAll(id, crops[i % crops.length], 'auto');
  }
  const months = [];
  let maxWithered = 0, ops = 0, sowings = {}, harvests = 0;
  for (let n = 0; n < 2 * YEAR_DAYS; n++) {
    clock.day++;
    M.dayTick(clock.day, rain(clock.day));
    for (const f of M.W.fields) { const o = npc.step(f, clock.day); if (o) { ops++; if (o.startsWith('seed:')) sowings[o.slice(5)] = (sowings[o.slice(5)] || 0) + 1; if (o === 'harvest' || o === 'mow') harvests++; } }
    const cnt = {};
    for (const f of M.W.fields) { const s = f.state === 'sown' || f.state === 'ripe' ? `${f.state}:${f.crop}` : f.state; cnt[f.state] = (cnt[f.state] || 0) + 1; }
    maxWithered = Math.max(maxWithered, cnt.withered || 0);
    if (clock.day % 3 === 0) months.push(`m${Math.floor((clock.day % YEAR_DAYS) / 3) + 1}: ` + Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(', '));
  }
  if (verbose) console.log(months.join('\n'));
  return { maxWithered, ops, sowings, harvests, digest: M.digest(), opsPerDay: ops / (2 * YEAR_DAYS) };
}
const r = run(true);
check(r.maxWithered <= 2, `max withered NPC fields on any day over 2 years: ${r.maxWithered} of 36`);
check(r.harvests >= 36, `harvests/mowings: ${r.harvests}; re-sowings by crop ${JSON.stringify(r.sowings)}`);
check(Object.keys(r.sowings).length >= 4, `rotation uses ${Object.keys(r.sowings).length} crops`);
check(run(false).digest === r.digest, `deterministic: digest ${r.digest}; ${r.opsPerDay.toFixed(1)} field operations per day`);
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
