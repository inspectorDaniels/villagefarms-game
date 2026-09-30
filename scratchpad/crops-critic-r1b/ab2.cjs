const path = require('path'); const R = path.resolve(__dirname, '../..');
const puppeteer = require(R + '/node_modules/puppeteer-core'); const { findChrome, chromeArgs } = require(R + '/tools/shot.js');
const variant = process.argv[2]; // 'fields' | 'none' | 'big'
(async () => {
  const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  const p = await b.newPage(); const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/?seed=harvest-1'); await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 120000 });
  const r = await p.evaluate(async (variant) => {
    const G = window.__GAME__, C = G.modules.get('crops');
    const x0 = 600, y0 = 640, crops = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'grass', 'oats'];
    const out = { variant };
    if (variant === 'fields') for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
      const x = x0 + i * 62, y = y0 + j * 70;
      const id = C.createField([[x, y], [x + 58, y + 1], [x + 57, y + 64], [x - 1, y + 63]], { state: 'stubble', paintTerrain: false });
      C.plantAll(id, crops[(i + j * 6) % crops.length], (i + j) % 6);
    }
    if (variant === 'big') {
      for (let i = 0; i < 20; i++) { const x = 40 + (i % 5) * 192, y = 150 + Math.floor(i / 5) * 160; const id = C.createField([[x, y], [x + 188, y], [x + 188, y + 156], [x, y + 156]], { state: 'stubble', paintTerrain: false }); C.plantAll(id, crops[i % 8], 2); }
      out.ha = +(C.fields().reduce((a, f) => a + f.area, 0) / 1e4).toFixed(1);
      G.setCamera(500, 500, 6); await G.waitFrames(120);
      const samples = [];
      G.world.time.t = (G.clock.day + 1) * 86400 + 8 * 3600;
      for (let k = 0; k < 90; k++) { await G.waitFrames(1); const h = G.health().find((m) => m.id === 'crops'); samples.push(h.ms); }
      samples.sort((a, b) => a - b);
      out.dayFrames = { mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2), p95: +samples[Math.floor(samples.length * 0.95)].toFixed(2), max: +samples[samples.length - 1].toFixed(2) };
      return out;
    }
    for (const zoom of [24]) {
      G.setCamera(x0, y0 + 100, zoom); await G.waitFrames(120);
      let x = x0; const fr = [], cm = [];
      for (let f = 0; f < 240; f++) { x += 1.5 / zoom; G.setCamera(x, y0 + 100 + Math.sin(f / 30) * 20, zoom); const t0 = performance.now(); await G.waitFrames(1); fr.push(performance.now() - t0); const h = G.health().find((m) => m.id === 'crops'); cm.push(h.ms); }
      const s = G.stats(); const avg = (a) => +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2);
      out['z' + zoom] = { frameMsAvg: s.frameMsAvg, p95: s.frameMsP95, wallPerFrame: avg(fr), cropsMsPan: avg(cm) };
      await G.waitFrames(200); const s2 = G.stats(); const h2 = G.health().find((m) => m.id === 'crops');
      out['z' + zoom + 'static'] = { frameMsAvg: s2.frameMsAvg, p95: s2.frameMsP95, cropsMsAvg: h2.msAvg };
    }
    G.setCamera(x0 + 180, y0 + 100, 7); await G.waitFrames(120);
    return out;
  }, variant);
  if (variant === 'fields') await p.screenshot({ path: __dirname + '/shot-patchwork.png' });
  console.log(JSON.stringify(r), 'errors:', errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
