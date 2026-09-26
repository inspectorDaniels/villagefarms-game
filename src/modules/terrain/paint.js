// Terrain painting: seasonal colour LUTs, the per-pixel "gouache" ground shader,
// decal sprites (tufts, flowers, pebbles, reeds, lily pads...) and water shimmer layers.
import { S, SURFACES, NO_WATER, F_LILY, F_LAKE } from './gen.js';

const NSURF = SURFACES.length;
const LUTN = 64;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- looks (seasonal LUTs)
function lum(c) { return c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15; }

export function makeLook(art, P, season, snow, wet) {
  const rgb = art.hexToRgb, mix = art.mix, shade = art.shade;
  const grad = (cols, sort = true) => {
    const cs = cols.map((c) => rgb(c));
    if (sort) cs.sort((a, b) => lum(a) - lum(b));
    const out = new Float32Array(LUTN * 3);
    for (let i = 0; i < LUTN; i++) {
      const f = (i / (LUTN - 1)) * (cs.length - 1);
      const k = Math.min(cs.length - 2, Math.floor(f)), t = f - k;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = cs[k][c] + (cs[k + 1][c] - cs[k][c]) * t;
    }
    return out;
  };
  const gr = P.grass[season];
  const fol = P.foliage[season];
  const meadowBase = P.meadow;
  const meadow = season === 'spring' ? meadowBase.map((c, i) => mix(c, P.grass.spring[i], 0.4))
    : season === 'autumn' ? meadowBase.map((c, i) => mix(c, P.grass.autumn[(i + 1) % 4], 0.55))
      : season === 'winter' ? meadowBase.map((c, i) => mix(c, P.grass.winter[i], 0.7)) : meadowBase;
  const soil = P.soil;
  const sets = [];
  sets[S.grass] = gr;
  sets[S.meadow] = meadow;
  sets[S.soil] = [shade(soil.moist, -0.1), soil.moist, soil.dry, mix(soil.dry, soil.clay, 0.5)];
  sets[S.ploughed] = [soil.furrowDark, soil.ploughed, mix(soil.ploughed, soil.moist, 0.5), soil.moist];
  sets[S.sand] = [shade(P.sand[1], -0.08), P.sand[1], P.sand[0], P.sand[2]];
  sets[S.gravel] = P.gravel;
  sets[S.rock] = P.rock;
  sets[S.water] = [mix(P.sand[1], soil.moist, 0.55), mix(P.sand[1], P.mud, 0.35), mix(P.sand[0], P.mud, 0.2)];
  sets[S.shallow] = [mix(P.sand[1], soil.moist, 0.35), mix(P.sand[1], P.mud, 0.2), P.sand[1]];
  sets[S.mud] = [shade(P.mud, -0.2), P.mud, soil.wet, mix(P.mud, soil.moist, 0.5)];
  sets[S.farmyard] = [mix(soil.dry, P.gravel[3], 0.45), mix(soil.dry, P.sand[1], 0.45), mix(soil.clay, P.gravel[2], 0.5), mix(soil.dry, P.gravel[0], 0.3)];
  sets[S.forestFloor] = season === 'autumn'
    ? [shade(soil.moist, -0.15), mix(fol[2], soil.moist, 0.45), mix(fol[0], soil.dry, 0.35), mix(fol[3], soil.moist, 0.3)]
    : [mix(P.conifer[2], soil.moist, 0.35), mix(fol[2], soil.moist, 0.3), mix(P.roof.moss, fol[0], 0.4), mix(fol[3], soil.dry, 0.3)];
  const lut = new Float32Array(NSURF * LUTN * 3);
  for (let s = 0; s < NSURF; s++) lut.set(grad(sets[s]), s * LUTN * 3);
  const W = P.water;
  const water = grad([W.shallow, mix(W.shallow, W.mid, 0.5), W.mid, W.deep, shade(W.deep, -0.25)], false);
  const snowC = grad(P.snow);
  const moistC = rgb(shade(mix(gr[2], P.conifer[0], 0.25), -0.12));
  const dryC = rgb(season === 'winter' ? gr[3] : mix(meadowBase[3], P.sand[1], 0.35));
  const flowers = { spring: 1, summer: 0.75, autumn: 0.12, winter: 0 }[season];
  const flowerCols = (season === 'autumn' ? [P.flowers[0], P.flowers[3], P.flowers[2]] : P.flowers).map(rgb);
  const veg = new Float32Array(NSURF);
  veg[S.grass] = 1; veg[S.meadow] = 1; veg[S.forestFloor] = 0.4;
  const soilLike = new Float32Array(NSURF);
  for (const k of ['soil', 'ploughed', 'mud', 'farmyard', 'sand', 'gravel']) soilLike[S[k]] = 1;
  soilLike[S.rock] = 0.5; soilLike[S.forestFloor] = 0.6;
  return {
    sig: `${season}|${snow}|${wet}`, season, snow, wet, lut, water, snowC, moistC, dryC, flowers, flowerCols, veg, soilLike,
    foam: rgb(W.foam), sets,
  };
}

