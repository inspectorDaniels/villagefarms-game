// vehicles — scripted mechanics test (dev only). Needs the dev server on :5173.
//   node src/modules/vehicles/tests/drive.test.cjs
// Loads the full game with only=terrain,environment,roads,simulation,crops,effects,vehicles, stops the
// engine loop and advances it with engine.step(1/60) so every run is deterministic. Prints numbers
// and a PASS/FAIL line per check; exit code 1 if anything fails.
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.join(root, 'tools/shot.js'));

const ONLY = process.env.ONLY || 'terrain,environment,roads,simulation,crops,effects,audio,ui,vehicles';

(async () => {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--mute-audio'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  // SIM_FROM_GIT=1: serve src/modules/simulation/* from git HEAD (when its builder is mid-edit)
  if (process.env.SIM_FROM_GIT) {
    const { execSync } = require('child_process');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const m = req.url().match(/\/src\/modules\/simulation\/([\w.]+\.js)/);
      if (!m) return req.continue();
      try {
        const body = execSync(`git show HEAD:src/modules/simulation/${m[1]}`, { cwd: root, encoding: 'utf8' });
        req.respond({ status: 200, contentType: 'text/javascript', body });
      } catch (e) { req.continue(); }
    });
  }
  await page.goto(`http://localhost:5173/?only=${ONLY}&freeze=1&time=11:00`);
  await page.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
  const res = await page.evaluate(async () => {
    const G = window.__GAME__;
    G.engine.running = false;                    // stop rAF; we step by hand
    await new Promise((r) => setTimeout(r, 50));
    const step = (n) => { for (let i = 0; i < n; i++) G.engine.step(1 / 60); };
    const V = G.modules.get('vehicles'), T = G.modules.get('terrain'), R = G.modules.get('roads');
    const SIM = G.modules.get('simulation'), C = G.modules.get('crops');
    const out = { checks: [], nums: {} };
    const check = (name, ok, info) => out.checks.push({ name, ok: !!ok, info });
    const r2 = (x) => Math.round(x * 100) / 100;

    // ---- site: dry flat land next to a lake (or river)
    const lakes = (T && T.lakes && T.lakes()) || [];
    let lake = lakes.slice().sort((a, b) => b.r - a.r)[0];
    let site = null, toWater = null;
    const dry = (x, y, r) => { for (let a = 0; a < 8; a++) for (const d of [0, r / 2, r]) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; if (T.waterDepthAt(px, py) > 0) return false; } return true; };
    if (lake) {
      for (let k = 0; k < 16 && !site; k++) {
        const a = k / 16 * Math.PI * 2;
        const x = lake.x + Math.cos(a) * (lake.r + 45), y = lake.y + Math.sin(a) * (lake.r + 45);
        if (x > 80 && y > 80 && x < 944 && y < 944 && dry(x, y, 30)) { site = { x, y }; toWater = Math.atan2(lake.x - x, -(lake.y - y)); }
      }
    }
    if (!site) { site = T.findDry(512, 512, 200); toWater = 0; }
    out.nums.site = [r2(site.x), r2(site.y)];

    // ---- 1. grass top speed + straight line heading
    const trac = V.spawn('tractor_t2', site.x, site.y, toWater + Math.PI, { fuel: 200 }); // facing away from the lake
    const v = V.get(trac);
    check('spawn returns id + get', !!v && v.type === 'tractor_t2');
    check('enter', V.enter(trac, 'test:driver') === true && V.driverOf(trac) === 'test:driver');
    const rot0 = v.rot, x0 = v.x, y0 = v.y, fuel0 = v.fuel;
    const surf0 = V.surfaceUnder(trac);
    for (let i = 0; i < 360; i++) { V.control(trac, { throttle: 1, brake: 0, steer: 0 }); step(1); }
    const grassV = v.speed;
    const moved = Math.hypot(v.x - x0, v.y - y0);
    const expDir = [Math.sin(rot0), -Math.cos(rot0)];
    const along = ((v.x - x0) * expDir[0] + (v.y - y0) * expDir[1]);
    out.nums.grass = { surface: surf0, speedMs: r2(grassV), kmh: r2(grassV * 3.6), moved: r2(moved), along: r2(along), headingDrift: r2(v.rot - rot0) };
    check('straight: heading unchanged, moved forward', Math.abs(v.rot - rot0) < 1e-6 && along > 20 && Math.abs(moved - along) < 0.01, out.nums.grass);
    check('off-road speed < road top speed (40 km/h)', grassV < 40 / 3.6 * 0.9 && grassV > 3, r2(grassV * 3.6) + ' km/h on ' + surf0);

    // ---- 2. steering: full lock for 3 s
    const rotA = v.rot;
    for (let i = 0; i < 180; i++) { V.control(trac, { throttle: 0.5, steer: 1 }); step(1); }
    out.nums.turn = { dHeadingDeg: r2(((v.rot - rotA) * 180 / Math.PI + 540) % 360 - 180), steer: r2(v.steer), speed: r2(v.speed) };
    check('steer right turns clockwise', out.nums.turn.dHeadingDeg > 30, out.nums.turn);
    // brake to stop
    for (let i = 0; i < 180; i++) { V.control(trac, { throttle: 0, brake: 1, steer: 0 }); step(1); }
    check('brake stops (then reverses slowly)', v.speed <= 0.01, r2(v.speed));
    for (let i = 0; i < 120; i++) { V.control(trac, { throttle: 0, brake: 1, steer: 0 }); step(1); }
    out.nums.reverse = r2(v.speed);
    check('holding brake at standstill reverses', v.speed < -0.5 && v.speed > -12 / 3.6 - 0.01, r2(v.speed * 3.6) + ' km/h');
    for (let i = 0; i < 60; i++) { V.control(trac, { throttle: 1, brake: 0, steer: 0 }); step(1); }

    // ---- 3. road top speed: a straight regional road from the tractor
    const rx = v.x + 20, ry = v.y;
    R.generateNetwork({ nodes: [[rx - 30, ry - 200], [rx - 30, ry + 200]], edges: [[0, 1, 'regional']] });
    step(2);
    const trR = V.spawn('tractor_t2', rx - 30, ry - 150, Math.PI, { fuel: 200 });
    V.enter(trR, 'test:driver2');
    const vr = V.get(trR);
    for (let i = 0; i < 900; i++) { V.control(trR, { throttle: 1, steer: 0 }); step(1); }
    out.nums.road = { surface: V.surfaceUnder(trR), speedMs: r2(vr.speed), kmh: r2(vr.speed * 3.6) };
    check('road top speed ≈ 40 km/h', vr.speed > 40 / 3.6 * 0.9 && vr.speed <= 40 / 3.6 + 0.01 && out.nums.road.surface === 'road', out.nums.road);
    check('road faster than grass', vr.speed > grassV * 1.2, `${r2(vr.speed)} vs ${r2(grassV)}`);
    V.exit(trR); V.despawn(trR);
    const pk = V.spawn('pickup', rx - 30, ry - 195, Math.PI, { fuel: 60 });
    V.enter(pk, 'test:driver3');
    let pkMax = 0;
    for (let i = 0; i < 700; i++) { V.control(pk, { throttle: 1, steer: 0 }); step(1); if (V.surfaceUnder(pk) === 'road') pkMax = Math.max(pkMax, V.get(pk).speed); }
    out.nums.pickupRoad = { maxKmhOnRoad: r2(pkMax * 3.6), blocked: V.get(pk).blocked };
    check('pickup is much faster on road than tractors', pkMax * 3.6 > 70 && pkMax * 3.6 <= 90.01, out.nums.pickupRoad);
    V.exit(pk); V.despawn(pk);

    // ---- 4. plough: lower, work speed cap, fuel burn and (with crops) cells changed
    let field = null;
    const plo = V.spawn('plough_s', 0, 0, 0);
    check('attach plough', V.attach(trac, plo) === true);
    const P = V.get(plo);
    const hx = v.x - Math.sin(v.rot) * 2.4, hy = v.y + Math.cos(v.rot) * 2.4; // tractor rear hitch
    out.nums.hitchGap = r2(Math.hypot((P.x - Math.sin(P.rot) * 1.35) - hx, (P.y + Math.cos(P.rot) * 1.35) - hy));
    const fw = [Math.sin(v.rot), -Math.cos(v.rot)], rt = [Math.cos(v.rot), Math.sin(v.rot)];
    if (C && C.createField) {
      const pt = (a, b) => [v.x + fw[0] * a + rt[0] * b, v.y + fw[1] * a + rt[1] * b];
      field = C.createField([pt(-8, -10), pt(80, -10), pt(80, 10), pt(-8, 10)], { state: 'stubble' });
    }
    const before = field ? JSON.stringify(C.stats(field).counts) : null;
    V.setImplement(trac, true);
    const f1 = v.fuel, t1 = v.hours, xw = v.x, yw = v.y;
    for (let i = 0; i < 1200; i++) { V.control(trac, { throttle: 1, steer: 0 }); step(1); }
    const workV = v.speed;
    const lph = (f1 - v.fuel) / Math.max(1e-6, v.hours - t1);
    out.nums.plough = { speedMs: r2(workV), kmh: r2(workV * 3.6), dist: r2(Math.hypot(v.x - xw, v.y - yw)), fuelL: r2(f1 - v.fuel), lPerMachineHour: r2(lph), load: r2(v.load), workedM2: r2(P.workedArea) };
    check('plough caps work speed ≈ 8 km/h', workV <= 8 / 3.6 + 0.01 && workV > 8 / 3.6 * 0.9, out.nums.plough.kmh + ' km/h');
    if (field) {
      const after = C.stats(field).counts;
      out.nums.crops = { before: JSON.parse(before), after };
      check('crops cells ploughed', (after.ploughed || 0) > 10, after);
    } else {
      out.nums.crops = 'crops module absent';
    }
    // fuel while working vs idle
    V.setImplement(trac, false);
    for (let i = 0; i < 120; i++) { V.control(trac, { throttle: 0, brake: 1 }); step(1); }
    const f2 = v.fuel, t2 = v.hours;
    for (let i = 0; i < 600; i++) { V.control(trac, { throttle: 0, brake: 0 }); step(1); }
    const idleLph = (f2 - v.fuel) / Math.max(1e-6, v.hours - t2);
    out.nums.idleLph = r2(idleLph);
    check('fuel decreased; burn ∝ load (plough > idle)', v.fuel < fuel0 && lph > idleLph * 3, `work ${r2(lph)} L/h vs idle ${r2(idleLph)} L/h; total used ${r2(fuel0 - v.fuel)} L`);

    // ---- 5. blocked by a solid
    const bx = v.x + Math.sin(v.rot) * 12, by = v.y - Math.cos(v.rot) * 12;
    // (spatial is not in the page API; insert through a vehicle: a parked trailer across the path)
    const wall = V.spawn('trailer_flat', bx, by, v.rot + Math.PI / 2);
    for (let i = 0; i < 600; i++) { V.control(trac, { throttle: 1, steer: 0 }); step(1); }
    const dWall = Math.hypot(v.x - bx, v.y - by);
    out.nums.solid = { blocked: v.blocked, by: v.blockedBy, distToObstacleCentre: r2(dWall), speed: r2(v.speed), wear: r2(v.wear) };
    check('blocked by solid (no overlap)', v.blocked === 'solid' && v.blockedBy === wall && dWall > 2.2 && v.speed === 0, out.nums.solid);
    V.despawn(wall);
    // ---- 6. water: turn around and drive toward the lake
    V.detach(trac, plo); V.despawn(plo);
    const trW = V.spawn('tractor_t2', site.x, site.y, toWater, { fuel: 100 });
    V.enter(trW, 'test:w');
    const vw = V.get(trW);
    let maxDepthCentre = 0;
    for (let i = 0; i < 2400; i++) { V.control(trW, { throttle: 1, steer: 0 }); step(1); maxDepthCentre = Math.max(maxDepthCentre, T.waterDepthAt(vw.x, vw.y)); if (vw.blocked) break; }
    const front = [vw.x + Math.sin(vw.rot) * 2.4, vw.y - Math.cos(vw.rot) * 2.4];
    out.nums.water = { blocked: vw.blocked, surfaceUnder: V.surfaceUnder(trW), depthAtCentre: r2(T.waterDepthAt(vw.x, vw.y)), depthAhead: r2(T.waterDepthAt(front[0] + Math.sin(vw.rot) * 0.4, front[1] - Math.cos(vw.rot) * 0.4)), maxDepthCentre: r2(maxDepthCentre), hasLake: !!lake };
    check('deep water blocks', vw.blocked === 'water' && maxDepthCentre <= 0.6, out.nums.water);

    // ---- 7. exit position valid
    const ex = V.exit(trW);
    const inBox = (px, py, q) => { const c = Math.cos(q.rot), s = Math.sin(q.rot); const dx = px - q.x, dy = py - q.y; const lx = dx * c + dy * s, ly = -dx * s + dy * c; return Math.abs(lx) < 2.3 / 2 && Math.abs(ly) < 4.6 / 2; };
    out.nums.exit = ex;
    check('exit gives a dry spot outside the vehicle', ex && !ex.blocked && !inBox(ex.x, ex.y, vw) && T.waterDepthAt(ex.x, ex.y) < 0.2 && V.driverOf(trW) === null, ex);

    // ---- 8. economy: refuel, repair, purchase
    const m0 = SIM.money();
    v.wear = Math.max(v.wear, 0.2);
    const got = V.refuel(trac);
    const m1 = SIM.money();
    out.nums.refuel = { litres: got, paid: r2(m0 - m1), perL: r2((m0 - m1) / Math.max(1, got)), dieselQuote: r2(SIM.price('diesel')) };
    check('refuel charges diesel via simulation', got > 0 && m1 < m0 && Math.abs(v.fuel - 260) < 0.2, out.nums.refuel);
    const cost = V.repair(trac);
    out.nums.repair = { cost, money: r2(SIM.money() - m1) };
    check('repair charged, wear reset', cost > 0 && v.wear === 0 && Math.abs(SIM.money() - (m1 - cost)) < 0.01, out.nums.repair);
    const m2 = SIM.money();
    const ids = V.purchase('tillage_s', site.x + 10, site.y + 10, 0);
    out.nums.purchase = { ids, spent: r2(m2 - SIM.money()), types: (ids || []).map((id) => V.get(id).type), assets: SIM.assets().length };
    check('purchase kit via simulation catalog', ids && ids.length === 2 && m2 - SIM.money() > 1000, out.nums.purchase);
    out.nums.workRates = { plough_s: V.workRate('plough_s', 'tractor_t1'), plough_l_t2: V.workRate('plough_l', 'tractor_t2'), seeder_s: V.workRate('seeder_s') };

    // ---- 9. trailer articulation
    const tt = V.spawn('tractor_t3', site.x, site.y, toWater + Math.PI, { fuel: 300 });
    const tr = V.spawn('trailer_grain', 0, 0, 0);
    V.attach(tt, tr); V.enter(tt, 'test:t');
    const vt = V.get(tt), vtr = V.get(tr);
    let maxArt = 0, tongueErr = 0;
    for (let i = 0; i < 600; i++) {
      V.control(tt, { throttle: 0.6, steer: i < 300 ? 1 : -0.6 }); step(1);
      const art = Math.abs(((vtr.rot - vt.rot) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      maxArt = Math.max(maxArt, art);
      const hx2 = vt.x - Math.sin(vt.rot) * 2.9, hy2 = vt.y + Math.cos(vt.rot) * 2.9;
      const ax = vtr.x - Math.sin(vtr.rot) * 0.9, ay = vtr.y + Math.cos(vtr.rot) * 0.9; // trailer axle
      tongueErr = Math.max(tongueErr, Math.abs(Math.hypot(hx2 - ax, hy2 - ay) - 5.0));
    }
    out.nums.trailer = { maxArticulationDeg: r2(maxArt * 180 / Math.PI), tongueLenErr: r2(tongueErr), blocked: vt.blocked };
    check('trailer follows hitch (constant tongue, articulates)', tongueErr < 0.02 && maxArt > 0.2 && maxArt < 1.37, out.nums.trailer);

    // ---- 10. determinism: identical control sequence twice → identical pose
    const runOnce = () => {
      const id = V.spawn('tractor_t1', site.x + 3, site.y - 3, 0.3, { fuel: 80 });
      V.enter(id, 'test:det');
      for (let i = 0; i < 500; i++) { V.control(id, { throttle: i % 90 < 60 ? 1 : 0, brake: i % 90 >= 80 ? 1 : 0, steer: Math.sin(i / 40) }); step(1); }
      const q = V.get(id); const r = [q.x, q.y, q.rot, q.speed, q.fuel].map((n) => n.toFixed(9)).join(',');
      V.exit(id); V.despawn(id); return r;
    };
    // everything else parked so it is the same world both times
    const a = runOnce(), b = runOnce();
    check('deterministic replay', a === b, a);

    // ---- 11. save / load roundtrip
    const inst = G.engine.instances.find((i) => i.id === 'vehicles').inst;
    const snap = JSON.stringify(inst.save());
    const n0 = V.list().length;
    V.despawn(tt);
    inst.load(JSON.parse(snap));
    check('save/load roundtrip', V.list().length === n0 && V.get(tr).hitchedTo === tt && JSON.stringify(inst.save()) === snap, { n: n0 });

    // ---- 12. perf: 8 moving rigs, measured over 600 steps
    const rigs = [];
    for (let k = 0; k < 8; k++) {
      const id = V.spawn('tractor_t2', site.x + (k - 4) * 6, site.y + 30, toWater + Math.PI, { fuel: 200 });
      const im = V.spawn(k % 2 ? 'trailer_grain' : 'cultivator', 0, 0, 0);
      V.attach(id, im); V.enter(id, 'test:p' + k); if (k % 2 === 0) V.setImplement(id, true);
      rigs.push(id);
    }
    const vInst = inst;
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) { for (const id of rigs) V.control(id, { throttle: 1, steer: Math.sin(i / 50) * 0.3 }); vInst.update(1 / 60); }
    out.nums.perf = { msPerStep8Rigs: r2((performance.now() - t0) / 600), vehicles: V.list().length };
    return out;
  });
  const fails = res.checks.filter((c) => !c.ok);
  for (const c of res.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info !== undefined ? '  ' + JSON.stringify(c.info) : ''}`);
  console.log('numbers', JSON.stringify(res.nums, null, 1));
  console.log('console errors', errors.length, errors.slice(0, 5));
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
