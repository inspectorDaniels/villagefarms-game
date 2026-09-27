// Ground decals (stamped sprites that fade over GAME time) and continuous trails
// (tyre tracks / furrows / foot paths as ribbon polylines, chunked for culling + fading).

export const MAX_DECALS = 900;
export const MAX_TRAIL_CHUNKS = 1400;
const CHUNK_PTS = 14;
const MIN_STEP = 0.3;     // m between trail points
const BREAK_DIST = 4;     // m jump => start a new ribbon

// default lifetimes in GAME seconds (1 real s = 60 game s at normal speed)
const DECAL_LIFE = { tyre: 3 * 3600, footprint: 2 * 3600, hoofprint: 2 * 3600, puddle: 5 * 3600, scorch: 24 * 3600, spill: 8 * 3600 };
const TRAIL_LIFE = { tyre: 5 * 3600, furrow: 12 * 3600, foot: 2 * 3600, track: 4 * 3600 };

// surface -> imprint colour [r,g,b], strength multiplier, life multiplier
const SURF = {
  grass: [[52, 66, 34], 0.8, 0.6],
  meadow: [[58, 70, 36], 0.75, 0.6],
  soil: [[58, 42, 28], 1.0, 1.0],
  ploughed: [[48, 34, 22], 1.0, 1.0],
  farmyard: [[70, 54, 38], 0.9, 1.0],
  gravel: [[70, 64, 56], 0.6, 0.5],
  sand: [[140, 118, 84], 0.8, 0.7],
  mud: [[34, 26, 18], 1.35, 2.0],
  snow: [[132, 150, 178], 1.2, 1.5],
  asphalt: [[30, 30, 32], 0.35, 0.25],
  rock: [[60, 58, 56], 0.3, 0.3],
  forestFloor: [[50, 38, 26], 0.9, 1.0],
  water: null, shallow: null,
};
const DEFAULT_SURF = SURF.soil;

