// Render every showcase preset of a module at several times of day.
//   node tools/shots.js terrain [--times 07:00,12:30,19:30,23:30] [--presets a,b] [--weather rain] [--tag r1]
// Output: shots/<module>/<tag>/<preset>_<HHMM>.png/.json and a summary.json.
const fs = require('fs');
const path = require('path');
const { shot, parseArgs } = require('./shot.js');
const puppeteer = require('puppeteer-core');

async function listPresets(id, port) {
  // read presets by importing the module in a headless page
  const exe = ['C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
  const b = await puppeteer.launch({ executablePath: exe, headless: false, args: ['--headless=new'] });
  try {
    const p = await b.newPage();
    await p.goto(`http://localhost:${port}/tools/blank.html`);
    return await p.evaluate(async (mid) => {
      const m = await import(`/src/modules/${mid}/index.js`);
      return Object.keys((m.showcase && m.showcase.presets) || { default: {} });
    }, id);
  } finally { await b.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const id = argv[0];
  if (!id || id.startsWith('--')) { console.error('usage: node tools/shots.js <module> [--times ..] [--presets ..]'); process.exit(1); }
  const opts = parseArgs(argv.slice(1));
  const port = opts.port || 5173;
  const times = String(opts.times || '07:00,12:30,19:30,23:30').split(',');
  const presets = opts.presets ? String(opts.presets).split(',') : await listPresets(id, port);
  const tag = opts.tag || 'latest';
  const dir = path.join('shots', id, tag);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const preset of presets) {
    for (const time of times) {
      const out = path.join(dir, `${preset}_${time.replace(':', '')}`);
      const log = await shot({ showcase: id, preset, time, out, weather: opts.weather, day: opts.day, extra: opts.extra, port, w: opts.w, h: opts.h });
      results.push({ preset, time, png: log.out, ...log.summary, fatal: log.fatal, errors: [...log.pageErrors, ...log.consoleErrors].slice(0, 5) });
      console.log(`${preset} ${time}: ok=${log.summary.ok} err=${log.summary.consoleErrors + log.summary.pageErrors} cpu=${log.summary.frameMsAvg}ms draws=${log.summary.drawCalls} -> ${log.out}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(3); });
