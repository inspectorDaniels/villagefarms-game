// Pan performance in the full game (dev server must run):  node src/modules/crops/tests/pan.cjs
// Lays out a 6×3 patchwork of fields, then pans the camera continuously at 3 zooms, reading
// frame CPU avg/p95 and the crops module's per-frame ms from window.__GAME__.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../../node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.resolve(__dirname, '../../../../tools/shot.js'));
(async () => {
  const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/?seed=harvest-1' + (process.argv[2] ? '&' + process.argv[2] : ''));
  await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
  const r = await p.evaluate(async () => {
    const G = window.__GAME__, C = G.modules.get('crops');
    if (!C) return { error: 'crops not loaded' };
    const x0 = 600, y0 = 640, crops = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'grass', 'oats'];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
      const x = x0 + i * 62, y = y0 + j * 70;
      const id = C.createField([[x, y], [x + 58, y + 1], [x + 57, y + 64], [x - 1, y + 63]], { state: 'stubble', paintTerrain: false });
      C.plantAll(id, crops[(i + j * 6) % crops.length], (i + j) % 6);
    }
    const out = {};
    for (const zoom of [6, 12, 30]) {
      G.setCamera(x0, y0 + 100, zoom);
      await G.waitFrames(90);                    // build chunks at this zoom
      let x = x0;
      const frames = 240;
      for (let f = 0; f < frames; f++) {         // ~8 screen px per frame, like a fast keyboard pan
        x += 8 / zoom;
        G.setCamera(x, y0 + 100 + Math.sin(f / 30) * 20, zoom);
        await G.waitFrames(1);
      }
      const s = G.stats();
      const h = G.health().find((m) => m.id === 'crops');
      out['zoom' + zoom] = { frameMsAvg: s.frameMsAvg, frameMsP95: s.frameMsP95, cropsMsAvg: h && h.msAvg, drawCalls: s.drawCalls };
      await G.waitFrames(240);                    // static camera
      const s2 = G.stats(), h2 = G.health().find((m) => m.id === 'crops');
      out['zoom' + zoom + '_static'] = { frameMsAvg: s2.frameMsAvg, frameMsP95: s2.frameMsP95, cropsMsAvg: h2 && h2.msAvg };
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  if (errs.length) console.log('console errors:', errs.slice(0, 5));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
