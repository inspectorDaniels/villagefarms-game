// roads — road graph, painted road rendering (chunk cached), bridges, street lights, pathfinding.
import { CLASSES, buildDerived, nearestOnNetwork, outerHalf } from './network.js';
import { buildDecals, makePainter, wingWalls } from './paint.js';
import { makeTextures } from './textures.js';
import { ChunkCache } from './chunks.js';
import { defaultPlan } from './generate.js';
import { makeBackdrop } from './backdrop.js';
import { sampleAt, frames, offsetPts, pointInPoly, bboxHit, dist, cumLengths, pathFrom } from './geom.js';

export const manifest = {
  id: 'roads',
  wave: 1,
  deps: [],
  optionalDeps: ['terrain', 'environment'],
  namespaces: ['roads'],
  api: ['addNode', 'addEdge', 'removeEdge', 'generateNetwork', 'nearest', 'roadAt', 'pathfind', 'laneCurve',
    'edges', 'nodes', 'edgesInRect', 'junctions', 'drawMinimap', 'classes', 'lights'],
  emits: ['roads:changed'],
  listens: [],
};

const LAMP_COLOR = [255, 190, 116];

export async function init(ctx) {
  const { world, art, palette } = ctx;
  const roads = world.roads;
  Object.assign(roads, { nodes: [], edges: [], lights: [], version: 0 });
  let counter = 0;
  let D = null;
  let dirty = false;
  const noise = ctx.noise('geometry');
  const tex = makeTextures(art, palette);
  const envState = () => {
    const env = world.environment || {};
    const w = env.weather || {};
    const season = ctx.clock.season;
    const snow = Math.max(typeof w.snowCover === 'number' ? w.snowCover : 0, season === 'winter' ? 0.4 : 0);
    return { season, snow: Math.round(snow * 4) / 4, wet: typeof w.wetness === 'number' ? w.wetness : 0 };
  };
  let lastEnvKey = '';
  const painter = makePainter({ art, palette, tex, getD: () => D, getEnv: envState });
  const cache = new ChunkCache(painter.paint, { bounds: painter.bounds, steps: painter.steps, maxBytes: 96 * 1048576 });
  // debug / A-B switch: ?roadsfx=0 (or world.roads.debug.render = false at runtime) removes all road
  // rendering (chunk layer, wet layer, lamps/bridges collector, glow) while keeping the API alive.
  const debug = { render: ctx.params && (ctx.params.roadsfx === '0' || ctx.params.roadsfx === 0) ? false : true, stats: () => cache.stats() };
  Object.defineProperty(roads, 'debug', { value: debug, enumerable: false, configurable: true, writable: true });
  const warned = new Set();
  const warnOnce = (key, msg) => { if (warned.has(key)) return; warned.add(key); ctx.warn('roads: ' + msg); };
  const fin = Number.isFinite;

  // ------------------------------------------------------------ graph editing
  const nodeIndex = () => new Map(roads.nodes.map((n) => [n.id, n]));
  function addNode(x, y) {
    const id = 'roads:' + (++counter);
    roads.nodes.push({ id, x: +x, y: +y });
    dirty = true;
    return id;
  }
  function addEdge(a, b, opts = {}) {
    const idx = nodeIndex();
    if (!idx.has(a) || !idx.has(b)) throw new Error(`addEdge: unknown node ${idx.has(a) ? b : a}`);
    if (a === b) throw new Error('addEdge: a === b');
    const cls = CLASSES[opts.class] ? opts.class : 'lane';
    const spec = CLASSES[cls];
    const id = 'roads:' + (++counter);
    roads.edges.push({
      id, a, b, class: cls, width: spec.width, lanes: spec.lanes, speed: spec.speed,
      bridge: !!opts.bridge, via: (opts.via || []).map((p) => [+p[0], +p[1]]), points: [], length: 0,
    });
    dirty = true;
    return id;
  }
  function removeEdge(id) {
    const i = roads.edges.findIndex((e) => e.id === id);
    if (i < 0) return false;
    roads.edges.splice(i, 1);
    dirty = true;
    return true;
  }
  function clear() { roads.nodes.length = 0; roads.edges.length = 0; dirty = true; }
  function buildPlan(plan) {
    const ids = plan.nodes.map(([x, y]) => addNode(x, y));
    for (const e of plan.edges) {
      const [i, j, cls, via, opts] = e;
      addEdge(ids[i], ids[j], Object.assign({ class: cls, via: via || [] }, opts || {}));
    }
    return ids;
  }
  /** split an edge at arc lengths (sorted) → returns new node ids; keeps shape via sparse vias */
  function splitEdge(e, cuts) {
    const pts = e.points, cum = cumLengths(pts);
    const L = cum[cum.length - 1];
    const idx = nodeIndex();
    const nodes = [e.a];
    for (const s of cuts) { const p = sampleAt(pts, cum, s); nodes.push(addNode(p.x, p.y)); }
    nodes.push(e.b);
    const bounds = [0, ...cuts, L];
    const out = [];
    removeEdge(e.id);
    for (let k = 0; k < nodes.length - 1; k++) {
      const via = [];
      for (let s = bounds[k] + 12; s < bounds[k + 1] - 6; s += 14) { const p = sampleAt(pts, cum, s); via.push([p.x, p.y]); }
      out.push(addEdge(nodes[k], nodes[k + 1], { class: e.class, via, bridge: e.bridge }));
    }
    void idx;
    return out;
  }
  function ensure() {
    if (!dirty && D) return D;
    dirty = false;
    D = buildDerived(roads, noise);
    buildDecals(D, ctx.rng('decals'), noise);
    D.paths = new Map();
    roads.version++;
    cache.clear();
    ctx.events.emit('roads:changed', { version: roads.version, nodes: roads.nodes.length, edges: roads.edges.length });
    return D;
  }
  /** mark bridges where roads cross water (terrain optional) */
  function placeBridges() {
    ensure();
    const T = ctx.modules.get('terrain');
    if (!T || typeof T.isWater !== 'function') return 0;
    let made = 0;
    for (const e of roads.edges.slice()) {
      if (e.bridge || e.class === 'track' || !e.points || e.points.length < 2) continue;
      const cum = cumLengths(e.points), L = cum[cum.length - 1];
      const runs = [];
      let start = -1;
      for (let s = 0; s <= L; s += 1.5) {
        const p = sampleAt(e.points, cum, s);
        const w = T.isWater(p.x, p.y) === true;
        if (w && start < 0) start = s;
        if ((!w || s + 1.5 > L) && start >= 0) { runs.push([start, s]); start = -1; }
      }
      if (!runs.length) continue;
      const cuts = [];
      const kinds = [];
      for (const [a, b] of runs) {
        const c0 = Math.max(3, a - 7), c1 = Math.min(L - 3, b + 7);
        if (c1 - c0 < 4) continue;
        if (cuts.length && c0 <= cuts[cuts.length - 1] + 4) { cuts[cuts.length - 1] = c1; continue; }
        cuts.push(c0, c1); kinds.push(true);
      }
      if (!cuts.length) continue;
      const parts = splitEdge(e, cuts);
      parts.forEach((id, k) => { if (k % 2 === 1) { const ne = roads.edges.find((x) => x.id === id); if (ne) ne.bridge = true; made++; } });
    }
    dirty = true;
    ensure();
    return made;
  }
  function generateNetwork(plan) {
    clear();
    counter = 0;
    if (plan && Array.isArray(plan.nodes)) {
      buildPlan(plan);
      ensure();
    } else {
      const T = ctx.modules.get('terrain');
      const p = defaultPlan(world.bounds.w, world.bounds.h, T, ctx.rng('generate'), ctx.noise('generate'));
      buildPlan(p);
      ensure();
      placeBridges();
    }
    return { nodes: roads.nodes.length, edges: roads.edges.length, version: roads.version };
  }

  // ------------------------------------------------------------ queries
  const P = (p) => (Array.isArray(p) ? { x: +p[0], y: +p[1] } : { x: +p.x, y: +p.y });
  function nearest(x, y) {
    ensure();
    const r = nearestOnNetwork(D, x, y);
    if (!r) return null;
    return { edgeId: r.edgeId, x: r.x, y: r.y, t: r.t, dist: r.dist };
  }
  function roadAt(x, y) {
    ensure();
    const r = nearestOnNetwork(D, x, y, null, 24);
    if (r) {
      const e = D.edgeById.get(r.edgeId);
      if (r.dist <= e.width / 2 + 0.05) return e.class;
    }
    for (const J of D.junctions) {
      if (x < J.bbox.x0 || x > J.bbox.x1 || y < J.bbox.y0 || y > J.bbox.y1) continue;
      if (pointInPoly(x, y, J.poly)) return J.cls;
    }
    return null;
  }
  function edgePart(e, s0, s1) {
    const cum = cumLengths(e.points);
    const out = [];
    const fwd = s1 >= s0;
    const a = Math.min(s0, s1), b = Math.max(s0, s1);
    const pa = sampleAt(e.points, cum, a);
    out.push({ x: pa.x, y: pa.y });
    for (let i = 0; i < e.points.length; i++) if (cum[i] > a + 0.05 && cum[i] < b - 0.05) out.push({ x: e.points[i][0], y: e.points[i][1] });
    const pb = sampleAt(e.points, cum, b);
    out.push({ x: pb.x, y: pb.y });
    return fwd ? out : out.reverse();
  }
  function pathfind(from, to, opts = {}) {
    ensure();
    const A = P(from), B = P(to);
    const allowed = opts.classes ? new Set(opts.classes) : null;
    const ok = (e) => !allowed || allowed.has(e.class);
    const sa = nearestOnNetwork(D, A.x, A.y, ok), sb = nearestOnNetwork(D, B.x, B.y, ok);
    if (!sa || !sb) return null;
    const ea = D.edgeById.get(sa.edgeId), eb = D.edgeById.get(sb.edgeId);
    const cost = (e, len) => len / (e.speed || 10);
    let result = null;
    if (ea === eb) {
      result = edgePart(ea, sa.s, sb.s);
    } else {
      // A* from virtual start over nodes
      const vmax = 22.2;
      const g = new Map(), came = new Map(), open = new Set();
      const h = (id) => { const n = D.nodeById.get(id); return Math.hypot(n.x - sb.x, n.y - sb.y) / vmax; };
      const push = (id, cst, from) => { if (!g.has(id) || cst < g.get(id)) { g.set(id, cst); came.set(id, from); open.add(id); } };
      push(ea.a, cost(ea, sa.s), { start: true, s: sa.s, toS: 0 });
      push(ea.b, cost(ea, ea.length - sa.s), { start: true, s: sa.s, toS: ea.length });
      const goal = new Map([[eb.a, sb.s], [eb.b, eb.length - sb.s]]);
      let bestEnd = null, bestCost = Infinity;
      let guard = 0;
      while (open.size && guard++ < 20000) {
        let cur = null, cf = Infinity;
        for (const id of open) { const f = g.get(id) + h(id); if (f < cf) { cf = f; cur = id; } }
        if (cf >= bestCost) break;
        open.delete(cur);
        if (goal.has(cur)) {
          const tot = g.get(cur) + cost(eb, goal.get(cur));
          if (tot < bestCost) { bestCost = tot; bestEnd = cur; }
        }
        for (const { e, end } of D.adj.get(cur) || []) {
          if (!ok(e)) continue;
          const nb = end === 'a' ? e.b : e.a;
          push(nb, g.get(cur) + cost(e, e.length), { edge: e, fromNode: cur });
        }
      }
      if (!bestEnd) return null;
      const chain = [];
      let n = bestEnd;
      for (let k = 0; k < 10000; k++) {
        const c = came.get(n);
        if (!c || c.start) { chain.unshift({ start: c }); break; }
        chain.unshift({ edge: c.edge, from: c.fromNode, to: n });
        n = c.fromNode;
      }
      const pts = [];
      const add = (arr) => { for (const p of arr) { const l = pts[pts.length - 1]; if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 0.05) pts.push(p); } };
      const st = chain[0].start;
      add(edgePart(ea, sa.s, st.toS));
      for (const c of chain.slice(1)) {
        const fwd = c.edge.a === c.from;
        add(edgePart(c.edge, fwd ? 0 : c.edge.length, fwd ? c.edge.length : 0));
      }
      add(edgePart(eb, bestEnd === eb.a ? 0 : eb.length, sb.s));
      result = pts;
    }
    if (opts.lane) {
      // shift to the right-hand lane
      const arr = result.map((p) => [p.x, p.y]);
      const fr = frames(arr);
      return offsetPts(arr, fr.tx, fr.ty, 1.6).map(([x, y]) => ({ x, y }));
    }
    return result;
  }
  function laneCurve(edgeId, forward = true) {
    ensure();
    const e = D.edgeById.get(edgeId);
    if (!e) return null;
    const pts = forward ? e.points.slice() : e.points.slice().reverse();
    const fr = frames(pts);
    const off = e.lanes >= 2 ? e.width / 4 : 0;
    return offsetPts(pts, fr.tx, fr.ty, off).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  }
  function edgesInRect(x0, y0, x1, y1) {
    ensure();
    return roads.edges.filter((e) => e.bbox && bboxHit(e.bbox, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)));
  }
  function junctions() { ensure(); return D.junctions.filter((J) => J.degree >= 3).map((J) => J.node); }
  function drawMinimap(g, scale = 1) {
    ensure();
    const col = { track: palette.soil.dry, lane: palette.gravel[2], village: '#8e8a84', regional: '#4a4c50' };
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const cls of ['track', 'lane', 'village', 'regional']) {
      for (const e of roads.edges) {
        if (e.class !== cls || !e.points || e.points.length < 2) continue;
        g.beginPath();
        e.points.forEach((p, i) => (i ? g.lineTo(p[0] * scale, p[1] * scale) : g.moveTo(p[0] * scale, p[1] * scale)));
        g.lineWidth = Math.max(cls === 'regional' ? 2 : 1, (e.width + 1) * scale) + 1;
        g.strokeStyle = 'rgba(40,34,28,0.6)'; g.stroke();
        g.lineWidth = Math.max(cls === 'regional' ? 2 : 1, (e.width + 1) * scale);
        g.strokeStyle = e.bridge ? palette.concrete[2] : col[cls]; g.stroke();
      }
    }
    g.restore();
    return true;
  }

  // ------------------------------------------------------------ rendering
  ctx.renderer.addLayer('ground-overlay', (g, view) => {
    ensure();
    const k = envState(); const key = k.season + ':' + k.snow;
    if (key !== lastEnvKey) { if (lastEnvKey) cache.clear(); lastEnvKey = key; }
    cache.draw(g, view, cache.map.size ? 1 : 3);
  }, 10);

  const chainPath = (ch) => {
    let p = D.paths.get(ch);
    if (!p) { p = new Path2D(); pathFrom(p, ch.ribbon, true); D.paths.set(ch, p); }
    return p;
  };
  // wet sheen + puddle reflections (dynamic)
  ctx.renderer.addLayer('ground-detail', (g, view) => {
    if (!D) return;
    const wet = envState().wet;
    if (wet < 0.04) return;
    for (const ch of D.chains) {
      if (!bboxHit(ch.bbox, view.x0, view.y0, view.x1, view.y1)) continue;
      if (ch.cls === 'track') continue;
      const p = chainPath(ch);
      g.fillStyle = `rgba(18,24,36,${0.22 * wet})`; g.fill(p);
      g.fillStyle = `rgba(160,180,205,${0.07 * wet})`; g.fill(p);
    }
    for (const J of D.junctions) {
      if (J.cls === 'track' || !bboxHit(J.bbox, view.x0, view.y0, view.x1, view.y1)) continue;
      let jp = D.paths.get(J);
      if (!jp) { jp = new Path2D(); pathFrom(jp, J.poly, true); D.paths.set(J, jp); }
      g.fillStyle = `rgba(18,24,36,${0.22 * wet})`; g.fill(jp);
      g.fillStyle = `rgba(160,180,205,${0.07 * wet})`; g.fill(jp);
    }
    for (const q of D.puddles) {
      if (q.x < view.x0 - 2 || q.x > view.x1 + 2 || q.y < view.y0 - 2 || q.y > view.y1 + 2) continue;
      g.save(); g.translate(q.x, q.y); g.rotate(q.rot);
      g.fillStyle = `rgba(120,140,160,${0.5 * wet})`;
      g.beginPath(); g.ellipse(0, 0, q.rx * 0.8, q.ry * 0.75, 0, 0, 6.283); g.fill();
      g.strokeStyle = `rgba(235,242,248,${0.45 * wet})`; g.lineWidth = 0.05;
      g.beginPath(); g.ellipse(-q.rx * 0.2, -q.ry * 0.25, q.rx * 0.5, q.ry * 0.35, 0, 3.4, 5.4); g.stroke();
      g.restore();
    }
  }, 10);

  // lamp sprites
  const LH = { w: 0.95, h: 0.4 };
  const headSprite = art.sprite('roads:lamphead', LH.w * 64, LH.h * 64, (g, w, h) => {
    const r = h * 0.45;
    const body = '#59636a';
    g.fillStyle = art.outline(body);
    roundRect(g, 1, 1, w - 2, h - 2, r); g.fill();
    g.fillStyle = body;
    roundRect(g, 3, 3, w - 6, h - 6, r - 2); g.fill();
    const gr = g.createLinearGradient(0, 3, 0, h - 3);
    gr.addColorStop(0, 'rgba(255,250,235,0.35)'); gr.addColorStop(0.5, 'rgba(255,250,235,0.05)'); gr.addColorStop(1, 'rgba(10,16,24,0.25)');
    g.fillStyle = gr; roundRect(g, 3, 3, w - 6, h - 6, r - 2); g.fill();
    g.strokeStyle = 'rgba(20,26,32,0.5)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(w * 0.22, 4); g.lineTo(w * 0.22, h - 4); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(w * 0.3, h * 0.28, w * 0.55, h * 0.12);
  });
  const baseSprite = art.sprite('roads:lampbase', 0.6 * 64, 0.6 * 64, (g, w, h) => {
    art.contactShadow(g, w / 2, h / 2, w * 0.48, h * 0.48, 0.35);
    g.fillStyle = palette.concrete[1]; g.beginPath(); g.arc(w / 2, h / 2, w * 0.3, 0, 6.283); g.fill();
    g.strokeStyle = art.outline(palette.concrete[1]); g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#45505a'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.15, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,250,235,0.35)'; g.beginPath(); g.arc(w / 2 - 2, h / 2 - 2, w * 0.07, 0, 6.283); g.fill();
  });

  const lensSprite = art.sprite('roads:lens', 64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,236,190,0.9)'); gr.addColorStop(0.35, 'rgba(255,190,110,0.35)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  const lampsOn = (i) => {
    const env = world.environment || {};
    const thr = 0.42 - ((i * 7919) % 97) / 97 * 0.08;
    if (typeof env.daylight === 'number') return env.daylight < thr;
    const t = ctx.clock.timeOfDay;
    return t > 19.6 + ((i * 13) % 7) * 0.04 || t < 6.4;
  };
  let suppressShadows = false;

  ctx.renderer.addCollector((view, F) => {
    if (!D) return;
    const pad = 16;
    const lights = roads.lights;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.x < view.x0 - pad || l.x > view.x1 + pad || l.y < view.y0 - pad || l.y > view.y1 + pad) continue;
      const rot = Math.atan2(l.hy - l.y, l.hx - l.x);
      if (!suppressShadows) {
        F.shadow.pole(l.x, l.y, l.height, 0.16);
        const nx = -Math.sin(rot) * 0.04, ny = Math.cos(rot) * 0.04;
        F.shadow.poly([[l.x + nx, l.y + ny], [l.hx + nx, l.hy + ny], [l.hx - nx, l.hy - ny], [l.x - nx, l.y - ny]], l.height + 0.05, l.height - 0.08);
        F.shadow.box((l.x + l.hx * 3) / 4 + (l.hx - l.x) * 0.1, (l.y + l.hy * 3) / 4 + (l.hy - l.y) * 0.1, LH.w, LH.h * 0.8, rot, l.height, l.height - 0.25);
      }
      const on = lampsOn(i);
      if (on) F.light({ x: l.hx, y: l.hy, radius: 15, color: LAMP_COLOR, intensity: 0.95, glow: 1, glowRadius: 2.6 });
      const hx = l.hx + (l.hx - l.x) * 0.1, hy = l.hy + (l.hy - l.y) * 0.1;
      if (view.zoom < 6) continue;
      F.object({
        y: l.y,
        draw(g) {
          g.drawImage(baseSprite, l.x - 0.3, l.y - 0.3, 0.6, 0.6);
          g.lineCap = 'round';
          g.strokeStyle = '#2f373d'; g.lineWidth = 0.1;
          g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(hx, hy); g.stroke();
          g.strokeStyle = '#6f7a82'; g.lineWidth = 0.035;
          g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(hx, hy); g.stroke();
          art.draw(g, headSprite, hx, hy, LH.w, LH.h, rot);
          g.fillStyle = '#3d474e'; g.beginPath(); g.arc(l.x, l.y, 0.1, 0, 6.283); g.fill();
        },
      });
    }
    // bridges: railings (objects) + one custom shadow per bridge (deck + railings)
    for (const ch of D.chains) {
      if (!ch.bridges.length) continue;
      for (const [a, b] of ch.bridges) bridgeObjects(ch, a, b, view, F);
    }
  });

  const RAIL = '#4d6b4a';
  function railLine(ch, a, b, side, step = 0.5) {
    const out = [];
    const off = side * (ch.hw + 1.0);
    for (let s = a - 2; s <= b + 2 + 0.01; s += step) {
      const p = sampleAt(ch.pts, ch.cum, Math.max(0, Math.min(ch.L, s)));
      out.push([p.x - p.ty * off, p.y + p.tx * off]);
    }
    return out;
  }
  const bridgeGeo = new Map();
  function bridgeGeometry(ch, a, b) {
    const key = ch.key + ':' + a.toFixed(1);
    let G = D && D.bridgeGeo && D.bridgeGeo.get(key);
    if (G) return G;
    if (!D.bridgeGeo) D.bridgeGeo = new Map();
    const rails = [railLine(ch, a, b, 1), railLine(ch, a, b, -1)];
    const o1 = [], o2 = [], f1 = [], f2 = [];
    for (let s = a - 2.5; s <= b + 2.5 + 0.01; s += 1) {
      const p = sampleAt(ch.pts, ch.cum, Math.max(0, Math.min(ch.L, s)));
      const w = ch.hw + 1.1;
      f1.push([p.x - p.ty * w, p.y + p.tx * w]); f2.push([p.x + p.ty * w, p.y - p.tx * w]);
      if (s >= a && s <= b) { const w2 = ch.hw + 1.15; o1.push([p.x - p.ty * w2, p.y + p.tx * w2]); o2.push([p.x + p.ty * w2, p.y - p.tx * w2]); }
    }
    const all = rails[0].concat(rails[1]);
    G = { rails, wings: wingWalls(ch, a, b), deck: o1.concat(o2.reverse()), deckFull: f1.concat(f2.reverse()), bbox: {
      x0: Math.min(...all.map((p) => p[0])) - 3, y0: Math.min(...all.map((p) => p[1])) - 3,
      x1: Math.max(...all.map((p) => p[0])) + 3, y1: Math.max(...all.map((p) => p[1])) + 3 } };
    D.bridgeGeo.set(key, G);
    return G;
  }
  function bridgeObjects(ch, a, b, view, F) {
    const G = bridgeGeometry(ch, a, b);
    const pad = 20;
    if (!bboxHit(G.bbox, view.x0 - pad, view.y0 - pad, view.x1 + pad, view.y1 + pad)) return;
    const rails = G.rails;
    if (!suppressShadows) {
      F.shadow.custom((sg, sun) => {
        const L = Math.min(8, Math.max(0, sun.shadowLen || 0));
        const dx = sun.dirX * L, dy = sun.dirY * L;
        sg.fillStyle = palette.shadow; sg.strokeStyle = palette.shadow;
        // deck slab (z 1.3..2.1) swept along the sun
        sg.beginPath();
        for (const z of [1.3, 1.55, 1.8, 2.1]) addPoly(sg, G.deck.map(([x, y]) => [x + dx * z, y + dy * z]));
        sg.fill('nonzero');
        sg.globalCompositeOperation = 'destination-out';
        sg.beginPath(); addPoly(sg, G.deckFull); sg.fill();
        sg.globalCompositeOperation = 'source-over';
        // railings: top rail (z≈1.05), mid rail (z≈0.53), upstand (0..0.22), posts
        sg.lineJoin = 'round'; sg.lineCap = 'butt';
        const line = (r, z, w) => { sg.beginPath(); for (let i = 0; i < r.length; i++) { const x = r[i][0] + dx * z, y = r[i][1] + dy * z; if (i) sg.lineTo(x, y); else sg.moveTo(x, y); } sg.lineWidth = w; sg.stroke(); };
        const sw = Math.hypot(dx, dy);
        for (const w of G.wings) { sg.beginPath(); sg.moveTo(w.p0[0] + dx * 0.5, w.p0[1] + dy * 0.5); sg.lineTo(w.p1[0] + dx * 0.5, w.p1[1] + dy * 0.5); sg.lineWidth = 0.6 + sw * 1.0; sg.stroke(); }
        for (const r of rails) {
          line(r, 1.05, 0.09 + sw * 0.1);
          line(r, 0.53, 0.06 + sw * 0.06);
          line(r, 0.11, 0.24 + sw * 0.22);
          sg.beginPath();
          for (let i = 0; i < r.length; i += 3) { sg.moveTo(r[i][0], r[i][1]); sg.lineTo(r[i][0] + dx * 1.1, r[i][1] + dy * 1.1); }
          sg.lineWidth = 0.1; sg.stroke();
        }
      });
    }
    for (const r of rails) {
      for (let i0 = 0; i0 < r.length - 1; i0 += 12) {
        const seg = r.slice(i0, Math.min(r.length, i0 + 13));
        const ys = seg.map((p) => p[1]);
        const minX = Math.min(...seg.map((p) => p[0])), maxX = Math.max(...seg.map((p) => p[0]));
        if (maxX < view.x0 - 2 || minX > view.x1 + 2 || Math.max(...ys) < view.y0 - 2 || Math.min(...ys) > view.y1 + 2) continue;
        if (view.zoom < 5) continue;
        F.object({
          y: Math.max(...ys),
          draw(g) {
            g.lineCap = 'butt'; g.lineJoin = 'round';
            // kick plate / upstand
            g.beginPath(); pathFrom(g, seg); g.strokeStyle = palette.concrete[0]; g.lineWidth = 0.22; g.stroke();
            g.strokeStyle = 'rgba(40,44,40,0.35)'; g.lineWidth = 0.24; g.globalCompositeOperation = 'destination-over'; g.stroke(); g.globalCompositeOperation = 'source-over';
            // posts
            g.fillStyle = art.outline(RAIL);
            for (let k = 0; k < seg.length; k += 3) { const p = seg[k]; g.fillRect(p[0] - 0.09, p[1] - 0.09, 0.18, 0.18); }
            // rail
            g.beginPath(); pathFrom(g, seg);
            g.strokeStyle = art.outline(RAIL); g.lineWidth = 0.15; g.stroke();
            g.strokeStyle = RAIL; g.lineWidth = 0.1; g.stroke();
            g.strokeStyle = 'rgba(230,240,220,0.35)'; g.lineWidth = 0.02; g.stroke();
          },
        });
      }
    }
  }

  // lamp lens glow (additive), plus wet-road reflections of lamps
  ctx.renderer.addLayer('glow', (g, view) => {
    if (!D) return;
    const wet = envState().wet;
    const lights = roads.lights;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.hx < view.x0 - 3 || l.hx > view.x1 + 3 || l.hy < view.y0 - 3 || l.hy > view.y1 + 3) continue;
      if (!lampsOn(i) || view.zoom < 5) continue;
      const hx = l.hx + (l.hx - l.x) * 0.1, hy = l.hy + (l.hy - l.y) * 0.1;
      g.drawImage(lensSprite, hx - 0.9, hy - 0.9, 1.8, 1.8);
      if (wet > 0.1) {
        g.globalAlpha = Math.min(0.5, wet * 0.5);
        g.drawImage(lensSprite, hx - 0.6, hy - 1.3, 1.2, 5);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  });

  // ------------------------------------------------------------ api
  const api = {
    addNode, addEdge, removeEdge, generateNetwork, nearest, roadAt, pathfind, laneCurve,
    edges: () => { ensure(); return roads.edges; },
    nodes: () => { ensure(); return roads.nodes; },
    edgesInRect, junctions, drawMinimap,
    classes: () => JSON.parse(JSON.stringify(CLASSES)),
    lights: () => { ensure(); return roads.lights; },
  };
  const inst = {
    api,
    update() { if (dirty) ensure(); },
    save() {
      return { counter, nodes: roads.nodes.map((n) => ({ ...n })), edges: roads.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, class: e.class, bridge: e.bridge, via: e.via })) };
    },
    load(d) {
      if (!d || !Array.isArray(d.nodes)) return;
      clear();
      counter = d.counter || 0;
      for (const n of d.nodes) roads.nodes.push({ id: n.id, x: n.x, y: n.y });
      for (const e of d.edges) {
        const spec = CLASSES[e.class] || CLASSES.lane;
        roads.edges.push({ id: e.id, a: e.a, b: e.b, class: e.class, width: spec.width, lanes: spec.lanes, speed: spec.speed, bridge: !!e.bridge, via: e.via || [], points: [], length: 0 });
      }
      dirty = true; ensure();
    },
    dispose() { cache.clear(); },
  };
  // internals for the showcase
  inst._internal = { cache, tex, ensure, generate: generateNetwork, setSuppressShadows: (v) => { suppressShadows = v; }, lampsOn, envState };
  internals.set(ctx.id, inst._internal);
  return inst;
}

