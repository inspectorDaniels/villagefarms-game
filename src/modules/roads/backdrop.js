// Showcase-only painted backdrop (grass, meadow patches, a ploughed field, a river with banks
// and reeds) so the roads showcase looks right even when the terrain module is absent.
import { smoothPolyline, pathFrom, frames, offsetPts } from './geom.js';
import { patternFor } from './textures.js';

export function makeBackdrop({ art, palette, tex, getSeason, river, fields }) {
  const M = art.mix, S = art.shade;
  const noise = art.noise('roads-backdrop');
  const rv = smoothPolyline(river.pts, 2).pts;
  const fr = frames(rv);
  const hwAt = (i) => river.width / 2 + 1.6 * noise.at(i * 0.04, 1.3);
  const bankL = (k) => offsetPts(rv, fr.tx, fr.ty, (i) => -(hwAt(i) + k));
  const bankR = (k) => offsetPts(rv, fr.tx, fr.ty, (i) => hwAt(i) + k);
  const band = (k0, k1) => { const a = bankR(k0), b = bankR(k1).reverse(), c = bankL(k0), d = bankL(k1).reverse(); return [a.concat(b), c.concat(d)]; };
  const waterPoly = (k) => bankR(k).concat(bankL(k).reverse());
  const prng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  function paint(g, rect, res) {
    const season = getSeason();
    const grass = palette.grass[season] || palette.grass.summer;
    const lod = res >= 16 ? 2 : res >= 6 ? 1 : 0;
    g.fillStyle = patternFor(g, tex.grass[season] || tex.grass.summer, res);
    g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    // large-scale tonal variation (meadow / lush / dry)
    const step = 7;
    for (let x = Math.floor(rect.x0 / step) * step - step; x < rect.x1 + step; x += step) {
      for (let y = Math.floor(rect.y0 / step) * step - step; y < rect.y1 + step; y += step) {
        const v = noise.fbm(x * 0.008, y * 0.008, 3);
        const w = noise.at(x * 0.05 + 40, y * 0.05);
        const jx = noise.at(x * 0.3, y * 0.3 + 9) * 3, jy = noise.at(x * 0.3 + 5, y * 0.3) * 3;
        if (v > 0.12) { g.fillStyle = palette.meadow[(Math.abs(w * 10) | 0) % 4]; g.globalAlpha = Math.min(0.28, (v - 0.12) * 0.9); }
        else if (v < -0.2) { g.fillStyle = S(grass[2], -0.2); g.globalAlpha = Math.min(0.2, (-0.2 - v) * 0.8); }
        else continue;
        g.beginPath(); g.ellipse(x + jx, y + jy, step * 0.95, step * 0.75, w * 3, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
    // fields
    for (const f of fields) {
      g.save();
      g.beginPath(); pathFrom(g, f.poly, true);
      g.fillStyle = patternFor(g, tex.dirt, res); g.fill();
      g.fillStyle = 'rgba(70,50,30,0.25)'; g.fill();
      g.clip();
      g.strokeStyle = palette.soil.furrowDark; g.globalAlpha = 0.5; g.lineWidth = 0.28;
      g.beginPath();
      const [ax, ay] = f.dir;
      for (let o = -400; o < 400; o += 0.9) {
        const px = f.poly[0][0] - ay * o, py = f.poly[0][1] + ax * o;
        g.moveTo(px - ax * 400, py - ay * 400); g.lineTo(px + ax * 400, py + ay * 400);
      }
      g.stroke();
      g.strokeStyle = M(palette.soil.dry, '#ffffff', 0.15); g.globalAlpha = 0.35; g.lineWidth = 0.18;
      g.beginPath();
      for (let o = -400; o < 400; o += 0.9) {
        const px = f.poly[0][0] - ay * (o + 0.45), py = f.poly[0][1] + ax * (o + 0.45);
        g.moveTo(px - ax * 400, py - ay * 400); g.lineTo(px + ax * 400, py + ay * 400);
      }
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
      g.beginPath(); pathFrom(g, f.poly, true); g.strokeStyle = S(grass[2], -0.25); g.lineWidth = 0.6; g.globalAlpha = 0.45; g.stroke(); g.globalAlpha = 1;
    }
    // river: banks → shallows → deep
    const bb = rv.some((p) => p[0] > rect.x0 - 40 && p[0] < rect.x1 + 40 && p[1] > rect.y0 - 40 && p[1] < rect.y1 + 40);
    if (!bb) return;
    const layers = [
      [4.2, M(palette.soil.moist, grass[2], 0.4), 0.55],
      [2.6, palette.soil.moist, 0.85],
      [1.5, palette.sand[1], 0.9],
      [0.5, M(palette.sand[1], palette.water.shallow, 0.5), 1],
      [0, palette.water.shallow, 1],
      [-1.6, M(palette.water.shallow, palette.water.mid, 0.5), 1],
      [-3.2, palette.water.mid, 1],
      [-5.5, M(palette.water.mid, palette.water.deep, 0.6), 1],
    ];
    for (const [k, col, a] of layers) {
      g.beginPath(); pathFrom(g, waterPoly(k), true);
      g.fillStyle = col; g.globalAlpha = a; g.fill();
    }
    g.globalAlpha = 1;
    // painterly current streaks + foam line
    const rnd = prng(77);
    g.lineCap = 'round';
    for (let i = 0; i < rv.length - 6; i += 3) {
      const lat = (rnd() - 0.5) * river.width * 0.7;
      const p = rv[i], q = rv[i + 5];
      g.strokeStyle = rnd() < 0.5 ? palette.water.deep : M(palette.water.shallow, '#ffffff', 0.3);
      g.globalAlpha = 0.12 + rnd() * 0.12; g.lineWidth = 0.25 + rnd() * 0.4;
      g.beginPath(); g.moveTo(p[0] - fr.ty[i] * lat, p[1] + fr.tx[i] * lat); g.lineTo(q[0] - fr.ty[i + 5] * lat, q[1] + fr.tx[i + 5] * lat); g.stroke();
    }
    g.globalAlpha = 0.5; g.lineWidth = 0.15; g.strokeStyle = palette.water.foam;
    for (const side of [bankR(0.1), bankL(0.1)]) { g.beginPath(); pathFrom(g, side); g.stroke(); }
    g.globalAlpha = 1;
    // reeds + pebbles along the banks
    if (lod >= 1) {
      for (const [sideFn, sgn] of [[bankR, 1], [bankL, -1]]) {
        const edge = sideFn(0.6);
        for (let i = 0; i < edge.length; i++) {
          const p = edge[i];
          if (p[0] < rect.x0 - 3 || p[0] > rect.x1 + 3 || p[1] < rect.y0 - 3 || p[1] > rect.y1 + 3) continue;
          const r2 = prng(i * 131 + (sgn > 0 ? 1 : 2));
          const clump = noise.at(i * 0.15, sgn * 3) > 0.05;
          const n = clump ? (lod >= 2 ? 26 : 10) : (lod >= 2 ? 4 : 1);
          g.lineWidth = lod >= 2 ? 0.05 : 0.09;
          for (let k = 0; k < n; k++) {
            const off = (r2() - 0.6) * 2.2;
            const x = p[0] + (r2() - 0.5) * 2 - fr.ty[i] * sgn * off, y = p[1] + (r2() - 0.5) * 2 + fr.tx[i] * sgn * off;
            const an = r2() * 6.28, l = 0.25 + r2() * 0.5;
            g.strokeStyle = r2() < 0.5 ? palette.water.reed : S(palette.water.reed, -0.3 + r2() * 0.5);
            if (season === 'autumn' || season === 'winter') g.strokeStyle = M(g.strokeStyle, palette.roof.thatch[0], 0.5);
            g.globalAlpha = 0.9;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke();
          }
          if (lod >= 2 && r2() < 0.3) {
            g.fillStyle = palette.rock[(r2() * 4) | 0]; g.globalAlpha = 0.9;
            const x = p[0] - fr.ty[i] * sgn * -1.2, y = p[1] + fr.tx[i] * sgn * -1.2;
            g.beginPath(); g.ellipse(x, y, 0.12 + r2() * 0.15, 0.1 + r2() * 0.1, r2() * 3, 0, 6.283); g.fill();
          }
        }
      }
      g.globalAlpha = 1;
    }
  }
  return { paint, waterPoly, rv };
}
