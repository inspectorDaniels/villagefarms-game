// Headless progression harness (Node 14+):
//   node src/modules/simulation/tests/progression.mjs [years=10] [seeds=8] [--ai=1] [--hands=3] [--strategies=a,b]
// Runs the real module code (sim.js …) with scripted strategies × seeds on the standard valley (fits the
// 1024 m map) and prints year-by-year medians [min–max], the r3 target check and the 5 ha self-check.
// --ai multiplies AI_WORK_FACTOR (0.25) — e.g. --ai=0.5 / --ai=2 for the sensitivity runs in the README.
import { createSim } from '../sim.js';
import { createRng } from '../util.js';
import { defineValley, createManager, STRATEGY_INFO } from '../strategy.js';
import { YEAR_DAYS } from '../data.js';
import { AI_WORK_FACTOR } from '../work.js';

const args = process.argv.slice(2);
const flag = (k, def) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : def; };
const pos = args.filter((x) => !x.startsWith('--'));
const YEARS = Number(pos[0]) || 10;
const SEEDS = Number(pos[1]) || 8;
const AI_MULT = Number(flag('ai', 1));
const ONLY = flag('strategies', null);
const MAX_HANDS = Number(flag('hands', 0)) || undefined; // cap on hired hands (default 3)
const START = 6; // 1 March, year 1

function mkSim(seed) {
  const world = { seed, economy: {}, land: {}, jobs: {}, environment: {}, bounds: { w: 1024, h: 1024 } };
  const sim = createSim(world, { rngFor: (n) => createRng(seed, 'simulation', n), emit: () => {}, clockT: () => 0, aiWorkFactor: AI_WORK_FACTOR * AI_MULT });
  sim.reset(START);
  sim.virtualT = START * 86400;
  return sim;
}

export function runOne(strategy, seed, years = YEARS) {
  const sim = mkSim(seed);
  const { ids } = defineValley(sim.api);
  const mgr = createManager(sim, { strategy, rng: createRng(seed, 'strategy', strategy), ids, maxHands: MAX_HANDS });
  mgr.setup();
  const rows = [];
  let hP = 0, hJ = 0, cs = 0;
  for (let y = 0; y < years; y++) {
    const d0 = START + y * YEAR_DAYS, d1 = d0 + YEAR_DAYS - 1;
    sim.fastForward(d0, d1, (d) => mgr.day(d));
    sim.virtualT = d1 * 86400 + 23 * 3600;
    const a = sim.api;
    const ps = a.parcels();
    const s = a.summary(YEAR_DAYS);
    const jobs = s.byCategory.jobs || 0;
    const st = mgr.stats;
    rows.push({
      year: y + 1,
      cash: a.money(),
      net: a.netWorth().total,
      own: ps.filter((p) => p.state === 'owned').reduce((t, p) => t + p.area / 1e4, 0),
      rent: ps.filter((p) => p.state === 'rented').reduce((t, p) => t + p.area / 1e4, 0),
      hands: a.workers().length,
      t2: a.assets().some((x) => x.category === 'tractor' && x.meta && x.meta.tier >= 2),
      combine: a.assets().some((x) => x.category === 'combine'),
      jobs,
      farm: (s.byCategory.sales || 0) + (s.byCategory.subsidy || 0),
      contractor: -(s.byCategory.contractor || 0),
      wages: -(s.byCategory.wages || 0),
      opNet: s.operatingNet,
      farmNetExCap: s.operatingNet - jobs - (s.byCategory.subsidy || 0) + (s.byCategory.wages || 0) * 0, // farm result without CAP
      hPlayerFarm: st.hFarmPlayer - hP, hPlayerJobs: st.hJobsPlayer - hJ,
    });
    hP = st.hFarmPlayer; hJ = st.hJobsPlayer; cs = st.contractorSpend;
  }
  return rows;
}

/** brief self-check: 5 ha of rented winter wheat (plus the yard), starter kit, contractors, no contract work */
export function fiveHaWheat(seed, years = 4) {
  const sim = mkSim(seed);
  const { ids } = defineValley(sim.api);
  sim.api.endLease(ids.start);
  sim.api.defineParcel({ id: 'check:5ha', name: 'Five', poly: [[2000, 0], [2250, 0], [2250, 200], [2000, 200]], soil: 0.62, state: 'forRent' });
  sim.api.rentParcel('check:5ha');
  const mgr = createManager(sim, { strategy: 'jobs', rng: createRng(seed, 'strategy', 'five'), ids, rotation: ['wheat'], jobs: false });
  mgr.setup();
  const out = [];
  for (let y = 0; y < years; y++) {
    const d0 = START + y * YEAR_DAYS, d1 = d0 + YEAR_DAYS - 1;
    sim.fastForward(d0, d1, (d) => mgr.day(d));
    sim.virtualT = d1 * 86400 + 23 * 3600;
    if (y > 0) out.push(sim.api.summary(YEAR_DAYS));
  }
  return out;
}

const med = (v) => { const s = v.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const k = (x) => (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1000) + 'k');
const e = (x) => (x < 0 ? '−€' : '€') + Math.abs(Math.round(x)).toLocaleString('en-GB');