const internals = new Map();

// ------------------------------------------------------------ small canvas helpers
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - r); g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  g.lineTo(x + r, y + h); g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  g.closePath();
}
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function addPoly(g, pts) {
  const rev = area(pts) < 0, n = pts.length;
  for (let k = 0; k < n; k++) { const p = pts[rev ? n - 1 - k : k]; if (k === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); }
  g.closePath();
}

// ======================================================================
// Showcase
// ======================================================================
const RIVER = { pts: [[150, 60], [170, 150], [160, 230], [166, 300], [178, 350], [170, 430], [156, 520]], width: 17 };
const FIELDS = [
  { poly: [[452, 330], [560, 334], [566, 350], [456, 346]], dir: [1, 0.04] },
  { poly: [[452, 364], [565, 362], [570, 430], [460, 432]], dir: [0.99, -0.02] },
  { poly: [[346, 60], [420, 64], [412, 150], [352, 154]], dir: [0.1, 1] },
];
const SHOWCASE_PLAN = {
  nodes: [
    [20, 292], [146, 300], [188, 300], [250, 301], [330, 306], [432, 300], [590, 290], // 0-6 regional
    [332, 240], [262, 236], [410, 244], [336, 176], // 7-10 village crossroads + arms
    [438, 352], [446, 420], [548, 356], // 11-13 lane / farm / track end
    [508, 222], [350, 100], // 14 lane end, 15 track end
  ],
  edges: [
    [0, 1, 'regional', [[84, 290]]],
    [1, 2, 'regional', [], { bridge: true }],
    [2, 3, 'regional', [[218, 299]]],
    [3, 4, 'regional', [[292, 305]]],
    [4, 5, 'regional', [[382, 305]]],
    [5, 6, 'regional', [[510, 293]]],
    [4, 7, 'village', [[334, 272]]],
    [7, 8, 'village', [[296, 240]]],
    [7, 9, 'village', [[372, 240]]],
    [7, 10, 'village', [[331, 208]]],
    [8, 3, 'village', [[246, 262]]],
    [5, 11, 'lane', [[434, 326]]],
    [11, 12, 'lane', [[442, 388]]],
    [11, 13, 'track', [[494, 350]]],
    [9, 14, 'lane', [[460, 236]]],
    [10, 15, 'track', [[341, 138]]],
  ],
};

