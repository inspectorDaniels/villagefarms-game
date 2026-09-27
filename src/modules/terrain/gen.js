// Terrain generation: heightmap, river, lakes, moisture, surface classification.
// Pure data (typed arrays); no drawing here. Deterministic from ctx.rng / ctx.noise streams.

export const SURFACES = ['grass', 'meadow', 'soil', 'ploughed', 'sand', 'gravel', 'rock', 'water', 'shallow', 'mud', 'farmyard', 'forestFloor'];
export const S = {};
SURFACES.forEach((n, i) => { S[n] = i; });

export const NO_WATER = -1000;
// flags
export const F_REED = 1, F_LILY = 2, F_LAKE = 4, F_RIVER = 8;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** stamp exact distance to a polyline (with arclength) into dist/sArr within radius R */
function stampPolyline(W, H, pts, cum, R, dist, sArr) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9, L = Math.sqrt(L2);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + R));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - R)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let t = ((x - ax) * dx + (y - ay) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - x, py = ay + dy * t - y;
        const d = px * px + py * py;
        const o = y * W + x;
        if (d < dist[o]) { dist[o] = d; sArr[o] = cum[i] + t * L; }
      }
    }
  }
}

/**
 * Generate terrain data.
 * @returns T {w,h,height,surface,moisture,waterLevel,shade,flags,aux,rivers,riverInfo,lakes,reeds}
 */
