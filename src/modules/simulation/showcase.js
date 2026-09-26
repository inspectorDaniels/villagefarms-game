// Showcase: fast-forwards two simulated years with a scripted farmer, then paints the
// farm office board (screen layer, cached; only a light/lamp overlay is drawn per frame).
import { createPainter, INK_SOFT } from './paint.js';
import { createBoard, euro, dayLabel } from './board.js';
import { createFarmer, defineShowcaseValley } from './farmer.js';
import { YEAR_DAYS, DAY_SECONDS, ITEMS } from './data.js';

const mod36 = (d) => ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
const BASE_W = 1600, BASE_H = 900;
const CHART_ITEMS = ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'milk'];

export const presets = {
  default: { camera: { x: 64, y: 64, zoom: 16 }, time: '10:00', day: 25 },
  market: { camera: { x: 64, y: 64, zoom: 16 }, time: '10:00', day: 25 },
  jobs: { camera: { x: 64, y: 64, zoom: 16 }, time: '16:30', day: 25 },
  land: { camera: { x: 64, y: 64, zoom: 16 }, time: '12:00', day: 25 },
};

/** run two simulated years ending today; leaves the live sim in that state */
export function fastForwardShowcase(ctx, sim) {
  const years = 2;
  sim.tOffset = years * YEAR_DAYS * DAY_SECONDS; // present the history as years 1–3
  const today = sim.today();
  const start = today - years * YEAR_DAYS;
  sim.reset(start, { historyDays: YEAR_DAYS });
  sim.virtualT = start * DAY_SECONDS + 6 * 3600;
  const { ids, decor } = defineShowcaseValley(sim.api);
  sim.showcaseDecor = decor;
  const farmer = createFarmer(sim, { parcelId: ids.linde, ha: 5, crop: 'wheat', jobs: true, loan: 26000, rng: ctx.rng('showcase-farmer') });
  farmer.setup();
  sim.fastForward(start, today, (d) => farmer.day(d));
  // show some work in progress on today's accepted jobs
  const acc = sim.api.jobs('accepted');
  acc.forEach((j, i) => sim.api.reportProgress(j.id, [0.45, 0.2, 0.7][i % 3]));
  return { start, today, ids };
}

function snapshot(sim) {
  const api = sim.api;
  const E = sim.world.economy;
  const today = sim.today();
  const sps = api.sellPoints().map((sp) => ({
    ...sp,
    quotes: (sp.accepts || Object.keys(ITEMS)).filter((k) => ITEMS[k]).slice(0, 3).map((k) => {
      const ref = E.prices[k];
      const p = api.price(k, sp.id);
      const sat = E.market.sat[sp.id] && E.market.sat[sp.id][k] ? 1 - (1 - 0.25 * (1 - Math.exp(-E.market.sat[sp.id][k]))) : 0;
      return { item: k, price: p, ref, sat };
    }),
  }));
  const history = {};
  for (const id of CHART_ITEMS) history[id] = api.priceHistory(id).filter((q) => q[0] > today - 3 * YEAR_DAYS);
  const rep = api.reputation() || { overall: 0.5, clients: {} };
  const monthlyJobs = [];
  for (let m = 11; m >= 0; m--) {
    const d0 = (Math.floor(today / 3) - m) * 3;
    const v = E.days.filter((b) => b.day >= d0 && b.day < d0 + 3).reduce((a, b) => a + (b.by.jobs || 0), 0);
    monthlyJobs.push({ month: Math.floor(mod36(d0) / 3), v });
  }
  return {
    monthlyJobs, prices: { ...E.prices }, today, money: api.money(), ledger: E.ledger.slice(-80).reverse(), loans: api.loans(), summary: api.summary(YEAR_DAYS),
    chartItems: CHART_ITEMS, history, sellPoints: sps, parcels: api.parcels(), jobs: api.jobs(), inventory: api.inventory(),
    assets: api.assets(), workers: api.workers(), rep: rep.overall, clients: rep.clients, jobStats: { ...sim.world.jobs.stats }, decor: sim.showcaseDecor || null,
  };
}

const ORDER = { accepted: 0, offered: 1, completed: 2, failed: 3, expired: 4 };

