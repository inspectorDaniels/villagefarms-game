// Headless 10-year progression test (Node 14+):  node src/modules/simulation/tests/progression.mjs [years] [seeds]
// Runs the pure simulation with three scripted strategies × N seeds on the standard valley and prints
// year-by-year medians (min–max) of cash, net worth, land and crew, plus the r2 progression targets.
import { createSim } from '../sim.js';
import { createRng } from '../util.js';
import { defineValley, createManager, STRATEGY_INFO } from '../strategy.js';
import { YEAR_DAYS } from '../data.js';

const YEARS = Number(process.argv[2]) || 10;
const SEEDS = Number(process.argv[3]) || 8;
const START = 6; // 1 March, year 1

export function runOne(strategy, seed, years = YEARS) {
  const world = { seed, economy: {}, land: {}, jobs: {}, environment: {} };
  const sim = createSim(world, { rngFor: (n) => createRng(seed, 'simulation', n), emit: () => {}, clockT: () => 0 });
  sim.reset(START);
  sim.virtualT = START * 86400;
  const { ids } = defineValley(sim.api);
  const mgr = createManager(sim, { strategy, rng: createRng(seed, 'strategy', strategy), ids });
  mgr.setup();
  const rows = [];
  let hF = 0, hJ = 0;
  for (let y = 0; y < years; y++) {
    const d0 = START + y * YEAR_DAYS, d1 = d0 + YEAR_DAYS - 1;
    sim.fastForward(d0, d1, (d) => mgr.day(d));
    sim.virtualT = d1 * 86400 + 23 * 3600;
    const a = sim.api;
    const ps = a.parcels();
    const s = a.summary(YEAR_DAYS);
    const hFarm = mgr.stats.hFarm - hF, hJobs = mgr.stats.hJobs - hJ;
    hF = mgr.stats.hFarm; hJ = mgr.stats.hJobs;
    const jobs = s.byCategory.jobs || 0;
    rows.push({
      hFarm, hJobs,
      farmNet: s.operatingNet - jobs, // everything but contract income (contract fuel/upkeep stays in: conservative for farming)
      year: y + 1,
      cash: a.money(),
      net: a.netWorth().total,
      debt: a.netWorth().debt,
      own: ps.filter((p) => p.state === 'owned').reduce((t, p) => t + p.area / 1e4, 0),
      rent: ps.filter((p) => p.state === 'rented').reduce((t, p) => t + p.area / 1e4, 0),
      hands: a.workers().length,
      t2: a.assets().some((x) => x.category === 'tractor' && x.meta && x.meta.tier >= 2),
      combine: a.assets().some((x) => x.category === 'combine'),
      jobs,
      farm: (s.byCategory.sales || 0) + (s.byCategory.subsidy || 0),
      opNet: s.operatingNet,
    });
  }
  return rows;
}

/** brief self-check: 5 ha of rented winter wheat (plus the 0.6 ha yard), starter kit, no contract work.
 *  Returns operating net per game year for years 2..years (year 1 has no harvest yet). */
