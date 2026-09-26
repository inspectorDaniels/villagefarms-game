// Headless Chrome screenshot + log tool.
//
//   node tools/shot.js --showcase terrain --preset default --time 18:30 --out shots/terrain/default_1830
//   node tools/shot.js --out shots/game/overview --cam 512,512,6 --time 22:00
//
// Options: --showcase <id> --preset <name> --time HH:MM --day N --seed S --cam x,y,zoom
//          --weather kind --w 1600 --h 900 --settle 40 (frames) --sample 90 (frames for perf)
//          --keys "KeyW:1000,Tab" (hold code:ms, or tap) --debug --nofreeze --extra "a=b&c=d"
//          --port 5173 --timeout 45000
// Writes <out>.png and <out>.json (console errors, page errors, fps, frame ms, draw calls,
// per-module timings and status, contract issues). Exit code 0 = page ready, 2 = not ready/fatal.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true; else { a[key] = next; i++; }
  }
  return a;
}

async function shot(opts) {
  const port = opts.port || 5173;
  const q = new URLSearchParams();
  if (opts.showcase) q.set('showcase', opts.showcase);
  if (opts.preset) q.set('preset', opts.preset);
  if (opts.time) q.set('time', opts.time);
  if (opts.day) q.set('day', opts.day);
  if (opts.seed) q.set('seed', opts.seed);
  if (opts.cam) q.set('cam', opts.cam);
  if (opts.weather) q.set('weather', opts.weather);
  if (opts.debug) q.set('debug', '1');
  if (!opts.nofreeze) q.set('freeze', '1');
  if (opts.extra) for (const [k, v] of new URLSearchParams(opts.extra)) q.set(k, v);
  const url = `http://localhost:${port}/?${q.toString()}`;
  const W = Number(opts.w || 1600), H = Number(opts.h || 900);
  const out = opts.out || `shots/${opts.showcase || 'game'}/${opts.preset || 'default'}_${(opts.time || 'now').replace(':', '')}`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: false, // we pass --headless=new ourselves (puppeteer 19 + modern Chrome)
    args: ['--headless=new', `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run',
      '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
  const log = {
    url, out: out + '.png', started: new Date().toISOString(), ready: false, fatal: null,
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [],
  };
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.type();
      const text = m.text();
      if (t === 'error') log.consoleErrors.push(text);
      else if (t === 'warning' || t === 'warn') log.consoleWarnings.push(text);
    });
    page.on('pageerror', (e) => log.pageErrors.push(String(e && e.message || e)));
    page.on('requestfailed', (r) => log.failedRequests.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
    page.on('response', (r) => { if (r.status() >= 400) log.failedRequests.push(`${r.status()} ${r.url()}`); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(opts.timeout || 45000) });
    try {
      await page.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: Number(opts.timeout || 45000), polling: 100 });
    } catch (e) { log.fatal = 'timeout waiting for ready'; }
    log.loadMs = Date.now() - t0;
    const g = await page.evaluate(() => ({ ready: !!window.__GAME__.ready, fatal: window.__GAME__.fatal, bootMs: window.__GAME__.bootMs }));
    log.ready = g.ready; log.fatal = log.fatal || g.fatal; log.bootMs = g.bootMs;
    if (g.ready) {
      if (opts.keys) {
        for (const part of String(opts.keys).split(',')) {
          const [code, ms] = part.split(':');
          if (ms) { await page.keyboard.down(code.startsWith('Key') ? code.slice(3) : code); await new Promise((r) => setTimeout(r, Number(ms))); await page.keyboard.up(code.startsWith('Key') ? code.slice(3) : code); }
          else await page.keyboard.press(code.startsWith('Key') ? code.slice(3) : code);
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      await page.evaluate((n) => window.__GAME__.waitFrames(n), Number(opts.settle || 40));
      await page.evaluate((n) => window.__GAME__.waitFrames(n), Number(opts.sample || 90));
      const info = await page.evaluate(() => ({
        stats: window.__GAME__.stats(), health: window.__GAME__.health(), contracts: window.__GAME__.contracts(),
        events: window.__GAME__.events ? window.__GAME__.events() : {},
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      }));
      Object.assign(log, info);
    }
    await page.screenshot({ path: out + '.png' });
  } catch (e) {
    log.fatal = log.fatal || String(e && e.message || e);
  } finally {
    await browser.close().catch(() => {});
  }
  log.durationMs = Date.now() - t0;
  const failed = (log.health || []).filter((h) => ['failed', 'disabled', 'skipped'].includes(h.status));
  log.summary = {
    ok: log.ready && !log.fatal && log.consoleErrors.length === 0 && log.pageErrors.length === 0 && failed.length === 0,
    consoleErrors: log.consoleErrors.length, pageErrors: log.pageErrors.length,
    failedModules: failed.map((f) => `${f.id}:${f.status}`),
    contractIssues: (log.contracts || []).length,
    fps: log.stats && log.stats.fps, frameMsAvg: log.stats && log.stats.frameMsAvg, frameMsP95: log.stats && log.stats.frameMsP95,
    drawCalls: log.stats && log.stats.drawCalls,
  };
  fs.writeFileSync(out + '.json', JSON.stringify(log, null, 2));
  return log;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  shot(opts).then((log) => {
    console.log(JSON.stringify({ png: log.out, ...log.summary, fatal: log.fatal, firstErrors: [...log.pageErrors, ...log.consoleErrors].slice(0, 5) }, null, 1));
    process.exit(log.ready && !log.fatal ? 0 : 2);
  }).catch((e) => { console.error(e); process.exit(3); });
}

module.exports = { shot, parseArgs };