export function createShowcaseView(ctx, sim) {
  const P = createPainter(ctx.art, ctx.palette);
  const B = createBoard(P, ctx.art);
  let cache = null, cacheKey = '', corkImg = null;
  let preset = 'default';

  function pinAt(g, cx, cy, rot, h, color, dx = 0) {
    const y = -h / 2 + 16;
    P.pin(g, cx + dx * Math.cos(rot) - y * Math.sin(rot), cy + dx * Math.sin(rot) + y * Math.cos(rot), color);
  }
  function tapeAt(g, cx, cy, rot, w, h, rng) {
    const y = -h / 2 + 2;
    for (const dx of [-w / 2 + 30, w / 2 - 30]) P.tape(g, cx + dx * Math.cos(rot) - y * Math.sin(rot), cy + dx * Math.sin(rot) + y * Math.cos(rot), 70, rot + (dx < 0 ? -0.5 : 0.5), rng);
  }

  function paint(g, D) {
    const rng = ctx.art.rng('board:' + preset);
    if (!corkImg) corkImg = P.cork(BASE_W, BASE_H);
    g.drawImage(corkImg, 0, 0);
    const date = dayLabel(D.today, true);
    if (preset === 'default') {
      B.titleStrip(g, 800, 52, -0.008, 470, 64, 'Hoeve Ter Linde — farm office', date, rng);
      pinAt(g, 800, 52, -0.008, 64, '#3f6b3a', -200); pinAt(g, 800, 52, -0.008, 64, '#3f6b3a', 200);
      B.ledger(g, 262, 478, -0.018, 440, 770, D, rng, 18);
      tapeAt(g, 262, 478, -0.018, 440, 770, rng);
      B.priceSheet(g, 822, 300, 0.012, 610, 370, D, rng, false);
      pinAt(g, 822, 300, 0.012, 370, '#b8352b');
      B.landMap(g, 808, 694, -0.01, 610, 360, D, rng, false);
      pinAt(g, 808, 694, -0.01, 360, '#2f5f9a', -250); pinAt(g, 808, 694, -0.01, 360, '#2f5f9a', 250);
      const jobs = D.jobs.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.pay - a.pay).slice(0, 3);
      jobs.forEach((j, i) => {
        const cx = 1330 + (i % 2 ? 12 : -6), cy = 132 + i * 164, rot = [0.03, -0.022, 0.015][i];
        B.jobCard(g, cx, cy, rot, 380, 150, j, D, rng);
        pinAt(g, cx, cy, rot, 150, ['#e0b12e', '#b8352b', '#3f6b3a'][i]);
      });
      B.pnlCard(g, 1334, 736, -0.014, 380, 262, D, rng);
      pinAt(g, 1334, 736, -0.014, 262, '#e0b12e');
    } else if (preset === 'market') {
      B.priceSheet(g, 612, 462, -0.006, 1130, 800, D, rng, true);
      tapeAt(g, 612, 462, -0.006, 1130, 800, rng);
      B.quotesCard(g, 1380, 372, 0.02, 350, 640, D, rng);
      pinAt(g, 1380, 372, 0.02, 640, '#b8352b');
      B.note(g, 1372, 790, -0.04, 300, 118, ['Wheat: sell half off the', 'combine, store the rest —', 'the carry pays by spring.'], rng);
      pinAt(g, 1372, 790, -0.04, 118, '#3f6b3a');
    } else if (preset === 'jobs') {
      B.titleStrip(g, 600, 56, 0.006, 520, 66, 'Jobs board — Ter Beek & around', `${date} · offers from the neighbours`, rng);
      pinAt(g, 600, 56, 0.006, 66, '#b8352b', -220); pinAt(g, 600, 56, 0.006, 66, '#b8352b', 220);
      const jobs = D.jobs.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.pay - a.pay).slice(0, 9);
      jobs.forEach((j, i) => {
        const c = i % 3, r = Math.floor(i / 3);
        const jr = ctx.art.rng('jobpos' + i);
        const cx = 240 + c * 392 + jr.range(-10, 10), cy = 210 + r * 236 + jr.range(-8, 8), rot = jr.range(-0.035, 0.035);
        B.jobCard(g, cx, cy, rot, 372, 162, j, D, rng);
        pinAt(g, cx, cy, rot, 162, ['#e0b12e', '#b8352b', '#3f6b3a', '#2f5f9a'][i % 4]);
      });
      B.rosterCard(g, 1400, 286, 0.018, 330, 420, D, rng);
      pinAt(g, 1400, 286, 0.018, 420, '#2f5f9a');
      B.farmCard(g, 1396, 700, -0.02, 330, 250, D, rng);
      tapeAt(g, 1396, 700, -0.02, 330, 250, rng);
    } else if (preset === 'land') {
      B.landMap(g, 604, 458, -0.007, 1110, 810, D, rng, true);
      tapeAt(g, 604, 458, -0.007, 1110, 810, rng);
      B.farmCard(g, 1386, 200, 0.02, 350, 260, D, rng);
      pinAt(g, 1386, 200, 0.02, 260, '#3f6b3a');
      registerCard(g, 1382, 610, -0.015, 360, 470, D, rng);
      pinAt(g, 1382, 610, -0.015, 470, '#b8352b');
    }
    P.timberFrame(g, BASE_W, BASE_H, 26);
  }

  function registerCard(g, cx, cy, rot, w, h, D, rng) {
    const img = P.paper(w, h, { tone: 'cream', ruled: 30, ruledTop: 84, deckle: 0.8 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, 'Land register', 20, 42, { size: 24, italic: true });
      P.text(g, 'soil quality · status · value', 20, 64, { size: 12, italic: true, color: INK_SOFT });
      let y = 108;
      for (const p of D.parcels) {
        if (y > h - 20) break;
        P.text(g, p.name.replace(/ \(.*\)/, ''), 18, y, { size: 13.5, italic: true, maxW: 120 });
        const q = Math.round(p.soil * 5);
        P.text(g, '●'.repeat(q) + '○'.repeat(5 - q), 142, y, { size: 10, color: '#6e5238' });
        const st = { owned: 'ours', rented: 'rented', forSale: euro(p.price), forRent: `${euro(p.rentPerHaYear)}/ha`, npc: 'neighbour' }[p.state];
        P.text(g, st, w - 18, y, { size: 12.5, align: 'right', color: p.state === 'forSale' || p.state === 'forRent' ? '#8a4a1a' : INK_SOFT });
        y += 30;
      }
    });
  }

  function build(W, H, dpr, D) {
    const c = ctx.art.canvas(W * dpr, H * dpr);
    const g = c.getContext('2d');
    g.fillStyle = '#4a3522'; g.fillRect(0, 0, c.width, c.height);
    const s = Math.min(W / BASE_W, H / BASE_H);
    g.setTransform(s * dpr, 0, 0, s * dpr, ((W - BASE_W * s) / 2) * dpr, ((H - BASE_H * s) / 2) * dpr);
    paint(g, D);
    return c;
  }

  function ensure(W, H, dpr) {
    const E = sim.world.economy;
    const key = [W, H, dpr, preset, E.version, E.lastDay].join('|');
    if (key !== cacheKey || !cache) { cache = build(W, H, dpr, snapshot(sim)); cacheKey = key; }
    return cache;
  }

  /** how dark the office is: 0 noon … 1 night; warm = dusk/dawn tint strength */
  function lightAt(tod) {
    const env = ctx.world.environment;
    let day;
    if (env && Number.isFinite(env.daylight)) day = env.daylight;
    else day = Math.max(0, Math.min(1, (Math.sin(((tod - 6.2) / 13.6) * Math.PI) + 0.12) * 1.6));
    const warm = Math.max(0, 1 - Math.abs(day - 0.45) / 0.45) * (tod > 12 ? 1 : 0.7);
    return { night: 1 - day, warm };
  }

  function drawLayer(g) {
    const dpr = g.canvas.width / Math.max(1, g.canvas.clientWidth || g.canvas.width);
    const W = g.canvas.width / dpr, H = g.canvas.height / dpr;
    const img = ensure(Math.round(W), Math.round(H), dpr, null);
    g.drawImage(img, 0, 0, W, H);
    const { night, warm } = lightAt(ctx.clock.timeOfDay);
    const s = Math.min(W / BASE_W, H / BASE_H), ox = (W - BASE_W * s) / 2, oy = (H - BASE_H * s) / 2;
    if (warm > 0.02) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(255,${Math.round(214 - 40 * warm)},${Math.round(170 - 60 * warm)},${0.35 * warm})`;
      g.fillRect(0, 0, W, H);
    }
    if (night > 0.03) {
      // room darkens to cool blue; a desk lamp keeps the ledger corner warm
      g.globalCompositeOperation = 'multiply';
      const k = Math.pow(Math.min(1, night), 1.3) * 0.86;
      g.fillStyle = `rgb(${Math.round(255 - 185 * k)},${Math.round(255 - 170 * k)},${Math.round(255 - 110 * k)})`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      const lx = ox + 330 * s, ly = oy + 330 * s, r = 820 * s;
      const gr = g.createRadialGradient(lx, ly, 0, lx, ly, r);
      const nk = Math.pow(Math.min(1, night), 1.3);
      gr.addColorStop(0, `rgba(255,196,120,${0.62 * nk})`);
      gr.addColorStop(0.35, `rgba(240,160,90,${0.34 * nk})`);
      gr.addColorStop(0.7, `rgba(200,120,60,${0.08 * nk})`);
      gr.addColorStop(1, 'rgba(200,120,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
  }

  return {
    setPreset(p) { preset = p; cacheKey = ''; },
    prewarm() { if (typeof window !== 'undefined') ensure(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1)); },
    drawLayer,
  };
}

