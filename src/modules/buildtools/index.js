// buildtools — construction / placement mode (key B) and land mode.
// Ghost preview snapped to 0.5 m, R rotates, validity from buildings.canPlace + simulation land rights + money,
// fields drawn as polygons inside owned/rented parcels, farm tracks through roads, demolish, 10 s undo (full refund).
import { snap, polyArea, centroid, bbox, pointInPoly, selfIntersects, polysOverlap, edgeSamples, interiorSamples, polylineLength, distToSeg } from './geom.js';
import * as SC from './showcase.js';

export const manifest = {
  id: 'buildtools',
  wave: 2,
  deps: ['simulation', 'ui'],
  optionalDeps: ['terrain', 'roads', 'crops', 'buildings', 'props', 'animals'],
  namespaces: ['buildtools'],
  api: ['enter', 'exit', 'isActive', 'select', 'preview', 'placeAt', 'undo', 'cancel', 'rotate', 'tools', 'status'],
  emits: ['buildtools:placed', 'buildtools:demolished', 'buildtools:mode'],
  listens: [],
};

// ---- tuning (game-scale €)
export const COST = {
  trackPerM: 14,      // gravel/dirt farm track, € per metre
  fencePerM: 18,
  hedgePerM: 9,
  tree: 45,
  penPerM: 22,        // pen fence perimeter
  field: 0,           // marking out a field boundary is free (the land is already paid/rented)
};
const UNDO_S = 10;            // real seconds (counted from update dt)
const MIN_FIELD_M2 = 200;
const MAX_TRACK_M = 300;
const NODE_SNAP_M = 3.5;

const TOOL_DEFS = [
  { id: 'building', label: 'Buildings', icon: 'barn', mod: 'buildings' },
  { id: 'field', label: 'Field', icon: 'wheat', mod: 'crops' },
  { id: 'path', label: 'Farm track', icon: 'map', mod: 'roads' },
  { id: 'fence', label: 'Fences & hedges', icon: 'build', mod: 'props', fn: 'fence' },
  { id: 'tree', label: 'Trees', icon: 'star', mod: 'props', fn: 'place' },
  { id: 'pen', label: 'Animal pen', icon: 'cow', mod: 'animals', fn: 'createPen' },
  { id: 'demolish', label: 'Demolish', icon: 'close', mod: null },
];

