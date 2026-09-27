// vehicles × characters integration (dev only): the active farmhand walks to a tractor, presses F,
// drives with W/A/D, lowers the plough with E, stops and exits with F. Synthetic keys via G.input.
//   node src/modules/vehicles/tests/characters.test.cjs      (SIM_FROM_GIT=1 if simulation is mid-edit)
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.join(root, 'tools/shot.js'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--mute-audio'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  if (process.env.SIM_FROM_GIT) {
    const { execSync } = require('child_process');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const m = req.url().match(/\/src\/modules\/simulation\/([\w.]+\.js)/);
      if (!m) return req.continue();
      try { req.respond({ status: 200, contentType: 'text/javascript', body: execSync(`git show HEAD:src/modules/simulation/${m[1]}`, { cwd: root, encoding: 'utf8' }) }); } catch (e) { req.continue(); }
    });
  }
  await page.goto('http://localhost:5173/?only=terrain,environment,roads,simulation,crops,effects,ui,vehicles,characters&freeze=1&time=21:30');
  await page.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
  const res = await page.evaluate(async () => {
    const G = window.__GAME__;
    G.engine.running = false;
    await new Promise((r) => setTimeout(r, 50));
    const step = (n) => { for (let i = 0; i < n; i++) G.engine.step(1 / 60); };
    const V = G.modules.get('vehicles'), CH = G.modules.get('characters'), T = G.modules.get('terrain');
    const out = { checks: [], log: [] };
    const check = (name, ok, info) => out.checks.push({ name, ok: !!ok, info });
    if (!CH) { check('characters module loaded', false, (G.health().find((h) => h.id === 'characters') || {}).reason); return out; }
    let s = null;
    for (let k = 0; k < 400 && !s; k++) { const x = 200 + (k % 20) * 30, y = 200 + Math.floor(k / 20) * 30; let ok = true; for (let d = -12; d <= 12; d += 3) if (T.surfaceAt(x, y + d) !== 'grass' || T.surfaceAt(x + d, y) !== 'grass') ok = false; if (ok) s = { x, y }; }
    const tr = V.spawn('tractor_t1', s.x, s.y, 0, { fuel: 100 });
    const pl = V.spawn('plough_s', 0, 0, 0); V.attach(tr, pl);
    const cid = CH.spawn({ role: 'player', name: 'Tester', x: s.x - 2.2, y: s.y });
    CH.setActive(cid);
    step(5);
    const key = (code, n) => { G.input.press(code); step(1); if (n > 1) step(n - 1); G.input.release(code); };
    key('KeyF', 1); step(2);
    check('F enters the tractor', V.driverOf(tr) === cid && CH.get(cid).vehicleId === tr, { driver: V.driverOf(tr) });
    check('headlights auto-on at night', V.get(tr).lights === true);
    const v = V.get(tr); const y0 = v.y;
    G.input.press('KeyW'); step(180);
    const sp = v.speed;
    G.input.press('KeyD'); step(60); G.input.release('KeyD');
    G.input.release('KeyW');
    check('W drives forward (north)', v.y < y0 - 5 && sp > 2, { dy: +(v.y - y0).toFixed(2), speed: +sp.toFixed(2), rot: +v.rot.toFixed(3) });
    check('D steers right (clockwise)', v.rot > 0.05, +v.rot.toFixed(3));
    key('KeyE', 1);
    check('E lowers the plough', V.get(pl).lowered === true);
    G.input.press('KeyW'); step(120); G.input.release('KeyW');
    check('work speed capped while lowered', v.speed <= 8 / 3.6 + 0.01 && v.speed > 1.5, { kmh: +(v.speed * 3.6).toFixed(2), cap: +(v.cap * 3.6).toFixed(2), blocked: v.blocked, by: v.blockedBy, surface: v.surface, load: v.load });
    const chPos = CH.get(cid);
    check('character rides with the vehicle', Math.hypot(chPos.x - v.x, chPos.y - v.y) < 0.01, { d: Math.hypot(chPos.x - v.x, chPos.y - v.y), chPos, v: [v.x, v.y] });
    G.input.press('KeyS'); step(75); G.input.release('KeyS');
    check('S brakes to a stop', Math.abs(v.speed) < 0.6, +v.speed.toFixed(2));
    key('KeyL', 1);
    check('L toggles lights off', v.lights === false);
    key('KeyF', 1); step(2);
    let c = CH.get(cid);
    const d = Math.hypot(c.x - v.x, c.y - v.y);
    check('F exits beside the vehicle', V.driverOf(tr) === null && !c.vehicleId && d > 1.2 && d < 4, { x: c.x, y: c.y, dist: +d.toFixed(2) });
    // walk into the parked tractor: character must not pass through it; walking away works
    const [ex, ey] = [c.x, c.y];
    const toV = [v.x - ex, v.y - ey];
    const k1 = Math.abs(toV[0]) > Math.abs(toV[1]) ? (toV[0] > 0 ? 'KeyD' : 'KeyA') : (toV[1] > 0 ? 'KeyS' : 'KeyW');
    const away = { KeyD: 'KeyA', KeyA: 'KeyD', KeyS: 'KeyW', KeyW: 'KeyS' }[k1];
    G.input.press(k1); step(150); G.input.release(k1);
    c = CH.get(cid);
    const inside = (() => { const cc = Math.cos(v.rot), ss = Math.sin(v.rot); const dx = c.x - v.x, dy = c.y - v.y; const lx = dx * cc + dy * ss, ly = -dx * ss + dy * cc; return Math.abs(lx) < 1.95 / 2 && Math.abs(ly) < 3.7 / 2; })();
    check('walking into the parked tractor is blocked', !inside && Math.hypot(c.x - v.x, c.y - v.y) > 1.2, { key: k1, from: [+ex.toFixed(2), +ey.toFixed(2)], to: [+c.x.toFixed(2), +c.y.toFixed(2)] });
    const [ax, ay] = [c.x, c.y];
    G.input.press(away); step(90); G.input.release(away);
    c = CH.get(cid);
    check('walking away works', Math.hypot(c.x - ax, c.y - ay) > 1.5, { moved: +Math.hypot(c.x - ax, c.y - ay).toFixed(2) });
    return out;
  });
  for (const c of res.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info !== undefined ? '  ' + JSON.stringify(c.info) : ''}`);
  console.log('console errors', errors.length, errors.slice(0, 5));
  const fails = res.checks.filter((c) => !c.ok).length;
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
