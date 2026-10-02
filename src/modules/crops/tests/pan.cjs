// Frame-cost A/B for crops in the full game (dev server must run):  node src/modules/crops/tests/pan.cjs
// The same camera scripts run twice in one page: first without fields, then with an 18-field patchwork
// (6×3, every crop, mixed stages). Each script is run once to warm terrain/roads/crops caches, then measured.
// Reported: frameMsAvg / p95 with and without fields, and the delta (= the real per-frame cost of crops,
// including deferred raster work that the module's own msAvg timer cannot see).
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../../node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.resolve(__dirname, '../../../../tools/shot.js'));

(async () => {
  const b = await puppeteer.launch({ protocolTimeout: 900000, executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/?seed=harvest-1&time=10:00' + (process.argv[2] ? '&' + process.argv[2] : ''));
  await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
  const r = await p.evaluate(async () => {
    const G = window.__GAME__, C = G.modules.get('crops');
    if (!C) return { error: 'crops not loaded' };
    G.clock.paused = true;
    const x0 = 600, y0 = 640, cx = x0 + 186, cy = y0 + 105;
    const N = 240;
    const scenarios = {
      static_z6: (f) => [cx, cy, 6],
      static_z12: (f) => [cx - 60, cy, 12],
      static_z24: (f) => [cx - 40, cy - 30, 24],
      pan_z12_8px: (f) => [x0 + 20 + f * 8 / 12, cy + Math.sin(f / 30) * 15, 12],          // fast keyboard pan
      follow_z24_3ms: (f) => [x0 + 30 + f * (3 / 60), cy - 30 + f * (1 / 60), 24],        // following a tractor at 3 m/s
    };
    async function run(name) {
      const fn = scenarios[name];
      for (let f = 0; f < N; f++) { const [x, y, z] = fn(f); G.setCamera(x, y, z); await G.waitFrames(1); } // warm
      for (let f = 0; f < N; f++) { const [x, y, z] = fn(f); G.setCamera(x, y, z); await G.waitFrames(1); } // measured (engine keeps the last 240 frames)
      const s = G.stats(), h = G.health().find((m) => m.id === 'crops');
      return { avg: s.frameMsAvg, p95: s.frameMsP95, cropsMsAvg: h ? h.msAvg : null, draws: s.drawCalls };
    }
    const out = { without: {}, with: {} };
    for (const n of Object.keys(scenarios)) out.without[n] = await run(n);
    const crops = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'grass', 'oats'];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
      const x = x0 + i * 62, y = y0 + j * 70;
      const id = C.createField([[x, y], [x + 58, y + 1], [x + 57, y + 64], [x - 1, y + 63]], { state: 'stubble', paintTerrain: false });
      C.plantAll(id, crops[(i + j * 6) % crops.length], (i + j) % 6);
    }
    for (const n of Object.keys(scenarios)) out.with[n] = await run(n);
    out.delta = {};
    for (const n of Object.keys(scenarios)) out.delta[n] = { avg: +(out.with[n].avg - out.without[n].avg).toFixed(2), p95: +(out.with[n].p95 - out.without[n].p95).toFixed(2) };
    return out;
  });
  if (r.error) { console.log(r.error); process.exit(1); }
  console.log('scenario            without avg/p95    with avg/p95      Δavg   Δp95   crops msAvg');
  for (const n of Object.keys(r.delta)) {
    const a = r.without[n], w = r.with[n], d = r.delta[n];
    console.log(`${n.padEnd(18)} ${String(a.avg).padStart(6)} / ${String(a.p95).padEnd(7)} ${String(w.avg).padStart(6)} / ${String(w.p95).padEnd(7)} ${String(d.avg).padStart(6)} ${String(d.p95).padStart(6)}   ${w.cropsMsAvg}`);
  }
  if (errs.length) console.log('console errors:', errs.slice(0, 5));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
