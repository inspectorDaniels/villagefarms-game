// Road graph → derived render/query geometry: chains (runs of same-class edges through
// degree-2 nodes, smoothed once), junctions (arms, filleted corners, polygons, setbacks),
// trimmed carriageway ribbons, bridges, street-light and crossing placement, spatial grid.
import {
  smoothPolyline, cumLengths, frames, sampleAt, resample, offsetPts, nearestOnSeg, lineIntersect,
  bboxOf, dist, norm,
} from './geom.js';

export const CLASSES = {
  regional: { width: 7, lanes: 2, speed: 22.2, rank: 4, fillet: 8, kerb: false, label: 'Regional road' },
  village: { width: 6, lanes: 2, speed: 13.9, rank: 3, fillet: 5, kerb: true, kerbW: 0.22, pave: 1.9, label: 'Village street' },
  lane: { width: 3.5, lanes: 1, speed: 11, rank: 2, fillet: 3.5, kerb: false, label: 'Farm lane (gravel)' },
  track: { width: 3, lanes: 1, speed: 6, rank: 1, fillet: 2.5, kerb: false, label: 'Dirt track' },
};
export const CLASS_ORDER = ['track', 'lane', 'village', 'regional'];

/** outer half-width including kerbs/pavement (for clearing, lights, etc.) */
export function outerHalf(cls) {
  const c = CLASSES[cls];
  return c.width / 2 + (c.kerb ? c.kerbW + c.pave : 0.5);
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Build derived geometry from world.roads (nodes/edges). Also fills edge.points and roads.lights. */
export function buildDerived(roads, noise) {
  const nodeById = new Map(roads.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(roads.edges.map((e) => [e.id, e]));
  const adj = new Map(roads.nodes.map((n) => [n.id, []]));
  for (const e of roads.edges) {
    if (!adj.has(e.a) || !adj.has(e.b)) continue;
    adj.get(e.a).push({ e, end: 'a' });
    if (e.a !== e.b) adj.get(e.b).push({ e, end: 'b' });
  }
  const deg = (id) => (adj.get(id) || []).length;
  const isPass = (id) => {
    const l = adj.get(id);
    return l && l.length === 2 && l[0].e.class === l[1].e.class && l[0].e !== l[1].e;
  };

  // ---------- chains
  const used = new Set();
  const chains = [];
  const walk = (startNode, first) => {
    const seq = [];
    let node = startNode, cur = first;
    for (;;) {
      used.add(cur.e.id);
      const fwd = cur.e.a === node;
      seq.push({ e: cur.e, fwd });
      node = fwd ? cur.e.b : cur.e.a;
      if (node === startNode || !isPass(node)) break;
      const nxt = adj.get(node).find((x) => x.e !== cur.e);
      if (!nxt || used.has(nxt.e.id)) break;
      cur = nxt;
    }
    return { seq, endNode: node };
  };
  for (const n of roads.nodes) {
    if (isPass(n.id)) continue;
    for (const it of adj.get(n.id)) if (!used.has(it.e.id)) {
      const { seq, endNode } = walk(n.id, it);
      chains.push({ startNode: n.id, endNode, seq });
    }
  }
  for (const e of roads.edges) if (!used.has(e.id) && adj.has(e.a)) {   // pure loops
    const { seq, endNode } = walk(e.a, adj.get(e.a).find((x) => x.e === e));
    chains.push({ startNode: e.a, endNode, seq });
  }

  for (const ch of chains) {
    const cls = ch.seq[0].e.class;
    ch.cls = cls;
    ch.spec = CLASSES[cls] || CLASSES.lane;
    ch.hw = ch.spec.width / 2;
    ch.key = ch.startNode + '>' + ch.endNode + ':' + ch.seq.map((s) => s.e.id).join(',');
    const ctrl = [];
    const nodeCtrl = [];
    const n0 = nodeById.get(ch.startNode);
    ctrl.push([n0.x, n0.y]); nodeCtrl.push(0);
    for (const { e, fwd } of ch.seq) {
      const via = (e.via || []).slice();
      if (!fwd) via.reverse();
      for (const v of via) ctrl.push([v[0], v[1]]);
      const nb = nodeById.get(fwd ? e.b : e.a);
      ctrl.push([nb.x, nb.y]); nodeCtrl.push(ctrl.length - 1);
    }
    const sm = smoothPolyline(ctrl, 0.75);
    ch.full = sm.pts;
    ch.fullCum = cumLengths(sm.pts);
    ch.length = ch.fullCum[ch.fullCum.length - 1];
    // edge.points + bridge ranges (full arc length)
    ch.bridgesFull = [];
    ch.seq.forEach(({ e, fwd }, k) => {
      const i0 = sm.ctrlIdx[nodeCtrl[k]], i1 = sm.ctrlIdx[nodeCtrl[k + 1]];
      const pts = sm.pts.slice(i0, i1 + 1).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]);
      e.points = fwd ? pts : pts.reverse();
      e.length = +(ch.fullCum[i1] - ch.fullCum[i0]).toFixed(2);
      if (e.bridge) ch.bridgesFull.push([ch.fullCum[i0], ch.fullCum[i1]]);
    });
  }

  // ---------- junctions
  const armsAt = new Map();
  for (const ch of chains) {
    for (const atStart of [true, false]) {
      const nid = atStart ? ch.startNode : ch.endNode;
      if (!armsAt.has(nid)) armsAt.set(nid, []);
      const probe = Math.min(7, ch.length * 0.35);
      const p = sampleAt(ch.full, ch.fullCum, atStart ? probe : ch.length - probe);
      const nd = nodeById.get(nid);
      const d = norm(p.x - nd.x, p.y - nd.y);
      armsAt.get(nid).push({ ch, atStart, d, hw: ch.hw, cls: ch.cls, rank: ch.spec.rank, ang: Math.atan2(d[1], d[0]), s: 0 });
    }
  }
  const junctions = [];
  for (const [nid, arms] of armsAt) {
    const node = nodeById.get(nid);
    for (const a of arms) { a.ch[a.atStart ? 'trimStart' : 'trimEnd'] = 0; }
    if (arms.length < 2) { continue; }
    if (arms.length === 2 && isPass(nid)) continue;
    arms.sort((a, b) => a.ang - b.ang);
    const P = [node.x, node.y];
    const corners = [];
    const maxRank = Math.max(...arms.map((a) => a.rank));
    for (let i = 0; i < arms.length; i++) {
      const A = arms[i], B = arms[(i + 1) % arms.length];
      let gap = B.ang - A.ang;
      if (gap <= 0) gap += Math.PI * 2;
      const nA = [-A.d[1], A.d[0]], mB = [B.d[1], -B.d[0]];
      const corner = { i, j: (i + 1) % arms.length, gap };
      if (gap > 2.7 || arms.length === 2) {
        corner.type = 'straight';
      } else {
        const r = lineIntersect([P[0] + nA[0] * A.hw, P[1] + nA[1] * A.hw], A.d, [P[0] + mB[0] * B.hw, P[1] + mB[1] * B.hw], B.d);
        if (!r) { corner.type = 'straight'; } else {
          const C = [P[0] + nA[0] * A.hw + A.d[0] * r.t, P[1] + nA[1] * A.hw + A.d[1] * r.t];
          let R = Math.min(CLASSES[A.cls].fillet, CLASSES[B.cls].fillet);
          const half = gap / 2;
          let T = R / Math.tan(half);
          if (T > 10) { T = 10; R = T * Math.tan(half); }
          const bis = norm(A.d[0] + B.d[0], A.d[1] + B.d[1]);
          const O = [C[0] + bis[0] * R / Math.sin(half), C[1] + bis[1] * R / Math.sin(half)];
          Object.assign(corner, { type: 'fillet', C, R, T, O, half, bis, tA: r.t + T, tB: r.u + T });
          A.s = Math.max(A.s, r.t + T);
          B.s = Math.max(B.s, r.u + T);
        }
      }
      corner.nA = nA; corner.mB = mB;
      corners.push(corner);
    }
    const maxHw = Math.max(...arms.map((a) => a.hw));
    for (const a of arms) {
      if (arms.length === 2) a.s = a.hw < maxHw - 0.2 ? 5 : 1;
      a.s = Math.max(a.s, 1, arms.length > 2 ? maxHw * 0.6 : 0);
      a.s = Math.min(a.s, a.ch.length * 0.45);
      a.ch[a.atStart ? 'trimStart' : 'trimEnd'] = a.s;
      a.minor = arms.length > 2 && a.rank < maxRank;
    }
    const J = { node: nid, x: node.x, y: node.y, arms, corners, maxRank, degree: arms.length };
    J.curve = (ci, k) => cornerCurve(J, ci, k);
    J.poly = junctionPoly(J, 0);
    J.bbox = bboxOf(J.poly, 1);
    // major through pair (for continuous centre line)
    J.through = null;
    if (arms.length >= 3) {
      const majors = arms.filter((a) => a.rank === maxRank);
      if (majors.length === 2) {
        const dot = majors[0].d[0] * majors[1].d[0] + majors[0].d[1] * majors[1].d[1];
        if (dot < -0.8) J.through = majors;
      }
    }
    junctions.push(J);
  }

  // ---------- trimmed chain geometry
  for (const ch of chains) {
    const s0 = ch.trimStart || 0, s1 = ch.length - (ch.trimEnd || 0);
    ch.s0 = s0;
    const pts = s1 - s0 > 0.5 ? resample(ch.full, ch.fullCum, s0, s1, 0.5) : resample(ch.full, ch.fullCum, 0, ch.length, 0.5);
    ch.pts = pts;
    ch.cum = cumLengths(pts);
    ch.L = ch.cum[ch.cum.length - 1];
    const fr = frames(pts);
    ch.tx = fr.tx; ch.ty = fr.ty;
    // rural edges wobble (noise), fading to exact width near chain ends that meet junctions
    const rural = !ch.spec.kerb;
    const seed = hash32(ch.key) * 1000;
    const amp = ch.cls === 'regional' ? 0.09 : ch.cls === 'lane' ? 0.16 : ch.cls === 'track' ? 0.22 : 0;
    const endFade = (i) => {
      const s = ch.cum[i];
      const fs = ch.trimStart ? Math.min(1, s / 3) : 1;
      const fe = ch.trimEnd ? Math.min(1, (ch.L - s) / 3) : 1;
      return Math.min(fs, fe);
    };
    ch.wR = new Float64Array(pts.length); ch.wL = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const s = ch.cum[i] + s0;
      const f = rural ? endFade(i) : 0;
      ch.wR[i] = ch.hw + f * amp * noise.fbm(s * 0.35 + seed, 3.1, 2);
      ch.wL[i] = ch.hw + f * amp * noise.fbm(s * 0.35 + seed, 17.7, 2);
    }
    ch.edgeR = offsetPts(pts, ch.tx, ch.ty, (i) => ch.wR[i]);
    ch.edgeL = offsetPts(pts, ch.tx, ch.ty, (i) => -ch.wL[i]);
    ch.ribbon = ch.edgeR.concat(ch.edgeL.slice().reverse());
    ch.bbox = bboxOf(pts, outerHalf(ch.cls) + 2);
    ch.bridges = ch.bridgesFull.map(([a, b]) => [Math.max(0, a - s0), Math.min(ch.L, b - s0)]).filter(([a, b]) => b - a > 1);
    ch.isBridge = (s) => ch.bridges.some(([a, b]) => s >= a - 0.5 && s <= b + 0.5);
  }

  // ---------- crossings (zebra) near village centres
  const crossings = [];
  const villageJ = junctions.filter((J) => J.degree >= 3 && J.arms.every((a) => a.cls === 'village'));
  villageJ.sort((a, b) => b.degree - a.degree || a.node.localeCompare(b.node));
  for (const J of villageJ.slice(0, 2)) {
    const cand = J.arms.filter((a) => a.ch.L > 20).sort((a, b) => b.ch.L - a.ch.L);
    const a = cand[0];
    if (!a) continue;
    const s = a.atStart ? 3.2 : a.ch.L - 3.2;
    const p = sampleAt(a.ch.pts, a.ch.cum, s);
    crossings.push({ x: p.x, y: p.y, tx: p.tx, ty: p.ty, hw: a.ch.hw, ch: a.ch, s, len: 3 });
  }

  // ---------- street lights along village streets
  const lights = [];
  for (const ch of chains) {
    if (ch.cls !== 'village' || ch.L < 12) continue;
    const off = ch.hw + ch.spec.kerbW + ch.spec.pave - 0.45;
    const spacing = 27;
    const n = Math.max(1, Math.round((ch.L - 8) / spacing));
    const step = (ch.L - 8) / n;
    const rnd = hash32(ch.key + 'side');
    for (let k = 0; k <= n; k++) {
      const s = 4 + k * step;
      if (crossings.some((c) => c.ch === ch && Math.abs(c.s - s) < 5)) continue;
      const p = sampleAt(ch.pts, ch.cum, s);
      const side = ((k + (rnd < 0.5 ? 0 : 1)) % 2 === 0) ? 1 : -1;
      const nx = -p.ty * side, ny = p.tx * side;
      const bx = p.x + nx * off, by = p.y + ny * off;
      // keep away from junction polygons of other roads
      if (junctions.some((J) => Math.hypot(J.x - bx, J.y - by) < 7 && !(J.degree === 2))) continue;
      lights.push({ x: +bx.toFixed(2), y: +by.toFixed(2), hx: +(bx - nx * 1.5).toFixed(2), hy: +(by - ny * 1.5).toFixed(2), height: 6 });
    }
  }
  // lights at village junction corners (one per junction, outside the fillet)
  for (const J of junctions) {
    if (J.degree < 3 || !J.arms.some((a) => a.cls === 'village')) continue;
    const c = J.corners.find((cc) => cc.type === 'fillet');
    if (!c) continue;
    const kerbOff = CLASSES.village.kerbW + CLASSES.village.pave - 0.5;
    const bx = c.O[0] - c.bis[0] * (c.R - kerbOff), by = c.O[1] - c.bis[1] * (c.R - kerbOff);
    if (lights.some((l) => Math.hypot(l.x - bx, l.y - by) < 10)) continue;
    lights.push({ x: +bx.toFixed(2), y: +by.toFixed(2), hx: +(bx - c.bis[0] * 1.5).toFixed(2), hy: +(by - c.bis[1] * 1.5).toFixed(2), height: 6 });
  }
  roads.lights = lights;

  // ---------- spatial grid over edge polylines
  const CELL = 16;
  const grid = new Map();
  const put = (cx, cy, item) => { const k = cx + ',' + cy; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(item); };
  for (const e of roads.edges) {
    if (!e.points || e.points.length < 2) continue;
    e.bbox = bboxOf(e.points, e.width / 2);
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i], b = e.points[i + 1];
      const x0 = Math.floor((Math.min(a[0], b[0]) - e.width / 2) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + e.width / 2) / CELL);
      const y0 = Math.floor((Math.min(a[1], b[1]) - e.width / 2) / CELL), y1 = Math.floor((Math.max(a[1], b[1]) + e.width / 2) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) put(cx, cy, [e, i]);
    }
  }

  return { nodeById, edgeById, adj, chains, junctions, crossings, grid, CELL, deg };
}

