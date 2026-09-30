const path = require('path');
const R = path.resolve(__dirname, '../..');
const puppeteer = require(R + '/node_modules/puppeteer-core');
const { findChrome, chromeArgs } = require(R + '/tools/shot.js');
(async () => {
  const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--window-size=1280,800'], defaultViewport: { width: 1280, height: 800 } });
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:5173/?seed=harvest-1&cropsdebug=1');
  await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 120000 });
  const res = await p.evaluate(async () => {
    const G = window.__GAME__, C = G.modules.get('crops'), sim = G.modules.get('simulation'), V = G.modules.get('vehicles'), CH = G.modules.get('characters');
    const out = { contracts: G.contracts(), fatal: G.fatal };
    const cropsH = () => { const h = G.health().find((m) => m.id === 'crops'); return h && { status: h.status, errors: h.errors, msgs: (h.messages || []).slice(0, 4) }; };
    out.health0 = cropsH();
    out.fields0 = C.fields().length;
    const base = G.modules.get('terrain').findDry(560, 560, 250) || { x: 560, y: 560 };
    for (let i = 0; i < 2; i++) { const x = base.x + i * 90, y = base.y; sim.defineParcel({ poly: [[x, y], [x + 80, y], [x + 80, y + 60], [x, y + 60]], name: 'Critic ' + i, state: 'owned', soil: 0.7 }); }
    const owned = sim.parcels().filter((q) => q.state === 'owned' || q.state === 'rented');
    out.base = base;
    out.owned = owned.map((q) => ({ id: q.id, ha: +(q.area / 1e4).toFixed(2), fields: C.fields().filter((f) => f.parcelId === q.id).map((f) => f.id + ':' + f.state + ':' + f.crop) }));
    // ---- A: tractor + plough across a field on an owned parcel
    const pA = owned[0];
    let fA = C.fields().find((f) => f.parcelId === pA.id);
    if (!fA) { const id = C.createField(pA.poly, { parcelId: pA.id, state: 'stubble' }); fA = C.field(id); }
    else C.forceStage(fA.id, 'stubble');
    const st0 = C.stats(fA.id);
    out.A = { field: fA.id, ha: st0.ha, cap0: sim.capShare(pA.id), counts0: st0.counts };
    const f = G.world.crops.fields.find((x) => x.id === fA.id), g = f.grid;
    // start inside the field near one end of the row axis, heading along +u
    const u0 = 6, v0 = Math.min(10, g.nv * g.cell / 2);
    const sx = g.ox + g.ux * u0 + g.vx * v0, sy = g.oy + g.uy * u0 + g.vy * v0;
    const rot = Math.atan2(g.ux, -g.uy);
    const tid = V.spawn('tractor_t2', sx, sy, rot, { owner: 'owned', fuel: 200 });
    const pid = V.spawn('plough_s', sx, sy, rot);
    out.A.attach = V.attach(tid, pid);
    V.enter(tid, 'critic:driver');
    V.setImplement(tid, true);
    let worked0 = G.events()['crops:worked'] || 0;
    const t0g = G.clock.t, tr0 = performance.now(); let maxSp = 0; for (let k = 0; k < 1500; k++) { V.control(tid, { throttle: 1, brake: 0, steer: 0 }); await G.waitFrames(1); maxSp = Math.max(maxSp, Math.abs(V.get(tid).speed || 0)); } out.A.gameS = +(G.clock.t - t0g).toFixed(1); out.A.realS = +((performance.now() - tr0) / 1000).toFixed(1); out.A.maxSpeed = maxSp;
    const vv = V.get(tid);
    out.A.moved = +Math.hypot(vv.x - sx, vv.y - sy).toFixed(1);
    G.setCamera(vv.x, vv.y, 24); await G.waitFrames(20);
    window.__shotA = true;
    G.world.time.t += 200; await G.waitFrames(5);
    const st1 = C.stats(fA.id);
    out.A.ploughedCells = st1.counts.ploughed; out.A.cellSize = st1.cellSize;
    out.A.ploughedM2 = st1.counts.ploughed * st1.cellSize ** 2;
    out.A.expectedStripM2 = +(out.A.moved * 3.0).toFixed(0);
    out.A.cap1 = sim.capShare(pA.id); out.A.parcelM2 = pA.area;
    out.A.workedEvents = (G.events()['crops:worked'] || 0) - worked0;
    out.A.vehiclesWorked = G.events()['vehicles:worked'] || 0;
    return out;
  });
  await p.screenshot({ path: __dirname + '/shot-plough.png' });
  const res2 = await p.evaluate(async () => {
    const G = window.__GAME__, C = G.modules.get('crops'), sim = G.modules.get('simulation'), CH = G.modules.get('characters');
    const out = {};
    const cropsH = () => { const h = G.health().find((m) => m.id === 'crops'); return h && { status: h.status, errors: h.errors, msgs: (h.messages || []).slice(0, 4) }; };
    // ---- B: contractor half-parcel plough on a second owned parcel → capShare 0.5 not 1.0
    const owned = sim.parcels().filter((q) => q.state === 'owned' || q.state === 'rented');
    const pB = owned.find((q, i) => i > 0 && q.area > 3000);
    if (pB) {
      let fB = C.fields().find((f) => f.parcelId === pB.id);
      if (!fB) { const id = C.createField(pB.poly, { parcelId: pB.id, state: 'stubble' }); fB = C.field(id); } else C.forceStage(fB.id, 'stubble');
      const cap0 = sim.capShare(pB.id);
      sim.addMoney ? sim.addMoney(50000) : null;
      const bk = sim.hireContractor(pB.id, 'plough', { areaM2: Math.round(pB.area / 2) });
      out.B = { parcel: pB.id, ha: +(pB.area / 1e4).toFixed(2), cap0, booking: bk && { id: bk.id, areaM2: bk.areaM2, price: bk.price, doneDay: bk.doneDay } };
      if (bk) {
        for (let d = 0; d < 20 && sim.contractorBookings().find((x) => x.id === bk.id).status !== 'done'; d++) { G.world.time.t = (G.clock.day + 1) * 86400 + 9 * 3600; await G.waitFrames(6); }
        await G.waitFrames(5);
        const s = C.stats(fB.id);
        out.B.status = sim.contractorBookings().find((x) => x.id === bk.id).status;
        out.B.ploughedM2 = s.counts.ploughed * s.cellSize ** 2; out.B.fieldM2 = s.area;
        out.B.cap1 = sim.capShare(pB.id);
      }
    } else out.B = 'no second owned parcel';
    // ---- C: character hoe / seed / water on field A
    const fA = C.fields()[0] && C.fields().find((f) => sim.parcel(f.parcelId) && (sim.parcel(f.parcelId).state === 'owned'));
    const chId = G.world.player && G.world.player.activeCharacterId;
    const ch = G.world.characters.list.find((c) => c.id === chId);
    out.C = { tools: CH.tools ? CH.tools() : null, ch: chId };
    if (ch && fA) {
      // stand on a stubble cell of field A
      const F = G.world.crops.fields.find((x) => x.id === fA.id), g = F.grid;
      let spot = null;
      for (let v = 6; v < g.nv * g.cell - 6 && !spot; v += 2) for (let u = g.nu * g.cell - 8; u > 6 && !spot; u -= 2) {
        const x = g.ox + g.ux * u + g.vx * v, y = g.oy + g.uy * u + g.vy * v; const c = C.cellAt(x, y);
        if (c && c.state === 'stubble') { const c2 = C.cellAt(x, y - 1.2); if (c2 && c2.state === 'stubble') spot = [x, y]; }
      }
      if (spot) {
        ch.x = spot[0]; ch.y = spot[1]; ch.rot = 0; ch.stamina = 1;
        const tgt = () => [ch.x + Math.sin(ch.rot) * 1, ch.y - Math.cos(ch.rot) * 1];
        const seq = [];
        for (const tool of (out.C.tools || []).map((t) => t.id || t).filter((t) => ['hoe', 'seed', 'water', 'wateringCan', 'can', 'seeds'].includes(t))) {
          ch.stamina = 1;
          CH.setTool(chId, tool);
          const before = C.cellAt(ch.x, ch.y - 1);
          const okUse = CH.useTool(chId, { force: true });
          await G.waitFrames(90);
          const after = C.cellAt(ch.x, ch.y - 1);
          seq.push({ tool, okUse, before: before && before.state + '/' + before.moisture, after: after && after.state + '/' + after.crop + '/' + after.moisture });
        }
        out.C.seq = seq;
      } else out.C.seq = 'no stubble spot';
    }
    // ---- D: bad input through the guarded API
    const bad = {};
    const tryit = (k, fn) => { try { bad[k] = JSON.stringify(fn()); } catch (e) { bad[k] = 'THROW ' + e.message; } };
    tryit('createField(null)', () => C.createField(null));
    tryit('createField([])', () => C.createField([]));
    tryit('work NaN', () => C.work('plough', NaN, NaN, NaN, NaN));
    tryit('work unknown', () => C.work('laser', 500, 500, 3, 0));
    tryit('work huge', () => C.work('plough', 500, 500, 1e9, 0.7, 1e9));
    tryit('applyContract garbage', () => C.applyContract({ parcelId: 'nope', operation: 'plough' }));
    tryit('applyContract bad op', () => C.applyContract({ parcelId: C.fields()[0].parcelId, operation: 'dance' }));
    tryit('forceStage bad', () => C.forceStage('nope', 'ripe'));
    tryit('simulateDays NaN', () => (C.simulateDays(NaN) || []).length);
    tryit('stats bad', () => C.stats(undefined));
    tryit('collectBale bad', () => C.collectBale(null));
    tryit('calendar NaN', () => Object.keys(C.calendar(NaN)).length);
    out.D = bad; out.healthAfterBad = cropsH();
    // ---- E: save/load via debug hooks
    const I = window.__CROPS__;
    if (I) {
      const s1 = JSON.stringify(I.model.save());
      I.model.load(JSON.parse(s1));
      const s2 = JSON.stringify(I.model.save());
      out.E = { equal: s1 === s2, kb: Math.round(s1.length / 1024), fields: G.world.crops.fields.length };
    }
    out.health = cropsH();
    out.events = Object.fromEntries(Object.entries(G.events()).filter(([k]) => k.startsWith('crops') || k.startsWith('economy:contr')));
    await G.waitFrames(120);
    const h = G.health().find((m) => m.id === 'crops'); out.msAvgStatic = h.msAvg;
    out.stats = G.stats();
    return out;
  });
  console.log(JSON.stringify(res, null, 1)); console.log(JSON.stringify(res2, null, 1));
  console.log('console:', errs.slice(0, 15));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
