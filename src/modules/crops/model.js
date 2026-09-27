// crops — pure field model (no DOM, no ctx): fields, cell grid, state machine, work(), daily growth,
// yields, job progress, save/load. index.js wires it to ctx; tests/*.mjs run it headlessly.
import {
  S, STATE_NAMES, CROPS, CROP_IDS, UNITS, REGROW, BALE_KG, MOW_MIN_GROWTH, YEAR_DAYS,
  stageOf, growthForStage, monthOfDoy, calendarGrowth, inSowWindow, TOOL_JOB,
} from './data.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CROP_INDEX = Object.fromEntries(CROP_IDS.map((c, i) => [c, i + 1])); // 0 = no crop
const cropOf = (k) => (k ? CROP_IDS[k - 1] : null);

// small deterministic hash → [0,1) for per-cell variation (no rng state involved)
function hash01(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function seedHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- base64 for typed arrays (portable: browser + node) ----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(ta) {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  let out = '';
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i], b = u8[i + 1], c = u8[i + 2];
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
  }
  return out;
}
function fromB64(str, Type, len) {
  const bytes = new Uint8Array(len * Type.BYTES_PER_ELEMENT);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const n = (B64.indexOf(str[i]) << 18) | (B64.indexOf(str[i + 1]) << 12) | ((B64.indexOf(str[i + 2]) & 63) << 6) | (B64.indexOf(str[i + 3]) & 63);
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255;
    if (str[i + 2] !== '=' && o < bytes.length) bytes[o++] = (n >> 8) & 255;
    if (str[i + 3] !== '=' && o < bytes.length) bytes[o++] = n & 255;
  }
  return new Type(bytes.buffer);
}
const ARRAYS = [['state', Uint8Array], ['crop', Uint8Array], ['growth', Float32Array], ['health', Float32Array],
  ['fert', Float32Array], ['weeds', Float32Array], ['moist', Float32Array], ['mass', Float32Array], ['age', Uint8Array]];

const moistF = (m) => (m < 0.1 ? 0.3 : m < 0.35 ? 0.3 + 0.7 * (m - 0.1) / 0.25 : m <= 0.85 ? 1 : 1 - 0.8 * (m - 0.85));
const fertF = (f) => 0.62 + 0.38 * Math.min(1, f / 0.4);

/**
 * W   = world.crops (owned namespace)
 * env = { emit(type,p), sim() → simulation api|null, now() → {t, day, doy}, moistureAt?(x,y), soilAt?(x,y),
 *         onDirty?(field, cellIndex), onField?(field, 'add'|'remove'), warn?(msg), seed }
 */