export const showcase = {
  deps: ['environment'],
  presets: {
    default: { camera: { x: 318, y: 282, zoom: 3.8 }, time: '10:30' },
    junction: { camera: { x: 336, y: 244, zoom: 28 }, time: '11:00' },
    tjunction: { camera: { x: 330, y: 300, zoom: 26 }, time: '16:30' },
    bridge: { camera: { x: 167, y: 300, zoom: 24 }, time: '15:00' },
    night: { camera: { x: 322, y: 262, zoom: 13 }, time: '22:30' },
    farm: { camera: { x: 440, y: 348, zoom: 24 }, time: '09:30' },
    winter: { camera: { x: 332, y: 262, zoom: 9 }, time: '12:00', day: 34 },
  },
  async stage(ctx, presetName) {
    const self = internals.get(ctx.id);
    const envApi = ctx.modules.get('environment');
    const envOK = !!(envApi && typeof envApi.getSun === 'function');
    // own backdrop (terrain optional → always paint a small valley so the showcase is self-contained)
    const bd = makeBackdrop({ art: ctx.art, palette: ctx.palette, tex: self.tex, getSeason: () => ctx.clock.season, river: RIVER, fields: FIELDS });
    const bdCache = new ChunkCache(bd.paint, { maxBytes: 120 * 1048576 });
    let bdSeason = ctx.clock.season;
    ctx.renderer.addLayer('ground', (g, view) => {
      if (ctx.clock.season !== bdSeason) { bdSeason = ctx.clock.season; bdCache.clear(); }
      bdCache.draw(g, view, bdCache.map.size ? 1 : 4);
    }, -5);
    // network
    self.generate(SHOWCASE_PLAN);
    // prewarm chunks for the preset view (so screenshots aren't waiting on budgeted builds)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const v = ctx.camera.view();
    self.cache.prewarm(v, ctx.camera.zoom * dpr);
    bdCache.prewarm(v, ctx.camera.zoom * dpr);
    if (!envOK) installFallbackNight(ctx, self);
  },
};