export function generateData(ctx, opts = {}) {
  const W = Math.max(64, (opts.w | 0) || 1024), H = Math.max(64, (opts.h | 0) || 1024);
  const N = W * H;
  const rng = ctx.rng('gen');
  const nHills = ctx.noise('hills'), nDet = ctx.noise('detail'), nMask = ctx.noise('mask');
  const nRiv = ctx.noise('river'), nRock = ctx.noise('rock'), nMisc = ctx.noise('misc');

  const height = new Float32Array(N);
  const surface = new Uint8Array(N);
  const moisture = new Float32Array(N);
  const waterLevel = new Float32Array(N).fill(NO_WATER);
  const flags = new Uint8Array(N);
  const aux = new Uint8Array(N); // furrow angle (0..255 → 0..π) for ploughed cells

  // ---------------- river centreline ----------------
  const rivers = [], riverInfo = [];
  const dRiv = new Float32Array(N).fill(1e12); // squared near-field distance
  const sRiv = new Float32Array(N);
  let rPts = null, rCum = null, rLen = 1;
  const RIVER_TOP = 9, RIVER_DROP = 5;
  if (opts.river !== false) {
    const raw = [];
    let x = W * (0.36 + rng.float() * 0.22), y = -24, s = 0, heading = Math.PI / 2;
    const ph = rng.float() * 50;
    while (y < H + 24 && raw.length < 3000) {
      raw.push([x, y]);
      const m = nRiv.at(ph + s / 190, 0.37) * 2.3 + nRiv.at(ph * 1.7 + s / 70, 4.1) * 0.6;
      const cx = (x - W / 2) / (W / 2);
      let target = Math.PI / 2 + m - cx * Math.abs(cx) * 1.6;
      target = clamp(target, Math.PI / 2 - 1.35, Math.PI / 2 + 1.35);
      heading += (target - heading) * 0.22;
      x += Math.cos(heading) * 4; y += Math.sin(heading) * 4; s += 4;
    }
    rPts = chaikin(raw, 1);
    rCum = [0];
    for (let i = 1; i < rPts.length; i++) rCum.push(rCum[i - 1] + Math.hypot(rPts[i][0] - rPts[i - 1][0], rPts[i][1] - rPts[i - 1][1]));
    rLen = rCum[rCum.length - 1];
    stampPolyline(W, H, rPts, rCum, 30, dRiv, sRiv);
  }
  const halfWidthAt = (s) => 6 + 3 * nRiv.at(s / 130, 9.5);
  const depthAt = (s) => 1.7 + 0.6 * nRiv.at(s / 120, 13.1);
  // water level falls with y (the river always flows south) → smooth everywhere, no medial-axis creases
  const levelAtY = (y) => RIVER_TOP - RIVER_DROP * clamp(y / H, 0, 1);
  const floodAt = (x, y) => 60 + 38 * nRiv.fbm(x / 230 + 11, y / 230 - 4, 2);
  const bankAt = (s) => 3 + 7 * Math.max(0, nRiv.at(s / 60, 31.3) + 0.1);

  // far field distance on a 4 m grid (coarse polyline)
  const CS = 4, CW = Math.ceil(W / CS) + 1, CH = Math.ceil(H / CS) + 1;
  const dFar = new Float32Array(CW * CH).fill(1e6), sFar = new Float32Array(CW * CH);
  if (rPts) {
    const cp = [], cc = [];
    for (let i = 0; i < rPts.length; i += 4) { cp.push(rPts[i]); cc.push(rCum[i]); }
    cp.push(rPts[rPts.length - 1]); cc.push(rLen);
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      const X = i * CS, Y = j * CS;
      let best = 1e12, bs = 0;
      for (let k = 0; k < cp.length - 1; k++) {
        const [ax, ay] = cp[k], [bx, by] = cp[k + 1];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
        let t = ((X - ax) * dx + (Y - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - X, py = ay + dy * t - Y, d = px * px + py * py;
        if (d < best) { best = d; bs = cc[k] + t * (cc[k + 1] - cc[k]); }
      }
      dFar[j * CW + i] = Math.sqrt(best); sFar[j * CW + i] = bs;
    }
  }
  // coarse low-frequency fields (hills, masks)
  const hillsC = new Float32Array(CW * CH), forestC = new Float32Array(CW * CH), meadowC = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    const X = i * CS, Y = j * CS, o = j * CW + i;
    hillsC[o] = nHills.fbm(X / 430, Y / 430, 4);
    forestC[o] = nMask.fbm(X / 190 + 40, Y / 190 - 17, 3);
    meadowC[o] = nMask.fbm(X / 120 - 60, Y / 120 + 33, 3);
  }
  const bl = (arr, x, y) => {
    const fx = x / CS, fy = y / CS;
    const i = Math.min(CW - 2, Math.floor(fx)), j = Math.min(CH - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j, o = j * CW + i;
    return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + CW] * (1 - tx) + arr[o + CW + 1] * tx) * ty;
  };

  // ---------------- heights ----------------
  const riverD = new Float32Array(N); // distance to river centreline (m)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      let d, s;
      if (rPts) {
        if (dRiv[o] < 900) { d = Math.sqrt(dRiv[o]); s = sRiv[o]; } else { d = bl(dFar, x, y); s = bl(sFar, x, y); }
      } else { d = 1e6; s = 0; }
      riverD[o] = d;
      // wobble the channel so banks are not parallel to the centreline (no "canal" look)
      if (d < 40) d += 1.9 * nRiv.at(x / 13 + 3.3, y / 13 - 8.1) + 0.45 * nRiv.at(x / 6, y / 6 + 20);
      const hills = 0.5 + 0.5 * bl(hillsC, x, y);
      const detail = nDet.fbm(x / 95, y / 95, 3);
      const above = 3 + 24 * Math.pow(hills, 1.25) + 7 * (1 - y / H) + 3.2 * detail;
      const rl = rPts ? levelAtY(y) : 4;
      const hw = rPts ? halfWidthAt(s) : 0;
      const bw = rPts ? Math.min(bankAt(s), 15.5 - hw) : 0;
      const und = 0.35 * nDet.at(x / 26 + 7.7, y / 26 - 3.1);
      const floor = rl + 0.8 + und;
      const t = rPts ? smooth(16, 16 + floodAt(x, y), d) : 1;
      let h = floor + t * Math.max(0.2, above);
      if (rPts && d < hw + bw) {
        const dep = depthAt(s);
        if (d < hw) { const u = d / hw; h = rl - 0.22 - dep * (1 - u * u); }
        else { const k = (d - hw) / bw; h = lerp(rl - 0.22, floor, k < 0.5 ? 0.9 * k : 0.45 + 1.1 * (k - 0.5)); }
        waterLevel[o] = rl;
      } else if (rPts && d < hw + bw + 6) waterLevel[o] = rl;
      height[o] = h;
    }
  }

  // ---------------- rock outcrops ----------------
  const rockW = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x;
    const d = riverD[o];
    if (d < 70) continue;
    const hi = smooth(14, 30, height[o]);
    const v = nRock.fbm(x / 48, y / 48, 3) + 0.28 * hi + 0.12 * nRock.ridged(x / 14, y / 14, 2);
    const w = smooth(0.66, 0.74, v);
    if (w > 0) {
      const bump = w * (1.1 + 0.9 * nMisc.at(x / 5.5, y / 5.5) + 0.5 * nRock.ridged(x / 4, y / 4, 2));
      height[o] += bump;
      rockW[o] = w;
    }
  }

  // ---------------- flat areas ----------------
  const flats = Array.isArray(opts.flatAreas) ? opts.flatAreas : [];
  for (const f of flats) flattenCircle(W, H, height, f.x, f.y, f.r, f.height);

  // ---------------- lakes ----------------
  const lakes = [];
  const lakeCount = opts.lakes == null ? 1 : opts.lakes | 0;
  for (let li = 0; li < lakeCount; li++) {
    // pick a gentle site 80–150 m from the river
    let best = null;
    for (let k = 0; k < 220; k++) {
      const cx = 140 + rng.float() * (W - 280), cy = 140 + rng.float() * (H - 280);
      const o = (cy | 0) * W + (cx | 0);
      const d = riverD[o];
      if (rPts && (d < 72 || d > 118)) continue;
      if (lakes.some((l) => Math.hypot(l.x - cx, l.y - cy) < l.r + 120)) continue;
      let hmin = 1e9, hmax = -1e9;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        for (const rr of [20, 45]) {
          const sx = clamp(Math.round(cx + Math.cos(ang) * rr), 0, W - 1), sy = clamp(Math.round(cy + Math.sin(ang) * rr), 0, H - 1);
          const hh = height[sy * W + sx]; hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh);
        }
      }
      const score = (hmax - hmin) + (rockW[o] > 0 ? 50 : 0) + Math.abs(cy - H * 0.5) * 0.004;
      if (!best || score < best.score) best = { x: cx, y: cy, score, hmin };
    }
    if (!best) continue;
    const R = 26 + rng.float() * 12;
    const ph = rng.float() * 10;
    const radAt = (ang) => R * (1 + 0.22 * nMisc.at(Math.cos(ang) * 1.3 + ph, Math.sin(ang) * 1.3) + 0.08 * nMisc.at(Math.cos(ang) * 3 + ph, Math.sin(ang) * 3 + 5));
    const ring = 26;
    const x0 = Math.max(0, Math.floor(best.x - R * 1.6 - ring)), x1 = Math.min(W - 1, Math.ceil(best.x + R * 1.6 + ring));
    const y0 = Math.max(0, Math.floor(best.y - R * 1.6 - ring)), y1 = Math.min(H - 1, Math.ceil(best.y + R * 1.6 + ring));
    // level below the lowest ground on the whole shore annulus → the basin always holds its water, no dams/creases
    let annMin = 1e9;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - best.x, dy = y - best.y, edge = Math.hypot(dx, dy) - radAt(Math.atan2(dy, dx));
      if (edge >= 0 && edge < ring) annMin = Math.min(annMin, height[y * W + x]);
    }
    const level = annMin - 0.7;
    const depth = 2.4 + rng.float() * 0.8;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const o = y * W + x;
      const dx = x - best.x, dy = y - best.y, dist = Math.hypot(dx, dy);
      const rr = radAt(Math.atan2(dy, dx));
      const q = dist / rr;
      const edge = dist - rr; // metres outside the shore
      if (q < 1) {
        height[o] = level - 0.25 - depth * Math.pow(1 - q * q, 0.8);
        waterLevel[o] = level; flags[o] |= F_LAKE;
      } else if (edge < ring) {
        const k = smooth(0, ring, edge);
        const shore = level - 0.25 + Math.min(1, edge / 3) * 0.75 + Math.max(0, edge - 3) * 0.04;
        height[o] = lerp(shore, height[o], k);
        if (edge < 8) { waterLevel[o] = level; flags[o] |= F_LAKE; }
      }
    }
    const poly = [];
    for (let a = 0; a < 48; a++) { const ang = (a / 48) * Math.PI * 2, rr = radAt(ang); poly.push([+(best.x + Math.cos(ang) * rr).toFixed(2), +(best.y + Math.sin(ang) * rr).toFixed(2)]); }
    lakes.push({ id: 'terrain:lake' + li, x: best.x, y: best.y, r: R, level, depth: depth + 0.25, poly });
  }

  // ---------------- river info ----------------
  if (rPts) {
    const out = [];
    const step = Math.max(1, Math.round(4 / (rLen / rPts.length)));
    for (let i = 0; i < rPts.length; i += step) {
      const s = rCum[i];
      out.push([+rPts[i][0].toFixed(2), +rPts[i][1].toFixed(2), +(halfWidthAt(s) * 2 + 0.8).toFixed(2)]);
    }
    rivers.push(out.map((p) => [p[0], p[1]]));
    riverInfo.push({ id: 'terrain:river0', points: out, pts: rPts, cum: rCum, length: rLen, levelTop: RIVER_TOP, levelBottom: RIVER_TOP - RIVER_DROP });
  }

  const T = { w: W, h: H, height, surface, moisture, waterLevel, flags, aux, rockW, riverD, shade: new Float32Array(N), painted: new Uint8Array(N), pedge: new Uint16Array(N), prev: new Uint8Array(N), ops: [], rivers, riverInfo, lakes, reeds: [] };
  Object.defineProperty(T, '_cls', { value: { nMask, nMisc, forestC, meadowC, bl }, enumerable: false });
  classify(T, ctx, 0, 0, W - 1, H - 1, nMask, nMisc, forestC, meadowC, bl);
  computeShade(T, 0, 0, W - 1, H - 1);
  T.uni = new Uint8Array(N);
  computeUniform(T, 0, 0, W - 1, H - 1);
  placeReeds(T, ctx);
  return T;
}

