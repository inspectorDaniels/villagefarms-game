// buildings — farm and village architecture (wave 2).
// Placement with precise colliders, land rights, water/road/field rejection; functional buildings
// (homes, storage capacity, workshop repair + fuel, sell points); purchase/upkeep through simulation;
// painted top-down roofs (cached sprites), shadows, seeded night lights, chimney smoke; save/load.
import { TYPES, defOf } from './types.js';
import { createPainter } from './paint.js';
import { toWorld, partPoly, aabbOf, hull, pointInPoly, polysOverlap, circleHitsPoly, samplePoly, h01 } from './geom.js';
import { presets as SHOW_PRESETS, stage as showStage } from './showcase.js';

export const manifest = {
  id: 'buildings',
  wave: 2,
  deps: ['simulation'],
  optionalDeps: ['terrain', 'environment', 'effects', 'audio', 'ui', 'roads', 'crops', 'vehicles'],
  namespaces: ['buildings'],
  api: ['types', 'place', 'remove', 'canPlace', 'footprint', 'footprintParts', 'at', 'list', 'get', 'doorOf', 'nearest',
    'capacity', 'serviceAt', 'repairAt', 'deliver', 'homes', 'lightsOn', 'lastError'],
  emits: ['buildings:placed', 'buildings:removed'],
  listens: ['terrain:generated'],
};

const POTATO_BASE = 80;       // t of potatoes the farm holds without a potato store (clamp in the barn)
const SERVICE_R = 14;         // m around a door where services apply
const WORKSHOP_REBATE = 0.3;  // own workshop: parts at trade price
const FUEL_R = 12;
const LIT = [255, 213, 138];
const LAMP = [255, 196, 120];

