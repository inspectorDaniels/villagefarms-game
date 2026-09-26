// Showcase: a small painted farm backdrop (own gouache ground so the HUD is judged over a real
// scene even when terrain is not ready) + staging of every HUD feature per preset.

const REGION = { x: 380, y: 420, w: 280, h: 180, ppm: 7 };
const TRACK = [[372, 513], [440, 510], [512, 503], [585, 492], [668, 477]];

const FIELDS = [
  { id: 'land:1', kind: 'ploughed', angle: 0.06, poly: [[380, 400], [500, 392], [508, 500], [372, 510]] },
  { id: 'land:2', kind: 'crop', angle: -0.09, poly: [[510, 392], [640, 380], [652, 470], [518, 498]] },
  { id: 'land:3', kind: 'meadow', angle: 0, poly: [[372, 516], [508, 506], [520, 610], [380, 628]] },
  { id: 'land:4', kind: 'stubble', angle: -0.19, poly: [[520, 506], [660, 478], [690, 580], [530, 606]] },
];

export const PRESETS = {
  default: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  finances: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  market: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  jobs: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  land: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  confirm: { camera: { x: 512, y: 505, zoom: 9 }, time: '16:30', day: 7 },
  help: { camera: { x: 512, y: 505, zoom: 9 }, time: '10:00', day: 7 },
  night: { camera: { x: 512, y: 505, zoom: 9 }, time: '23:00', day: 7 },
};

function paintBackdrop(ctx) {
  const { art, palette: P } = ctx;
  const S = REGION.ppm;
  const W = REGION.w * S, H = REGION.h * S;
  const season = ctx.clock.season;
  return art.sprite(`ui:showcase-backdrop:${season}`, W, H, (g) => {
    const rng = ctx.rng('backdrop');
    const tx = (x) => (x - REGION.x) * S, ty = (y) => (y - REGION.y) * S;
    const grass = P.grass[season] || P.grass.spring;
    art.noiseFill(g, 0, 0, W, H, [grass[2], grass[0], grass[1], grass[3]], { scale: 0.006, grain: 0.05, seed: 'ui-bg-grass', px: 2 });
    art.dabs(g, rng, 2600, 0, 0, W, H, [grass[3], grass[2], P.meadow[1]], 1.5, 4.5, 0.35);

    const path = (poly) => { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y)))); g.closePath(); };
    for (const f of FIELDS) {
      g.save();
      path(f.poly);
      g.clip();
      const xs = f.poly.map((p) => tx(p[0])), ys = f.poly.map((p) => ty(p[1]));
      const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
      const cx = bx + bw / 2, cy = by + bh / 2, R = Math.hypot(bw, bh) / 2 + 4;
      const rows = (spacing, width, colors, alpha, dash) => {
        g.save();
        g.translate(cx, cy); g.rotate(f.angle);
        g.lineWidth = width; g.lineCap = 'round';
        if (dash) g.setLineDash(dash);
        for (let y = -R; y < R; y += spacing) {
          g.globalAlpha = alpha * rng.range(0.7, 1);
          g.strokeStyle = rng.pick(colors);
          g.beginPath();
          g.moveTo(-R, y + rng.range(-0.4, 0.4));
          for (let x = -R + 30; x <= R; x += 30) g.lineTo(x, y + rng.range(-0.5, 0.5));
          g.stroke();
        }
        g.restore();
        g.globalAlpha = 1;
      };
      if (f.kind === 'ploughed') {
        g.fillStyle = P.soil.ploughed; g.fillRect(bx, by, bw, bh);
        art.dabs(g, rng, 900, bx, by, bw, bh, [P.soil.moist, P.soil.dry, P.soil.wet], 4, 14, 0.18);
        rows(0.85 * S, 0.34 * S, [P.soil.furrowDark, '#4a3624'], 0.75);
        g.save(); g.translate(0.3 * S, 0); rows(0.85 * S, 0.18 * S, ['#8a6a4a', '#7a5c40'], 0.45); g.restore();
        art.dabs(g, rng, 1400, bx, by, bw, bh, ['#9a7a56', P.soil.furrowDark, '#6e5238'], 0.6, 1.6, 0.5);
      } else if (f.kind === 'crop') {
        g.fillStyle = P.soil.moist; g.fillRect(bx, by, bw, bh);
        art.dabs(g, rng, 700, bx, by, bw, bh, [P.soil.dry, P.soil.wet], 5, 16, 0.2);
        const leaf = P.foliage.spring;
        rows(0.5 * S, 0.24 * S, [leaf[0], leaf[1], leaf[3]], 0.95, [2.2, 1.4, 3, 1.1]);
        art.dabs(g, rng, 380, bx, by, bw, bh, [leaf[2], leaf[3]], 10, 30, 0.12);
      } else if (f.kind === 'meadow') {
        art.dabs(g, rng, 1600, bx, by, bw, bh, [P.meadow[0], P.meadow[1], P.meadow[3], grass[3]], 2, 7, 0.4);
        art.dabs(g, rng, 500, bx, by, bw, bh, [P.flowers[0], P.flowers[2], P.flowers[4]], 0.6, 1.3, 0.85);
      } else if (f.kind === 'stubble') {
        g.fillStyle = '#b9a770'; g.fillRect(bx, by, bw, bh);
        art.dabs(g, rng, 800, bx, by, bw, bh, ['#a8955e', '#c9b680', P.soil.dry], 4, 14, 0.25);
        rows(0.7 * S, 0.16 * S, ['#8e7c48', '#d8c690', '#a08c54'], 0.6, [1.2, 2.4]);
      }
      g.restore();
    }
    // grassy verges along field edges
    g.lineJoin = 'round';
    for (const f of FIELDS) {
      path(f.poly);
      g.strokeStyle = grass[2]; g.globalAlpha = 0.9; g.lineWidth = 3.4 * S; g.stroke();
      g.strokeStyle = grass[0]; g.globalAlpha = 0.7; g.lineWidth = 2 * S; g.stroke();
      g.globalAlpha = 1;
    }
    // tufts along verges
    for (const f of FIELDS) {
      for (let i = 0; i < f.poly.length; i++) {
        const [x0, y0] = f.poly[i], [x1, y1] = f.poly[(i + 1) % f.poly.length];
        const n = Math.round(Math.hypot(x1 - x0, y1 - y0) * 1.2);
        for (let k = 0; k < n; k++) {
          const t = rng.float();
          g.fillStyle = rng.pick([grass[3], grass[1], P.meadow[1], grass[2]]);
          g.globalAlpha = rng.range(0.4, 0.8);
          g.beginPath();
          g.ellipse(tx(x0 + (x1 - x0) * t) + rng.range(-8, 8), ty(y0 + (y1 - y0) * t) + rng.range(-8, 8), rng.range(1.5, 4), rng.range(1.2, 3), rng.float() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    // dirt track with ruts and a grass centre strip
    const track = () => { g.beginPath(); TRACK.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y)))); };
    g.lineCap = 'round';
    track(); g.strokeStyle = '#7d6446'; g.globalAlpha = 0.5; g.lineWidth = 4.4 * S; g.stroke();
    track(); g.strokeStyle = '#a58a62'; g.globalAlpha = 1; g.lineWidth = 3.4 * S; g.stroke();
    for (const off of [-0.85, 0.85]) {
      g.save(); g.translate(0, off * S); track(); g.strokeStyle = '#86694a'; g.lineWidth = 0.55 * S; g.globalAlpha = 0.8; g.stroke(); g.restore();
    }
    track(); g.strokeStyle = grass[2]; g.globalAlpha = 0.75; g.lineWidth = 0.5 * S; g.setLineDash([6, 4, 10, 5]); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 1;
    art.dabs(g, rng, 500, 0, ty(470), W, ty(530) - ty(470), ['#8f887c', '#b7b0a3'], 0.5, 1.2, 0.35);
    art.grain(g, W, H, rng, 0.05, 0.02);
  });
}