export function flattenCircle(W, H, height, cx, cy, r, target) {
  const R = r * 1.7;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  let tgt = target;
  if (tgt == null) {
    let sum = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Math.hypot(x - cx, y - cy) <= r) { sum += height[y * W + x]; n++; }
    tgt = n ? sum / n : height[Math.round(cy) * W + Math.round(cx)];
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const k = smooth(r, R, d);
    const o = y * W + x;
    height[o] = lerp(tgt, height[o], k);
  }
  return tgt;
}

/** classify natural surfaces for the rect (inclusive). Painted cells (aux bit / painted flag) are preserved by caller. */
function classify(T, ctx, x0, y0, x1, y1, nMask, nMisc, forestC, meadowC, bl) {
  const { w: W, height, waterLevel, surface, moisture, rockW, riverD, flags } = T;
  const hScale = 1 / 38;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const o = y * W + x;
    const h = height[o], wl = waterLevel[o];
    const depth = wl - h;
    // moisture
    const dWater = Math.max(0, riverD[o] - 7);
    let m = 0.62 * Math.exp(-dWater / 45) + 0.3 * (1 - clamp(h * hScale, 0, 1)) + 0.14 * nMisc.at(x / 40, y / 40);
    if (flags[o] & 4) m = Math.max(m, 0.8);
    moisture[o] = clamp(m, 0, 1);
    let code;
    if (depth > 0.55) code = S.water;
    else if (depth > 0) code = S.shallow;
    else if (wl > NO_WATER + 1 && -depth < 0.2 + 0.45 * (0.5 + 0.5 * nMisc.at(x / 34 + 3, y / 34 - 8))) {
      const k = nMisc.at(x / 13 - 11, y / 13 + 4);
      code = k > 0.42 ? S.gravel : k < -0.34 ? S.mud : S.sand;
    } else if (rockW[o] > 0.35) code = S.rock;
    else {
      const fm = bl(forestC, x, y) + 0.06 * nMisc.at(x / 22, y / 22);
      const mm = bl(meadowC, x, y) + 0.08 * nMisc.at(x / 20 + 50, y / 20) + (moisture[o] - 0.4) * 0.3;
      if (fm > 0.42 && riverD[o] > 50) code = S.forestFloor;
      else if (mm > 0.12) code = S.meadow;
      else code = S.grass;
    }
    surface[o] = code;
    // decorative flags
    flags[o] &= ~(1 | 2);
    if (depth > -0.1 && depth < 0.45) {
      const rv = nMask.at(x / 7.5 + 100, y / 7.5);
      if (rv > 0.08) flags[o] |= 1; // reeds
    }
    if ((flags[o] & 4) && depth > 0.35 && depth < 1.6) {
      const lv = nMask.at(x / 9 - 200, y / 9 + 40);
      if (lv > 0.2) flags[o] |= 2; // lily pads
    }
  }
}

