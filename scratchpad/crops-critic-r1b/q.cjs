const path = require('path'); const R = path.resolve(__dirname, '../..');
const puppeteer = require(R + '/node_modules/puppeteer-core'); const { findChrome, chromeArgs } = require(R + '/tools/shot.js');
(async () => { const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: chromeArgs() }); const p = await b.newPage();
  await p.goto('http://localhost:5173/?seed=harvest-1'); await p.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 120000 });
  console.log(await p.evaluate(() => { const G = window.__GAME__, sim = G.modules.get('simulation'), C = G.modules.get('crops');
    const ps = sim.parcels(); const byState = {}; for (const q of ps) byState[q.state] = (byState[q.state] || 0) + 1;
    return JSON.stringify({ byState, sample: ps.slice(0, 2).map((q) => Object.keys(q)), fields: C.fields().length, mods: G.health().map((m) => m.id + ':' + m.status).join(' ') }); }));
  await b.close(); })();