function main() {
  const t0 = process.hrtime();
  const all = {};
  const strategies = ONLY ? ONLY.split(',') : Object.keys(STRATEGY_INFO);
  for (const strat of strategies) {
    all[strat] = [];
    for (let i = 0; i < SEEDS; i++) all[strat].push(runOne(strat, 'harvest-' + (i + 1)));
  }
  console.log(`AI_WORK_FACTOR = ${(AI_WORK_FACTOR * AI_MULT).toFixed(3)} (×${AI_MULT}); max hands ${MAX_HANDS || 3}; ${SEEDS} seeds; valley 1024 m`);
  for (const strat of Object.keys(all)) {
    console.log(`\n### ${strat} — ${STRATEGY_INFO[strat]}  (${SEEDS} seeds, median [min–max])`);
    console.log('| yr | cash € | net worth € | owned ha | rented ha | hands | t2 tractor | combine | contract jobs € | crops+CAP € | contractors € | wages € | op. net € |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (let y = 0; y < YEARS; y++) {
      const r = all[strat].map((rows) => rows[y]);
      const f = (key) => `${k(med(r.map((x) => x[key])))} [${k(Math.min(...r.map((x) => x[key])))}–${k(Math.max(...r.map((x) => x[key])))}]`;
      const ha = (key) => `${med(r.map((x) => x[key])).toFixed(1)}`;
      const share = (key) => `${r.filter((x) => x[key]).length}/${r.length}`;
      const m = (key) => k(med(r.map((x) => x[key])));
      console.log(`| ${y + 1} | ${f('cash')} | ${f('net')} | ${ha('own')} | ${ha('rent')} | ${med(r.map((x) => x.hands))} | ${share('t2')} | ${share('combine')} | ${m('jobs')} | ${m('farm')} | ${m('contractor')} | ${m('wages')} | ${m('opNet')} |`);
    }
  }
  const B = all.builder;
  if (B) {
    const at = (y, fn) => B.filter((rows) => rows[Math.min(YEARS, y) - 1] && fn(rows[Math.min(YEARS, y) - 1])).length + '/' + B.length;
    const first = (fn) => med(B.map((rows) => { const i = rows.findIndex(fn); return i < 0 ? 99 : i + 1; }));
    console.log('\n### Targets (builder strategy; r3 milestones, r4b/r4c net-worth band and ordering)');
    console.log(`- first hand: median year ${first((r) => r.hands >= 1)} (target 2–3); 2+ hands by Y8: ${at(8, (r) => r.hands >= 2)}`);
    console.log(`- first owned parcel (beyond the yard): median year ${first((r) => r.own > 1)} (target 3–4)`);
    console.log(`- combine: median year ${first((r) => r.combine)} (target 4–6)`);
    console.log(`- farmed ha at Y8: median ${med(B.map((r) => (r[Math.min(8, YEARS) - 1] || r[r.length - 1]).own + (r[Math.min(8, YEARS) - 1] || r[r.length - 1]).rent)).toFixed(1)} (target 40–60); in range ${at(8, (r) => r.own + r.rent >= 40 && r.own + r.rent <= 60)}`);
    const nw10 = med(B.map((r) => r[Math.min(10, YEARS) - 1].net));
    console.log(`- net worth at Y10: median ${k(nw10)} (r4b target €250–400k, required at AI ×1); in range ${at(10, (r) => r.net >= 250000 && r.net <= 400000)}${AI_MULT === 1 ? (nw10 >= 250000 && nw10 <= 400000 ? '  ✔' : '  ✘') : '  (informative at this factor)'}`);
    const Y = Math.min(10, YEARS) - 1;
    const nw = {}; for (const st of Object.keys(all)) nw[st] = med(all[st].map((r) => r[Y].net));
    const cmp = Object.keys(all).map((st) => `${st} ${k(nw[st])}`).join(' · ');
    console.log(`- Y${Y + 1} net worth by strategy: ${cmp}`);
    const gt = (a, b) => nw[a] != null && nw[b] != null && nw[a] > nw[b];
    if (['jobs', 'contractor', 'smallfarm', 'renter', 'builder'].every((st) => nw[st] != null)) {
      const full = gt('builder', 'renter') && gt('renter', 'smallfarm') && gt('smallfarm', 'contractor') && gt('contractor', 'jobs');
      const relaxed = gt('builder', 'renter') && gt('renter', 'smallfarm') && gt('builder', 'jobs');
      console.log(`- r4c ordering: builder > renter > smallfarm > contractor > jobs: ${full ? 'yes' : 'no'}${AI_MULT === 1 ? ' (required at ×1) ' + (full ? '✔' : '✘') : ''}`);
      if (AI_MULT !== 1) console.log(`  relaxed rule at ×${AI_MULT} (builder > renter > smallfarm, builder > jobs; contractor vs jobs may swap): ${relaxed ? '✔' : '✘'}`);
    }
  }
  // 5 ha wheat self-check
  const five = [];
  for (let i = 0; i < SEEDS; i++) five.push(...fiveHaWheat('harvest-' + (i + 1)));
  const on = five.map((x) => x.operatingNet);
  const cat = (c) => five.reduce((t, x) => t + (x.byCategory[c] || 0), 0) / five.length;
  console.log(`\n### 5 ha rented winter wheat, contractors do the field work, no contract jobs (${five.length} seed-years, years 2–4)`);
  console.log(`operating net per year: mean ${e(on.reduce((t, x) => t + x, 0) / on.length)}, median ${e(med(on))}, range ${e(Math.min(...on))} … ${e(Math.max(...on))}`);
  console.log(`mean per year: sales ${e(cat('sales'))}, CAP ${e(cat('subsidy'))}, rent ${e(cat('rent'))}, seed+fertiliser+spray ${e(cat('seed') + cat('fertiliser') + cat('spray'))}, contractors ${e(cat('contractor'))}, overheads ${e(cat('insurance'))}, upkeep ${e(cat('upkeep'))}`);
  console.log(`\n(${Object.keys(all).length} strategies × ${SEEDS} seeds × ${YEARS} years in ${process.hrtime(t0)[0]} s)`);
}

main();
