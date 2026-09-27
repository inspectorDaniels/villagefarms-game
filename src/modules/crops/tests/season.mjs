// Headless season test for the crops model (Node ≥ 14):  node src/modules/crops/tests/season.mjs
// create field → plough → sow wheat (October) → daily growth with rain → stages → harvest → yield + stubble
// → straw bales; a second field (barley) left unharvested → withered; grass mow/rake/bale; job progress
// reporting to a simulation stub; save/load round trip; determinism (two runs → same digest); timings.
import { createModel } from '../model.js';
import { CROPS, S, STATE_NAMES, YEAR_DAYS } from '../data.js';

const DAY = 86400;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) failures++; };
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

function rect(x, y, L, Wd, a) { // rectangle with one corner at (x,y), long side along angle a
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  return { poly: [[x, y], [x + ux * L, y + uy * L], [x + ux * L + vx * Wd, y + uy * L + vy * Wd], [x + vx * Wd, y + vy * Wd]], x, y, L, Wd, a };
}
/** drive back-and-forth passes over a rect with an implement of `width`, calling work() every 0.25 m */
function drive(M, tool, R, width) {
  const ux = Math.cos(R.a), uy = Math.sin(R.a), vx = -uy, vy = ux;
  let total = { cellsChanged: 0, yieldKg: 0, strawKg: 0, bales: 0, calls: 0, item: null };
  let dir = 1;
  for (let v = width / 2; v < R.Wd + width / 2 - 0.3; v += width * 0.95) {
    for (let s = -1; s <= R.L + 1; s += 0.25) {
      const u = dir > 0 ? s : R.L - s;
      const x = R.x + ux * u + vx * v, y = R.y + uy * u + vy * v;
      const hx = ux * dir, hy = uy * dir;
      const rot = Math.atan2(hx, -hy);
      const r = M.work(tool, x, y, width, rot);
      total.calls++;
      total.cellsChanged += r.cellsChanged; total.yieldKg += r.yieldKg || 0; total.strawKg += r.strawKg || 0;
      if (r.bales) total.bales += r.bales.length;
      if (r.item) total.item = r.item;
    }
    dir = -dir;
  }
  M.flush(0, true);
  return total;
}