export function reclassify(T, ctx, x0, y0, x1, y1) {
  // keeps painted cells (T.painted) untouched
  const { nMask, nMisc, forestC, meadowC, bl } = T._cls;
  const W = T.w;
  const saved = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = y * W + x; if (T.painted[o]) saved.push(o, T.surface[o]); }
  classify(T, ctx, x0, y0, x1, y1, nMask, nMisc, forestC, meadowC, bl);
  for (let i = 0; i < saved.length; i += 2) T.surface[saved[i]] = saved[i + 1];
}

/** non-directional relief shading from curvature + slope, in [-0.2, 0.16] */
export function computeShade(T, x0, y0, x1, y1) {
  const { w: W, h: H, height, shade } = T;
  const at = (x, y) => height[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const h = at(x, y);
    const c4 = (at(x - 4, y) + at(x + 4, y) + at(x, y - 4) + at(x, y + 4)) * 0.25 - h;
    const c12 = (at(x - 12, y) + at(x + 12, y) + at(x, y - 12) + at(x, y + 12)) * 0.25 - h;
    const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
    const slope = Math.sqrt(gx * gx + gy * gy) * 0.5;
    shade[y * W + x] = clamp(-c4 * 0.12 - c12 * 0.055 - slope * 0.3, -0.24, 0.18);
  }
}