export async function init(ctx) {
  const W = ctx.world.buildtools;
  Object.assign(W, { active: false, mode: null, tool: null, item: null, rot: 0, verts: [], chain: null, history: [], placed: 0, demolished: 0, ...W });
  W.active = false; W.verts = []; W.chain = null; W.history = [];

  const mod = (id) => ctx.modules.get(id);
  const sim = () => mod('simulation');
  const ui = () => mod('ui');
  const toast = (text, kind = 'info') => { const u = ui(); if (u && u.toast) u.toast(text, { kind, icon: 'build' }); };
  const money = (v) => { const u = ui(); return u && u.formatMoney ? u.formatMoney(v) : '€' + (Math.round(v * 100) / 100).toFixed(2); };
  const kmoney = (v) => { const u = ui(); return u && u.formatMoney ? u.formatMoney(v, { compact: true }) : '€' + Math.round(v); };
  const fmtHa = (m2) => (m2 / 1e4).toFixed(2) + ' ha';

  const cursor = { x: 0, y: 0, pinned: false };
  let busy = false;          // a confirm dialog is open
  let cached = { key: null, res: null };
  let hover = null;          // land mode: hovered parcel id

  // ------------------------------------------------------------------ helpers
  const activeChar = () => {
    const w = ctx.world;
    const id = w.player && w.player.activeCharacterId;
    const list = w.characters && Array.isArray(w.characters.list) ? w.characters.list : [];
    return id == null ? null : list.find((c) => c && c.id === id) || null;
  };
  const driving = () => { const c = activeChar(); return !!(c && c.vehicleId); };
  const parcelAt = (x, y) => { const S = sim(); return S && S.parcelAt ? S.parcelAt(x, y) : null; };
  const usable = (p) => !!p && (p.state === 'owned' || p.state === 'rented');
  const canUse = (x, y) => { const S = sim(); return !!(S && S.canUse && S.canUse(x, y)); };
  const afford = (v) => { const S = sim(); return !!(S && (v <= 0 || (S.canAfford && S.canAfford(v)))); };

  function buildingItems() {
    const B = mod('buildings');
    const t = (B && B.types && B.types()) || [];
    const list = t.filter((d) => d && d.buildable);
    const dup = (d) => list.filter((q) => q.name === d.name).length > 1;
    return list.map((d) => ({ id: `${d.type}:${d.variant}`, type: d.type, variant: d.variant, name: dup(d) ? `${d.name} ${Math.round(d.w)}×${Math.round(d.h)}` : d.name, cost: d.cost || 0, w: d.w, h: d.h }));
  }
  let itemsCache = null;
  const items = () => (itemsCache || (itemsCache = buildingItems()));
  const findItem = (id) => items().find((i) => i.id === id) || items().find((i) => i.type === id) || null;

  function tools() {
    return TOOL_DEFS.map((d) => {
      let enabled = true, reason = '';
      if (d.mod) {
        const m = mod(d.mod);
        if (!m) { enabled = false; reason = `${d.mod} module not available`; }
        else if (d.fn && typeof m[d.fn] !== 'function') { enabled = false; reason = `${d.mod}.${d.fn} not available`; }
      }
      const out = { id: d.id, label: d.label, icon: d.icon, enabled, reason };
      if (d.id === 'building') out.items = items();
      if (d.id === 'fence') out.items = [{ id: 'fence', name: 'Wooden fence', costPerM: COST.fencePerM }, { id: 'hedge', name: 'Hedge', costPerM: COST.hedgePerM }];
      if (d.id === 'tree') out.items = [{ id: 'oak', name: 'Oak', cost: COST.tree }, { id: 'apple', name: 'Apple tree', cost: COST.tree }];
      return out;
    });
  }
  const toolDef = (id) => tools().find((t) => t.id === id) || null;

  const nearNode = (x, y) => {
    const nodes = (ctx.world.roads && ctx.world.roads.nodes) || [];
    let best = null, bd = NODE_SNAP_M;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  const roadAt = (x, y) => { const R = mod('roads'); return R && R.roadAt ? R.roadAt(x, y) : null; };
  const water = (x, y) => { const T = mod('terrain'); return !!(T && T.waterDepthAt && (T.waterDepthAt(x, y) || 0) > 0.05); };
  function buildingPolysNear(b) {
    const hits = ctx.spatial.queryRect(b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1, (it) => it.kind === 'building' || (it.solid && it.owner === 'buildings'));
    const out = [];
    for (const it of hits) {
      const ps = it.polys || (it.poly && [it.poly]) || (it.data && (it.data.polys || (it.data.poly && [it.data.poly])));
      if (ps) out.push(...ps);
      else if (it.x0 != null) out.push([[it.x0, it.y0], [it.x1, it.y0], [it.x1, it.y1], [it.x0, it.y1]]);
    }
    return out;
  }

  // ------------------------------------------------------------------ validation
  /** polygon (field / pen) validation. closed=false → a polygon still being drawn (cheap checks only) */
  function checkPoly(P, closed, kind = 'field') {
    if (!P.length) return { ok: false, reason: 'click to set the first corner' };
    const p0 = parcelAt(P[0][0], P[0][1]);
    if (!usable(p0)) return { ok: false, reason: p0 ? 'not your land' : 'outside any parcel' };
    if (P.length >= 3 || !closed) {
      if (selfIntersects(P, closed && P.length >= 3)) return { ok: false, reason: 'edges cross' };
    }
    // every vertex and edge sample inside the same parcel
    for (const [x, y] of edgeSamples(P, 2, closed && P.length >= 3)) {
      const p = parcelAt(x, y);
      if (!p || p.id !== p0.id) return { ok: false, reason: usable(p) ? 'crosses a parcel boundary' : 'leaves your land' };
    }
    if (!closed) return { ok: true, parcelId: p0.id };
    if (P.length < 3) return { ok: false, reason: 'needs at least 3 corners' };
    const area = polyArea(P);
    if (area < MIN_FIELD_M2) return { ok: false, reason: `too small (min ${MIN_FIELD_M2} m²)`, area };
    const C = mod('crops');
    if (C && C.fields && kind === 'field') {
      for (const f of C.fields() || []) if (f && f.poly && polysOverlap(P, f.poly)) return { ok: false, reason: `overlaps ${f.name || 'a field'}`, area };
    }
    const b = bbox(P);
    for (const Q of buildingPolysNear(b)) if (polysOverlap(P, Q)) return { ok: false, reason: 'a building is in the way', area };
    const step = Math.max(3, Math.sqrt(area / 400));
    const samples = interiorSamples(P, step).concat(edgeSamples(P, 3, true));
    for (const [x, y] of samples) if (water(x, y)) return { ok: false, reason: 'water', area };
    if (kind === 'field') for (const [x, y] of samples) if (roadAt(x, y)) return { ok: false, reason: 'a road is in the way', area };
    return { ok: true, parcelId: p0.id, area };
  }

  /** a straight segment for a track / fence. Ends joined to the road network may lie off your land. */
  function checkSegment(a, b, kind) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 2) return { ok: false, reason: 'too short', length: L };
    if (L > MAX_TRACK_M) return { ok: false, reason: `too long (max ${MAX_TRACK_M} m)`, length: L };
    const perM = kind === 'path' ? COST.trackPerM : kind === 'hedge' ? COST.hedgePerM : COST.fencePerM;
    const cost = Math.round(L * perM * 100) / 100;
    const samples = edgeSamples([a, b], 1.5, false);
    const C = mod('crops'), B = mod('buildings');
    for (const [x, y] of samples) {
      if (water(x, y)) return { ok: false, reason: 'water', length: L, cost };
      if (B && B.at && B.at(x, y)) return { ok: false, reason: 'a building is in the way', length: L, cost };
      if (C && C.fieldAt && C.fieldAt(x, y)) return { ok: false, reason: 'crosses a field', length: L, cost };
      if (!canUse(x, y)) {
        const nearEnd = Math.hypot(x - a[0], y - a[1]) < NODE_SNAP_M + 1 || Math.hypot(x - b[0], y - b[1]) < NODE_SNAP_M + 1;
        if (!(kind === 'path' && (roadAt(x, y) || nearEnd && (nearNode(a[0], a[1]) || nearNode(b[0], b[1]))))) return { ok: false, reason: 'not your land', length: L, cost };
      }
    }
    if (!afford(cost)) return { ok: false, reason: 'not enough money', length: L, cost };
    return { ok: true, length: L, cost };
  }

  /** hovered demolish target */
  function demolishTarget(x, y) {
    const B = mod('buildings');
    const b = B && B.at ? B.at(x, y) : null;
    if (b) {
      if (b.owner !== 'player') return { ok: false, reason: 'not yours', kind: 'building', id: b.id, name: b.name || b.type };
      const polys = B.footprintParts ? B.footprintParts(b.type, b.rot, b.x, b.y, b.variant) : null;
      return { ok: true, kind: 'building', id: b.id, name: b.name || b.type, polys, reason: b.purchased ? 'refund at book value' : 'no refund (not bought)' };
    }
    const C = mod('crops');
    const f = C && C.fieldAt ? C.fieldAt(x, y) : null;
    if (f) {
      const p = f.parcelId && sim().parcel ? sim().parcel(f.parcelId) : parcelAt(x, y);
      if (!usable(p)) return { ok: false, reason: 'not your field', kind: 'field', id: f.id, name: f.name };
      return { ok: true, kind: 'field', id: f.id, name: f.name || 'field', polys: [f.poly], reason: `remove field (${fmtHa(f.area)})` };
    }
    const edges = (ctx.world.roads && ctx.world.roads.edges) || [];
    for (const e of edges) {
      if (e.class !== 'track' || !e.points) continue;
      for (let i = 1; i < e.points.length; i++) {
        if (distToSeg(x, y, e.points[i - 1], e.points[i]) < (e.width || 3) / 2 + 0.3) {
          if (!canUse(x, y)) return { ok: false, reason: 'not your land', kind: 'path', id: e.id, name: 'farm track' };
          return { ok: true, kind: 'path', id: e.id, name: 'farm track', line: e.points, reason: 'remove track (no refund)' };
        }
      }
    }
    return { ok: false, reason: 'nothing to demolish here' };
  }

  function landInfo(x, y) {
    const p = parcelAt(x, y);
    if (!p) return { ok: false, reason: 'no parcel here' };
    const ha = p.area / 1e4;
    if (p.state === 'forSale') {
      const total = p.price * 1.04;
      return { ok: afford(total), kind: 'buy', parcel: p, cost: total, reason: afford(total) ? `buy for ${money(total)} incl. fees` : 'not enough money (mortgage offered)' };
    }
    if (p.state === 'forRent') {
      const month = (p.rentPerHaYear || 0) * ha / 12;
      return { ok: afford(month), kind: 'rent', parcel: p, cost: month, reason: afford(month) ? `rent: ${money(month)} / month in advance` : 'not enough money' };
    }
    return { ok: false, kind: 'none', parcel: p, reason: p.state === 'owned' ? 'you own this' : p.state === 'rented' ? 'you rent this' : 'not on the market' };
  }

  // ------------------------------------------------------------------ preview evaluation
  function pos() { return [snap(cursor.x), snap(cursor.y)]; }
  function evaluate() {
    if (!W.active) return null;
    const [x, y] = pos();
    const S = sim();
    const key = [W.mode, W.tool, W.item, W.rot, x, y, W.verts.length, W.verts.length ? W.verts[W.verts.length - 1].join() : '', W.chain ? W.chain.x + ',' + W.chain.y : '',
      S ? Math.round(S.money()) : 0, (ctx.world.buildings && ctx.world.buildings.version) || 0, (ctx.world.roads && ctx.world.roads.version) || 0,
      (ctx.world.crops && ctx.world.crops.fields && ctx.world.crops.fields.length) || 0, (S && S.parcels ? S.parcels().map((p) => p.state[0]).join('') : '')].join('|');
    if (cached.key === key) return cached.res;
    cached = { key, res: computePreview(x, y) };
    return cached.res;
  }

  function computePreview(x, y) {
    if (W.mode === 'land') return { kind: 'land', x, y, ...landInfo(x, y) };
    const t = W.tool;
    if (!t) return { kind: 'none', x, y, ok: false, reason: 'pick something in the Build menu' };
    const td = toolDef(t);
    if (td && !td.enabled) return { kind: t, x, y, ok: false, reason: td.reason };
    if (t === 'building') {
      const it = findItem(W.item);
      const B = mod('buildings');
      if (!it || !B) return { kind: t, x, y, ok: false, reason: 'pick a building' };
      const c = B.canPlace(it.type, x, y, W.rot, { variant: it.variant, pay: true }) || { ok: false, reason: 'unavailable' };
      const polys = B.footprintParts ? B.footprintParts(it.type, W.rot, x, y, it.variant) : null;
      return { kind: t, x, y, rot: W.rot, ok: !!c.ok, reason: c.ok ? 'click to build' : c.reason, cost: it.cost, polys, name: it.name };
    }
    if (t === 'field' || t === 'pen') {
      const P = W.verts.map((v) => v.slice());
      const closing = P.length >= 3 && Math.hypot(P[0][0] - x, P[0][1] - y) < closeRadius();
      const draft = closing ? P : P.concat([[x, y]]);
      const c = checkPoly(draft, closing, t);
      const area = draft.length >= 3 ? polyArea(draft) : 0;
      let cost = t === 'pen' ? Math.round(polylineLength(draft.concat([draft[0]])) * COST.penPerM * 100) / 100 : COST.field;
      let ok = c.ok, reason = c.reason;
      if (ok && cost > 0 && !afford(cost)) { ok = false; reason = 'not enough money'; }
      if (ok) reason = closing ? `click to finish ${t}` : P.length >= 2 ? 'click to add a corner · Enter or click the first corner to finish' : 'click to add a corner';
      return { kind: t, x, y, ok, reason, verts: draft, closing, area, cost, parcelId: c.parcelId };
    }
    if (t === 'path' || t === 'fence') {
      const kind = t === 'path' ? 'path' : (W.item === 'hedge' ? 'hedge' : 'fence');
      const snapN = t === 'path' ? nearNode(x, y) : null;
      const end = snapN ? [snapN.x, snapN.y] : [x, y];
      if (!W.chain) {
        const ok = canUse(end[0], end[1]) || !!(t === 'path' && (snapN || roadAt(end[0], end[1])));
        return { kind: t, x: end[0], y: end[1], ok: ok && !water(end[0], end[1]), reason: ok ? 'click to start' : 'not your land', start: true, snapped: !!snapN };
      }
      const a = [W.chain.x, W.chain.y];
      const c = checkSegment(a, end, kind);
      return { kind: t, x: end[0], y: end[1], ok: c.ok, reason: c.ok ? `click to lay ${c.length.toFixed(1)} m` : c.reason, cost: c.cost, length: c.length, line: [a, end], snapped: !!snapN };
    }
    if (t === 'tree') {
      const ok = canUse(x, y) && !water(x, y) && !(mod('buildings') && mod('buildings').at(x, y)) && !roadAt(x, y);
      return { kind: t, x, y, ok: ok && afford(COST.tree), reason: !ok ? 'cannot plant here' : afford(COST.tree) ? 'click to plant' : 'not enough money', cost: COST.tree };
    }
    if (t === 'demolish') { const d = demolishTarget(x, y); return { x, y, ...d, kind: 'demolish', target: d.kind }; }
    return { kind: t, x, y, ok: false, reason: 'unknown tool' };
  }
  const closeRadius = () => Math.max(1.2, 10 / Math.max(1, ctx.camera.zoom));

  // ------------------------------------------------------------------ actions
  function pushHistory(h) { W.history.push({ ...h, ttl: UNDO_S }); if (W.history.length > 20) W.history.shift(); }
  function emitPlaced(p) { W.placed++; ctx.events.emit('buildtools:placed', p); }

  /** primary action at world point. opts.confirm=false skips dialogs (tests / demo). Returns a result object. */
  async function act(x, y, opts = {}) {
    if (!W.active) return { ok: false, reason: 'build mode is off' };
    cursor.x = x; cursor.y = y; cached.key = null;
    const pr = evaluate();
    const t = W.mode === 'land' ? 'land' : W.tool;
    const S = sim();
    if (t === 'land') {
      if (!pr.parcel || pr.kind === 'none') return { ok: false, reason: pr.reason };
      const p = pr.parcel;
      if (pr.kind === 'buy') {
        const mortgage = !pr.ok;
        if (opts.confirm !== false) {
          const u = ui();
          const yes = u && u.confirm ? await dialog({ title: `Buy ${p.name}?`, text: `${fmtHa(p.area)}, soil ${Math.round(p.soil * 100)} %. Price ${money(p.price)} + 4 % fees${mortgage ? ' — with a mortgage (25 % down + fees in cash)' : ''}.`, okLabel: mortgage ? 'Buy with mortgage' : 'Buy', icon: 'land' }) : true;
          if (!yes) return { ok: false, reason: 'cancelled' };
        }
        const ok = S.buyParcel(p.id, mortgage || opts.mortgage ? { mortgage: true } : {});
        if (!ok) { toast(`Could not buy ${p.name}`, 'warn'); return { ok: false, reason: 'purchase refused' }; }
        toast(`Bought ${p.name} (${fmtHa(p.area)})`, 'money');
        cached.key = null;
        return { ok: true, kind: 'buy', parcelId: p.id };
      }
      if (pr.kind === 'rent') {
        if (!pr.ok) return { ok: false, reason: pr.reason };
        if (opts.confirm !== false) {
          const yes = await dialog({ title: `Rent ${p.name}?`, text: `${fmtHa(p.area)}, ${money((p.rentPerHaYear || 0) * p.area / 1e4)} a year, paid monthly in advance. Minimum term one year.`, okLabel: 'Rent', icon: 'land' });
          if (!yes) return { ok: false, reason: 'cancelled' };
        }
        const ok = S.rentParcel(p.id);
        if (!ok) { toast(`Could not rent ${p.name}`, 'warn'); return { ok: false, reason: 'lease refused' }; }
        toast(`Rented ${p.name} (${fmtHa(p.area)})`, 'money');
        cached.key = null;
        return { ok: true, kind: 'rent', parcelId: p.id };
      }
      return { ok: false, reason: pr.reason };
    }
    if (!pr || !t) return { ok: false, reason: 'no tool selected' };

    if (t === 'building') {
      if (!pr.ok) return { ok: false, reason: pr.reason };
      const it = findItem(W.item), B = mod('buildings');
      const before = S.money();
      const id = B.place(it.type, pr.x, pr.y, W.rot, { variant: it.variant, pay: true });
      if (!id) { const r = (B.lastError && B.lastError()) || 'refused'; return { ok: false, reason: r }; }
      const cost = Math.round((before - S.money()) * 100) / 100;
      pushHistory({ kind: 'building', id, cost, name: it.name });
      emitPlaced({ kind: 'building', id, type: it.type, variant: it.variant, x: pr.x, y: pr.y, rot: W.rot, cost });
      toast(`Built ${it.name} — ${money(cost)}`, 'money');
      cached.key = null;
      return { ok: true, kind: 'building', id, cost };
    }
    if (t === 'field' || t === 'pen') {
      if (pr.closing) return finishPoly();
      if (!pr.ok) return { ok: false, reason: pr.reason };
      W.verts.push([pr.x, pr.y]);
      cached.key = null;
      return { ok: true, kind: 'vertex', n: W.verts.length };
    }
    if (t === 'path' || t === 'fence') {
      if (!pr.ok) return { ok: false, reason: pr.reason };
      if (pr.start) { W.chain = { x: pr.x, y: pr.y }; cached.key = null; return { ok: true, kind: 'start' }; }
      const r = t === 'path' ? layTrack([W.chain.x, W.chain.y], [pr.x, pr.y], pr.cost) : layFence([W.chain.x, W.chain.y], [pr.x, pr.y], pr.cost);
      if (r.ok) W.chain = { x: pr.x, y: pr.y };
      cached.key = null;
      return r;
    }
    if (t === 'tree') {
      if (!pr.ok) return { ok: false, reason: pr.reason };
      const P = mod('props');
      const id = P && P.place ? P.place(W.item || 'oak', pr.x, pr.y, { owner: 'player' }) : null;
      if (!id) return { ok: false, reason: 'props refused' };
      S.charge(COST.tree, 'buildings', `Planted ${W.item || 'tree'}`);
      pushHistory({ kind: 'tree', id, cost: COST.tree, name: 'tree' });
      emitPlaced({ kind: 'tree', id, x: pr.x, y: pr.y, cost: COST.tree });
      return { ok: true, kind: 'tree', id, cost: COST.tree };
    }
    if (t === 'demolish') {
      if (!pr.ok) return { ok: false, reason: pr.reason };
      if (opts.confirm !== false) {
        const yes = await dialog({ title: `Demolish ${pr.name}?`, text: pr.reason, okLabel: 'Demolish', danger: true, icon: 'warn' });
        if (!yes) return { ok: false, reason: 'cancelled' };
      }
      return demolish(pr.kind === 'demolish' ? pr.target : pr.kind, pr.id, pr.name);
    }
    return { ok: false, reason: 'unknown tool' };
  }

  async function dialog(o) {
    const u = ui();
    if (!u || !u.confirm) return true;
    busy = true;
    try { return !!(await u.confirm({ cancelLabel: 'Cancel', ...o })); } finally { busy = false; }
  }

  function layTrack(a, b, cost) {
    const R = mod('roads'), S = sim();
    if (!R || !R.addNode || !R.addEdge) return { ok: false, reason: 'roads module not available' };
    if (!S.canAfford(cost)) return { ok: false, reason: 'not enough money' };
    const na = nearNode(a[0], a[1]), nb = nearNode(b[0], b[1]);
    const newNodes = [];
    const ia = na ? na.id : (newNodes.push(R.addNode(a[0], a[1])), newNodes[newNodes.length - 1]);
    const ib = nb ? nb.id : (newNodes.push(R.addNode(b[0], b[1])), newNodes[newNodes.length - 1]);
    if (!ia || !ib) return { ok: false, reason: 'roads refused the node' };
    const id = R.addEdge(ia, ib, { class: 'track' });
    if (!id) return { ok: false, reason: 'roads refused the track' };
    if (!S.charge(cost, 'buildings', `Farm track ${Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(0)} m`)) { R.removeEdge(id); return { ok: false, reason: 'not enough money' }; }
    pushHistory({ kind: 'path', id, cost, name: 'farm track' });
    emitPlaced({ kind: 'path', id, a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]), cost });
    return { ok: true, kind: 'path', id, cost };
  }
  function layFence(a, b, cost) {
    const P = mod('props'), S = sim();
    if (!P || !P.fence) return { ok: false, reason: 'props module not available' };
    const kind = W.item === 'hedge' ? 'hedge' : 'fence';
    const id = P.fence([a, b], { kind, owner: 'player' });
    if (!id) return { ok: false, reason: 'props refused' };
    S.charge(cost, 'buildings', `${kind} ${Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(0)} m`);
    pushHistory({ kind: 'fence', id, cost, name: kind });
    emitPlaced({ kind: 'fence', id, a, b, cost });
    return { ok: true, kind: 'fence', id, cost };
  }

  function finishPoly() {
    const t = W.tool;
    if (t !== 'field' && t !== 'pen') return { ok: false, reason: 'not drawing' };
    const P = W.verts.map((v) => v.slice());
    const c = checkPoly(P, true, t);
    if (!c.ok) return { ok: false, reason: c.reason };
    const S = sim();
    if (t === 'field') {
      const C = mod('crops');
      const n = ((C.fields && C.fields()) || []).length + 1;
      const id = C.createField(P, { parcelId: c.parcelId, name: `Field ${n}` });
      if (!id) return { ok: false, reason: 'crops refused the field' };
      W.verts = [];
      pushHistory({ kind: 'field', id, cost: 0, name: `Field ${n}` });
      emitPlaced({ kind: 'field', id, parcelId: c.parcelId, poly: P, area: c.area, cost: 0 });
      toast(`New field: ${fmtHa(c.area)}`, 'success');
      cached.key = null;
      return { ok: true, kind: 'field', id, area: c.area, parcelId: c.parcelId };
    }
    const A = mod('animals');
    const cost = Math.round(polylineLength(P.concat([P[0]])) * COST.penPerM * 100) / 100;
    if (!S.canAfford(cost)) return { ok: false, reason: 'not enough money' };
    const id = A && A.createPen ? A.createPen(P, { owner: 'player' }) : null;
    if (!id) return { ok: false, reason: 'animals refused the pen' };
    S.charge(cost, 'buildings', 'Animal pen');
    W.verts = [];
    pushHistory({ kind: 'pen', id, cost, name: 'pen' });
    emitPlaced({ kind: 'pen', id, poly: P, cost });
    return { ok: true, kind: 'pen', id, cost };
  }

  function removeThing(kind, id) {
    if (kind === 'building') { const B = mod('buildings'); const r = B && B.remove ? B.remove(id) : null; return r && r.ok ? { ok: true, refund: r.refund || 0 } : { ok: false, reason: (r && r.reason) || 'refused' }; }
    if (kind === 'field') { const C = mod('crops'); if (!C || !C.field || !C.field(id)) return { ok: false, reason: 'no such field' }; C.removeField(id); return { ok: true, refund: 0 }; }
    if (kind === 'path') { const R = mod('roads'); return R && R.removeEdge && R.removeEdge(id) ? { ok: true, refund: 0 } : { ok: false, reason: 'no such track' }; }
    if (kind === 'fence' || kind === 'tree') { const P = mod('props'); const f = P && (P.remove || P.removeFence); return f && f(id) !== false ? { ok: true, refund: 0 } : { ok: false, reason: 'props cannot remove it' }; }
    if (kind === 'pen') { const A = mod('animals'); return A && A.removePen && A.removePen(id) !== false ? { ok: true, refund: 0 } : { ok: false, reason: 'animals cannot remove it' }; }
    return { ok: false, reason: 'unknown kind' };
  }

  function demolish(kind, id, name) {
    const r = removeThing(kind, id);
    if (!r.ok) { toast(`Cannot demolish: ${r.reason}`, 'warn'); return { ok: false, reason: r.reason }; }
    W.history = W.history.filter((h) => h.id !== id);
    W.demolished++;
    ctx.events.emit('buildtools:demolished', { kind, id, refund: r.refund, undo: false });
    toast(`Demolished ${name || kind}${r.refund > 0 ? ` — ${money(r.refund)} back` : ''}`, r.refund > 0 ? 'money' : 'info');
    cached.key = null;
    return { ok: true, kind, id, refund: r.refund };
  }

  /** undo the last placement if it is younger than 10 s: removed with a full refund */
  function undo() {
    const h = W.history.length ? W.history[W.history.length - 1] : null;
    if (!h || h.ttl <= 0) { toast('Nothing to undo (only within 10 s)', 'info'); return { ok: false, reason: 'nothing to undo' }; }
    const r = removeThing(h.kind, h.id);
    if (!r.ok) return { ok: false, reason: r.reason };
    W.history.pop();
    const top = Math.round((h.cost - (r.refund || 0)) * 100) / 100;
    if (top > 0) sim().credit(top, 'buildings', `Undo — ${h.name}`);
    ctx.events.emit('buildtools:demolished', { kind: h.kind, id: h.id, refund: h.cost, undo: true });
    toast(`Undone: ${h.name}${h.cost > 0 ? ` — ${money(h.cost)} refunded` : ''}`, 'money');
    cached.key = null;
    return { ok: true, kind: h.kind, id: h.id, refund: h.cost };
  }

  // ------------------------------------------------------------------ mode control
  function enter(mode = 'build') {
    if (driving()) { toast('Leave the vehicle to build', 'warn'); return false; }
    W.active = true;
    W.mode = mode === 'land' ? 'land' : 'build';
    W.verts = []; W.chain = null; cached.key = null;
    if (!cursor.pinned) { cursor.x = ctx.input.mouse.x || ctx.camera.x; cursor.y = ctx.input.mouse.y || ctx.camera.y; }
    const u = ui();
    if (u && u.openPanel && (!u.isPanelOpen || u.isPanelOpen() !== 'buildtools')) u.openPanel('buildtools');
    ctx.events.emit('buildtools:mode', { active: true, mode: W.mode });
    return true;
  }
  function exit() {
    if (!W.active) return false;
    W.active = false; W.verts = []; W.chain = null; cursor.pinned = false;
    const u = ui();
    if (u && u.isPanelOpen && u.isPanelOpen() === 'buildtools') u.closePanel('buildtools');
    ctx.events.emit('buildtools:mode', { active: false, mode: W.mode });
    return true;
  }
  function select(tool, itemId) {
    if (tool === 'land') { if (!W.active) enter('land'); W.mode = 'land'; W.tool = null; cached.key = null; return true; }
    const td = toolDef(tool);
    if (!td) return false;
    if (!W.active) enter('build');
    W.mode = 'build';
    W.tool = tool; W.verts = []; W.chain = null;
    if (tool === 'building') W.item = (findItem(itemId) || findItem(W.item) || items()[0] || {}).id || null;
    else if (td.items) W.item = itemId && td.items.some((i) => i.id === itemId) ? itemId : td.items[0].id;
    else W.item = itemId || null;
    cached.key = null;
    return td.enabled;
  }
  /** step back: drop last vertex / end chain / drop tool / exit */
  function cancel() {
    if (W.verts.length) { W.verts = []; cached.key = null; return 'polygon'; }
    if (W.chain) { W.chain = null; cached.key = null; return 'chain'; }
    if (W.tool || W.mode === 'land') { W.tool = null; if (W.mode === 'land') W.mode = 'build'; cached.key = null; return 'tool'; }
    exit();
    return 'exit';
  }
  function rotate(step) {
    W.rot = ((W.rot + (step == null ? Math.PI / 2 : step)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    W.rot = Math.round(W.rot * 1e6) / 1e6;
    cached.key = null;
    return W.rot;
  }

  // ------------------------------------------------------------------ input
  const held = new Set();
  ctx.input.on('key', (ev) => {
    if (!ev.down) { held.delete(ev.code); return; }
    if (held.has(ev.code)) return;
    held.add(ev.code);
    if (busy) return;
    const ctrl = held.has('ControlLeft') || held.has('ControlRight');
    if (ev.code === 'KeyB' && !ctrl) {
      if (W.active) exit(); else if (driving()) toast('Leave the vehicle to build', 'warn'); else enter('build');
      ev.stop = true; return;
    }
    if (!W.active) return;
    if (ev.code === 'Escape') { cancel(); ev.stop = true; }
    else if (ev.code === 'KeyR' && !ctrl) { rotate(held.has('ShiftLeft') || held.has('ShiftRight') ? Math.PI / 12 : Math.PI / 2); ev.stop = true; }
    else if (ev.code === 'Enter' || ev.code === 'NumpadEnter') { if (W.verts.length >= 3) { const r = finishPoly(); if (!r.ok) toast(`Field: ${r.reason}`, 'warn'); } else if (W.chain) W.chain = null; ev.stop = true; }
    else if (ev.code === 'Backspace') { if (W.verts.length) { W.verts.pop(); cached.key = null; } ev.stop = true; }
    else if (ev.code === 'KeyZ') { undo(); ev.stop = true; }
  });
  ctx.input.on('mousemove', () => { cursor.pinned = false; });
  ctx.input.on('click', (ev) => {
    if (!W.active || busy || ctx.input.uiCapturing) return;
    ev.stop = true;
    if (ev.button === 2) { cancel(); return; }
    if (ev.button !== 0) return;
    act(ev.x, ev.y).then((r) => {
      if (r && !r.ok && r.reason && r.reason !== 'cancelled' && W.tool !== 'demolish') toast(`Can't: ${r.reason}`, 'warn');
    });
  });

  // ------------------------------------------------------------------ ui: panel + status card
  const U = ui();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (U && U.addPanel) {
    U.addPanel('buildtools', {
      title: 'Build', icon: 'build', order: 5, subtitle: 'B toggles · R rotate · Z undo (10 s) · Esc back',
      sig: () => [W.active, W.mode, W.tool, W.item, Math.round((sim() && sim().money()) / 500)].join('|'),
      onOpen: () => { if (!W.active) enter('build'); },
      render(el) {
        const S = sim();
        const m = S ? S.money() : 0;
        const btn = (attrs, label, on, dis, title) => `<button class="hv-btn ${on ? 'pri' : ''} ${dis ? 'dis' : ''}" ${attrs} title="${esc(title || '')}" style="margin:1px;padding:2px 7px;font-size:12px">${esc(label)}</button>`;
        let h = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${btn('data-land="1"', 'Land (buy / rent)', W.mode === 'land', false)}${btn('data-exit="1"', W.active ? 'Exit build mode' : 'Enter build mode', false, false)}</div>`;
        for (const t of tools()) {
          h += `<div style="margin:4px 0 1px;font-weight:bold;font-size:12px">${esc(t.label)}${t.enabled ? '' : ` <span style="font-weight:normal;opacity:.7">— ${esc(t.reason)}</span>`}</div><div style="display:flex;flex-wrap:wrap">`;
          if (t.id === 'building') {
            for (const it of t.items) h += btn(`data-tool="building" data-item="${esc(it.id)}"`, `${it.name} ${kmoney(it.cost)}`, W.tool === 'building' && W.item === it.id, !t.enabled || it.cost > m, it.cost > m ? 'not enough money' : `${it.w}×${it.h} m`);
          } else if (t.items) {
            for (const it of t.items) h += btn(`data-tool="${t.id}" data-item="${esc(it.id)}"`, `${it.name}${it.costPerM ? ` · €${it.costPerM}/m` : it.cost ? ` · €${it.cost}` : ''}`, W.tool === t.id && W.item === it.id, !t.enabled, t.reason);
          } else {
            const extra = t.id === 'path' ? ` · €${COST.trackPerM}/m` : t.id === 'pen' ? ` · €${COST.penPerM}/m` : '';
            h += btn(`data-tool="${t.id}"`, t.label + extra, W.tool === t.id, !t.enabled, t.reason);
          }
          h += '</div>';
        }
        el.innerHTML = h;
        el.onclick = (e) => {
          const b = e.target && e.target.closest && e.target.closest('button');
          if (!b || b.classList.contains('dis')) return;
          if (b.dataset.exit) { if (W.active) exit(); else enter('build'); }
          else if (b.dataset.land) select('land');
          else if (b.dataset.tool) select(b.dataset.tool, b.dataset.item);
          if (U.refreshPanel) U.refreshPanel('buildtools');
        };
      },
    });
  }
  let hudText = '';
  if (U && U.registerHud) {
    U.registerHud('buildtools:status', {
      slot: 'top-center', order: 30, card: false,
      render(el) { el.innerHTML = ''; },
      update(el) {
        let t = '';
        if (W.active) {
          const pr = evaluate() || {};
          const head = W.mode === 'land' ? 'Land mode' : W.tool ? `Build: ${W.tool === 'building' ? (findItem(W.item) || {}).name || '' : (toolDef(W.tool) || {}).label || W.tool}` : 'Build mode';
          const cost = pr.cost > 0 ? ` · ${money(pr.cost)}` : '';
          const area = pr.area > 0 ? ` · ${fmtHa(pr.area)}` : '';
          const undoable = W.history.length && W.history[W.history.length - 1].ttl > 0 ? ` · Z undo (${Math.ceil(W.history[W.history.length - 1].ttl)} s)` : '';
          t = `<div style="background:rgba(246,236,214,.94);border:1px solid #8a6a3c;border-radius:6px;padding:5px 12px;font:13px system-ui,Segoe UI,sans-serif;color:#3a2a18;box-shadow:0 2px 6px rgba(0,0,0,.25)"><b style="font-family:Georgia,serif">${esc(head)}</b>${esc(cost + area)} · <span style="color:${pr.ok ? '#2f6b2a' : '#a3322a'}">${esc(pr.reason || '')}</span><span style="opacity:.7">${esc(undoable)} · R rotate · Esc back · B exit</span></div>`;
        }
        if (t !== hudText) { hudText = t; el.innerHTML = t; }
      },
    });
  }

  // ------------------------------------------------------------------ rendering
  const STATE_COL = { owned: [70, 150, 60], rented: [60, 120, 190], forSale: [215, 160, 40], forRent: [60, 185, 190], npc: [140, 130, 120] };
  const STATE_TXT = { owned: 'owned', rented: 'rented', forSale: 'for sale', forRent: 'to let', npc: 'neighbour' };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const pathPoly = (g, P, close = true) => { g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (close) g.closePath(); };

  ctx.renderer.addLayer('world-ui', (g, view) => {
    if (!W.active) return;
    const px = 1 / view.zoom;
    const S = sim();
    const parcels = (S && S.parcels && S.parcels()) || [];
    const land = W.mode === 'land';
    const pr = evaluate();
    hover = land && pr && pr.parcel ? pr.parcel.id : null;
    for (const p of parcels) {
      const b = p.bbox;
      if (b && (b[2] < view.x0 || b[0] > view.x1 || b[3] < view.y0 || b[1] > view.y1)) continue;
      if (!land && !usable(p)) continue;
      const c = STATE_COL[p.state] || STATE_COL.npc;
      pathPoly(g, p.poly);
      if (land) { g.fillStyle = rgba(c, p.id === hover ? 0.32 : 0.16); g.fill(); }
      g.setLineDash(land ? [] : [6 * px, 4 * px]);
      g.lineWidth = (p.id === hover ? 4 : 2) * px;
      g.strokeStyle = rgba(c, land ? 0.95 : 0.7);
      g.stroke();
    }
    g.setLineDash([]);
    if (!pr || land) return;
    const ok = pr.ok;
    const demo = pr.kind === 'demolish';
    const fill = ok ? (demo ? 'rgba(235,140,40,0.42)' : 'rgba(90,190,80,0.38)') : 'rgba(220,70,50,0.38)';
    const line = ok ? 'rgba(40,120,30,0.95)' : 'rgba(160,30,20,0.95)';
    g.lineWidth = 2 * px;
    if (pr.polys) for (const P of pr.polys) { pathPoly(g, P); g.fillStyle = fill; g.fill(); g.strokeStyle = line; g.stroke(); }
    if (pr.kind === 'field' || pr.kind === 'pen') {
      const P = pr.verts || [];
      if (P.length >= 3) { pathPoly(g, P); g.fillStyle = fill; g.fill(); }
      if (P.length >= 2) { pathPoly(g, P, pr.closing); g.strokeStyle = line; g.stroke(); }
      for (let i = 0; i < W.verts.length; i++) {
        g.beginPath(); g.arc(W.verts[i][0], W.verts[i][1], (i === 0 ? 5 : 3.5) * px, 0, Math.PI * 2);
        g.fillStyle = i === 0 ? '#fff4c8' : '#f6ecd6'; g.fill(); g.strokeStyle = line; g.stroke();
      }
    }
    if (pr.line && pr.line.length === 2 && !demo) {
      const [a, b] = pr.line;
      g.lineCap = 'round';
      g.lineWidth = pr.kind === 'path' ? 3 : 0.4;
      g.strokeStyle = ok ? 'rgba(160,120,70,0.7)' : 'rgba(220,70,50,0.6)';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.lineWidth = 2 * px; g.strokeStyle = line; g.stroke();
    }
    if (demo && pr.ok && pr.line) { pathPoly(g, pr.line, false); g.lineWidth = 3.4; g.strokeStyle = fill; g.stroke(); }
    if (!demo || pr.ok) {
      // cursor cross
      g.strokeStyle = line; g.lineWidth = 1.5 * px;
      g.beginPath(); g.moveTo(pr.x - 6 * px, pr.y); g.lineTo(pr.x + 6 * px, pr.y); g.moveTo(pr.x, pr.y - 6 * px); g.lineTo(pr.x, pr.y + 6 * px); g.stroke();
    }
    if (pr.start || pr.snapped) { g.beginPath(); g.arc(pr.x, pr.y, 5 * px, 0, Math.PI * 2); g.strokeStyle = line; g.stroke(); }
  }, 10);

  // labels in screen space (text stays crisp)
  ctx.renderer.addLayer('screen', (g, view) => {
    if (!W.active) return;
    const pr = evaluate();
    g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    const tag = (sx, sy, lines, col) => {
      let w = 0;
      for (const l of lines) w = Math.max(w, g.measureText(l).width);
      const h = lines.length * 15 + 6;
      g.fillStyle = 'rgba(246,236,214,0.92)';
      g.strokeStyle = col || 'rgba(110,80,40,0.9)';
      g.lineWidth = 1;
      g.beginPath(); g.rect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.ceil(w + 12), h); g.fill(); g.stroke();
      g.fillStyle = '#3a2a18';
      lines.forEach((l, i) => g.fillText(l, sx + 6, sy + 11 + i * 15));
    };
    if (W.mode === 'land') {
      const S = sim();
      for (const p of (S && S.parcels && S.parcels()) || []) {
        const c = p.center || centroid(p.poly);
        if (c[0] < view.x0 || c[0] > view.x1 || c[1] < view.y0 || c[1] > view.y1) continue;
        const s = ctx.camera.worldToScreen(c[0], c[1]);
        const ha = p.area / 1e4;
        const price = p.state === 'forSale' ? money(p.price) : p.state === 'forRent' ? `${money((p.rentPerHaYear || 0) * ha / 12)}/mo` : p.state === 'npc' ? '' : '';
        const lines = [p.name, `${STATE_TXT[p.state] || p.state} · ${ha.toFixed(2)} ha${price ? ' · ' + price : ''}`];
        tag(s.sx - 60, s.sy - 18, lines, rgba(STATE_COL[p.state] || STATE_COL.npc, 1));
      }
    }
    if (!pr) return;
    const s = ctx.camera.worldToScreen(pr.x, pr.y);
    const lines = [];
    if (pr.name) lines.push(pr.name + (pr.cost > 0 ? ` · ${money(pr.cost)}` : ''));
    else if (pr.cost > 0) lines.push(money(pr.cost) + (pr.length ? ` · ${pr.length.toFixed(1)} m` : ''));
    if (pr.area > 0) lines.push(`${fmtHa(pr.area)}`);
    lines.push(pr.reason || '');
    tag(s.sx + 16, s.sy + 12, lines, pr.ok ? 'rgba(40,120,30,0.95)' : 'rgba(160,30,20,0.95)');
    if ((pr.kind === 'field' || pr.kind === 'pen') && pr.verts && pr.verts.length >= 3) {
      const c = centroid(pr.verts), q = ctx.camera.worldToScreen(c[0], c[1]);
      g.font = 'bold 14px Georgia, serif';
      g.fillStyle = 'rgba(40,30,18,0.9)'; g.textAlign = 'center';
      g.fillText(fmtHa(pr.area), q.sx, q.sy);
      g.textAlign = 'start';
    }
  }, 5);

  // ------------------------------------------------------------------ public API
  const api = {
    /** enter build mode ('build') or land mode ('land'); false while driving */
    enter: (mode) => enter(mode),
    exit: () => exit(),
    isActive: () => !!W.active,
    /** tool: building|field|path|fence|tree|pen|demolish|land; itemId e.g. 'machine_shed:0' (type:variant), 'hedge' */
    select: (tool, itemId) => select(tool, itemId),
    /** move the ghost to (x,y) m (pinned until the mouse moves) → preview {ok, reason, cost, area?, length?, …} */
    preview(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      cursor.x = x; cursor.y = y; cursor.pinned = true;
      const r = evaluate();
      return r ? JSON.parse(JSON.stringify({ ...r, parcel: r.parcel ? { id: r.parcel.id, state: r.parcel.state, name: r.parcel.name } : undefined })) : null;
    },
    /** primary click at (x,y) m without dialogs → Promise<{ok, reason?, kind, id?, cost?, refund?}>; opts {confirm, mortgage} */
    placeAt: (x, y, opts) => (Number.isFinite(x) && Number.isFinite(y) ? act(x, y, { confirm: false, ...(opts || {}) }) : Promise.resolve({ ok: false, reason: 'bad position' })),
    /** undo the last placement within 10 s (full refund) */
    undo: () => undo(),
    cancel: () => cancel(),
    rotate: (step) => rotate(step),
    tools: () => tools(),
    status: () => ({ active: !!W.active, mode: W.mode, tool: W.tool, item: W.item, rot: W.rot, verts: W.verts.map((v) => v.slice()), chain: W.chain ? { ...W.chain } : null,
      undo: W.history.map((h) => ({ kind: h.kind, id: h.id, cost: h.cost, ttl: +h.ttl.toFixed(3) })), placed: W.placed, demolished: W.demolished }),
  };

  return {
    api,
    update(dt) {
      for (const h of W.history) h.ttl -= dt;
      if (W.history.length && W.history[0].ttl <= 0) W.history = W.history.filter((h) => h.ttl > 0);
      if (W.active && driving()) { exit(); toast('Build mode closed — you are driving', 'info'); }
    },
    frame() {
      if (!W.active || cursor.pinned) return;
      const m = ctx.input.mouse;
      if (Number.isFinite(m.x) && Number.isFinite(m.y)) { cursor.x = m.x; cursor.y = m.y; }
    },
    save: () => ({ rot: W.rot, placed: W.placed, demolished: W.demolished }),
    load(d) { if (d && typeof d === 'object') { if (Number.isFinite(d.rot)) W.rot = d.rot; W.placed = d.placed | 0; W.demolished = d.demolished | 0; } },
  };
}

export const showcase = { deps: SC.deps, presets: SC.presets, stage: SC.stage };