function run(seed, verbose) {
  const W = {};
  const clock = { day: 1 * YEAR_DAYS + 29 }; // year 2, 30 Oct (doy 29 → October, wheat sowing window)
  const events = [];
  // simulation stub: one accepted plough job + one harvest job on parcel P1
  const jobs = [
    { id: 'job:1', type: 'plough', parcelId: 'P1', status: 'accepted', progress: 0 },
    { id: 'job:2', type: 'harvest', parcelId: 'P1', status: 'accepted', progress: 0, crop: 'wheat' },
  ];
  const simStub = {
    parcelAt: (x, y) => (x < 280 && y < 240 ? { id: 'P1' } : { id: 'P2' }),
    parcel: (id) => ({ id, soil: 0.7 }),
    jobs: (flt) => jobs.filter((j) => Object.entries(flt).every(([k, v]) => j[k] === v)).map((j) => ({ ...j })),
    reportProgress: (id, d) => { const j = jobs.find((x) => x.id === id); j.progress = Math.min(1, j.progress + d); if (j.progress >= 0.9999) j.status = 'completed'; return j.progress; },
  };
  const M = createModel(W, {
    seed, emit: (t, p) => events.push([t, p]), sim: () => simStub,
    now: () => ({ t: clock.day * DAY + 36000, day: clock.day, doy: clock.day % YEAR_DAYS }),
    moistureAt: () => 0.5,
  });
  const out = {};
  // ---- field A: 150 × 80 m (1.2 ha), rotated 12°
  const A = rect(100, 100, 150, 80, 0.21);
  const t0 = process.hrtime.bigint();
  const fa = M.createField(A.poly, { state: 'stubble' });
  out.createMs = ms(t0);
  const sA0 = M.stats(fa);
  out.areaA = sA0.area;
  if (verbose) console.log(`field A ${fa}: poly area ${(150 * 80)} m², grid cells ${sA0.cells} × ${sA0.cellSize}² m → ${sA0.area} m² (${sA0.ha} ha), parcel ${sA0.parcelId}`);

  // plough (3 m plough)
  let t1 = process.hrtime.bigint();
  const pl = drive(M, 'plough', A, 3);
  out.ploughCallUs = (ms(t1) * 1000) / pl.calls;
  const sP = M.stats(fa);
  out.plough = pl.cellsChanged;
  check(sP.counts.ploughed === sP.cells, `plough: ${pl.cellsChanged} cells changed in ${pl.calls} work() calls, ${sP.counts.ploughed}/${sP.cells} ploughed (${out.ploughCallUs.toFixed(1)} µs/call)`);
  check(jobs[0].status === 'completed' && jobs[0].progress === 1, `plough job reported to simulation: progress ${jobs[0].progress}, status ${jobs[0].status}`);
  // re-ploughing changes nothing
  check(drive(M, 'plough', A, 3).cellsChanged === 0, 'plough again → 0 cells changed (idempotent)');
  // cultivate + sow wheat (4 m drill) + fertilise
  drive(M, 'cultivate', A, 4);
  const sw = drive(M, 'seed:wheat', A, 4);
  const fe = drive(M, 'fertilise', A, 12);
  const sS = M.stats(fa);
  check(sS.counts.sown === sS.cells && sS.crop === 'wheat', `sow wheat on doy ${clock.day % 36}: ${sw.cellsChanged} cells sown, fertilised ${fe.cellsChanged}, stage "${sS.stage}"`);
  check(events.filter((e) => e[0] === 'crops:sown' && e[1].fieldId === fa).map((e) => e[1].phase).join() === 'start,complete', 'events crops:sown start + complete emitted');

  // ---- field B: barley, sown & never harvested
  const B = rect(300, 100, 60, 40, 0);
  const fb = M.createField(B.poly, { state: 'cultivated' });
  drive(M, 'seed:barley', B, 4);
  // ---- field D: wheat, same day, no fertiliser / no herbicide (management comparison)
  const D = rect(300, 300, 60, 40, 0);
  const fd = M.createField(D.poly, { state: 'cultivated' });
  drive(M, 'seed:wheat', D, 4);
  // ---- field C: grass for hay
  const Cr = rect(100, 260, 80, 40, -0.1);
  const fc = M.createField(Cr.poly, { state: 'cultivated' });

  // ---- daily growth, a deterministic wet-ish climate (mm per game day)
  const rain = (d) => [9, 0, 4, 14, 2, 0, 7, 11, 3, 0, 6, 16, 1, 5][d % 14] * (0.6 + 0.1 * (seed.length % 5));
  const timeline = [];
  let lastStage = -2, stagesSeen = [];
  let dayMs = 0, ripeDay = null;
  for (let n = 0; n < 40; n++) {
    clock.day++;
    const td = process.hrtime.bigint();
    M.dayTick(clock.day, rain(clock.day));
    dayMs += ms(td);
    const st = M.stats(fa);
    if (st.stageIndex !== lastStage) { stagesSeen.push(st.stage); lastStage = st.stageIndex; timeline.push(`doy ${clock.day % 36} ${st.stage} (g ${st.growth})`); }
    if (clock.day % 36 === 3) drive(M, 'spray', A, 12); // March: herbicide
    if (clock.day % 36 === 6) drive(M, 'fertilise', A, 12); // spring top dressing
    if (clock.day % 36 === 8) { drive(M, 'seed:grass', Cr, 4); }
    if (st.counts.ripe === st.cells && ripeDay == null) ripeDay = clock.day;
    if (ripeDay != null) break;
  }
  out.dayTickMs = dayMs / (clock.day - (YEAR_DAYS + 29));
  const sR = M.stats(fa);
  if (verbose) console.log('  wheat timeline: ' + timeline.join(' → '));
  check(stagesSeen.length >= 6, `wheat went through ${stagesSeen.length} visual stages: ${stagesSeen.join(', ')}`);
  check(ripeDay != null, `wheat ripe on day-of-year ${ripeDay % 36} (month ${Math.floor((ripeDay % 36) / 3) + 1}; calendar harvest month = Aug = 8)`);
  check(events.some((e) => e[0] === 'crops:ripe' && e[1].fieldId === fa), 'event crops:ripe emitted for field A');
  out.expected = sR.expectedYieldKg;
  out.health = M.cellAt(A.x + 40, A.y + 20);

  // ---- harvest with a 6 m header
  t1 = process.hrtime.bigint();
  const hv = drive(M, 'harvest', A, 6);
  out.harvestCallUs = (ms(t1) * 1000) / hv.calls;
  const sH = M.stats(fa);
  const ha = sH.area / 1e4;
  out.yieldKg = hv.yieldKg; out.tPerHa = hv.yieldKg / 1000 / ha; out.strawKg = hv.strawKg;
  check(hv.item === 'wheat', `harvest item "${hv.item}" (simulation item id)`);
  check(out.tPerHa > 6.5 && out.tPerHa < 10.5, `harvest: ${(hv.yieldKg / 1000).toFixed(2)} t wheat from ${ha.toFixed(3)} ha = ${out.tPerHa.toFixed(2)} t/ha (sim table ${CROPS.wheat.yieldT} t/ha, soil 0.7), expected-before ${(out.expected / 1000).toFixed(2)} t`);
  check(sH.counts.stubble === sH.cells, `after harvest: ${sH.counts.stubble}/${sH.cells} cells stubble, straw lying ${(sH.lyingKg / 1000).toFixed(2)} t (${(sH.lyingKg / 1000 / ha).toFixed(2)} t/ha)`);
  check(jobs[1].status === 'completed', `harvest job progress ${jobs[1].progress} → ${jobs[1].status}`);
  const hEv = events.filter((e) => e[0] === 'crops:harvested' && e[1].fieldId === fa);
  check(hEv.length > 0 && Math.abs(hEv.reduce((a, e) => a + e[1].kg, 0) - hv.yieldKg) < 1, `crops:harvested events: ${hEv.length}, Σkg ${hEv.reduce((a, e) => a + e[1].kg, 0).toFixed(1)}`);
  const wEv = events.filter((e) => e[0] === 'crops:worked' && e[1].fieldId === fa);
  const byTool = {};
  for (const e of wEv) byTool[e[1].tool] = (byTool[e[1].tool] || 0) + e[1].areaM2;
  check(wEv.every((e) => e[1].parcelId === 'P1' && e[1].areaM2 > 0) && byTool.plough === sH.area && byTool.harvest === sH.area, `crops:worked carries parcelId+areaM2 (for CAP): Σ areaM2 by tool ${JSON.stringify(byTool)} (field ${sH.area} m²)`);
  // straw bales
  const bl = drive(M, 'bale', A, 3);
  out.bales = bl.bales;
  check(bl.item === 'straw' && bl.bales > 0, `baled straw: ${(bl.yieldKg / 1000).toFixed(2)} t → ${bl.bales} round bales of 210 kg`);

  // ---- field B: leave unharvested → withered
  const bRipe = M.stats(fb);
  let witherDay = null;
  for (let n = 0; n < 20 && witherDay == null; n++) {
    clock.day++;
    M.dayTick(clock.day, rain(clock.day));
    if (M.stats(fb).counts.withered === M.stats(fb).cells) witherDay = clock.day;
    const sd = M.stats(fd);
    if (out.unmanagedTPerHa == null && sd.readiness >= 0.99) {
      const hd = drive(M, 'harvest', D, 6);
      out.unmanagedTPerHa = hd.yieldKg / 1000 / (sd.area / 1e4);
      out.unmanagedLag = clock.day - ripeDay;
    }
  }
  check(out.unmanagedTPerHa < out.tPerHa - 0.5, `unmanaged wheat (no fertiliser, no spray): ${(out.unmanagedTPerHa || 0).toFixed(2)} t/ha, ripened ${out.unmanagedLag} day(s) later, vs managed ${out.tPerHa.toFixed(2)} t/ha`);
  check(witherDay != null && events.some((e) => e[0] === 'crops:withered' && e[1].fieldId === fb), `barley left standing (was "${bRipe.stage}") withered on doy ${witherDay % 36} (witherDays ${CROPS.barley.witherDays}); crops:withered emitted`);
  const hb = drive(M, 'harvest', B, 6);
  check(hb.yieldKg === 0 && M.stats(fb).counts.stubble === M.stats(fb).cells, `harvesting withered barley yields ${hb.yieldKg} kg and clears it to stubble`);

  // ---- contractor (whole-field) operation: plough field D via workField
  {
    const half = M.stats(fd).area / 2;
    const wf = M.workField(fd, 'plough', { maxAreaM2: half });
    const wf2 = M.workField(fd, 'plough', {});
    check(wf.areaM2 === half && wf2.areaM2 === half && M.stats(fd).counts.ploughed === M.stats(fd).cells, `contractor workField('plough', {maxAreaM2: ${half}}) → ${wf.areaM2} m², rest → ${wf2.areaM2} m², field fully ploughed`);
  }
  // ---- grass: mow → rake → bale
  const g0 = M.stats(fc);
  const mw = drive(M, 'mow', Cr, 3);
  const rk = drive(M, 'rake', Cr, 6);
  const bg = drive(M, 'bale', Cr, 3);
  const gha = g0.area / 1e4;
  out.hayTPerHa = bg.yieldKg / 1000 / gha;
  check(mw.cellsChanged > 0 && rk.cellsChanged === mw.cellsChanged && bg.item === 'hay', `grass (${g0.stage}, g ${g0.growth}) mown ${mw.cellsChanged} cells → raked ${rk.cellsChanged} → baled ${(bg.yieldKg / 1000).toFixed(2)} t hay (${out.hayTPerHa.toFixed(2)} t/ha per cut) in ${bg.bales} bales`);
  const g1 = M.stats(fc);
  check(g1.counts.sown === g1.cells, `after baling the sward regrows (state ${g1.state}, growth ${g1.growth})`);

  // ---- hand tool on 2 m cells (characters call width 1)
  const f2 = M.createField(rect(500, 500, 10, 10, 0).poly, { state: 'grass' });
  const hr = M.work('cultivate', 503.3, 503.3, 1, 0);
  check(hr.cellsChanged === 1, `hand hoe (width 1 m) cultivates the cell under it: ${hr.cellsChanged}`);
  const miss = M.work('cultivate', 900, 900, 1, 0);
  check(miss.cellsChanged === 0 && miss.item === null, 'work() outside any field → 0 cells');
  M.removeField(f2);

  // ---- save / load round trip
  const d1 = M.digest();
  const saved = JSON.parse(JSON.stringify(M.save()));
  const W2 = {};
  const M2 = createModel(W2, { seed, emit() {}, sim: () => null, now: () => ({ t: 0, day: clock.day, doy: clock.day % 36 }) });
  M2.load(saved);
  check(M2.digest() === d1 && JSON.stringify(M2.stats(fa)) === JSON.stringify(M.stats(fa)), `save/load round trip: digest ${d1} == ${M2.digest()}, JSON ${(JSON.stringify(saved).length / 1024).toFixed(1)} KB`);
  out.digest = d1;
  out.events = events.reduce((a, e) => { a[e[0]] = (a[e[0]] || 0) + 1; return a; }, {});
  return out;
}