// ---------------------------------------------------------------- the ground shader
/**
 * Shade rows [r0,r1) of an RGBA buffer (pw wide). Pixel (i,j) centre is at world
 * (ox + (i+0.5)/ppm, oy + (j+0.5)/ppm).
 */
export function shadeRows(T, look, NZ, data, pw, ox, oy, ppm, r0, r1, specks) {
  const W = T.w, H = T.h, height = T.height, wlA = T.waterLevel, shA = T.shade, moA = T.moisture, surf = T.surface, aux = T.aux;
  const lut = look.lut, wlut = look.water, snowC = look.snowC, veg = look.veg, soilLike = look.soilLike;
  const moist = look.moistC, dry = look.dryC, foam = look.foam;
  const snow = look.snow, wet = look.wet;
  const nWarp = NZ.warp, nV = NZ.v, nMid = NZ.mid, nStreak = NZ.streak, nCrack = NZ.crack;
  const inv = 1 / ppm;
  const warpAmp = Math.min(0.8, 0.35 + 2.4 / ppm);
  const flowerD = look.flowers * (specks ? 1 : 0);
  const fc = look.flowerCols, nfc = fc.length;
  const LS = LUTN * 3;
  const wA = [0, 0, 0, 0], cA = [0, 0, 0, 0];
  // low-frequency noise on a coarse lattice (0.5 m), bilinear per pixel → ~4x cheaper shading
  const gs = Math.max(inv, 0.5), ginv = 1 / gs;
  const gx0 = ox, gy0 = oy + (r0 + 0.5) * inv - gs;
  const gw = Math.ceil((pw * inv) / gs) + 3, gh = Math.ceil(((r1 - r0) * inv) / gs) + 3;
  const gn = gw * gh;
  const GW1 = new Float32Array(gn), GW2 = new Float32Array(gn), GV = new Float32Array(gn), GM = new Float32Array(gn), GS = new Float32Array(gn);
  for (let gj = 0; gj < gh; gj++) {
    const yy = gy0 + gj * gs;
    for (let gi = 0; gi < gw; gi++) {
      const xx = gx0 + gi * gs, k = gj * gw + gi;
      GW1[k] = nWarp.at(xx * 0.33, yy * 0.33); GW2[k] = nWarp.at(xx * 0.33 + 31.7, yy * 0.33 - 12.3);
      GV[k] = nV.fbm(xx * 0.085, yy * 0.085, 2); GM[k] = nMid.at(xx * 0.6, yy * 0.6);
      GS[k] = snow > 0 ? nWarp.at(xx * 0.21 + 50, yy * 0.21) : 0;
    }
  }
  for (let j = r0; j < r1; j++) {
    const wy = oy + (j + 0.5) * inv;
    const gfy = (wy - gy0) * ginv, gyI = gfy | 0, gty = gfy - gyI;
    const fy = clamp(wy, 0, H - 1.001);
    const iy = fy | 0, ty = fy - iy;
    const gyi = Math.floor(wy * ppm);
    let p = j * pw * 4;
    for (let i = 0; i < pw; i++, p += 4) {
      const wx = ox + (i + 0.5) * inv;
      const fx = clamp(wx, 0, W - 1.001);
      const ix = fx | 0, tx = fx - ix;
      const o = iy * W + ix;
      const a00 = (1 - tx) * (1 - ty), a10 = tx * (1 - ty), a01 = (1 - tx) * ty, a11 = tx * ty;
      const h = height[o] * a00 + height[o + 1] * a10 + height[o + W] * a01 + height[o + W + 1] * a11;
      const wl = wlA[o] * a00 + wlA[o + 1] * a10 + wlA[o + W] * a01 + wlA[o + W + 1] * a11;
      const sh = shA[o] * a00 + shA[o + 1] * a10 + shA[o + W] * a01 + shA[o + W + 1] * a11;
      const mo = moA[o] * a00 + moA[o + 1] * a10 + moA[o + W] * a01 + moA[o + W + 1] * a11;
      const gxi = Math.floor(wx * ppm);
      const hr = hash2(gxi, gyi, 7331);
      // warped, jittered surface lookup → soft organic boundaries
      const gfx = (wx - gx0) * ginv, gxI = gfx | 0, gtx = gfx - gxI, gk = gyI * gw + gxI;
      const b00 = (1 - gtx) * (1 - gty), b10 = gtx * (1 - gty), b01 = (1 - gtx) * gty, b11 = gtx * gty;
      const wn1 = GW1[gk] * b00 + GW1[gk + 1] * b10 + GW1[gk + gw] * b01 + GW1[gk + gw + 1] * b11;
      const wn2 = GW2[gk] * b00 + GW2[gk + 1] * b10 + GW2[gk + gw] * b01 + GW2[gk + gw + 1] * b11;
      const sx = clamp(wx + wn1 * warpAmp + (hr - 0.5) * 0.3, 0, W - 1.001);
      const sy = clamp(wy + wn2 * warpAmp + (hash2(gyi, gxi, 911) - 0.5) * 0.3, 0, H - 1.001);
      const jx = sx | 0, jy = sy | 0;
      let ux = sx - jx, uy = sy - jy;
      ux = clamp((ux - 0.5) * 2.2 + 0.5, 0, 1); uy = clamp((uy - 0.5) * 2.2 + 0.5, 0, 1);
      const q = jy * W + jx;
      cA[0] = surf[q]; cA[1] = surf[q + 1]; cA[2] = surf[q + W]; cA[3] = surf[q + W + 1];
      wA[0] = (1 - ux) * (1 - uy); wA[1] = ux * (1 - uy); wA[2] = (1 - ux) * uy; wA[3] = ux * uy;
      // painterly value field: broad patches + mottling, softly posterised
      let v = 0.5 + 0.5 * (GV[gk] * b00 + GV[gk + 1] * b10 + GV[gk + gw] * b01 + GV[gk + gw + 1] * b11);
      const mid = GM[gk] * b00 + GM[gk + 1] * b10 + GM[gk + gw] * b01 + GM[gk + gw + 1] * b11;
      v += mid * 0.17;
      const qv = v * 5, fl = Math.floor(qv);
      let fr = qv - fl; fr = clamp((fr - 0.5) * 2.6 + 0.5, 0, 1);
      v = (fl + fr) / 5;
      const vi = clamp(v * 63, 0, 63) | 0;
      let r = 0, g = 0, b = 0, vg = 0, sl = 0, dom = cA[0], dw = 0;
      for (let k = 0; k < 4; k++) {
        const wk = wA[k];
        if (wk <= 0) continue;
        const c = cA[k], base = c * LS + vi * 3;
        r += lut[base] * wk; g += lut[base + 1] * wk; b += lut[base + 2] * wk;
        vg += veg[c] * wk; sl += soilLike[c] * wk;
        if (wk > dw) { dw = wk; dom = c; }
      }
      // moisture / dryness tint for vegetation
      if (vg > 0) {
        const km = clamp((mo - 0.45) * 0.7, 0, 0.35) * vg, kd = clamp((0.38 - mo) * 0.6 + sh * 0.5, 0, 0.22) * vg;
        r += (moist[0] - r) * km + (dry[0] - r) * kd; g += (moist[1] - g) * km + (dry[1] - g) * kd; b += (moist[2] - b) * km + (dry[2] - b) * kd;
      }
      // surface-specific texture
      let m = 1;
      if (dom === S.ploughed) {
        const a = aux[q] * (Math.PI / 255);
        const pr = wx * Math.cos(a) + wy * Math.sin(a) + mid * 0.08;
        const st = Math.sin(pr * 7.85);
        m = 0.8 + 0.24 * (0.5 + 0.5 * st) + (hr - 0.5) * 0.1;
      } else if (dom === S.soil || dom === S.farmyard) {
        m = 1 + nStreak.at(wx * 2.6, wy * 2.6) * 0.07 + (hr - 0.5) * 0.08;
      } else if (dom === S.gravel) {
        const pb = hash2(Math.floor(wx * 9), Math.floor(wy * 9), 51);
        m = 0.82 + 0.34 * pb;
      } else if (dom === S.rock) {
        const cr = Math.abs(nCrack.at(wx * 0.8, wy * 0.8)) + Math.abs(nCrack.at(wx * 2.1 + 9, wy * 2.1)) * 0.35;
        m = cr < 0.05 ? 0.7 : cr < 0.09 ? 0.86 : 1.02 + mid * 0.05;
      } else if (dom === S.sand) {
        m = 1 + Math.sin((wx * 0.4 + wy + mid * 0.6) * 5.2) * 0.025 + (hr - 0.5) * 0.06;
      } else if (dom === S.mud) {
        m = 0.95 + nStreak.at(wx * 1.4, wy * 1.4) * 0.1;
      } else {
        // brush-stroke streaks for vegetation
        m = 1 + nStreak.at(wx * 1.9, wy * 0.55) * 0.055;
      }
      // relief + grain + wetness
      let lm = m * (1 + sh) * (1 + (hr - 0.5) * 0.07);
      if (wet > 0) lm *= 1 - wet * (0.08 + 0.22 * sl);
      r *= lm; g *= lm; b *= lm;
      // flower specks (mid-zoom levels) in meadows / lawns
      if (flowerD > 0 && vg > 0.6) {
        const fxi = Math.floor(wx * 4.2), fyi = Math.floor(wy * 4.2);
        const fh = hash2(fxi, fyi, 1234);
        const dens = flowerD * (dom === S.meadow ? 0.035 : 0.004) * Math.max(0, mid + 0.2) * 1.6;
        if (fh < dens) {
          const col = fc[Math.floor(hash2(fxi, fyi, 77) * nfc)];
          r = col[0]; g = col[1]; b = col[2];
        }
      }
      // wet band just above the waterline, then the water body itself
      const depth = wl - h;
      if (wl > NO_WATER + 1) {
        if (depth <= 0) {
          if (depth > -0.3) { const k = 1 - 0.2 * (1 - (-depth) / 0.3); r *= k; g *= k; b *= k * 1.03; }
        } else {
          const di = clamp(depth / 2.4 * 63, 0, 63) | 0;
          const st = nStreak.at(wx * 0.9, wy * 0.22) * 0.05 + mid * 0.03;
          let wr = wlut[di * 3] * (1 + st), wg = wlut[di * 3 + 1] * (1 + st), wb = wlut[di * 3 + 2] * (1 + st);
          const wm = 1 + sh * 0.25;
          wr *= wm; wg *= wm; wb *= wm;
          const alpha = smooth(0, 0.45, depth) * 0.82 + 0.18;
          r += (wr - r) * alpha; g += (wg - g) * alpha; b += (wb - b) * alpha;
          const fa = (1 - smooth(0.015, 0.1, depth)) * smooth(0.05, 0.45, mid + (hr - 0.5) * 0.25 + wn1 * 0.35);
          if (fa > 0) { r += (foam[0] - r) * fa * 0.6; g += (foam[1] - g) * fa * 0.6; b += (foam[2] - b) * fa * 0.6; }
        }
      }
      // snow cover
      if (snow > 0 && depth <= 0.02) {
        const n = 0.5 + 0.5 * (GS[gk] * b00 + GS[gk + 1] * b10 + GS[gk + gw] * b01 + GS[gk + gw + 1] * b11) + mid * 0.18 - sh * 1.2;
        const th = 1.05 - snow * 1.1;
        const sm = smooth(th - 0.07, th + 0.07, n);
        if (sm > 0) {
          const si = clamp((0.55 + mid * 0.4 + sh * 1.5) * 63, 0, 63) | 0;
          const k = sm * 0.96;
          r += (snowC[si * 3] * (1 + sh * 0.5) - r) * k; g += (snowC[si * 3 + 1] * (1 + sh * 0.5) - g) * k; b += (snowC[si * 3 + 2] * (1 + sh * 0.3) - b) * k;
        }
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
}

export function snowMaskAt(look, NZ, wx, wy, sh) {
  if (!(look.snow > 0)) return 0;
  const mid = NZ.mid.at(wx * 0.6, wy * 0.6);
  const n = 0.5 + 0.5 * NZ.warp.at(wx * 0.21 + 50, wy * 0.21) + mid * 0.18 - sh * 1.2;
  const th = 1.05 - look.snow * 1.1;
  return smooth(th - 0.07, th + 0.07, n);
}

// ---------------------------------------------------------------- decal sprites (painted once, 32 px/m)
export function makeDecals(art, P) {
  const PPM = art.PPM;
  const { mix, shade, outline, rgba } = art;
  const sp = (key, m, paint) => art.sprite('terrain:' + key, Math.ceil(m * PPM), Math.ceil(m * PPM), paint);
  const lumS = (c) => { const r = art.hexToRgb(c); return r[0] * 0.3 + r[1] * 0.55 + r[2] * 0.15; };
  const sorted = (cols) => cols.slice().sort((a, b) => lumS(a) - lumS(b));

  function blade(g, cx, cy, ang, len, bend, lw, col) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ex = cx + ca * len, ey = cy + sa * len;
    const mx = cx + ca * len * 0.55 - sa * bend, my = cy + sa * len * 0.55 + ca * bend;
    g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
  }
  function ao(g, cx, cy, r, a) {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(24,30,26,${a})`); gr.addColorStop(1, 'rgba(24,30,26,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  const D = {
    tuft(season, v, tall) {
      return sp(`tuft:${season}:${tall ? 't' : 's'}:${v}`, tall ? 1.15 : 0.8, (g, w, h, rng) => {
        const cols = sorted(P.grass[season]);
        const cx = w / 2, cy = h / 2;
        ao(g, cx, cy, w * 0.26, 0.22);
        const n = tall ? 16 : 11;
        const L = w * 0.45;
        const dark = shade(cols[0], -0.25);
        for (let k = 0; k < n; k++) {
          const ang = rng.float() * Math.PI * 2, len = L * rng.range(0.55, 1);
          blade(g, cx + rng.range(-1, 1), cy + rng.range(-1, 1), ang, len, rng.range(-3, 3), rng.range(1.2, 2.1), mix(dark, cols[rng.int(0, 1)], rng.float()));
        }
        for (let k = 0; k < n * 0.7; k++) {
          const ang = rng.float() * Math.PI * 2, len = L * rng.range(0.35, 0.8);
          blade(g, cx, cy, ang, len, rng.range(-2.5, 2.5), rng.range(0.9, 1.6), cols[rng.int(2, 3)]);
        }
        if (tall && season !== 'winter') {
          const seedC = season === 'spring' ? mix(cols[3], P.flowers[2], 0.3) : mix(P.sand[0], cols[3], 0.3);
          for (let k = 0; k < 3; k++) {
            const ang = rng.float() * Math.PI * 2, len = L * rng.range(0.8, 1);
            g.fillStyle = seedC; g.globalAlpha = 0.85;
            g.beginPath(); g.ellipse(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, 2.4, 1.2, ang, 0, Math.PI * 2); g.fill();
            g.globalAlpha = 1;
          }
        }
      });
    },
    flower(ci, v) {
      return sp(`flower:${ci}:${v}`, 0.32, (g, w, h, rng) => {
        const col = P.flowers[ci % P.flowers.length];
        const cx = w / 2, cy = h / 2;
        const stemC = shade(P.grass.summer[2], -0.1);
        for (let k = 0; k < 3; k++) blade(g, cx, cy, rng.float() * 6.28, w * 0.4, rng.range(-1, 1), 1, stemC);
        const petals = rng.int(5, 6), pr = w * rng.range(0.12, 0.16), pd = w * 0.14;
        const ph = rng.float() * 6.28;
        g.fillStyle = col; g.strokeStyle = rgba(outline(col), 0.5); g.lineWidth = 0.7;
        for (let k = 0; k < petals; k++) {
          const a = ph + (k / petals) * 6.28;
          g.beginPath(); g.ellipse(cx + Math.cos(a) * pd, cy + Math.sin(a) * pd, pr, pr * 0.7, a, 0, 6.28); g.fill(); g.stroke();
        }
        g.fillStyle = ci === 0 ? shade(P.flowers[5], -0.1) : P.flowers[0];
        g.beginPath(); g.arc(cx, cy, w * 0.08, 0, 6.28); g.fill();
      });
    },
    clover(season, v) {
      return sp(`clover:${season}:${v}`, 0.5, (g, w, h, rng) => {
        const base = mix(P.grass[season][2], P.conifer[3], 0.25);
        const cx = w / 2, cy = h / 2;
        ao(g, cx, cy, w * 0.35, 0.12);
        const n = rng.int(4, 7);
        for (let k = 0; k < n; k++) {
          const px = cx + rng.range(-w * 0.28, w * 0.28), py = cy + rng.range(-h * 0.28, h * 0.28);
          const ph = rng.float() * 6.28, lr = rng.range(1.6, 2.3);
          const col = mix(base, P.grass[season][3], rng.float() * 0.5);
          for (let l = 0; l < 3; l++) {
            const a = ph + l * 2.094;
            g.fillStyle = col; g.beginPath(); g.arc(px + Math.cos(a) * lr, py + Math.sin(a) * lr, lr, 0, 6.28); g.fill();
            g.strokeStyle = rgba(outline(col), 0.35); g.lineWidth = 0.5; g.stroke();
          }
        }
        if (rng.chance(0.4) && season !== 'winter') {
          g.fillStyle = mix(P.flowers[2], P.flowers[4], 0.3);
          g.beginPath(); g.arc(cx + rng.range(-4, 4), cy + rng.range(-4, 4), 2.6, 0, 6.28); g.fill();
        }
      });
    },
    pebble(set, v) {
      return sp(`pebble:${set}:${v}`, 0.3, (g, w, h, rng) => {
        const cols = set === 'soil' ? [P.soil.dry, P.soil.clay, P.soil.moist] : set === 'sand' ? [P.gravel[2], P.sand[1], P.rock[3]] : P.gravel;
        const col = rng.pick(cols);
        const cx = w / 2, cy = h / 2, rx = rng.range(w * 0.2, w * 0.36), ry = rx * rng.range(0.6, 0.95), rot = rng.float() * 3.14;
        g.save(); g.translate(cx, cy); g.rotate(rot);
        ao(g, 0, 0, rx * 1.35, 0.25);
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.28);
        g.fillStyle = col; g.fill();
        const gr = g.createRadialGradient(0, -ry * 0.1, 0, 0, 0, rx);
        gr.addColorStop(0, 'rgba(255,250,235,0.3)'); gr.addColorStop(1, 'rgba(255,250,235,0)');
        g.fillStyle = gr; g.fill();
        g.strokeStyle = rgba(outline(col), 0.55); g.lineWidth = 0.8; g.stroke();
        g.restore();
      });
    },
    clod(v) {
      return sp(`clod:${v}`, 0.34, (g, w, h, rng) => {
        const col = mix(P.soil.ploughed, P.soil.dry, rng.float() * 0.5);
        ao(g, w / 2, h / 2, w * 0.45, 0.3);
        art.blobPath(g, w / 2, h / 2, w * rng.range(0.2, 0.3), rng, 0.25, 5);
        g.fillStyle = col; g.fill();
        g.strokeStyle = rgba(outline(col), 0.5); g.lineWidth = 0.8; g.stroke();
        g.fillStyle = rgba(shade(col, 0.25), 0.5);
        g.beginPath(); g.arc(w / 2, h / 2 - 1, w * 0.1, 0, 6.28); g.fill();
      });
    },
    leaf(season, v) {
      return sp(`leaf:${season}:${v}`, 0.3, (g, w, h, rng) => {
        const pool = season === 'autumn' ? P.foliage.autumn : [mix(P.foliage.autumn[3], P.bark[1], 0.4), mix(P.foliage.winter[0], P.foliage.autumn[3], 0.3), P.foliage.winter[1]];
        const col = rng.pick(pool);
        const cx = w / 2, cy = h / 2, L = w * rng.range(0.3, 0.42), rot = rng.float() * 6.28;
        g.save(); g.translate(cx, cy); g.rotate(rot);
        g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -L * 0.6, L, 0); g.quadraticCurveTo(0, L * 0.6, -L, 0);
        g.fillStyle = col; g.fill();
        g.strokeStyle = rgba(outline(col), 0.6); g.lineWidth = 0.7; g.stroke();
        g.beginPath(); g.moveTo(-L * 0.9, 0); g.lineTo(L * 0.8, 0); g.strokeStyle = rgba(shade(col, -0.35), 0.6); g.stroke();
        g.restore();
      });
    },
    twig(v) {
      return sp(`twig:${v}`, 0.7, (g, w, h, rng) => {
        const col = P.bark[rng.int(0, 2)];
        const a = rng.float() * 6.28, L = w * 0.4;
        const cx = w / 2, cy = h / 2;
        g.lineCap = 'round';
        blade(g, cx - Math.cos(a) * L, cy - Math.sin(a) * L, a, L * 2, rng.range(-3, 3), 2, col);
        blade(g, cx, cy, a + rng.range(0.5, 1), L * 0.6, 1, 1.3, col);
      });
    },
    moss(season, v) {
      return sp(`moss:${season}:${v}`, 0.6, (g, w, h, rng) => {
        const cols = [P.roof.moss, mix(P.roof.moss, P.foliage[season][3], 0.4), shade(P.roof.moss, -0.2)];
        g.save(); art.blobPath(g, w / 2, h / 2, w * 0.3, rng, 0.3, 6); g.clip();
        art.dabs(g, rng, 60, 0, 0, w, h, cols, 1, 2.6, 0.8);
        g.restore();
      });
    },
    lichen(v) {
      return sp(`lichen:${v}`, 0.4, (g, w, h, rng) => {
        const col = rng.chance(0.5) ? mix(P.meadow[3], P.flowers[0], 0.35) : mix(P.rock[3], P.meadow[1], 0.4);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = rgba(col, rng.range(0.5, 0.85));
          g.beginPath(); g.arc(w / 2 + rng.range(-4, 4), h / 2 + rng.range(-4, 4), rng.range(1, 2.8), 0, 6.28); g.fill();
        }
      });
    },
    straw(v) {
      return sp(`straw:${v}`, 0.5, (g, w, h, rng) => {
        for (let k = 0; k < 5; k++) {
          const a = rng.float() * 6.28;
          blade(g, w / 2 + rng.range(-4, 4), h / 2 + rng.range(-4, 4), a, rng.range(4, 8), rng.range(-1, 1), 0.9, rng.pick(P.roof.thatch));
        }
      });
    },
    reed(season, v) {
      return sp(`reed:${season}:${v}`, 1.7, (g, w, h, rng) => {
        const base = season === 'winter' ? [P.roof.thatch[2], P.roof.thatch[0], mix(P.water.reed, P.roof.thatch[1], 0.6)]
          : season === 'autumn' ? [mix(P.water.reed, P.roof.thatch[0], 0.45), P.water.reed, mix(P.water.reed, P.foliage.autumn[3], 0.3)]
            : [shade(P.water.reed, -0.2), P.water.reed, mix(P.water.reed, P.foliage[season][1], 0.5)];
        const cx = w / 2, cy = h / 2;
        ao(g, cx, cy, w * 0.22, 0.3);
        const n = 22;
        for (let k = 0; k < n; k++) {
          const a = rng.float() * 6.28, L = w * rng.range(0.22, 0.48);
          blade(g, cx + rng.range(-2, 2), cy + rng.range(-2, 2), a, L, rng.range(-5, 5), rng.range(1.3, 2.2), base[rng.int(0, 2)]);
        }
        for (let k = 0; k < 10; k++) {
          const a = rng.float() * 6.28, L = w * rng.range(0.12, 0.3);
          blade(g, cx, cy, a, L, rng.range(-3, 3), 1.2, shade(base[2], 0.15));
        }
        const heads = rng.int(1, 3);
        for (let k = 0; k < heads; k++) {
          const a = rng.float() * 6.28, d = rng.range(2, w * 0.18);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          g.fillStyle = P.bark[0]; g.strokeStyle = outline(P.bark[0]); g.lineWidth = 0.8;
          g.beginPath(); g.ellipse(x, y, 4.2, 2.1, a, 0, 6.28); g.fill(); g.stroke();
          g.fillStyle = rgba(shade(P.bark[1], 0.3), 0.6);
          g.beginPath(); g.ellipse(x - 0.5, y - 0.5, 2.4, 0.9, a, 0, 6.28); g.fill();
        }
      });
    },
    lily(v, flower) {
      return sp(`lily:${v}:${flower ? 1 : 0}`, 0.8, (g, w, h, rng) => {
        const cx = w / 2, cy = h / 2, r = w * rng.range(0.3, 0.4);
        const col = mix(P.foliage.summer[rng.int(0, 1)], P.water.reed, 0.25);
        const notch = rng.float() * 6.28;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, notch + 0.28, notch + 6.0); g.closePath();
        g.fillStyle = col; g.fill();
        g.strokeStyle = outline(col); g.lineWidth = 1; g.stroke();
        g.strokeStyle = rgba(shade(col, 0.3), 0.45); g.lineWidth = 0.6;
        for (let k = 0; k < 7; k++) {
          const a = notch + 0.6 + k * 0.8;
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); g.stroke();
        }
        g.fillStyle = rgba(shade(col, 0.35), 0.25);
        g.beginPath(); g.arc(cx, cy, r * 0.5, 0, 6.28); g.fill();
        if (flower) {
          const fc = rng.chance(0.6) ? P.flowers[2] : P.flowers[4];
          for (let k = 0; k < 8; k++) {
            const a = k * 0.785 + rng.float() * 0.2;
            g.fillStyle = k % 2 ? fc : shade(fc, -0.08);
            g.beginPath(); g.ellipse(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, 3.6, 1.6, a, 0, 6.28); g.fill();
          }
          g.fillStyle = P.flowers[0]; g.beginPath(); g.arc(cx, cy, 1.8, 0, 6.28); g.fill();
        }
      });
    },
  };
  return D;
}