export function createModel(W, env) {
  if (!W.fields) W.fields = [];
  if (!W.bales) W.bales = [];
  W.nextId = W.nextId || 1;
  W.nextBale = W.nextBale || 1;
  if (W.dayOffset == null) W.dayOffset = 0;
  const seed = seedHash(String(env.seed || 'crops'));
  const emit = (t, p) => { if (env.emit) env.emit(t, p); };
  const sim = () => (env.sim ? env.sim() : null);
  const byId = new Map();

  // ---------------------------------------------------------------- geometry
  function buildGeometry(f, cellSize) {
    const poly = f.poly;
    let ang = f.angle;
    if (ang == null) {
      let best = -1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      }
      // rows run along the longest edge; normalise to (-pi/2, pi/2]
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang <= -Math.PI / 2) ang += Math.PI;
      f.angle = ang;
    }
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) {
      const u = x * ux + y * uy, v = x * vx + y * vy;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    let cell = cellSize;
    while (((u1 - u0) / cell) * ((v1 - v0) / cell) > 400000) cell *= 1.5;
    const nu = Math.max(1, Math.ceil((u1 - u0) / cell)), nv = Math.max(1, Math.ceil((v1 - v0) / cell));
    f.grid = { cell, nu, nv, ux, uy, vx, vy, u0, v0, ox: u0 * ux + v0 * vx, oy: u0 * uy + v0 * vy };
    f.bbox = { x0, y0, x1, y1 };
  }
  /** world centre of cell index */
  function cellCenter(f, i) {
    const G = f.grid;
    const ci = i % G.nu, cj = (i / G.nu) | 0;
    const a = (ci + 0.5) * G.cell, b = (cj + 0.5) * G.cell;
    return [G.ox + a * G.ux + b * G.vx, G.oy + a * G.uy + b * G.vy];
  }
  /** fractional grid coords of a world point */
  function toGrid(f, x, y) {
    const G = f.grid;
    return [(x * G.ux + y * G.uy - G.u0) / G.cell, (x * G.vx + y * G.vy - G.v0) / G.cell];
  }
  function cellIndexAt(f, x, y) {
    const G = f.grid;
    if (x < f.bbox.x0 || y < f.bbox.y0 || x > f.bbox.x1 || y > f.bbox.y1) return -1;
    const [gi, gj] = toGrid(f, x, y);
    const i = Math.floor(gi), j = Math.floor(gj);
    if (i < 0 || j < 0 || i >= G.nu || j >= G.nv) return -1;
    const k = j * G.nu + i;
    return f.cells.state[k] ? k : -1;
  }

  function allocCells(f) {
    const N = f.grid.nu * f.grid.nv;
    const c = { size: f.grid.cell, nu: f.grid.nu, nv: f.grid.nv };
    for (const [k, T] of ARRAYS) c[k] = new T(N);
    c.vis = new Uint16Array(N);
    c.edge = new Uint8Array(N);
    c.var = new Float32Array(N);
    f.cells = c;
    return c;
  }
  function computeStatic(f) {
    const c = f.cells, G = f.grid;
    const fs = seedHash(f.id) ^ seed;
    let n = 0;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nu; i++) {
      const k = j * G.nu + i;
      if (!c.state[k]) continue;
      n++;
      let e = 0;
      for (let dj = -1; dj <= 1 && !e; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv || !c.state[jj * G.nu + ii]) { e = 1; break; }
      }
      c.edge[k] = e;
      // yield patchiness: smooth-ish blend of a coarse lattice + per-cell jitter, 0.88..1.12
      const coarse = hash01(fs, (i / 7) | 0, (j / 7) | 0) * 0.6 + hash01(fs + 1, (i / 3) | 0, (j / 3) | 0) * 0.4;
      c.var[k] = 0.88 + 0.2 * coarse + 0.04 * hash01(fs + 2, i, j);
      // edges yield a bit less (headland compaction, shading)
      if (e) c.var[k] *= 0.93;
    }
    f.nCells = n;
    f.cellArea = G.cell * G.cell;
    f.area = n * f.cellArea;
  }

  // ---------------------------------------------------------------- per-cell helpers
  function visKey(c, k) {
    const s = c.state[k];
    if (!s) return 0;
    const crop = c.crop[k];
    let st = 0;
    if (s === S.SOWN) {
      const id = cropOf(crop);
      st = stageOf(id, c.growth[k]);
      if (st === 4 && CROPS[id].podsAt && c.growth[k] >= CROPS[id].podsAt) st = 6; // rapeseed pods
    }
    const weedy = c.weeds[k] > 0.45 ? 1 : 0;
    const lying = c.mass[k] > 1 ? 1 : 0;
    return 1 + s * 1200 + crop * 100 + st * 4 + weedy * 2 + lying;
  }
  function touch(f, k) {
    const c = f.cells;
    const v = visKey(c, k);
    if (v !== c.vis[k]) { c.vis[k] = v; if (env.onDirty) env.onDirty(f, k); }
  }
  function setState(f, k, s) {
    const c = f.cells;
    const o = c.state[k];
    if (o === s) return;
    f.counts[o]--; f.counts[s]++;
    c.state[k] = s;
  }
  function soilF(f) { return 0.9 + 0.25 * f.soilQ; }
  function yieldKgCell(f, k) {
    const c = f.cells, id = cropOf(c.crop[k]);
    if (!id) return 0;
    const C = CROPS[id];
    const perHa = C.kind === 'grass' ? C.yieldT / (C.cuts || 3) : C.yieldT;
    return perHa * 1000 * (f.cellArea / 1e4) * soilF(f) * clamp(c.health[k], 0, 1.1) * c.var[k];
  }

  // ---------------------------------------------------------------- fields
  function newField(poly, opts = {}) {
    const f = {
      id: opts.id || `crops:${W.nextId++}`,
      poly: poly.map((p) => [+p[0], +p[1]]),
      angle: opts.angle != null ? opts.angle : null,
      parcelId: opts.parcelId || null,
      name: opts.name || null,
      crop: null, stage: 'grass', growth: 0, readiness: 0,
      soil: { moisture: 0.5, fertility: 0.4, weeds: 0.05 },
      sownDay: null, lastWorked: null,
      counts: new Array(STATE_NAMES.length).fill(0),
      baleAcc: { hay: 0, straw: 0 },
      notified: { ripe: false, withered: false },
      version: 0,
    };
    buildGeometry(f, opts.cell || 2);
    return f;
  }

  function createField(poly, opts = {}) {
    if (!Array.isArray(poly) || poly.length < 3) throw new Error('createField: poly needs ≥ 3 points');
    const f = newField(poly, opts);
    const c = allocCells(f);
    const G = f.grid;
    const s0 = S[String(opts.state || 'grass').toUpperCase()] || S.GRASS;
    // parcel + soil quality
    const sm = sim();
    if (!f.parcelId && sm && sm.parcelAt) {
      let cx = 0, cy = 0;
      for (const p of f.poly) { cx += p[0]; cy += p[1]; }
      const pa = sm.parcelAt(cx / f.poly.length, cy / f.poly.length);
      if (pa) f.parcelId = pa.id;
    }
    let q = opts.soil;
    if (q == null && f.parcelId && sm && sm.parcel) {
      const pa = sm.parcel(f.parcelId);
      if (pa) q = typeof pa.soil === 'object' ? pa.soil.quality : pa.soil;
    }
    f.soilQ = clamp(q == null ? 0.6 : +q, 0, 1);
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nu; i++) {
      const k = j * G.nu + i;
      const [x, y] = cellCenter(f, k);
      if (!pointInPoly(x, y, f.poly)) continue;
      c.state[k] = s0;
      const base = env.moistureAt ? clamp(+env.moistureAt(x, y) || 0.5, 0, 1) : 0.5;
      c.moist[k] = 0.3 + 0.4 * base;
      c.fert[k] = 0.25 + 0.25 * f.soilQ;
      c.weeds[k] = 0.05;
      c.health[k] = 1;
    }
    let bm = 0, nb = 0;
    for (let k = 0; k < c.state.length; k++) if (c.state[k]) { bm += c.moist[k]; nb++; }
    f.baseMoist = nb ? bm / nb : 0.5;
    computeStatic(f);
    f.counts.fill(0);
    for (let k = 0; k < c.state.length; k++) f.counts[c.state[k]]++;
    for (let k = 0; k < c.state.length; k++) c.vis[k] = visKey(c, k);
    W.fields.push(f);
    byId.set(f.id, f);
    if (env.onField) env.onField(f, 'add');
    if (opts.crop) plantAll(f.id, opts.crop, opts.stage != null ? opts.stage : 'auto');
    summarize(f);
    emit('crops:field-changed', { id: f.id, change: 'created', area: f.area });
    return f.id;
  }

  function removeField(id) {
    const f = byId.get(id);
    if (!f) return false;
    W.fields.splice(W.fields.indexOf(f), 1);
    byId.delete(id);
    W.bales = W.bales.filter((b) => b.fieldId !== id);
    if (env.onField) env.onField(f, 'remove');
    emit('crops:field-changed', { id, change: 'removed' });
    return true;
  }

  function fieldAtObj(x, y) {
    for (let n = W.fields.length - 1; n >= 0; n--) {
      const f = W.fields[n];
      if (cellIndexAt(f, x, y) >= 0) return f;
    }
    return null;
  }

  // ---------------------------------------------------------------- summary
  function summarize(f) {
    const c = f.cells;
    const cropCount = {};
    let g = 0, ng = 0, exp = 0, mo = 0, fe = 0, we = 0, n = 0;
    for (let k = 0; k < c.state.length; k++) {
      const s = c.state[k];
      if (!s) continue;
      n++; mo += c.moist[k]; fe += c.fert[k]; we += c.weeds[k];
      if (s === S.SOWN || s === S.RIPE) {
        const id = cropOf(c.crop[k]);
        cropCount[id] = (cropCount[id] || 0) + 1;
        g += c.growth[k]; ng++;
        exp += yieldKgCell(f, k);
      }
    }
    let crop = null, best = 0;
    for (const [id, v] of Object.entries(cropCount)) if (v > best) { best = v; crop = id; }
    f.crop = crop;
    f.growth = ng ? g / ng : 0;
    f.readiness = ng ? f.counts[S.RIPE] / ng : 0;
    f.expectedYieldKg = Math.round(exp);
    f.soil = { moisture: n ? +(mo / n).toFixed(3) : 0, fertility: n ? +(fe / n).toFixed(3) : 0, weeds: n ? +(we / n).toFixed(3) : 0 };
    // dominant state
    let ds = 0, dn = -1;
    for (let s = 1; s < f.counts.length; s++) if (f.counts[s] > dn) { dn = f.counts[s]; ds = s; }
    f.state = STATE_NAMES[ds];
    if ((ds === S.SOWN || ds === S.RIPE) && crop) {
      const st = stageOf(crop, f.growth >= 0.999 && f.readiness > 0.5 ? 1 : Math.min(0.999, f.growth));
      f.stageIndex = st;
      f.stage = CROPS[crop].stageNames[st];
    } else { f.stageIndex = -1; f.stage = STATE_NAMES[ds]; }
    f.version++;
  }

  // ---------------------------------------------------------------- work
  const TOOLS = ['plough', 'cultivate', 'seed', 'fertilise', 'spray', 'harvest', 'mow', 'rake', 'bale', 'water'];

  function applyCell(f, k, op, cropK, out) {
    const c = f.cells;
    const s = c.state[k];
    const cid = cropOf(c.crop[k]);
    const C = cid ? CROPS[cid] : null;
    switch (op) {
      case 'plough':
        if (s === S.PLOUGHED) return false;
        if (c.mass[k] > 0 || s === S.WITHERED || s === S.GRASS || s === S.MOWN || s === S.WINDROW) c.fert[k] = Math.min(1, c.fert[k] + 0.04); // residue / sward turned in
        setState(f, k, S.PLOUGHED);
        c.crop[k] = 0; c.growth[k] = 0; c.weeds[k] = 0; c.mass[k] = 0; c.age[k] = 0;
        return true;
      case 'cultivate':
        if (!(s === S.GRASS || s === S.STUBBLE || s === S.PLOUGHED || s === S.WITHERED || s === S.MOWN || s === S.WINDROW)) return false;
        setState(f, k, S.CULTIVATED);
        c.crop[k] = 0; c.growth[k] = 0; c.weeds[k] *= 0.4; c.mass[k] = 0; c.age[k] = 0;
        return true;
      case 'seed': {
        if (!(s === S.CULTIVATED || s === S.PLOUGHED)) return false;
        const id = cropOf(cropK);
        const inWin = inSowWindow(id, out.doy);
        setState(f, k, S.SOWN);
        c.crop[k] = cropK; c.growth[k] = 0; c.age[k] = 0;
        // seedbed quality: a rough ploughed bed and sowing out of season both cost establishment
        c.health[k] = (s === S.PLOUGHED ? 0.92 : 1) * (inWin ? 1 : 0.82);
        return true;
      }
      case 'fertilise':
        if (c.fert[k] >= 0.9) return false;
        c.fert[k] = Math.min(1, c.fert[k] + 0.45);
        return true;
      case 'spray':
        if (c.weeds[k] < 0.03) return false;
        c.weeds[k] = 0;
        return true;
      case 'water':
        if (c.moist[k] >= 0.95) return false;
        c.moist[k] = Math.min(1, c.moist[k] + 0.3);
        return true;
      case 'harvest':
        if (C && C.kind === 'grass') return applyCell(f, k, 'mow', cropK, out);
        if (s === S.RIPE) {
          const kg = yieldKgCell(f, k);
          out.kg += kg; out.item = C.product;
          out.byItem[C.product] = (out.byItem[C.product] || 0) + kg;
          const straw = C.strawT * 1000 * (f.cellArea / 1e4) * (0.8 + 0.2 * clamp(c.health[k], 0, 1));
          out.strawKg += straw;
          setState(f, k, C.kind === 'root' ? S.CULTIVATED : S.STUBBLE);
          c.mass[k] = C.kind === 'root' ? 0 : straw;
          c.growth[k] = 0; c.age[k] = 0;
          c.crop[k] = C.kind === 'root' ? 0 : c.crop[k]; // stubble remembers what it was (look)
          return true;
        }
        if (s === S.WITHERED) { // clears the rotten crop, nothing worth selling
          setState(f, k, C && C.kind === 'root' ? S.CULTIVATED : S.STUBBLE);
          c.mass[k] = 0; c.growth[k] = 0; c.age[k] = 0;
          return true;
        }
        return false;
      case 'mow': {
        const grassy = s === S.GRASS || ((s === S.SOWN || s === S.RIPE) && C && C.kind === 'grass' && (s === S.RIPE || c.growth[k] >= MOW_MIN_GROWTH));
        if (!grassy) return false;
        let kg;
        if (s === S.GRASS) { // unmanaged sward: rough meadow hay
          const G = CROPS.grass;
          kg = (G.yieldT / G.cuts) * 1000 * (f.cellArea / 1e4) * 0.6 * c.var[k];
          c.health[k] = 0.9;
        } else {
          kg = yieldKgCell(f, k) * Math.min(1.15, c.growth[k] + (s === S.RIPE ? 0.1 : 0));
        }
        setState(f, k, S.MOWN);
        c.crop[k] = CROP_INDEX.grass; c.mass[k] = kg; c.growth[k] = REGROW; c.age[k] = 0;
        out.mownKg += kg;
        return true;
      }
      case 'rake':
        if (s !== S.MOWN) return false;
        setState(f, k, S.WINDROW);
        return true;
      case 'bale': {
        let item = null, eff = 1;
        if (s === S.WINDROW) item = 'hay';
        else if (s === S.MOWN && c.mass[k] > 0) { item = 'hay'; eff = 0.85; } // picking up an un-raked swath loses some
        else if (s === S.STUBBLE && c.mass[k] > 0) item = 'straw';
        if (!item) return false;
        const kg = c.mass[k] * eff;
        out.baleKg[item] = (out.baleKg[item] || 0) + kg;
        c.mass[k] = 0;
        if (s !== S.STUBBLE) { setState(f, k, S.SOWN); c.crop[k] = CROP_INDEX.grass; c.growth[k] = Math.max(c.growth[k], REGROW); c.age[k] = 0; }
        return true;
      }
      default: return false;
    }
  }

  /**
   * work(tool, x, y, width, rot, len?) — sweeps a width × len rectangle centred on (x,y), heading rot
   * (0 = north, clockwise). The cell under (x,y) is always included (so hand tools of 1 m work on 2 m cells).
   */
  function work(tool, x, y, width = 3, rot = 0, len) {
    const res = { cellsChanged: 0, yieldKg: 0, item: null, fieldId: null };
    if (typeof tool !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return res;
    let op = tool, cropK = 0;
    if (tool.startsWith('seed')) {
      op = 'seed';
      const id = tool.split(':')[1] || 'wheat';
      cropK = CROP_INDEX[id === 'hay' ? 'grass' : id];
      if (!cropK) return res;
    } else if (tool === 'fertilize') op = 'fertilise';
    else if (tool === 'till' || tool === 'harrow' || tool === 'hoe') op = 'cultivate';
    if (!TOOLS.includes(op)) return res;
    width = Math.max(0.05, +width || 1);
    const hl = Math.max(0.5, (+len || 1.2) / 2), hw = width / 2;
    const hx = Math.sin(rot || 0), hy = -Math.cos(rot || 0);   // heading
    const px = -hy, py = hx;                                   // right-hand perpendicular
    const ex = Math.abs(hx) * hl + Math.abs(px) * hw, ey = Math.abs(hy) * hl + Math.abs(py) * hw;
    const now = env.now();
    const out = { kg: 0, item: null, byItem: {}, strawKg: 0, mownKg: 0, baleKg: {}, doy: now.doy };
    const touched = [];
    for (const f of W.fields) {
      const b = f.bbox;
      if (x + ex < b.x0 || x - ex > b.x1 || y + ey < b.y0 || y - ey > b.y1) continue;
      const G = f.grid, c = f.cells;
      // grid-space bounds of the swath
      let gi0 = Infinity, gi1 = -Infinity, gj0 = Infinity, gj1 = -Infinity;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const wx = x + hx * hl * sx + px * hw * sy, wy = y + hy * hl * sx + py * hw * sy;
        const [gi, gj] = toGrid(f, wx, wy);
        gi0 = Math.min(gi0, gi); gi1 = Math.max(gi1, gi); gj0 = Math.min(gj0, gj); gj1 = Math.max(gj1, gj);
      }
      const i0 = Math.max(0, Math.floor(gi0 - 0.5)), i1 = Math.min(G.nu - 1, Math.ceil(gi1));
      const j0 = Math.max(0, Math.floor(gj0 - 0.5)), j1 = Math.min(G.nv - 1, Math.ceil(gj1));
      const kHere = cellIndexAt(f, x, y);
      let changed = 0;
      const before = out.kg;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * G.nu + i;
        if (!c.state[k]) continue;
        if (k !== kHere) {
          const [cx, cy] = cellCenter(f, k);
          const dx = cx - x, dy = cy - y;
          if (Math.abs(dx * hx + dy * hy) > hl || Math.abs(dx * px + dy * py) > hw) continue;
        }
        if (applyCell(f, k, op, cropK, out)) { changed++; touch(f, k); }
      }
      if (!changed) continue;
      touched.push({ f, changed, kg: out.kg - before });
      res.cellsChanged += changed;
      if (!res.fieldId) res.fieldId = f.id;
      f.lastWorked = now.t;
      if (op === 'seed' && (f.sownDay == null || f.counts[S.SOWN] + f.counts[S.RIPE] === changed)) { f.sownDay = now.day; f.notified.ripe = false; f.notified.withered = false; }
    }
    if (!res.cellsChanged) return res;
    // bales from accumulated swath mass
    const bales = [];
    for (const [item, kg] of Object.entries(out.baleKg)) {
      const f = touched[0].f;
      f.baleAcc[item] = (f.baleAcc[item] || 0) + kg;
      res.yieldKg += kg; res.item = item;
      while (f.baleAcc[item] >= BALE_KG[item]) {
        f.baleAcc[item] -= BALE_KG[item];
        const b = { id: `crops:bale:${W.nextBale++}`, x: +(x - hx * 2.2).toFixed(2), y: +(y - hy * 2.2).toFixed(2), rot: rot || 0, item, kg: BALE_KG[item], fieldId: f.id };
        W.bales.push(b); bales.push(b);
      }
    }
    if (bales.length) res.bales = bales;
    if (op === 'harvest') {
      res.yieldKg = +out.kg.toFixed(2);
      res.item = out.item;
      if (Object.keys(out.byItem).length > 1) res.byItem = out.byItem;
      if (out.strawKg) res.strawKg = +out.strawKg.toFixed(2);
      if (out.mownKg) { res.mownKg = +out.mownKg.toFixed(2); if (!res.item) res.item = 'hay'; }
    }
    if (op === 'mow') { res.mownKg = +out.mownKg.toFixed(2); res.item = 'hay'; res.yieldKg = 0; }
    if (res.yieldKg) res.yieldKg = +res.yieldKg.toFixed(2);
    for (const t of touched) {
      const f = t.f;
      const wasSown = f.counts[S.SOWN] + f.counts[S.RIPE] - (op === 'seed' ? t.changed : 0);
      summarize(f);
      queue('crops:worked', 'w|' + f.id + '|' + tool, now.t, { fieldId: f.id, parcelId: f.parcelId, tool, cells: t.changed, areaM2: t.changed * f.cellArea, x, y }, ['cells', 'areaM2']);
      if (op === 'seed') {
        const crop = cropOf(cropK);
        if (!wasSown) emit('crops:sown', { fieldId: f.id, crop, phase: 'start', sownCells: f.counts[S.SOWN], cells: f.nCells });
        if (f.counts[S.SOWN] + f.counts[S.RIPE] >= f.nCells) emit('crops:sown', { fieldId: f.id, crop, phase: 'complete', sownCells: f.counts[S.SOWN], cells: f.nCells });
      }
      if (op === 'harvest' && t.kg > 0) {
        const done = f.counts[S.RIPE] === 0;
        queue('crops:harvested', 'h|' + f.id, now.t, { fieldId: f.id, crop: f.crop || cropOfLast(out), item: out.item, kg: t.kg, cells: t.changed, x, y, remainingRipe: f.counts[S.RIPE], complete: done }, ['kg', 'cells'], done);
      }
      reportJobs(f, op, cropK);
    }
    if (bales.length) emit('crops:harvested', { fieldId: touched[0].f.id, item: res.item, kg: bales.length * BALE_KG[res.item], bales: bales.map((b) => b.id), x, y });
    return res;
  }
  function cropOfLast(out) { return out.item; }

  // ---- event coalescing: a tractor calls work() 60×/s; listeners get ≤ 1 event per field+tool per game minute
  const pending = new Map();
  function queue(type, key, t, payload, sumKeys, force) {
    let p = pending.get(key);
    if (!p) { p = { type, t0: t, payload: { ...payload } }; pending.set(key, p); }
    else { for (const k of sumKeys) p.payload[k] += payload[k]; for (const k of Object.keys(payload)) if (!sumKeys.includes(k)) p.payload[k] = payload[k]; }
    if (force || t - p.t0 >= 60) flushKey(key);
  }
  function flushKey(key) {
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    if (typeof p.payload.kg === 'number') p.payload.kg = +p.payload.kg.toFixed(2);
    emit(p.type, p.payload);
  }
  /** emit coalesced events that are older than 60 game-s (all when force) */
  function flush(t, force) {
    for (const [key, p] of [...pending]) if (force || t - p.t0 >= 60) flushKey(key);
  }

  /**
   * apply one operation to a whole field at once (contractors). tool as in work(); returns the
   * same shape as work() plus bale kg (no bale objects: the contractor takes them to the farm).
   */
  function workField(fieldId, tool, { report = true, maxAreaM2 = Infinity } = {}) {
    const f = byId.get(fieldId);
    const res = { cellsChanged: 0, yieldKg: 0, item: null, fieldId, strawKg: 0, baleKg: {} };
    if (!f) return res;
    let op = tool, cropK = 0;
    if (tool.startsWith('seed')) { op = 'seed'; cropK = CROP_INDEX[tool.split(':')[1] || 'wheat'] || CROP_INDEX.wheat; }
    const now = env.now();
    const out = { kg: 0, item: null, byItem: {}, strawKg: 0, mownKg: 0, baleKg: {}, doy: now.doy };
    const c = f.cells;
    // serpentine lanes along the rows, like a machine working the field, until the booked area is done
    const G = f.grid;
    const maxCells = Number.isFinite(maxAreaM2) ? Math.max(0, Math.round(maxAreaM2 / f.cellArea)) : Infinity;
    for (let j = 0; j < G.nv && res.cellsChanged < maxCells; j++) {
      for (let q = 0; q < G.nu && res.cellsChanged < maxCells; q++) {
        const k = j * G.nu + (j % 2 ? G.nu - 1 - q : q);
        if (c.state[k] && applyCell(f, k, op, cropK, out)) { res.cellsChanged++; touch(f, k); }
      }
    }
    res.areaM2 = res.cellsChanged * f.cellArea;
    if (!res.cellsChanged) return res;
    f.lastWorked = now.t;
    if (op === 'seed') { f.sownDay = now.day; f.notified.ripe = false; f.notified.withered = false; }
    summarize(f);
    res.yieldKg = +(op === 'bale' ? Object.values(out.baleKg).reduce((a, b) => a + b, 0) : out.kg).toFixed(2);
    res.item = op === 'bale' ? Object.keys(out.baleKg)[0] || null : out.item;
    res.strawKg = +out.strawKg.toFixed(2); res.baleKg = out.baleKg; res.mownKg = +out.mownKg.toFixed(2);
    emit('crops:worked', { fieldId: f.id, parcelId: f.parcelId, tool, cells: res.cellsChanged, areaM2: res.areaM2, contractor: true });
    if (op === 'seed') emit('crops:sown', { fieldId: f.id, crop: cropOf(cropK), phase: 'complete', sownCells: f.counts[S.SOWN], cells: f.nCells });
    if ((op === 'harvest' && out.kg > 0) || (op === 'bale' && res.yieldKg > 0)) emit('crops:harvested', { fieldId: f.id, crop: f.crop, item: res.item, kg: res.yieldKg, cells: res.cellsChanged, complete: true, contractor: true });
    if (report) reportJobs(f, op, cropK);
    return res;
  }

  // ---------------------------------------------------------------- jobs (simulation)
  function jobFraction(type, parcelId) {
    let n = 0, done = 0;
    for (const f of W.fields) {
      if (f.parcelId !== parcelId) continue;
      const C = f.counts;
      n += f.nCells;
      if (type === 'plough') done += C[S.PLOUGHED] + C[S.CULTIVATED];
      else if (type === 'sow') done += C[S.SOWN] + C[S.RIPE];
      else if (type === 'harvest') done += f.nCells - C[S.RIPE] - C[S.WITHERED] - C[S.SOWN];
      else if (type === 'mow') done += C[S.MOWN] + C[S.WINDROW];
    }
    return n ? done / n : 0;
  }
  function reportJobs(f, op, cropK) {
    const sm = sim();
    if (!sm || !f.parcelId || !sm.jobs || !sm.reportProgress) return;
    const type = op === 'seed' ? 'sow' : TOOL_JOB[op];
    if (!type) return;
    const list = sm.jobs({ status: 'accepted', parcelId: f.parcelId, type }) || [];
    for (const j of list) {
      if (type === 'sow' && j.crop && cropOf(cropK) !== j.crop) continue;
      const frac = jobFraction(type, f.parcelId);
      let delta = frac - (j.progress || 0);
      if (frac >= 0.97) delta = 1 - (j.progress || 0);
      if (delta > 0.0005) sm.reportProgress(j.id, delta);
    }
  }

  // ---------------------------------------------------------------- daily growth
  /** process one game day (absolute index `day`), with `rainMm` of rain that day */
  function dayTick(day, rainMm = 0) {
    beginDay(day, rainMm);
    stepDay(Infinity);
  }
  // incremental day processing so a big farm never costs one long frame: beginDay() then stepDay(cells) per update
  let dayJob = null;
  function beginDay(day, rainMm = 0) {
    if (dayJob) stepDay(Infinity);
    dayJob = { day, rainMm, fields: W.fields.slice(), fi: 0, k: 0 };
  }
  /** process up to `budget` cells of the pending day; returns true when the day is finished */
  function stepDay(budget) {
    const J = dayJob;
    if (!J) return true;
    while (J.fi < J.fields.length && budget > 0) {
      const f = J.fields[J.fi];
      if (!byId.has(f.id)) { J.fi++; J.k = 0; continue; }
      const N = f.cells.state.length;
      const k1 = Math.min(N, J.k + budget);
      tickCells(f, J.k, k1, J.day, J.rainMm);
      budget -= k1 - J.k;
      J.k = k1;
      if (J.k >= N) { finishField(f, J.day); J.fi++; J.k = 0; }
    }
    if (J.fi >= J.fields.length) { W.day = J.day; dayJob = null; return true; }
    return false;
  }
  function tickCells(f, k0, k1, day, rainMm) {
    const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    const m = monthOfDoy(doy);
    const evap = 0.2 + 0.25 * UNITS.cool[m];
    const wet = rainMm / 30;
    {
      const c = f.cells;
      for (let k = k0; k < k1; k++) {
        const s = c.state[k];
        if (!s) continue;
        c.moist[k] = clamp(c.moist[k] * (1 - evap) + wet + f.baseMoist * 0.06, 0, 1);
        switch (s) {
          case S.SOWN: {
            const id = cropOf(c.crop[k]);
            const C = CROPS[id];
            const u = UNITS[C.units][m];
            if (C.frostKill && u === 0 && c.growth[k] > 0.06) { setState(f, k, S.WITHERED); c.age[k] = 0; break; }
            const mf = moistF(c.moist[k]), ff = fertF(c.fert[k]);
            const dg = (u / C.need) * (0.35 + 0.65 * mf) * (0.85 + 0.15 * ff);
            c.growth[k] += dg;
            c.fert[k] = Math.max(0, c.fert[k] - dg * 0.55);
            c.weeds[k] = Math.min(1, c.weeds[k] + 0.02 * u * (1 - 0.6 * Math.min(1, c.growth[k])));   // canopy shades weeds out
            const q = mf * ff * (1 - 0.4 * c.weeds[k]);
            c.health[k] += (q - c.health[k]) * Math.min(1, dg * 2.2);
            if (c.growth[k] >= 1) { c.growth[k] = 1; setState(f, k, S.RIPE); c.age[k] = 0; }
            break;
          }
          case S.RIPE: {
            const C = CROPS[cropOf(c.crop[k])];
            if (c.age[k] < 250) c.age[k]++;
            if (C && C.witherDays > 0 && c.age[k] > C.witherDays) { setState(f, k, S.WITHERED); c.age[k] = 0; }
            break;
          }
          case S.MOWN: case S.WINDROW:
            if (c.age[k] < 250) c.age[k]++;
            c.mass[k] *= rainMm > 8 ? 0.85 : 0.96;      // hay left out loses quality, faster in the rain
            if (c.age[k] > 8) { setState(f, k, S.SOWN); c.mass[k] = 0; c.crop[k] = CROP_INDEX.grass; c.growth[k] = REGROW; }
            break;
          case S.STUBBLE:
            c.mass[k] *= 0.93;                           // straw swaths weather away
            if (c.mass[k] < 1) c.mass[k] = 0;
            c.weeds[k] = Math.min(1, c.weeds[k] + 0.02 * UNITS.cool[m]);
            break;
          case S.CULTIVATED: case S.PLOUGHED:
            c.weeds[k] = Math.min(1, c.weeds[k] + 0.025 * UNITS.cool[m]);
            break;
          case S.WITHERED:
            if (c.age[k] < 250) c.age[k]++;
            break;
          default: break;
        }
        touch(f, k);
      }
    }
  }
  function finishField(f, day) {
    {
      summarize(f);
      if (!f.counts[S.RIPE] && f.counts[S.SOWN]) f.notified.ripe = false;   // grass regrowth → can ripen again
      if (!f.counts[S.WITHERED]) f.notified.withered = false;
      const grown = f.counts[S.SOWN] + f.counts[S.RIPE] + f.counts[S.WITHERED];
      if (grown && !f.notified.ripe && f.counts[S.RIPE] >= grown * 0.5) {
        f.notified.ripe = true;
        emit('crops:ripe', { fieldId: f.id, crop: f.crop, day, expectedYieldKg: f.expectedYieldKg });
      }
      if (!f.notified.withered && f.counts[S.WITHERED] >= f.nCells * 0.5) {
        f.notified.withered = true;
        emit('crops:withered', { fieldId: f.id, crop: f.crop || cropOfWithered(f), day });
      }
    }
  }
  function cropOfWithered(f) {
    const c = f.cells;
    for (let k = 0; k < c.state.length; k++) if (c.state[k] === S.WITHERED) return cropOf(c.crop[k]);
    return null;
  }

  // ---------------------------------------------------------------- forcing (showcase / demo)
  function plantAll(fieldId, crop, stage = 'sown') {
    const f = byId.get(fieldId);
    if (!f) return false;
    if (crop === 'hay') crop = 'grass';
    const ck = CROP_INDEX[crop];
    if (!ck) return false;
    const c = f.cells;
    let g, state = S.SOWN;
    if (stage === 'auto') {
      g = calendarGrowth(crop, env.now().doy);
      if (g == null) { // out of season: leave the ground as it would be (stubble after harvest)
        const C = CROPS[crop];
        return forceStage(fieldId, C.kind === 'root' ? 'cultivated' : C.kind === 'grass' ? 'grass' : 'stubble', crop);
      }
    } else if (typeof stage === 'number') g = stage >= 5 ? 1 : growthForStage(crop, stage);
    else if (stage === 'ripe') g = 1;
    else if (stage === 'withered') { g = 1; state = S.WITHERED; }
    else if (stage === 'sown') g = 0;
    else if (stage === 'pods') g = CROPS[crop].podsAt ? (CROPS[crop].podsAt + 1) / 2 : growthForStage(crop, 4);
    else { const idx = CROPS[crop].stageNames.indexOf(stage); g = idx >= 0 ? growthForStage(crop, idx) : 0; }
    for (let k = 0; k < c.state.length; k++) {
      if (!c.state[k]) continue;
      const st = state === S.WITHERED ? S.WITHERED : g >= 1 ? S.RIPE : S.SOWN;
      setState(f, k, st);
      c.crop[k] = ck; c.growth[k] = g; c.age[k] = 0; c.mass[k] = 0; c.health[k] = 1;
      // a little natural spread in development
      if (st === S.SOWN && g > 0.02) c.growth[k] = clamp(g + (c.var[k] - 1) * 0.08, 0.001, 0.995);
      touch(f, k);
    }
    f.sownDay = env.now().day;
    f.notified.ripe = g >= 1; f.notified.withered = state === S.WITHERED;
    summarize(f);
    return true;
  }

  function forceStage(fieldId, stage, cropOpt) {
    const f = byId.get(fieldId);
    if (!f) return false;
    const crop = cropOpt || f.crop || 'wheat';
    if (typeof stage === 'number' || stage === 'ripe' || stage === 'sown' || stage === 'pods' || (CROPS[crop] && CROPS[crop].stageNames.includes(stage)) || stage === 'withered') {
      return plantAll(fieldId, crop, stage);
    }
    const s = stage === 'harvested' ? S.STUBBLE : S[String(stage).toUpperCase()];
    if (!s) return false;
    const c = f.cells;
    const ck = CROP_INDEX[crop] || 0;
    const C = CROPS[crop];
    for (let k = 0; k < c.state.length; k++) {
      if (!c.state[k]) continue;
      setState(f, k, s);
      c.growth[k] = s === S.MOWN || s === S.WINDROW ? REGROW : 0; c.age[k] = 0;
      c.crop[k] = s === S.STUBBLE || s === S.MOWN || s === S.WINDROW ? (s === S.STUBBLE ? ck : CROP_INDEX.grass) : 0;
      c.mass[k] = 0;
      if (s === S.MOWN || s === S.WINDROW) c.mass[k] = (CROPS.grass.yieldT / CROPS.grass.cuts) * 1000 * f.cellArea / 1e4;
      if (s === S.STUBBLE && stage === 'harvested' && C && C.strawT) c.mass[k] = C.strawT * 1000 * f.cellArea / 1e4;
      touch(f, k);
    }
    summarize(f);
    return true;
  }

  /** recompute summary + visuals of a field after direct edits of its cell arrays */
  function refresh(fieldId) {
    const f = byId.get(fieldId);
    if (!f) return false;
    for (let k = 0; k < f.cells.state.length; k++) touch(f, k);
    summarize(f);
    return true;
  }

  // ---------------------------------------------------------------- queries
  function stats(fieldId) {
    const f = byId.get(fieldId);
    if (!f) return null;
    summarize(f);
    const counts = {};
    STATE_NAMES.forEach((n, i) => { if (i && f.counts[i]) counts[n] = f.counts[i]; });
    const C = f.crop ? CROPS[f.crop] : null;
    let daysToRipe = null;
    if (C && f.growth < 1) {
      // rough: assume nominal conditions from today
      let g = f.growth, d = 0;
      const doy0 = env.now().doy;
      while (g < 1 && d < 72) { d++; g += UNITS[C.units][monthOfDoy(doy0 + d)] / C.need * 0.95; }
      daysToRipe = d < 72 ? d : null;
    }
    return {
      id: f.id, name: f.name, parcelId: f.parcelId, area: +f.area.toFixed(1), ha: +(f.area / 1e4).toFixed(3),
      crop: f.crop, cropName: C ? C.name : null, state: f.state, stage: f.stage, stageIndex: f.stageIndex,
      growth: +f.growth.toFixed(3), readiness: +f.readiness.toFixed(3),
      expectedYieldKg: f.expectedYieldKg, expectedItem: C ? C.product : null,
      expectedYieldPerHa: f.area && f.readiness + f.growth > 0 ? Math.round(f.expectedYieldKg / ((f.counts[S.SOWN] + f.counts[S.RIPE]) * f.cellArea / 1e4 || 1)) : 0,
      weeds: f.soil.weeds, moisture: f.soil.moisture, fertility: f.soil.fertility, soilQuality: f.soilQ,
      counts, sownDay: f.sownDay, lastWorked: f.lastWorked, daysToRipe,
      lyingKg: Math.round(sumMass(f)), cells: f.nCells, cellSize: f.grid.cell,
    };
  }
  function sumMass(f) { let m = 0; const a = f.cells.mass; for (let k = 0; k < a.length; k++) m += a[k]; return m; }

  function cellAt(x, y) {
    const f = fieldAtObj(x, y);
    if (!f) return null;
    const k = cellIndexAt(f, x, y);
    const c = f.cells;
    const id = cropOf(c.crop[k]);
    const s = c.state[k];
    return {
      fieldId: f.id, index: k, state: STATE_NAMES[s], crop: id,
      stage: s === S.SOWN && id ? CROPS[id].stageNames[stageOf(id, c.growth[k])] : STATE_NAMES[s],
      growth: +c.growth[k].toFixed(3), moisture: +c.moist[k].toFixed(3), fertility: +c.fert[k].toFixed(3),
      weeds: +c.weeds[k].toFixed(3), health: +c.health[k].toFixed(3), lyingKg: +c.mass[k].toFixed(1),
    };
  }

  // ---------------------------------------------------------------- persistence
  function save() {
    return {
      v: 1, nextId: W.nextId, nextBale: W.nextBale, day: W.day, dayOffset: W.dayOffset,
      bales: W.bales.map((b) => ({ ...b })),
      fields: W.fields.map((f) => {
        const o = { id: f.id, poly: f.poly, angle: f.angle, cell: f.grid.cell, parcelId: f.parcelId, name: f.name, soilQ: f.soilQ,
          baseMoist: f.baseMoist, plannedCrop: f.plannedCrop || null, sownDay: f.sownDay, lastWorked: f.lastWorked, baleAcc: { ...f.baleAcc }, notified: { ...f.notified }, arrays: {} };
        for (const [k] of ARRAYS) o.arrays[k] = toB64(f.cells[k]);
        return o;
      }),
    };
  }
  function load(d) {
    if (!d || !Array.isArray(d.fields)) return false;
    for (const f of W.fields.slice()) removeField(f.id);
    W.nextId = d.nextId || 1; W.nextBale = d.nextBale || 1; W.day = d.day; W.dayOffset = d.dayOffset || 0;
    for (const o of d.fields) {
      const f = newField(o.poly, { id: o.id, angle: o.angle, cell: o.cell, parcelId: o.parcelId, name: o.name });
      const c = allocCells(f);
      const N = f.grid.nu * f.grid.nv;
      for (const [k, T] of ARRAYS) c[k] = fromB64(o.arrays[k], T, N);
      f.soilQ = o.soilQ; f.baseMoist = o.baseMoist; if (o.plannedCrop) f.plannedCrop = o.plannedCrop; f.sownDay = o.sownDay; f.lastWorked = o.lastWorked;
      f.baleAcc = { ...o.baleAcc }; f.notified = { ...o.notified };
      computeStatic(f);
      f.counts.fill(0);
      for (let k = 0; k < N; k++) f.counts[c.state[k]]++;
      for (let k = 0; k < N; k++) c.vis[k] = visKey(c, k);
      W.fields.push(f); byId.set(f.id, f);
      summarize(f);
      if (env.onField) env.onField(f, 'add');
    }
    W.bales = (d.bales || []).map((b) => ({ ...b }));
    return true;
  }

  /** stable digest of all cell data (determinism tests) */
  function digest() {
    let h = 2166136261 >>> 0;
    for (const f of W.fields) for (const [k] of ARRAYS) {
      const a = f.cells[k];
      const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); }
    }
    return (h >>> 0).toString(16);
  }

  return {
    W, byId, createField, removeField, fieldAtObj, work, workField, flush, dayTick, beginDay, stepDay, pendingDay: () => (dayJob ? dayJob.day : null), plantAll, forceStage, refresh, stats, cellAt, summarize,
    save, load, digest, cellCenter, cellIndexAt, toGrid, yieldKgCell, visKey, cropOf,
    fieldPublic(f) { return f ? { id: f.id, crop: f.crop, stage: f.stage, state: f.state, parcelId: f.parcelId, area: f.area, growth: f.growth } : null; },
  };
}
