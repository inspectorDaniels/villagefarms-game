// Showcase for the effects module: a small painted farm corner (own backdrop, so it looks right
// even while terrain/environment are stubs) with vehicles, a cottage, trees and a pond that
// drive every particle type, decal and trail.

const TAU = Math.PI * 2;
const internals = new WeakMap();
export function installShowcaseHooks(ctx, internal) { internals.set(ctx, internal); }

// ---------------- scene geometry (metres) ----------------
const trackY = (x) => 63 + 2.6 * Math.sin(x / 15 + 0.4);
const trackSlope = (x) => (2.6 / 15) * Math.cos(x / 15 + 0.4);
const TRACK_HW = 2.2;
const POND = { x: 84, y: 44 };
const pondR = (a) => 7 + 1.0 * Math.sin(3 * a + 1) + 0.6 * Math.sin(5 * a);
const COTTAGE = { x: 52, y: 45, w: 9, h: 7 };
const CHIMNEY = { x: 55.4, y: 43.4 };
const TREES = [[26, 42, 3.4], [36, 52.5, 3.0], [17, 55, 3.2], [102, 31, 3.6], [71, 33, 3.0], [66, 51, 2.5, 'blossom']];
const BACK = { x0: 0, y0: 16, x1: 128, y1: 112 };
const TILE = 16, PPM = 32;
const COMBINE_X0 = 86, COMBINE_Y = 77;

function pondDist(x, y) {
  const dx = x - POND.x, dy = y - POND.y;
  const a = Math.atan2(dy, dx);
  return Math.hypot(dx, dy) - pondR(a); // <0 inside
}
function inFarmyard(x, y) {
  const inRect = (x0, y0, x1, y1, r) => {
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy) < r;
  };
  return inRect(47.5, 41, 57.5, 51, 1.6) || inRect(54, 49, 57, trackY(55.5), 0.8);
}

/** region classification used by both the painter and the fx surface hook */
function regionAt(x, y, season) {
  const pd = pondDist(x, y);
  if (pd < -1.4) return 'water';
  if (pd < 0) return 'shallow';
  if (pd < 1.0) return 'sand';
  const ty = trackY(x);
  if (Math.abs(y - ty) < TRACK_HW) return 'track';
  if (y > ty + 4.5) {
    if (x < 60) return 'ploughed';
    if (x < 70) return season === 'summer' ? 'stubble' : season === 'spring' ? 'crop' : 'stubble';
    if (season === 'summer') {
      if (y < 74) return 'stubble';
      if (y < 80.2 && x > COMBINE_X0 + 1) return 'stubble';
      return 'wheat';
    }
    if (season === 'spring') return 'crop';
    return 'stubble';
  }
  if (inFarmyard(x, y)) return 'farmyard';
  return 'grass';
}

function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// ---------------- presets ----------------
const PRESETS = {
  default: { camera: { x: 58, y: 57.5, zoom: 26 }, time: '10:00', day: 13 },
  harvest: { camera: { x: 73, y: 80, zoom: 32 }, time: '16:30', day: 22 },
  night: { camera: { x: 72, y: 45, zoom: 30 }, time: '22:30', day: 19 },
  autumn: { camera: { x: 33, y: 50, zoom: 30 }, time: '11:00', day: 29 },
  rain: { camera: { x: 68, y: 56, zoom: 34 }, time: '15:00', day: 13 },
  winter: { camera: { x: 58, y: 57, zoom: 28 }, time: '11:30', day: 1 },
  closeup: { camera: { x: 57, y: 63, zoom: 60 }, time: '09:30', day: 13 },
};
const PRESET_WEATHER = {
  default: { kind: 'clear', intensity: 0, cloudCover: 0.2, wetness: 0.1, snowCover: 0, wind: { x: -1.1, y: 1.0, speed: 1.5 } },
  harvest: { kind: 'clear', intensity: 0, cloudCover: 0.1, wetness: 0, snowCover: 0, wind: { x: 2.2, y: -0.6, speed: 2.3 } },
  night: { kind: 'clear', intensity: 0, cloudCover: 0.1, wetness: 0.2, snowCover: 0, wind: { x: 0.5, y: -0.3, speed: 0.6 } },
  autumn: { kind: 'cloudy', intensity: 0.2, cloudCover: 0.5, wetness: 0.3, snowCover: 0, wind: { x: 3.4, y: 1.1, speed: 3.6 } },
  rain: { kind: 'rain', intensity: 0.8, cloudCover: 0.9, wetness: 0.9, snowCover: 0, wind: { x: 2.0, y: 1.0, speed: 2.3 } },
  winter: { kind: 'clear', intensity: 0, cloudCover: 0.2, wetness: 0.1, snowCover: 0.9, wind: { x: 1.2, y: 0.4, speed: 1.3 } },
  closeup: { kind: 'clear', intensity: 0, cloudCover: 0.2, wetness: 0.3, snowCover: 0, wind: { x: 1.2, y: 0.4, speed: 1.3 } },
};

// ---------------- painting ----------------
function seasonOf(day) {
  const m = Math.floor(day / 3);
  return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][m];
}