function placeReeds(T, ctx) {
  const { w: W, h: H, flags } = T;
  const rng = ctx.rng('reeds');
  const reeds = [];
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
    const o = y * W + x;
    if (!(flags[o] & 1)) continue;
    if (!rng.chance(0.55)) continue;
    reeds.push({ x: x + rng.range(-0.8, 0.8), y: y + rng.range(-0.8, 0.8), r: rng.range(0.45, 0.8), h: rng.range(0.9, 1.6), v: rng.int(0, 5) });
  }
  T.reeds = reeds;
  // bucket per 64 m
  const B = 64, bw = Math.ceil(W / B);
  const buckets = new Map();
  for (const r of reeds) {
    const k = Math.floor(r.y / B) * bw + Math.floor(r.x / B);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  T.reedBuckets = { B, bw, map: buckets };
}

export function rebuildReeds(T, ctx) { placeReeds(T, ctx); }

/** uni[o] = 1 when the 4x4 node block (ix-1..ix+2, iy-1..iy+2) has one surface code → shader fast path */
export function computeUniform(T, x0, y0, x1, y1) {
  const { w: W, h: H, surface, uni } = T;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const c = surface[y * W + x];
    let u = 1;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 2) && u; yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 2); xx++) if (surface[yy * W + xx] !== c) { u = 0; break; }
    uni[y * W + x] = u;
  }
}