/** corner curve between arm i and arm i+1 at offset k (0 = carriageway edge, >0 away from road) */
export function cornerCurve(J, ci, k) {
  const c = J.corners[ci];
  const A = J.arms[c.i], B = J.arms[c.j];
  const P = [J.x, J.y];
  const endA = [P[0] + A.d[0] * A.s + c.nA[0] * (A.hw + k), P[1] + A.d[1] * A.s + c.nA[1] * (A.hw + k)];
  const endB = [P[0] + B.d[0] * B.s + c.mB[0] * (B.hw + k), P[1] + B.d[1] * B.s + c.mB[1] * (B.hw + k)];
  if (c.type !== 'fillet') return [endA, endB];
  const out = [endA];
  const r = c.R - k;
  const tanA = [c.C[0] + A.d[0] * c.T + c.nA[0] * k, c.C[1] + A.d[1] * c.T + c.nA[1] * k];
  const tanB = [c.C[0] + B.d[0] * c.T + c.mB[0] * k, c.C[1] + B.d[1] * c.T + c.mB[1] * k];
  if (dist(tanA, endA) > 0.05) out.push(tanA);
  if (r > 0.05) {
    const a0 = Math.atan2(tanA[1] - c.O[1], tanA[0] - c.O[0]);
    let a1 = Math.atan2(tanB[1] - c.O[1], tanB[0] - c.O[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const n = Math.max(3, Math.ceil(Math.abs(da) * r / 0.4));
    for (let s = 1; s < n; s++) {
      const a = a0 + (da * s) / n;
      out.push([c.O[0] + Math.cos(a) * r, c.O[1] + Math.sin(a) * r]);
    }
  } else {
    const kk = k / Math.sin(c.half);
    out.push([c.C[0] + c.bis[0] * kk, c.C[1] + c.bis[1] * kk]);
  }
  if (dist(tanB, endB) > 0.05) out.push(tanB);
  out.push(endB);
  return out;
}

export function junctionPoly(J, k) {
  const out = [];
  for (let ci = 0; ci < J.corners.length; ci++) {
    const c = J.corners[ci];
    const A = J.arms[c.i];
    const mA = [A.d[1], -A.d[0]];
    out.push([J.x + A.d[0] * A.s + mA[0] * (A.hw + k), J.y + A.d[1] * A.s + mA[1] * (A.hw + k)]);
    for (const p of cornerCurve(J, ci, k)) out.push(p);
  }
  return out;
}

/** nearest point on the network: {edgeId, x, y, t (0..1 along edge a→b), dist, seg} */
export function nearestOnNetwork(D, x, y, filter, maxR = 4096) {
  let best = null;
  const tryEdge = (e, i) => {
    if (filter && !filter(e)) return;
    const a = e.points[i], b = e.points[i + 1];
    const r = nearestOnSeg(x, y, a[0], a[1], b[0], b[1]);
    if (!best || r.d < best.dist) best = { edgeId: e.id, x: r.x, y: r.y, dist: r.d, seg: i, u: r.t, e };
  };
  const cx = Math.floor(x / D.CELL), cy = Math.floor(y / D.CELL);
  for (let ring = 0; ring * D.CELL < maxR + D.CELL; ring++) {
    for (let gx = cx - ring; gx <= cx + ring; gx++) for (let gy = cy - ring; gy <= cy + ring; gy++) {
      if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
      const l = D.grid.get(gx + ',' + gy);
      if (l) for (const [e, i] of l) tryEdge(e, i);
    }
    if (best && best.dist < ring * D.CELL) break;
    if (ring > 70 && !best) break;
  }
  if (!best) return null;
  const e = best.e;
  let s = 0;
  for (let i = 0; i < best.seg; i++) s += dist(e.points[i], e.points[i + 1]);
  s += dist(e.points[best.seg], e.points[best.seg + 1]) * best.u;
  const total = e.length || 1;
  return { edgeId: e.id, x: best.x, y: best.y, t: Math.max(0, Math.min(1, s / total)), dist: best.dist, seg: best.seg, s };
}