function makePainter(ctx, season, preset) {
  const { art, palette } = ctx;
  const n1 = art.noise('fxsc:n1'), n2 = art.noise('fxsc:n2'), n3 = art.noise('fxsc:n3');
  const rgb = (h) => art.hexToRgb(h);
  const grass = (palette.grass[season] || palette.grass.summer).map(rgb);
  const meadow = palette.meadow.map(rgb);
  const snow = palette.snow.map(rgb);
  const dirt = ['#8f7556', '#9d8462', '#7f664a', '#a88f6c'].map(rgb);
  const rut = rgb('#6a543c');
  const wetDirt = ['#5f4a36', '#6b5540', '#54402d'].map(rgb);
  const plough = rgb(palette.soil.ploughed), furrow = rgb(palette.soil.furrowDark), ridge = rgb(palette.soil.dry);
  const wheat = ['#d9b95c', '#c9a44a', '#e3c774', '#b8923e'].map(rgb);
  const stubble = ['#cdb77e', '#bfa66c', '#d9c690', '#a99462'].map(rgb);
  const crop = ['#7ea84a', '#8fb65a', '#6e9444'].map(rgb);
  const sand = palette.sand.map(rgb);
  const water = [rgb(palette.water.deep), rgb(palette.water.mid), rgb(palette.water.shallow)];
  const yard = ['#8f7757', '#9a8262', '#80694c'].map(rgb);
  const winter = season === 'winter';
  const wetTrack = preset === 'rain';

  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pal = (cols, v) => {
    v = Math.max(0, Math.min(0.9999, v)) * (cols.length - 1);
    const k = Math.floor(v);
    return lerp(cols[k], cols[k + 1] || cols[k], v - k);
  };

  function colorAt(x, y) {
    const r = regionAt(x, y, season);
    const a = n1.fbm(x * 0.12, y * 0.12, 3) * 0.5 + 0.5;
    const b = n2.at(x * 0.9, y * 0.9) * 0.5 + 0.5;
    const fine = n3.at(x * 3.1, y * 3.1);
    let c;
    switch (r) {
      case 'water': case 'shallow': {
        const d = -pondDist(x, y);
        const t = smooth(0, 5.5, d);
        c = t > 0.5 ? lerp(water[1], water[0], (t - 0.5) * 2) : lerp(water[2], water[1], t * 2);
        c = lerp(c, [236, 244, 240], Math.max(0, fine) * 0.08);
        if (winter) c = lerp(c, [200, 216, 224], 0.7);
        break;
      }
      case 'sand': c = lerp(pal(sand, a), [90, 74, 52], 0.25 + 0.25 * smooth(1, 0, pondDist(x, y))); break;
      case 'track': {
        const d = y - trackY(x);
        const rutK = Math.max(smooth(0.55, 0.05, Math.abs(d - 0.95)), smooth(0.55, 0.05, Math.abs(d + 0.95)));
        const mid = smooth(0.45, 0.1, Math.abs(d)) * (0.6 + 0.4 * b);
        const edge = smooth(TRACK_HW - 0.7, TRACK_HW, Math.abs(d + fine * 0.3));
        c = pal(wetTrack ? wetDirt : dirt, a * 0.7 + b * 0.3);
        c = lerp(c, rut, rutK * 0.18);
        c = lerp(c, pal(grass, a), Math.max(mid * 0.8, edge));
        if (winter) c = lerp(pal(snow, b), [150, 140, 128], rutK * 0.5 + 0.08);
        break;
      }
      case 'farmyard': c = pal(yard, a * 0.6 + b * 0.4); if (wetTrack) c = lerp(c, wetDirt[0], 0.4); if (winter) c = lerp(pal(snow, a), c, 0.12); break;
      case 'ploughed': {
        const f = Math.sin((y + n1.at(x * 0.05, y * 0.05) * 1.6) * TAU / 0.8);
        c = lerp(plough, f > 0 ? ridge : furrow, Math.abs(f) * (f > 0 ? 0.35 : 0.55));
        c = lerp(c, [c[0] * 0.9, c[1] * 0.9, c[2] * 0.9], b * 0.4);
        if (winter) c = lerp(pal(snow, a), furrow, f < -0.3 ? 0.18 : 0.04);
        break;
      }
      case 'crop': {
        const f = Math.sin(y * TAU / 0.5);
        c = lerp(plough, pal(crop, a), smooth(-0.2, 0.6, f + fine * 0.3) * 0.85);
        break;
      }
      case 'wheat': {
        const f = Math.sin(y * TAU / 0.33 + fine * 0.8);
        c = pal(wheat, a * 0.6 + b * 0.4);
        c = lerp(c, [c[0] * 0.78, c[1] * 0.74, c[2] * 0.7], smooth(0.3, 1, -f) * 0.6);
        break;
      }
      case 'stubble': {
        const f = Math.sin(y * TAU / 0.33);
        c = pal(stubble, a * 0.5 + b * 0.5);
        c = lerp(c, [c[0] * 0.84, c[1] * 0.8, c[2] * 0.74], smooth(0.4, 1, f) * 0.5);
        if (winter) c = lerp(pal(snow, a), c, 0.15);
        break;
      }
      default: {
        const m = smooth(0.52, 0.7, n2.fbm(x * 0.05 + 3, y * 0.05, 2) * 0.5 + 0.5);
        c = lerp(pal(grass, a * 0.7 + b * 0.3), pal(meadow, b), m * 0.7);
        if (winter) c = lerp(pal(snow, a * 0.5 + b * 0.5), pal(grass, a), Math.max(0, fine) * 0.12);
      }
    }
    return c;
  }

  function paintTile(tx, ty) {
    const key = `fxsc:tile:${season}:${preset === 'rain' ? 'wet' : 'dry'}:${tx}:${ty}`;
    return art.sprite(key, TILE * PPM, TILE * PPM, (g, w, h, rng) => {
      const img = g.createImageData(w, h);
      const d = img.data;
      const X0 = tx * TILE, Y0 = ty * TILE;
      const px = 2;
      for (let j = 0; j < h; j += px) {
        for (let i = 0; i < w; i += px) {
          const x = X0 + (i + 1) / PPM, y = Y0 + (j + 1) / PPM;
          const c = colorAt(x, y);
          const gr = 1 + (rng.float() - 0.5) * 0.07;
          const r = c[0] * gr, gg = c[1] * gr, bb = c[2] * gr;
          for (let jj = 0; jj < px; jj++) for (let ii = 0; ii < px; ii++) {
            const o = ((j + jj) * w + i + ii) * 4;
            d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
          }
        }
      }
      g.putImageData(img, 0, 0);
      // painted details
      const P = (x) => (x - X0) * PPM, Q = (y) => (y - Y0) * PPM;
      const count = TILE * TILE * 2.2;
      const gcols = palette.grass[season] || palette.grass.summer;
      g.lineCap = 'round';
      for (let k = 0; k < count; k++) {
        const x = X0 + rng.float() * TILE, y = Y0 + rng.float() * TILE;
        const r = regionAt(x, y, season);
        const sx = P(x), sy = Q(y);
        if (winter && r !== 'water' && r !== 'shallow') {
          if (rng.chance(0.25)) { g.fillStyle = `rgba(255,255,255,${rng.range(0.3, 0.7)})`; g.fillRect(sx, sy, 1.5, 1.5); }
          else if (rng.chance(0.08)) { g.fillStyle = 'rgba(120,140,170,0.18)'; g.beginPath(); g.ellipse(sx, sy, rng.range(4, 10), rng.range(2, 4), 0.2, 0, TAU); g.fill(); }
          continue;
        }
        switch (r) {
          case 'grass': {
            const c = rng.pick(gcols);
            g.strokeStyle = art.rgba(rng.chance(0.5) ? art.shade(c, -0.3) : art.shade(c, 0.18), 0.7);
            g.lineWidth = 1.3;
            g.beginPath();
            for (let s = 0; s < 4; s++) { const a = -Math.PI / 2 + rng.range(-0.9, 0.9); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * rng.range(3, 7), sy + Math.sin(a) * rng.range(3, 7)); }
            g.stroke();
            if ((season === 'spring' || season === 'summer') && rng.chance(0.07)) {
              const fc = rng.pick(palette.flowers);
              g.fillStyle = fc; g.beginPath(); g.arc(sx + 2, sy - 2, rng.range(1.5, 2.6), 0, TAU); g.fill();
              g.fillStyle = art.rgba(art.outline(fc), 0.4); g.beginPath(); g.arc(sx + 2.4, sy - 1.6, 0.8, 0, TAU); g.fill();
            }
            if (season === 'autumn') {
              // leaf litter under the trees
              for (const [tx2, ty2, tr] of TREES) {
                const dd = Math.hypot(x - tx2, y - ty2);
                if (dd < tr * 1.5 && rng.chance(1.3 - dd / (tr * 1.5))) {
                  const lc = rng.pick(palette.foliage.autumn);
                  g.fillStyle = art.rgba(lc, 0.9);
                  g.beginPath(); g.ellipse(sx, sy, rng.range(3, 5), rng.range(1.8, 3), rng.float() * TAU, 0, TAU); g.fill();
                  g.strokeStyle = art.rgba(art.outline(lc), 0.5); g.lineWidth = 0.7; g.stroke();
                }
              }
            }
            break;
          }
          case 'track': case 'farmyard': {
            if (rng.chance(0.5)) {
              const c = rng.pick(palette.gravel);
              g.fillStyle = art.rgba(c, 0.8);
              g.beginPath(); g.ellipse(sx, sy, rng.range(1.2, 2.6), rng.range(1, 2), rng.float() * 3, 0, TAU); g.fill();
              g.strokeStyle = art.rgba(art.outline(c), 0.35); g.lineWidth = 0.6; g.stroke();
            }
            break;
          }
          case 'wheat': {
            const c = rng.pick(['#e8cd7c', '#c9a44a', '#b8923e', '#f0dc98']);
            g.strokeStyle = art.rgba(c, 0.85); g.lineWidth = 2;
            const a = rng.range(-0.5, 0.5) + Math.PI / 2;
            g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5); g.stroke();
            break;
          }
          case 'stubble': {
            g.strokeStyle = art.rgba(rng.pick(['#e3d3a0', '#a08a58', '#d6c48c']), 0.7); g.lineWidth = 1.1;
            g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + rng.range(-3, 3), sy + rng.range(-2, 2)); g.stroke();
            break;
          }
          case 'ploughed': {
            if (rng.chance(0.5)) {
              const c = rng.pick([palette.soil.dry, palette.soil.ploughed, palette.soil.furrowDark]);
              g.fillStyle = art.rgba(c, 0.8);
              g.beginPath(); g.ellipse(sx, sy, rng.range(1.5, 3.5), rng.range(1.2, 2.5), rng.float() * 3, 0, TAU); g.fill();
            }
            break;
          }
          case 'crop': {
            const f = Math.sin(y * TAU / 0.5);
            if (f > 0.2) {
              const c = rng.pick(palette.foliage.spring);
              g.fillStyle = art.rgba(c, 0.9);
              g.beginPath(); g.ellipse(sx, sy, rng.range(1.5, 2.8), rng.range(1, 1.8), rng.float() * 3, 0, TAU); g.fill();
            }
            break;
          }
          case 'shallow': case 'sand': {
            if (pondDist(x, y) > -1.2 && pondDist(x, y) < 0.6 && rng.chance(0.55)) {
              g.strokeStyle = art.rgba(rng.pick([palette.water.reed, '#5f6f38', '#8f9a58']), 0.9); g.lineWidth = 1.4;
              g.beginPath();
              for (let s = 0; s < 5; s++) { const a = -Math.PI / 2 + rng.range(-0.6, 0.6); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * rng.range(6, 13), sy + Math.sin(a) * rng.range(6, 13)); }
              g.stroke();
            }
            break;
          }
          case 'water': {
            if (pondDist(x, y) > -3.5 && rng.chance(0.05)) {
              const c = '#5f8a4a', rr = rng.range(4, 8);
              g.fillStyle = c;
              g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy, rr, 0.35, TAU - 0.1); g.closePath(); g.fill();
              g.strokeStyle = art.rgba(art.outline(c), 0.6); g.lineWidth = 1; g.stroke();
              g.fillStyle = 'rgba(200,230,150,0.35)'; g.beginPath(); g.arc(sx - rr * 0.2, sy - rr * 0.2, rr * 0.45, 0, TAU); g.fill();
            }
            break;
          }
          default: break;
        }
      }
      art.grain(g, w, h, rng, 0.05, 0.015);
    });
  }
  return { paintTile, colorAt };
}