function fallbackAmbient(daylight, tod) {
  const night = [52, 62, 110], dusk = [255, 176, 128];
  const t = Math.max(0, Math.min(1, daylight));
  const warm = (tod > 15 && tod < 22 && t < 0.9 && t > 0.05) ? Math.sin(t * Math.PI) * 0.6 : 0;
  return [0, 1, 2].map((i) => night[i] + (255 - night[i]) * t + (dusk[i] - 255) * warm * t);
}

export async function stageShowcase(ctx, api, data, preset, hooks) {
  const sim = ctx.modules.get('simulation');
  const live = sim && typeof sim.money === 'function';
  if (!live) data.enableSample();
  else {
    // real simulation present: give it a little land and a couple of buyers to show, via its public API
    try {
      const has = typeof sim.parcels === 'function' ? (sim.parcels() || []).length : 1;
      if (!has && typeof sim.defineParcel === 'function') {
        const names = ['Kouter', 'Hoogveld', 'Molenakker', 'Beemd'];
        FIELDS.forEach((f, i) => sim.defineParcel({ poly: f.poly, name: names[i], state: i === 0 ? 'owned' : i === 1 ? 'rented' : 'forSale', soil: 0.6 + i * 0.08 }));
      }
      if (typeof sim.sellPoints === 'function' && !(sim.sellPoints() || []).length && typeof sim.defineSellPoint === 'function') {
        sim.defineSellPoint('mill', { name: 'Van Damme Mill', x: 610, y: 470, accepts: ['wheat', 'barley', 'oats', 'maize'] });
        sim.defineSellPoint('coop', { name: 'Hageland Co-op', x: 430, y: 610, accepts: ['wheat', 'barley', 'rapeseed', 'potatoes', 'sugarBeet'] });
      }
    } catch (e) { ctx.warn('showcase: could not seed simulation: ' + (e && e.message)); }
  }
  const terrain = ctx.modules.get('terrain');
  if (terrain && typeof terrain.generate === 'function') { try { await terrain.generate({}); } catch (e) { ctx.warn('showcase: terrain.generate failed'); } }
  const roads = ctx.modules.get('roads');
  if (roads && typeof roads.generateNetwork === 'function') { try { await roads.generateNetwork(); } catch (e) { ctx.warn('showcase: roads.generateNetwork failed'); } }
  hooks.invalidateMinimap();

  // backdrop (ground layer, drawn below any real terrain chunks)
  const img = paintBackdrop(ctx);
  ctx.renderer.addLayer('ground', (g, view) => {
    g.fillStyle = (ctx.palette.grass[ctx.clock.season] || ctx.palette.grass.spring)[2];
    g.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, REGION.x, REGION.y, REGION.w, REGION.h);
    const env = ctx.world.environment;
    if (!(env && Array.isArray(env.ambient))) {
      const a = fallbackAmbient(data.daylight(), ctx.clock.timeOfDay);
      if (a[0] < 254 || a[2] < 254) {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = `rgb(${a.map((v) => Math.round(v)).join(',')})`;
        g.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
        g.globalCompositeOperation = 'source-over';
      }
    }
  }, -100);

  const night = preset === 'night';
  api.setToolbar([
    { id: 'hand', label: 'Bare hands', icon: 'hand', hotkey: 'Digit1' },
    { id: 'hoe', label: 'Hoe', icon: 'hoe', hotkey: 'Digit2', active: !night },
    { id: 'seed', label: 'Seed bag · spring barley', icon: 'seed', hotkey: 'Digit3' },
    { id: 'water', label: 'Watering can', icon: 'water', hotkey: 'Digit4' },
    { id: 'axe', label: 'Axe', icon: 'axe', hotkey: 'Digit5' },
    { id: 'build', label: 'Build', icon: 'build', hotkey: 'KeyB', active: night },
  ]);
  api.setCharacters([
    { id: 'char:1', name: 'Lotte', style: 'long', skin: '#f1d0b0', hair: '#a0672e', cloth: '#5d6b3a' },
    { id: 'char:2', name: 'Jonas', style: 'cap', skin: '#d9a77c', hair: '#2b2018', cloth: '#8a3a30', status: 'tractor', statusText: 'Ploughing Kapelakker' },
    { id: 'char:3', name: 'Bram', style: 'curly', skin: '#b27b52', hair: '#2b2018', cloth: '#c49a3c' },
    { id: 'char:4', name: 'Mieke', style: 'bun', skin: '#f1d0b0', hair: '#d8b46a', cloth: '#3f5f86', status: night ? 'moon' : 'cow', statusText: night ? 'Asleep' : 'Milking' },
  ], 'char:1', () => {});

  api.worldLabel('lbl:kouter', { x: 452, y: 468, text: 'Kouter · ploughed', kind: 'field', icon: 'land' });
  api.worldLabel('lbl:hoogveld', { x: 574, y: 452, text: 'Hoogveld · winter wheat', kind: 'field', icon: 'wheat' });
  api.worldLabel('lbl:beemd', { x: 566, y: 536, text: 'Beemd · for sale', kind: 'sell', icon: 'coin' });
  api.setPrompt(night ? 'F — Enter tractor' : 'E — Hoe the verge');

  const long = { ms: 600000 };
  if (preset === 'default') {
    hooks.demoMoneyDelta(1535);
    api.toast('<b>Sold 8.1 t barley</b><br>Van Damme Mill paid €1,535.00', { kind: 'money', icon: 'coin', html: true, ...long });
    api.toast('<b>Contract finished</b><br>Feeding sheep for P. Dubois', { kind: 'success', icon: 'check', html: true, ...long });
    api.toast('Rain expected tomorrow afternoon — good day to sow.', { kind: 'info', icon: 'rain', ...long });
  } else if (preset === 'night') {
    api.toast('<b>Rent due at dawn</b><br>Hoogveld · €11.46', { kind: 'warn', icon: 'land', html: true, ...long });
  }
  if (['finances', 'market', 'jobs', 'land', 'help'].includes(preset)) api.openPanel(preset);
  if (preset === 'confirm') {
    api.openPanel('land');
    const ps = data.parcels();
    const p = ps.find((q) => q.state === 'forSale') || ps[0];
    if (p) api.confirm({ title: `Rent ${p.name}?`, text: `${((p.area || 0) / 10000).toFixed(2)} ha for €${(p.rentPerDay || 0).toFixed(2)} per day, charged each morning. You can end the lease at any time.`, okLabel: 'Sign lease', cancelLabel: 'Not now' });
  }
}