console.log('crops season test');
const r1 = run('harvest-1', true);
console.log('determinism');
const r2 = run('harvest-1', false);
check(r1.digest === r2.digest && r1.yieldKg === r2.yieldKg, `same seed → same digest (${r1.digest}) and yield (${r1.yieldKg.toFixed(2)} kg)`);
// ---- perf: daily tick over a large farm (≈ 60 ha of 2 m cells)
{
  const W = {};
  const M = createModel(W, { seed: 'perf', emit() {}, sim: () => null, now: () => ({ t: 0, day: 40, doy: 4 }) });
  for (let i = 0; i < 10; i++) { const id = M.createField(rect((i % 5) * 260, Math.floor(i / 5) * 260, 250, 240, 0.1 * i).poly, { state: 'cultivated' }); M.plantAll(id, 'wheat', 2); }
  const t = process.hrtime.bigint();
  for (let d = 0; d < 10; d++) M.dayTick(40 + d, 5);
  const per = ms(t) / 10;
  const cells = W.fields.reduce((a, f) => a + f.nCells, 0);
  console.log(`  perf: dayTick over ${W.fields.length} fields, ${cells} cells (${(cells * 4 / 1e4).toFixed(0)} ha) = ${per.toFixed(1)} ms/day (runs once per game day = 24 real min)`);
}
console.log(JSON.stringify({ areaA: r1.areaA, plough: r1.plough, tPerHa: +r1.tPerHa.toFixed(3), yieldKg: +r1.yieldKg.toFixed(1), strawKg: +r1.strawKg.toFixed(1), bales: r1.bales, hayTPerHa: +r1.hayTPerHa.toFixed(3), cellAtRipe: r1.health, createMs: +r1.createMs.toFixed(2), ploughCallUs: +r1.ploughCallUs.toFixed(1), harvestCallUs: +r1.harvestCallUs.toFixed(1), dayTickMs: +r1.dayTickMs.toFixed(3), events: r1.events }));
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