// ---------------- painted props (backdrop only) ----------------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function paintPart(art, g, x, y, w, h, r, col, rng, volume = 0.25) {
  roundRect(g, x, y, w, h, r);
  g.fillStyle = col; g.fill();
  g.save(); g.clip();
  art.dabs(g, rng, Math.max(4, (w * h) / 60), x, y, w, h, [art.shade(col, 0.12), art.shade(col, -0.12)], 2, 5, 0.35);
  const gr = g.createLinearGradient(x, y, x + w, y);
  gr.addColorStop(0, `rgba(16,24,34,${volume})`); gr.addColorStop(0.3, 'rgba(255,250,225,0.12)'); gr.addColorStop(0.7, 'rgba(255,250,225,0.08)'); gr.addColorStop(1, `rgba(16,24,34,${volume})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.restore();
  roundRect(g, x, y, w, h, r);
  g.strokeStyle = art.outline(col); g.lineWidth = 1.6; g.stroke();
}
function tyre(art, g, x, y, w, h, rng) {
  roundRect(g, x, y, w, h, Math.min(w, h) * 0.3);
  g.fillStyle = '#2c2d30'; g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(80,82,86,0.9)'; g.lineWidth = 2;
  for (let yy = y + 2; yy < y + h; yy += 5) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w / 2, yy + 3); g.lineTo(x + w, yy); g.stroke(); }
  g.restore();
  roundRect(g, x, y, w, h, Math.min(w, h) * 0.3);
  g.strokeStyle = '#18191c'; g.lineWidth = 1.2; g.stroke();
}

function tractorSprite(art, palette, color) {
  // 2.6 x 4.2 m, facing up (north)
  return art.sprite('fxsc:tractor:' + color, 2.6 * PPM, 4.2 * PPM, (g, w, h, rng) => {
    const M = PPM, cx = w / 2;
    art.contactShadow(g, cx, h * 0.55, w * 0.5, h * 0.48, 0.3);
    tyre(art, g, cx - 1.25 * M, 2.15 * M, 0.55 * M, 1.4 * M, rng);
    tyre(art, g, cx + 0.7 * M, 2.15 * M, 0.55 * M, 1.4 * M, rng);
    tyre(art, g, cx - 1.02 * M, 0.35 * M, 0.34 * M, 0.85 * M, rng);
    tyre(art, g, cx + 0.68 * M, 0.35 * M, 0.34 * M, 0.85 * M, rng);
    paintPart(art, g, cx - 0.5 * M, 0.15 * M, 1.0 * M, 2.0 * M, 8, color, rng);            // hood
    g.strokeStyle = art.rgba(art.outline(color), 0.6); g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(cx - 0.35 * M, 0.3 * M + i * 4); g.lineTo(cx + 0.35 * M, 0.3 * M + i * 4); g.stroke(); }
    paintPart(art, g, cx - 1.3 * M, 2.0 * M, 0.62 * M, 1.2 * M, 9, color, rng);             // mudguards
    paintPart(art, g, cx + 0.68 * M, 2.0 * M, 0.62 * M, 1.2 * M, 9, color, rng);
    paintPart(art, g, cx - 0.8 * M, 1.9 * M, 1.6 * M, 1.6 * M, 10, '#e8e2d2', rng, 0.18);   // cab roof
    g.fillStyle = art.rgba(palette.glass, 0.5); g.fillRect(cx - 0.7 * M, 1.95 * M, 1.4 * M, 0.12 * M);
    g.fillStyle = '#2b2d31'; g.beginPath(); g.arc(cx - 0.3 * M, 0.95 * M, 0.11 * M, 0, TAU); g.fill();       // exhaust
    g.fillStyle = '#8b9196'; g.beginPath(); g.arc(cx - 0.3 * M, 0.95 * M, 0.06 * M, 0, TAU); g.fill();
    paintPart(art, g, cx - 0.25 * M, 3.55 * M, 0.5 * M, 0.5 * M, 4, '#6c7277', rng);        // hitch
    art.grain(g, w, h, rng, 0.04, 0.02);
  });
}
function combineSprite(art, palette) {
  // 6.8 x 9.2 m (header 6.8 wide), facing up
  return art.sprite('fxsc:combine', 6.8 * PPM, 9.2 * PPM, (g, w, h, rng) => {
    const M = PPM, cx = w / 2;
    const body = palette.paint.tractorGreen, header = palette.paint.tractorYellow;
    art.contactShadow(g, cx, h * 0.58, w * 0.3, h * 0.44, 0.3);
    tyre(art, g, cx - 2.0 * M, 2.4 * M, 0.75 * M, 1.7 * M, rng);
    tyre(art, g, cx + 1.25 * M, 2.4 * M, 0.75 * M, 1.7 * M, rng);
    tyre(art, g, cx - 1.55 * M, 6.9 * M, 0.5 * M, 1.1 * M, rng);
    tyre(art, g, cx + 1.05 * M, 6.9 * M, 0.5 * M, 1.1 * M, rng);
    paintPart(art, g, cx - 1.55 * M, 2.0 * M, 3.1 * M, 6.4 * M, 12, body, rng);             // body
    paintPart(art, g, cx - 1.2 * M, 4.1 * M, 2.4 * M, 2.2 * M, 8, art.shade(body, 0.2), rng, 0.15); // grain tank
    g.strokeStyle = art.rgba(art.outline(body), 0.6); g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(cx - 1.1 * M, 6.8 * M + i * 5); g.lineTo(cx + 1.1 * M, 6.8 * M + i * 5); g.stroke(); }
    paintPart(art, g, cx - 0.85 * M, 2.15 * M, 1.7 * M, 1.6 * M, 8, '#e8e2d2', rng, 0.15);   // cab roof
    g.fillStyle = art.rgba(palette.glass, 0.55); g.fillRect(cx - 0.8 * M, 2.1 * M, 1.6 * M, 0.14 * M);
    paintPart(art, g, 0.1 * M, 0.3 * M, w - 0.2 * M, 1.6 * M, 6, header, rng);               // header
    g.strokeStyle = art.rgba(art.outline(header), 0.7); g.lineWidth = 1.2;
    for (let x = 0.4 * M; x < w - 0.3 * M; x += 0.35 * M) { g.beginPath(); g.moveTo(x, 0.35 * M); g.lineTo(x - 3, 0.05 * M); g.stroke(); } // knife guards
    g.fillStyle = art.rgba(art.shade(header, -0.3), 0.6);
    for (let x = 0.4 * M; x < w - 0.4 * M; x += 0.7 * M) g.fillRect(x, 0.8 * M, 0.35 * M, 0.7 * M);  // reel bats
    paintPart(art, g, cx - 1.9 * M, 3.4 * M, 0.35 * M, 4.8 * M, 5, '#7d8a8f', rng);          // unloading auger (folded)
    art.grain(g, w, h, rng, 0.04, 0.02);
  });
}
function boomSprite(art) {
  return art.sprite('fxsc:boom', 12.4 * PPM, 1.2 * PPM, (g, w, h, rng) => {
    paintPart(art, g, 0, h * 0.35, w, h * 0.22, 4, '#8b9196', rng, 0.1);
    for (let x = 12; x < w - 6; x += 0.5 * PPM) { g.fillStyle = '#4a4c50'; g.beginPath(); g.arc(x, h * 0.62, 2.2, 0, TAU); g.fill(); }
    paintPart(art, g, w / 2 - 0.7 * PPM, 0, 1.4 * PPM, h, 8, '#e8e6df', rng, 0.15);
  });
}
function ploughSprite(art) {
  return art.sprite('fxsc:plough', 3.2 * PPM, 2.8 * PPM, (g, w, h, rng) => {
    g.save(); g.translate(w / 2, h / 2); g.rotate(0.45);
    paintPart(art, g, -0.15 * PPM, -1.3 * PPM, 0.3 * PPM, 2.6 * PPM, 3, '#b8352b', rng, 0.1);
    for (let i = 0; i < 4; i++) paintPart(art, g, 0.05 * PPM, (-1.1 + i * 0.62) * PPM, 0.5 * PPM, 0.34 * PPM, 3, '#9aa0a4', rng, 0.1);
    g.restore();
  });
}
function roofSprite(art, palette, season) {
  const { w: W, h: H } = COTTAGE;
  return art.sprite('fxsc:roof:' + season, W * PPM, H * PPM, (g, w, h, rng) => {
    const cols = palette.roof.thatch;
    art.noiseFill(g, 0, 0, w, h, cols, { scale: 0.06, seed: 'fxroof', px: 2 });
    // thatch strokes
    g.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const x = rng.float() * w, y = rng.float() * h;
      const up = y < h / 2 ? -1 : 1;
      g.strokeStyle = art.rgba(rng.pick([art.shade(cols[0], -0.25), art.shade(cols[1], 0.2), cols[2]]), 0.55);
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-1, 1), y + up * rng.range(4, 9)); g.stroke();
    }
    if (season === 'winter') { g.fillStyle = 'rgba(242,246,248,0.78)'; g.fillRect(0, 0, w, h); art.dabs(g, rng, 60, 0, 0, w, h, ['#ffffff', '#dfe6ea'], 3, 9, 0.5); }
    else if (season !== 'summer') art.dabs(g, rng, 30, 0, 0, w, h, [palette.roof.moss], 3, 8, 0.35);
    // ridge
    g.fillStyle = art.rgba(art.shade(cols[2], -0.2), 0.9); g.fillRect(0, h / 2 - 5, w, 10);
    g.fillStyle = 'rgba(255,248,225,0.18)'; g.fillRect(0, h / 2 - 5, w, 4);
    // eave shading (top-down form, no direction)
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(20,24,36,0.25)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,24,36,0.25)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = art.outline(cols[0]); g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  });
}
function chimneySprite(art, palette) {
  return art.sprite('fxsc:chimney', 1 * PPM, 1 * PPM, (g, w, h, rng) => {
    paintPart(art, g, 1, 1, w - 2, h - 2, 3, palette.brick[0], rng, 0.2);
    g.fillStyle = '#231d1a'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.24, 0, TAU); g.fill();
  });
}
function treeSprite(art, palette, season, r, kind, idx) {
  return art.sprite(`fxsc:tree:${season}:${kind || 'n'}:${idx}`, r * 2.2 * PPM, r * 2.2 * PPM, (g, w, h, rng) => {
    const cx = w / 2, cy = h / 2, R = r * PPM;
    let cols = (palette.foliage[season] || palette.foliage.summer);
    if (kind === 'blossom' && season === 'spring') cols = ['#f0c2cf', '#f6e4ea', '#e89ab6', '#f8f2f0'];
    if (season === 'winter') {
      // bare branches
      g.strokeStyle = palette.bark[0]; g.lineCap = 'round';
      const br = (x, y, a, L, wd, d) => {
        if (d > 5 || L < 3) return;
        const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
        g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        br(x2, y2, a + rng.range(0.2, 0.6), L * 0.7, wd * 0.65, d + 1);
        br(x2, y2, a - rng.range(0.2, 0.6), L * 0.7, wd * 0.65, d + 1);
      };
      for (let i = 0; i < 6; i++) br(cx, cy, (i / 6) * TAU + rng.range(-0.3, 0.3), R * 0.38, 6, 0);
      return;
    }
    const shapeSeed = rng.fork('shape');
    const outlinePath = () => art.blobPath(g, cx, cy, R, shapeSeed.fork('p'), 0.1, 5);
    outlinePath();
    g.fillStyle = cols[2 % cols.length]; g.fill();
    g.save(); g.clip();
    art.dabs(g, rng, 520, cx - R, cy - R, R * 2, R * 2, cols, R * 0.05, R * 0.12, 0.8);
    for (let i = 0; i < 8; i++) {
      const a = rng.float() * TAU, rr = rng.range(0.1, 0.6) * R;
      art.dabs(g, rng, 12, cx + Math.cos(a) * rr - R * 0.2, cy + Math.sin(a) * rr - R * 0.2, R * 0.4, R * 0.4, [art.shade(cols[1], 0.25)], R * 0.05, R * 0.1, 0.6);
    }
    g.restore();
    outlinePath();
    art.volume(g, cx, cy, R, 0.38);
    outlinePath();
    g.strokeStyle = art.rgba(art.outline(cols[0]), 0.5); g.lineWidth = 2; g.stroke();
  });
}

// ---------------- vehicle helpers ----------------
function local(v, lx, ly) {
  const c = Math.cos(v.rot), s = Math.sin(v.rot);
  return [v.x + lx * c - ly * s, v.y + lx * s + ly * c];
}

// ---------------- stage ----------------
export const showcase = {
  deps: ['environment'],
  presets: PRESETS,
  async stage(ctx, presetName) {
    const I = internals.get(ctx);
    if (!I) return;
    const { art, palette, world, clock } = ctx;
    const preset = PRESETS[presetName] ? presetName : 'default';
    const season = seasonOf(PRESETS[preset].day != null ? PRESETS[preset].day : clock.dayOfYear);
    const api = I.api;
    const hooks = I.hooks;
    const W = PRESET_WEATHER[preset];
    const envApi = ctx.modules.get('environment');
    const envHasWeather = () => { const e = world.environment || {}; return !!(e.weather && e.weather.kind); };
    if (envApi && typeof envApi.setWeather === 'function' && !ctx.params.weather) {
      envApi.setWeather(W.kind, W.intensity || 0.7, { instant: true });
    }
    // fallbacks used only while environment/terrain are not providing data
    hooks.weather = Object.assign({}, W);
    if (ctx.params.weather && !envHasWeather()) hooks.weather.kind = ctx.params.weather;
    const terr = ctx.modules.get('terrain');
    hooks.surfaceAt = (x, y) => {
      const r = regionAt(x, y, season);
      if (r === 'track') return preset === 'rain' ? 'mud' : 'soil';
      if (r === 'wheat' || r === 'stubble' || r === 'crop') return 'soil';
      if (r === 'farmyard') return 'farmyard';
      if (r === 'grass') return 'grass';
      return r;
    };
    hooks.isWater = (x, y) => pondDist(x, y) < 0;
    hooks.fireflyZones = [{ x: POND.x, y: POND.y, r: 14 }, { x: 70, y: 40, r: 10 }, { x: 96, y: 52, r: 9 }, { x: 64, y: 54, r: 6 }];
    hooks.butterflyZones = [{ x: 40, y: 50, r: 10 }, { x: 70, y: 52, r: 9 }, { x: 28, y: 40, r: 9 }, { x: 100, y: 50, r: 10 }];
    hooks.leafSources = season === 'autumn' ? TREES.filter((t) => !t[3]).map(([x, y, r]) => ({ x, y, r: r * 0.9, h: 7 })) : null;
    void terr;

    // ---- backdrop: painted tiles, pre-painted for the preset camera
    const painter = makePainter(ctx, season, preset);
    const cam = PRESETS[preset].camera;
    const vw = (ctx.camera.w || 1600) / cam.zoom / 2 + TILE, vh = (ctx.camera.h || 900) / cam.zoom / 2 + TILE;
    for (let ty = Math.floor((cam.y - vh) / TILE); ty <= Math.floor((cam.y + vh) / TILE); ty++) {
      for (let tx = Math.floor((cam.x - vw) / TILE); tx <= Math.floor((cam.x + vw) / TILE); tx++) {
        if (tx * TILE >= BACK.x0 && ty * TILE >= BACK.y0 && tx * TILE < BACK.x1 && ty * TILE < BACK.y1) painter.paintTile(tx, ty);
      }
    }
    // The showcase camera is static, so the tiles are composited once into a screen-sized
    // canvas and blitted 1:1 (one unscaled copy per frame instead of ~15 scaled tile blits).
    const comp = { canvas: null, key: '' };
    const drawTiles = (g, view) => {
      const tx0 = Math.max(Math.floor(view.x0 / TILE), BACK.x0 / TILE), tx1 = Math.min(Math.floor(view.x1 / TILE), BACK.x1 / TILE - 1);
      const ty0 = Math.max(Math.floor(view.y0 / TILE), BACK.y0 / TILE), ty1 = Math.min(Math.floor(view.y1 / TILE), BACK.y1 / TILE - 1);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        g.drawImage(painter.paintTile(tx, ty), tx * TILE, ty * TILE, TILE + 0.02, TILE + 0.02);
      }
    };
    ctx.renderer.addLayer('ground', (g, view) => {
      if (I.off.has('backdrop')) return;
      const m = g.getTransform();
      const W = g.canvas.width, H = g.canvas.height;
      const key = [m.a, m.e, m.f, W, H].map((v) => v.toFixed(2)).join(',');
      if (comp.key !== key) {
        if (!comp.canvas) comp.canvas = art.canvas(W, H);
        if (comp.canvas.width !== W || comp.canvas.height !== H) { comp.canvas.width = W; comp.canvas.height = H; }
        const cg = comp.canvas.getContext('2d');
        cg.setTransform(1, 0, 0, 1, 0, 0);
        cg.fillStyle = '#6f9a3f'; cg.fillRect(0, 0, W, H);
        cg.setTransform(m);
        drawTiles(cg, view);
        comp.key = key;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(comp.canvas, 0, 0);
    }, -10);

    // ---- static props
    const roof = roofSprite(art, palette, season);
    const chim = chimneySprite(art, palette);
    const trees = TREES.map((t, i) => ({ x: t[0], y: t[1], r: t[2], kind: t[3], img: treeSprite(art, palette, season, t[2], t[3], i) }));
    const actors = [];

    // ---- vehicles
    const T = { t: 0 };
    const trackVehicle = (id, x0, speed, color, opts = {}) => {
      const v = { id, x: x0, y: trackY(x0), rot: 0, speed, img: tractorSprite(art, palette, color), w: 2.6, h: 4.2, x0, opts };
      v.place = (t) => {
        v.x = v.x0 + v.speed * t;
        v.y = trackY(v.x) + (opts.lane || 0);
        v.rot = Math.atan2(Math.sign(v.speed) || 1, -trackSlope(v.x) * (Math.sign(v.speed) || 1));
      };
      return v;
    };
    const lineVehicle = (id, x0, y, speed, img, w, h) => {
      const v = { id, x: x0, y, rot: speed >= 0 ? Math.PI / 2 : -Math.PI / 2, speed, img, w, h, x0 };
      v.place = (t) => { v.x = v.x0 + v.speed * t; };
      return v;
    };

    const E = []; // per-frame emitter updaters
    const vehicles = [];
    const addTractorFx = (v, { dust = 12, exhaust = 5, trailType = 'tyre', trail = true, dustColor } = {}) => {
      const dl = api.emitter('dust', { rate: dust, color: dustColor });
      const dr = api.emitter('dust', { rate: dust, color: dustColor });
      const ex = api.emitter('exhaust', { rate: exhaust, z: 2.8, life: 1.5 });
      E.push(() => {
        const moving = Math.abs(v.speed) > 0.01;
        const [lx, ly] = local(v, -0.97, 1.9), [rx, ry] = local(v, 0.97, 1.9);
        const back = local(v, 0, 1), bx = back[0] - v.x, by = back[1] - v.y;
        dl.setPosition(lx, ly).setDir(bx, by).setRate(moving ? dust : 0);
        dr.setPosition(rx, ry).setDir(bx, by).setRate(moving ? dust : 0);
        const [ex0, ey0] = local(v, -0.3, -1.15);
        ex.setPosition(ex0, ey0).setDir(bx, by);
        if (trail && moving) {
          api.trail(v.id + ':l', lx, ly, v.rot, 0.55, trailType);
          api.trail(v.id + ':r', rx, ry, v.rot, 0.55, trailType);
        }
      });
    };

    const W2 = hooks.weather.wind;
    if (preset === 'default' || preset === 'winter' || preset === 'closeup') {
      // drive against the wind so the dust plume streams out behind the tractor
      const wx = (I.wind() || {}).x || 0;
      const dirSign = wx > 0.2 ? -1 : 1;
      const tA = trackVehicle('sc:tA', (preset === 'closeup' ? 54 : 56) - dirSign * 4, 2.2 * dirSign, palette.paint.tractorRed);
      vehicles.push(tA);
      addTractorFx(tA, { dust: preset === 'winter' ? 0 : 4.5, dustColor: '#a88b64' });
      if (preset === 'winter') {
        const sp1 = api.emitter('snowpuff', { rate: 10 }), sp2 = api.emitter('snowpuff', { rate: 10 });
        E.push(() => { sp1.setPosition(...local(tA, -0.97, 2.2)); sp2.setPosition(...local(tA, 0.97, 2.2)); });
      }
      if (preset === 'default') {
        // sprayer in the young crop
        const tB = lineVehicle('sc:tB', 49, 73.5, 1.6, tractorSprite(art, palette, palette.paint.tractorGreen), 2.6, 4.2);
        tB.boom = boomSprite(art);
        vehicles.push(tB);
        addTractorFx(tB, { dust: 3, exhaust: 4, dustColor: '#8a6a48' });
        // one emitter sweeping along the 12 m boom gives a continuous mist band
        const mist = api.emitter('spray', { rate: 18, jitter: 0.35, size: 0.85 });
        const boomRng = ctx.rng('showcase-boom');
        E.push(() => {
          const [x, y] = local(tB, boomRng.range(-5.9, 5.9), 3.1);
          const b = local(tB, 0, 1);
          mist.setPosition(x, y).setDir(b[0] - tB.x, b[1] - tB.y);
        });
      }
    }
    if (preset === 'harvest') {
      const cmb = lineVehicle('sc:cmb', COMBINE_X0, COMBINE_Y, -1.2, combineSprite(art, palette), 6.8, 9.2);
      vehicles.push(cmb);
      const chaff = api.emitter('chaff', { rate: 17, speed: 3.0, spread: 0.8 });
      const chDust = api.emitter('dust', { rate: 7, size: 1.8, color: '#d8c08a' });
      const hdDust = api.emitter('dust', { rate: 5, size: 1.2, color: '#c9ad78' });
      const exh = api.emitter('exhaust', { rate: 4, z: 3.8 });
      E.push(() => {
        const b = local(cmb, 0, 1);
        const [sx, sy] = local(cmb, 0, 4.6);
        chaff.setPosition(sx, sy).setDir(b[0] - cmb.x, b[1] - cmb.y);
        chDust.setPosition(sx, sy).setDir(b[0] - cmb.x, b[1] - cmb.y);
        const hs = local(cmb, (T.t * 7 % 6) - 3, -4.2);
        hdDust.setPosition(hs[0], hs[1]);
        exh.setPosition(...local(cmb, 1.0, 3.2));
        api.trail('sc:cmb:l', ...local(cmb, -1.6, 3.3), cmb.rot, 0.75, 'tyre');
        api.trail('sc:cmb:r', ...local(cmb, 1.6, 3.3), cmb.rot, 0.75, 'tyre');
      });
      const pl = lineVehicle('sc:pl', 53.5, 88.5, 1.5, tractorSprite(art, palette, palette.paint.tractorBlue), 2.6, 4.2);
      pl.plough = ploughSprite(art);
      vehicles.push(pl);
      addTractorFx(pl, { dust: 3, exhaust: 4, dustColor: '#8a6a48' });
      const clods = api.emitter('clods', { rate: 11, speed: 1.8, spread: 0.6, size: 0.42 });
      const pDust = api.emitter('dust', { rate: 4, size: 1.0, color: '#8a6a48' });
      E.push(() => {
        const [cx, cy] = local(pl, 0.9, 4.2);
        const side = local(pl, 1, 0);
        clods.setPosition(cx, cy).setDir(side[0] - pl.x, side[1] - pl.y);
        pDust.setPosition(cx, cy);
        for (let k = 0; k < 3; k++) api.trail('sc:pl:f' + k, ...local(pl, -0.4 + k * 0.62, 4.6), pl.rot, 0.5, 'furrow');
      });
      api.decal('spill', 94, 72.5, 0.3, { size: 1.6, color: '#d9b95c' });
      api.decal('spill', 92.6, 73.2, 1.2, { size: 0.9, color: '#d9b95c' });
    }
    if (preset === 'rain') {
      const tR = trackVehicle('sc:tR', 62, 0, palette.paint.tractorRed);
      vehicles.push(tR);
      addTractorFx(tR, { dust: 0, exhaust: 6 });
      const st = api.emitter('steam', { rate: 5, z: 1.8 });
      E.push(() => st.setPosition(...local(tR, 0, -1.2)));
    }

    // chimney smoke (every preset) + autumn bonfire
    api.emitter('chimney', { x: CHIMNEY.x, y: CHIMNEY.y, rate: 2.1, z: 7.2 });
    if (preset === 'autumn') {
      api.decal('scorch', 44.5, 56, 0.4, { size: 3 });
      api.emitter('chimney', { x: 44.5, y: 56, rate: 4, z: 0.4, size: 0.8, color: '#9d9a92' });
      api.emitter('sparkle', { x: 44.5, y: 56, rate: 3, color: '#ffb060' });
    }
    // petals from the blossom tree in spring
    if (season === 'spring') {
      const bt = TREES[5];
      const pe = api.emitter('petals', { x: bt[0], y: bt[1], rate: 1.6, z: 3.5, count: 1 });
      E.push(() => { const a = T.t * 1.7; pe.setPosition(bt[0] + Math.cos(a) * 1.8, bt[1] + Math.sin(a * 1.3) * 1.8); });
    }
    // sun glints on the pond on bright days
    const glintOn = (preset === 'default' || preset === 'harvest' || preset === 'closeup');
    const glintRng = ctx.rng('showcase-glint');

    // ---- decals: footprints, hoofprints, puddles, spills
    {
      // footprints from the cottage door down to the track (pairs every ~1.3 m)
      let x = 54.5, y = 49, i = 0;
      const tx = 57.5, ty = trackY(57.5) - 2.4;
      const L = Math.hypot(tx - x, ty - y), dx = (tx - x) / L, dy = (ty - y) / L;
      for (let s = 0; s < L; s += 1.3, i++) api.decal('footprint', x + dx * s + Math.sin(s) * 0.2, y + dy * s, Math.atan2(dx, -dy), { variant: i });
      // hoofprints along the verge
      for (let s = 20; s < 100; s += 0.9) {
        const hy = trackY(s) - 1.55 + Math.sin(s * 0.7) * 0.12;
        api.decal('hoofprint', s, hy + ((s * 10 | 0) % 2 ? 0.2 : -0.2), Math.PI / 2, { variant: (s * 3) | 0 });
      }
      if (preset === 'default' || preset === 'rain' || preset === 'closeup') {
        for (const [px, sz] of [[40, 2.6], [66, 3.2], [75, 2.2], [47.5, 2.0]]) api.decal('puddle', px, trackY(px) + 0.8 * (px % 2 ? 1 : -1), Math.atan2(trackSlope(px), 1), { size: sz, variant: px | 0 });
      }
      if (preset === 'rain') {
        api.decal('puddle', 50, 49, 0.2, { size: 3.2, variant: 1 });
        api.decal('puddle', 57, 53.5, 0.8, { size: 2.2, variant: 2 });
      }
      if (preset === 'default') api.decal('spill', 49, 41, 0, { size: 0.9, color: '#3a3430' }); // oil drip in the yard
      // older tyre tracks: a vehicle passed along the track earlier
      for (let s = 10; s < 118; s += 0.5) {
        api.trail('sc:old:l', s, trackY(s) - 0.95, Math.PI / 2, 0.5, 'tyre');
        api.trail('sc:old:r', s, trackY(s) + 0.95, Math.PI / 2, 0.5, 'tyre');
      }
      api.endTrail('sc:old:l'); api.endTrail('sc:old:r');
    }

    // ---- actors: y-sorted objects + shadows (and lights at night)
    ctx.renderer.addCollector((view, F) => {
      if (I.off.has('props')) return;
      // cottage
      const cx = COTTAGE.x, cy = COTTAGE.y;
      F.shadow.box(cx, cy, COTTAGE.w, COTTAGE.h, 0, 5.2);
      F.shadow.box(CHIMNEY.x, CHIMNEY.y, 0.9, 0.9, 0, 7.2);
      F.object({ y: cy + COTTAGE.h / 2, draw(g) { g.drawImage(roof, cx - COTTAGE.w / 2, cy - COTTAGE.h / 2, COTTAGE.w, COTTAGE.h); g.drawImage(chim, CHIMNEY.x - 0.5, CHIMNEY.y - 0.5, 1, 1); } });
      if (I.daylight() < 0.5) {
        F.light({ x: 49.5, y: cy + 4.1, radius: 5, color: palette.lamp, intensity: 0.8, glow: 0.4 });
        F.light({ x: 55.5, y: cy + 4.1, radius: 4.5, color: palette.lamp, intensity: 0.7, glow: 0.4 });
      }
      for (const t of trees) {
        if (t.x + t.r < view.x0 - 8 || t.x - t.r > view.x1 + 8 || t.y + t.r < view.y0 - 8 || t.y - t.r > view.y1 + 8) continue;
        F.shadow.circle(t.x, t.y, t.r * (season === 'winter' ? 0.6 : 0.95), 2, 7.5, 0.45);
        F.object({ y: t.y, draw(g) { g.drawImage(t.img, t.x - t.r * 1.1, t.y - t.r * 1.1, t.r * 2.2, t.r * 2.2); } });
      }
      for (const v of vehicles) {
        F.shadow.box(v.x, v.y, v.w * 0.85, v.h * 0.85, v.rot, v.img === undefined ? 2 : (v.w > 5 ? 3.6 : 2.6));
        F.object({
          y: v.y, draw(g) {
            g.translate(v.x, v.y); g.rotate(v.rot);
            if (v.boom) g.drawImage(v.boom, -6.2, 2.4, 12.4, 1.2);
            if (v.plough) g.drawImage(v.plough, -1.2, 3.1, 3.2, 2.8);
            g.drawImage(v.img, -v.w / 2, -v.h / 2, v.w, v.h);
          },
        });
      }
    });
    ctx.renderer.addLayer('overhead', (g) => {
      // tree canopies over the ground particles is handled by y-sort; nothing extra
    }, 0);

    // fallback atmosphere while environment provides no ambient/weather (showcase only)
    const env = () => world.environment || {};
    ctx.renderer.addLayer('weather', (g, view) => {
      const e = env();
      const w = view.x1 - view.x0, h = view.y1 - view.y0;
      if (!Array.isArray(e.ambient)) {
        const night = 1 - I.daylight();
        if (night > 0.05) {
          g.globalCompositeOperation = 'multiply';
          const a = Math.min(1, night);
          g.fillStyle = `rgb(${255 - (255 - 46) * a | 0},${255 - (255 - 58) * a | 0},${255 - (255 - 110) * a | 0})`;
          g.fillRect(view.x0, view.y0, w, h);
          g.globalCompositeOperation = 'source-over';
        }
      }
      if (!(e.weather && e.weather.kind) && hooks.weather && (hooks.weather.kind === 'rain' || hooks.weather.kind === 'storm')) {
        g.fillStyle = 'rgba(70,84,100,0.16)';
        g.fillRect(view.x0, view.y0, w, h);
        // light painterly streaks (the environment module owns real rain)
        const r = ctx.rng('sc-rain-' + ((view.time * 12) | 0));
        const wi = hooks.weather.wind;
        g.strokeStyle = 'rgba(214,226,236,0.35)'; g.lineWidth = 0.035; g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 260; i++) {
          const x = view.x0 + r.float() * w, y = view.y0 + r.float() * h;
          g.moveTo(x, y); g.lineTo(x + wi.x * 0.12, y + 0.9 + wi.y * 0.12);
        }
        g.stroke();
      }
    }, 0);
    ctx.renderer.addLayer('glow', (g) => {
      const e = env();
      if (Array.isArray(e.ambient)) return; // core glow pass handles lights when env is present
      const night = 1 - I.daylight();
      if (night < 0.1) return;
      g.globalCompositeOperation = 'lighter';
      const halo = I.sprites.list[I.sprites.halo('#ffc478')];
      g.globalAlpha = 0.55 * night;
      for (const [x, y, r] of [[49.5, COTTAGE.y + 4.1, 3.2], [55.5, COTTAGE.y + 4.1, 2.8]]) g.drawImage(halo, x - r, y - r, r * 2, r * 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }, -1);

    // ---- per-frame showcase animation
    const place = () => { for (const v of vehicles) v.place(T.t); };
    I.showcaseFrame = (dt) => {
      T.t += dt;
      place();
      for (const f of E) f();
      if (glintOn && glintRng.chance(dt * 5)) {
        const a = glintRng.float() * TAU, r = Math.sqrt(glintRng.float()) * 5.5;
        I.particles.emit('sparkle', POND.x + Math.cos(a) * r, POND.y + Math.sin(a) * r, { count: 1 });
      }
    };

    // ---- pre-warm: run vehicles from far back so trails are laid, then settle particles
    const view = ctx.camera.view();
    const warm = preset === 'autumn' ? 14 : preset === 'night' ? 12 : 10;
    const back = 14; // seconds of vehicle history for trails
    const dt = 1 / 30;
    T.t = -(back + warm);
    for (let t = -(back + warm); t < 0; t += dt) {
      I.showcaseFrame(dt);
      I.step(dt, view);
      if (t < -warm) I.particles.clear();
    }
    if (preset === 'default' || preset === 'winter') I.spawnFlock(view, 8, { x: view.x0 + 8, y: view.y0 + 9, dirX: 0.94, dirY: 0.34, speed: 5, z: 26 });
    if (preset === 'harvest') I.spawnFlock(view, 6, { x: view.x0 + 12, y: view.y1 - 6, dirX: 0.8, dirY: -0.6, speed: 5, z: 18 });
    if (preset === 'autumn') I.spawnFlock(view, 10, { x: view.x0 + 6, y: view.y0 + 4, dirX: 1, dirY: 0.25, speed: 5.5, z: 30 });
  },
};
