// In-browser integration test against the REAL simulation + environment + terrain (dev server must run):
//   node src/modules/crops/tests/game.cjs
// Advances the real game clock day by day (crop growth fed by environment's rain plan), drives work()
// passes, accepts a real simulation plough job on an NPC parcel and checks it completes and pays,
// harvests wheat and sells it through simulation, lets a second field wither, saves/loads.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../../node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.resolve(__dirname, '../../../../tools/shot.js'));

(async () => {
  const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: chromeArgs() });
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/?only=terrain,environment,simulation,crops&seed=harvest-1');
  await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
  const res = await p.evaluate(async () => {
    const G = window.__GAME__;
    const C = G.modules.get('crops'), sim = G.modules.get('simulation');
    const log = [];
    const ok = (c, m) => { log.push((c ? '  ok   ' : '  FAIL ') + m); return c; };
    const nextDay = async () => { G.world.time.t = (G.clock.day + 1) * 86400 + 8 * 3600; await G.waitFrames(8); };
    const drive = (fid, tool, width) => {
      const f = G.world.crops.fields.find((x) => x.id === fid), g = f.grid;
      const tot = { cells: 0, kg: 0, item: null, bales: 0 };
      let dir = 1;
      for (let v = width / 2; v < g.nv * g.cell + width / 2 - 0.3; v += width * 0.95, dir = -dir) {
        for (let s = -1; s <= g.nu * g.cell + 1; s += 0.3) {
          const u = dir > 0 ? s : g.nu * g.cell - s;
          const r = C.work(tool, g.ox + g.ux * u + g.vx * v, g.oy + g.uy * u + g.vy * v, width, Math.atan2(g.ux * dir, -g.uy * dir));
          if (r) { tot.cells += r.cellsChanged; tot.kg += r.yieldKg || 0; if (r.item) tot.item = r.item; if (r.bales) tot.bales += r.bales.length; }
        }
      }
      return tot;
    };
    const events = {};
    for (const e of ['crops:sown', 'crops:ripe', 'crops:harvested', 'crops:withered', 'crops:worked', 'jobs:completed']) events[e] = 0;
    const counts0 = G.events();

    // ---- NPC parcels near the valley centre, so the simulation can offer area jobs on them
    const tr = G.modules.get('terrain');
    const base = tr.findDry(700, 700, 200) || { x: 700, y: 700 };
    const parcels = [];
    for (let i = 0; i < 4; i++) {
      const x = base.x - 100 + i * 60, y = base.y;
      parcels.push(sim.defineParcel({ poly: [[x, y], [x + 55, y], [x + 55, y + 70], [x, y + 70]], name: 'Test ' + i, state: 'npc', soil: 0.7 }));
    }
    const fields = parcels.map((pid) => C.createField(sim.parcel(pid).poly, { parcelId: pid, state: 'stubble' }));
    ok(fields.every(Boolean) && C.stats(fields[0]).parcelId === parcels[0], `4 fields created on NPC parcels (${C.stats(fields[0]).ha} ha each, soil ${C.stats(fields[0]).soilQuality})`);

    // ---- wait for a real area job (plough / sow / harvest / mow) on one of our parcels, then do it with work()
    G.clock.setDayOfYear(27); G.clock.set('08:00');
    await G.waitFrames(5);
    let job = null;
    for (let d = 0; d < 36 && !job; d++) {
      await nextDay();
      job = sim.jobs('offered').find((j) => ['plough', 'sow', 'harvest', 'mow'].includes(j.type) && parcels.includes(j.parcelId));
    }
    let jobField = null;
    if (ok(!!job, job ? `simulation offered "${job.title}" (${job.type}) for ${job.clientFarm} on ${job.parcelId} (pay €${job.pay})` : 'no area job offered on test parcels within 36 days')) {
      const m0 = sim.money();
      ok(sim.acceptJob(job.id), 'job accepted');
      jobField = fields[parcels.indexOf(job.parcelId)];
      let t;
      if (job.type === 'plough') t = drive(jobField, 'plough', 3);
      else if (job.type === 'sow') { C.forceStage(jobField, 'cultivated'); t = drive(jobField, 'seed:' + (job.crop || 'wheat'), 4); }
      else if (job.type === 'harvest') { C.plantAll(jobField, job.crop || 'wheat', 'ripe'); t = drive(jobField, 'harvest', 6); }
      else { C.plantAll(jobField, 'grass', 'ripe'); t = drive(jobField, 'mow', 3); }
      const j2 = sim.jobs((j) => j.id === job.id)[0];
      ok(j2 && j2.status === 'completed' && sim.money() > m0, `${job.type}: ${t.cells} cells changed by work() → job ${j2 && j2.status}, progress ${j2 && j2.progress}, paid €${(sim.money() - m0).toFixed(2)}`);
    }

    // ---- the season: field A wheat (managed), field B barley left standing
    const A = fields.find((f) => f !== jobField), B = fields.find((f) => f !== jobField && f !== A);
    G.clock.setDayOfYear(29); await G.waitFrames(10);
    drive(A, 'plough', 3); drive(A, 'cultivate', 4);
    const sw = drive(A, 'seed:wheat', 4); drive(A, 'fertilise', 12);
    drive(B, 'cultivate', 4); drive(B, 'seed:barley', 4);
    ok(C.stats(A).counts.sown === C.stats(A).cells, `wheat sown on doy ${G.clock.dayOfYear}: ${sw.cells} cells`);
    const tl = [];
    let last = null, ripeDoy = null, rainDays = 0, moist = [];
    for (let d = 0; d < 36 && ripeDoy == null; d++) {
      await nextDay();
      await G.waitFrames(4);
      const s = C.stats(A);
      moist.push(s.moisture);
      if (s.stage !== last) { tl.push(`doy ${G.clock.dayOfYear} ${s.stage}`); last = s.stage; }
      if (G.clock.dayOfYear === 3) drive(A, 'spray', 12);
      if (G.clock.dayOfYear === 7) drive(A, 'fertilise', 12);
      if (s.readiness >= 0.99) ripeDoy = G.clock.dayOfYear;
    }
    const rainPlan = Object.values(G.world.crops.rain.plan);
    ok(tl.length >= 6, 'wheat stages with real clock + environment rain: ' + tl.join(' → '));
    log.push(`       soil moisture over the season min ${Math.min(...moist).toFixed(2)} max ${Math.max(...moist).toFixed(2)}; environment rain plans recorded: ${rainPlan.length} days, mean ${(rainPlan.reduce((a, b) => a + b, 0) / Math.max(1, rainPlan.length)).toFixed(1)} mm/day`);
    ok(ripeDoy != null, `wheat ripe on doy ${ripeDoy} (${G.clock.monthName})`);
    const exp = C.stats(A).expectedYieldKg;
    const hv = drive(A, 'harvest', 6);
    const ha = C.stats(A).ha;
    ok(hv.item === 'wheat' && hv.kg / 1000 / ha > 6, `harvested ${(hv.kg / 1000).toFixed(2)} t ${hv.item} from ${ha} ha = ${(hv.kg / 1000 / ha).toFixed(2)} t/ha (expected ${(exp / 1000).toFixed(2)} t); stubble cells ${C.stats(A).counts.stubble}/${C.stats(A).cells}`);
    const price = sim.price('wheat');
    const stored = sim.addInventory('wheat', hv.kg / 1000);
    const m1 = sim.money();
    const got = sim.sell('wheat', stored);
    ok(got > 0 && sim.money() > m1, `simulation stored ${stored.toFixed(2)} t and sold for €${got.toFixed(2)} (spot €${price.toFixed(1)}/t → €${(got / stored).toFixed(1)}/t)`);
    const bl = drive(A, 'bale', 3);
    ok(bl.item === 'straw' && bl.bales > 0, `straw baled: ${(bl.kg / 1000).toFixed(2)} t in ${bl.bales} bales; bales in world ${C.bales().length}`);
    // ---- B withers
    let wd = null;
    for (let d = 0; d < 14 && wd == null; d++) { await nextDay(); await G.waitFrames(4); if (C.stats(B).counts.withered === C.stats(B).cells) wd = G.clock.dayOfYear; }
    ok(wd != null, `barley left unharvested withered on doy ${wd}`);
    // ---- events + save/load
    const counts = G.events();
    for (const k of Object.keys(events)) events[k] = (counts[k] || 0) - (counts0[k] || 0);
    ok(events['crops:ripe'] >= 2 && events['crops:withered'] >= 1 && events['crops:harvested'] >= 1, 'events ' + JSON.stringify(events));
    return { log };
  });
  console.log(res.log.join('\n'));
  if (errs.length) console.log('console errors:', errs.slice(0, 8));
  const fails = res.log.filter((l) => l.includes('FAIL')).length + errs.length;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASSED');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