export function createDecals({ sprites, clockT, surfaceAt, weather }) {
  const decals = [];      // ring buffer of {type,x,y,rot,w,h,t0,life,alpha,img,r}; expiry is lazy
  let dHead = 0;
  const puddles = [];     // live puddle decals (rain ripples test against these only)
  const chunks = [];      // {id,type,width,pts:[],d0,rgb,str,t0,t1,life,x0,y0,x1,y1}
  const trails = new Map(); // id -> { chunk, lx, ly, dist }

  function surfInfo(x, y) {
    let s = null;
    try { s = surfaceAt(x, y); } catch (e) { s = null; }
    const w = weather() || {};
    if ((w.snowCover || 0) > 0.35 && s !== 'water' && s !== 'shallow') s = 'snow';
    let info = s && Object.prototype.hasOwnProperty.call(SURF, s) ? SURF[s] : DEFAULT_SURF;
    if (info === null) return null; // no imprint on water
    let [rgb, str, lifeMul] = info;
    const wet = w.wetness || 0;
    if (wet > 0.3 && s !== 'snow' && s !== 'asphalt') { str *= 1 + wet * 0.4; lifeMul *= 1 + wet; rgb = rgb.map((v) => v * (1 - wet * 0.25)); }
    return { surf: s || 'soil', rgb, str, lifeMul };
  }

  // ---------------- decals ----------------
  function decal(type, x, y, rot, o) {
    o = o || {};
    const v = o.variant != null ? o.variant : ((x * 7.31 + y * 3.17) | 0) & 3;
    let img, w, h;
    const printSurf = type === 'tyre' || type === 'footprint' || type === 'hoofprint' ? surfInfo(x, y) : null;
    const snow = !!(printSurf && printSurf.surf === 'snow');
    switch (type) {
      case 'tyre': img = sprites.tyreStamp(v % 2, snow); w = o.width || 0.5; h = o.length || w * 2; break;
      case 'footprint': img = sprites.footprint(v % 3, snow); w = (o.size || 1) * 0.55; h = w * 1.5; break;
      case 'hoofprint': img = sprites.hoofprint(v % 3, snow); w = (o.size || 1) * 0.22; h = w; break;
      case 'puddle': img = sprites.puddle(v % 3); w = o.size || 2; h = w * 0.75; break;
      case 'scorch': img = sprites.scorch(v % 2); w = h = o.size || 2.5; break;
      case 'spill': img = sprites.spill(o.color || '#c9a24a', v % 3); w = h = o.size || 1.6; break;
      default: return null;
    }
    img = sprites.list[img];
    const si = type === 'puddle' || type === 'scorch' || type === 'spill' ? null : printSurf;
    if (si === null && (type === 'tyre' || type === 'footprint' || type === 'hoofprint')) {
      // on water: nothing, unless no surface info at all
      let s = null; try { s = surfaceAt(x, y); } catch (e) { /* ignore */ }
      if (s === 'water' || s === 'shallow') return null;
    }
    const life = (o.life != null ? o.life : DECAL_LIFE[type]) * (si ? si.lifeMul : 1);
    const d = { type, x, y, rot: rot || 0, w, h, t0: clockT(), life, alpha: (o.alpha != null ? o.alpha : 1) * (si ? Math.min(1, 0.55 + 0.45 * si.str) : 1), img, r: Math.max(w, h) };
    if (decals.length < MAX_DECALS) decals.push(d);
    else {
      const old = decals[dHead];
      decals[dHead] = d; dHead = (dHead + 1) % MAX_DECALS;
      markStale(old);           // only tiles under the overwritten decal need a (budgeted) re-bake
      const pi = puddles.indexOf(old); if (pi >= 0) puddles.splice(pi, 1);
    }
    if (type === 'puddle') puddles.push(d);
    onDecalAdded(d);
    return d;
  }

  // ---------------- trails ----------------
  function newChunk(id, type, width, x, y, d0, si, now) {
    const c = {
      id, type, width, pts: [x, y], d0, rgb: si.rgb, str: si.str, surf: si.surf,
      t0: now, t1: now, life: (TRAIL_LIFE[type] || TRAIL_LIFE.tyre) * si.lifeMul,
      x0: x, y0: y, x1: x, y1: y,
    };
    if (chunks.length >= MAX_TRAIL_CHUNKS) chunks.shift().dead = true;
    chunks.push(c);
    return c;
  }

  function trail(id, x, y, rot, width, type) {
    type = type || 'tyre';
    width = width || 0.45;
    const now = clockT();
    let tr = trails.get(id);
    if (tr) {
      const dd = Math.hypot(x - tr.lx, y - tr.ly);
      if (dd < MIN_STEP) return;
      if (dd > BREAK_DIST || tr.type !== type) { trails.delete(id); tr = null; }
    }
    const si = surfInfo(x, y);
    if (!si) { trails.delete(id); return; } // over water: break the ribbon
    if (!tr) {
      tr = { chunk: newChunk(id, type, width, x, y, 0, si, now), lx: x, ly: y, dist: 0, type };
      trails.set(id, tr);
      return;
    }
    tr.dist += Math.hypot(x - tr.lx, y - tr.ly);
    let c = tr.chunk;
    // surface changed noticeably or chunk full -> continue in a new chunk sharing the last point
    if (c.pts.length >= CHUNK_PTS * 2 || c.surf !== si.surf || c.dead) {
      const nc = newChunk(id, type, width, tr.lx, tr.ly, tr.dist - Math.hypot(x - tr.lx, y - tr.ly), si, now);
      c = tr.chunk = nc;
    }
    c.pts.push(x, y);
    c.t1 = now;
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
    if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
    tr.lx = x; tr.ly = y;
  }

  function endTrail(id) { trails.delete(id); }

  function expire(compact) {
    const now = clockT();
    let k = 0;
    while (k < chunks.length && now - chunks[k].t1 > chunks[k].life) k++;
    if (k > 0) { for (let i = 0; i < k; i++) chunks[i].dead = true; chunks.splice(0, k); }
    // decals expire lazily (skipped when baked); only the small puddle list is pruned
    if (compact) for (let i = puddles.length - 1; i >= 0; i--) if (now - puddles[i].t0 > puddles[i].life) puddles.splice(i, 1);
  }

  // chunks are batched into buckets (type, surface colour, width, alpha level) so a whole
  // field of tracks costs a handful of strokes instead of several per chunk.
  const buckets = new Map();
  let mottlePat = null;
  function mottlePattern(g) {
    if (mottlePat === null) {
      mottlePat = false;
      try {
        const p = g.createPattern(sprites.list[sprites.mottle()], 'repeat');
        if (p && typeof p.setTransform === 'function' && typeof DOMMatrix === 'function') { p.setTransform(new DOMMatrix().scale(1 / 32)); mottlePat = p; }
      } catch (e) { mottlePat = false; }
    }
    return mottlePat || null;
  }
  function drawTrails(g, view) {
    const now = clockT();
    for (const bk of buckets.values()) bk.list.length = 0;
    let n = 0;
    for (const c of chunks) {
      const hw = c.width;
      if (c.x1 + hw < view.x0 || c.x0 - hw > view.x1 || c.y1 + hw < view.y0 || c.y0 - hw > view.y1) continue;
      if (c.pts.length < 4) continue;
      const age = Math.max(0, now - c.t1);
      let a = 1 - age / c.life;
      if (a <= 0.01) continue;
      a = Math.min(1, a * 1.4) * Math.min(1.25, c.str);
      const q = Math.max(1, Math.round(a * 12));
      const key = c.type + '|' + c.surf + '|' + c.rgb.join(',') + '|' + Math.round(c.width * 20) + '|' + q;
      let bk = buckets.get(key);
      if (!bk) { bk = { type: c.type, surf: c.surf, rgb: c.rgb, width: c.width, a: q / 12, list: [] }; buckets.set(key, bk); }
      bk.list.push(c);
      n++;
    }
    // butt caps: consecutive chunks share their end point, so round caps from chunks in
    // different fade buckets would overlap and double-darken into knots at every join
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    const detail = view.zoom > 20;
    const mottle = mottlePattern(g);
    for (const bk of buckets.values()) {
      if (!bk.list.length) continue;
      g.beginPath();
      for (const c of bk.list) {
        g.moveTo(c.pts[0], c.pts[1]);
        for (let i = 2; i < c.pts.length; i += 2) g.lineTo(c.pts[i], c.pts[i + 1]);
      }
      const [r, gg, b] = bk.rgb, a = bk.a, W = bk.width;
      const col = (k, al) => `rgba(${r * k | 0},${gg * k | 0},${b * k | 0},${al})`;
      if (bk.type === 'furrow') {
        g.strokeStyle = col(1, 0.22 * a);
        g.lineWidth = W * 1.3; g.stroke();
        g.strokeStyle = col(0.7, 0.4 * a);
        g.lineWidth = W * 0.5; g.stroke();
      } else if (bk.type === 'tyre' && bk.surf === 'snow') {
        // compressed snow: a wide, soft blue-grey trough, deepest in the middle, flanked by
        // bright pushed-up rims that fade out into the snow (no dark outer line => no "rails")
        g.strokeStyle = `rgba(255,255,255,${0.75 * a})`;
        g.lineWidth = W * 1.7; g.stroke();
        g.strokeStyle = `rgba(196,208,226,${0.55 * a})`;
        g.lineWidth = W * 1.2; g.stroke();
        g.strokeStyle = `rgba(174,190,214,${0.45 * a})`;
        g.lineWidth = W * 0.9; g.stroke();
        g.strokeStyle = `rgba(160,178,206,${0.35 * a})`;
        g.lineWidth = W * 0.55; g.stroke();
        if (mottle) {
          g.globalAlpha = 0.18 * a;
          g.strokeStyle = mottle; g.lineWidth = W * 0.9; g.stroke();
          g.globalAlpha = 1;
        }
      } else if (bk.type === 'tyre') {
        // compacted band: soft shoulder, a denser core, and a mottled texture instead of
        // regular cross-bars (evenly spaced lugs read as railway sleepers)
        g.strokeStyle = col(1, 0.09 * a);
        g.lineWidth = W * 1.3; g.stroke();
        g.strokeStyle = col(0.92, 0.14 * a);
        g.lineWidth = W * 0.85; g.stroke();
        if (mottle && detail) {
          g.globalAlpha = 0.55 * a;
          g.strokeStyle = mottle; g.lineWidth = W * 0.8; g.stroke();
          g.globalAlpha = 1;
        }
      } else {
        g.strokeStyle = col(1, 0.2 * a);
        g.lineWidth = W; g.stroke();
      }
    }
    if (buckets.size > 64) for (const [k, bk] of buckets) if (!bk.list.length) buckets.delete(k);
    return n;
  }

  // ---- decals are baked into world-anchored tile canvases (one blit per visible tile).
  // New decals are painted incrementally; tiles are re-baked (max one per frame) when the
  // quantised fade step (10 game minutes) or the wetness level changes.
  const DT_M = 16, DT_PPM = 32, MAX_TILES = 48; // baked at art.PPM so close-ups stay crisp
  const tiles = new Map();
  let frameNo = 0;
  function decalAlpha(d, now, wet) {
    const u = (now - d.t0) / d.life;
    if (u >= 1 || u < -0.001) return 0;
    let a = d.alpha * (u > 0.6 ? (1 - u) / 0.4 : 1);
    if (d.type === 'puddle' && wet != null) a *= 0.15 + 0.85 * Math.min(1, wet * 1.3); // dry weather: nearly gone
    return a;
  }
  function curWet() { const w = weather(); return w && Number.isFinite(w.wetness) ? Math.round(w.wetness * 10) / 10 : null; }
  function stampNow(now) { return Math.floor(now / 600) + ':' + curWet(); }
  function paintDecal(t, d, a) {
    const tg = t.g, S = DT_PPM;
    const c = Math.cos(d.rot), sn = Math.sin(d.rot);
    tg.globalAlpha = a > 1 ? 1 : a;
    tg.setTransform(S * c * d.w, S * sn * d.w, -S * sn * d.h, S * c * d.h, (d.x - t.tx * DT_M) * S, (d.y - t.ty * DT_M) * S);
    tg.drawImage(d.img, -0.5, -0.5, 1, 1);
  }
  function overlaps(d, t) {
    const x0 = t.tx * DT_M, y0 = t.ty * DT_M;
    return d.x + d.r > x0 && d.x - d.r < x0 + DT_M && d.y + d.r > y0 && d.y - d.r < y0 + DT_M;
  }
  function buildTile(t, now) {
    const wet = curWet();
    let n = 0;
    for (const d of decals) {
      if (!overlaps(d, t)) continue;
      const a = decalAlpha(d, now, wet);
      if (a <= 0.01) continue;
      if (!t.canvas) {
        t.canvas = document.createElement('canvas');
        t.canvas.width = t.canvas.height = DT_M * DT_PPM;
        t.g = t.canvas.getContext('2d');
      }
      if (n === 0) { t.g.setTransform(1, 0, 0, 1, 0, 0); t.g.clearRect(0, 0, t.canvas.width, t.canvas.height); }
      paintDecal(t, d, a);
      n++;
    }
    if (n === 0 && t.canvas) { t.g.setTransform(1, 0, 0, 1, 0, 0); t.g.clearRect(0, 0, t.canvas.width, t.canvas.height); }
    t.count = n;
    t.stamp = stampNow(now);
    t.built = true;
    t.stale = false;
  }
  function onDecalAdded(d) {
    const now = clockT();
    const tx0 = Math.floor((d.x - d.r) / DT_M), tx1 = Math.floor((d.x + d.r) / DT_M);
    const ty0 = Math.floor((d.y - d.r) / DT_M), ty1 = Math.floor((d.y + d.r) / DT_M);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = tiles.get(tx + ',' + ty);
      if (!t || !t.built) continue;
      if (!t.canvas) { t.built = false; continue; } // was empty: rebuild on next draw
      paintDecal(t, d, decalAlpha(d, now, curWet()));
      t.count++;
    }
  }
  function invalidateTiles() { for (const t of tiles.values()) t.built = false; }
  function markStale(d) {
    if (!d) return;
    const tx0 = Math.floor((d.x - d.r) / DT_M), tx1 = Math.floor((d.x + d.r) / DT_M);
    const ty0 = Math.floor((d.y - d.r) / DT_M), ty1 = Math.floor((d.y + d.r) / DT_M);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const t = tiles.get(tx + ',' + ty); if (t) t.stale = true; }
  }

  function drawDecals(g, view) {
    if (!decals.length) return 0;
    const now = clockT();
    frameNo++;
    const stamp = stampNow(now);
    let rebakeBudget = 1;
    let n = 0;
    const tx0 = Math.floor(view.x0 / DT_M), tx1 = Math.floor(view.x1 / DT_M);
    const ty0 = Math.floor(view.y0 / DT_M), ty1 = Math.floor(view.y1 / DT_M);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = tx + ',' + ty;
      let t = tiles.get(key);
      if (!t) { t = { tx, ty, canvas: null, g: null, count: 0, stamp: '', built: false, used: 0 }; tiles.set(key, t); }
      t.used = frameNo;
      if (!t.built) buildTile(t, now);
      else if ((t.stale || t.stamp !== stamp) && rebakeBudget > 0) { buildTile(t, now); rebakeBudget--; }
      if (t.count > 0 && t.canvas) { g.drawImage(t.canvas, tx * DT_M, ty * DT_M, DT_M, DT_M); n++; }
    }
    if (tiles.size > MAX_TILES) {
      const old = [...tiles.entries()].filter(([, t]) => t.used !== frameNo).sort((p, q) => p[1].used - q[1].used);
      for (let i = 0; i < old.length && tiles.size > MAX_TILES; i++) tiles.delete(old[i][0]);
    }
    return n;
  }

  /** true if (x,y) lies inside a live puddle decal (rain on puddles makes ripples) */
  function puddleAt(x, y) {
    const now = clockT();
    for (const d of puddles) {
      if (now - d.t0 > d.life) continue;
      const dx = (x - d.x) / (d.w * 0.4), dy = (y - d.y) / (d.h * 0.4);
      if (dx * dx + dy * dy < 1) return true;
    }
    return false;
  }

  /** call fn(x,y) for rain drops landing in visible puddles: expected k drops per m² */
  function rainOnPuddles(view, k, rng, fn) {
    const now = clockT();
    for (const d of puddles) {
      if (now - d.t0 > d.life) continue;
      if (d.x + d.r < view.x0 || d.x - d.r > view.x1 || d.y + d.r < view.y0 || d.y - d.r > view.y1) continue;
      let n = k * d.w * d.h * 0.5;
      while (n > 0) {
        if (n >= 1 || rng.chance(n)) {
          const a = rng.float() * Math.PI * 2, r = Math.sqrt(rng.float()) * 0.36;
          const lx = Math.cos(a) * r * d.w, ly = Math.sin(a) * r * d.h;
          const c = Math.cos(d.rot), s = Math.sin(d.rot);
          fn(d.x + lx * c - ly * s, d.y + lx * s + ly * c);
        }
        n -= 1;
      }
    }
  }

  function clear(type) {
    invalidateTiles();
    if (!type || type === 'puddle') puddles.length = 0;
    if (!type) { decals.length = 0; dHead = 0; for (const c of chunks) c.dead = true; chunks.length = 0; trails.clear(); return; }
    if (type === 'trails') { for (const c of chunks) c.dead = true; chunks.length = 0; trails.clear(); return; }
    for (let i = decals.length - 1; i >= 0; i--) if (decals[i].type === type) decals.splice(i, 1);
    dHead = decals.length % MAX_DECALS;
  }

  return {
    decal, trail, endTrail, expire, puddleAt, rainOnPuddles, drawTrails, drawDecals, clear,
    count: () => ({ decals: decals.length, trailChunks: chunks.length, trails: trails.size }),
  };
}
