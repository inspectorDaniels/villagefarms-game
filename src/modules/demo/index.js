// demo (wave 3): composes the playable game from the other modules' public APIs only.
// startGame() builds the valley (terrain pads, roads, parcels, buildings, fields, machines, people),
// then office.js runs the farm office panel (K), the getting-started objectives and the tutorial.
import { planValley, PARCEL_NAMES, polyArea, centroid, rect, inPoly } from './layout.js';
import { createOffice } from './office.js';

export const manifest = {
  id: 'demo',
  wave: 3,
  deps: ['terrain', 'environment', 'roads', 'simulation', 'ui'],
  optionalDeps: ['audio', 'effects', 'crops', 'buildings', 'vehicles', 'characters', 'props', 'animals', 'traffic', 'buildtools'],
  namespaces: ['demo'],
  api: ['startGame', 'scene', 'pois', 'layout', 'objectives', 'sellFromStore', 'hireHand'],
  emits: ['demo:started', 'demo:objective'],
  listens: ['crops:worked', 'vehicles:entered', 'jobs:accepted', 'economy:transaction', 'buildings:removed'],
};

const OLD_BUILDINGS = 40; // r7: the family farm's buildings are ~40 years old (buildings must pass it to simulation.grantAsset)
const MAX_HOUSES = 20; // village houses (22→14 made no measurable frame-time difference; see core-requests)
const MAX_FIELDS = 34; // NPC parcels (crops cost per field; harness valley ≈ 48 parcels)
const INST = new WeakMap(); // ctx → api (showcase)

const MARCH_CROPS = ['wheat', 'wheat', 'barley', 'sugarBeet', 'rapeseed', 'wheat', 'potatoes', 'grass', 'barley', 'maize', 'oats', 'wheat'];