/** only when the environment module is missing: a local darkness + lamp light pass */
function installFallbackNight(ctx, self) {
  const cv = document.createElement('canvas');
  const lg = cv.getContext('2d');
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 128;
  const sg = sprite.getContext('2d');
  const gr = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,190,116,1)'); gr.addColorStop(0.3, 'rgba(255,190,116,0.55)'); gr.addColorStop(0.65, 'rgba(255,190,116,0.15)'); gr.addColorStop(1, 'rgba(255,190,116,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const daylight = () => { const t = ctx.clock.timeOfDay; return Math.max(0, Math.min(1, Math.sin(((t - 6) / 12) * Math.PI) * 3 + 0.25)); };
  ctx.renderer.addLayer('weather', (g, view) => {
    const d = daylight();
    self.setSuppressShadows(d < 0.35);
    if (d > 0.98) return;
    const m = g.getTransform();
    const W = Math.ceil(g.canvas.width / 2), H = Math.ceil(g.canvas.height / 2);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const n = ctx.palette.ambientNight;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = `rgb(${n[0] + (255 - n[0]) * d | 0},${n[1] + (255 - n[1]) * d | 0},${n[2] + (255 - n[2]) * d | 0})`;
    lg.fillRect(0, 0, W, H);
    lg.setTransform(m.a / 2, 0, 0, m.d / 2, m.e / 2, m.f / 2);
    lg.globalCompositeOperation = 'lighter';
    const lights = ctx.world.roads.lights;
    for (let i = 0; i < lights.length; i++) {
      if (!self.lampsOn(i)) continue;
      const l = lights[i];
      lg.globalAlpha = 0.95;
      lg.drawImage(sprite, l.hx - 15, l.hy - 15, 30, 30);
    }
    lg.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(cv, 0, 0, g.canvas.width, g.canvas.height);
    g.globalCompositeOperation = 'lighter';
    g.setTransform(m);
    for (let i = 0; i < lights.length; i++) {
      if (!self.lampsOn(i)) continue;
      const l = lights[i];
      g.globalAlpha = 0.35 * (1 - d);
      g.drawImage(sprite, l.hx - 3, l.hy - 3, 6, 6);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  });
}
