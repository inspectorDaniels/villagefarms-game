const path = require('path'); const R = path.resolve(__dirname, '../..');
const puppeteer = require(R + '/node_modules/puppeteer-core'); const { findChrome, chromeArgs } = require(R + '/tools/shot.js');
(async () => {
  const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  const p = await b.newPage();
  await p.goto('http://localhost:5173/?seed=harvest-1&cropsdebug=1'); await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 120000 });
  const r = await p.evaluate(async () => {
    const G = window.__GAME__, C = G.modules.get('crops'), I = window.__CROPS__; const out = [];
    const snap = async (label, n = 120) => { await G.waitFrames(60); const t0 = performance.now(); await G.waitFrames(n); const s = G.stats(); const h = G.health().find((m) => m.id === 'crops'); out.push({ label, wall: +((performance.now() - t0) / n).toFixed(1), frameMsAvg: s.frameMsAvg, p95: s.frameMsP95, drawCalls: s.drawCalls, shadows: s.shadows, cropsMsAvg: +h.msAvg.toFixed(3), weather: G.world.environment && G.world.environment.weather && G.world.environment.weather.type }); };
    const x0 = 600, y0 = 640, crops = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'grass', 'oats'];
    G.setCamera(x0 + 180, y0 + 100, 24); await snap('z24 no fields');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) { const x = x0 + i * 62, y = y0 + j * 70; const id = C.createField([[x, y], [x + 58, y + 1], [x + 57, y + 64], [x - 1, y + 63]], { state: 'stubble', paintTerrain: false }); C.plantAll(id, crops[(i + j * 6) % crops.length], (i + j) % 6); }
    await snap('z24 fields'); await snap('z24 fields again');
    const R0 = I.renderer; const sway = R0.drawSway, col = R0.collect, gr = R0.drawGround;
    R0.drawSway = () => {}; await snap('no sway');
    R0.collect = () => {}; await snap('no sway, no collect');
    R0.drawGround = () => {}; await snap('nothing');
    R0.drawSway = sway; R0.collect = col; R0.drawGround = gr; await snap('restored');
    
    return out;
  });
  for (const x of r) console.log(JSON.stringify(x));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