export async function init(ctx) {
  const W = ctx.world.buildings;
  Object.assign(W, { list: [], counter: 0, version: 0 });
  const mod = (id) => ctx.modules.get(id);
  const sim = () => mod('simulation');
  const painter = createPainter(ctx.art, ctx.palette);
  const rt = new Map();          // id → runtime cache (polys, lights, sprites …)
  const smoke = new Map();       // id → [emitter handles]

  // ------------------------------------------------------------------ catalog
  const registered = new Set();
  function registerCatalog() {
    const S = sim();
    if (!S || !S.registerCatalogItem) return;
    for (const [type, T] of Object.entries(TYPES)) {
      T.variants.forEach((V, vi) => {
        const d = defOf(type, vi);
        const c = d.catalog;
        if (!c || c.external || registered.has(c.id)) return;
        const r = S.registerCatalogItem({ id: c.id, category: c.category, name: d.name, price: c.price, meta: { building: type, ...(c.meta || {}) } });
        if (r) registered.add(c.id);
      });
    }
  }
  registerCatalog();

  function priceOf(d) {
    if (!d || !d.catalog) return 0;
    const S = sim();
    const all = (S && S.catalog && S.catalog()) || [];
    const e = all.find((c) => c.id === d.catalog.id);
    return e ? e.price : d.catalog.price;
  }

  // ------------------------------------------------------------------ geometry of a placed building
  function doorLocal(d) {
    // main door: in front (−y) of the first body part
    const p0 = d.parts[0];
    let front = Infinity;
    for (const p of d.parts) {
      if (p.k === 'silo') front = Math.min(front, (p.y || 0) - p.r);
      else {
        const c = Math.abs(Math.cos(p.rot || 0)), s = Math.abs(Math.sin(p.rot || 0));
        const hy = (p.d / 2) * c + (p.w / 2) * s;
        if (Math.abs((p.x || 0) - (p0.x || 0)) < (p0.k === 'silo' ? p0.r : p0.w / 2)) front = Math.min(front, (p.y || 0) - hy);
      }
    }
    return [p0.x || 0, front - 0.8];
  }
  function build(b) {
    const d = defOf(b.type, b.variant);
    const polys = d.parts.map((p) => partPoly(p, b.x, b.y, b.rot));
    const bb = aabbOf(polys);
    const [dlx, dly] = doorLocal(d);
    const [dx, dy] = toWorld(b.x, b.y, b.rot, dlx, dly);
    b.doors = [{ x: +dx.toFixed(3), y: +dy.toFixed(3), rot: b.rot, main: true }];
    // lights: windows spill light around the walls, skylights glow on the roof, porch lamp at the door
    const windows = [], sky = [], chim = [], shadows = [];
    let sortY = -Infinity;
    for (const P of polys) for (const q of P) sortY = Math.max(sortY, q[1]);
    d.parts.forEach((p, pi) => {
      const [px, py] = toWorld(b.x, b.y, b.rot, p.x || 0, p.y || 0);
      const prot = b.rot + (p.rot || 0);
      if (p.k === 'gable') {
        const n = Math.max(1, Math.round(p.w / 4.5));
        for (let i = 0; i < n; i++) {
          const lx = -p.w / 2 + (i + 0.5) * (p.w / n);
          for (const side of [-1, 1]) windows.push({ ...xy(toWorld(px, py, prot, lx, side * (p.d / 2 + 0.9))), k: `${pi}:${i}:${side}` });
        }
        for (const [sx, sy] of p.sky || []) for (const sd of [-1, 1]) sky.push({ ...xy(toWorld(px, py, prot, sx, sd * sy)), k: `s${pi}:${sx}:${sd}` });
        for (const [cx, cy] of p.chim || []) chim.push({ ...xy(toWorld(px, py, prot, cx, cy)), z: p.ridge + 0.8 });
        const strip = partPoly({ k: 'gable', w: p.w + 0.9, d: p.d * 0.28 }, px, py, prot);
        shadows.push({ t: 'poly', pts: partPoly({ k: 'gable', w: p.w + 0.9, d: p.d + 0.9 }, px, py, prot), h: p.eave });
        shadows.push({ t: 'poly', pts: strip, h: p.ridge - 0.5 });
        for (const c of p.chim || []) { const [cx, cy] = toWorld(px, py, prot, c[0], c[1]); shadows.push({ t: 'box', x: cx, y: cy, w: 0.75, d: 0.9, rot: prot, h: p.ridge + 1 }); }
      } else if (p.k === 'silo') {
        shadows.push({ t: 'cyl', x: px, y: py, r: p.r, h: p.h - p.r * 0.35 });
        shadows.push({ t: 'cyl', x: px, y: py, r: p.r * 0.45, h: p.h });
      } else if (p.k === 'tower') {
        shadows.push({ t: 'box', x: px, y: py, w: p.w, d: p.d, rot: prot, h: p.h * 0.55 });
        shadows.push({ t: 'box', x: px, y: py, w: p.w * 0.45, d: p.d * 0.45, rot: prot, h: p.h * 0.85 });
        shadows.push({ t: 'box', x: px, y: py, w: 0.4, d: 0.4, rot: prot, h: p.h });
      }
    });
    const porch = d.porch ? [{ ...xy(toWorld(b.x, b.y, b.rot, dlx + 1.2, dly + 0.5)) }] : [];
    const r = { def: d, polys, bb, windows, sky, chim, porch, shadows, sortY, hull: hull(polys.flat()) };
    rt.set(b.id, r);
    return r;
  }
  function xy([x, y]) { return { x, y }; }

  function spatialInsert(b, r) {
    const polys = r.polys;
    ctx.spatial.insert({
      id: b.id, kind: 'building', ...r.bb, solid: true,
      poly: polys.length === 1 ? polys[0] : undefined, polys: polys.length > 1 ? polys : undefined,
      data: { buildingId: b.id, type: b.type, poly: polys.length === 1 ? polys[0] : undefined, polys: polys.length > 1 ? polys : undefined },
    });
  }

  // ------------------------------------------------------------------ functions (simulation / vehicles)
  /** a store only adds room when it is backed by a simulation asset (bought, or granted as starting kit):
   *  simulation's bulk grain room counts assets, and potatoes follow the same rule */
  function storageActive(b) { return b.owner === 'player' && !!b.assetId; }
  function syncCapacity() {
    const S = sim();
    if (!S || !S.setCapacity) return;
    let t = POTATO_BASE;
    for (const b of W.list) {
      if (!storageActive(b)) continue;
      const st = rt.get(b.id).def.fn.storage;
      if (st && st.item === 'potatoes') t += st.t;
    }
    S.setCapacity('potatoes', t);
  }
  function sellName(b, base) {
    const places = ['Hageland', 'Dijle', 'Velpe', 'Getevallei', 'Molenbeek', 'Winge', 'Demer', 'Zoutleeuw'];
    return `${places[Math.floor(h01(ctx.world.seed + ':' + b.id) * places.length)]} ${base}`;
  }
  function registerFunctions(b) {
    const r = rt.get(b.id), fn = r.def.fn, door = b.doors[0];
    const S = sim();
    if (fn.sell && S && S.defineSellPoint) {
      b.sellPointId = b.sellPointId || `bld_${b.type}_${b.id.split(':')[1]}`;
      b.name = b.name || sellName(b, fn.sell.name);
      S.defineSellPoint(b.sellPointId, { name: b.name, x: door.x, y: door.y, accepts: fn.sell.accepts.slice() });
    }
    if (fn.services && fn.services.includes('fuel')) {
      const V = mod('vehicles');
      const have = ((ctx.world.vehicles && ctx.world.vehicles.fuelPoints) || []).some((p) => Math.hypot(p.x - door.x, p.y - door.y) < 0.5);
      if (V && V.addFuelPoint && !have) V.addFuelPoint(door.x, door.y, FUEL_R);
    }
  }
  function unregisterFunctions(b) {
    const S = sim();
    if (b.sellPointId && S) {
      if (S.removeSellPoint) S.removeSellPoint(b.sellPointId);
      else if (S.defineSellPoint) S.defineSellPoint(b.sellPointId, { name: (b.name || b.type) + ' (closed)', x: b.doors[0].x, y: b.doors[0].y, accepts: [] });
    }
    const fn = rt.get(b.id).def.fn;
    if (fn.services && fn.services.includes('fuel')) {
      const V = mod('vehicles');
      // keep the pump if another fuel building shares the spot
      const shared = W.list.some((o) => o !== b && o.doors[0] && Math.hypot(o.doors[0].x - b.doors[0].x, o.doors[0].y - b.doors[0].y) < 0.5);
      if (V && typeof V.removeFuelPoint === 'function' && !shared) V.removeFuelPoint(b.doors[0].x, b.doors[0].y);
    }
  }

  function applyTerrain(b, r) {
    const T = mod('terrain');
    if (!T) return;
    const grown = r.def.parts.map((p) => partPoly(p, b.x, b.y, b.rot, 2.5));
    const shape = { poly: hull(grown.flat()) };
    if (T.flatten) T.flatten(shape);
    if (r.def.group === 'farm' && T.paintSurface) {
      const yard = r.def.parts.map((p) => partPoly(p, b.x, b.y, b.rot, 3.2));
      // extra yard in front of the door
      const door = b.doors[0], fx = Math.sin(b.rot), fy = -Math.cos(b.rot);
      yard.push(partPoly({ k: 'gable', w: Math.min(14, (r.def.parts[0].w || 6) * 0.8), d: 7 }, door.x + fx * 3, door.y + fy * 3, b.rot));
      T.paintSurface({ poly: hull(yard.flat()) }, 'farmyard');
    }
  }

  // ------------------------------------------------------------------ placement
  function footprintParts(type, rot = 0, x = 0, y = 0, variant = 0) {
    const d = defOf(type, variant);
    if (!d) return null;
    return d.parts.map((p) => partPoly(p, x, y, rot));
  }
  function footprint(type, rot = 0, x = 0, y = 0, variant = 0) {
    const parts = footprintParts(type, rot, x, y, variant);
    return parts ? hull(parts.flat()) : null;
  }

  function canPlace(type, x, y, rot = 0, opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (rot == null) rot = 0;
    const d = defOf(type, opts.variant || 0);
    if (!d) return { ok: false, reason: 'unknown type' };
    if (![x, y, rot].every(Number.isFinite)) return { ok: false, reason: 'bad position' };
    const owner = opts.owner || 'player';
    const polys = d.parts.map((p) => partPoly(p, x, y, rot));
    const bb = aabbOf(polys);
    const B = ctx.world.bounds;
    if (bb.x0 < 2 || bb.y0 < 2 || bb.x1 > B.w - 2 || bb.y1 > B.h - 2) return { ok: false, reason: 'outside the map' };
    const samples = polys.flatMap((P) => samplePoly(P, 1.5));
    const R = mod('roads');
    if (R && R.roadAt) for (const [sx, sy] of samples) if (R.roadAt(sx, sy)) return { ok: false, reason: 'road' };
    const C = mod('crops');
    if (C && C.fieldAt) for (let i = 0; i < samples.length; i += 2) if (C.fieldAt(samples[i][0], samples[i][1])) return { ok: false, reason: 'field' };
    // colliders (other buildings, vehicles, props …) with 0.5 m clearance
    const grown = d.parts.map((p) => partPoly(p, x, y, rot, 0.5));
    const gb = aabbOf(grown);
    const ignore = opts.ignore;
    const hits = ctx.spatial.queryRect(gb.x0, gb.y0, gb.x1, gb.y1, (it) => it.solid && it.id !== ignore);
    for (const it of hits) {
      const others = it.polys || (it.poly && [it.poly]) || (it.data && (it.data.polys || (it.data.poly && [it.data.poly])));
      let hit = false;
      if (others) hit = others.some((O) => grown.some((G) => polysOverlap(G, O)));
      else if (it.x0 != null) { const O = [[it.x0, it.y0], [it.x1, it.y0], [it.x1, it.y1], [it.x0, it.y1]]; hit = grown.some((G) => polysOverlap(G, O)); }
      else hit = grown.some((G) => circleHitsPoly(G, it.x, it.y, it.r || 0.5));
      if (hit) return { ok: false, reason: it.kind === 'building' ? 'another building' : `blocked (${it.kind || it.owner || 'object'})`, by: it.id };
    }
    // people (the player, hands, villagers) are not solid colliders: never build on top of one
    const people = (ctx.world.characters && ctx.world.characters.list) || [];
    for (const c of people) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.vehicleId) continue;
      if (c.x < gb.x0 - 0.4 || c.x > gb.x1 + 0.4 || c.y < gb.y0 - 0.4 || c.y > gb.y1 + 0.4) continue;
      if (grown.some((G) => circleHitsPoly(G, c.x, c.y, 0.35))) return { ok: false, reason: 'someone is standing there', by: c.id };
    }
    const T = mod('terrain');
    if (T) {
      for (const [sx, sy] of samples) if ((T.waterDepthAt(sx, sy) || 0) > 0.02) return { ok: false, reason: 'water' };
      // the pad is levelled on placement: refuse only where that would need a big cut/fill
      let h0 = Infinity, h1 = -Infinity;
      for (const [sx, sy] of samples) { const h = T.heightAt(sx, sy) || 0; if (h < h0) h0 = h; if (h > h1) h1 = h; }
      if (h1 - h0 > 3) return { ok: false, reason: 'too steep' };
    }
    const S = sim();
    if (owner === 'player' && !opts.anyLand) {
      if (!S || !S.canUse) return { ok: false, reason: 'no land register' };
      for (const [sx, sy] of samples) if (!S.canUse(sx, sy)) return { ok: false, reason: 'not your land' };
    }
    const cost = opts.pay ? priceOf(d) : 0;
    if (opts.pay && d.catalog && S && !S.canAfford(cost)) return { ok: false, reason: 'not enough money', cost };
    if (opts.pay && !d.catalog) return { ok: false, reason: 'not for sale' };
    return { ok: true, reason: null, cost };
  }

  let lastReason = null;
  function place(type, x, y, rot = 0, opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (rot == null) rot = 0;
    const d = defOf(type, opts.variant || 0);
    if (!d) { lastReason = 'unknown type'; return null; }
    const owner = opts.owner || 'player';
    // force skips gameplay rules, never sanity: finite numbers and inside the map
    if (![x, y, rot].every((v) => typeof v === 'number' && Number.isFinite(v))) { lastReason = 'bad position'; return null; }
    {
      const bb = aabbOf(d.parts.map((p) => partPoly(p, x, y, rot)));
      const Bd = ctx.world.bounds;
      if (bb.x0 < 0 || bb.y0 < 0 || bb.x1 > Bd.w || bb.y1 > Bd.h) { lastReason = 'outside the map'; return null; }
    }
    if (!opts.force) {
      const c = canPlace(type, x, y, rot, opts);
      if (!c.ok) { lastReason = c.reason; return null; }
    }
    const S = sim();
    let assetId = null, purchased = false;
    if (owner === 'player' && d.catalog && S) {
      if (opts.pay) {
        const before = new Set((S.assets() || []).map((a) => a.id));
        // booked in simulation's 'buildings' book (capital), not as machinery
        if (!S.purchase(d.catalog.id, { category: 'buildings' })) { lastReason = 'purchase refused'; return null; }
        const a = (S.assets() || []).find((q) => !before.has(q.id) && q.itemId === d.catalog.id);
        assetId = a ? a.id : null;
        purchased = true;
      } else if (opts.grant === true) {
        // opt-in starting kit: the asset gives capacity + upkeep but no resale value (see remove)
        assetId = S.grantAsset(d.catalog.id) || null;
      }
    }
    const b = {
      id: `buildings:${++W.counter}`, type, variant: d.variant, x: +x, y: +y, rot: +rot, owner,
      w: 0, h: 0, doors: [], state: 'ok', name: opts.name || null, assetId, purchased, sellPointId: opts.sellPointId || null,
      yard: opts.terrain !== false,
    };
    const r = build(b);
    b.w = +(r.bb.x1 - r.bb.x0).toFixed(2); b.h = +(r.bb.y1 - r.bb.y0).toFixed(2);
    if (!b.name) b.name = d.name;
    W.list.push(b);
    spatialInsert(b, r);
    registerFunctions(b);
    if (b.yard) applyTerrain(b, r);
    syncCapacity();
    W.version++;
    lastReason = null;
    ctx.events.emit('buildings:placed', { id: b.id, type, variant: b.variant, x: b.x, y: b.y, rot: b.rot, owner, door: { ...b.doors[0] } });
    return b.id;
  }

  function remove(id, opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    const i = W.list.findIndex((b) => b.id === id);
    if (i < 0) return { ok: false, reason: 'unknown building' };
    const b = W.list[i], r = rt.get(id), S = sim();
    // the player path may only demolish player buildings; composers pass force or the owner
    if (b.owner !== 'player' && !opts.force && opts.owner !== b.owner) return { ok: false, reason: 'not yours' };
    const st = r.def.fn.storage;
    if (!opts.force && S && st && storageActive(b)) {
      if (st.item === 'grain' && S.bulkRoom && S.bulkRoom() < st.t - 1e-6) return { ok: false, reason: 'store not empty' };
      if (st.item === 'potatoes' && S.storageRoom && S.storageRoom('potatoes') < st.t - 1e-6) return { ok: false, reason: 'store not empty' };
    }
    let refund = 0;
    if (b.assetId && S && S.releaseAsset) {
      // purchased: sold at book value · granted (never paid): written off, no cash moves
      if (b.purchased) refund = S.releaseAsset(b.assetId) || 0;
      else S.releaseAsset(b.assetId, { writeOff: true });
    }
    W.list.splice(i, 1);
    ctx.spatial.remove(id);
    unregisterFunctions(b);
    stopSmoke(id);
    rt.delete(id);
    syncCapacity();
    W.version++;
    ctx.events.emit('buildings:removed', { id, type: b.type, x: b.x, y: b.y, owner: b.owner, refund });
    return { ok: true, refund: Math.round(refund * 100) / 100 };
  }

  // ------------------------------------------------------------------ queries
  const pub = (b) => (b ? { ...b, doors: b.doors.map((q) => ({ ...q })), fn: rt.get(b.id).def.fn, group: rt.get(b.id).def.group } : null);
  const byId = (id) => W.list.find((b) => b.id === (id && id.id ? id.id : id)) || null;
  function matches(b, f) {
    if (!f) return true;
    if (typeof f === 'function') return !!f(pub(b));
    if (typeof f === 'string') {
      const fn = rt.get(b.id).def.fn;
      if (f === 'home') return !!fn.home;
      if (f === 'sell') return !!fn.sell;
      if (f === 'storage') return !!fn.storage;
      if (f === 'livestock') return !!fn.livestock;
      if (f === 'repair' || f === 'fuel') return !!(fn.services && fn.services.includes(f));
      return b.type === f;
    }
    if (typeof f === 'object') return Object.entries(f).every(([k, v]) => (k === 'function' ? matches(b, v) : b[k] === v));
    return true;
  }
  function list(filter) { return W.list.filter((b) => matches(b, filter)).map(pub); }
  function nearest(filter, x, y, opts = {}) {
    let best = null, bd = Infinity;
    for (const b of W.list) {
      if (!matches(b, filter)) continue;
      if (opts.owner && b.owner !== opts.owner) continue;
      const dd = Math.hypot(b.x - x, b.y - y);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best ? { ...pub(best), dist: +bd.toFixed(2) } : null;
  }
  function at(x, y) {
    const hits = ctx.spatial.queryPoint(x, y, (it) => it.kind === 'building' && it.owner === 'buildings');
    for (const it of hits) { const b = byId(it.id); if (b && rt.get(b.id).polys.some((P) => pointInPoly(P, x, y))) return pub(b); }
    return null;
  }
  function doorOf(id) { const b = byId(id); return b && b.doors[0] ? { ...b.doors[0] } : null; }
  function capacity(kind) {
    let t = 0;
    for (const b of W.list) {
      if (b.owner !== 'player') continue;
      const fn = rt.get(b.id).def.fn;
      if (fn.storage && storageActive(b) && (fn.storage.item === kind || kind === 'storage')) t += fn.storage.t;
      if (fn.livestock && fn.livestock.kind === kind) t += fn.livestock.n;
      if (fn.home && kind === 'beds') t += fn.home.beds;
    }
    if (kind === 'potatoes') t += POTATO_BASE;
    return t;
  }
  function types() {
    const out = [];
    for (const type of Object.keys(TYPES)) {
      TYPES[type].variants.forEach((_, vi) => {
        const d = defOf(type, vi);
        const polys = d.parts.map((p) => partPoly(p, 0, 0, 0));
        const bb = aabbOf(polys);
        out.push({
          type, variant: vi, name: d.name, group: d.group, w: +(bb.x1 - bb.x0).toFixed(2), h: +(bb.y1 - bb.y0).toFixed(2),
          cost: d.catalog ? priceOf(d) : null, catalogId: d.catalog ? d.catalog.id : null, buildable: !!d.catalog,
          fn: d.fn, height: Math.max(...d.parts.map((p) => p.ridge || p.h || 0)),
        });
      });
    }
    return out;
  }
  function serviceAt(x, y, service) {
    let best = null, bd = Infinity;
    for (const b of W.list) {
      const fn = rt.get(b.id).def.fn;
      const ok = service === 'sell' ? !!fn.sell : service === 'storage' ? (!!fn.storage && b.owner === 'player') : !!(fn.services && fn.services.includes(service));
      if (!ok) continue;
      const dd = Math.hypot(b.doors[0].x - x, b.doors[0].y - y);
      const reach = SERVICE_R + (rt.get(b.id).def.parts[0].w || 0) * 0.25;
      if (dd < reach && dd < bd) { bd = dd; best = b; }
    }
    return best ? { ...pub(best), dist: +bd.toFixed(2) } : null;
  }

  /** repair a vehicle standing at a workshop (own shed: 30 % rebate) or the dealer. Returns {cost, rebate, at} or false. */
  function repairAt(vehicleId) {
    const V = mod('vehicles'), S = sim();
    const v = V && V.get ? V.get(vehicleId) : null;
    if (!v) return false;
    const b = serviceAt(v.x, v.y, 'repair');
    if (!b) return false;
    if (!(v.wear > 0)) return { cost: 0, rebate: 0, at: b.id };
    const cost = V.repair(vehicleId);
    if (!cost) return false;
    let rebate = 0;
    if (b.owner === 'player' && S && S.credit) { rebate = Math.round(cost * WORKSHOP_REBATE * 100) / 100; S.credit(rebate, 'repairs', `Own workshop — parts at trade price (${v.name || v.type})`); }
    return { cost, rebate, at: b.id };
  }

  /** deliver the cargo of a vehicle (and its attached trailers) at a sell point or into a farm store. */
  const BULK = ['wheat', 'barley', 'oats', 'rapeseed', 'maize'];
  /** make `t` tonnes of room for `item` by lending stock out of the farm store; returns the undo list */
  function borrowRoom(S, item, t) {
    const lent = [];
    let need = t - (S.storageRoom ? S.storageRoom(item) : Infinity);
    if (!(need > 1e-9)) return lent;
    if (BULK.includes(item)) {
      const inv = S.inventory() || {};
      for (const k of [item, ...BULK.filter((q) => q !== item)]) {
        if (need <= 1e-9) break;
        const take = Math.min(need, +inv[k] || 0);
        if (take > 0) { const got = S.removeInventory(k, take) || 0; if (got > 0) { lent.push([k, got]); need -= got; } }
      }
    } else if (item === 'potatoes' && S.setCapacity) {
      const inv = S.inventory() || {};
      S.setCapacity('potatoes', (+inv.potatoes || 0) + t);
      lent.push(['@cap', 0]);
    }
    return lent;
  }
  function giveBack(S, lent) {
    for (const [k, t] of lent) { if (k === '@cap') syncCapacity(); else S.addInventory(k, t); }
  }

  /** deliver the cargo of a vehicle (and its attached trailers) at a sell point or into a farm store.
   *  A sale sells the cargo itself: it never depends on free room in the farm store (room is lent for the
   *  instant of the sale and given back). Any 0 kg result carries a reason. */
  function deliver(vehicleId) {
    const V = mod('vehicles'), S = sim();
    const v = V && V.get ? V.get(vehicleId) : null;
    if (!v) return { kg: 0, euros: 0, at: null, reason: 'no vehicle' };
    if (!S) return { kg: 0, euros: 0, at: null, reason: 'no economy' };
    const units = [v, ...((v.attached || []).map((id) => V.get(id)).filter(Boolean))].filter((u) => u.cargo && u.cargo.kg > 0 && u.cargo.item);
    if (!units.length) return { kg: 0, euros: 0, at: null, reason: 'no cargo' };
    const sp = serviceAt(v.x, v.y, 'sell');
    const store = serviceAt(v.x, v.y, 'storage');
    let kg = 0, euros = 0, where = null, reason = null;
    for (const u of units) {
      const item = u.cargo.item;
      if (sp && sp.fn.sell.accepts.includes(item)) {
        where = sp.id;
        for (let guard = 0; guard < 20; guard++) {
          const cur = V.get(u.id);
          const t = cur && cur.cargo ? cur.cargo.kg / 1000 : 0;
          if (!(t > 1e-6)) break;
          const lent = borrowRoom(S, item, t);
          const got = V.unload(u.id, 'farm') || 0;
          const money = got > 0 ? S.sell(item, got / 1000, sp.sellPointId) || 0 : 0;
          giveBack(S, lent);
          if (got <= 0) { reason = 'the buyer could not take it (farm store full of other goods)'; break; }
          kg += got; euros += money;
        }
      } else if (store) {
        where = store.id;
        const got = V.unload(u.id, 'farm') || 0;
        kg += got;
        if (got <= 0) reason = 'the farm store is full';
      } else reason = sp ? `${sp.name} does not buy ${item}` : 'no buyer or store here';
    }
    if (kg <= 0 && !reason) reason = 'nothing delivered';
    return { kg: Math.round(kg), euros: Math.round(euros * 100) / 100, at: where, reason: kg > 0 ? null : reason };
  }

  function homes(owner) { return W.list.filter((b) => rt.get(b.id).def.fn.home && (!owner || b.owner === owner)).map(pub); }

  // ------------------------------------------------------------------ night lights (seeded schedule)
  function env() { return ctx.world.environment || {}; }
  function lightsOn(id, hour) {
    const b = byId(id);
    if (!b) return null;
    return schedule(b, rt.get(b.id), hour == null ? ctx.clock.timeOfDay : hour);
  }
  /** → { windows: 0..1 share lit, porch: bool } */
  function schedule(b, r, t) {
    const day = env().daylight == null ? 1 : env().daylight;
    const dark = day < 0.45;
    const k = h01(b.id + ':' + ctx.world.seed), k2 = h01(b.id + ':b');
    const porch = r.def.porch && day < 0.3;
    let win = 0;
    switch (r.def.lights) {
      case 'home': {
        const off = 21.6 + k * 2.2, morning = 5.8 + k2 * 1.0;
        if (dark && ((t >= 12 && t < off) || (t >= morning && t < 12))) win = 0.7;
        if (dark && t >= off - 0.8 && t < off) win = 0.35;
        break;
      }
      case 'shop': if (dark && t >= 7 && t < 18.8 + k * 1.5) win = 0.9; else if (dark && t >= 12) win = 0.15; break;
      case 'work': {
        const milking = (t >= 5.2 && t < 7.2) || (t >= 17 && t < 19.2 + k);
        if (dark && (milking || (t >= 7 && t < 19 + k * 1.5))) win = 0.6 + k2 * 0.3;
        break;
      }
      case 'church': if (dark && t >= 17 && t < 20.5 + k) win = h01(b.id + ':' + ctx.clock.day) < 0.5 ? 0.8 : 0.15; break;
      default: break;
    }
    return { windows: win, porch };
  }

  // ------------------------------------------------------------------ chimney smoke
  function stopSmoke(id) {
    const hs = smoke.get(id);
    if (hs) for (const h of hs) if (h && h.stop) h.stop();
    smoke.delete(id);
  }
  function smokeWanted(b, r) {
    if (!r.chim.length) return false;
    const w = env().weather || {};
    const temp = w.temperature == null ? 10 : w.temperature;
    const s = schedule(b, r, ctx.clock.timeOfDay);
    return temp < 13 || (s.windows > 0 && temp < 17);
  }

  // ------------------------------------------------------------------ rendering
  // LOD copies of the painted sprites (demo request #6). Every roof is painted once at 32 px/m; drawing
  // those full-size canvases at village/overview zoom (3–12 px/m) kept ~40 large textures alive and
  // re-sampled per frame, which cost 30–40 ms of raster time per frame in the full game. Downscaled
  // copies (16, 8 px/m) are made once per sprite on first use and the smallest one that still has ≥ the
  // screen's pixel density is drawn.
  const lodCopies = new WeakMap();  // img → [full, 1/2, 1/4]
  function lod(img, level) {
    if (level === 0) return img;
    let arr = lodCopies.get(img);
    if (!arr) { arr = [img, null, null]; lodCopies.set(img, arr); }
    if (!arr[level]) {
      const prev = lod(img, level - 1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(prev.width / 2)); c.height = Math.max(1, Math.round(prev.height / 2));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(prev, 0, 0, c.width, c.height);
      arr[level] = c;
    }
    return arr[level];
  }
  /** 0 = 32 px/m, 1 = 16, 2 = 8 — the smallest copy still at or above the screen density */
  function lodLevel(view) {
    const px = (view.zoom || 32) * (view.dpr || 1);
    return px >= 14 ? 0 : px >= 7 ? 1 : 2;
  }
  function spritesFor(b, r, snow) {
    const key = snow ? 'sprS' : 'spr';
    if (r[key]) return r[key];
    r[key] = r.def.parts.map((p) => (p.k === 'silo' ? painter.silo(p, snow) : p.k === 'tower' ? painter.tower(p, snow) : painter.gable(p, snow)));
    return r[key];
  }
  const visible = (r, v, m = 2) => r.bb.x1 + m > v.x0 && r.bb.x0 - m < v.x1 && r.bb.y1 + m > v.y0 && r.bb.y0 - m < v.y1;

  ctx.renderer.addLayer('ground-detail', (g, view) => {
    for (const b of W.list) {
      const r = rt.get(b.id);
      if (!visible(r, view, 6)) continue;
      const p0 = r.def.parts[0];
      const door = b.doors[0];
      const wide = !!(p0.wide || p0.open);
      const aw = wide ? Math.min(12, p0.w * 0.7) : 2.4, ad = wide ? 6 : 1.6;
      const img = lod(painter.apron(aw, ad), lodLevel(view));
      // apron starts at the wall and runs outward (away from the building)
      const fx = Math.sin(b.rot), fy = -Math.cos(b.rot);
      const cx = door.x - fx * (0.8 - ad / 2), cy = door.y - fy * (0.8 - ad / 2);
      ctx.art.draw(g, img, cx, cy, aw + 0.6, ad + 0.6, b.rot + Math.PI);
    }
  }, 5);

  ctx.renderer.addCollector((view, F) => {
    const w = env().weather || {};
    const snow = (w.snowCover || 0) > 0.3;
    const day = env().daylight == null ? 1 : env().daylight;
    const t = ctx.clock.timeOfDay;
    for (const b of W.list) {
      const r = rt.get(b.id);
      if (!visible(r, view, 30)) continue;    // shadows reach beyond the footprint
      for (const s of r.shadows) {
        if (s.t === 'poly') F.shadow.poly(s.pts, s.h);
        else if (s.t === 'cyl') F.shadow.cylinder(s.x, s.y, s.r, s.h);
        else if (s.t === 'box') F.shadow.box(s.x, s.y, s.w, s.d, s.rot, s.h);
      }
      if (!visible(r, view, 2)) continue;
      const sprites = spritesFor(b, r, snow);
      const lv = lodLevel(view);
      const parts = r.def.parts;
      F.object({
        y: r.sortY,
        draw(g) {
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i], s = sprites[i];
            const [px, py] = toWorld(b.x, b.y, b.rot, p.x || 0, p.y || 0);
            ctx.art.draw(g, lod(s.img, lv), px, py, s.w, s.h, b.rot + (p.rot || 0));
          }
        },
      });
      if (day < 0.5) {
        const s = schedule(b, r, t);
        if (s.windows > 0) {
          const night = Math.min(1, (0.5 - day) * 3);
          const dayN = ctx.clock.day;
          for (const wv of r.windows) if (h01(b.id + wv.k + dayN) < s.windows) F.light({ x: wv.x, y: wv.y, radius: 4.2, color: LIT, intensity: 0.5 * night, glow: 0.25, glowRadius: 0.9 });
          for (const sk of r.sky) if (h01(b.id + sk.k + dayN) < s.windows) F.light({ x: sk.x, y: sk.y, radius: 2.4, color: LIT, intensity: 0.55 * night, glow: 0.6, glowRadius: 0.8 });
        }
        if (s.porch) for (const p of r.porch) F.light({ x: p.x, y: p.y, radius: 7, color: LAMP, intensity: 0.85, glow: 0.7, glowRadius: 0.7 });
      }
    }
  });

  // ------------------------------------------------------------------ player interaction (service prompts)
  let label = null, steps = 0;
  function activeChar() {
    const pid = ctx.world.player && ctx.world.player.activeCharacterId;
    const C = ctx.world.characters && ctx.world.characters.list;
    return pid && C ? C.find((c) => c.id === pid) || null : null;
  }
  function interaction() {
    const ui = mod('ui');
    const c = activeChar();
    const V = mod('vehicles');
    let text = null, where = null, act = null;
    if (c && c.vehicleId && V) {
      const v = V.get(c.vehicleId);
      if (v && Math.abs(v.speed || 0) < 0.8) {
        const cargo = [v, ...((v.attached || []).map((id) => V.get(id)).filter(Boolean))].find((u) => u.cargo && u.cargo.kg > 0);
        const sp = serviceAt(v.x, v.y, 'sell'), store = serviceAt(v.x, v.y, 'storage'), rep = serviceAt(v.x, v.y, 'repair');
        if (cargo && sp && sp.fn.sell.accepts.includes(cargo.cargo.item)) { text = `R — Sell ${(cargo.cargo.kg / 1000).toFixed(1)} t ${cargo.cargo.item} to ${sp.name}`; where = sp; act = () => deliver(v.id); }
        else if (cargo && store) { text = `R — Unload ${(cargo.cargo.kg / 1000).toFixed(1)} t into the ${store.name.toLowerCase()}`; where = store; act = () => deliver(v.id); }
        else if (rep && v.wear > 0.02) { text = `R — Repair ${v.name || v.type} (wear ${(v.wear * 100).toFixed(0)}%)${rep.owner === 'player' ? ' · own workshop −30 %' : ''}`; where = rep; act = () => repairAt(v.id); }
      }
    } else if (c) {
      const sp = serviceAt(c.x, c.y, 'sell');
      if (sp && Math.hypot(sp.doors[0].x - c.x, sp.doors[0].y - c.y) < 6) { text = `${sp.name} buys ${sp.fn.sell.accepts.join(', ')}`; where = sp; }
    }
    if (ui && ui.worldLabel) {
      if (text && where) { ui.worldLabel('buildings:svc', { x: where.doors[0].x, y: where.doors[0].y - 1, text, kind: where.fn.sell ? 'sell' : 'info' }); label = true; }
      else if (label) { ui.removeWorldLabel('buildings:svc'); label = null; }
    }
    if (act && ctx.input.pressed('rotate')) {
      const res = act();
      if (ui && ui.toast && res) {
        if (res.euros > 0) ui.toast(`Sold ${(res.kg / 1000).toFixed(1)} t for €${res.euros.toFixed(2)}`, { kind: 'money' });
        else if (res.kg > 0) ui.toast(`Unloaded ${(res.kg / 1000).toFixed(1)} t into the farm store`, { kind: 'info' });
        else if (res.cost > 0) ui.toast(`Repaired for €${res.cost}${res.rebate ? ` (−€${res.rebate} trade rebate)` : ''}`, { kind: 'money' });
        else if (res.reason) ui.toast(res.reason === 'no cargo' ? 'Nothing to unload' : `Nothing delivered: ${res.reason}`, { kind: 'warn' });
      } else if (ui && ui.toast && res === false) ui.toast('Cannot afford the repair', { kind: 'warn' });
    }
  }

  function update() {
    steps++;
    if (ctx.world.time && ctx.world.time.paused) return;
    interaction();
  }

  function frame() {
    const E = mod('effects');
    if (!E || !E.emitter) return;
    if (frame._n++ % 20) return;
    const view = ctx.camera.view();
    for (const b of W.list) {
      const r = rt.get(b.id);
      const want = visible(r, view, 20) && smokeWanted(b, r);
      const has = smoke.has(b.id);
      if (want && !has) {
        const hs = r.chim.slice(0, 2).map((c) => E.emitter('chimney', { x: c.x, y: c.y, z: c.z, rate: 0.9 }));
        smoke.set(b.id, hs);
      } else if (!want && has) stopSmoke(b.id);
    }
  }
  frame._n = 0;

  // ------------------------------------------------------------------ terrain regenerate → re-apply yards
  ctx.events.on('terrain:generated', () => {
    const T = mod('terrain');
    if (!T || !T.surfaceAt) return;
    for (const b of W.list) {
      const r = rt.get(b.id);
      if (b.yard && r.def.group === 'farm' && T.surfaceAt(b.doors[0].x, b.doors[0].y) !== 'farmyard') applyTerrain(b, r);
    }
  });

  // ------------------------------------------------------------------ save / load
  function save() {
    return { counter: W.counter, list: W.list.map((b) => ({ ...b, doors: b.doors.map((d) => ({ ...d })) })) };
  }
  function load(d) {
    if (!d || !Array.isArray(d.list)) return;
    for (const b of W.list) { ctx.spatial.remove(b.id); stopSmoke(b.id); }
    rt.clear();
    W.list = [];
    W.counter = d.counter | 0;
    for (const s of d.list) {
      if (!s || typeof s !== 'object' || !TYPES[s.type] || typeof s.id !== 'string') continue;
      if (![s.x, s.y].every(Number.isFinite)) continue;
      if (!Number.isFinite(s.rot)) s.rot = 0;
      // saves before r2 had no `purchased` flag: an asset then always meant a purchase
      if (typeof s.purchased !== 'boolean') s.purchased = !!s.assetId;
      const b = { ...s, doors: [] };
      build(b);
      W.list.push(b);
      spatialInsert(b, rt.get(b.id));
      registerFunctions(b);
    }
    syncCapacity();
    W.version++;
  }
  function dispose() { for (const id of [...smoke.keys()]) stopSmoke(id); }

  const api = {
    types, place, remove, canPlace, footprint, footprintParts, at, list, get: (id) => pub(byId(id)), doorOf, nearest,
    capacity, serviceAt, repairAt, deliver, homes, lightsOn, lastError: () => lastReason,
  };
  return { api, update, frame, save, load, dispose };
}

export const showcase = {
  deps: ['terrain', 'environment', 'effects', 'simulation'],
  presets: SHOW_PRESETS,
  async stage(ctx, name) { return showStage(ctx, name); },
};
