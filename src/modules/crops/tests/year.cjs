// Live full-game year (dev server must run):  node src/modules/crops/tests/year.cjs [days=62]
// The real demo world (its NPC fields), real environment rain, real simulation. The clock is advanced day by
// day. Trial fields for every crop are sown mid sowing-window in pairs, managed (fertilised at sowing, sprayed
// once, top-dressed) and unmanaged. Reported: ripening day/month against the calendar, t/ha against
// simulation's table, crops:ripe events, and the NPC field states over the year (withered must stay ~0).
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../../node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.resolve(__dirname, '../../../../tools/shot.js'));
const DAYS = Number(process.argv[2] || 62);

(async () => {
  const b = await puppeteer.launch({ protocolTimeout: 1800000, executablePath: findChrome(), headless: false, args: chromeArgs() });
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/?seed=harvest-1');
  await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 120000 });
  const r = await p.evaluate(async (DAYS) => {
    const G = window.__GAME__, C = G.modules.get('crops'), sim = G.modules.get('simulation');
    const table = C.crops();
    const SOW = { oats: 8, sugarBeet: 8, potatoes: 10, maize: 11, rapeseed: 22, barley: 25, wheat: 30 };
    const trials = [];
    let i = 0;
    for (const crop of Object.keys(SOW)) for (const managed of [true, false]) {
      const x = 40 + (i % 7) * 34, y = 40 + Math.floor(i / 7) * 34; i++;
      const pid = sim.defineParcel({ poly: [[x, y], [x + 30, y], [x + 30, y + 30], [x, y + 30]], name: `Trial ${crop} ${managed ? 'M' : 'U'}`, state: 'owned', soil: 0.6 });
      const fid = C.createField(sim.parcel(pid).poly, { parcelId: pid, state: 'cultivated', paintTerrain: false });
      trials.push({ crop, managed, pid, fid, sown: null, ripe: null, t: null, sprayed: false, topped: false });
    }
    const npcIds = () => C.fields().filter((f) => { const pa = f.parcelId && sim.parcel(f.parcelId); return pa && pa.state === 'npc'; }).map((f) => f.id);
    let ripeEvents = 0;
    const ev0 = G.events()['crops:ripe'] || 0;
    const months = [];
    let maxWithered = 0;
    const startDay = G.clock.day;
    for (let n = 0; n < DAYS; n++) {
      const doy = G.clock.dayOfYear;
      for (const t of trials) {
        if (t.sown == null && doy === SOW[t.crop]) { C.applyContract({ fieldId: t.fid, operation: 'sow', crop: t.crop }); if (t.managed) C.applyContract({ fieldId: t.fid, operation: 'fertilise' }); t.sown = G.clock.day; }
        if (t.sown != null && t.ripe == null) {
          const s = C.stats(t.fid);
          if (t.managed && !t.sprayed && s.growth > 0.1) { C.applyContract({ fieldId: t.fid, operation: 'spray' }); t.sprayed = true; }
          if (t.managed && !t.topped && s.growth > 0.35) { C.applyContract({ fieldId: t.fid, operation: 'fertilise' }); t.topped = true; }
          if (s.readiness >= 0.95) {
            t.ripe = G.clock.day;
            const ha = s.area / 1e4;
            const inv0 = sim.inventory()[table[t.crop].product] || 0;
            const res = C.applyContract({ fieldId: t.fid, operation: 'harvest' });
            const got = (res && res.delivered[table[t.crop].product]) || 0;
            t.t = got / ha; t.inv = (sim.inventory()[table[t.crop].product] || 0) - inv0;
          }
        }
      }
      // NPC field states
      const ids = new Set(npcIds());
      const cnt = {};
      for (const f of C.fields()) if (ids.has(f.id)) { const k = f.state === 'sown' || f.state === 'ripe' ? f.state : f.state; cnt[k] = (cnt[k] || 0) + 1; }
      maxWithered = Math.max(maxWithered, cnt.withered || 0);
      if (doy % 3 === 1) months.push(`y${G.clock.year} ${G.clock.monthName.slice(0, 3)}: ` + Object.entries(cnt).sort().map(([k, v]) => `${k} ${v}`).join(', '));
      G.world.time.t = (G.clock.day + 1) * 86400 + 9 * 3600;
      await G.waitFrames(45);
    }
    ripeEvents = (G.events()['crops:ripe'] || 0) - ev0;
    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      trials: trials.map((t) => ({ crop: t.crop, managed: t.managed, sownDoy: t.sown == null ? null : t.sown % 36, ripeDoy: t.ripe == null ? null : t.ripe % 36,
        ripeMonth: t.ripe == null ? null : MN[Math.floor((t.ripe % 36) / 3)], calendar: table[t.crop].harvestMonths.map((m) => MN[m]).join('/'),
        tPerHa: t.t == null ? null : +t.t.toFixed(2), pctTable: t.t == null ? null : Math.round(100 * t.t / table[t.crop].yieldT) })),
      months, maxWithered, npcFields: npcIds().length, ripeEvents, days: G.clock.day - startDay,
    };
  }, DAYS);
  for (const t of r.trials) console.log(`${t.crop.padEnd(10)} ${t.managed ? 'managed  ' : 'unmanaged'} sown doy ${t.sownDoy}  ripe doy ${t.ripeDoy} (${t.ripeMonth}; calendar ${t.calendar})  ${t.tPerHa} t/ha = ${t.pctTable}% of table`);
  console.log('NPC fields:', r.npcFields, '— states over the year:');
  console.log(r.months.join('\n'));
  console.log(`max withered NPC fields on any day: ${r.maxWithered}; crops:ripe events: ${r.ripeEvents}; days run: ${r.days}`);
  if (errs.length) console.log('console errors:', errs.slice(0, 5));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
