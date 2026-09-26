// terrain — heightmap, surfaces, river + lakes, chunked LOD painted ground, water shimmer.
import { generateData, SURFACES, S, NO_WATER, flattenCircle, computeShade, reclassify, computeUniform } from './gen.js';
import { makeLook, makeDecals, warmShader, opSD, codeAt } from './paint.js';
import { TileManager } from './tiles.js';

export const manifest = {
  id: 'terrain',
  wave: 1,
  deps: [],
  optionalDeps: ['environment'],
  namespaces: ['terrain'],
  api: ['generate', 'heightAt', 'slopeAt', 'surfaceAt', 'isWater', 'waterDepthAt', 'moistureAt', 'paintSurface', 'flatten',
    'riverPaths', 'lakes', 'findDry', 'minimap', 'surfaceTypes'],
  emits: ['terrain:generated', 'terrain:changed'],
  listens: [],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export async function init(ctx) {
  const world = ctx.world;
  const P = ctx.palette;
  const NZ = {
    warp: ctx.noise('warp'), v: ctx.noise('value'), mid: ctx.noise('mid'), streak: ctx.noise('streak'), crack: ctx.noise('crack'),
  };
  const decals = makeDecals(ctx.art, P);
  const looks = new Map();
  const local = { snowOverride: 0, wetOverride: null };
  let T = null;
  let tm = null;
  let drawnTiles = [];
  let minimapCache = null;
  let wetNow = 0;

  function getLook() {
    const season = ctx.clock.season || 'spring';
    const env = world.environment;
    const wx = env && env.weather;
    const snowRaw = wx && typeof wx.snowCover === 'number' ? Math.max(wx.snowCover, local.snowOverride) : local.snowOverride;
    const wetRaw = local.wetOverride != null ? local.wetOverride : (wx && typeof wx.wetness === 'number' ? wx.wetness : 0);
    const snow = Math.round(clamp(snowRaw, 0, 1) * 4) / 4;
    // wetness changes continuously → applied as a live multiply overlay, not baked into tiles
    wetNow = clamp(wetRaw, 0, 1);
    const sig = `${season}|${snow}`;
    let L = looks.get(sig);
    if (!L) { L = makeLook(ctx.art, P, season, snow, 0); looks.set(sig, L); }
    return L;
  }

  // ------------------------------------------------------------ sampling helpers
  function bil(arr, x, y) {
    const W = T.w, H = T.h;
    const fx = clamp(x, 0, W - 1.001), fy = clamp(y, 0, H - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = iy * W + ix;
    return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + W] * (1 - tx) + arr[o + W + 1] * tx) * ty;
  }
  const node = (x, y) => clamp(Math.round(y), 0, T.h - 1) * T.w + clamp(Math.round(x), 0, T.w - 1);
  function depthAt(x, y) {
    const wl = bil(T.waterLevel, x, y);
    if (wl < NO_WATER + 50) return 0;
    return Math.max(0, wl - bil(T.height, x, y));
  }

  function shapeBBox(shape) {
    if (shape && Array.isArray(shape.poly) && shape.poly.length >= 3) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of shape.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x0, y0, x1, y1 };
    }
    if (shape && Number.isFinite(shape.x) && Number.isFinite(shape.y) && shape.r > 0) return { x0: shape.x - shape.r, y0: shape.y - shape.r, x1: shape.x + shape.r, y1: shape.y + shape.r };
    throw new Error('terrain: shape must be {poly:[[x,y],...]} or {x,y,r}');
  }
  function inPoly(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function polyDist(poly, x, y) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = clamp(t, 0, 1);
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  }
  const inside = (shape, x, y) => (shape.poly ? inPoly(shape.poly, x, y) : Math.hypot(x - shape.x, y - shape.y) <= shape.r);

  function publish() {
    Object.assign(world.terrain, {
      w: T.w, h: T.h, cell: 1,
      height: T.height, surface: T.surface, moisture: T.moisture, waterLevel: T.waterLevel, flags: T.flags,
      rivers: T.rivers, lakes: T.lakes, surfaceTypes: SURFACES.slice(),
      version: (world.terrain.version || 0) + 1,
    });
  }
  function changed(kind, bb, extra) {
    world.terrain.version = (world.terrain.version || 0) + 1;
    minimapCache = null;
    computeUniform(T, Math.floor(bb.x0) - 3, Math.floor(bb.y0) - 3, Math.ceil(bb.x1) + 3, Math.ceil(bb.y1) + 3);
    tm.markDirty(bb.x0 - 2, bb.y0 - 2, bb.x1 + 2, bb.y1 + 2);
    ctx.events.emit('terrain:changed', Object.assign({ kind, x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, version: world.terrain.version }, extra || {}));
  }

  // ------------------------------------------------------------ API
  const api = {
    async generate(opts = {}) {
      T = generateData(ctx, Object.assign({ w: world.bounds.w, h: world.bounds.h }, opts));
      if (!tm) tm = new TileManager(ctx, T, NZ, decals, getLook); else tm.reset(T);
      tm.paintOverviewSync(getLook());
      minimapCache = null;
      publish();
      ctx.events.emit('terrain:generated', { w: T.w, h: T.h, rivers: T.rivers.length, lakes: T.lakes.length, version: world.terrain.version });
      return { w: T.w, h: T.h, rivers: T.rivers.length, lakes: T.lakes.length };
    },
    heightAt(x, y) { return T ? bil(T.height, x, y) : 0; },
    slopeAt(x, y) {
      if (!T) return 0;
      const gx = (bil(T.height, x + 1, y) - bil(T.height, x - 1, y)) / 2, gy = (bil(T.height, x, y + 1) - bil(T.height, x, y - 1)) / 2;
      return Math.sqrt(gx * gx + gy * gy);
    },
    surfaceAt(x, y) {
      if (!T) return 'grass';
      if (x < 0 || y < 0 || x > T.w || y > T.h) return 'grass';
      const d = depthAt(x, y);
      const code = T.surface[node(x, y)];
      if (d > 0.55) return 'water';
      if (d > 0.02 && code !== S.water) return 'shallow';
      return SURFACES[code];
    },
    isWater(x, y) { return T ? depthAt(x, y) > 0.02 : false; },
    waterDepthAt(x, y) { return T ? depthAt(x, y) : 0; },
    moistureAt(x, y) { return T ? clamp(bil(T.moisture, x, y), 0, 1) : 0.5; },
    paintSurface(shape, type, opts = {}) {
      if (!T) return false;
      const code = S[type];
      if (code == null) { ctx.warn(`paintSurface: unknown surface "${type}"`); return false; }
      const bb = shapeBBox(shape);
      let angle = opts.angle;
      if (angle == null && type === 'ploughed') {
        angle = 0;
        if (shape.poly) {
          let best = -1;
          for (let i = 0; i < shape.poly.length; i++) {
            const a = shape.poly[i], b = shape.poly[(i + 1) % shape.poly.length];
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (l > best) { best = l; angle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
          }
        }
      }
      // furrows run along `angle`; the shader stripes across the projection axis → store the normal
      const auxV = angle == null ? 0 : Math.round((((angle + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI / Math.PI * 255) & 255;
      const x0 = Math.max(0, Math.floor(bb.x0)), y0 = Math.max(0, Math.floor(bb.y0));
      const x1 = Math.min(T.w - 1, Math.ceil(bb.x1)), y1 = Math.min(T.h - 1, Math.ceil(bb.y1));
      // record the op so the shader can draw its true (sub-cell) outline
      const op = shape.poly ? { code, aux: auxV, poly: [].concat(...shape.poly.map((p) => [p[0], p[1]])) } : { code, aux: auxV, cx: shape.x, cy: shape.y, r: shape.r };
      if (T.ops.length >= 65000) T.ops.length = 0; // pathological: fall back to cell edges
      T.ops.push(op);
      const idx = T.ops.length;
      const BAND = 1.6;
      let n = 0;
      const bx0 = Math.max(0, Math.floor(bb.x0 - BAND)), by0 = Math.max(0, Math.floor(bb.y0 - BAND));
      const bx1 = Math.min(T.w - 1, Math.ceil(bb.x1 + BAND)), by1 = Math.min(T.h - 1, Math.ceil(bb.y1 + BAND));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const o = y * T.w + x;
        const sd = opSD(op, x, y);
        if (Math.abs(sd) < BAND) { T.prev[o] = codeAt(T, x, y); T.pedge[o] = idx; }
        else if (sd > 0) T.pedge[o] = 0;
        if (sd < 0) continue;
        T.surface[o] = code; T.painted[o] = 1; T.aux[o] = auxV; n++;
      }
      if (n) changed('surface', bb, { type, cells: n });
      return n;
    },
    flatten(shape, height) {
      if (!T) return undefined;
      const bb = shapeBBox(shape);
      let tgt = height;
      if (shape.poly) {
        const F = 4;
        const x0 = Math.max(0, Math.floor(bb.x0 - F)), y0 = Math.max(0, Math.floor(bb.y0 - F));
        const x1 = Math.min(T.w - 1, Math.ceil(bb.x1 + F)), y1 = Math.min(T.h - 1, Math.ceil(bb.y1 + F));
        if (tgt == null) {
          let s = 0, n = 0;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPoly(shape.poly, x, y)) { s += T.height[y * T.w + x]; n++; }
          tgt = n ? s / n : bil(T.height, (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
        }
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const o = y * T.w + x;
          if (inPoly(shape.poly, x, y)) { T.height[o] = tgt; continue; }
          const d = polyDist(shape.poly, x, y);
          if (d < F) { const k = d / F, s = k * k * (3 - 2 * k); T.height[o] = tgt + (T.height[o] - tgt) * s; }
        }
        bb.x0 -= F; bb.y0 -= F; bb.x1 += F; bb.y1 += F;
      } else {
        tgt = flattenCircle(T.w, T.h, T.height, shape.x, shape.y, shape.r, height);
        const R = shape.r * 1.7;
        bb.x0 = shape.x - R; bb.y0 = shape.y - R; bb.x1 = shape.x + R; bb.y1 = shape.y + R;
      }
      const m = 14;
      computeShade(T, Math.max(0, Math.floor(bb.x0 - m)), Math.max(0, Math.floor(bb.y0 - m)), Math.min(T.w - 1, Math.ceil(bb.x1 + m)), Math.min(T.h - 1, Math.ceil(bb.y1 + m)));
      reclassify(T, ctx, Math.max(0, Math.floor(bb.x0)), Math.max(0, Math.floor(bb.y0)), Math.min(T.w - 1, Math.ceil(bb.x1)), Math.min(T.h - 1, Math.ceil(bb.y1)));
      changed('height', { x0: bb.x0 - m, y0: bb.y0 - m, x1: bb.x1 + m, y1: bb.y1 + m }, { height: tgt });
      return tgt;
    },
    riverPaths() { return T ? T.riverInfo.map((r) => r.points.map((p) => p.slice())) : []; },
    lakes() { return T ? T.lakes.map((l) => ({ id: l.id, x: l.x, y: l.y, r: l.r, level: l.level, depth: l.depth, poly: l.poly.map((p) => p.slice()) })) : []; },
    findDry(x, y, radius = 64) {
      if (!T) return { x, y };
      const R = Math.min(256, Math.max(1, radius));
      const dry = (px, py) => px >= 0 && py >= 0 && px <= T.w - 1 && py <= T.h - 1 && depthAt(px, py) <= 0 && T.surface[node(px, py)] !== S.water && T.surface[node(px, py)] !== S.shallow;
      if (dry(x, y)) return { x, y };
      for (let r = 1; r <= R; r++) {
        const steps = Math.max(8, Math.ceil(r * 6.3));
        let best = null;
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (dry(px, py)) { best = { x: px, y: py }; break; }
        }
        if (best) return best;
      }
      return null;
    },
    minimap(sizePx = 256) {
      if (!T || !tm || !tm.overview) return null;
      const s = Math.max(16, Math.min(2048, sizePx | 0));
      if (minimapCache && minimapCache.width === s && minimapCache._src === tm.overview) return minimapCache;
      const c = ctx.art.canvas(s, s);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(tm.overview, 0, 0, s, s);
      c._src = tm.overview;
      minimapCache = c;
      return c;
    },
    surfaceTypes() { return SURFACES.map((name, code) => ({ name, code })); },
  };

  try {
    warmShader([makeLook(ctx.art, P, 'summer', 0, 0), makeLook(ctx.art, P, 'winter', 0.75, 0), makeLook(ctx.art, P, 'autumn', 0.25, 0)], NZ);
  } catch (e) { ctx.warn('shader warm-up failed: ' + (e && e.message)); }
  await api.generate({});

  // ------------------------------------------------------------ rendering
  const BUDGET = 12000; // ≈ 1.5 ms of shading per frame (tripled while visible tiles are still blank)
  ctx.renderer.addLayer('ground', (g, view) => {
    if (!tm) return;
    const need = tm.work(view, BUDGET);
    drawnTiles = tm.draw(g, view, need);
  }, 0);

  // wet ground: darken soils (and a little the grass) while it rains / dries
  ctx.renderer.addLayer('ground-overlay', (g, view) => {
    if (!tm || wetNow < 0.04) return;
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = Math.min(1, wetNow);
    for (const tile of drawnTiles) {
      const m = tm.wetMask(tile);
      if (m) g.drawImage(m, tile.x, tile.y, tile.size, tile.size); // no overlap pad: multiply would double up
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }, 0);

  ctx.renderer.addLayer('ground-detail', (g, view) => {
    if (view.zoom < 3.5) return;
    const t = view.time || 0;
    const drift = Math.sin(t * 0.5) * 0.12;
    for (const tile of drawnTiles) {
      const sh = tile.shimmer;
      if (!sh) continue;
      const a = 0.5 + 0.5 * Math.sin(t * 1.2 + sh.phase);
      g.globalAlpha = 0.9 * a;
      g.drawImage(sh.frames[0], tile.x + drift, tile.y, tile.size, tile.size);
      g.globalAlpha = 0.9 * (1 - a);
      g.drawImage(sh.frames[1], tile.x - drift, tile.y + drift * 0.5, tile.size, tile.size);
    }
    g.globalAlpha = 1;
  }, 0);

  // reed clumps cast small soft shadows
  ctx.renderer.addCollector((view, F) => {
    if (!T || view.zoom < 6 || !T.reedBuckets) return;
    const B = T.reedBuckets;
    const bx0 = Math.max(0, Math.floor(view.x0 / B.B)), bx1 = Math.floor(view.x1 / B.B);
    const by0 = Math.max(0, Math.floor(view.y0 / B.B)), by1 = Math.floor(view.y1 / B.B);
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const arr = B.map.get(by * B.bw + bx);
      if (!arr) continue;
      for (const r of arr) {
        if (r.x < view.x0 - 2 || r.x > view.x1 + 2 || r.y < view.y0 - 2 || r.y > view.y1 + 2) continue;
        F.shadow.circle(r.x, r.y, r.r * 0.75, 0.2, r.h);
      }
    }
  });

  if (ctx.params.weather === 'snow') local.snowOverride = 0.6;
  INST = { local, warm(view) { if (tm) tm.work(view, Infinity); } };
  if (ctx.params.tdebug) window.__TDBG = () => ({ tm, jobs: [...tm.jobs.keys()], tiles: tm.tiles.size, mb: tm.bytes / 1048576, ov: tm.overviewSig, look: getLook().sig, ovJob: !!tm.overviewJob, bench(L) { const out = {}; for (const lv of [8, 16, 32]) { const t = tm.tileAt(lv, 11, 12); const t0 = performance.now(); const it = tm.tileJob(t, getLook(), 0); let u = 0, r; const ph = []; let tp = performance.now(); while (!(r = it.next()).done) { u += r.value; const tn = performance.now(); ph.push(Math.round(tn - tp) + "/" + r.value); tp = tn; } out[lv] = [performance.now() - t0, u, ph.join(" ")]; } return out; } });

  return {
    api,
    save() { return null; }, // terrain is regenerated from seed; painted edits are re-applied by their owners
  };
}

let INST = null;

// ---------------------------------------------------------------- showcase
// Camera targets are for the default seed ('harvest-1').
const SC = {
  overview: { x: 440, y: 745 },
  river: { x: 322, y: 300 },
  close: { x: 553, y: 779 },
  lake: { x: 392, y: 757 },
};

export const showcase = {
  deps: ['environment'],
  presets: {
    default: { camera: { x: SC.overview.x, y: SC.overview.y, zoom: 5 }, time: '10:00' },
    river: { camera: { x: SC.river.x, y: SC.river.y, zoom: 24 }, time: '17:00' },
    closeup: { camera: { x: SC.close.x, y: SC.close.y, zoom: 56 }, time: '10:00' },
    lake: { camera: { x: SC.lake.x, y: SC.lake.y, zoom: 12 }, time: '12:30', day: 16 },
    autumn: { camera: { x: SC.lake.x, y: SC.lake.y, zoom: 12 }, time: '11:00', day: 28 },
    winter: { camera: { x: SC.lake.x, y: SC.lake.y, zoom: 12 }, time: '12:00', day: 1 },
  },
  async stage(ctx, presetName) {
    const terr = ctx.modules.get('terrain');
    if (!terr) return;
    stageFarm(terr);
    if (presetName === 'winter') {
      const env = ctx.modules.get('environment');
      if (env && typeof env.setWeather === 'function') env.setWeather('snow', 0.6);
      if (INST) INST.local.snowOverride = 0.75;
    }
    // paint the first view up-front (also for a ?cam= override, which boot applies after staging)
    let view = ctx.camera.view();
    if (ctx.params.cam) {
      const [x, y, z0] = String(ctx.params.cam).split(',').map(Number);
      const z = Math.max(3, Math.min(96, z0 || view.zoom));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const hw = ctx.camera.w / 2 / z, hh = ctx.camera.h / 2 / z;
        view = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh, zoom: z, w: ctx.camera.w, h: ctx.camera.h };
      }
    }
    if (INST) INST.warm(view);
  },
};

// demonstrate paintSurface / flatten: a small farm plot east of the river (default seed)
function stageFarm(terr) {
  terr.flatten({ x: 576, y: 760, r: 10 });
  terr.paintSurface({ x: 576, y: 760, r: 10 }, 'farmyard');
  terr.paintSurface({ poly: [[492, 735], [545, 728], [552, 775], [498, 782]] }, 'ploughed');
  terr.paintSurface({ poly: [[498, 790], [553, 783], [558, 815], [503, 822]] }, 'soil');
  terr.paintSurface({ poly: [[559, 766], [565, 766], [566, 830], [560, 830]] }, 'gravel');
  terr.paintSurface({ poly: [[595, 700], [640, 695], [645, 740], [600, 745]] }, 'ploughed', { angle: Math.PI / 2 });
}
