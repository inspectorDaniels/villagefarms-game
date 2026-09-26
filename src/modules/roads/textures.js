// Seamless painted texture tiles (cached via art.sprite) used as world-aligned patterns.
export const TILE_M = 12;      // tile size in metres
export const TILE_RES = 48;    // px per metre of the hi tile
const LO_RES = 8;

function seamlessNoise(g, w, h, cols, freq, grain, noise, rng, px = 2, oct = 3) {
  const C = cols.map((c) => {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let j = 0; j < h; j += px) {
    for (let i = 0; i < w; i += px) {
      const x = i * freq, y = j * freq, W = w * freq, H = h * freq;
      const fx = i / w, fy = j / h;
      const v = noise.fbm(x, y, oct) * (1 - fx) * (1 - fy) + noise.fbm(x - W, y, oct) * fx * (1 - fy)
        + noise.fbm(x, y - H, oct) * (1 - fx) * fy + noise.fbm(x - W, y - H, oct) * fx * fy;
      // blending shrinks variance in the middle → rescale a bit
      const vv = Math.max(0, Math.min(0.9999, (v * 1.6 + 1) / 2));
      const f = vv * (C.length - 1);
      const k = Math.floor(f), t = f - k;
      const a = C[k], b = C[Math.min(k + 1, C.length - 1)];
      const gr = 1 + (rng.float() - 0.5) * grain * 2;
      const r = (a[0] + (b[0] - a[0]) * t) * gr, gg = (a[1] + (b[1] - a[1]) * t) * gr, bb = (a[2] + (b[2] - a[2]) * t) * gr;
      for (let jj = 0; jj < px && j + jj < h; jj++) for (let ii = 0; ii < px && i + ii < w; ii++) {
        const o = ((j + jj) * w + (i + ii)) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** draw fn at (x,y) and its wrapped copies so dabs near edges tile seamlessly */
function wrapped(w, h, x, y, r, fn) {
  fn(x, y);
  const xs = [0], ys = [0];
  if (x < r) xs.push(w); if (x > w - r) xs.push(-w);
  if (y < r) ys.push(h); if (y > h - r) ys.push(-h);
  for (const ox of xs) for (const oy of ys) if (ox || oy) fn(x + ox, y + oy);
}

function specks(g, rng, w, h, count, colors, rMin, rMax, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rng.float() * w, y = rng.float() * h, r = rng.range(rMin, rMax);
    g.globalAlpha = alpha * rng.range(0.5, 1);
    g.fillStyle = rng.pick(colors);
    const rot = rng.float() * 3.14, e = rng.range(0.55, 1);
    wrapped(w, h, x, y, r + 1, (xx, yy) => { g.beginPath(); g.ellipse(xx, yy, r, r * e, rot, 0, Math.PI * 2); g.fill(); });
  }
  g.globalAlpha = 1;
}

export function makeTextures(art, palette) {
  const P = TILE_M * TILE_RES;
  const M = art.mix, S = art.shade;
  const tiles = {};

  const def = (name, paint) => {
    const hi = art.sprite('roads:tile:' + name, P, P, (g, w, h, rng) => paint(g, w, h, rng, art.noise('roads-tile-' + name)));
    const lo = art.sprite('roads:tile:' + name + ':lo', TILE_M * LO_RES, TILE_M * LO_RES, (g, w, h) => {
      g.imageSmoothingQuality = 'high';
      g.drawImage(hi, 0, 0, w, h);
    });
    tiles[name] = { hi, lo };
  };

  const asphaltPaint = (base, aggLight) => (g, w, h, rng, n) => {
    seamlessNoise(g, w, h, base, 1 / (TILE_RES * 2.2), 0.05, n, rng, 2, 4);
    // aggregate: light chips and dark voids
    specks(g, rng, w, h, 5200, [aggLight, M(aggLight, '#c9c2b2', 0.4), '#8c8a84'], 0.5, 1.4, 0.5);
    specks(g, rng, w, h, 4200, ['#2c2e33', '#34363b'], 0.5, 1.5, 0.45);
    // soft mottling (bitumen richer / leaner areas)
    specks(g, rng, w, h, 70, [S(base[1], -0.25), M(base[1], '#7a786f', 0.4)], 14, 40, 0.07);
  };
  def('asphalt', asphaltPaint(['#3e4045', '#474950', '#51535a', '#4b4c50'], '#77756f'));
  def('asphaltOld', asphaltPaint(['#4d4e51', '#55575a', '#5d5e60', '#626260'], '#8a877e'));
  def('asphaltPatch', asphaltPaint(['#393b40', '#404247', '#474950', '#414348'], '#6e6c66'));

  def('gravel', (g, w, h, rng, n) => {
    seamlessNoise(g, w, h, ['#8f877a', '#9e968a', '#a9a194', '#958d80'], 1 / (TILE_RES * 1.6), 0.07, n, rng, 2, 3);
    specks(g, rng, w, h, 900, [palette.soil.dry, M(palette.soil.dry, '#9e968a', 0.5)], 6, 20, 0.12);
    const stones = [...palette.gravel, palette.sand[1], palette.rock[1], '#c8c1b3', '#6f695e'];
    for (let i = 0; i < 9000; i++) {
      const x = rng.float() * w, y = rng.float() * h, r = rng.range(0.9, 2.8);
      const c = rng.pick(stones), rot = rng.float() * 3.14, e = rng.range(0.55, 0.95);
      wrapped(w, h, x, y, r + 2, (xx, yy) => {
        g.globalAlpha = 0.5; g.fillStyle = '#4b453c';
        g.beginPath(); g.ellipse(xx + 0.5, yy + 0.7, r, r * e, rot, 0, 6.283); g.fill();
        g.globalAlpha = 0.95; g.fillStyle = c;
        g.beginPath(); g.ellipse(xx, yy, r, r * e, rot, 0, 6.283); g.fill();
        g.globalAlpha = 0.35; g.fillStyle = '#f2ecdf';
        g.beginPath(); g.ellipse(xx - r * 0.25, yy - r * 0.3, r * 0.4, r * 0.3 * e, rot, 0, 6.283); g.fill();
      });
    }
    g.globalAlpha = 1;
  });

  def('dirt', (g, w, h, rng, n) => {
    const dd = (c) => M(c, '#8a7f6e', 0.5);
    seamlessNoise(g, w, h, [dd(palette.soil.moist), dd(M(palette.soil.dry, palette.soil.moist, 0.4)), dd(palette.soil.dry), dd(palette.soil.clay)], 1 / (TILE_RES * 1.8), 0.06, n, rng, 2, 4);
    specks(g, rng, w, h, 400, [palette.soil.wet, palette.mud], 5, 18, 0.12);
    specks(g, rng, w, h, 2200, [palette.gravel[0], palette.gravel[2], palette.sand[0]], 0.7, 2, 0.6);
    specks(g, rng, w, h, 1600, ['#3d2f22'], 0.5, 1.3, 0.4);
  });

  def('concrete', (g, w, h, rng, n) => {
    seamlessNoise(g, w, h, ['#aca79d', '#b8b3a9', '#c2bdb2', '#b1aca2'], 1 / (TILE_RES * 1.2), 0.05, n, rng, 2, 3);
    specks(g, rng, w, h, 120, ['#8e897f', '#9a958b'], 8, 26, 0.08);
    specks(g, rng, w, h, 3000, ['#8a857b', '#d6d1c6'], 0.5, 1.2, 0.35);
  });

  const grass = {};
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    def('grass-' + season, (g, w, h, rng, n) => {
      const cols = palette.grass[season];
      seamlessNoise(g, w, h, [cols[2], cols[0], cols[1], cols[3]], 1 / (TILE_RES * 3), 0.05, n, rng, 2, 4);
      // blades
      g.lineCap = 'round';
      for (let i = 0; i < 11000; i++) {
        const x = rng.float() * w, y = rng.float() * h;
        const len = rng.range(4, 11), a = -Math.PI / 2 + rng.range(-0.9, 0.9);
        const c = rng.chance(0.5) ? S(rng.pick(cols), rng.range(-0.35, -0.1)) : M(rng.pick(cols), '#e8e2b0', rng.range(0.05, 0.25));
        g.strokeStyle = c; g.globalAlpha = rng.range(0.35, 0.75); g.lineWidth = rng.range(0.8, 1.7);
        wrapped(w, h, x, y, 12, (xx, yy) => { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(a) * len, yy + Math.sin(a) * len); g.stroke(); });
      }
      if (season !== 'winter') specks(g, rng, w, h, season === 'spring' ? 260 : 120, palette.flowers, 1, 2.2, 0.8);
      g.globalAlpha = 1;
    });
    grass[season] = tiles['grass-' + season];
  }
  tiles.grass = grass;
  return tiles;
}

/** a world-aligned pattern for a tile on context g; hi or lo tile picked from chunk resolution */
export function patternFor(g, tile, res) {
  const useHi = res >= 12;
  const img = useHi ? tile.hi : tile.lo;
  const pat = g.createPattern(img, 'repeat');
  const s = TILE_M / img.width;
  if (pat.setTransform) pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  return pat;
}