export async function init(ctx) {
  const W = ctx.world;
  const D = W.demo;
  Object.assign(D, { v: 1, progress: {}, clearMorning: null, started: false, sites: null, pois: [], ids: {}, parcels: {}, fields: {}, objectives: {}, tutorial: 0, stats: {} });
  const mod = (id) => ctx.modules.get(id);
  const rng = ctx.rng('layout');
  let L = null;
  const office = createOffice(ctx, D);
  ctx.events.on('buildings:removed', (e) => {
    const nid = e && D.oldGrants ? D.oldGrants[e.id] : null;
    const S = mod('simulation');
    if (nid && S && S.releaseAsset) { S.releaseAsset(nid, { writeOff: true }); delete D.oldGrants[e.id]; }
  });

  // ------------------------------------------------------------------ helpers
  const dryT = () => {
    const T = mod('terrain');
    return T ? { isWater: (x, y) => T.isWater(x, y) === true, heightAt: (x, y) => T.heightAt(x, y), findDry: (x, y, r) => T.findDry(x, y, r) } : null;
  };
  const step = (name, fn) => {
    try { const r = fn(); D.stats[name] = r === undefined ? 'ok' : r; return r; } catch (e) { ctx.error(e, 'startGame:' + name); D.stats[name] = 'failed'; return null; }
  };
  const rotFacing = (fx, fy) => Math.atan2(fx, -fy); // rot whose facing vector (sin r, -cos r) = (fx, fy)

  /** nearest point + tangent of a polyline to (x, y) */
  function nearestOn(pts, x, y) {
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) { const l = Math.sqrt(L2); best = { x: px, y: py, tx: dx / l, ty: dy / l, d }; }
    }
    return best;
  }
  function dims(type, variant) {
    const B = mod('buildings');
    const fp = B && B.footprint ? B.footprint(type, 0, 0, 0, variant || 0) : null;
    if (!Array.isArray(fp) || !fp.length) return { w: 12, d: 10 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of fp) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { w: x1 - x0, d: y1 - y0, cy: (y0 + y1) / 2 };
  }
  /** place a building facing a street polyline, on `side` (+1 / -1 of the street direction), searching along it */
  function placeFacing(type, opts, pts, x, y, side, setback, halfRoad, span = 30) {
    const B = mod('buildings');
    if (!B) return null;
    const near = nearestOn(pts, x, y);
    if (!near) return null;
    const nx = -near.ty * side, ny = near.tx * side;
    const dm = dims(type, opts.variant);
    const off = halfRoad + setback + dm.d / 2;
    const rot = rotFacing(-nx, -ny);
    for (const o of [0, 5, -5, 10, -10, 15, -15, 20, -20, 26, -26, 32, -32].filter((v) => Math.abs(v) <= span)) {
      const px = near.x + near.tx * o + nx * off, py = near.y + near.ty * o + ny * off;
      // footprint centre is not the body centre when the local y extent is asymmetric
      const cx = px - Math.sin(rot) * -dm.cy, cy = py + Math.cos(rot) * -dm.cy;
      const chk = B.canPlace(type, cx, cy, rot, { variant: opts.variant || 0, owner: opts.owner || 'npc' });
      if (chk && chk.ok) {
        const id = B.place(type, cx, cy, rot, opts);
        if (id) return id;
      }
    }
    return null;
  }
  /** place near (x, y) with a small spiral search (farm clusters) */
  function placeNear(type, x, y, rot, opts, r = 14) {
    const B = mod('buildings');
    if (!B) return null;
    const tries = [[0, 0]];
    for (let d = 3; d <= r; d += 3) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) tries.push([a * d, b * d]);
    for (const [dx, dy] of tries) {
      const chk = B.canPlace(type, x + dx, y + dy, rot, { variant: opts.variant || 0, owner: opts.owner || 'npc' });
      if (chk && chk.ok) { const id = B.place(type, x + dx, y + dy, rot, opts); if (id) return id; }
    }
    if (opts.owner === 'player') { const id = B.place(type, x, y, rot, { ...opts, force: true }); if (id) return id; }
    return null;
  }
  const chain = (name) => (L.chains.find((c) => c.name === name) || { pts: [] }).pts;

  // ------------------------------------------------------------------ startGame
  async function startGame() {
    if (D.started) return D.stats;
    const T = mod('terrain'), R = mod('roads'), S = mod('simulation'), UI = mod('ui');
    const B = mod('buildings'), CR = mod('crops'), V = mod('vehicles'), CH = mod('characters');
    const P = mod('props'), AN = mod('animals'), TR = mod('traffic');
    if (CH && CH.setAutoSpawn) CH.setAutoSpawn(false);

    L = planValley(dryT(), W.bounds, rng);
    const st = L.sites;

    // 1. terrain: level the farm, village and neighbour pads (in place: no regeneration)
    step('terrain', () => {
      if (!T) return 'absent';
      const flatAreas = [{ x: st.farm.x, y: st.farm.y, r: 44 }, { x: st.cross.x, y: st.cross.y + 10, r: 62 },
        ...st.farms.map((f) => ({ x: f.x, y: f.y, r: 34 })), { x: st.depot.x, y: st.depot.y, r: 20 }];
      // generate() with the boot valley's settings is a no-op; level each pad in place instead
      for (const a of flatAreas) T.flatten(a);
      T.flatten({ poly: st.yard });
      T.paintSurface({ poly: st.yard }, 'farmyard');
      return flatAreas.length;
    });

    // 2. roads
    step('roads', () => {
      if (!R) return 'absent';
      const r = R.generateNetwork(L.plan);
      if (!r) ctx.warn('roads.generateNetwork rejected the plan');
      return r ? { nodes: r.nodes, edges: r.edges } : 'rejected';
    });

    // 3. parcels
    step('parcels', () => {
      if (!S) return 'absent';
      D.parcels.yard = S.defineParcel({ name: 'Hoeve Ter Linde', poly: st.yard, soil: 0.55, state: 'owned', tradeable: false });
      D.parcels.start = S.defineParcel({ name: 'Lindeveldje', poly: st.field, soil: 0.68, state: 'rented' });
      // r3: the bigger neighbouring field east of the farm track is the next step ("Rent a second field")
      D.parcels.east = S.defineParcel({ name: 'Lindekouter', poly: st.fieldEast, soil: 0.66, state: 'forRent' });
      D.parcels.west = S.defineParcel({ name: 'Smalle Strook', poly: st.fieldWest, soil: 0.6, state: 'npc', owner: 'Jef Vermeulen' });
      const clients = ['Jef Vermeulen', 'Marleen Peeters', 'Luc Van den Broeck', 'Annelies De Smet', 'Wim Claes', 'Josée Lambert',
        'Philippe Dubois', 'Marie-Claire Renard', 'Didier Lejeune', 'Bart Goossens'];
      st.farms.forEach((f, k) => { f.client = clients[k]; if (S.defineClientFarm) S.defineClientFarm(clients[k], { x: f.x, y: f.y }); });
      // cap the count (crops cost), keep the larger blocks; deterministic
      let blocks = L.blocks.slice();
      if (blocks.length > MAX_FIELDS) {
        blocks = blocks.map((b, k) => ({ b, k, s: b.area * (0.7 + 0.6 * rng.float()) })).sort((a, b) => b.s - a.s).slice(0, MAX_FIELDS).sort((a, b) => a.k - b.k).map((o) => o.b);
      }
      D.npcParcels = [];
      const byDist = [];
      blocks.forEach((b, k) => {
        const [cx, cy] = centroid(b.poly);
        let owner = null, bd = Infinity;
        st.farms.forEach((f) => { const d = Math.hypot(cx - f.x, cy - f.y); if (d < bd && d < 320) { bd = d; owner = f.client; } });
        if (!owner) owner = clients[3 + (k % 7)];
        const soil = +(0.35 + 0.55 * rng.float()).toFixed(2);
        const id = S.defineParcel({ name: PARCEL_NAMES[k % PARCEL_NAMES.length], poly: b.poly, soil, state: 'npc', owner });
        D.npcParcels.push(id);
        byDist.push({ id, d: Math.hypot(cx - st.farm.x, cy - st.farm.y), ha: b.area / 1e4 });
      });
      // the land market opens with a few nearby listings (it adds more monthly)
      byDist.sort((a, b) => a.d - b.d);
      const rentable = byDist.filter((p) => p.ha >= 1 && p.ha <= 3.2).slice(0, 2);
      const forSale = byDist.filter((p) => p.ha >= 1.5 && p.ha <= 4.5 && !rentable.includes(p)).slice(0, 1);
      for (const p of rentable) S.defineParcel({ ...S.parcel(p.id), id: p.id, state: 'forRent' });
      for (const p of forSale) S.defineParcel({ ...S.parcel(p.id), id: p.id, state: 'forSale' });
      return (S.parcels() || []).length;
    });

    // 4. buildings
    step('buildings', () => {
      if (!B) return 'absent';
      const ids = D.ids;
      const F = st.farm;
      // the farmhouse door opens onto the yard (south)
      ids.farmhouse = placeNear('farmhouse', F.x - 22, F.y - 22, Math.PI, { owner: 'player', grant: true, ageYears: OLD_BUILDINGS, variant: 0, name: 'Farmhouse' }, 6);
      ids.barn = placeNear('barn', F.x + 29, F.y - 6, -Math.PI / 2, { owner: 'player', grant: true, ageYears: OLD_BUILDINGS, variant: 0 }, 6);
      ids.shed = placeNear('machine_shed', F.x - 26, F.y + 25, 0, { owner: 'player', grant: true, ageYears: OLD_BUILDINGS, variant: 0 }, 6);
      ids.coop = placeNear('chicken_coop', F.x - 37, F.y + 2, Math.PI / 2, { owner: 'player', grant: true, ageYears: OLD_BUILDINGS, variant: 0 }, 6);
      // r7: the family farm's buildings are ~40 years old. buildings.place does not yet pass `ageYears` to
      // simulation.grantAsset (core request #10); until it does, re-book each new grant as an old one here.
      // The building keeps its (now stale) assetId for storage; demo releases its replacement if it is demolished.
      D.oldGrants = D.oldGrants || {};
      if (S && S.assets && S.grantAsset && S.releaseAsset && S.today) {
        for (const key of ['farmhouse', 'barn', 'shed', 'coop']) {
          const b = ids[key] && B.get ? B.get(ids[key]) : null;
          const a = b && b.assetId ? (S.assets() || []).find((q) => q.id === b.assetId) : null;
          if (!a || a.boughtDay < S.today() - 30 * 36) continue; // already old: buildings passed ageYears
          const nid = S.grantAsset(a.itemId, { ageYears: OLD_BUILDINGS, boughtDay: S.today() - OLD_BUILDINGS * 36, category: 'buildings' });
          if (nid) { S.releaseAsset(a.id, { writeOff: true }); D.oldGrants[ids[key]] = nid; }
        }
      }
      // village: specials first, then houses along every street
      const reg = chain('regional'), main = chain('main'), westS = chain('west'), eastS = chain('east'), northS = chain('north');
      const tj = st.tJ;
      ids.grainCoop = placeFacing('grain_coop', { owner: 'npc' }, reg, tj.x - 62, tj.y, -1, 7, 3.5, 32);
      ids.dealer = placeFacing('dealer', { owner: 'npc' }, reg, tj.x + 50, tj.y, -1, 7, 3.5, 32);
      ids.church = placeFacing('church', { owner: 'npc' }, northS, st.cross.x, st.cross.y - 34, -1, 4, 3, 26);
      ids.shop = placeFacing('shop', { owner: 'npc' }, main, st.cross.x, st.cross.y + 26, 1, 3.5, 3, 24);
      ids.dairy = placeFacing('dairy', { owner: 'npc' }, eastS, st.cross.x + 45, st.cross.y, 1, 4, 3, 26);
      ids.cafe = placeFacing('village_house', { owner: 'npc', variant: 1, name: 'Café De Linde' }, main, st.cross.x, st.cross.y + 26, -1, 3, 3, 24);
      ids.depot = placeFacing('grain_coop', { owner: 'npc', name: 'Suikerfabriek Tienen — depot' }, reg, st.depot.x, st.depot.y, 1, 6, 3.5, 30);
      const houses = [];
      const streets = [['main', 1], ['main', -1], ['west', 1], ['west', -1], ['east', 1], ['east', -1], ['north', 1], ['north', -1], ['ne', 1], ['ne', -1], ['loop', 1], ['loop', -1]];
      for (const [name, side] of streets) {
        const pts = chain(name);
        if (pts.length < 2) continue;
        let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        for (let s = 13; s < len - 10 && houses.length < MAX_HOUSES; s += 13) {
          // point at arc length s
          let acc = 0, p = null;
          for (let i = 1; i < pts.length && !p; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + l >= s) { const t = (s - acc) / l; p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } acc += l; }
          if (!p) continue;
          const core = Math.hypot(p[0] - st.cross.x, p[1] - st.cross.y) < 60;
          const variant = core ? (rng.chance(0.7) ? 1 : 0) : (rng.chance(0.25) ? 2 : 0);
          const id = placeFacing('village_house', { owner: 'npc', variant }, pts, p[0], p[1], side, 2.8 + rng.range(0, 2.5), 3, 4);
          if (id) houses.push(id);
        }
      }
      ids.houses = houses;
      // neighbour farms
      ids.farms = st.farms.map((f) => {
        const lane = f.key === 'B' ? -1 : 1; // side the lane arrives from (+y = south)
        const r = f.key === 'B' ? Math.PI : 0;  // buildings face the yard centre / lane
        const o = (dx, dy) => [f.x + dx, f.y + dy * lane];
        const list = [
          placeNear('farmhouse', ...o(-19, -12), r, { owner: 'npc', variant: 1 }, 9),
          placeNear('cow_shed', ...o(17, -14), r, { owner: 'npc', variant: f.key === 'C' ? 1 : 0 }, 9),
          placeNear('barn', ...o(-20, 12), r + Math.PI, { owner: 'npc', variant: 1 }, 9),
          placeNear('grain_silo', ...o(22, 10), 0, { owner: 'npc', variant: 0 }, 9),
        ];
        return list.filter(Boolean);
      });
      // the sugar/potato depot buys roots (buildings registered it as a grain buyer)
      const dep = ids.depot && B.get(ids.depot);
      if (dep && dep.sellPointId && S) S.defineSellPoint(dep.sellPointId, { name: dep.name || 'Suikerfabriek Tienen — depot', x: dep.doors[0].x, y: dep.doors[0].y, accepts: ['sugarBeet', 'potatoes'] });
      return { player: [ids.farmhouse, ids.barn, ids.shed].filter(Boolean).length, houses: houses.length, total: (B.list() || []).length };
    });

    // 5. crops: every parcel gets a field; neighbours' fields grow for the month, ours is stubble
    step('crops', () => {
      if (!CR || !S) return 'absent';
      D.fields.start = CR.createField(st.field, { parcelId: D.parcels.start, state: 'stubble', name: 'Lindeveldje' });
      if (D.parcels.east) D.fields.east = CR.createField(st.fieldEast, { parcelId: D.parcels.east, state: 'stubble', name: 'Lindekouter' });
      if (D.parcels.west) CR.createField(st.fieldWest, { parcelId: D.parcels.west, crop: 'wheat', stage: 'auto', name: 'Smalle Strook' });
      const r = ctx.rng('crops-plan');
      let n = 0;
      for (const pid of D.npcParcels || []) {
        const p = S.parcel(pid);
        if (!p) continue;
        const crop = MARCH_CROPS[r.int(0, MARCH_CROPS.length - 1)];
        const fid = CR.createField(p.poly, { parcelId: pid, crop, stage: 'auto', name: p.name });
        if (fid) n++;
      }
      return n + 1;
    });

    // 6. vehicles
    step('vehicles', () => {
      if (!V) return 'absent';
      const F = st.farm, ids = D.ids;
      // r2.3 old, cheap starting kit: granted as long-owned assets (book value at simulation's 20 % floor) with
      // high wear, so the whole kit resells for ≈ €9k (half the starting cash). The pickup is the family car:
      // spawned without an asset record, so it cannot be sold and carries no upkeep.
      const old = S && S.today ? { boughtDay: S.today() - 16 * 36, ageYears: 16 } : {}; // ageYears: r7 API; boughtDay: older simulation
      const grant = (item) => (S && S.grantAsset ? S.grantAsset(item, old) : null);
      const put = (type, x, y, rot, assetId, wear, extra) => V.spawn(type, x, y, rot, { owner: 'owned', assetId, wear, ...(extra || {}) }) || null;
      const tA = grant('tractor_t1'), kA = grant('tillage_s'), trA = grant('trailer');
      // seed drill loaded with a crop that can be sown now (r2.5)
      const cal = CR && CR.calendar ? CR.calendar() || {} : {};
      const seed = ['oats', 'barley', 'wheat', 'sugarBeet', 'potatoes', 'maize', 'rapeseed'].find((c) => cal[c] && cal[c].canSow) || Object.keys(cal).find((c) => cal[c] && cal[c].canSow) || 'barley';
      ids.tractor = put('tractor_t1', F.x - 2, F.y - 4, Math.PI, tA, 0.55, { fuel: 80 }); // faces the field (south), in view of the farmhouse door
      ids.plough = put('plough_s', F.x + 16, F.y + 6, Math.PI, kA, 0.5);
      ids.seeder = put('seeder_s', F.x + 11, F.y + 6, Math.PI, kA, 0.45, { seed });
      // the grain trailer stands east of the implements, clear of their exit lane south (r2.5)
      ids.trailer = put('trailer_grain', F.x + 33, F.y + 24, Math.PI, trA, 0.4);
      ids.pickup = put('pickup', F.x - 36, F.y - 9, Math.PI / 2, null, 0.35);
      if (ids.tractor && ids.plough && V.attach) V.attach(ids.tractor, ids.plough);
      if (ids.seeder && V.setSeed) V.setSeed(ids.seeder, seed);
      // neighbours' machinery parked in their yards
      const npc = [];
      st.farms.forEach((f) => {
        const lane = f.key === 'B' ? -1 : 1;
        const putN = (type, dx, dy, rot) => { const id = V.spawn(type, f.x + dx, f.y + dy * lane, rot, { owner: null }); if (id) npc.push(id); return id; };
        putN(f.key === 'C' ? 'tractor_t3' : 'tractor_t2', -3, 16, 0);
        putN('trailer_grain', 6, 18, 0);
        if (f.key === 'B') putN('combine_s', 2, -2, Math.PI / 2);
        if (f.key === 'C') putN('plough_l', 3, -2, Math.PI / 2);
      });
      ids.npcVehicles = npc;
      return 4 + npc.length;
    });

    // 7. characters
    step('characters', () => {
      if (!CH) return 'absent';
      const B2 = mod('buildings');
      const door = D.ids.farmhouse && B2 && B2.doorOf ? B2.doorOf(D.ids.farmhouse) : null;
      const home = door ? { x: door.x, y: door.y, rot: door.rot } : { x: st.farm.x - 22, y: st.farm.y - 30, rot: 0 };
      const sx = home.x + Math.sin(home.rot || 0) * 1.2, sy = home.y - Math.cos(home.rot || 0) * 1.2;
      D.ids.farmer = CH.spawn({ role: 'player', name: 'Jan', x: sx, y: sy, rot: Math.PI, home, tool: 'hoe', sex: 'm', age: 'adult' });
      if (D.ids.farmer && CH.setActive) CH.setActive(D.ids.farmer);
      // a starting hand only if the economy already employs one
      const ws = S && S.workers ? S.workers() || [] : [];
      if (ws.length) CH.spawn({ role: 'hired', name: ws[0].name, workerId: ws[0].id, x: sx + 2.4, y: sy + 1.2, home, tool: 'hoe' });
      const v = st.village;
      D.ids.villagers = CH.villagers(8, { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 }) || [];
      return 1 + ws.length + D.ids.villagers.length;
    });

    // 8. optional life: props, animals, traffic (modules not built yet are skipped)
    step('props', () => (P ? composeProps(P) : 'absent'));
    step('animals', () => (AN ? composeAnimals(AN) : 'absent'));
    step('traffic', () => { if (!TR) return 'absent'; if (TR.setDensity) TR.setDensity(1); return 'on'; });

    // 9. economy extras: last year's grain in the store (a first sale for the tutorial)
    step('economy', () => {
      if (!S) return 'absent';
      if (S.addInventory) S.addInventory('wheat', 12);
      return S.money();
    });

    // pois
    D.sites = { farm: st.farm, cross: st.cross, tJ: st.tJ, depot: st.depot, bridge: st.bridge, field: centroid(st.field), fieldEast: centroid(st.fieldEast), village: st.village, farms: st.farms.map((f) => ({ key: f.key, x: f.x, y: f.y, client: f.client })) };
    D.pois = buildPois();
    D.started = true;

    // camera follows the farmer (characters does this on setActive); make sure of a sensible zoom
    // r2.4 opening frame: ~22 px/m on the farmer and the tractor, a clear first morning, a label on the tractor
    if (CH && typeof CH.setFollowZoom === 'function') CH.setFollowZoom(22);
    if (!ctx.params.cam && !ctx.params.showcase) {
      const tv = D.ids.tractor && V ? V.get(D.ids.tractor) : null;
      const fp = D.ids.farmer && CH ? CH.positionOf(D.ids.farmer) : null;
      if (tv && fp) ctx.camera.set((tv.x + fp.x) / 2, (tv.y + fp.y) / 2, 22);
      else ctx.camera.set(st.farm.x, st.farm.y, 22);
    }
    const E = mod('environment');
    if (E && E.setWeather && !ctx.params.weather && !ctx.params.showcase) { E.setWeather('clear', 0.5, { instant: true }); D.clearMorning = { day: ctx.clock.dayOfYear }; }
    office.start({ UI, parcels: D.parcels, fields: D.fields });
    ctx.events.emit('demo:started', { stats: D.stats });
    return D.stats;
  }

  function composeProps(P) {
    const st = L.sites;
    let n = 0;
    // hedgerows along parcel edges (sides only, broken for gates), poplar row along the regional road
    for (const b of L.blocks.slice(0, 24)) {
      const q = b.poly;
      if (P.hedge) { P.hedge([q[0], q[1]]); P.hedge([q[3], q[2]]); n += 2; }
    }
    const reg = chain('regional');
    if (P.row) { P.row('poplar', reg.map(([x, y]) => [x, y - 9]), 14); n++; }
    if (P.fence) { P.fence(st.yard.concat([st.yard[0]]), 'post-and-rail', { gateAt: 0.12 }); n++; }
    if (P.forest) for (const poly of L.spare.slice(0, 8)) { P.forest(poly, { mix: 'mixed', density: 0.6 }); n++; }
    if (P.row) { P.row('apple', [[st.farm.x - 44, st.farm.y + 44], [st.farm.x - 44, st.farm.y - 30]], 7); n++; }
    return n;
  }
  function composeAnimals(AN) {
    const st = L.sites;
    let n = 0;
    if (AN.createPen) {
      const pen = AN.createPen(rect(st.farm.x - 36, st.farm.y + 12, 12, 10), 'chicken', { trough: { x: st.farm.x - 36, y: st.farm.y + 12 } });
      if (pen && AN.addAnimal) for (let i = 0; i < 6; i++) { AN.addAnimal('chicken', pen, st.farm.x - 38 + (i % 3) * 2, st.farm.y + 10 + Math.floor(i / 3) * 2); n++; }
      for (const f of st.farms) {
        const species = f.key === 'A' ? 'sheep' : 'cow';
        const cx = f.x + 34, cy = f.y;
        const p2 = AN.createPen(rect(cx, cy, 30, 34), species, { trough: { x: cx - 12, y: cy } });
        if (p2 && AN.addAnimal) for (let i = 0; i < 6; i++) { AN.addAnimal(species, p2, cx - 8 + (i % 3) * 6, cy - 8 + Math.floor(i / 3) * 10); n++; }
      }
    }
    return n;
  }

  function buildPois() {
    const B = mod('buildings');
    const S = D.sites;
    const out = [];
    const add = (id, name, x, y, kind, zoom = 16) => { if (Number.isFinite(x) && Number.isFinite(y)) out.push({ id, name, x: +x.toFixed(1), y: +y.toFixed(1), kind, zoom }); };
    add('farm', 'Hoeve Ter Linde (your farm)', S.farm.x, S.farm.y, 'farm', 14);
    add('field', 'Lindeveldje (rented, 0.25 ha)', S.field[0], S.field[1], 'field', 10);
    if (S.fieldEast) add('fieldEast', 'Lindekouter (to rent, 1.0 ha)', S.fieldEast[0], S.fieldEast[1], 'field', 10);
    add('village', 'Village centre', S.cross.x, S.cross.y + 20, 'village', 10);
    if (S.bridge) add('bridge', 'River bridge', S.bridge.x, S.bridge.y, 'road', 18);
    const bld = (key, name, kind) => { const b = D.ids[key] && B && B.get ? B.get(D.ids[key]) : null; if (b) add(key, b.name || name, b.x, b.y, kind); };
    bld('farmhouse', 'Farmhouse', 'home');
    bld('shed', 'Machine shed (fuel, repair)', 'service');
    bld('grainCoop', 'Grain co-op', 'sell');
    bld('dealer', 'Dealer', 'sell');
    bld('dairy', 'Dairy', 'sell');
    bld('shop', 'Village shop', 'sell');
    bld('church', 'Church', 'landmark');
    bld('depot', 'Sugar & potato depot', 'sell');
    for (const f of S.farms) add('farm' + f.key, (f.client || 'Neighbour') + "'s farm", f.x, f.y, 'neighbour', 12);
    return out;
  }

  // ------------------------------------------------------------------ scenes
  // weather: showcases pin it so the vantage points read well; 'auto' hands it back to the seasonal plan
  const SCENES = {
    farm: { poi: 'farm', zoom: 14, weather: 'clear' },
    village: { poi: 'village', zoom: 11, weather: 'clear' },
    overview: { zoom: 3, weather: 'clear' },
    night: { poi: 'village', zoom: 10, time: '22:30', weather: 'clear' },
    rain: { poi: 'farm', zoom: 16, weather: 'rain' },
    autumn: { poi: 'field', zoom: 6, weather: 'cloudy' },
    winter: { poi: 'farm', zoom: 9, weather: 'snow' },
    play: { follow: true, zoom: 24, weather: 'auto' },
    field: { poi: 'field', zoom: 7 },
    bridge: { poi: 'bridge', zoom: 16 },
  };
  function scene(name) {
    const sc = SCENES[name];
    if (!sc) return false;
    const E = mod('environment');
    if (sc.time) ctx.clock.set(sc.time);
    if (E && E.setWeather && sc.weather) E.setWeather(sc.weather, sc.weather === 'rain' ? 0.8 : 0.6, { instant: true });
    if (sc.follow) {
      const CH = mod('characters');
      const id = W.player.activeCharacterId || D.ids.farmer;
      if (CH && typeof CH.setFollowZoom === 'function') CH.setFollowZoom(sc.zoom);
      if (CH && CH.positionOf) {
        ctx.camera.follow(() => { const p = CH.positionOf(W.player.activeCharacterId || id); return p ? { x: p.x, y: p.y } : null; });
        const p = CH.positionOf(id);
        if (p) ctx.camera.set(p.x, p.y, sc.zoom);
      }
      return true;
    }
    ctx.camera.follow(null);
    if (sc.poi) {
      const p = D.pois.find((q) => q.id === sc.poi);
      if (p) ctx.camera.set(p.x, p.y, sc.zoom);
    } else ctx.camera.set(W.bounds.w / 2, W.bounds.h / 2, sc.zoom);
    return true;
  }

  const api = {
    startGame,
    scene,
    pois: () => D.pois.map((p) => ({ ...p })),
    layout: () => (L ? { nodes: L.plan.nodes.length, edges: L.plan.edges.length, blocks: L.blocks.length, spare: L.spare.length, sites: D.sites, ids: { ...D.ids }, parcels: { ...D.parcels }, fields: { ...D.fields }, stats: { ...D.stats } } : null),
    objectives: () => office.objectives(),
    sellFromStore: (item, qty, sellPointId) => office.sellFromStore(item, qty, sellPointId),
    hireHand: () => office.hireHand(),
  };
  INST.set(ctx, api);

  return {
    api,
    update(dt) {
      if (!D.started) return;
      office.update(dt);
      if (D.clearMorning && (ctx.clock.hour >= 13 || ctx.clock.dayOfYear !== D.clearMorning.day)) {
        const E = mod('environment');
        if (E && E.setWeather) E.setWeather('auto');
        D.clearMorning = null;
      }
    },
    save() {
      return { v: 1, started: D.started, sites: D.sites, pois: D.pois, ids: D.ids, parcels: D.parcels, fields: D.fields, npcParcels: D.npcParcels, objectives: D.objectives, tutorial: D.tutorial, progress: D.progress, clearMorning: D.clearMorning, oldGrants: D.oldGrants };
    },
    load(d) {
      if (!d || d.v !== 1) return;
      for (const k of ['started', 'sites', 'pois', 'ids', 'parcels', 'fields', 'npcParcels', 'objectives', 'tutorial', 'progress', 'clearMorning', 'oldGrants']) if (d[k] !== undefined) D[k] = JSON.parse(JSON.stringify(d[k]));
      office.reload();
    },
  };
}

export const showcase = {
  // modules not built yet (props, animals, traffic, buildtools) are added here once they exist
  deps: ['audio', 'effects', 'crops', 'buildings', 'vehicles', 'characters'],
  presets: {
    default: { time: '10:30' },
    farm: { time: '09:30' },
    village: { time: '11:00' },
    overview: { time: '12:30' },
    night: { time: '22:30' },
    rain: { time: '15:00' },
    autumn: { time: '16:30', day: 28 },
    winter: { time: '11:30', day: 1 },
    play: { time: '08:00' },
  },
  async stage(ctx, presetName) {
    const api = INST.get(ctx);
    if (!api) return;
    await api.startGame();
    api.scene(presetName === 'default' ? 'farm' : presetName);
  },
};
