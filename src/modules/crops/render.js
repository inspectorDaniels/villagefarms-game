// crops — rendering: per-field world-aligned 32 m chunk canvases at LOD 4/8/16/32 px/m, painted from
// cell tiles and repainted per dirty cell (clip to the cell squares). Tall-crop edge shadows,
// wind sheen, snow veil and round bales.
import { S, CROPS, CROP_IDS, stageOf } from './data.js';

const CH = 32;                 // chunk size, metres
const LEVELS = [4, 8, 16, 32]; // px per metre
const MAX_BYTES = 160 * 1048576;

export function createRenderer(ctx, model, tiles) {
  const { art } = ctx;
  const entries = new Map(); // key → { canvas, res, built, dirty:Set, used, f, ch }
  let bytes = 0, frame = 0;
  const pool = [];
  const stats = { builds: 0, cellPaints: 0, lastCellPaints: 0 };
  const env = () => ctx.world.environment || {};
  const season = () => ctx.clock.season;
  let lastSeason = null;

  // ------------------------------------------------------------ chunk bookkeeping
  function chunkRange(f, k) {
    const [x, y] = model.cellCenter(f, k);
    const r = f.grid.cell * 0.75 + 0.05;
    return [Math.floor((x - r) / CH), Math.floor((y - r) / CH), Math.floor((x + r) / CH), Math.floor((y + r) / CH)];
  }
  function onField(f, change) {
    if (change === 'remove') {
      for (const [key, e] of [...entries]) if (e.f === f) dropEntry(key, e);
      return;
    }
    const chunks = new Map();
    const st = f.cells.state;
    for (let k = 0; k < st.length; k++) {
      if (!st[k]) continue;
      const [a, b, c, d] = chunkRange(f, k);
      for (let cx = a; cx <= c; cx++) for (let cy = b; cy <= d; cy++) {
        const key = cx + ',' + cy;
        let ch = chunks.get(key);
        if (!ch) { ch = { cx, cy, list: [] }; chunks.set(key, ch); }
        ch.list.push(k);
      }
    }
    for (const ch of chunks.values()) ch.cells = Int32Array.from(ch.list), delete ch.list;
    f.rs = { chunks, shadowV: -1, shadowAt: -99, segs: [], tall: 0, headland: null };
    f.rs.headland = insetPoly(f.poly, 3.4);
  }
  function onDirty(f, k) {
    if (!f.rs) return;
    const [a, b, c, d] = chunkRange(f, k);
    for (let cx = a; cx <= c; cx++) for (let cy = b; cy <= d; cy++) {
      for (const res of LEVELS) {
        const e = entries.get(f.id + '|' + res + '|' + cx + ',' + cy);
        if (e && e.built) e.dirty.add(k);
      }
    }
  }
  function dropEntry(key, e) {
    entries.delete(key);
    if (e.canvas) { bytes -= e.canvas.width * e.canvas.height * 4; if (pool.length < 10) pool.push(e.canvas); }
  }
  function evict() {
    if (bytes <= MAX_BYTES) return;
    const list = [...entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of list) { if (bytes <= MAX_BYTES * 0.8) break; if (e.used < frame) dropEntry(k, e); }
  }
  function invalidateAll() { for (const [k, e] of [...entries]) dropEntry(k, e); }

  // ------------------------------------------------------------ painting
  function tileFor(f, k, seasonName) {
    const c = f.cells;
    const s = c.state[k];
    const G = f.grid;
    const i = k % G.nu, j = (k / G.nu) | 0;
    const cropId = model.cropOf(c.crop[k]);
    let stage = 0;
    if (s === S.SOWN) {
      stage = stageOf(cropId, c.growth[k]);
      const C = CROPS[cropId];
      if (stage === 4 && C.podsAt && c.growth[k] >= C.podsAt) stage = 6;
    }
    const lying = c.mass[k] > 1;
    const bout = Math.max(3, Math.round(6 / G.cell)); // swath every ~6 m (header width); tramline every 12 m
    return tiles.get({
      state: s, crop: cropId, stage, weedy: c.weeds[k] > 0.45, lying,
      swath: s === S.WINDROW ? j % (bout + 1) === 1 : s === S.STUBBLE ? j % bout === 1 : true,
      tram: (s === S.SOWN || s === S.RIPE) && j % (bout * 2) === bout,
      season: seasonName, v: ((i * 7 + j * 13) ^ (i >> 2)) % 3,
    });
  }
  function drawCell(g, f, k, res, x0, y0, scale, seasonName) {
    const [cx, cy] = model.cellCenter(f, k);
    const a = f.angle, co = Math.cos(a) * res, si = Math.sin(a) * res;
    g.setTransform(co, si, -si, co, (cx - x0) * res, (cy - y0) * res);
    const s = f.grid.cell * scale + 0.08;
    g.drawImage(tileFor(f, k, seasonName), -s / 2, -s / 2, s, s);
    stats.cellPaints++;
  }
  function polyPath(g, pts) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
  }
  function squarePath(g, f, k, scale) {
    const [cx, cy] = model.cellCenter(f, k);
    const h = (f.grid.cell * scale) / 2 + 0.06, G = f.grid;
    const ux = G.ux * h, uy = G.uy * h, vx = G.vx * h, vy = G.vy * h;
    g.moveTo(cx - ux - vx, cy - uy - vy); g.lineTo(cx + ux - vx, cy + uy - vy);
    g.lineTo(cx + ux + vx, cy + uy + vy); g.lineTo(cx - ux + vx, cy - uy + vy); g.closePath();
  }

  /** paint a chunk fully (cells = null) or only the given dirty cells */
  function paintChunk(e, dirty) {
    const f = e.f, ch = e.ch, res = e.res, g = e.g;
    const x0 = ch.cx * CH, y0 = ch.cy * CH;
    const seasonName = season();
    const c = f.cells;
    g.save();
    g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
    polyPath(g, f.poly);
    g.clip();
    let list;
    if (dirty) {
      // clip to the dirty squares (edge cells: the 2× underlay square), clear, repaint them + neighbours inside the clip
      g.beginPath();
      const set = new Set();
      const G = f.grid;
      for (const k of dirty) {
        squarePath(g, f, k, c.edge[k] ? 2.2 : 1);
        const i = k % G.nu, j = (k / G.nu) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv) continue;
          const kk = jj * G.nu + ii;
          if (c.state[kk]) set.add(kk);
        }
      }
      g.clip();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, e.canvas.width, e.canvas.height);
      list = [...set];
    } else {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, e.canvas.width, e.canvas.height);
      list = ch.cells;
    }
    // pass 1: enlarged underlay for edge cells (fills the staircase gaps up to the polygon)
    for (const k of list) if (c.edge[k]) drawCell(g, f, k, res, x0, y0, 2.4, seasonName);
    // pass 2: the cells
    for (const k of list) drawCell(g, f, k, res, x0, y0, 1, seasonName);
    // pass 3: headland wheel tracks + grass margin along the boundary
    g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
    const worked = f.counts[S.SOWN] + f.counts[S.RIPE] + f.counts[S.CULTIVATED] + f.counts[S.PLOUGHED];
    if (f.rs.headland && worked > f.nCells * 0.5) {
      g.strokeStyle = 'rgba(58,42,28,0.22)'; g.lineWidth = 0.4;
      for (const inset of [0, 1.8]) { const p = inset ? insetPoly(f.poly, 3.4 + inset) : f.rs.headland; if (p) { polyPath(g, p); g.stroke(); } }
    }
    polyPath(g, f.poly);
    g.strokeStyle = 'rgba(40,46,30,0.28)'; g.lineWidth = 2.7; g.stroke();
    const pat = g.createPattern(tiles.marginTile(seasonName), 'repeat');
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scaleSelf(1 / art.PPM, 1 / art.PPM));
    g.strokeStyle = pat; g.lineWidth = 2.1; g.stroke();
    g.restore();
  }
  function ensure(f, ch, res) {
    const key = f.id + '|' + res + '|' + ch.cx + ',' + ch.cy;
    let e = entries.get(key);
    if (!e) {
      const px = CH * res;
      let canvas = pool.pop();
      if (!canvas || canvas.width !== px) { canvas = document.createElement('canvas'); canvas.width = px; canvas.height = px; }
      e = { canvas, g: canvas.getContext('2d'), res, built: false, dirty: new Set(), used: frame, f, ch };
      entries.set(key, e);
      bytes += px * px * 4;
    }
    e.used = frame;
    return e;
  }

  // ------------------------------------------------------------ frame
  function pickRes(pxPerM) {
    for (const r of LEVELS) if (r >= pxPerM * 0.8) return r;
    return LEVELS[LEVELS.length - 1];
  }
  const inView = (b, v, pad = 0) => !(b.x1 < v.x0 - pad || b.x0 > v.x1 + pad || b.y1 < v.y0 - pad || b.y0 > v.y1 + pad);

  function drawGround(g, view, budgetCells = 2200) {
    frame++;
    const sn = season();
    if (lastSeason && sn !== lastSeason) invalidateAll(); // grass/margins are seasonal
    lastSeason = sn;
    const m = g.getTransform();
    const res = pickRes(m.a);
    let budget = budgetCells;
    stats.lastCellPaints = stats.cellPaints;
    const X = (x) => Math.round(m.a * x + m.e), Y = (y) => Math.round(m.d * y + m.f);
    const blits = [];
    for (const f of model.W.fields) {
      if (!f.rs || !inView(f.bbox, view)) continue;
      for (const ch of f.rs.chunks.values()) {
        const x0 = ch.cx * CH, y0 = ch.cy * CH;
        if (x0 > view.x1 || x0 + CH < view.x0 || y0 > view.y1 || y0 + CH < view.y0) continue;
        const e = ensure(f, ch, res);
        if (!e.built) {
          if (budget > 0) { paintChunk(e, null); e.built = true; e.dirty.clear(); budget -= ch.cells.length * 1.3; stats.builds++; }
        } else if (e.dirty.size > ch.cells.length * 0.4 && budget > 0) {
          paintChunk(e, null); e.dirty.clear(); budget -= ch.cells.length * 1.3; stats.builds++;
        } else if (e.dirty.size && budget > 0) {
          const d = [...e.dirty];
          const take = d.length * 9 > budget ? d.slice(0, Math.max(1, Math.floor(budget / 9))) : d;
          paintChunk(e, take);
          for (const k of take) e.dirty.delete(k);
          budget -= take.length * 9;
        }
        let src = e.built ? e : null;
        if (!src) for (const r of LEVELS) { const o = entries.get(f.id + '|' + r + '|' + ch.cx + ',' + ch.cy); if (o && o.built) { src = o; o.used = frame; break; } }
        if (src) blits.push([src.canvas, X(x0), Y(y0), X(x0 + CH) - X(x0), Y(y0 + CH) - Y(y0)]);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    for (const b of blits) g.drawImage(b[0], b[1], b[2], b[3], b[4]);
    g.setTransform(m);
    stats.lastCellPaints = stats.cellPaints - stats.lastCellPaints;
    // snow veil (fields have no terrain snow of their own)
    const W = env().weather;
    const snow = W ? (W.snowLevel != null ? W.snowLevel : W.snowCover || 0) : 0;
    if (snow > 0.04) {
      const pat = g.createPattern(tiles.snowTile(), 'repeat');
      if (pat.setTransform) pat.setTransform(new DOMMatrix().scaleSelf(1 / art.PPM * 2, 1 / art.PPM * 2));
      g.fillStyle = pat;
      for (const f of model.W.fields) {
        if (!inView(f.bbox, view)) continue;
        const tall = f.crop && CROPS[f.crop].height * f.growth > 0.8 ? 0.55 : 1;
        g.globalAlpha = Math.min(0.92, snow * 1.1) * tall;
        polyPath(g, f.poly); g.fill();
      }
      g.globalAlpha = 1;
    }
    evict();
  }

  // wind: soft light gusts travelling across tall, flexible crops (close zoom only)
  function drawSway(g, view) {
    if (view.zoom < 10) return;
    const envApi = ctx.modules.get('environment');
    const W = env().weather;
    const sheen = tiles.sheen();
    const t = view.time || 0;
    for (const f of model.W.fields) {
      if (!f.crop || !inView(f.bbox, view)) continue;
      const C = CROPS[f.crop];
      if (!(C.kind === 'cereal' || C.kind === 'oilseed' || C.kind === 'grass') || f.growth < 0.5) continue;
      if (f.counts[S.SOWN] + f.counts[S.RIPE] < f.nCells * 0.3) continue;
      const cx = (f.bbox.x0 + f.bbox.x1) / 2, cy = (f.bbox.y0 + f.bbox.y1) / 2;
      const w = (envApi && envApi.windAt(Math.min(Math.max(cx, view.x0), view.x1), Math.min(Math.max(cy, view.y0), view.y1))) || (W && W.wind) || { x: 1.5, y: -1, speed: 1.8 };
      const sp = Math.max(0.4, w.speed || Math.hypot(w.x, w.y));
      const dx = w.x / sp, dy = w.y / sp;
      const ang = Math.atan2(dy, dx);
      const gap = 10, lane = 6.5;
      const phase = (t * (0.9 + sp * 0.45)) % gap;
      g.save();
      polyPath(g, f.poly); g.clip();
      const x0 = Math.max(view.x0, f.bbox.x0) - gap, x1 = Math.min(view.x1, f.bbox.x1) + gap;
      const y0 = Math.max(view.y0, f.bbox.y0) - gap, y1 = Math.min(view.y1, f.bbox.y1) + gap;
      const a = Math.min(0.22, 0.05 + sp * 0.025) * (C.kind === 'grass' ? 0.7 : 1);
      // lattice in wind space
      const pc = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x * dx + y * dy, -x * dy + y * dx]);
      const a0 = Math.min(...pc.map((p) => p[0])), a1 = Math.max(...pc.map((p) => p[0]));
      const b0 = Math.min(...pc.map((p) => p[1])), b1 = Math.max(...pc.map((p) => p[1]));
      let n = 0;
      for (let b = Math.floor(b0 / lane) * lane; b <= b1 && n < 260; b += lane) {
        const off = ((b / lane) * 3.7) % gap;
        for (let s = Math.floor(a0 / gap) * gap + phase + off; s <= a1; s += gap) {
          const x = s * dx - b * dy, y = s * dy + b * dx;
          const gust = 0.6 + 0.4 * Math.sin(b * 0.37 + s * 0.11);
          g.globalAlpha = a * gust;
          art.draw(g, sheen, x, y, 7.5, 2.6, ang + Math.PI / 2);
          n++;
        }
      }
      g.restore();
    }
  }

  // ------------------------------------------------------------ shadows (tall crop edges) + bales
  function heightOf(c, k) {
    const s = c.state[k];
    if (s !== S.SOWN && s !== S.RIPE && s !== S.WITHERED) return 0;
    const C = CROPS[CROP_IDS[c.crop[k] - 1]];
    if (!C) return 0;
    const g = s === S.WITHERED ? 0.6 : Math.min(1, c.growth[k] * 1.25);
    return C.height * g * (s === S.WITHERED ? 0.5 : 1);
  }
  function buildShadowSegs(f) {
    const c = f.cells, G = f.grid;
    const segs = [];
    const q = (h) => Math.round(h * 5) / 5;
    const hs = new Float32Array(c.state.length);
    for (let k = 0; k < hs.length; k++) hs[k] = q(heightOf(c, k));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nu; i++) {
      const k = j * G.nu + i;
      const h = hs[k];
      if (h < 0.4) continue;
      for (const [di, dj] of dirs) {
        const ii = i + di, jj = j + dj;
        const hn = ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv ? 0 : hs[jj * G.nu + ii];
        if (h - hn < 0.35) continue;
        // edge of the cell square facing (di,dj), outward normal in world space
        const [cx, cy] = model.cellCenter(f, k);
        const hc = G.cell / 2;
        const nx = G.ux * di + G.vx * dj, ny = G.uy * di + G.vy * dj;
        const tx = -ny, ty = nx;
        const mx = cx + nx * hc, my = cy + ny * hc;
        segs.push({ x0: mx - tx * hc, y0: my - ty * hc, x1: mx + tx * hc, y1: my + ty * hc, nx, ny, h: h - hn });
      }
    }
    return segs;
  }
  function collect(view, F) {
    const sun = env().sun;
    const sdx = sun ? sun.dirX : 0, sdy = sun ? sun.dirY : -1;
    for (const f of model.W.fields) {
      if (!f.rs || !inView(f.bbox, view, 20)) continue;
      if (f.rs.shadowV !== f.version && frame - f.rs.shadowAt > 20) { f.rs.segs = buildShadowSegs(f); f.rs.shadowV = f.version; f.rs.shadowAt = frame; }
      for (const s of f.rs.segs) {
        if (s.nx * sdx + s.ny * sdy < 0.05) continue;
        if (Math.max(s.x0, s.x1) < view.x0 - 20 || Math.min(s.x0, s.x1) > view.x1 + 20 || Math.max(s.y0, s.y1) < view.y0 - 20 || Math.min(s.y0, s.y1) > view.y1 + 20) continue;
        F.shadow.wall(s.x0, s.y0, s.x1, s.y1, s.h, 0.12);
      }
    }
    for (const b of model.W.bales) {
      if (b.x < view.x0 - 2 || b.x > view.x1 + 2 || b.y < view.y0 - 2 || b.y > view.y1 + 2) continue;
      const img = tiles.bale(b.item);
      F.shadow.box(b.x, b.y, 1.2, 1.5, b.rot, 1.45);
      F.object({ y: b.y + 0.7, draw(g) {
        art.draw(g, img, b.x, b.y, 1.25, 1.55, b.rot);
      } });
    }
  }

  function prewarm(view) { // build everything visible now (showcase)
    const g = { getTransform: () => ({ a: view.zoom * (view.dpr || 1), d: view.zoom * (view.dpr || 1), e: 0, f: 0 }) };
    const res = pickRes(g.getTransform().a);
    for (const f of model.W.fields) {
      if (!f.rs || !inView(f.bbox, view)) continue;
      for (const ch of f.rs.chunks.values()) {
        const x0 = ch.cx * CH, y0 = ch.cy * CH;
        if (x0 > view.x1 || x0 + CH < view.x0 || y0 > view.y1 || y0 + CH < view.y0) continue;
        const e = ensure(f, ch, res);
        if (!e.built) { paintChunk(e, null); e.built = true; e.dirty.clear(); }
      }
    }
  }

  return { onField, onDirty, drawGround, drawSway, collect, prewarm, invalidateAll, stats, entries: () => entries.size, bytes: () => bytes };
}

/** inset a simple polygon by d metres (edge offset + intersection; fine for the convex-ish field shapes) */
export function insetPoly(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const sgn = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = (-(q[1] - p[1]) / L) * sgn, ny = ((q[0] - p[0]) / L) * sgn; // inward for this winding
    lines.push([p[0] + nx * d, p[1] + ny * d, q[0] - p[0], q[1] - p[1]]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const den = a[2] * b[3] - a[3] * b[2];
    if (Math.abs(den) < 1e-9) { out.push([b[0], b[1]]); continue; }
    const t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / den;
    out.push([a[0] + a[2] * t, a[1] + a[3] * t]);
  }
  // reject if it flipped (field too small)
  let a2 = 0;
  for (let i = 0; i < n; i++) { const p = out[i], q = out[(i + 1) % n]; a2 += p[0] * q[1] - q[0] * p[1]; }
  return Math.sign(a2) === Math.sign(area) && Math.abs(a2) > 1 ? out : null;
}
