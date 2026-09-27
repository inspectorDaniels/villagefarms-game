// crops — rendering: per-field world-aligned 32 m chunk canvases at LOD 4/8/16/32 px/m, painted from
// cell tiles and repainted per dirty cell (clip to the cell squares). Tall-crop edge shadows,
// wind sheen, snow veil and round bales.
import { S, CROPS, CROP_IDS, stageOf } from './data.js';

const MARGIN = 0;               // composite layer margin (px). Must stay 0: any layer larger than the screen blits on a slow path (≈ 8 ms headless)
const CPX = 256;               // chunk canvas size in px (≤ 256 px canvases blit far cheaper); metres = CPX / res
const LEVELS = [4, 8, 16, 32]; // px per metre
const MAX_BYTES = 160 * 1048576;

export function createRenderer(ctx, model, tiles) {
  const { art } = ctx;
  const entries = new Map(); // key → { canvas, res, built, dirty:Set, used, f, ch }
  let bytes = 0, frame = 0;
  // screen composite (double-buffered): shifted by whole pixels while panning, only exposed strips / changed chunks redrawn
  let comp = null, compG = null, back = null, backG = null, prev = null, compO = null, lastM = null; // prev = { a, E, F, chunks: Map key → paintV|rect }
  const pool = [];
  const stats = { builds: 0, cellPaints: 0, lastCellPaints: 0, composites: 0, partialBlits: 0 };
  const env = () => ctx.world.environment || {};
  const season = () => ctx.clock.season;
  let lastSeason = null;

  // ------------------------------------------------------------ chunk bookkeeping
  function chunkRange(f, k, CH) {
    const [x, y] = model.cellCenter(f, k);
    const r = f.grid.cell * 0.75 + 0.05;
    return [Math.floor((x - r) / CH), Math.floor((y - r) / CH), Math.floor((x + r) / CH), Math.floor((y + r) / CH)];
  }
  /** chunk set of a field for one LOD level (built lazily) */
  function chunksOf(f, res) {
    let chunks = f.rs.sets.get(res);
    if (chunks) return chunks;
    const CH = CPX / res;
    chunks = new Map();
    const st = f.cells.state;
    for (let k = 0; k < st.length; k++) {
      if (!st[k]) continue;
      const [a, b, c, d] = chunkRange(f, k, CH);
      for (let cx = a; cx <= c; cx++) for (let cy = b; cy <= d; cy++) {
        const key = cx + ',' + cy;
        let ch = chunks.get(key);
        if (!ch) { ch = { cx, cy, size: CH, list: [] }; chunks.set(key, ch); }
        ch.list.push(k);
      }
    }
    for (const ch of chunks.values()) { ch.cells = Int32Array.from(ch.list); delete ch.list; }
    f.rs.sets.set(res, chunks);
    return chunks;
  }
  function onField(f, change) {
    if (change === 'remove') {
      for (const [key, e] of [...entries]) if (e.f === f) dropEntry(key, e);
      return;
    }
    f.rs = { sets: new Map(), shadowV: -1, shadowAt: -99, segs: [], edgePath: null };
  }
  function onDirty(f, k) {
    if (!f.rs) return;
    for (const res of f.rs.sets.keys()) {
      const [a, b, c, d] = chunkRange(f, k, CPX / res);
      for (let cx = a; cx <= c; cx++) for (let cy = b; cy <= d; cy++) {
        const e = entries.get(f.id + '|' + res + '|' + cx + ',' + cy);
        if (e && e.built) e.dirty.add(k);
      }
    }
  }
  function dropEntry(key, e) {
    entries.delete(key);
    if (e.bmp && e.bmp.close) e.bmp.close();
    e.bmp = null; e.paintV = -1;
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
    e.paintV = (e.paintV || 0) + 1;
    const f = e.f, ch = e.ch, res = e.res, g = e.g;
    const x0 = ch.cx * ch.size, y0 = ch.cy * ch.size;
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
    // pass 3: ragged, feathered field edge — erase the outer ~1 m so the terrain verge shows through
    g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
    g.globalCompositeOperation = 'destination-out';
    const ep = f.rs.edgePath || (f.rs.edgePath = raggedPath(f.poly, f.id));
    for (const [w, a] of [[1.5, 1], [2.3, 0.45], [3.1, 0.2]]) { g.globalAlpha = a; g.lineWidth = w; g.stroke(ep); }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }
  function ensure(f, ch, res) {
    const key = f.id + '|' + res + '|' + ch.cx + ',' + ch.cy;
    let e = entries.get(key);
    if (!e) {
      const px = CPX;
      let canvas = pool.pop();
      if (!canvas || canvas.width !== px) { canvas = document.createElement('canvas'); canvas.width = px; canvas.height = px; }
      e = { key, canvas, g: canvas.getContext('2d'), res,
      built: false, dirty: new Set(), used: frame, f, ch };
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
    // while the camera moves, paint less per frame (the shifted composite hides nothing; new strips fill in)
    const moving = lastM && (lastM.a !== m.a || lastM.e !== m.e || lastM.f !== m.f);
    lastM = { a: m.a, e: m.e, f: m.f };
    let budget = moving ? Math.min(budgetCells, 450) : budgetCells;
    stats.lastCellPaints = stats.cellPaints;
    // The chunks are composited into one layer that is larger than the screen by a margin (MARGIN px each
    // side). While panning the layer is just drawn at an offset; only when the offset exceeds the margin is it
    // re-centred (an integer shift + the newly exposed strips). Origins are snapped to whole device pixels.
    const E = Math.round(m.e), Fo = Math.round(m.f);
    const cw = g.canvas.width + 2 * MARGIN, chh = g.canvas.height + 2 * MARGIN;
    if (!compO || compO.a !== m.a || Math.abs(E - compO.E) > MARGIN * 0.7 || Math.abs(Fo - compO.F) > MARGIN * 0.7) compO = { a: m.a, E, F: Fo };
    const cE = compO.E, cF = compO.F;
    const X = (x) => Math.round(m.a * x) + cE + MARGIN, Y = (y) => Math.round(m.d * y) + cF + MARGIN;
    // comp-space rect in metres (what the layer can hold), plus the visible rect for build priority
    const ext = { x0: (-cE - MARGIN) / m.a, y0: (-cF - MARGIN) / m.d, x1: (cw - cE - MARGIN) / m.a, y1: (chh - cF - MARGIN) / m.d };
    const blits = [];
    const pending = [];
    for (const f of model.W.fields) {
      if (!f.rs || !inView(f.bbox, ext)) continue;
      for (const ch of chunksOf(f, res).values()) {
        const CH = ch.size, x0 = ch.cx * CH, y0 = ch.cy * CH;
        if (x0 > ext.x1 || x0 + CH < ext.x0 || y0 > ext.y1 || y0 + CH < ext.y0) continue;
        const e = ensure(f, ch, res);
        const visible = !(x0 > view.x1 || x0 + CH < view.x0 || y0 > view.y1 || y0 + CH < view.y0);
        if (!e.built || e.dirty.size) pending.push([visible ? 0 : 1, e, ch]);
        blits.push([e, x0, y0, CH]);
      }
    }
    pending.sort((p, q) => p[0] - q[0]);        // visible chunks first, the margin (prefetch) after
    for (const [, e, ch] of pending) {
      if (budget <= 0) break;
      if (!e.built || e.dirty.size > ch.cells.length * 0.4) { paintChunk(e, null); e.built = true; e.dirty.clear(); budget -= ch.cells.length * 1.3; stats.builds++; }
      else {
        const d = [...e.dirty];
        const take = d.length * 9 > budget ? d.slice(0, Math.max(1, Math.floor(budget / 9))) : d;
        paintChunk(e, take);
        for (const k of take) e.dirty.delete(k);
        budget -= take.length * 9;
      }
    }
    const list = [];
    for (const [e, x0, y0, CH] of blits) if (e.built) list.push([e.canvas, X(x0), Y(y0), X(x0 + CH) - X(x0), Y(y0 + CH) - Y(y0), e.key, e.paintV]);
    composite(cw, chh, list, m.a, cE, cF);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (list.length) { // blit only the on-screen part (a source rect, 1:1): whole-layer blits hit a slow path
      const sx = cE + MARGIN - E, sy = cF + MARGIN - Fo, w = g.canvas.width, h = g.canvas.height;
      g.drawImage(comp, sx, sy, w, h, 0, 0, w, h);
    }
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
        if (pat.setTransform) pat.setTransform(new DOMMatrix().rotateSelf(f.angle * 180 / Math.PI + 7).scaleSelf(4.5 / art.PPM, 4.5 / art.PPM));
        const tall = f.crop && CROPS[f.crop].height * f.growth > 0.8 ? 0.55 : 1;
        g.globalAlpha = Math.min(0.85, snow * 0.95) * tall;
        polyPath(g, f.poly); g.fill();
      }
      g.globalAlpha = 1;
    }
    evict();
  }

  function composite(cw, chh, blits, a, E, F) {
    if (!comp || comp.width !== cw || comp.height !== chh) {
      comp = document.createElement('canvas'); comp.width = cw; comp.height = chh; compG = comp.getContext('2d');
      back = document.createElement('canvas'); back.width = cw; back.height = chh; backG = back.getContext('2d');
      prev = null;
    }
    const cur = new Map();
    for (const b of blits) cur.set(b[5], b);
    let rects = null; // null = full redraw
    if (prev && prev.a === a) {
      const dx = E - prev.E, dy = F - prev.F;
      if (Math.abs(dx) < cw && Math.abs(dy) < chh) {
        rects = [];
        // exposed strips
        if (dx > 0) rects.push([0, 0, dx, chh]); else if (dx < 0) rects.push([cw + dx, 0, -dx, chh]);
        if (dy > 0) rects.push([0, 0, cw, dy]); else if (dy < 0) rects.push([0, chh + dy, cw, -dy]);
        // chunks repainted, appeared or gone since the last composite
        for (const [k, b] of cur) { const p = prev.chunks.get(k); if (!p || p[6] !== b[6]) rects.push([b[1], b[2], b[3], b[4]]); }
        for (const [k, p] of prev.chunks) if (!cur.has(k)) rects.push([p[1] + dx, p[2] + dy, p[3], p[4]]);
        if (dx || dy) { // shift: previous composite → back buffer at the pan offset, then swap (faster than a self-copy)
          backG.setTransform(1, 0, 0, 1, 0, 0);
          backG.clearRect(0, 0, cw, chh);
          backG.drawImage(comp, dx, dy);
          const t = comp; comp = back; back = t; const tg = compG; compG = backG; backG = tg;
        }
      }
    }
    compG.setTransform(1, 0, 0, 1, 0, 0);
    compG.imageSmoothingEnabled = true;
    if (!rects) {
      compG.clearRect(0, 0, cw, chh);
      for (const b of blits) compG.drawImage(b[0], b[1], b[2], b[3], b[4]);
      stats.composites++;
    } else if (rects.length) {
      compG.save();
      compG.beginPath();
      for (const r of rects) compG.rect(r[0], r[1], r[2], r[3]);
      compG.clip();
      for (const r of rects) compG.clearRect(r[0], r[1], r[2], r[3]);
      for (const b of blits) {
        let hit = false;
        for (const r of rects) if (b[1] < r[0] + r[2] && b[1] + b[3] > r[0] && b[2] < r[1] + r[3] && b[2] + b[4] > r[1]) { hit = true; break; }
        if (hit) { compG.drawImage(b[0], b[1], b[2], b[3], b[4]); stats.partialBlits++; }
      }
      compG.restore();
    }
    prev = { a, E, F, chunks: cur };
  }

  // wind: soft light gusts travelling across tall, flexible crops (close zoom only)
  function drawSway(g, view) {
    if (view.zoom < 10) return;
    const envApi = ctx.modules.get('environment');
    const W = env().weather;
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
      const a = Math.min(0.26, 0.07 + sp * 0.03) * (C.kind === 'grass' ? 0.7 : 1);
      // one pattern fill per field: a toroidal 48 m sheet of soft gust highlights drifting downwind
      const pat = g.createPattern(tiles.gustSheet(), 'repeat');
      const drift = t * (0.9 + sp * 0.45);
      const M = new DOMMatrix().rotateSelf(ang * 180 / Math.PI).translateSelf(drift, 0).scaleSelf(48 / 192, 48 / 192);
      if (pat.setTransform) pat.setTransform(M);
      g.save();
      polyPath(g, f.poly); g.clip();
      g.globalAlpha = a;
      g.fillStyle = pat;
      g.fillRect(Math.max(view.x0, f.bbox.x0), Math.max(view.y0, f.bbox.y0), Math.min(view.x1, f.bbox.x1) - Math.max(view.x0, f.bbox.x0), Math.min(view.y1, f.bbox.y1) - Math.max(view.y0, f.bbox.y0));
      g.globalAlpha = 1;
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
    const H = (i, j) => (i < 0 || j < 0 || i >= G.nu || j >= G.nv ? 0 : hs[j * G.nu + i]);
    const hc = G.cell / 2;
    // merge runs of equal edge height along each grid line → few long walls instead of one per cell
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const alongJ = di !== 0;              // edge lines run along v for ±u normals
      const nOuter = alongJ ? G.nu : G.nv, nInner = alongJ ? G.nv : G.nu;
      const nx = G.ux * di + G.vx * dj, ny = G.uy * di + G.vy * dj;
      for (let o = 0; o < nOuter; o++) {
        let start = -1, cur = 0;
        for (let t = 0; t <= nInner; t++) {
          let d = 0;
          if (t < nInner) {
            const i = alongJ ? o : t, j = alongJ ? t : o;
            const h = H(i, j);
            if (h >= 0.4) {
              const ii = i + di, jj = j + dj;
              const outer = ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv || !c.state[jj * G.nu + ii];
              const dh = h - H(ii, jj); d = dh >= 0.35 ? dh + (outer ? 1000 : 0) : 0;
            }
          }
          if (d !== cur) {
            if (cur > 0 && !(cur >= 1000 && t - start < 3)) { // short outer runs are staircase steps of the grid → no wall
              const i0 = alongJ ? o : start, j0 = alongJ ? start : o, i1 = alongJ ? o : t - 1, j1 = alongJ ? t - 1 : o;
              const k0 = j0 * G.nu + i0, k1 = j1 * G.nu + i1;
              const [ax, ay] = model.cellCenter(f, k0), [bx, by] = model.cellCenter(f, k1);
              const tx = alongJ ? G.vx : G.ux, ty = alongJ ? G.vy : G.uy;
              // the visible crop stops ~1 m inside the field polygon (feathered verge): pull outer walls in
              const off = cur >= 1000 ? hc - 1.0 : hc, hh = cur >= 1000 ? cur - 1000 : cur;
              segs.push({ x0: ax + nx * off - tx * hc, y0: ay + ny * off - ty * hc, x1: bx + nx * off + tx * hc, y1: by + ny * off + ty * hc, nx, ny, h: hh });
            }
            cur = d; start = t;
          }
        }
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
      for (const ch of chunksOf(f, res).values()) {
        const CH = ch.size, x0 = ch.cx * CH, y0 = ch.cy * CH;
        if (x0 > view.x1 || x0 + CH < view.x0 || y0 > view.y1 || y0 + CH < view.y0) continue;
        const e = ensure(f, ch, res);
        if (!e.built) { paintChunk(e, null); e.built = true; e.dirty.clear(); }
      }
    }
  }

  return { onField, onDirty, drawGround, drawSway, collect, prewarm, invalidateAll, stats, entries: () => entries.size, bytes: () => bytes };
}

/** inset a simple polygon by d metres (edge offset + intersection; fine for the convex-ish field shapes) */
/** closed Path2D along the polygon with a small deterministic wobble (hand-cut field edge) */
function raggedPath(poly, id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const p = new Path2D();
  const n = poly.length;
  let first = true;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
    const steps = Math.max(2, Math.round(L / 1.5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const w = Math.sin((t * L) * 0.9 + h * 0.001 + i) * 0.18 + Math.sin((t * L) * 2.7 + h * 0.003) * 0.1;
      const x = a[0] + (b[0] - a[0]) * t + nx * w, y = a[1] + (b[1] - a[1]) * t + ny * w;
      if (first) { p.moveTo(x, y); first = false; } else p.lineTo(x, y);
    }
  }
  p.closePath();
  return p;
}

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
