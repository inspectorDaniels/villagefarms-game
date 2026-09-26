// Chunked, cached, LOD terrain tiles. Painting is done by generator jobs that are
// advanced a few slices per frame (budgeted), with stale / coarser tiles or the
// whole-map overview shown as fallback meanwhile.
import { S, NO_WATER, F_LILY, F_LAKE } from './gen.js';
import { shadeRows, hash2, snowMaskAt, codeAt } from './paint.js';

const LEVELS = [2, 4, 8, 16, 32];
const WET_W = new Float32Array(12);
[[S.grass, 0.28], [S.meadow, 0.28], [S.forestFloor, 0.4], [S.soil, 0.75], [S.ploughed, 0.8], [S.mud, 0.6], [S.farmyard, 0.7], [S.sand, 0.6], [S.gravel, 0.5], [S.rock, 0.45]].forEach(([k, v]) => { WET_W[k] = v; });
const CELL = 32;               // version-cell size (m) for dirty tracking
const CACHE_CAP = 150 * 1048576;
const PREFETCH_BUDGET = 4000;  // work units per frame for the 1-tile ring around the view

function cellRng(x, y, salt) {
  let a = (hash2(x, y, salt) * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TileManager {
  constructor(ctx, T, NZ, decals, getLook) {
    this.ctx = ctx; this.art = ctx.art; this.P = ctx.palette;
    this.T = T; this.NZ = NZ; this.D = decals; this.getLook = getLook;
    this.tiles = new Map();
    this.jobs = new Map();
    this.bytes = 0;
    this.frame = 0;
    this.reset(T);
  }
  reset(T) {
    this.T = T;
    this.tiles.clear(); this.jobs.clear(); this.bytes = 0;
    this.vw = Math.ceil(T.w / CELL); this.vh = Math.ceil(T.h / CELL);
    this.cellVer = new Uint32Array(this.vw * this.vh);
    this.overview = null; this.overviewSig = null; this.overviewJob = null;
  }
  levelFor(zoom) {
    const want = zoom * Math.min(2, window.devicePixelRatio || 1) / 1.3;
    for (const L of LEVELS) if (L >= want) return L;
    return 32;
  }
  size(L) { return L >= 16 ? 32 : 512 / L; }
  markDirty(x0, y0, x1, y1) {
    const cx0 = Math.max(0, Math.floor(x0 / CELL)), cx1 = Math.min(this.vw - 1, Math.floor(x1 / CELL));
    const cy0 = Math.max(0, Math.floor(y0 / CELL)), cy1 = Math.min(this.vh - 1, Math.floor(y1 / CELL));
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) this.cellVer[y * this.vw + x]++;
    // cancel running jobs for affected tiles (they would commit stale data)
    for (const [k, j] of this.jobs) {
      const t = j.tile;
      if (t.x < x1 + 1 && t.x + t.size > x0 - 1 && t.y < y1 + 1 && t.y + t.size > y0 - 1) this.jobs.delete(k);
    }
    if (this.overview) this.patchOverview(x0, y0, x1, y1);
  }
  verOf(x, y, size) {
    const cx0 = Math.floor(x / CELL), cx1 = Math.min(this.vw - 1, Math.floor((x + size - 1) / CELL));
    const cy0 = Math.floor(y / CELL), cy1 = Math.min(this.vh - 1, Math.floor((y + size - 1) / CELL));
    let s = 0;
    for (let yy = cy0; yy <= cy1; yy++) for (let xx = cx0; xx <= cx1; xx++) s += this.cellVer[yy * this.vw + xx] * (1 + ((xx * 7 + yy * 13) & 15));
    return s;
  }

  // ------------------------------------------------------------ overview (1 px / m)
  paintOverviewSync(look) {
    const T = this.T;
    const c = this.art.canvas(T.w, T.h);
    const g = c.getContext('2d');
    const img = g.createImageData(T.w, T.h);
    shadeRows(T, look, this.NZ, img.data, T.w, 0, 0, 1, 0, T.h, false);
    g.putImageData(img, 0, 0);
    this.overview = c; this.overviewSig = look.sig;
  }
  *overviewGen(look) {
    const T = this.T;
    const c = this.art.canvas(T.w, T.h);
    const g = c.getContext('2d');
    const img = g.createImageData(T.w, T.h);
    for (let r = 0; r < T.h; r += 64) { shadeRows(T, look, this.NZ, img.data, T.w, 0, 0, 1, r, Math.min(T.h, r + 64), false); yield 64 * T.w; }
    g.putImageData(img, 0, 0);
    this.overview = c; this.overviewSig = look.sig;
  }
  patchOverview(x0, y0, x1, y1) {
    const T = this.T, look = this.getLook();
    const ax = Math.max(0, Math.floor(x0) - 2), ay = Math.max(0, Math.floor(y0) - 2);
    const bx = Math.min(T.w, Math.ceil(x1) + 3), by = Math.min(T.h, Math.ceil(y1) + 3);
    const w = bx - ax, h = by - ay;
    if (w <= 0 || h <= 0) return;
    const g = this.overview.getContext('2d');
    const img = g.createImageData(w, h);
    shadeRows(T, look, this.NZ, img.data, w, ax, ay, 1, 0, h, false);
    g.putImageData(img, ax, ay);
  }

  // ------------------------------------------------------------ tile jobs
  *tileJob(tile, look, ver) {
    const T = this.T, art = this.art, L = tile.level, M = tile.size;
    const sres = Math.min(L, 16);
    const margin = 2; // shaded margin (px at sres) → tiles sample real neighbours at their edges: no seams
    const pw = M * sres + margin * 2;
    const base = art.canvas(pw, pw);
    const bg = base.getContext('2d');
    const img = bg.createImageData(pw, pw);
    const ox = tile.x - margin / sres, oy = tile.y - margin / sres;
    const rows = Math.max(4, Math.floor(8000 / pw));
    for (let r = 0; r < pw; r += rows) {
      shadeRows(T, look, this.NZ, img.data, pw, ox, oy, sres, r, Math.min(pw, r + rows), L < 32);
      yield rows * pw;
    }
    bg.putImageData(img, 0, 0);
    let out = base;
    const k = L / sres, mo = margin * k;
    if (L > sres) {
      out = art.canvas(pw * k, pw * k);
      const og = out.getContext('2d');
      og.imageSmoothingEnabled = true;
      og.imageSmoothingQuality = 'high';
      og.drawImage(base, 0, 0, pw * k, pw * k);
      yield 20000;
    }
    const g = out.getContext('2d');
    g.setTransform(L, 0, 0, L, -tile.x * L + mo, -tile.y * L + mo);
    if (L >= 16) yield* this.decalPass(g, tile, look, L);
    if (L >= 8) yield* this.waterDecals(g, tile, look, L);
    g.setTransform(1, 0, 0, 1, 0, 0);
    let shimmer = null;
    if (L >= 4 && tile.wet) shimmer = yield* this.shimmerJob(tile, look);
    // commit
    if (tile.canvas) this.bytes -= tile.bytes;
    tile.canvas = out; tile.m = mo; tile.shimmer = shimmer; tile.sig = look.sig; tile.ver = ver;
    tile.bytes = out.width * out.height * 4 + (shimmer ? shimmer.bytes : 0);
    this.bytes += tile.bytes;
  }

  *decalPass(g, tile, look, L) {
    const T = this.T, D = this.D, W = T.w, H = T.h;
    const season = look.season;
    const dens = L >= 32 ? 1 : 0.45;
    const fl = look.flowers;
    const x0 = Math.max(0, tile.x - 1), y0 = Math.max(0, tile.y - 1);
    const x1 = Math.min(W - 2, tile.x + tile.size + 1), y1 = Math.min(H - 2, tile.y + tile.size + 1);
    const NZ = this.NZ;
    let band = false, code = 0;
    const draw = (img, x, y) => {
      if (band && codeAt(T, x, y) !== code) return; // keep decals on their side of painted edges
      const s = img.width / 32; g.drawImage(img, x - s / 2, y - s / 2, s, s);
    };
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = y * W + x;
        code = T.surface[o];
        band = !!(T.pedge[o] | T.pedge[o + 1] | T.pedge[o + W] | T.pedge[o + W + 1]);
        if (T.waterLevel[o] - T.height[o] > -0.08) continue;
        const R = cellRng(x, y, 99);
        if (look.snow > 0 && snowMaskAt(look, NZ, x + 0.5, y + 0.5, T.shade[o]) > 0.4) continue;
        const cl = NZ.v.at(x * 0.19 + 3, y * 0.19 - 7);
        const px = () => x + R(), py = () => y + R();
        switch (code) {
          case S.grass: {
            const k = Math.floor((0.5 + R() * 1.4 + Math.max(0, cl) * 1.5) * dens);
            for (let i = 0; i < k; i++) draw(D.tuft(season, (R() * 6) | 0, false), px(), py());
            if (R() < fl * 0.035 * dens * Math.max(0, cl + 0.25) * 2) draw(D.flower((R() * 6) | 0, (R() * 4) | 0), px(), py());
            if (R() < 0.07 * dens * (cl < -0.2 ? 3 : 1)) draw(D.clover(season, (R() * 5) | 0), px(), py());
            if (season === 'autumn' && R() < 0.08) draw(D.leaf(season, (R() * 6) | 0), px(), py());
            break;
          }
          case S.meadow: {
            const k = Math.floor((1 + R() * 1.6) * dens);
            for (let i = 0; i < k; i++) draw(D.tuft(season, (R() * 6) | 0, true), px(), py());
            const fk = fl * 0.22 * dens * Math.max(0, cl + 0.15) * 1.6;
            const ci = (hash2(x >> 3, y >> 3, 17) * 6) | 0; // flowers come in patches of one colour
            for (let i = 0; i < 2; i++) if (R() < fk) draw(D.flower(R() < 0.7 ? ci : (R() * 6) | 0, (R() * 4) | 0), px(), py());
            if (R() < 0.1 * dens) draw(D.clover(season, (R() * 5) | 0), px(), py());
            break;
          }
          case S.forestFloor: {
            const k = Math.floor((season === 'autumn' ? 5 : 2.5) * dens * (0.6 + R()));
            for (let i = 0; i < k; i++) draw(D.leaf(season, (R() * 6) | 0), px(), py());
            if (R() < 0.15 * dens) draw(D.twig((R() * 5) | 0), px(), py());
            if (R() < 0.18 * dens) draw(D.moss(season, (R() * 4) | 0), px(), py());
            if (R() < 0.5 * dens) draw(D.tuft(season, (R() * 6) | 0, false), px(), py());
            break;
          }
          case S.soil: {
            if (R() < 0.8 * dens) draw(D.clod((R() * 6) | 0), px(), py());
            if (R() < 0.35 * dens) draw(D.pebble('soil', (R() * 6) | 0), px(), py());
            break;
          }
          case S.ploughed: {
            const k = Math.floor((1 + R() * 2) * dens);
            for (let i = 0; i < k; i++) draw(D.clod((R() * 6) | 0), px(), py());
            break;
          }
          case S.sand: {
            if (R() < 0.45 * dens) draw(D.pebble('sand', (R() * 6) | 0), px(), py());
            if (R() < 0.12 * dens) draw(D.tuft(season, (R() * 6) | 0, false), px(), py());
            break;
          }
          case S.gravel: {
            const k = Math.floor((3 + R() * 3) * dens);
            for (let i = 0; i < k; i++) draw(D.pebble('gravel', (R() * 6) | 0), px(), py());
            break;
          }
          case S.rock: {
            if (R() < 0.55 * dens) draw(D.lichen((R() * 5) | 0), px(), py());
            if (R() < 0.2 * dens) draw(D.moss(season, (R() * 4) | 0), px(), py());
            if (R() < 0.35 * dens) draw(D.pebble('gravel', (R() * 6) | 0), px(), py());
            break;
          }
          case S.mud: {
            if (R() < 0.3 * dens) draw(D.pebble('soil', (R() * 6) | 0), px(), py());
            break;
          }
          case S.farmyard: {
            if (R() < 0.9 * dens) draw(D.pebble('gravel', (R() * 6) | 0), px(), py());
            if (R() < 0.3 * dens) draw(D.straw((R() * 4) | 0), px(), py());
            if (R() < 0.08 * dens) draw(D.tuft(season, (R() * 6) | 0, false), px(), py());
            break;
          }
          default: break;
        }
      }
      if (++n % 6 === 0) yield 6 * (x1 - x0) * 12;
    }
  }

  *waterDecals(g, tile, look, L) {
    const T = this.T, D = this.D, W = T.w;
    const season = look.season;
    const x0 = Math.max(0, tile.x - 1), y0 = Math.max(0, tile.y - 1);
    const x1 = Math.min(W - 1, tile.x + tile.size + 1), y1 = Math.min(T.h - 1, tile.y + tile.size + 1);
    const draw = (img, x, y, sc = 1) => { const s = (img.width / 32) * sc; g.drawImage(img, x - s / 2, y - s / 2, s, s); };
    if (!tile.wet) return;
    // lily pads (not in winter)
    if (season !== 'winter') {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = y * W + x;
        if (!(T.flags[o] & F_LILY)) continue;
        const R = cellRng(x, y, 4242);
        if (R() > (season === 'autumn' ? 0.35 : 0.6)) continue;
        draw(D.lily((R() * 6) | 0, season === 'summer' && R() < 0.2), x + R(), y + R(), 0.7 + R() * 0.6);
      }
      yield (x1 - x0) * (y1 - y0);
    }
    // reeds
    const B = T.reedBuckets;
    const bx0 = Math.floor(x0 / B.B), bx1 = Math.floor(x1 / B.B), by0 = Math.floor(y0 / B.B), by1 = Math.floor(y1 / B.B);
    const list = [];
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const arr = B.map.get(by * B.bw + bx);
      if (arr) for (const r of arr) if (r.x > x0 - 1 && r.x < x1 + 1 && r.y > y0 - 1 && r.y < y1 + 1) list.push(r);
    }
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const r of list) draw(D.reed(season, r.v), r.x, r.y, r.r / 0.62);
    yield list.length * 30;
  }

  *shimmerJob(tile, look) {
    const T = this.T, art = this.art, P = this.P, W = T.w;
    const res = Math.min(tile.level, 16);
    const M = tile.size, pw = M * res;
    // water mask
    const mask = art.canvas(pw, pw);
    const mg = mask.getContext('2d');
    const img = mg.createImageData(pw, pw);
    const d = img.data;
    let any = 0;
    for (let j = 0; j < pw; j++) {
      const wy = tile.y + (j + 0.5) / res;
      const fy = Math.min(T.h - 1.001, wy), iy = fy | 0, ty = fy - iy;
      for (let i = 0; i < pw; i++) {
        const wx = tile.x + (i + 0.5) / res;
        const fx = Math.min(W - 1.001, wx), ix = fx | 0, tx = fx - ix, o = iy * W + ix;
        const a00 = (1 - tx) * (1 - ty), a10 = tx * (1 - ty), a01 = (1 - tx) * ty, a11 = tx * ty;
        const h = T.height[o] * a00 + T.height[o + 1] * a10 + T.height[o + W] * a01 + T.height[o + W + 1] * a11;
        const wl = T.waterLevel[o] * a00 + T.waterLevel[o + 1] * a10 + T.waterLevel[o + W] * a01 + T.waterLevel[o + W + 1] * a11;
        const dep = wl - h;
        const a = dep <= 0.04 ? 0 : dep >= 0.3 ? 255 : ((dep - 0.04) / 0.26) * 255;
        d[(j * pw + i) * 4 + 3] = a;
        if (a) any++;
      }
      if ((j & 31) === 31) yield pw * 32 * 0.3;
    }
    if (!any) return null;
    mg.putImageData(img, 0, 0);
    const frames = [];
    for (let f = 0; f < 2; f++) {
      const c = art.canvas(pw, pw);
      const g = c.getContext('2d');
      g.setTransform(res, 0, 0, res, -tile.x * res, -tile.y * res);
      g.lineCap = 'round';
      for (let y = tile.y - 1; y < tile.y + M + 1; y++) for (let x = tile.x - 1; x < tile.x + M + 1; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= T.h - 1) continue;
        const o = y * W + x;
        const dep = T.waterLevel[o] - T.height[o];
        if (dep < 0.15) continue;
        const R = cellRng(x, y, 700 + f * 31);
        if (R() > 0.22) continue;
        let ang;
        if (T.flags[o] & F_LAKE) ang = 0.12 + (R() - 0.5) * 0.5;
        else {
          const gx = T.riverD[o + 1] - T.riverD[o - 1], gy = T.riverD[o + W] - T.riverD[o - W];
          ang = Math.atan2(gx, -gy) + (R() - 0.5) * 0.3;
        }
        const cx = x + R(), cy = y + R();
        const len = 0.3 + R() * 0.9;
        const ca = Math.cos(ang) * len / 2, sa = Math.sin(ang) * len / 2;
        const bend = (R() - 0.5) * 0.3;
        if (R() < 0.45) {
          g.strokeStyle = art.rgba(P.water.foam, 0.12 + R() * 0.22);
          g.lineWidth = 0.04 + R() * 0.05;
        } else {
          g.strokeStyle = art.rgba(P.water.deep, 0.12 + R() * 0.16);
          g.lineWidth = 0.08 + R() * 0.12;
        }
        g.beginPath();
        g.moveTo(cx - ca, cy - sa);
        g.quadraticCurveTo(cx - sa * bend * 4, cy + ca * bend * 4, cx + ca, cy + sa);
        g.stroke();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
      frames.push(c);
      yield M * M * 8;
    }
    return { frames, bytes: pw * pw * 8, phase: hash2(tile.tx, tile.ty, 5) * 6.28 };
  }

  /** 2 px/m multiply mask: soils darken most when wet, vegetation a little, water not at all */
  wetMask(tile) {
    if (tile.wetMask && tile.wetMaskVer === tile.ver) return tile.wetMask;
    const T = this.T, W = T.w, res = 2, pw = tile.size * res;
    const c = this.art.canvas(pw, pw), g = c.getContext('2d');
    const img = g.createImageData(pw, pw), d = img.data;
    for (let j = 0; j < pw; j++) for (let i = 0; i < pw; i++) {
      const x = Math.min(W - 1, Math.round(tile.x + (i + 0.5) / res)), y = Math.min(T.h - 1, Math.round(tile.y + (j + 0.5) / res));
      const o = y * W + x, code = T.surface[o];
      const wet = T.waterLevel[o] - T.height[o] > 0.05 ? 0 : WET_W[code];
      const p = (j * pw + i) * 4;
      d[p] = 132; d[p + 1] = 124; d[p + 2] = 122; d[p + 3] = wet * 255;
    }
    g.putImageData(img, 0, 0);
    tile.wetMask = c; tile.wetMaskVer = tile.ver;
    return c;
  }

  // ------------------------------------------------------------ per-frame
  tileAt(L, tx, ty) {
    const key = L + ':' + tx + ':' + ty;
    let t = this.tiles.get(key);
    if (!t) {
      const size = this.size(L);
      t = { key, level: L, tx, ty, size, x: tx * size, y: ty * size, canvas: null, shimmer: null, sig: null, ver: -1, bytes: 0, used: 0, wet: this.hasWater(tx * size, ty * size, size) };
      this.tiles.set(key, t);
    }
    return t;
  }
  hasWater(x, y, size) {
    const T = this.T, W = T.w;
    for (let yy = Math.max(0, y); yy < Math.min(T.h, y + size + 1); yy += 2) for (let xx = Math.max(0, x); xx < Math.min(W, x + size + 1); xx += 2) {
      if (T.waterLevel[yy * W + xx] > NO_WATER + 1) return true;
    }
    return false;
  }
  /** visible tile list for view at level L (+ optional margin tiles) */
  visible(view, L, margin = 0) {
    const size = this.size(L), T = this.T;
    const tx0 = Math.max(0, Math.floor(view.x0 / size) - margin), tx1 = Math.min(Math.ceil(T.w / size) - 1, Math.floor(view.x1 / size) + margin);
    const ty0 = Math.max(0, Math.floor(view.y0 / size) - margin), ty1 = Math.min(Math.ceil(T.h / size) - 1, Math.floor(view.y1 / size) + margin);
    const out = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) out.push(this.tileAt(L, tx, ty));
    return out;
  }
  fresh(t, look) { return t.canvas && t.sig === look.sig && t.ver === this.verOf(t.x, t.y, t.size); }

  /** schedule + run paint jobs; budget = Infinity to finish synchronously */
  work(view, budget) {
    const look = this.getLook();
    const L = this.levelFor(view.zoom);
    const need = this.visible(view, L, 0);
    const pre = this.visible(view, L, 1).filter((t) => !need.includes(t));
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    const dist = (t) => Math.hypot(t.x + t.size / 2 - cx, t.y + t.size / 2 - cy);
    need.sort((a, b) => dist(a) - dist(b));
    const wanted = new Set();
    const queue = [];
    let missing = 0;
    for (const t of need) {
      wanted.add(t.key);
      if (!this.fresh(t, look)) { queue.push(t); if (!t.canvas) missing++; }
    }
    // catch-up mode: visible tiles with no content at all (showing blurry fallback) get a larger budget
    if (budget !== Infinity && missing) budget *= 3;
    // prefetch the ring around the view: every frame while the camera moves, every 4th frame when idle
    const vk = view.x0.toFixed(2) + ',' + view.y0.toFixed(2) + ',' + view.zoom.toFixed(3);
    if (vk !== this.lastViewKey) { this.lastViewKey = vk; this.movedAt = this.frame; }
    const moving = this.frame - (this.movedAt || 0) < 30;
    let preLeft = budget === Infinity || (!moving && this.frame % 4) ? 0 : PREFETCH_BUDGET;
    if (budget !== Infinity) for (const t of pre) wanted.add(t.key); // keep partially painted ring jobs alive
    if (!queue.length) {
      if (preLeft) for (const t of pre) if (!this.fresh(t, look)) queue.push(t);
      budget = Math.min(budget, preLeft);
    }
    for (const k of [...this.jobs.keys()]) if (!wanted.has(k)) this.jobs.delete(k);
    let left = budget;
    for (const t of queue) {
      if (left <= 0) break;
      let j = this.jobs.get(t.key);
      if (j && j.sig !== look.sig) { this.jobs.delete(t.key); j = null; }
      if (!j) { j = { tile: t, sig: look.sig, it: this.tileJob(t, look, this.verOf(t.x, t.y, t.size)) }; this.jobs.set(t.key, j); }
      while (left > 0) {
        const r = j.it.next();
        if (r.done) { this.jobs.delete(t.key); break; }
        left -= r.value || 1000;
      }
    }
    // overview refresh (lowest priority)
    if (left > 0 && this.overviewSig !== look.sig) {
      if (!this.overviewJob || this.overviewJob.sig !== look.sig) this.overviewJob = { sig: look.sig, it: this.overviewGen(look) };
      while (left > 0) { const r = this.overviewJob.it.next(); if (r.done) { this.overviewJob = null; break; } left -= r.value; }
    }
    this.evict();
    return need;
  }

  evict() {
    if (this.bytes <= CACHE_CAP) return;
    const list = [...this.tiles.values()].filter((t) => t.canvas && t.used < this.frame - 2).sort((a, b) => a.used - b.used);
    for (const t of list) {
      if (this.bytes <= CACHE_CAP * 0.85) break;
      this.bytes -= t.bytes; t.canvas = null; t.shimmer = null; t.bytes = 0; t.sig = null;
      this.tiles.delete(t.key);
    }
  }

  /** draw ground for view; returns list of drawn tiles (for shimmer) */
  draw(g, view, need) {
    this.frame++;
    const pad = 1.2 / view.zoom;
    const drawn = [];
    // row-major order: each tile's anti-aliased leading edge lands on an already drawn neighbour (no seams)
    const order = need.slice().sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    for (const t of order) {
      t.used = this.frame;
      if (t.canvas) { g.drawImage(t.canvas, t.m, t.m, t.size * t.level, t.size * t.level, t.x, t.y, t.size + pad, t.size + pad); drawn.push(t); continue; }
      // fallback: coarser cached tile
      let done = false;
      for (let li = LEVELS.indexOf(t.level) - 1; li >= 0 && !done; li--) {
        const L2 = LEVELS[li], s2 = this.size(L2);
        const p = this.tiles.get(L2 + ':' + Math.floor(t.x / s2) + ':' + Math.floor(t.y / s2));
        if (p && p.canvas) {
          p.used = this.frame;
          const k = p.level;
          g.drawImage(p.canvas, p.m + (t.x - p.x) * k, p.m + (t.y - p.y) * k, t.size * k, t.size * k, t.x, t.y, t.size + pad, t.size + pad);
          done = true;
        }
      }
      if (!done && this.overview) {
        const sw = Math.min(t.size, this.T.w - t.x), sh = Math.min(t.size, this.T.h - t.y);
        g.drawImage(this.overview, t.x, t.y, sw, sh, t.x, t.y, sw + pad, sh + pad);
      }
    }
    return drawn;
  }
}
