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
  const decals = [];      // ring buffer of {type,x,y,rot,w,h,t0,life,alpha,img,r}
  let dHead = 0;
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
    switch (type) {
      case 'tyre': img = sprites.tyreStamp(v % 2); w = o.width || 0.5; h = o.length || w * 2; break;
      case 'footprint': img = sprites.footprint(v % 3); w = (o.size || 1) * 0.55; h = w * 1.5; break;
      case 'hoofprint': img = sprites.hoofprint(v % 3); w = (o.size || 1) * 0.22; h = w; break;
      case 'puddle': img = sprites.puddle(v % 3); w = o.size || 2; h = w * 0.62; break;
      case 'scorch': img = sprites.scorch(v % 2); w = h = o.size || 2.5; break;
      case 'spill': img = sprites.spill(o.color || '#c9a24a', v % 3); w = h = o.size || 1.2; break;
      default: return null;
    }
    img = sprites.list[img];
    const si = type === 'puddle' || type === 'scorch' || type === 'spill' ? null : surfInfo(x, y);
    if (si === null && (type === 'tyre' || type === 'footprint' || type === 'hoofprint')) {
      // on water: nothing, unless no surface info at all
      let s = null; try { s = surfaceAt(x, y); } catch (e) { /* ignore */ }
      if (s === 'water' || s === 'shallow') return null;
    }
    const life = (o.life != null ? o.life : DECAL_LIFE[type]) * (si ? si.lifeMul : 1);
    const d = { type, x, y, rot: rot || 0, w, h, t0: clockT(), life, alpha: (o.alpha != null ? o.alpha : 1) * (si ? Math.min(1, 0.55 + 0.45 * si.str) : 1), img, r: Math.max(w, h) };
    if (decals.length < MAX_DECALS) decals.push(d);
    else { decals[dHead] = d; dHead = (dHead + 1) % MAX_DECALS; }
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
    // decals: compact expired ones occasionally
    if (compact && decals.length) {
      for (let i = decals.length - 1; i >= 0; i--) if (now - decals[i].t0 > decals[i].life) { decals.splice(i, 1); }
      dHead = dHead % Math.max(1, decals.length);
    }
  }

  // chunks are batched into buckets (type, surface colour, width, alpha level) so a whole
  // field of tracks costs a handful of strokes instead of several per chunk.
  const buckets = new Map();
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
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const detail = view.zoom > 9;
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
      } else if (bk.type === 'tyre') {
        g.strokeStyle = col(1, 0.13 * a);
        g.lineWidth = W * 1.2; g.stroke();
        g.strokeStyle = col(1, 0.15 * a);
        g.lineWidth = W * 0.8; g.stroke();
        if (detail) {
          // tread lugs: dashes along a wide stroke render as soft cross-bars
          g.setLineDash([0.06, 0.12]);
          g.lineCap = 'butt';
          g.strokeStyle = col(0.8, 0.16 * a);
          g.lineWidth = W * 0.72; g.stroke();
          g.setLineDash([]);
          g.lineCap = 'round';
        }
        if (bk.surf === 'snow') {
          g.strokeStyle = `rgba(250,252,255,${0.3 * a})`;
          g.lineWidth = W * 0.15; g.stroke();
        }
      } else {
        g.strokeStyle = col(1, 0.2 * a);
        g.lineWidth = W; g.stroke();
      }
    }
    if (buckets.size > 64) for (const [k, bk] of buckets) if (!bk.list.length) buckets.delete(k);
    return n;
  }

  function drawDecals(g, view) {
    const now = clockT();
    const m = g.getTransform();
    const Z = m.a, E = m.e, Fy = m.f;
    let n = 0;
    for (const d of decals) {
      if (d.x + d.r < view.x0 || d.x - d.r > view.x1 || d.y + d.r < view.y0 || d.y - d.r > view.y1) continue;
      const u = (now - d.t0) / d.life;
      if (u >= 1) continue;
      let a = d.alpha * (u > 0.6 ? (1 - u) / 0.4 : 1);
      if (d.type === 'puddle') {
        const wet = (weather() || {}).wetness;
        if (wet != null) a *= Math.min(1, 0.35 + wet);
      }
      if (a <= 0.01) continue;
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      g.globalAlpha = a;
      g.setTransform(Z * c * d.w, Z * s * d.w, -Z * s * d.h, Z * c * d.h, E + Z * d.x, Fy + Z * d.y);
      g.drawImage(d.img, -0.5, -0.5, 1, 1);
      n++;
    }
    g.setTransform(m);
    g.globalAlpha = 1;
    return n;
  }

  function clear(type) {
    if (!type) { decals.length = 0; dHead = 0; for (const c of chunks) c.dead = true; chunks.length = 0; trails.clear(); return; }
    if (type === 'trails') { for (const c of chunks) c.dead = true; chunks.length = 0; trails.clear(); return; }
    for (let i = decals.length - 1; i >= 0; i--) if (decals[i].type === type) decals.splice(i, 1);
    dHead = 0;
  }

  return {
    decal, trail, endTrail, expire, drawTrails, drawDecals, clear,
    count: () => ({ decals: decals.length, trailChunks: chunks.length, trails: trails.size }),
  };
}
