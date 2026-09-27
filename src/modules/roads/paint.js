// Static road painting into chunk canvases: shoulders, pavements, bridge decks, carriageway
// textures, surface decals (patches, cracks, wear, ruts, puddles), kerbs, edge crumble,
// markings, give-way teeth, zebra crossings, snow. World coordinates (metres) throughout.
import { sampleAt, offsetPts, pathFrom, bboxOf, bboxHit, norm } from './geom.js';
import { CLASSES, cornerCurve, junctionPoly, outerHalf } from './network.js';
import { patternFor } from './textures.js';

// ---- tiny deterministic PRNG for per-feature scatter
function prng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hs(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ======================================================================
// Decal generation (once per network rebuild)
// ======================================================================
export function buildDecals(D, rngBase, noise) {
  const puddles = [];
  for (const ch of D.chains) {
    const rng = rngBase.fork(ch.key);
    const dec = [];
    const L = ch.L, hw = ch.hw;
    const at = (s, lat) => {
      const p = sampleAt(ch.pts, ch.cum, s);
      return [p.x - p.ty * lat, p.y + p.tx * lat, p.tx, p.ty];
    };
    const band = (lat, s0, s1, w, col, a, fine = false, pattern = null) => {
      const pts = [];
      for (let s = s0; s <= s1 + 0.01; s += 0.5) { const p = at(Math.min(s, s1), lat(s)); pts.push([p[0], p[1]]); }
      if (pts.length < 2) return;
      dec.push({ k: 'band', pts, w, col, a, fine, pattern, bbox: bboxOf(pts, w) });
    };
    const asphalt = ch.cls === 'regional' || ch.cls === 'village';
    const seed = rng.float() * 500;

    if (asphalt) {
      // big soft tone blotches
      for (let s = rng.range(0, 4); s < L; s += rng.range(2.5, 6)) {
        const [x, y, tx, ty] = at(s, rng.range(-hw, hw));
        const dark = rng.chance(0.55);
        dec.push({ k: 'blot', x, y, rx: rng.range(1.2, 4.5), ry: rng.range(0.6, 1.8), rot: Math.atan2(ty, tx), col: dark ? '#2a2c31' : '#8a877f', a: rng.range(0.05, 0.12), bbox: null });
      }
      // wheel paths + oil strip, alpha modulated by noise in 4 m pieces
      const laneC = ch.spec.lanes >= 2 ? [-hw / 2, hw / 2] : [0];
      for (const lc of laneC) {
        for (let s = 0; s < L; s += 4) {
          const s1 = Math.min(L, s + 4);
          const nv = 0.35 + 0.3 * (noise.at(s * 0.08 + seed, lc) + 1) / 2;
          const wob = (q) => 0.12 * noise.at(q * 0.05 + seed, lc + 9);
          const base = ch.cls === 'regional' ? 0.13 : 0.08;
          band((q) => lc - 0.85 + wob(q), s, s1, 0.55, '#8b8982', base * (0.4 + nv), false);
          band((q) => lc + 0.85 + wob(q), s, s1, 0.55, '#8b8982', base * (0.4 + nv), false);
          band((q) => lc + wob(q) * 0.5, s, s1, 0.8, '#1e2024', 0.09 * (0.3 + nv), false);
        }
      }
      // patches (repairs)
      const nPatch = Math.round(L / (ch.cls === 'regional' ? 30 : 38));
      for (let i = 0; i < nPatch; i++) {
        const s = rng.range(1, Math.max(1.5, L - 7)), len = rng.range(1.4, ch.cls === 'regional' ? 7 : 4.5);
        let l0, l1;
        const r = rng.float();
        if (r < 0.2 && ch.cls === 'village') { l0 = -hw; l1 = hw; } // utility trench across
        else if (r < 0.55) { l0 = rng.range(0, hw * 0.3); l1 = l0 + rng.range(1, hw * 0.9); }
        else { l1 = -rng.range(0, hw * 0.3); l0 = l1 - rng.range(1, hw * 0.9); }
        l0 = Math.max(-hw - 0.2, l0); l1 = Math.min(hw + 0.2, l1);
        const len2 = r < 0.2 && ch.cls === 'village' ? rng.range(0.7, 1.1) : len;
        const sk = rng.range(-0.25, 0.25);
        const corners = [[s, l0], [s + len2, l0 + sk * 0.3], [s + len2 + sk, l1], [s + sk * 0.5, l1]];
        const poly = [];
        for (let k = 0; k < 4; k++) {
          const A = corners[k], B = corners[(k + 1) % 4];
          for (let t = 0; t < 1; t += 0.34) poly.push(at(A[0] + (B[0] - A[0]) * t + rng.range(-0.06, 0.06), A[1] + (B[1] - A[1]) * t + rng.range(-0.06, 0.06)));
        }
        for (const q of poly) q.length = 2;
        dec.push({ k: 'patch', poly, bbox: bboxOf(poly, 0.2), old: rng.chance(0.3) });
      }
      // cracks: longitudinal near edges + transverse
      for (let s = rng.range(0, 10); s < L - 2; s += rng.range(6, 16)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const len = rng.range(2, 9);
        const lat0 = side * (hw - rng.range(0.25, 0.9));
        const pts = [];
        let lat = lat0;
        for (let q = s; q < Math.min(L, s + len); q += rng.range(0.25, 0.6)) { lat += rng.range(-0.07, 0.07); const p = at(q, lat); pts.push([p[0], p[1]]); }
        if (pts.length > 1) dec.push({ k: 'crack', pts, sealed: rng.chance(ch.cls === 'regional' ? 0.45 : 0.25), bbox: bboxOf(pts, 0.2), fine: true });
      }
      for (let s = rng.range(3, 15); s < L - 1; s += rng.range(9, 26)) {
        const pts = [];
        let q = s;
        const a = rng.range(-hw * 0.9, hw * 0.4), b = Math.min(hw * 0.95, a + rng.range(0.8, 2.6));
        for (let lat = a; lat < b; lat += rng.range(0.12, 0.35)) { q += rng.range(-0.16, 0.16); const p = at(q, lat); pts.push([p[0], p[1]]); }
        if (pts.length > 1) dec.push({ k: 'crack', pts, sealed: rng.chance(0.6), bbox: bboxOf(pts, 0.2), fine: true });
      }
      // alligator cracking clusters near the edge (regional)
      if (ch.cls === 'regional') {
        for (let s = rng.range(5, 30); s < L - 3; s += rng.range(25, 60)) {
          const side = rng.chance(0.5) ? 1 : -1;
          dec.push({ k: 'gator', s, side, cx: at(s, side * (hw - 0.6)), len: rng.range(1.5, 3.5), seed: rng.int(1, 1e9), ch, bbox: bboxOf([at(s, side * hw), at(s + 4, side * (hw - 1.4))].map((p) => [p[0], p[1]]), 1) });
        }
      }
      if (ch.cls === 'village') {
        // manholes + gully grates
        for (let s = rng.range(6, 20); s < L - 3; s += rng.range(24, 45)) {
          const [x, y] = at(s, rng.range(-hw * 0.6, hw * 0.6));
          dec.push({ k: 'manhole', x, y, r: 0.33, bbox: { x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5 } });
        }
        let side = rng.chance(0.5) ? 1 : -1;
        for (let s = rng.range(4, 9); s < L - 2; s += rng.range(13, 19)) {
          const [x, y, tx, ty] = at(s, side * (hw - 0.26));
          dec.push({ k: 'grate', x, y, tx, ty, bbox: { x0: x - 0.6, y0: y - 0.6, x1: x + 0.6, y1: y + 0.6 } });
          side = -side;
        }
      }
    } else if (ch.cls === 'lane') {
      for (let s = 0; s < L; s += 4) {
        const s1 = Math.min(L, s + 4);
        const nv = 0.3 + 0.4 * (noise.at(s * 0.1 + seed, 3) + 1) / 2;
        const wob = (q) => 0.1 * noise.at(q * 0.06 + seed, 7);
        band((q) => -0.8 + wob(q), s, s1, 0.75, '#6d6558', 0.12 + 0.14 * nv);
        band((q) => 0.8 + wob(q), s, s1, 0.75, '#6d6558', 0.12 + 0.14 * nv);
        band((q) => wob(q) * 0.5, s, s1, 0.5, '#b3ab9c', 0.12 + 0.12 * nv);
      }
      // remnants of old asphalt
      for (let s = rng.range(0, 20); s < L - 4; s += rng.range(14, 40)) {
        const len = rng.range(1.5, 5), l0 = rng.range(-hw, 0), l1 = rng.range(0.2, hw);
        const poly = [];
        const n = 9;
        for (let k = 0; k < n; k++) { const q = s + (len * k) / (n - 1); poly.push(at(q, l0 + rng.range(-0.25, 0.25))); }
        for (let k = n - 1; k >= 0; k--) { const q = s + (len * k) / (n - 1); poly.push(at(q, l1 + rng.range(-0.25, 0.25))); }
        const pp = poly.map((p) => [p[0], p[1]]);
        dec.push({ k: 'patch', poly: pp, bbox: bboxOf(pp, 0.2), old: true, ragged: true });
      }
      // centre grass, sparse
      dec.push({ k: 'grassStrip', ch, s0: 0, s1: L, w: 0.5, density: 0.35, seed: rng.int(1, 1e9), bbox: ch.bbox });
      // potholes / puddles in dips
      for (let s = 2; s < L - 2; s += 1.5) {
        const v = noise.fbm(s * 0.045 + seed * 0.3, 11.5, 2);
        if (v < -0.28 && rng.chance(0.35)) {
          const lat = rng.chance(0.5) ? -0.8 : 0.8;
          const [x, y, tx, ty] = at(s, lat + rng.range(-0.2, 0.2));
          const P = { x, y, rx: rng.range(0.35, 1.0), ry: rng.range(0.25, 0.5), rot: Math.atan2(ty, tx) };
          puddles.push(P);
          dec.push({ k: 'pothole', ...P, bbox: { x0: x - 1.2, y0: y - 1.2, x1: x + 1.2, y1: y + 1.2 } });
          s += 3;
        }
      }
    } else if (ch.cls === 'track') {
      for (let s = 0; s < L; s += 4) {
        const s1 = Math.min(L, s + 4);
        const wob = (q) => 0.12 * noise.at(q * 0.05 + seed, 5);
        const nv = 0.75 + 0.25 * noise.at(s * 0.07 + seed, 9);
        for (const sgn of [-1, 1]) {
          const wv = (q) => sgn * 0.8 + wob(q) + 0.05 * noise.at(q * 0.4 + seed, sgn * 4);
          band(wv, s, s1, 1.0, '#9a8b70', 0.22 * nv);
          band(wv, s, s1, 0.8, null, 0.8 * nv, false, 'dirt');
          band(wv, s, s1, 0.46, '#6f5e48', 0.3 * nv);
        }
        band((q) => -0.8 + wob(q) + 0.08, s, s1, 0.12, '#4a3b2b', 0.18, true);
        band((q) => 0.8 + wob(q) - 0.08, s, s1, 0.12, '#4a3b2b', 0.18, true);
      }
      dec.push({ k: 'grassStrip', ch, s0: 0, s1: L, w: 0.85, density: 1, seed: rng.int(1, 1e9), bbox: ch.bbox });
      for (let s = 2; s < L - 2; s += 1.5) {
        const v = noise.fbm(s * 0.05 + seed * 0.3, 21.5, 2);
        if (v < -0.25 && rng.chance(0.45)) {
          const lat = rng.chance(0.5) ? -0.78 : 0.78;
          const [x, y, tx, ty] = at(s, lat);
          const P = { x, y, rx: rng.range(0.5, 1.4), ry: 0.3, rot: Math.atan2(ty, tx) };
          puddles.push(P);
          dec.push({ k: 'pothole', ...P, mud: true, bbox: { x0: x - 1.6, y0: y - 1.6, x1: x + 1.6, y1: y + 1.6 } });
          s += 3;
        }
      }
    }
    for (const d of dec) if (!d.bbox) d.bbox = { x0: d.x - d.rx, y0: d.y - d.rx, x1: d.x + d.rx, y1: d.y + d.rx };
    ch.decals = dec;
  }
  for (const J of D.junctions) {
    const rng = rngBase.fork('J' + J.node);
    const dec = [];
    const cls = J.arms.find((a) => a.rank === J.maxRank).cls;
    if (cls === 'regional' || cls === 'village') {
      const R = Math.max(...J.arms.map((a) => a.s));
      for (let i = 0; i < 6; i++) {
        const x = J.x + rng.range(-R, R), y = J.y + rng.range(-R, R);
        dec.push({ k: 'blot', x, y, rx: rng.range(1, 3), ry: rng.range(0.8, 2), rot: rng.float() * 3, col: rng.chance(0.6) ? '#2a2c31' : '#8a877f', a: rng.range(0.05, 0.1), bbox: { x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 } });
      }
      // turning wear: dark smear in the middle
      dec.push({ k: 'blot', x: J.x, y: J.y, rx: 2.4, ry: 1.6, rot: rng.float() * 3, col: '#24262a', a: 0.1, bbox: { x0: J.x - 3, y0: J.y - 3, x1: J.x + 3, y1: J.y + 3 } });
      if (cls === 'village') {
        const x = J.x + rng.range(-1.5, 1.5), y = J.y + rng.range(-1.5, 1.5);
        dec.push({ k: 'manhole', x, y, r: 0.33, bbox: { x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5 } });
      }
    }
    if (J.through && (cls === 'regional' || cls === 'village')) {
      const [A, B] = J.through;
      const P = (arm, lat) => { const m = [arm.d[1], -arm.d[0]]; return [J.x + arm.d[0] * arm.s + m[0] * lat, J.y + arm.d[1] * arm.s + m[1] * lat]; };
      const lanes = [-A.hw / 2, A.hw / 2];
      for (const lc of lanes) {
        for (const [off, w, col, a] of [[-0.85, 0.55, '#8b8982', cls === 'regional' ? 0.08 : 0.05], [0.85, 0.55, '#8b8982', cls === 'regional' ? 0.08 : 0.05], [0, 0.8, '#1e2024', 0.05]]) {
          const pts = [P(A, lc + off), P(B, -(lc + off))];
          dec.push({ k: 'band', pts, w, col, a, bbox: bboxOf(pts, 1) });
        }
      }
    }
    J.decals = dec;
    J.cls = cls;
  }
  D.puddles = puddles;
}

/** wing walls of a bridge span [a,b] on chain ch: [{p0,p1,nx,ny}] (world metres) */
export function wingWalls(ch, a, b) {
  const out = [];
  const dw = ch.hw + 1.15;
  for (const [s, dir] of [[a - 1.2, -1], [b + 1.2, 1]]) {
    const p = sampleAt(ch.pts, ch.cum, Math.max(0, Math.min(ch.L, s)));
    for (const side of [1, -1]) {
      const nx = -p.ty * side, ny = p.tx * side;
      const p0 = [p.x + nx * (dw - 0.25), p.y + ny * (dw - 0.25)];
      const d = norm(p.tx * dir * 0.8 + nx, p.ty * dir * 0.8 + ny);
      const p1 = [p0[0] + d[0] * 3.4, p0[1] + d[1] * 3.4];
      out.push({ p0, p1, nx: -d[1], ny: d[0] });
    }
  }
  return out;
}
const prngLocal = (s) => prng(s >>> 0);

// ======================================================================
// Chunk painter
// ======================================================================
export function makePainter({ art, palette, tex, getD, getEnv }) {
  const M = art.mix, S = art.shade;

  function rangeIdx(ch, rect, pad) {
    let i0 = -1, i1 = -1;
    const x0 = rect.x0 - pad, y0 = rect.y0 - pad, x1 = rect.x1 + pad, y1 = rect.y1 + pad;
    for (let i = 0; i < ch.pts.length; i++) {
      const p = ch.pts[i];
      if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 < 0) return null;
    return [Math.max(0, i0 - 1), Math.min(ch.pts.length - 1, i1 + 1)];
  }
  const sub = (arr, r) => arr.slice(r[0], r[1] + 1);
  function ribbonPath(g, ch, r, extra = 0) {
    const R = extra ? offsetPts(ch.pts, ch.tx, ch.ty, (i) => ch.wR[i] + extra) : ch.edgeR;
    const Lf = extra ? offsetPts(ch.pts, ch.tx, ch.ty, (i) => -ch.wL[i] - extra) : ch.edgeL;
    const a = sub(R, r), b = sub(Lf, r).reverse();
    pathFrom(g, a.concat(b), true);
  }
  function offLine(ch, r, k) { return offsetPts(sub(ch.pts, r), sub(ch.tx, r), sub(ch.ty, r), k); }
  /** index ranges (within r) not on a bridge */
  function groundRanges(ch, r) {
    if (!ch.bridges.length) return [r];
    const out = [];
    let start = -1;
    for (let i = r[0]; i <= r[1]; i++) {
      const on = ch.isBridge(ch.cum[i]);
      if (!on && start < 0) start = i;
      if ((on || i === r[1]) && start >= 0) { const e = on ? i - 1 : i; if (e > start) out.push([start, e]); start = -1; }
    }
    return out;
  }
  function strokePts(g, pts, w, style, alpha = 1) {
    if (pts.length < 2) return;
    g.beginPath(); pathFrom(g, pts); g.lineWidth = w; g.strokeStyle = style; g.globalAlpha = alpha; g.stroke(); g.globalAlpha = 1;
  }

  function* steps(g, rect, res) {
    const D = getD();
    if (!D) return;
    const env = getEnv();
    const lod = res >= 16 ? 2 : res >= 6 ? 1 : 0;
    const season = env.season;
    const grassCols = palette.grass[season] || palette.grass.summer;
    const chs = D.chains.filter((c) => bboxHit(c.bbox, rect.x0, rect.y0, rect.x1, rect.y1));
    const js = D.junctions.filter((J) => bboxHit(J.bbox, rect.x0 - 4, rect.y0 - 4, rect.x1 + 4, rect.y1 + 4));
    const ranges = new Map();
    for (const ch of chs) { const r = rangeIdx(ch, rect, outerHalf(ch.cls) + 3); if (r) ranges.set(ch, r); }
    const pats = {
      regional: patternFor(g, tex.asphalt, res), village: patternFor(g, tex.asphaltOld, res),
      lane: patternFor(g, tex.gravel, res), track: patternFor(g, tex.dirt, res),
      patch: patternFor(g, tex.asphaltPatch, res), old: patternFor(g, tex.asphaltOld, res),
      concrete: patternFor(g, tex.concrete, res), dirt: patternFor(g, tex.dirt, res), gravel: patternFor(g, tex.gravel, res),
    };
    const shoulderCol = M(palette.soil.dry, palette.gravel[1], 0.55);
    const kW = CLASSES.village.kerbW, pave = CLASSES.village.pave;

    // ---------- 1. ground contact: shoulders / verge AO / pavement shadow
    for (const [ch, r] of ranges) {
      for (const gr of groundRanges(ch, r)) {
        const pts = sub(ch.pts, gr);
        if (ch.spec.kerb) {
          strokePts(g, pts, 2 * (ch.hw + ch.spec.kerbW + ch.spec.pave) + 0.7, 'rgba(34,40,26,1)', 0.16);
        } else if (ch.cls === 'track') {
          strokePts(g, pts, 2 * ch.hw + 1.4, M(grassCols[1], '#d9cf9c', 0.35), 0.25);
          strokePts(g, pts, 2 * ch.hw + 0.6, M(grassCols[1], '#cfc08c', 0.5), 0.3);
        } else {
          strokePts(g, pts, 2 * ch.hw + 1.9, 'rgba(40,44,28,1)', 0.1);
          strokePts(g, pts, 2 * ch.hw + 1.3, shoulderCol, 0.22);
          strokePts(g, pts, 2 * ch.hw + 0.9, shoulderCol, 0.3);
          strokePts(g, pts, 2 * ch.hw + 0.55, shoulderCol, 0.4);
        }
      }
      yield 1;
    }
    const kerbCorner = (c, J) => J.degree > 2 && (CLASSES[J.arms[c.i].cls].kerb || CLASSES[J.arms[c.j].cls].kerb) && c.type === 'fillet';
    for (const J of js) {
      if (J.cls === 'track') {
        g.beginPath(); pathFrom(g, junctionPoly(J, 0.6), true);
        g.fillStyle = M(palette.soil.dry, grassCols[2], 0.55); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
        continue;
      }
      g.beginPath(); pathFrom(g, junctionPoly(J, 0.95), true);
      g.fillStyle = 'rgba(40,44,28,1)'; g.globalAlpha = 0.1; g.fill();
      if (!J.arms.every((a) => CLASSES[a.cls].kerb)) for (const [k, al] of [[0.65, 0.22], [0.45, 0.3]]) {
        g.beginPath(); pathFrom(g, junctionPoly(J, k), true); g.fillStyle = shoulderCol; g.globalAlpha = al; g.fill();
      }
      const allKerb = J.arms.every((a) => CLASSES[a.cls].kerb);
      g.beginPath(); pathFrom(g, junctionPoly(J, (c) => (kerbCorner(c, J) ? kW + pave + 0.35 : 0.25)), true);
      g.fillStyle = allKerb ? 'rgba(34,40,26,1)' : shoulderCol; g.globalAlpha = allKerb ? 0.16 : 0.4; g.fill(); g.globalAlpha = 1;
      yield 1;
    }

    // ---------- 2. bridge decks + abutments
    for (const [ch] of ranges) for (const [a, b] of ch.bridges) { paintDeck(g, ch, a, b, pats, lod); yield 1; }

    // ---------- 3. village pavements
    for (const [ch, r] of ranges) {
      if (!ch.spec.kerb) continue;
      for (const side of [1, -1]) {
        const inner = offLine(ch, r, side * ch.hw), outer = offLine(ch, r, side * (ch.hw + kW + pave));
        g.beginPath(); pathFrom(g, inner.concat(outer.slice().reverse()), true);
        g.fillStyle = pats.concrete; g.fill();
        g.fillStyle = 'rgba(150,132,104,0.16)'; g.fill();
        if (lod >= 1) slabJoints(g, ch, r, side, lod);
        backEdge(g, outer, grassCols, lod, hs(ch.key + side));
        yield 1;
      }
    }
    for (const J of js) {
      J.corners.forEach((c, ci) => {
        const A = J.arms[c.i], B = J.arms[c.j];
        if (!kerbCorner(c, J)) return;
        const n = Math.max(4, Math.ceil(c.R * c.half * 2 / 0.9));
        const inner = cornerCurve(J, ci, 0), outer = cornerCurve(J, ci, kW + pave);
        g.beginPath(); pathFrom(g, inner.concat(outer.slice().reverse()), true);
        g.fillStyle = pats.concrete; g.fill();
        g.fillStyle = 'rgba(150,132,104,0.16)'; g.fill();
        if (lod >= 2) {
          g.strokeStyle = 'rgba(90,84,72,0.35)'; g.lineWidth = 0.03; g.beginPath();
          for (let k = 1; k < n; k++) {
            const t = k / n;
            const pa = cornerPoint(J, c, t, kW), pb = cornerPoint(J, c, t, kW + pave);
            g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]);
          }
          g.stroke();
        }
        backEdge(g, outer, grassCols, lod, hs(J.node + ':' + ci));
      });
      yield 1;
    }

    // ---------- 4. carriageways (lower classes first)
    for (const cls of ['track', 'lane', 'village', 'regional']) {
      for (const [ch, r] of ranges) {
        if (ch.cls !== cls) continue;
        g.beginPath(); ribbonPath(g, ch, r);
        if (cls === 'track') { g.globalAlpha = 0.18; g.fillStyle = pats.dirt; g.fill(); g.globalAlpha = 1; }
        else { g.fillStyle = pats[cls]; g.fill(); }
        yield 1;
      }
      for (const J of js) {
        if (J.cls !== cls) continue;
        g.beginPath(); pathFrom(g, J.poly, true);
        if (cls === 'track') { g.globalAlpha = 0.4; g.fillStyle = pats.dirt; g.fill(); g.globalAlpha = 1; }
        else { g.fillStyle = pats[cls]; g.fill(); g.strokeStyle = pats[cls]; g.lineWidth = 0.14; g.stroke(); }
        // minor arms of a different surface fade into the junction: draw their mouths first
        yield 1;
      }
    }

    // ---------- 5. surface decals, clipped to each carriageway
    for (const [ch, r] of ranges) {
      g.save();
      g.beginPath(); ribbonPath(g, ch, r, ch.cls === 'track' ? 0.2 : 0.02); g.clip();
      for (const d of ch.decals) {
        if (!bboxHit(d.bbox, rect.x0, rect.y0, rect.x1, rect.y1)) continue;
        drawDecal(g, d, lod, pats, grassCols, rect);
      }
      g.restore();
      yield 2;
    }
    for (const J of js) {
      g.save(); g.beginPath(); pathFrom(g, J.poly, true); g.clip();
      for (const d of J.decals) drawDecal(g, d, lod, pats, grassCols, rect);
      g.restore();
      yield 1;
    }

    // ---------- 6. kerbs
    for (const [ch, r] of ranges) {
      if (!ch.spec.kerb) continue;
      for (const side of [1, -1]) kerbLine(g, offLine(ch, r, side * (ch.hw + kW / 2)), offLine(ch, r, side * ch.hw), lod);
      yield 1;
    }
    for (const J of js) J.corners.forEach((c, ci) => {
      if (!kerbCorner(c, J)) return;
      kerbLine(g, cornerCurve(J, ci, kW / 2), cornerCurve(J, ci, 0), lod);
    });

    // ---------- 7. rural edges: crumble, stones, grass tufts creeping over
    if (lod >= 1) for (const [ch, r] of ranges) if (!ch.spec.kerb) { ruralEdges(g, ch, r, lod, grassCols); yield 1; }

    // ---------- 8. markings
    for (const [ch, r] of ranges) { markings(g, ch, r, lod); yield 1; }
    for (const J of js) junctionMarkings(g, J, lod);
    for (const c of D.crossings) if (Math.abs(c.x - (rect.x0 + rect.x1) / 2) < rect.x1 - rect.x0 && Math.abs(c.y - (rect.y0 + rect.y1) / 2) < rect.y1 - rect.y0) zebra(g, c, lod);

    // ---------- 9. snow
    if (env.snow > 0.05) {
      for (const [ch, r] of ranges) { snowEdges(g, ch, r, env.snow, lod); yield 1; }
      for (const J of js) if (J.cls !== 'track') snowCorners(g, J, env.snow, lod);
    }
  }

  // ---------------- helpers
  function cornerPoint(J, c, t, k) {
    const A = J.arms[c.i], B = J.arms[c.j];
    const tanA = [c.C[0] + A.d[0] * c.T + c.nA[0] * k, c.C[1] + A.d[1] * c.T + c.nA[1] * k];
    const tanB = [c.C[0] + B.d[0] * c.T + c.mB[0] * k, c.C[1] + B.d[1] * c.T + c.mB[1] * k];
    const r = c.R - k;
    if (r <= 0.05) return [tanA[0] + (tanB[0] - tanA[0]) * t, tanA[1] + (tanB[1] - tanA[1]) * t];
    const a0 = Math.atan2(tanA[1] - c.O[1], tanA[0] - c.O[0]);
    let da = Math.atan2(tanB[1] - c.O[1], tanB[0] - c.O[0]) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const a = a0 + da * t;
    return [c.O[0] + Math.cos(a) * r, c.O[1] + Math.sin(a) * r];
  }

  function slabJoints(g, ch, r, side, lod) {
    if (lod < 2) return;
    g.strokeStyle = 'rgba(92,86,74,0.4)'; g.lineWidth = 0.03;
    g.beginPath();
    const kW = ch.spec.kerbW, pave = ch.spec.pave;
    const s0 = ch.cum[r[0]], s1 = ch.cum[r[1]];
    for (let s = Math.ceil(s0 / 0.9) * 0.9; s <= s1; s += 0.9) {
      const p = sampleAt(ch.pts, ch.cum, s);
      const a = ch.hw + kW, b = ch.hw + kW + pave;
      g.moveTo(p.x - p.ty * side * a, p.y + p.tx * side * a);
      g.lineTo(p.x - p.ty * side * b, p.y + p.tx * side * b);
    }
    g.stroke();
    // longitudinal joint in the middle of the footway
    const mid = offLine(ch, r, side * (ch.hw + kW + pave * 0.5));
    strokePts(g, mid, 0.025, 'rgba(92,86,74,1)', 0.3);
  }

  function backEdge(g, pts, grassCols, lod, seed) {
    strokePts(g, pts, 0.07, 'rgba(60,64,44,1)', 0.35);
    if (lod < 2) return;
    const rnd = prng(seed);
    g.lineWidth = 0.035;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor(L * 5);
      for (let k = 0; k < n; k++) {
        if (rnd() > 0.45) continue;
        const t = rnd(), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        g.strokeStyle = S(grassCols[(rnd() * 4) | 0], -0.15 + rnd() * 0.2); g.globalAlpha = 0.8;
        g.beginPath();
        for (let q = 0; q < 3; q++) { const an = rnd() * 6.28, l = 0.08 + rnd() * 0.12; g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  function kerbLine(g, mid, face, lod) {
    const kW = CLASSES.village.kerbW;
    // gutter AO on the road side
    strokePts(g, face, 0.16, 'rgba(24,26,30,1)', 0.28);
    strokePts(g, mid, kW, palette.kerb);
    strokePts(g, mid, kW * 0.45, 'rgba(240,236,226,1)', 0.25);
    strokePts(g, face, 0.035, S(palette.kerb, -0.45), 0.8);
    if (lod >= 2) {
      // joints every metre
      g.strokeStyle = 'rgba(80,76,70,0.55)'; g.lineWidth = 0.025; g.beginPath();
      let acc = 0;
      for (let i = 1; i < mid.length; i++) {
        const a = mid[i - 1], b = mid[i];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc += L;
        if (acc >= 1) {
          acc -= 1;
          const d = norm(b[0] - a[0], b[1] - a[1]);
          g.moveTo(b[0] - d[1] * kW * 0.5, b[1] + d[0] * kW * 0.5); g.lineTo(b[0] + d[1] * kW * 0.5, b[1] - d[0] * kW * 0.5);
        }
      }
      g.stroke();
    }
  }

  function drawDecal(g, d, lod, pats, grassCols, rect) {
    switch (d.k) {
      case 'blot':
        g.globalAlpha = d.a; g.fillStyle = d.col;
        g.beginPath(); g.ellipse(d.x, d.y, d.rx, d.ry, d.rot, 0, 6.283); g.fill(); g.globalAlpha = 1;
        break;
      case 'band':
        if (d.fine && lod < 1) return;
        g.lineCap = 'butt';
        strokePts(g, d.pts, d.w, d.pattern ? pats[d.pattern] : d.col, d.a);
        g.lineCap = 'round';
        break;
      case 'patch': {
        g.beginPath(); pathFrom(g, d.poly, true);
        g.fillStyle = d.old ? pats.old : pats.patch; g.fill();
        if (d.ragged) {
          g.strokeStyle = 'rgba(60,56,50,0.5)'; g.lineWidth = 0.06; g.stroke();
        } else {
          g.strokeStyle = 'rgba(18,19,22,0.24)'; g.lineWidth = lod >= 2 ? 0.05 : 0.08; g.stroke();
          if (lod >= 2) { g.strokeStyle = 'rgba(200,200,200,0.08)'; g.lineWidth = 0.02; g.stroke(); }
        }
        break;
      }
      case 'crack':
        if (lod < 1) return;
        if (d.sealed) {
          strokePts(g, d.pts, lod >= 2 ? 0.08 : 0.11, '#25262a', 0.55);
          if (lod >= 2) strokePts(g, d.pts, 0.025, 'rgba(150,160,175,1)', 0.18);
        } else strokePts(g, d.pts, 0.035, '#202125', 0.6);
        break;
      case 'gator': {
        if (lod < 2) return;
        const rnd = prng(d.seed);
        const ch = d.ch;
        g.strokeStyle = 'rgba(28,29,33,0.55)'; g.lineWidth = 0.03; g.beginPath();
        for (let k = 0; k < 40; k++) {
          const s = d.s + rnd() * d.len, lat = d.side * (ch.hw - rnd() * 1.1);
          const p = sampleAt(ch.pts, ch.cum, s);
          const x = p.x - p.ty * lat, y = p.y + p.tx * lat;
          const a = rnd() * 6.28, l = 0.12 + rnd() * 0.2;
          g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          g.lineTo(x + Math.cos(a + 1.8) * l, y + Math.sin(a + 1.8) * l);
        }
        g.stroke();
        break;
      }
      case 'manhole': {
        g.fillStyle = '#3a3b3e'; g.beginPath(); g.arc(d.x, d.y, d.r + 0.06, 0, 6.283); g.fill();
        g.fillStyle = '#56575a'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, 6.283); g.fill();
        if (lod >= 2) {
          g.strokeStyle = 'rgba(30,31,34,0.7)'; g.lineWidth = 0.025;
          for (let k = 1; k <= 2; k++) { g.beginPath(); g.arc(d.x, d.y, d.r * k / 3, 0, 6.283); g.stroke(); }
          g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 0.785; g.moveTo(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * d.r); g.lineTo(d.x - Math.cos(a) * d.r, d.y - Math.sin(a) * d.r); } g.stroke();
          g.fillStyle = 'rgba(255,250,230,0.12)'; g.beginPath(); g.arc(d.x - 0.08, d.y - 0.08, d.r * 0.6, 0, 6.283); g.fill();
        }
        break;
      }
      case 'grate': {
        g.save(); g.translate(d.x, d.y); g.rotate(Math.atan2(d.ty, d.tx));
        g.fillStyle = '#2c2d30'; g.fillRect(-0.3, -0.2, 0.6, 0.4);
        g.fillStyle = '#4b4c50'; g.fillRect(-0.26, -0.16, 0.52, 0.32);
        if (lod >= 2) { g.fillStyle = '#17181b'; for (let k = 0; k < 6; k++) g.fillRect(-0.22 + k * 0.08, -0.12, 0.04, 0.24); }
        g.restore();
        break;
      }
      case 'pothole': {
        const rnd = prng(hs(d.x.toFixed(2) + d.y.toFixed(2)));
        g.save(); g.translate(d.x, d.y); g.rotate(d.rot);
        const blobs = [];
        for (let k = 0; k < 5; k++) blobs.push([(rnd() - 0.5) * d.rx, (rnd() - 0.5) * d.ry * 0.6, d.rx * (0.45 + rnd() * 0.35), d.ry * (0.55 + rnd() * 0.4), (rnd() - 0.5) * 0.6]);
        const draw = (grow, col, a) => { g.fillStyle = col; g.globalAlpha = a; g.beginPath(); for (const [x, y, rx, ry, r] of blobs) { g.moveTo(x + rx + grow, y); g.ellipse(x, y, rx + grow, ry + grow * 0.8, r, 0, 6.283); } g.fill(); };
        draw(0.14, d.mud ? M(palette.mud, palette.soil.dry, 0.4) : '#8a8070', 0.45);
        draw(0.02, d.mud ? palette.mud : '#6a6052', 0.75);
        draw(-0.1, d.mud ? S(palette.mud, -0.2) : '#584f43', 0.6);
        g.globalAlpha = 1;
        if (lod >= 2) {
          for (let k = 0; k < 12; k++) {
            const a2 = rnd() * 6.28, rr = 0.9 + rnd() * 0.4;
            g.fillStyle = rnd() < 0.5 ? palette.gravel[2] : palette.gravel[3];
            g.beginPath(); g.ellipse(Math.cos(a2) * d.rx * rr, Math.sin(a2) * d.ry * rr, 0.035 + rnd() * 0.04, 0.03, a2, 0, 6.283); g.fill();
          }
        }
        g.restore();
        break;
      }
      case 'grassStrip': {
        if (lod < 1) {
          const r = rangeIdx(d.ch, rect, 2);
          if (r) strokePts(g, sub(d.ch.pts, r), d.w * 0.8, grassCols[2], 0.45 * d.density);
          return;
        }
        const ch = d.ch;
        const r = rangeIdx(ch, rect, 2);
        if (!r) return;
        strokePts(g, sub(ch.pts, r), d.w * 0.6, grassCols[2], 0.25 * d.density);
        g.lineWidth = lod >= 2 ? 0.035 : 0.06;
        for (let i = r[0]; i <= r[1]; i++) {
          const rnd = prng(d.seed + i * 7919);
          const n = Math.round((lod >= 2 ? 9 : 4) * d.density);
          for (let k = 0; k < n; k++) {
            if (rnd() > d.density + 0.1) continue;
            const lat = (rnd() - 0.5) * d.w * (0.6 + rnd() * 0.6);
            const p = ch.pts[i];
            const x = p[0] - ch.ty[i] * lat + (rnd() - 0.5) * 0.4, y = p[1] + ch.tx[i] * lat + (rnd() - 0.5) * 0.4;
            g.strokeStyle = rnd() < 0.5 ? S(grassCols[(rnd() * 4) | 0], -0.2) : M(grassCols[(rnd() * 4) | 0], '#efe8b8', 0.15);
            g.globalAlpha = 0.85;
            g.beginPath();
            for (let q = 0; q < 4; q++) { const an = rnd() * 6.28, l = 0.1 + rnd() * 0.16; g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); }
            g.stroke();
          }
        }
        g.globalAlpha = 1;
        break;
      }
      default: break;
    }
  }

  function ruralEdges(g, ch, r, lod, grassCols) {
    const asph = ch.cls === 'regional';
    for (const side of [1, -1]) {
      for (let i = r[0]; i <= r[1]; i++) {
        if (ch.isBridge(ch.cum[i])) continue;
        const rnd = prng(hs(ch.key) + i * 31 + (side > 0 ? 7 : 3));
        const p = ch.pts[i], nx = -ch.ty[i] * side, ny = ch.tx[i] * side;
        const w = side > 0 ? ch.wR[i] : ch.wL[i];
        const n = lod >= 2 ? 5 : 2;
        for (let k = 0; k < n; k++) {
          const along = (rnd() - 0.5) * 0.5;
          const x0 = p[0] + ch.tx[i] * along, y0 = p[1] + ch.ty[i] * along;
          const roll = rnd();
          if (roll < (asph ? 0.2 : 0.35)) {
            // crumbs of surface outside the edge
            const o = w + rnd() * 0.3;
            g.fillStyle = asph ? (rnd() < 0.5 ? '#5a5b5e' : '#6b6a66') : (rnd() < 0.5 ? palette.gravel[1] : palette.gravel[2]);
            g.globalAlpha = asph ? 0.55 : 0.85;
            g.beginPath(); g.ellipse(x0 + nx * o, y0 + ny * o, 0.04 + rnd() * 0.1, 0.03 + rnd() * 0.06, rnd() * 3, 0, 6.283); g.fill();
          } else if (roll < 0.55 && asph) {
            // bites taken out of the edge
            const o = w - rnd() * 0.15;
            g.fillStyle = M(palette.soil.dry, palette.gravel[1], 0.5); g.globalAlpha = 0.9;
            g.beginPath(); g.ellipse(x0 + nx * o, y0 + ny * o, 0.08 + rnd() * 0.16, 0.05 + rnd() * 0.08, Math.atan2(ch.ty[i], ch.tx[i]), 0, 6.283); g.fill();
          } else if (lod >= 2 || roll > 0.8) {
            // grass tuft creeping over the edge
            const o = w + 0.1 - rnd() * 0.3;
            const x = x0 + nx * o, y = y0 + ny * o;
            g.lineWidth = lod >= 2 ? 0.035 : 0.06; g.globalAlpha = 0.9;
            g.strokeStyle = rnd() < 0.5 ? S(grassCols[(rnd() * 4) | 0], -0.2) : grassCols[(rnd() * 4) | 0];
            g.beginPath();
            for (let q = 0; q < 4; q++) {
              const an = Math.atan2(-ny, -nx) + (rnd() - 0.5) * 2.2, l = 0.1 + rnd() * 0.2;
              g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l);
            }
            g.stroke();
          }
        }
      }
    }
    g.globalAlpha = 1;
  }

  function markings(g, ch, r, lod) {
    const white = palette.roadLine;
    if (ch.cls !== 'regional') return;
    const hw = ch.hw;
    g.lineCap = 'butt';
    for (const side of [1, -1]) {
      const pts = offLine(ch, r, side * (hw - 0.32));
      strokePts(g, pts, 0.14, white, 0.88);
      if (lod >= 2) wearLine(g, pts, hs(ch.key + 'e' + side));
    }
    const c = offLine(ch, r, 0);
    // centre: dashed, but solid over bridges (+/- 12 m)
    const s0 = ch.cum[r[0]];
    g.setLineDash([3, 6]); g.lineDashOffset = -s0;
    strokePts(g, c, 0.13, white, 0.88);
    g.setLineDash([]);
    for (const [a, b] of ch.bridges) {
      const ia = Math.max(r[0], idxAt(ch, a - 12)), ib = Math.min(r[1], idxAt(ch, b + 12));
      if (ib > ia) strokePts(g, offLine(ch, [ia, ib], 0), 0.13, white, 0.9);
    }
    if (lod >= 2) wearLine(g, c, hs(ch.key + 'c'));
    g.lineCap = 'round';
  }
  function idxAt(ch, s) { let i = 0; while (i < ch.cum.length - 1 && ch.cum[i] < s) i++; return i; }
  function wearLine(g, pts, seed) {
    const rnd = prng(seed);
    g.fillStyle = '#4a4c50';
    for (let i = 1; i < pts.length; i++) {
      if (rnd() > 0.7) continue;
      const t = rnd(), a = pts[i - 1], b = pts[i];
      g.globalAlpha = 0.25 + rnd() * 0.35;
      g.beginPath(); g.ellipse(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.03 + rnd() * 0.07, 0.02 + rnd() * 0.05, rnd() * 3, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
  }

  function junctionMarkings(g, J, lod) {
    const white = palette.roadLine;
    const P = [J.x, J.y];
    g.lineCap = 'butt';
    const armEnd = (A, lat) => { const m = [A.d[1], -A.d[0]]; return [P[0] + A.d[0] * A.s + m[0] * lat, P[1] + A.d[1] * A.s + m[1] * lat]; };
    if (J.through && J.through[0].cls === 'regional') {
      const [A, B] = J.through;
      const ia = J.arms.indexOf(A), ib = J.arms.indexOf(B);
      // centre line straight through
      g.setLineDash([3, 6]);
      strokePts(g, [armEnd(A, 0), armEnd(B, 0)], 0.13, white, 0.88);
      g.setLineDash([]);
      // for each side: continuous if no arm in between, else dashed across the mouth
      for (const [from, to] of [[ia, ib], [ib, ia]]) {
        const F = J.arms[from], T = J.arms[to];
        const between = ((to - from + J.arms.length) % J.arms.length) - 1;
        const a = armEnd(F, -(F.hw - 0.32)), b = armEnd(T, T.hw - 0.32);
        if (between === 0) strokePts(g, [a, b], 0.14, white, 0.88);
        else { g.setLineDash([1, 1]); strokePts(g, [a, b], 0.14, white, 0.85); g.setLineDash([]); }
      }
    }
    // give-way teeth on minor paved arms
    for (const A of J.arms) {
      if (!A.minor || !(A.cls === 'village' || A.cls === 'regional')) continue;
      const m = [A.d[1], -A.d[0]];
      const lanes = CLASSES[A.cls].lanes;
      const l0 = lanes >= 2 ? 0.15 : -A.hw + 0.15, l1 = A.hw - 0.15;
      const n = Math.max(1, Math.floor((l1 - l0) / 0.7));
      const bw = (l1 - l0) / n;
      g.fillStyle = white; g.globalAlpha = 0.9;
      const base = A.s + 0.35, tip = A.s + 0.35 + 0.6;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const la = l0 + k * bw + 0.08, lb = l0 + (k + 1) * bw - 0.08, lm = (la + lb) / 2;
        const p1 = [P[0] + A.d[0] * base + m[0] * la, P[1] + A.d[1] * base + m[1] * la];
        const p2 = [P[0] + A.d[0] * base + m[0] * lb, P[1] + A.d[1] * base + m[1] * lb];
        const p3 = [P[0] + A.d[0] * tip + m[0] * lm, P[1] + A.d[1] * tip + m[1] * lm];
        g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath();
      }
      g.fill(); g.globalAlpha = 1;
      if (lod >= 2) {
        const pts = [];
        for (let k = 0; k <= 10; k++) { const la = l0 + (l1 - l0) * k / 10; pts.push([P[0] + A.d[0] * (base + 0.3) + m[0] * la, P[1] + A.d[1] * (base + 0.3) + m[1] * la]); }
        wearLine(g, pts, hs(J.node + A.cls));
      }
    }
    g.lineCap = 'round';
  }

  function zebra(g, c, lod) {
    const nx = -c.ty, ny = c.tx;
    const half = c.len / 2;
    g.fillStyle = palette.roadLine; g.globalAlpha = 0.9;
    g.beginPath();
    for (let lat = -c.hw + 0.3; lat + 0.5 <= c.hw - 0.1; lat += 1.0) {
      const q = [[-half, lat], [half, lat], [half, lat + 0.5], [-half, lat + 0.5]].map(([a, l]) => [c.x + c.tx * a + nx * l, c.y + c.ty * a + ny * l]);
      pathFrom(g, q, true);
    }
    g.fill(); g.globalAlpha = 1;
    if (lod >= 2) {
      const rnd = prng(hs('zebra' + c.x.toFixed(1)));
      g.fillStyle = '#4c4e52';
      for (let k = 0; k < 90; k++) {
        const a = (rnd() - 0.5) * c.len, l = (rnd() - 0.5) * c.hw * 2;
        g.globalAlpha = 0.2 + rnd() * 0.4;
        g.beginPath(); g.ellipse(c.x + c.tx * a + nx * l, c.y + c.ty * a + ny * l, 0.04 + rnd() * 0.1, 0.03 + rnd() * 0.05, rnd() * 3, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      // tactile paving at both ends on the footway
      const kW = CLASSES.village.kerbW;
      for (const side of [1, -1]) {
        const l0 = side * (c.hw + kW + 0.05), l1 = side * (c.hw + kW + 0.65);
        const q = [[-half, l0], [half, l0], [half, l1], [-half, l1]].map(([a, l]) => [c.x + c.tx * a + nx * l, c.y + c.ty * a + ny * l]);
        g.beginPath(); pathFrom(g, q, true); g.fillStyle = '#b98f6a'; g.fill();
        g.fillStyle = 'rgba(90,60,40,0.45)';
        for (let a = -half + 0.1; a < half; a += 0.14) for (let l = Math.min(l0, l1) + 0.07; l < Math.max(l0, l1); l += 0.14) {
          g.beginPath(); g.arc(c.x + c.tx * a + nx * l, c.y + c.ty * a + ny * l, 0.03, 0, 6.283); g.fill();
        }
      }
    }
  }

  function paintDeck(g, ch, a, b, pats, lod) {
    const s0 = Math.max(0, a - 2.5), s1 = Math.min(ch.L, b + 2.5);
    const pts = [], tx = [], ty = [];
    for (let s = s0; s <= s1 + 0.01; s += 0.5) { const p = sampleAt(ch.pts, ch.cum, Math.min(s, s1)); pts.push([p.x, p.y]); tx.push(p.tx); ty.push(p.ty); }
    const hw = ch.hw, dw = hw + 1.15;
    const off = (k) => offsetPts(pts, tx, ty, k);
    // abutments / wing walls (masonry) at both ends, splaying along the banks
    for (const w of wingWalls(ch, a, b)) {
      const { p0, p1, nx, ny } = w;
      const t = 0.3;
      const q = [[p0[0] + nx * t, p0[1] + ny * t], [p1[0] + nx * t, p1[1] + ny * t], [p1[0] - nx * t, p1[1] - ny * t], [p0[0] - nx * t, p0[1] - ny * t]];
      g.beginPath(); pathFrom(g, q, true);
      g.fillStyle = 'rgba(30,34,28,0.25)'; g.lineWidth = 0.5; g.strokeStyle = 'rgba(30,34,28,0.18)'; g.stroke();
      g.fillStyle = M(palette.rock[1], palette.concrete[0], 0.25); g.fill();
      g.save(); g.clip();
      const rnd = prngLocal(Math.round(p0[0] * 13 + p0[1] * 7));
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
      // stone blocks, two courses
      for (let row = 0; row < 2; row++) {
        const o0 = -t + row * t, o1 = o0 + t;
        for (let s = (row ? -0.25 : 0); s < L; s += 0.35 + rnd() * 0.3) {
          const e = Math.min(L, s + 0.3 + rnd() * 0.35);
          const pp = [[s, o0], [e, o0], [e, o1], [s, o1]].map(([u, v]) => [p0[0] + ux * u + nx * v, p0[1] + uy * u + ny * v]);
          g.beginPath(); pathFrom(g, pp, true);
          g.fillStyle = palette.rock[(rnd() * 4) | 0]; g.globalAlpha = 0.55; g.fill();
          if (lod >= 1) { g.globalAlpha = 0.6; g.strokeStyle = S(palette.rock[2], -0.35); g.lineWidth = 0.035; g.stroke(); }
        }
      }
      g.globalAlpha = 1;
      g.restore();
      // coping stone on top
      strokePts(g, [p0, p1], 0.16, M(palette.concrete[2], '#ffffff', 0.15), 0.8);
      g.beginPath(); pathFrom(g, q, true); g.strokeStyle = S(palette.rock[0], -0.5); g.lineWidth = 0.05; g.stroke();
    }
    // deck slab
    const L = off(dw), R = off(-dw);
    g.beginPath(); pathFrom(g, L.concat(R.slice().reverse()), true);
    g.fillStyle = pats.concrete; g.fill();
    g.strokeStyle = S(palette.concrete[1], -0.5); g.lineWidth = 0.08; g.stroke();
    // footway ledges
    for (const side of [1, -1]) {
      const ledge = off(side * (hw + 0.55));
      strokePts(g, ledge, 1.0, M(palette.concrete[2], '#ffffff', 0.1));
      strokePts(g, off(side * (hw + 0.04)), 0.08, S(palette.concrete[1], -0.3), 0.9);
      strokePts(g, off(side * (dw - 0.12)), 0.22, palette.concrete[0]);
      strokePts(g, off(side * (dw - 0.03)), 0.05, S(palette.concrete[1], -0.45), 0.8);
    }
    // expansion joints
    for (const s of [a, b]) {
      const p = sampleAt(ch.pts, ch.cum, s);
      const nx = -p.ty, ny = p.tx;
      strokePts(g, [[p.x + nx * dw, p.y + ny * dw], [p.x - nx * dw, p.y - ny * dw]], 0.16, '#2d2e31', 0.9);
      strokePts(g, [[p.x + nx * dw, p.y + ny * dw], [p.x - nx * dw, p.y - ny * dw]], 0.05, palette.metal[1], 0.9);
    }
  }

  const nz = art.noise('roads-snow');
  const noiseEdge = (x, y) => nz.at(x, y);
  function snowBand(g, pts, w, snow, lod, seed) {
    const cols = palette.snow;
    g.lineCap = 'butt';
    strokePts(g, pts, w * 0.5, cols[1], Math.min(0.9, 0.4 + snow));
    g.lineCap = 'round';
    if (lod < 1) { strokePts(g, pts, w, cols[1], 0.35 * snow); return; }
    const rnd = prng(seed);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const n = Math.ceil(L * (lod >= 2 ? 14 : 5));
      for (let k = 0; k < n; k++) {
        const t = rnd(), o = (rnd() - 0.5) * w * (0.8 + rnd() * 0.6) + noiseEdge(a[0] * 0.7, a[1] * 0.7) * w * 0.3;
        const r = 0.08 + rnd() * 0.2 * (1 - Math.abs(o) / w);
        g.fillStyle = cols[(rnd() * 3) | 0];
        g.globalAlpha = Math.min(1, snow * 2.2) * (1 - Math.abs(o) / w * 0.85);
        if (g.globalAlpha <= 0.05) continue;
        g.beginPath(); g.ellipse(a[0] + dx * t + nx * o, a[1] + dy * t + ny * o, r, r * 0.7, rnd() * 3, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  function snowEdges(g, ch, r, snow, lod) {
    const outerW = ch.spec.kerb ? ch.hw + ch.spec.kerbW + ch.spec.pave : ch.hw;
    const bw = 0.9 + snow * 1.1;
    for (const side of [1, -1]) {
      snowBand(g, offLine(ch, r, side * (outerW + bw * 0.45)), bw, snow, lod, hs(ch.key + side) + r[0]);
      strokePts(g, offLine(ch, r, side * (ch.hw - 0.12)), 0.22 + snow * 0.2, '#cdd3d7', 0.4 * snow);
    }
    if (ch.cls === 'track') snowBand(g, offLine(ch, r, 0), 0.9, snow, lod, hs(ch.key + 'c'));
    if (ch.cls === 'lane') snowBand(g, offLine(ch, r, 0), 0.6, snow * 0.8, lod, hs(ch.key + 'c'));
  }
  function snowCorners(g, J, snow, lod) {
    J.corners.forEach((c, ci) => {
      const kerbed = J.degree > 2 && c.type === 'fillet' && (CLASSES[J.arms[c.i].cls].kerb || CLASSES[J.arms[c.j].cls].kerb);
      const outer = kerbed ? CLASSES.village.kerbW + CLASSES.village.pave : 0;
      const bw = 0.9 + snow * 1.1;
      snowBand(g, cornerCurve(J, ci, outer + bw * 0.45), bw, snow, lod, hs(J.node + ci));
    });
  }

  function paint(g, rect, res) { const it = steps(g, rect, res); for (let k = 0; k < 1e6 && !it.next().done; k++); }
  /** painted-content bbox of a chunk rect (metres, clipped to rect), or null when nothing paints there */
  function bounds(rect) {
    const D = getD();
    if (!D) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (a, b, c, d) => { if (a < x0) x0 = a; if (b < y0) y0 = b; if (c > x1) x1 = c; if (d > y1) y1 = d; };
    for (const ch of D.chains) {
      const pad = outerHalf(ch.cls) + 4.5;
      if (!bboxHit(ch.bbox, rect.x0 - 3, rect.y0 - 3, rect.x1 + 3, rect.y1 + 3)) continue;
      const X0 = rect.x0 - pad, Y0 = rect.y0 - pad, X1 = rect.x1 + pad, Y1 = rect.y1 + pad;
      const P = ch.pts;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (p[0] < X0 || p[0] > X1 || p[1] < Y0 || p[1] > Y1) continue;
        grow(p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad);
      }
      if (ch.bridges.length) for (const [a, b] of ch.bridges) {
        for (const s of [a - 12, b + 12]) {
          const p = sampleAt(ch.pts, ch.cum, Math.max(0, Math.min(ch.L, s)));
          if (p.x > X0 - 12 && p.x < X1 + 12 && p.y > Y0 - 12 && p.y < Y1 + 12) grow(p.x - 14, p.y - 14, p.x + 14, p.y + 14);
        }
      }
    }
    for (const J of D.junctions) {
      const b = J.bbox;
      if (!bboxHit(b, rect.x0 - 7, rect.y0 - 7, rect.x1 + 7, rect.y1 + 7)) continue;
      grow(b.x0 - 6, b.y0 - 6, b.x1 + 6, b.y1 + 6);
    }
    x0 = Math.max(x0, rect.x0); y0 = Math.max(y0, rect.y0); x1 = Math.min(x1, rect.x1); y1 = Math.min(y1, rect.y1);
    if (!(x1 > x0 && y1 > y0)) return null;
    return { x0, y0, x1, y1 };
  }
  return { paint, steps, bounds, isEmpty: (rect) => !bounds(rect) };
}
