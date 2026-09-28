// vehicles — drivable farm machines: tractors (3 tiers), combines, pickup, trailers and implements.
// Kinematic bicycle driving with surface-dependent top speed, spatial-hash collisions, hitch
// articulation, implements that work the ground through crops.work(), fuel (bought as diesel
// through simulation), wear + repair, upgrades, headlights/beacons, save/load.
import { TYPES, IMPLEMENTS, ALL, KITS, UPGRADES, REPAIR_FRAC, FIELD_EFF } from './types.js';
import { createDriver, toWorld, corners, distToBox, polysOverlap } from './drive.js';
import { createPainter } from './paint.js';
import { createRender } from './render.js';
import { createHud } from './hud.js';
import { PRESETS, stageShowcase } from './showcase.js';

export const manifest = {
  id: 'vehicles',
  wave: 2,
  deps: ['simulation'],
  optionalDeps: ['terrain', 'environment', 'roads', 'crops', 'effects', 'audio', 'ui'],
  namespaces: ['vehicles'],
  api: ['spawn', 'despawn', 'list', 'get', 'nearest', 'enter', 'exit', 'driverOf', 'control', 'attach', 'detach',
    'refuel', 'repair', 'upgrade', 'purchase', 'sell', 'catalog', 'types', 'setImplement', 'setLights', 'setSeed',
    'unload', 'rigOf', 'hitchNearest', 'exitPosition', 'surfaceUnder', 'workRate', 'addFuelPoint', 'removeFuelPoint'],
  emits: ['vehicles:entered', 'vehicles:exited', 'vehicles:purchased', 'vehicles:worked', 'vehicles:attached',
    'vehicles:detached', 'vehicles:refuelled', 'vehicles:repaired', 'vehicles:sold'],
  listens: [],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SAVE_SKIP = new Set(['cap', 'load', 'blocked', 'blockedBy', 'engine']);
export const EXIT_MAX_SPEED = 1.0; // m/s — faster than this the driver cannot get out

export async function init(ctx) {
  const world = ctx.world;
  const W = world.vehicles;
  Object.assign(W, { list: [], counter: 0, version: 0, fuelPoints: [] });
  const byId = new Map();
  let stepCount = 0;
  const mod = (id) => ctx.modules.get(id);
  const events = ctx.events;

  // ---------------------------------------------------------------- catalog registration
  function registerCatalog() {
    const sim = mod('simulation');
    if (!sim || !sim.catalog) return;
    const have = new Set((sim.catalog() || []).map((c) => c.id));
    const done = new Set();
    for (const [type, T] of Object.entries(ALL)) {
      if (!T.register || done.has(T.catalog)) continue;
      done.add(T.catalog);
      if (have.has(T.catalog)) continue;
      // simulation may already list an equivalent machine under another id (same category): reuse it
      const same = T.register.category === 'harvester' && (sim.catalog('harvester') || [])[0];
      if (same) { KITS[same.id] = KITS[T.catalog]; continue; }
      sim.registerCatalogItem({ id: T.catalog, category: T.register.category, name: T.name, price: T.register.price, meta: { vehicleTypes: KITS[T.catalog] || [type] } });
    }
  }
  registerCatalog();

  // ---------------------------------------------------------------- work widths/speeds from simulation.workRates().kit
  // simulation is the single source for field-work rates (r3 time model); physics uses the same numbers.
  const KMH = 1 / 3.6;
  function applySimKit() {
    const sim = mod('simulation');
    const wr = sim && sim.workRates ? sim.workRates() : null;
    const kit = wr && wr.kit;
    if (!kit) return false;
    const pick = (a, i) => (Array.isArray(a) ? a[Math.min(i, a.length - 1)] : a);
    const set = (type, op, tier, { resize = true, minWid } = {}) => {
      const k = kit[op];
      const I = IMPLEMENTS[type];
      if (!k || !I || !I.work) return;
      const w = +pick(k.widthM, tier), sp = +pick(k.kmh, tier);
      if (w > 0) I.work.width = w;
      if (sp > 0) I.work.speed = sp * KMH;
      if (k.eff) I.work.eff = k.eff;
      if (resize && w > 0) I.wid = Math.max(minWid || 0, w);
    };
    set('plough_s', 'plough', 0, { resize: false });
    set('plough_l', 'plough', 1, { resize: false });
    for (const t of ['plough_s', 'plough_l']) {
      const I = IMPLEMENTS[t];
      I.wid = +(I.work.width * 0.92 + 0.25).toFixed(2);
      I.furrows = Math.max(3, Math.round(I.work.width / 0.45));
      I.len = +(1.2 + I.work.width * 0.75).toFixed(2); I.hitch = +(I.len / 2 + 0.05).toFixed(2);
    }
    set('cultivator', 'cultivate', 0);
    set('seeder_s', 'sow', 0); set('seeder_l', 'sow', 1);
    set('sprayer', 'spray', 0, { resize: false }); set('spreader', 'spray', 0, { resize: false });
    set('mower', 'mow', 0);
    set('baler', 'bale', 0, { resize: false });
    set('root_harvester', 'lift', 0, { resize: false });
    if (kit.harvest) {
      for (const id of ['combine_s', 'combine_l']) {
        const h = kit.harvest[id];
        if (!h) continue;
        if (h.widthM > 0) TYPES[id].header.width = h.widthM;
        if (h.kmh > 0) TYPES[id].workSpeed = h.kmh * KMH;
      }
    }
    return true;
  }
  const kitApplied = applySimKit();
  function catalogEntry(itemId) {
    const sim = mod('simulation');
    const all = (sim && sim.catalog && sim.catalog()) || [];
    return all.find((c) => c.id === itemId) || null;
  }
  function itemOf(type) {
    const T = ALL[type];
    if (!T) return null;
    if (T.catalog) return T.catalog;
    if (T.kit) return T.kit;
    return null;
  }
  function priceOf(type) {
    const e = catalogEntry(itemOf(type));
    const kit = KITS[itemOf(type)] || [type];
    const base = e && e.price > 0 ? e.price : (ALL[type].price || ALL[type].register && ALL[type].register.price || 10000);
    return e && kit.length > 1 ? base / kit.length : base;
  }

  // ---------------------------------------------------------------- spatial
  function boxesNow(v) { return driver.boxesAt(v, v.x, v.y, v.rot); }
  function moved(v) {
    const polys = boxesNow(v);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const P of polys) for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    ctx.spatial.update({ id: v.id, kind: 'vehicle', x0, y0, x1, y1, polys, solid: true, data: { vehicleId: v.id, type: v.type, polys } });
  }

  // ---------------------------------------------------------------- driver & services
  const fxRng = ctx.rng('fx');
  let render = null;
  const driver = createDriver({
    ctx, mod,
    byId: (id) => byId.get(id),
    stepCount: () => stepCount,
    moved,
    onWork: (v, imp, dist) => doWork(v, imp, dist),
    fx: (v, parts, surf, sp, thr) => { if (render) render.fx(v, parts, surf, sp, thr); },
    onImpact: (v, impact) => { const a = mod('audio'); if (a && a.play) a.play('door', { x: v.x, y: v.y, volume: Math.min(1, impact / 6), pitch: 0.5 }); },
  });

  // ---------------------------------------------------------------- work (crops.work)
  const WORK_STEP = 0.5; // metres between crops.work calls
  function toolOf(v, imp) {
    const T = ALL[imp.type];
    if (T.header) return { tool: 'harvest', width: T.header.width };
    const w = T.work;
    if (!w) return null;
    const tool = w.tool === 'seed' ? 'seed:' + (imp.seed || 'wheat') : w.tool;
    return { tool, width: w.width };
  }
  function workPoint(imp) {
    const T = ALL[imp.type];
    if (T.header) return toWorld(imp.x, imp.y, imp.rot, 0, -T.len / 2 - T.header.depth / 2);
    if (T.look === 'sprayer' || T.look === 'spreader') return toWorld(imp.x, imp.y, imp.rot, 0, T.len / 2 + 0.3);
    return [imp.x, imp.y];
  }
  function doWork(v, imp, dist) {
    const tw = toolOf(v, imp);
    if (!tw) return;
    imp._wd = (imp._wd || 0) + dist;
    imp.workedArea = (imp.workedArea || 0) + tw.width * dist;
    if (imp._wd < WORK_STEP) return;
    const len = imp._wd;
    imp._wd = 0;
    const [wx, wy] = workPoint(imp);
    // centre of the swept strip since the last call
    const cx = wx - Math.sin(imp.rot) * len / 2, cy = wy + Math.cos(imp.rot) * len / 2;
    const crops = mod('crops');
    let cells = 0;
    if (crops && crops.work) {
      imp._inField = crops.fieldAt ? !!crops.fieldAt(wx, wy) : true;
      if (tw.tool === 'harvest' && !canHarvest(imp, crops, cx, cy)) return;
      const r = crops.work(tw.tool, cx, cy, tw.width + 0.2, imp.rot, len + 0.1); // 10 cm overlap each side, like a driver
      if (r && typeof r === 'object') {
        cells = r.cellsChanged || 0;
        const kg = +r.yieldKg || 0;
        if (tw.tool === 'harvest' && kg > 0) {
          const host = imp;
          if (!host.cargo) host.cargo = { item: null, kg: 0 };
          const cap = ALL[host.type].grainTank || ALL[host.type].capacity || Infinity;
          const take = Math.min(kg, Math.max(0, cap - host.cargo.kg));
          host.cargo.kg += take; host.cargo.item = r.item || host.cargo.item;
          if (take < kg) host.cargoLost = (host.cargoLost || 0) + (kg - take);
        }
      } else if (Number.isFinite(r)) cells = r;
    } else {
      fallbackPaint(imp, tw, cx, cy, len);
    }
    imp._cells = (imp._cells || 0) + cells;
    imp._evArea = (imp._evArea || 0) + tw.width * len;
    if (imp._evArea >= 40) {
      events.emit('vehicles:worked', { vehicleId: v.id, implementId: imp.id, tool: tw.tool, area: +imp._evArea.toFixed(1), cells: imp._cells, x: +cx.toFixed(2), y: +cy.toFixed(2), rot: imp.rot, width: tw.width });
      imp._evArea = 0; imp._cells = 0;
    }
  }
  // combines take cereals, oilseed and maize; the root harvester takes beet and potatoes; grass needs a mower
  const COMBINE_KINDS = new Set(['cereal', 'oilseed', 'maize']);
  let cropKinds = null;
  function canHarvest(imp, crops, x, y) {
    if (!crops.cellAt) return true;
    const c = crops.cellAt(x, y);
    if (!c || !c.crop) return false;
    if (!cropKinds) { const t = crops.crops ? crops.crops() : null; cropKinds = {}; if (t) for (const [k, d] of Object.entries(t)) cropKinds[k] = d.kind; }
    const kind = cropKinds[c.crop];
    if (!kind) return false;
    return ALL[imp.type].header ? COMBINE_KINDS.has(kind) : kind === 'root';
  }
  // without crops: paint the swept strip into the terrain so the work is still visible
  function fallbackPaint(imp, tw, cx, cy, len) {
    const terr = mod('terrain');
    if (!terr || !terr.paintSurface) return;
    const type = tw.tool === 'plough' ? 'ploughed' : (tw.tool === 'cultivate' || tw.tool.startsWith('seed')) ? 'soil' : null;
    if (!type) return;
    imp._pa = (imp._pa || 0) + len;
    if (imp._pa < 9) return; // batched: each paintSurface repaints terrain chunks
    const L = imp._pa + 0.2;
    imp._pa = 0;
    const [wx, wy] = workPoint(imp);
    const mx = wx - Math.sin(imp.rot) * L / 2, my = wy + Math.cos(imp.rot) * L / 2;
    const s = driver.surfaceAt(mx, my);
    if (s === 'road' || s === 'lane' || s === 'water' || s === 'shallow') return;
    terr.paintSurface({ poly: corners(mx, my, imp.rot, tw.width, L) }, type, { angle: imp.rot });
  }

  // ---------------------------------------------------------------- core helpers
  function get(id) { return byId.get(id) || null; }
  function snap(v) { return { ...v, attached: (v.attached || []).slice(), upgrades: { ...(v.upgrades || {}) }, cargo: v.cargo ? { ...v.cargo } : null, ctl: undefined }; }
  function drivable(v) { return !!(v && TYPES[v.type]); }
  function partsOf(v) { return (v.attached || []).map((id) => byId.get(id)).filter(Boolean); }
  function isDark() { const e = world.environment || {}; return (e.daylight == null ? 1 : e.daylight) < 0.35; }

  function spawn(type, x, y, rot = 0, opts = {}) {
    const T = ALL[type];
    if (!T || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const id = `vehicles:${++W.counter}`;
    const v = {
      id, type, kind: T.kind, name: opts.name || T.name, x, y, rot: +rot || 0, speed: 0, steer: 0,
      fuel: T.tank ? clamp(opts.fuel != null ? +opts.fuel : T.tank * 0.8, 0, T.tank) : null, tank: T.tank || 0,
      wear: clamp(+opts.wear || 0, 0, 1), driverId: null, attached: [], hitchedTo: null, lowered: false, lights: false, engine: false,
      owner: opts.owner || null, assetId: opts.assetId || null, upgrades: {}, hours: 0, odo: 0, fuelUsed: 0, workedArea: 0,
      cargo: (T.capacity || T.grainTank) ? { item: null, kg: 0 } : null, seed: opts.seed || 'wheat', paint: opts.paint || T.paint || null,
    };
    W.list.push(v); byId.set(id, v); W.version++;
    moved(v);
    return id;
  }
  function despawn(id) {
    const v = byId.get(id);
    if (!v) return false;
    ctx.spatial.remove(id); // first, so nothing (exit spots included) sees the despawned body
    if (v.driverId) {
      // despawn always evicts the driver, even at speed / with no free spot
      const cid = v.driverId;
      const pos = exitPosition(id) || { x: v.x, y: v.y };
      v.driverId = null; v.ctl = null; v.engine = false;
      events.emit('vehicles:exited', { vehicleId: id, characterId: cid, x: pos.x, y: pos.y, despawned: true });
    }
    for (const pid of v.attached.slice()) detach(id, pid);
    if (v.hitchedTo) detach(v.hitchedTo, id);
    if (render) render.release(v);
    ctx.spatial.remove(id);
    byId.delete(id);
    const i = W.list.indexOf(v); if (i >= 0) W.list.splice(i, 1);
    W.version++;
    return true;
  }
  function nearest(x, y, r = 3, opts = {}) {
    let best = null, bd = Infinity;
    for (const v of W.list) {
      if (!opts.any && !drivable(v)) continue;
      if (opts.free && (v.driverId || v.hitchedTo)) continue;
      if (opts.kind && v.kind !== opts.kind) continue;
      const T = ALL[v.type];
      if (Math.abs(v.x - x) > r + T.len && Math.abs(v.y - y) > r + T.len) continue;
      const d = distToBox(x, y, v.x, v.y, v.rot, T.wid, T.len);
      if (d <= r && d < bd) { bd = d; best = v; }
    }
    return best;
  }
  function isFree(x, y, r, ignore) {
    const terr = mod('terrain');
    if (terr && terr.waterDepthAt && driver.waterDepth(x, y) > 0.2) return false;
    const b = world.bounds;
    if (x < 1 || y < 1 || x > b.w - 1 || y > b.h - 1) return false;
    const circle = [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
    const hits = ctx.spatial.queryCircle(x, y, r, (it) => it.solid && !(ignore && ignore.has(it.id)));
    for (const it of hits) {
      if (it.data && it.data.vehicleId && !byId.has(it.data.vehicleId)) { ctx.spatial.remove(it.id); continue; } // stale entry
      if (it.data && Array.isArray(it.data.polys)) { if (it.data.polys.some((P) => polysOverlap(P, circle))) return false; continue; }
      if (it.data && it.data.poly) { if (polysOverlap(it.data.poly, circle)) return false; continue; }
      return false;
    }
    return true;
  }
  /** a walkable spot next to the driver's door (left), else right, rear, front, then further out.
   *  Also clear of the rig's axis-aligned box, which is what walkers collide with. */
  function exitPosition(id) {
    const v = byId.get(id);
    if (!v) return null;
    const T = ALL[v.type];
    const hw = T.wid / 2, hl = T.len / 2;
    const rig = [v, ...partsOf(v)];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const u of rig) for (const P of driver.boxesAt(u, u.x, u.y, u.rot)) for (const p of P) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
    const r = 0.4;
    const inBB = (x, y) => x > bx0 - r && x < bx1 + r && y > by0 - r && y < by1 + r;
    const dirs = [[-1, -0.1], [1, -0.1], [-1, 0.5], [1, 0.5], [0, 1], [0, -1]];
    for (const grow of [0.7, 1.3, 2.2, 3.4]) {
      for (const [sx, sy] of dirs) {
        const lx = sx ? sx * (hw + grow) : 0;
        const ly = sx ? sy * hl : sy * (hl + grow + (sy < 0 && T.header ? T.header.depth : 0));
        const [x, y] = toWorld(v.x, v.y, v.rot, lx, ly);
        if (!inBB(x, y) && isFree(x, y, 0.35)) return { x: +x.toFixed(3), y: +y.toFixed(3) };
      }
    }
    for (const [sx] of dirs) {
      const [x, y] = toWorld(v.x, v.y, v.rot, sx * (hw + 0.7), 0);
      if (isFree(x, y, 0.35)) return { x: +x.toFixed(3), y: +y.toFixed(3) };
    }
    return null;
  }
  function enter(id, characterId) {
    const v = byId.get(id);
    if (!drivable(v) || v.driverId || !characterId) return false;
    v.driverId = characterId;
    v.ctl = {}; v.ctlStep = stepCount;
    if (isDark()) v.lights = true;
    const a = mod('audio'); if (a && a.play) a.play('door', { x: v.x, y: v.y, volume: 0.6 });
    events.emit('vehicles:entered', { vehicleId: id, characterId, type: v.type });
    return true;
  }
  function isPlayer(cid) { return !!(world.player && world.player.activeCharacterId === cid); }
  function exit(id) {
    const v = byId.get(id);
    if (!v || !v.driverId) return null;
    const cid = v.driverId;
    const ui = mod('ui');
    // must be (nearly) stopped, and there must be somewhere to stand; otherwise the driver stays in
    if (Math.abs(v.speed) > EXIT_MAX_SPEED) { if (ui && ui.toast && isPlayer(cid)) ui.toast('Stop to get out', { kind: 'warn' }); return null; }
    const pos = exitPosition(id);
    if (!pos || pos.blocked) { if (ui && ui.toast && isPlayer(cid)) ui.toast('No room to get out here', { kind: 'warn' }); return null; }
    v.driverId = null; v.ctl = null; v.engine = false;
    v.speed = 0;
    const a = mod('audio'); if (a && a.play) a.play('door', { x: v.x, y: v.y, volume: 0.6 });
    events.emit('vehicles:exited', { vehicleId: id, characterId: cid, x: pos.x, y: pos.y });
    return pos;
  }
  function setImplement(id, down) {
    const v = byId.get(id);
    if (!v) return false;
    const T = ALL[v.type];
    const parts = partsOf(v).filter((p) => ALL[p.type].work);
    if (!parts.length && !T.header) return false;
    const cur = T.header ? v.lowered : parts.some((p) => p.lowered);
    const want = down === 'toggle' || down == null ? !cur : !!down;
    if (T.header) v.lowered = want;
    for (const p of parts) {
      p.lowered = want;
      if (!want && render) render.endTrails(p);
    }
    v.lowered = want;
    v.gpsLine = null;
    return want;
  }
  function setLights(id, on) {
    const v = byId.get(id);
    if (!v) return false;
    v.lights = on === 'toggle' || on == null ? !v.lights : !!on;
    return v.lights;
  }
  function control(id, c) {
    const v = byId.get(id);
    if (!v || !drivable(v) || !c) return false;
    if (!v.ctl) v.ctl = {};
    if (c.throttle != null) v.ctl.throttle = +c.throttle || 0;
    if (c.brake != null) v.ctl.brake = +c.brake || 0;
    if (c.steer != null) v.ctl.steer = +c.steer || 0;
    // only driving inputs keep the controls fresh (a lights/implement-only call must not re-arm an old brake)
    if (c.throttle != null || c.brake != null || c.steer != null) v.ctlStep = stepCount;
    if (c.lights != null) setLights(id, c.lights);
    if (c.implementDown != null) {
      // with nothing to lower, E couples the implement behind you instead
      const hasWork = partsOf(v).some((p) => ALL[p.type].work) || ALL[v.type].header;
      if (!hasWork && c.implementDown === 'toggle') { if (!partsOf(v).length) hitchNearest(id, { coupleOnly: true }); }
      else setImplement(id, c.implementDown);
    }
    if (c.hitch != null) hitchNearest(id);
    if (c.horn) { const a = mod('audio'); if (a && a.play) a.play('horn', { x: v.x, y: v.y }); }
    return true;
  }

  // ---------------------------------------------------------------- hitching
  function straightBehind(v, imp) {
    const T = ALL[v.type], I = ALL[imp.type];
    imp.rot = v.rot;
    if (I.mount === 'trailed') {
      const [hx, hy] = driver.hitchPoint(v, false);
      const fx = Math.sin(v.rot), fy = -Math.cos(v.rot);
      const ax = hx - fx * I.tongue, ay = hy - fy * I.tongue;
      imp.x = ax + fx * I.axleY; imp.y = ay + fy * I.axleY;
    } else {
      const p = driver.implementPose(v, T, imp, v.x, v.y, v.rot);
      imp.x = p.x; imp.y = p.y;
    }
  }
  function attach(id, implId, opts = {}) {
    const v = byId.get(id), imp = byId.get(implId);
    if (!v || !imp || !IMPLEMENTS[imp.type] || !drivable(v) || imp.hitchedTo) return false;
    const T = ALL[v.type], I = ALL[imp.type];
    const front = I.mount === 'front';
    if (front ? T.hitchF == null : T.hitchR == null) return false;
    if (partsOf(v).some((p) => (ALL[p.type].mount === 'front') === front)) return false;
    v.attached.push(implId);
    imp.hitchedTo = id; imp.lowered = false;
    if (opts.snap !== false) straightBehind(v, imp);
    driver.settle(v);
    moved(imp);
    W.version++;
    events.emit('vehicles:attached', { vehicleId: id, implementId: implId });
    return true;
  }
  function detach(id, implId) {
    const v = byId.get(id);
    if (!v) return false;
    const ids = implId ? [implId] : v.attached.slice();
    let n = 0;
    for (const pid of ids) {
      const i = v.attached.indexOf(pid);
      if (i < 0) continue;
      v.attached.splice(i, 1);
      const imp = byId.get(pid);
      if (imp) { imp.hitchedTo = null; imp.lowered = false; imp.speed = 0; if (render) render.endTrails(imp); }
      n++;
      events.emit('vehicles:detached', { vehicleId: id, implementId: pid });
    }
    if (!partsOf(v).some((p) => ALL[p.type].work) && !ALL[v.type].header) v.lowered = false;
    W.version++;
    return n > 0;
  }
  /** couple the nearest free implement to the matching hitch, or uncouple the rear one */
  function hitchNearest(id, opts = {}) {
    const v = byId.get(id);
    if (!drivable(v)) return false;
    if (Math.abs(v.speed) > 0.8) return false;
    const T = ALL[v.type];
    let best = null, bd = 2.6;
    for (const cand of W.list) {
      if (!IMPLEMENTS[cand.type] || cand.hitchedTo) continue;
      const I = ALL[cand.type];
      const front = I.mount === 'front';
      if (front ? T.hitchF == null : T.hitchR == null) continue;
      if (partsOf(v).some((p) => (ALL[p.type].mount === 'front') === front)) continue; // that hitch is taken
      const [hx, hy] = driver.hitchPoint(v, front);
      const [ix, iy] = driver.implementHitch(cand);
      const d = Math.hypot(hx - ix, hy - iy);
      if (d < bd) { bd = d; best = cand; }
    }
    if (best) {
      // keep the implement where it stands if nearly aligned; snap otherwise
      return attach(id, best.id);
    }
    if (opts.coupleOnly) return false;
    const rear = partsOf(v).find((p) => ALL[p.type].mount !== 'front') || partsOf(v)[0];
    if (rear) return detach(id, rear.id) ? 'detached' : false;
    return false;
  }

  // ---------------------------------------------------------------- fuel, repair, upgrades
  /** fuel points (pumps) other modules can register; refuelling rules:
   *  - within FUEL_R of a fuel point: farm diesel stock first, then buy diesel;
   *  - on the farmyard surface: only from the farm's diesel stock (bought via simulation.buy('diesel'));
   *  - anywhere else: nothing. opts.anywhere bypasses (scripts/tests). */
  const FUEL_R = 12;
  function refuelMode(v) {
    for (const p of W.fuelPoints || []) if (Math.hypot(p.x - v.x, p.y - v.y) <= (p.r || FUEL_R)) return 'pump';
    const s = driver.surfaceAt(v.x, v.y);
    return s === 'farmyard' ? 'yard' : null;
  }
  /** remove fuel points within r metres of (x, y) (buildings calls this on demolition) → number removed */
  function removeFuelPoint(x, y, r = 3) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const before = (W.fuelPoints || []).length;
    W.fuelPoints = (W.fuelPoints || []).filter((p) => Math.hypot(p.x - x, p.y - y) > r);
    return before - W.fuelPoints.length;
  }
  function addFuelPoint(x, y, r = FUEL_R) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    (W.fuelPoints = W.fuelPoints || []).push({ x, y, r });
    return true;
  }
  function refuel(id, litres, opts = {}) {
    const v = byId.get(id);
    if (!v || !v.tank) return 0;
    const mode = opts.anywhere ? 'pump' : refuelMode(v);
    if (!mode) return 0;
    const sim = mod('simulation');
    let need = Math.max(0, Math.min(litres != null ? +litres : Infinity, v.tank - v.fuel));
    need = Math.floor(need * 10) / 10;
    if (need <= 0 || !sim) return 0;
    let got = 0;
    // farm tank first
    const inv = (sim.inventory && sim.inventory()) || {};
    const have = +inv.diesel || 0;
    if (have > 0) got += sim.removeInventory('diesel', Math.min(have, need)) || 0;
    let rest = need - got;
    if (rest > 0.05 && mode === 'pump') {
      const price = +sim.price('diesel') || 1.3;
      const afford = Math.floor(Math.max(0, (sim.money() || 0) / price) * 10) / 10;
      const buy = Math.min(rest, afford);
      if (buy > 0.05 && sim.buy('diesel', buy) > 0) got += sim.removeInventory('diesel', buy) || 0;
    }
    v.fuel = Math.min(v.tank, v.fuel + got);
    if (got > 0) events.emit('vehicles:refuelled', { vehicleId: id, litres: +got.toFixed(1) });
    return +got.toFixed(1);
  }
  function repairCost(v) { return Math.round(priceOf(v.type) * REPAIR_FRAC * (v.wear || 0)); }
  function repair(id) {
    const v = byId.get(id);
    if (!v) return false;
    const cost = repairCost(v);
    if (cost <= 0) { v.wear = 0; return 0; }
    const sim = mod('simulation');
    if (!sim || !sim.charge(cost, 'repairs', `Repair — ${v.name}`)) return false;
    v.wear = 0;
    events.emit('vehicles:repaired', { vehicleId: id, cost });
    return cost;
  }
  function upgrade(id, upId) {
    const v = byId.get(id), U = UPGRADES[upId];
    if (!v || !U || !U.kinds.includes(v.kind) || (v.upgrades && v.upgrades[upId])) return false;
    const cost = Math.round(Math.max(U.min, priceOf(v.type) * U.frac));
    const sim = mod('simulation');
    if (!sim || !sim.charge(cost, 'machinery', `${U.name} — ${v.name}`)) return false;
    v.upgrades[upId] = true;
    return cost;
  }

  // ---------------------------------------------------------------- dealer
  function purchase(what, x, y, rot = 0, opts = {}) {
    const sim = mod('simulation');
    if (!sim) return null;
    const itemId = KITS[what] ? what : itemOf(what);
    if (!itemId || !KITS[itemId]) return null;
    const before = new Set((sim.assets() || []).map((a) => a.id));
    const ok = opts.lease ? sim.lease(itemId) : opts.grant ? !!sim.grantAsset(itemId) : sim.purchase(itemId, { finance: !!opts.finance });
    if (!ok) return null;
    const asset = (sim.assets() || []).find((a) => !before.has(a.id) && a.itemId === itemId);
    const mode = opts.lease ? 'leased' : 'owned';
    const ids = [];
    const rx = Math.cos(rot), ry = Math.sin(rot);
    let off = 0;
    for (const type of KITS[itemId]) {
      ids.push(spawn(type, x + rx * off, y + ry * off, rot, { owner: mode, assetId: asset ? asset.id : null }));
      off += ALL[type].wid + 1.5;
    }
    events.emit('vehicles:purchased', { itemId, vehicleIds: ids, mode, assetId: asset ? asset.id : null });
    return ids;
  }
  function sell(id) {
    const v = byId.get(id);
    const sim = mod('simulation');
    if (!v || !sim || !v.assetId || v.driverId) return false;
    const assetId = v.assetId;
    const value = sim.releaseAsset(assetId);
    if (value === undefined) return false;
    for (const o of W.list.filter((q) => q.assetId === assetId)) despawn(o.id);
    events.emit('vehicles:sold', { vehicleId: id, assetId, value });
    return value;
  }
  function catalog() {
    const out = [];
    for (const [itemId, types] of Object.entries(KITS)) {
      const e = catalogEntry(itemId);
      out.push({ itemId, name: e ? e.name : ALL[types[0]].name, price: e ? e.price : priceOf(types[0]), leasePerDay: e ? e.leasePerDay : null, upkeepPerDay: e ? e.upkeepPerDay : null, types: types.slice() });
    }
    return out;
  }
  /** physical work rate of a type or of a live rig (tractor + implement): width m, speed m/s, ha/h, h/ha.
   *  Rig speed is the implement's working speed limited by the tractor's power (same rule as driving). */
  function rateFor(width, speed, eff = FIELD_EFF) {
    const haH = width * speed * 0.36 * eff;
    return { width, speed: +speed.toFixed(3), kmh: +(speed * 3.6).toFixed(1), haPerHour: +haH.toFixed(3), hoursPerHa: haH > 0 ? +(1 / haH).toFixed(3) : null, fieldEfficiency: eff, source: kitApplied ? 'simulation.workRates().kit' : 'vehicles defaults' };
  }
  function workRate(what, withType) {
    let v = byId.get(what);
    let type = v ? v.type : what;
    let hp = null;
    if (v && TYPES[v.type]) {
      hp = (TYPES[v.type].hp || 100) * (v.upgrades && v.upgrades.engine ? 1.2 : 1);
      const imp = partsOf(v).find((p) => ALL[p.type].work);
      if (imp) type = imp.type; else if (!TYPES[v.type].header) return null;
    } else if (withType && TYPES[withType]) hp = TYPES[withType].hp;
    const T = ALL[type];
    if (!T) return null;
    const w = T.work || (T.header ? { tool: 'harvest', width: T.header.width, speed: T.workSpeed, needHp: 0 } : null);
    if (!w) return null;
    const pr = hp && w.needHp ? Math.max(0.35, Math.min(1, hp / w.needHp)) : 1;
    return { type, tool: w.tool, needHp: w.needHp || null, ...rateFor(w.width, w.speed * pr, w.eff || FIELD_EFF) };
  }
  function typesApi() {
    const out = {};
    for (const [k, T] of Object.entries(ALL)) {
      out[k] = { kind: T.kind, name: T.name, len: T.len, wid: T.wid, hp: T.hp || null, vmax: T.vmax || null, tank: T.tank || null, mount: T.mount || null, work: T.work ? { ...T.work, ...rateFor(T.work.width, T.work.speed, T.work.eff || FIELD_EFF) } : T.header ? { tool: 'harvest', width: T.header.width, ...rateFor(T.header.width, T.workSpeed) } : null, capacity: T.capacity || T.grainTank || null, item: itemOf(k) };
    }
    return out;
  }
  function unload(id, dest = 'farm') {
    const v = byId.get(id);
    const sim = mod('simulation');
    if (!v || !v.cargo || !(v.cargo.kg > 0)) return 0;
    if (dest === 'farm' && sim && sim.addInventory && v.cargo.item) {
      const t = v.cargo.kg / 1000;
      const stored = sim.addInventory(v.cargo.item, t) || 0;
      v.cargo.kg = Math.max(0, v.cargo.kg - stored * 1000);
      if (v.cargo.kg < 1) { v.cargo.kg = 0; v.cargo.item = null; }
      return stored * 1000;
    }
    const tgt = byId.get(dest);
    if (tgt && tgt.cargo) {
      const cap = (ALL[tgt.type].capacity || ALL[tgt.type].grainTank || 0) - tgt.cargo.kg;
      const kg = Math.min(cap, v.cargo.kg);
      if (kg <= 0) return 0;
      tgt.cargo.kg += kg; tgt.cargo.item = v.cargo.item;
      v.cargo.kg -= kg; if (v.cargo.kg < 1) { v.cargo.kg = 0; v.cargo.item = null; }
      return kg;
    }
    return 0;
  }
  // combine → trailer alongside (auger on the left): continuous transfer
  function autoUnload(v, dt) {
    if (!ALL[v.type].header || !v.cargo || v.cargo.kg <= 0 || !v.unloading) return;
    const T = ALL[v.type];
    const [ax, ay] = toWorld(v.x, v.y, v.rot, -(T.wid / 2 + 3.2), -T.len * 0.1);
    for (const t of W.list) {
      if (!t.cargo || t === v || ALL[t.type].kind !== 'trailer') continue;
      if (distToBox(ax, ay, t.x, t.y, t.rot, ALL[t.type].wid, ALL[t.type].len) < 1.2) { unload(v.id, t.id); v._unloadRate = 0; return; }
    }
  }

  // ---------------------------------------------------------------- player keys (hitch / refuel / unload)
  function activeDriven() {
    const pid = world.player && world.player.activeCharacterId;
    if (!pid) return null;
    for (const v of W.list) if (v.driverId === pid) return v;
    return null;
  }
  function playerKeys() {
    const v = activeDriven();
    if (!v) return;
    const inp = ctx.input;
    if (inp.pressed('KeyH')) hitchNearest(v.id);
    if (inp.pressed('KeyG') && Math.abs(v.speed) < 0.5) {
      const mode = refuelMode(v);
      const got = refuel(v.id);
      const ui = mod('ui');
      const why = !mode ? 'Drive to a fuel point or the farmyard to refuel' : mode === 'yard' ? 'No diesel in the farm tank (buy diesel first)' : 'Tank full or no money';
      if (ui && ui.toast) ui.toast(got > 0 ? `Refuelled ${got.toFixed(0)} L diesel` : why, { kind: got > 0 ? 'info' : 'warn', icon: 'diesel' });
    }
    if (inp.pressed('KeyU') && ALL[v.type].header) v.unloading = !v.unloading;
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    if (world.time && world.time.paused) return; // user pause: nothing drives, burns or works
    stepCount++;
    playerKeys();
    for (let i = 0; i < W.list.length; i++) {
      const v = W.list[i];
      if (!TYPES[v.type]) continue;
      if (v.driverId || Math.abs(v.speed) > 0.001) driver.step(v, dt);
      else if (v.engine) v.engine = false;
      if (v.unloading) autoUnload(v, dt);
    }
  }

  // ---------------------------------------------------------------- render + hud
  const painter = createPainter(ctx.art, ctx.palette);
  render = createRender({ ctx, W, byId, painter, driver, mod, fxRng, isDark });
  ctx.renderer.addCollector((view, F) => render.collect(view, F));
  const hud = createHud({ ctx, mod, get: activeDriven, byId, repairCost, refuel, repair, isDark });
  hud.install();

  // ---------------------------------------------------------------- save / load
  function save() {
    return {
      counter: W.counter,
      stepCount,
      fuelPoints: (W.fuelPoints || []).map((p) => ({ ...p })),
      list: W.list.map((v) => {
        const o = {};
        for (const [k, val] of Object.entries(v)) if (!SAVE_SKIP.has(k) && k[0] !== '_') o[k] = val && typeof val === 'object' ? JSON.parse(JSON.stringify(val)) : val;
        return o;
      }),
    };
  }
  function load(d) {
    if (!d || !Array.isArray(d.list)) return;
    for (const v of W.list) { ctx.spatial.remove(v.id); if (render) render.release(v); }
    W.list = d.list.map((v) => ({ ...v, attached: (v.attached || []).slice(), upgrades: { ...(v.upgrades || {}) }, cargo: v.cargo ? { ...v.cargo } : null, ...(v.ctl ? { ctl: { ...v.ctl } } : {}) }));
    W.counter = d.counter || W.list.length;
    if (Number.isFinite(d.stepCount)) stepCount = d.stepCount;
    if (Array.isArray(d.fuelPoints)) W.fuelPoints = d.fuelPoints.map((p) => ({ ...p }));
    byId.clear();
    for (const v of W.list) byId.set(v.id, v);
    for (const v of W.list) moved(v);
    W.version++;
  }

  const api = {
    spawn, despawn, get, nearest, enter, exit, control, attach, detach, refuel, repair, upgrade, purchase, sell, catalog,
    setImplement, setLights, unload, hitchNearest, exitPosition, workRate,
    /** copies (read-only snapshots); use get(id) for the live record */
    list: (filter) => (filter ? W.list.filter((v) => (typeof filter === 'function' ? filter(v) : Object.entries(filter).every(([k, val]) => v[k] === val))) : W.list).map(snap),
    addFuelPoint, removeFuelPoint,
    driverOf: (id) => { const v = byId.get(id); return v ? v.driverId || null : null; },
    types: typesApi,
    setSeed: (id, crop) => { const v = byId.get(id); if (!v) return false; v.seed = String(crop); for (const p of partsOf(v)) p.seed = v.seed; return true; },
    rigOf: (id) => { const v = byId.get(id); return v ? [v.id, ...v.attached] : []; },
    surfaceUnder: (id) => { const v = byId.get(id); return v ? driver.surfaceAt(v.x, v.y) : null; },
  };

  const inst = {
    api,
    update,
    frame: (dt) => render.frame(dt),
    save, load,
    dispose() { for (const v of W.list) { ctx.spatial.remove(v.id); render.release(v); } hud.dispose(); },
  };
  inst._internal = { W, byId, driver, render, step: update, stepCount: () => stepCount };
  internals.set(ctx, inst._internal);
  return inst;
}

const internals = new WeakMap();

export const showcase = {
  deps: ['terrain', 'environment', 'roads', 'effects', 'crops'],
  presets: PRESETS,
  async stage(ctx, presetName) {
    await stageShowcase(ctx, presetName, internals.get(ctx));
  },
};
