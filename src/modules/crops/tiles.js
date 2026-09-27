// crops — painted cell tiles. One tile = one 2 m cell, rows running along +x (the field's row
// direction), toroidal (dabs wrap at the edges) so neighbouring cells join without seams.
// Painted once per key into ctx.art sprites at art.PPM (64 × 64 px) and drawn rotated per cell.
import { S, CROPS } from './data.js';

const TILE_M = 2;

export function createTiles(art, palette) {
  const PX = Math.round(TILE_M * art.PPM); // 64
  const K = PX / TILE_M;                   // px per metre
  const { mix, shade } = art;
  const soil = palette.soil;

  // ---------------------------------------------------------------- helpers
  function wrapped(W, H, x, y, r, fn) {
    fn(x, y);
    const xs = [0], ys = [0];
    if (x - r < 0) xs.push(W); if (x + r > W) xs.push(-W);
    if (y - r < 0) ys.push(H); if (y + r > H) ys.push(-H);
    for (const dx of xs) for (const dy of ys) if (dx || dy) fn(x + dx, y + dy);
  }
  function dab(g, W, H, x, y, rx, ry, rot, col, a = 1) {
    g.globalAlpha = a; g.fillStyle = col;
    wrapped(W, H, x, y, Math.max(rx, ry), (px, py) => { g.beginPath(); g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); g.fill(); });
    g.globalAlpha = 1;
  }
  function stroke(g, W, H, x, y, len, ang, w, col, a = 1) {
    g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    wrapped(W, H, x, y, len + w, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx, py + dy); g.stroke(); });
    g.globalAlpha = 1;
  }
  const rows = (sp) => Math.max(1, Math.round(TILE_M / sp));

  function soilBase(g, W, H, cols, seed) {
    art.noiseFill(g, 0, 0, W, H, cols, { scale: 0.09, grain: 0.07, seed, px: 2 });
  }
  function crumbs(g, W, H, rng, n, cols, r0, r1, a = 0.7) {
    for (let i = 0; i < n; i++) dab(g, W, H, rng.float() * W, rng.float() * H, rng.range(r0, r1), rng.range(r0, r1) * 0.8, rng.float() * 3, rng.pick(cols), a * rng.range(0.6, 1));
  }

  // ---------------------------------------------------------------- ground states
  function paintPloughed(g, W, H, rng, v) {
    soilBase(g, W, H, [soil.furrowDark, soil.ploughed, soil.moist, soil.ploughed], 'crops:pl' + v);
    const n = 6, fh = H / n;
    const ph = rng.float() * 6.28;
    for (let r = 0; r < n; r++) {
      const yc = (r + 0.5) * fh;
      // furrow trough (dark) and turned ridge (light top edge), wobble periodic in x
      g.fillStyle = soil.furrowDark; g.globalAlpha = 0.55;
      g.beginPath();
      for (let x = 0; x <= W; x += 4) { const y = yc + fh * 0.18 + Math.sin((x / W) * 6.283 * 2 + ph + r) * 1.2; if (!x) g.moveTo(x, y); else g.lineTo(x, y); }
      for (let x = W; x >= 0; x -= 4) { const y = yc + fh * 0.48 + Math.sin((x / W) * 6.283 * 3 + ph * 2 + r) * 1.0; g.lineTo(x, y); }
      g.closePath(); g.fill();
      g.fillStyle = shade(soil.ploughed, 0.28); g.globalAlpha = 0.45;
      g.beginPath();
      for (let x = 0; x <= W; x += 4) { const y = yc - fh * 0.32 + Math.sin((x / W) * 6.283 * 2 + ph * 3 + r) * 1.1; if (!x) g.moveTo(x, y); else g.lineTo(x, y); }
      for (let x = W; x >= 0; x -= 4) { const y = yc - fh * 0.08 + Math.sin((x / W) * 6.283 + ph + r) * 0.8; g.lineTo(x, y); }
      g.closePath(); g.fill();
      g.globalAlpha = 1;
      for (let i = 0; i < 7; i++) dab(g, W, H, rng.float() * W, yc - fh * 0.2 + rng.range(-2, 2), rng.range(1.2, 2.6), rng.range(1, 1.8), rng.float() * 3, rng.pick([shade(soil.ploughed, 0.18), soil.moist, shade(soil.clay, -0.2)]), 0.8);
    }
  }
  function paintCultivated(g, W, H, rng, v) {
    soilBase(g, W, H, [soil.moist, soil.ploughed, soil.dry, soil.moist], 'crops:cu' + v);
    for (let i = 0; i < 5; i++) { const y = rng.float() * H; stroke(g, W, H, 0, y, W, 0, rng.range(0.6, 1.3), shade(soil.moist, -0.35), 0.25); }
    crumbs(g, W, H, rng, 70, [shade(soil.dry, 0.2), soil.dry, shade(soil.moist, -0.3), soil.clay], 0.6, 1.6, 0.7);
  }
  function drillRows(g, W, H, sp, a = 0.4) {
    const n = rows(sp);
    for (let r = 0; r < n; r++) stroke(g, W, H, 0, (r + 0.5) * H / n, W, 0, 0.9, shade(soil.moist, -0.5), a);
  }
  function paintRidges(g, W, H, rng, sp, v) {
    // potato ridges: soft earth mounds with dark valleys
    soilBase(g, W, H, [soil.moist, soil.dry, soil.ploughed, soil.dry], 'crops:rd' + v);
    const n = rows(sp), rh = H / n;
    for (let r = 0; r < n; r++) {
      const yc = (r + 0.5) * rh;
      const gr = g.createLinearGradient(0, yc - rh / 2, 0, yc + rh / 2);
      gr.addColorStop(0, 'rgba(40,28,18,0.45)'); gr.addColorStop(0.3, 'rgba(255,240,210,0.16)');
      gr.addColorStop(0.55, 'rgba(255,240,210,0.08)'); gr.addColorStop(1, 'rgba(40,28,18,0.45)');
      g.fillStyle = gr; g.fillRect(0, yc - rh / 2, W, rh);
    }
    crumbs(g, W, H, rng, 30, [shade(soil.dry, 0.2), shade(soil.moist, -0.3)], 0.5, 1.3, 0.6);
  }
  function paintGrass(g, W, H, rng, season, short, v) {
    const G = palette.grass[season] || palette.grass.summer;
    art.noiseFill(g, 0, 0, W, H, [G[2], G[0], G[1], G[3]], { scale: 0.11, grain: 0.06, seed: 'crops:gr' + season + v, px: 2 });
    const n = short ? 120 : 170;
    for (let i = 0; i < n; i++) {
      const x = rng.float() * W, y = rng.float() * H;
      stroke(g, W, H, x, y, rng.range(short ? 1.5 : 2.5, short ? 3 : 6), -Math.PI / 2 + rng.range(-0.6, 0.6), rng.range(0.7, 1.3), rng.pick([shade(G[0], -0.25), G[3], shade(G[1], 0.15)]), 0.6);
    }
    if (!short && season !== 'winter') for (let i = 0; i < 3; i++) dab(g, W, H, rng.float() * W, rng.float() * H, 0.9, 0.9, 0, rng.pick(palette.flowers), 0.8);
  }
  function paintStubble(g, W, H, rng, crop, v) {
    const C = CROPS[crop] || CROPS.wheat;
    const straw0 = C.kind === 'cereal' ? mix(soil.dry, '#c8ae6a', 0.55) : soil.dry;
    soilBase(g, W, H, [straw0, shade(straw0, 0.12), mix(soil.moist, straw0, 0.4), straw0], 'crops:st' + crop + v);
    if (C.kind === 'maize') {
      const n = rows(C.rows);
      for (let r = 0; r < n; r++) for (let x = 3; x < W; x += 12 + rng.float() * 4) {
        const y = (r + 0.5) * H / n + rng.range(-1, 1);
        dab(g, W, H, x, y, 2.2, 2.2, 0, '#a88a4a', 0.95); dab(g, W, H, x, y, 1.2, 1.2, 0, '#6f5a32', 0.9);
      }
      for (let i = 0; i < 26; i++) stroke(g, W, H, rng.float() * W, rng.float() * H, rng.range(4, 9), rng.float() * 6.28, rng.range(1.2, 2.2), rng.pick(['#c8ab6a', '#b09050', '#d8c088']), 0.8);
      return;
    }
    const straw = crop === 'rapeseed' ? ['#7a6a3a', '#8f7d48', '#5f5230'] : ['#d6c07a', '#c4a860', '#e2d49a', '#b89a54'];
    const n = rows(0.25);
    for (let r = 0; r < n; r++) {
      const y = (r + 0.5) * H / n;
      for (let x = rng.float() * 2; x < W; x += rng.range(1.6, 3)) stroke(g, W, H, x, y + rng.range(-1, 1), rng.range(1.2, 2.4), -Math.PI / 2 + rng.range(-0.5, 0.5), rng.range(0.8, 1.2), rng.pick(straw), 0.9);
    }
    for (let i = 0; i < 40; i++) stroke(g, W, H, rng.float() * W, rng.float() * H, rng.range(3, 7), rng.float() * 6.28, 0.8, rng.pick(straw), 0.55);
  }
  function paintSwath(g, W, H, rng, cols, width, a = 0.95) {
    // a loose rope of cut material along the row direction, centred in the tile
    const yc = H / 2;
    dab(g, W, H, W / 2, yc + width * 0.25, W * 0.55, width * 0.55, 0, 'rgba(30,26,16,1)', 0.18);
    for (let i = 0; i < 150; i++) {
      const y = yc + rng.gauss(0, width * 0.28);
      stroke(g, W, H, rng.float() * W, y, rng.range(4, 10), rng.range(-0.5, 0.5), rng.range(0.8, 1.5), rng.pick(cols), a * rng.range(0.6, 1));
    }
  }
  function paintWithered(g, W, H, rng, crop, v) {
    const C = CROPS[crop] || CROPS.wheat;
    soilBase(g, W, H, [soil.moist, soil.dry, soil.moist], 'crops:wi' + v);
    const cols = C.kind === 'maize' ? ['#7a6440', '#8a7450', '#5d4c33', '#9a8a68'] : C.kind === 'root' ? ['#6a5a38', '#7d6d4a', '#4f4430'] : ['#8a7a5a', '#766848', '#a0906a', '#5e5440'];
    for (let i = 0; i < 90; i++) stroke(g, W, H, rng.float() * W, rng.float() * H, rng.range(4, C.kind === 'maize' ? 14 : 9), rng.range(-0.9, 0.9) + (i % 3 ? 0 : 1.5), rng.range(1, C.kind === 'maize' ? 2.6 : 1.6), rng.pick(cols), 0.8);
    crumbs(g, W, H, rng, 18, ['#4a4032', '#3f3a30'], 1, 3, 0.35); // mould / dark rot patches
  }

  // ---------------------------------------------------------------- crops
  const CER = {
    wheat: { g: ['#5f8f3a', '#6f9e45', '#4f7f34', '#86ab55'], ear: ['#b8c46a', '#a8b85a'], ripe: ['#c99a2e', '#d9b45a', '#b8862a', '#e0c070'] },
    barley: { g: ['#6f9a48', '#7fa855', '#5f8a3f', '#94b862'], ear: ['#c8d08a', '#b8c47a'], ripe: ['#d9c48a', '#e4d2a0', '#c8b070', '#d6b890'] },
    oats: { g: ['#5f8f45', '#6f9a52', '#557f3e', '#88aa60'], ear: ['#c0c890', '#d0d4a0'], ripe: ['#d8cc98', '#c8b884', '#e2d8ac', '#b8a878'] },
  };
  function paintCereal(g, W, H, rng, crop, st, v) {
    const P = CER[crop] || CER.wheat;
    const n = rows(0.25), rh = H / n;
    if (st === 0) { paintCultivated(g, W, H, rng, v); drillRows(g, W, H, 0.25, 0.45); return; }
    if (st <= 2) {
      paintCultivated(g, W, H, rng, v);
      drillRows(g, W, H, 0.25, 0.3);
      const dens = st === 1 ? 2.6 : 1.6, len = st === 1 ? 2.2 : 3.6;
      for (let r = 0; r < n; r++) for (let x = rng.float() * 2; x < W; x += dens * rng.range(0.7, 1.3)) {
        const y = (r + 0.5) * rh;
        const k = st === 1 ? 2 : 4;
        for (let s = 0; s < k; s++) stroke(g, W, H, x, y, len * rng.range(0.7, 1.2), -Math.PI / 2 + rng.range(-1.1, 1.1), st === 1 ? 0.9 : 1.2, rng.pick(P.g), 0.9);
      }
      return;
    }
    const cols = st === 5 ? P.ripe : P.g;
    // canopy base with soft row gaps
    art.noiseFill(g, 0, 0, W, H, [shade(cols[2], -0.25), cols[2], cols[0], cols[1]], { scale: 0.12, grain: 0.05, seed: 'crops:ce' + crop + st + v, px: 2 });
    for (let r = 0; r < n; r++) stroke(g, W, H, 0, r * rh, W, 0, 1.4, shade(cols[2], -0.45), st === 5 ? 0.35 : 0.45);
    for (let i = 0; i < 420; i++) {
      const r = rng.int(0, n - 1), x = rng.float() * W, y = (r + 0.5) * rh + rng.range(-rh * 0.45, rh * 0.45);
      stroke(g, W, H, x, y, rng.range(2.5, 5), rng.range(-2.2, -0.9), rng.range(0.9, 1.5), rng.pick(cols), 0.75);
    }
    if (st >= 4) {
      const ears = st === 5 ? P.ripe : P.ear;
      for (let i = 0; i < 260; i++) {
        const x = rng.float() * W, y = rng.float() * H;
        dab(g, W, H, x, y, crop === 'oats' ? 0.9 : 1.6, crop === 'oats' ? 0.9 : 0.8, rng.range(-0.4, 0.4), shade(rng.pick(ears), rng.range(-0.1, 0.25)), 0.85);
        if (crop === 'barley') stroke(g, W, H, x, y, rng.range(2, 3.5), rng.range(-0.3, 0.3), 0.5, st === 5 ? '#efe2b8' : '#d8e0a8', 0.6);
      }
    }
  }
  function paintRapeseed(g, W, H, rng, st, v) {
    const G = ['#4f7a4a', '#5f8a55', '#3f6a40', '#6e9a60'];
    if (st === 0) { paintCultivated(g, W, H, rng, v); drillRows(g, W, H, 0.5, 0.45); return; }
    if (st <= 2) {
      paintCultivated(g, W, H, rng, v);
      const n = rows(0.5), rh = H / n;
      for (let r = 0; r < n; r++) for (let x = rng.float() * 4; x < W; x += (st === 1 ? 5 : 8) * rng.range(0.8, 1.2)) {
        const y = (r + 0.5) * rh + rng.range(-1.5, 1.5);
        const L = st === 1 ? 1.4 : 3.4, k = st === 1 ? 2 : 5;
        for (let s = 0; s < k; s++) { const a = (s / k) * 6.28 + rng.float(); dab(g, W, H, x + Math.cos(a) * L, y + Math.sin(a) * L, L, L * 0.75, a, rng.pick(G), 0.95); }
      }
      return;
    }
    const pods = st === 6, ripe = st === 5;
    const base = ripe ? ['#6f6a3a', '#8a7a45', '#5a5530', '#9a8a55'] : pods ? ['#7a8a45', '#8f9a50', '#65753a', '#a0a860'] : G;
    art.noiseFill(g, 0, 0, W, H, [shade(base[2], -0.2), base[0], base[1], base[3]], { scale: 0.12, grain: 0.05, seed: 'crops:rp' + st + v, px: 2 });
    for (let i = 0; i < 160; i++) dab(g, W, H, rng.float() * W, rng.float() * H, rng.range(2, 4), rng.range(1.5, 3), rng.float() * 3, shade(rng.pick(base), rng.range(-0.15, 0.15)), 0.7);
    if (st === 4) { // bloom: dense yellow racemes
      const Y = ['#e8d45a', '#f0de3a', '#d9c030', '#f6e878'];
      for (let i = 0; i < 520; i++) dab(g, W, H, rng.float() * W, rng.float() * H, rng.range(1, 2.3), rng.range(0.9, 2), 0, rng.pick(Y), 0.9);
    }
    if (pods || ripe) for (let i = 0; i < 200; i++) stroke(g, W, H, rng.float() * W, rng.float() * H, rng.range(1.5, 3), rng.float() * 6.28, 0.7, ripe ? '#b8aa78' : '#aab86a', 0.7);
  }
  function paintMaize(g, W, H, rng, st, v) {
    const G = ['#3f6f2f', '#4f7f38', '#5f8f40', '#2f5a26', '#6f9a45'];
    const DRY = ['#c8ab6a', '#b09050', '#d8c088', '#9a7a45'];
    const n = rows(CROPS.maize.rows), rh = H / n;
    if (st <= 3) { paintCultivated(g, W, H, rng, v); drillRows(g, W, H, CROPS.maize.rows, 0.25); }
    else art.noiseFill(g, 0, 0, W, H, st === 5 ? [DRY[3], DRY[1], DRY[0]] : [G[3], G[0], G[3]], { scale: 0.1, grain: 0.05, seed: 'crops:mz' + st + v, px: 2 });
    const sp = W / 10;                           // 0.2 m between plants, 10 per tile row
    const L = [0, 0.1, 0.2, 0.34, 0.48, 0.45][st] * K;
    const cols = st === 5 ? DRY : G;
    for (let r = 0; r < n; r++) for (let p = 0; p < 10; p++) {
      const x = (p + 0.5) * sp + rng.range(-1, 1), y = (r + 0.5) * rh + rng.range(-1, 1);
      if (st === 0) { dab(g, W, H, x, y, 0.9, 0.9, 0, shade(soil.moist, -0.4), 0.6); continue; }
      // leaves alternate on the two sides of the plant, mostly across the row
      const k = [0, 2, 4, 6, 8, 7][st];
      for (let s = 0; s < k; s++) {
        const side = s % 2 ? 1 : -1;
        const a = side * Math.PI / 2 + rng.range(-0.55, 0.55) + (p % 2 ? 0.2 : -0.2);
        const len = L * rng.range(0.65, 1.05) * (1 - s * 0.05);
        const mx = x + Math.cos(a) * len / 2, my = y + Math.sin(a) * len / 2;
        const col = rng.pick(cols);
        dab(g, W, H, mx, my, len / 2, Math.max(1, len * 0.15), a, shade(col, -0.2), 0.9);
        dab(g, W, H, mx, my, len / 2 * 0.9, Math.max(0.7, len * 0.1), a, col, 0.95);
        stroke(g, W, H, x, y, len * 0.8, a, 0.45, shade(col, 0.35), 0.45); // midrib
      }
      dab(g, W, H, x, y, Math.max(0.8, L * 0.08), Math.max(0.8, L * 0.08), 0, shade(cols[0], 0.15), 0.9);
      if (st >= 4) stroke(g, W, H, x - 1.5, y, 3, 0, 1, st === 5 ? '#8a6a3a' : '#d8c070', 0.95); // tassel
    }
  }
  function paintPotato(g, W, H, rng, st, v) {
    paintRidges(g, W, H, rng, 1.0, v);
    const n = rows(1.0), rh = H / n;
    const G = st === 5 ? ['#a8a048', '#8f8a3a', '#c0b060', '#7a6f35'] : ['#5f8a3a', '#6f9a45', '#4f7a32', '#7fa850'];
    const R = [0, 2, 4.2, 6.8, 7.5, 6][st];
    for (let r = 0; r < n; r++) for (let x = rng.float() * 6; x < W; x += 9 * rng.range(0.85, 1.1)) {
      const y = (r + 0.5) * rh;
      if (st === 0) continue;
      for (let s = 0; s < (st === 1 ? 3 : 9); s++) dab(g, W, H, x + rng.range(-R, R) * 0.7, y + rng.range(-R, R) * 0.6, R * rng.range(0.35, 0.6), R * rng.range(0.3, 0.5), rng.float() * 3, rng.pick(G), 0.92);
      if (st === 4) for (let s = 0; s < 3; s++) dab(g, W, H, x + rng.range(-R, R), y + rng.range(-R, R) * 0.6, 0.9, 0.9, 0, rng.pick(['#f2f0e6', '#c9b0e0', '#e8e0f0']), 0.95);
    }
  }
  function paintBeet(g, W, H, rng, st, v) {
    const G = ['#4f8a35', '#5f9a3f', '#3f7a2c', '#78b050'];
    if (st <= 3) { paintCultivated(g, W, H, rng, v); drillRows(g, W, H, 0.5, 0.25); }
    else art.noiseFill(g, 0, 0, W, H, [G[2], G[0], G[1]], { scale: 0.12, grain: 0.05, seed: 'crops:bt' + st + v, px: 2 });
    const n = rows(0.5), rh = H / n;
    const R = [0, 1.4, 3.2, 5.5, 7, 7][st];
    for (let r = 0; r < n; r++) for (let x = rng.float() * 4; x < W; x += 6.5 * rng.range(0.9, 1.1)) {
      const y = (r + 0.5) * rh;
      if (st === 0) continue;
      const k = st === 1 ? 2 : 6;
      for (let s = 0; s < k; s++) {
        const a = (s / k) * 6.28 + rng.float() * 0.5;
        const col = st === 5 && s % 3 === 0 ? '#a8a848' : rng.pick(G);
        dab(g, W, H, x + Math.cos(a) * R * 0.55, y + Math.sin(a) * R * 0.55, R * 0.55, R * 0.3, a, col, 0.95);
        dab(g, W, H, x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.5, R * 0.3, R * 0.08, a, shade(col, 0.35), 0.6); // gloss
      }
      if (st === 5) dab(g, W, H, x, y, 1.4, 1.4, 0, '#e8d8c0', 0.9);
    }
  }
  function paintSownGrass(g, W, H, rng, st, season, v) {
    if (st === 1) { paintGrass(g, W, H, rng, season, true, v); return; } // fresh sward / regrowth after a cut
    if (st === 0) {
      paintCultivated(g, W, H, rng, v);
      const G = palette.grass[season] || palette.grass.summer;
      for (let i = 0; i < (st ? 220 : 40); i++) stroke(g, W, H, rng.float() * W, rng.float() * H, rng.range(1, 2.5), -Math.PI / 2 + rng.range(-0.7, 0.7), 0.8, rng.pick(G), 0.8);
      return;
    }
    paintGrass(g, W, H, rng, season, st === 2, v);
    if (st >= 4) {
      const heads = st === 5 ? ['#c8c080', '#b8b070', '#d8d0a0', '#a89a70'] : ['#a8b070', '#b8b884'];
      for (let i = 0; i < (st === 5 ? 160 : 70); i++) dab(g, W, H, rng.float() * W, rng.float() * H, 1.1, 0.6, rng.range(-0.5, 0.5), rng.pick(heads), 0.75);
    }
  }
  function weedOverlay(g, W, H, rng) {
    const cols = ['#8fb04a', '#a8c060', '#6f9a3a', '#4f7a2c'];
    for (let i = 0; i < 16; i++) {
      const x = rng.float() * W, y = rng.float() * H, r = rng.range(1.5, 3.5);
      for (let s = 0; s < 5; s++) dab(g, W, H, x + rng.range(-r, r), y + rng.range(-r, r), r * 0.5, r * 0.35, rng.float() * 3, rng.pick(cols), 0.9);
      if (rng.chance(0.3)) dab(g, W, H, x, y, 1, 1, 0, rng.pick(['#d8453a', '#f2f0e6', '#e8d45a']), 0.95); // poppy / chamomile / charlock
    }
  }
  function tramlines(g, W, H, rng) {
    // two bare wheel tracks 1.8 m apart (at the tile edges; the tram cell is the middle of a 12 m bout)
    for (const y0 of [0.08 * K, 1.72 * K]) {
      g.fillStyle = soil.dry; g.globalAlpha = 0.45; g.fillRect(0, y0, W, 0.2 * K); g.globalAlpha = 1;
      for (let i = 0; i < 14; i++) dab(g, W, H, rng.float() * W, y0 + rng.range(0, 0.2 * K), rng.range(1, 2), rng.range(0.6, 1.2), 0, rng.pick([soil.dry, soil.moist, shade(soil.dry, 0.15)]), 0.5);
    }
  }

  /**
   * spec: { state, crop, stage (0..6), weedy, lying, swath (bool: this cell carries the swath rope),
   *         tram (bool), season, v (variant 0..2) }
   */
  function key(sp) {
    return `crops:t:${sp.state}:${sp.crop || '-'}:${sp.stage | 0}:${sp.weedy ? 1 : 0}:${sp.lying ? 1 : 0}:${sp.swath ? 1 : 0}:${sp.tram ? 1 : 0}:${sp.season}:${sp.v}`;
  }
  function get(sp) {
    return art.sprite(key(sp), PX, PX, (g, W, H, rng) => paint(g, W, H, rng, sp));
  }
  function paint(g, W, H, rng, sp) {
    const { state, crop, stage, season, v } = sp;
    switch (state) {
      case S.GRASS: paintGrass(g, W, H, rng, season, false, v); break;
      case S.PLOUGHED: paintPloughed(g, W, H, rng, v); break;
      case S.CULTIVATED: paintCultivated(g, W, H, rng, v); break;
      case S.STUBBLE:
        paintStubble(g, W, H, rng, crop, v);
        if (sp.lying && sp.swath) paintSwath(g, W, H, rng, crop === 'rapeseed' ? ['#8a7a48', '#6f6238'] : ['#e2d49a', '#d6c07a', '#c4a860', '#efe2b0'], 0.9 * K);
        break;
      case S.MOWN:
        paintGrass(g, W, H, rng, season, true, v);
        if (sp.lying) paintSwath(g, W, H, rng, ['#9cb05a', '#b8c070', '#88a04a', '#c8c880'], 1.5 * K, 0.85);
        break;
      case S.WINDROW:
        paintGrass(g, W, H, rng, season, true, v);
        if (sp.swath) paintSwath(g, W, H, rng, ['#b8b068', '#a8a058', '#c8c07a', '#8f9048'], 0.8 * K, 1);
        break;
      case S.WITHERED: paintWithered(g, W, H, rng, crop, v); break;
      case S.SOWN: case S.RIPE: {
        const C = CROPS[crop] || CROPS.wheat;
        const st = state === S.RIPE ? 5 : stage;
        if (C.kind === 'cereal') paintCereal(g, W, H, rng, crop, st, v);
        else if (C.kind === 'oilseed') paintRapeseed(g, W, H, rng, st, v);
        else if (C.kind === 'maize') paintMaize(g, W, H, rng, st, v);
        else if (crop === 'potatoes') paintPotato(g, W, H, rng, st, v);
        else if (crop === 'sugarBeet') paintBeet(g, W, H, rng, st, v);
        else paintSownGrass(g, W, H, rng, st, season, v);
        if (sp.tram && (C.kind === 'cereal' || C.kind === 'oilseed') && st >= 1) tramlines(g, W, H, rng);
        break;
      }
      default: break;
    }
    if (sp.weedy && state !== S.GRASS && state !== S.MOWN && state !== S.WINDROW) weedOverlay(g, W, H, rng);
    art.grain(g, W, H, rng, 0.05, 0.03);
  }

  // ---- extra sprites: round bale, wind sheen, grass margin + snow patterns
  function bale(item) {
    const w = Math.round(1.25 * art.PPM), h = Math.round(1.55 * art.PPM);
    return art.sprite('crops:bale:' + item, w, h, (g, W, H, rng) => {
      const cols = item === 'straw' ? ['#e2d49a', '#d6c07a', '#c4a860', '#efe2b0'] : ['#a8a860', '#b8b870', '#94964e', '#c8c486'];
      g.save();
      g.beginPath(); g.roundRect ? g.roundRect(1, 1, W - 2, H - 2, 6) : g.rect(1, 1, W - 2, H - 2); g.clip();
      art.noiseFill(g, 0, 0, W, H, cols, { scale: 0.15, grain: 0.08, seed: 'crops:bale' + item, px: 2 });
      // wrapped straw runs around the roll (across the width of the sprite)
      for (let i = 0; i < 90; i++) { const y = rng.float() * H; g.strokeStyle = rng.pick(cols.map((c) => shade(c, rng.range(-0.25, 0.2)))); g.globalAlpha = 0.7; g.lineWidth = 1; g.beginPath(); g.moveTo(rng.float() * W * 0.3, y); g.lineTo(W * (0.6 + rng.float() * 0.4), y + rng.range(-1, 1)); g.stroke(); }
      g.globalAlpha = 1;
      // cylinder form shading (top-down: the crown is lighter, the sides roll away)
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(30,30,40,0.35)'); gr.addColorStop(0.35, 'rgba(255,250,230,0.12)'); gr.addColorStop(0.6, 'rgba(255,250,230,0.08)'); gr.addColorStop(1, 'rgba(30,30,40,0.4)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // net wrap bands
      g.strokeStyle = 'rgba(236,236,226,0.55)'; g.lineWidth = 1;
      for (let x = 4; x < W; x += 7) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      g.restore();
      g.strokeStyle = art.outline(cols[2]); g.lineWidth = 1.5;
      g.beginPath(); g.roundRect ? g.roundRect(1, 1, W - 2, H - 2, 6) : g.rect(1, 1, W - 2, H - 2); g.stroke();
    });
  }
  function sheen() {
    return art.sprite('crops:sheen', 96, 40, (g, W, H) => {
      g.translate(W / 2, H / 2); g.scale(1, H / W);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, W / 2);
      gr.addColorStop(0, 'rgba(255,248,220,1)'); gr.addColorStop(0.5, 'rgba(255,248,220,0.45)'); gr.addColorStop(1, 'rgba(255,248,220,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, W / 2, 0, Math.PI * 2); g.fill();
    });
  }
  function gustSheet() {
    return art.sprite('crops:gusts', 192, 192, (g, W, H, rng) => {
      for (let i = 0; i < 16; i++) {
        const x = rng.float() * W, y = rng.float() * H, rx = rng.range(14, 26), ry = rng.range(4, 8);
        for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) {
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
          gr.addColorStop(0, 'rgba(255,248,220,0.9)'); gr.addColorStop(1, 'rgba(255,248,220,0)');
          g.save(); g.translate(x + dx, y + dy); g.scale(1, ry / rx); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
        }
      }
    });
  }
  function marginTile(season) {
    return art.sprite('crops:margin:' + season, 64, 64, (g, W, H, rng) => paintGrass(g, W, H, rng, season, false, 9));
  }
  function snowTile() {
    return art.sprite('crops:snow', 64, 64, (g, W, H, rng) => {
      art.noiseFill(g, 0, 0, W, H, palette.snow, { scale: 0.1, grain: 0.04, seed: 'crops:snow', px: 2 });
      for (let i = 0; i < 30; i++) dab(g, W, H, rng.float() * W, rng.float() * H, rng.range(2, 6), rng.range(1, 3), 0, '#c8d4e0', 0.35);
    });
  }
  return { get, key, bale, sheen, gustSheet, marginTile, snowTile, PX };
}