export function fiveHaWheat(seed, years = 4) {
  const world = { seed, economy: {}, land: {}, jobs: {}, environment: {} };
  const sim = createSim(world, { rngFor: (n) => createRng(seed, 'simulation', n), emit: () => {}, clockT: () => 0 });
  sim.reset(START);
  sim.virtualT = START * 86400;
  const { ids } = defineValley(sim.api);
  sim.api.endLease(ids.start); // no other land
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
const perH = (r, v, h) => { const ok = r.filter((x) => x[h] > 5); return ok.length ? String(Math.round(med(ok.map((x) => x[v] / x[h])))) : '–'; };

function main() {
  const t0 = process.hrtime();
  const all = {};
  for (const strat of Object.keys(STRATEGY_INFO)) {
    all[strat] = [];
    for (let i = 0; i < SEEDS; i++) all[strat].push(runOne(strat, 'harvest-' + (i + 1)));
  }
  for (const strat of Object.keys(all)) {
    console.log(`\n### ${strat} — ${STRATEGY_INFO[strat]}  (${SEEDS} seeds, median [min–max])`);
    console.log('| yr | cash € | net worth € | owned ha | rented ha | hands | t2 tractor | combine | contract € | crops+CAP € | op. net € | farm €/h | jobs €/h |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (let y = 0; y < YEARS; y++) {
      const r = all[strat].map((rows) => rows[y]);
      const f = (key) => `${k(med(r.map((x) => x[key])))} [${k(Math.min(...r.map((x) => x[key])))}–${k(Math.max(...r.map((x) => x[key])))}]`;
      const ha = (key) => `${med(r.map((x) => x[key])).toFixed(1)}`;
      const share = (key) => `${r.filter((x) => x[key]).length}/${r.length}`;
      console.log(`| ${y + 1} | ${f('cash')} | ${f('net')} | ${ha('own')} | ${ha('rent')} | ${med(r.map((x) => x.hands))} | ${share('t2')} | ${share('combine')} | ${k(med(r.map((x) => x.jobs)))} | ${k(med(r.map((x) => x.farm)))} | ${k(med(r.map((x) => x.opNet)))} | ${perH(r, 'farmNet', 'hFarm')} | ${perH(r, 'jobs', 'hJobs')} |`);
    }
  }
  // targets (builder = the intended path)
  const B = all.builder;
  const at = (y, fn) => B.filter((rows) => fn(rows[y - 1])).length + '/' + B.length;
  console.log('\n### r2 targets (builder strategy)');
  console.log(`- Y1 cash €35–60k: ${at(1, (r) => r.cash >= 35000 && r.cash <= 60000)} seeds  (median ${k(med(B.map((r) => r[0].cash)))})`);
  console.log(`- Y2 farmed 8–12 ha: ${at(2, (r) => r.own + r.rent >= 8 && r.own + r.rent <= 12)}; tier-2 tractor by Y2: ${at(2, (r) => r.t2)}`);
  console.log(`- first purchase (owned > yard) by Y3–4: ${at(4, (r) => r.own > 1)}; farmed 20–30 ha at Y4: ${at(4, (r) => r.own + r.rent >= 20 && r.own + r.rent <= 30)} (median ${med(B.map((r) => r[3].own + r[3].rent)).toFixed(1)} ha)`);
  console.log(`- Y8 farmed 50–80 ha: ${at(8, (r) => r.own + r.rent >= 50 && r.own + r.rent <= 80)} (median ${med(B.map((r) => r[7].own + r[7].rent)).toFixed(1)} ha); combine by Y8: ${at(8, (r) => r.combine)}; 2–3 hands: ${at(8, (r) => r.hands >= 2 && r.hands <= 3)}`);
  console.log(`- net worth ≥ €1M by Y8: ${at(8, (r) => r.net >= 1e6)} (median ${k(med(B.map((r) => r[7].net)))}); by Y10: ${at(Math.min(10, YEARS), (r) => r.net >= 1e6)}`);
  const C = all.contractor, R = all.renter;
  console.log(`- contracting plateaus: contractor contract € Y3 ${k(med(C.map((r) => r[2].jobs)))} → Y${YEARS} ${k(med(C.map((r) => r[YEARS - 1].jobs)))}`);
  console.log(`- owning beats renting (Y${YEARS} net worth): builder ${k(med(B.map((r) => r[YEARS - 1].net)))} vs renter ${k(med(R.map((r) => r[YEARS - 1].net)))} vs contractor ${k(med(C.map((r) => r[YEARS - 1].net)))}`);
  // 5 ha wheat self-check
  const five = [];
  for (let i = 0; i < SEEDS; i++) five.push(...fiveHaWheat('harvest-' + (i + 1)));
  const on = five.map((x) => x.operatingNet);
  const e = (x) => (x < 0 ? '−€' : '€') + Math.abs(Math.round(x)).toLocaleString('en-GB');
  const cat = (c) => five.reduce((t, x) => t + (x.byCategory[c] || 0), 0) / five.length;
  console.log(`\n### 5 ha rented winter wheat, starter kit, no contract work (${five.length} seed-years, years 2–4)`);
  console.log(`operating net per year: mean ${e(on.reduce((t, x) => t + x, 0) / on.length)}, median ${e(med(on))}, range ${e(Math.min(...on))} … ${e(Math.max(...on))}`);
  console.log(`mean per year: sales ${e(cat('sales'))}, CAP ${e(cat('subsidy'))}, rent ${e(cat('rent'))}, seed+fertiliser+spray ${e(cat('seed') + cat('fertiliser') + cat('spray'))}, diesel ${e(cat('fuel'))}, contractors ${e(cat('contractor'))}, upkeep ${e(cat('upkeep'))}, overheads ${e(cat('insurance'))}`);
  console.log(`\n(${Object.keys(all).length} strategies × ${SEEDS} seeds × ${YEARS} years in ${process.hrtime(t0)[0]} s)`);
}

main();
