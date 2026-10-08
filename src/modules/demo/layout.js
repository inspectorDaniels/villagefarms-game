// Pure valley layout: road plan, farm/village/neighbour sites, field blocks. No DOM, no ctx.
// Inputs: a terrain query facade T (isWater, heightAt, findDry; all optional) and a seeded rng.
// Everything is deterministic for a given terrain + rng stream.

export const PARCEL_NAMES = ['Kerkakker', 'Heiveld', 'Bergske', 'Meersen', 'Hoge Kouter', 'Beekkant', 'Grote Kouter',
  'Vijverstuk', 'Broekweide', 'Molenveld', 'Suikerkouter', 'Kapelleveld', 'Zavelberg', 'Blokske', 'Leemputten',
  'Galgenveld', 'Rootput', 'Hazelaar', 'Steenakker', 'Veldeken', 'Paardenwei', 'Nieuwland', 'Kalvermeers',
  'Boomgaardveld', 'Dries', 'Hoogveld', 'Laag Veld', 'Schuurveld', 'Wijngaard', 'Hofstuk', 'Tiendeveld',
  'Pastorijveld', 'Ganzenweide', 'Zandberg', 'Dennenveld', 'Koeweide', 'Kasteelveld', 'Rozenveld'];

const ROAD_HALF = { regional: 3.5, village: 3, lane: 1.75, track: 1.5 };

export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}
export function centroid(p) {
  let x = 0, y = 0;
  for (const q of p) { x += q[0]; y += q[1]; }
  return [x / p.length, y / p.length];
}
export function inPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
export const rect = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];

/** point + unit tangent at arc length s along a polyline */
export function along(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    if (acc + L >= s || i === pts.length - 1) {
      const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, tx: L > 0 ? (bx - ax) / L : 1, ty: L > 0 ? (by - ay) / L : 0 };
    }
    acc += L;
  }
  const p = pts[pts.length - 1];
  return { x: p[0], y: p[1], tx: 1, ty: 0 };
}
export function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

/**
 * Plans the valley. Returns
 * { plan:{nodes,edges}, chains:[{cls, pts, name}], sites:{farm, yard, field, village, cross, tJunction, farms:[..], depot, bridge},
 *   blocks:[{poly, area}], spare:[poly], zones:[...] }
 */
export function planValley(T, bounds, rng) {
  const W = bounds.w, H = bounds.h;
  const isWater = (x, y) => !!(T && T.isWater && T.isWater(x, y));
  const dry = (x, y, r = 90) => {
    if (!isWater(x, y)) return { x, y };
    const p = T && T.findDry ? T.findDry(x, y, r) : null;
    return p || { x, y };
  };
  const sx = W / 1024, sy = H / 1024; // design coordinates are for the 1024 m map
  const S = (x, y) => [x * sx, y * sy];

  // ---------------------------------------------------------------- regional road
  const yRoadDesign = (x) => 518 - 0.044 * x + 8 * Math.sin(x / 160);
  const yRoad = (x) => yRoadDesign(x / sx) * sy;
  const regCtl = [];
  for (let x = 2; x <= 1022; x += 85) regCtl.push(S(x, yRoadDesign(x)));
  regCtl.push(S(1022, yRoadDesign(1022)));

  // ---------------------------------------------------------------- sites (design anchors, nudged dry)
  const farmC = dry(...S(230, 598));
  const yard = rect(farmC.x, farmC.y, 84, 72);
  const yardTop = farmC.y - 36, yardBot = farmC.y + 36;
  // the land south of the yard (r3): a small first field (24 × 104 m = 0.25 ha, r3 addendum) straight below the yard's drive-out,
  // a larger neighbouring field east of the farm track (the "second field" to rent) and a narrow strip west
  const R4 = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const fieldBig = R4(farmC.x - 55, farmC.x + 95, yardBot + 12, yardBot + 182);
  const field = R4(farmC.x - 14, farmC.x + 10, yardBot + 12, yardBot + 116); // 24 × 104 m = 0.25 ha: 8 passes of the 3 m plough
  const fieldEast = R4(farmC.x + 27, farmC.x + 92, yardBot + 12, yardBot + 172);
  const fieldWest = R4(farmC.x - 52, farmC.x - 25, yardBot + 12, yardBot + 172);
  const cross = dry(...S(800, 405));
  const tJ = { x: cross.x, y: yRoad(cross.x) };
  const village = { x0: cross.x - 110, y0: cross.y - 95, x1: cross.x + 112, y1: tJ.y + 4 };
  const farmSites = [
    { key: 'A', client: 0, ...dry(...S(110, 436)), lane: 'reg' },
    { key: 'B', client: 1, ...dry(...S(740, 606)), lane: 'reg' },
    { key: 'C', client: 2, ...dry(...S(645, 262)), lane: 'village' },
  ];
  const depot = { ...dry(...S(962, 512)) };

  // ---------------------------------------------------------------- field grid (vertex lattice)
  const colX = [14, 170, 330, 490, 650, 810, 1010].map((x) => x * sx);
  const NR = 3, SR = 4;
  const Vt = colX.map((x, i) => {
    const col = [];
    const edge = i === 0 || i === colX.length - 1;
    const jx = edge ? 0 : rng.range(-10, 10);
    const yr = yRoad(x + jx);
    for (let j = 0; j <= NR; j++) {
      const y = 14 + ((yr - 14 - 13) * j) / NR;
      col.push([x + jx + (j === 0 || edge ? 0 : rng.range(-4, 4)), y + (j === 0 || j === NR ? 0 : rng.range(-8, 8))]);
    }
    for (let j = 0; j <= SR; j++) {
      const y = yr + 13 + ((H - 14 - yr - 13) * j) / SR;
      col.push([x + jx + (j === SR || edge ? 0 : rng.range(-4, 4)), y + (j === 0 || j === SR ? 0 : rng.range(-8, 8))]);
    }
    return col;
  });
  // ---------------------------------------------------------------- road chains
  const chains = [];
  // regional: insert junction x's as control points so nodes land exactly on the road
  const trackCols = [[1, 'S'], [4, 'S'], [5, 'S'], [1, 'N'], [4, 'N'], [2, 'N']];
  const junctionXs = [farmC.x, tJ.x, farmSites[0].x, farmSites[1].x, depot.x, ...new Set(trackCols.map(([i, b]) => Vt[i][b === 'S' ? NR + 1 : NR][0]))];
  const reg = regCtl.slice();
  const snapX = (x) => { for (const q of reg) if (q.node && Math.abs(q[0] - x) < 25) return q[0]; return null; };
  for (const jx0 of junctionXs) {
    if (snapX(jx0) != null) continue; // an existing junction is close: tracks share it
    const jx = jx0;
    const p = [jx, yRoad(jx)];
    let k = reg.findIndex((q) => q[0] > jx);
    if (k < 0) k = reg.length - 1;
    // replace a plain control point that sits too close to the junction
    if (Math.abs(reg[k][0] - jx) < 20 && k !== reg.length - 1 && !reg[k].node) reg.splice(k, 1, p);
    else if (k > 0 && Math.abs(reg[k - 1][0] - jx) < 20 && k - 1 !== 0 && !reg[k - 1].node) reg.splice(k - 1, 1, p);
    else reg.splice(k, 0, p);
    p.node = true;
  }
  chains.push({ cls: 'regional', pts: reg, bridges: true, name: 'regional' });
  // village streets
  const west = dry(cross.x - 88, cross.y + 3), east = dry(cross.x + 92, cross.y - 4);
  const north = dry(cross.x + 3, cross.y - 78), ne = dry(east.x + 2, cross.y - 72);
  const V = (p) => [p.x, p.y];
  chains.push({ cls: 'village', pts: [[tJ.x, tJ.y], [cross.x + 1, (tJ.y + cross.y) / 2], V(cross)], name: 'main' });
  chains.push({ cls: 'village', pts: [V(cross), V(west)], name: 'west' });
  chains.push({ cls: 'village', pts: [V(cross), V(east)], name: 'east' });
  chains.push({ cls: 'village', pts: [V(cross), V(north)], name: 'north' });
  chains.push({ cls: 'village', pts: [V(east), V(ne)], name: 'ne' });
  chains.push({ cls: 'village', pts: [V(north), V(ne)], name: 'loop' });
  // gravel lanes: farm, neighbours, depot
  chains.push({ cls: 'lane', pts: [[farmC.x, yRoad(farmC.x)], [farmC.x, yardTop + 2]], name: 'farmlane' });
  const fA = farmSites[0], fB = farmSites[1], fC = farmSites[2];
  chains.push({ cls: 'lane', pts: [[fA.x, yRoad(fA.x)], [fA.x, fA.y + 26]], name: 'laneA' });
  chains.push({ cls: 'lane', pts: [[fB.x, yRoad(fB.x)], [fB.x, fB.y - 26]], name: 'laneB' });
  chains.push({ cls: 'lane', pts: [V(west), [fC.x + 5, (west.y + fC.y) / 2 + 20], [fC.x, fC.y + 26]], name: 'laneC' });
  chains.push({ cls: 'lane', pts: [[depot.x, yRoad(depot.x)], [depot.x, yRoad(depot.x) + 14]], name: 'depot' });
  // farm track: from the yard's south gate along the east side of the rented field
  chains.push({ cls: 'track', pts: [[farmC.x + 34, yardBot - 2], [farmC.x + 20, yardBot + 14], [farmC.x + 20, yardBot + 176]], name: 'fieldtrack' });

  // tracks along some column lines (south band and north band), truncated at water / reserved zones
  const zones = [
    { kind: 'rect', x0: village.x0, y0: village.y0, x1: village.x1, y1: village.y1, name: 'village' },
    { kind: 'poly', poly: yard, pad: 8, name: 'yard' },
    { kind: 'poly', poly: fieldBig, pad: 6, name: 'field' },
    ...farmSites.map((f) => ({ kind: 'circle', x: f.x, y: f.y, r: 46, name: 'farm' + f.key })),
    { kind: 'circle', x: depot.x, y: depot.y, r: 34, name: 'depot' },
  ];
  const inZone = (x, y, pad = 0) => zones.some((z) => (z.kind === 'rect' ? x > z.x0 - pad && x < z.x1 + pad && y > z.y0 - pad && y < z.y1 + pad
    : z.kind === 'circle' ? Math.hypot(x - z.x, y - z.y) < z.r + pad
      : inPoly(z.poly, x, y) || (pad + (z.pad || 0) > 0 && z.poly.some((q, k) => { const r = z.poly[(k + 1) % z.poly.length]; return segDist(x, y, q[0], q[1], r[0], r[1]) < pad + (z.pad || 0); }))));
  const segClear = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= L; s += 4) { const x = a[0] + ((b[0] - a[0]) * s) / L, y = a[1] + ((b[1] - a[1]) * s) / L; if (isWater(x, y) || inZone(x, y, 4)) return false; }
    return true;
  };
  for (const [i, band] of trackCols) {
    const col = Vt[i];
    const idx = band === 'S' ? [NR + 1, NR + 2, NR + 3, NR + 4, NR + 5] : [NR, NR - 1, NR - 2, NR - 3];
    const sx0 = snapX(col[band === 'S' ? NR + 1 : NR][0]);
    if (sx0 == null) continue;
    const start = [sx0, yRoad(sx0)];
    const pts = [start];
    for (const k of idx) {
      const p = col[k];
      const q = [p[0], band === 'S' ? Math.min(p[1], H - 22) : Math.max(p[1], 22)];
      if (!segClear(pts[pts.length - 1], q)) break;
      pts.push(q);
    }
    if (pts.length >= 3) chains.push({ cls: 'track', pts, name: `track${i}${band}` });
  }

  // ---------------------------------------------------------------- road plan (nodes/edges, bridges)
  const nodes = [], edges = [];
  const nodeKey = new Map();
  const N = (p) => {
    const k = Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
    if (nodeKey.has(k)) return nodeKey.get(k);
    nodes.push([+p[0].toFixed(2), +p[1].toFixed(2)]);
    nodeKey.set(k, nodes.length - 1);
    return nodes.length - 1;
  };
  let bridge = null;
  for (const ch of chains) {
    // node positions: ends + flagged control points + other chains' endpoints lying on this chain
    const pts = ch.pts;
    const isNode = pts.map((p, k) => k === 0 || k === pts.length - 1 || !!p.node || ch.cls !== 'regional');
    if (!ch.bridges) {
      for (let k = 1; k < pts.length; k++) edges.push([N(pts[k - 1]), N(pts[k]), ch.cls, []]);
      continue;
    }
    // dense scan for water runs → bridge nodes 7 m either side
    const dense = [];
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const L = Math.hypot(bx - ax, by - ay);
      for (let s = 0; s < L; s += 1) dense.push({ x: ax + ((bx - ax) * s) / L, y: ay + ((by - ay) * s) / L, seg: k });
    }
    const runs = [];
    let r0 = -1;
    dense.forEach((d, i) => {
      const w = isWater(d.x, d.y);
      if (w && r0 < 0) r0 = i;
      if (!w && r0 >= 0) { runs.push([r0, i - 1]); r0 = -1; }
    });
    // merge runs closer than 25 m
    const merged = [];
    for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < 25) last[1] = r[1]; else merged.push(r.slice()); }
    // build the ordered list of stops along the chain: control points + bridge ends
    const stops = [];
    pts.forEach((p, k) => { stops.push({ p, node: isNode[k], i: k === 0 ? 0 : dense.findIndex((d) => d.seg === k + 1) }); });
    stops[stops.length - 1].i = dense.length;
    for (let k = 1; k < stops.length - 1; k++) if (stops[k].i < 0) stops[k].i = dense.length - 1;
    const bridgeEnds = [];
    for (const [a, b] of merged) {
      const ia = Math.max(0, a - 7), ib = Math.min(dense.length - 1, b + 7);
      bridgeEnds.push({ ia, ib });
    }
    const all = stops.map((s) => ({ ...s }));
    for (const be of bridgeEnds) {
      all.push({ p: [dense[be.ia].x, dense[be.ia].y], node: true, i: be.ia, bridgeStart: true });
      all.push({ p: [dense[be.ib].x, dense[be.ib].y], node: true, i: be.ib, bridgeEnd: true });
    }
    all.sort((u, v) => u.i - v.i);
    // drop plain control points inside a bridge span or within 6 m of a bridge end
    const inSpan = (i) => bridgeEnds.some((be) => i > be.ia - 6 && i < be.ib + 6);
    const seq = all.filter((s) => s.bridgeStart || s.bridgeEnd || s.i === 0 || s.i === dense.length || !inSpan(s.i));
    let prev = seq[0], via = [], onBridge = false;
    for (let k = 1; k < seq.length; k++) {
      const s = seq[k];
      if (!s.node) { via.push(s.p); continue; }
      const opts = onBridge ? { bridge: true } : undefined;
      edges.push(opts ? [N(prev.p), N(s.p), ch.cls, via, opts] : [N(prev.p), N(s.p), ch.cls, via]);
      if (onBridge && !bridge) bridge = { x: (prev.p[0] + s.p[0]) / 2, y: (prev.p[1] + s.p[1]) / 2 };
      onBridge = !!s.bridgeStart;
      prev = s; via = [];
    }
  }

  // ---------------------------------------------------------------- blocks → candidate fields
  const segs = [];
  for (const ch of chains) for (let k = 1; k < ch.pts.length; k++) segs.push([ch.pts[k - 1], ch.pts[k], ROAD_HALF[ch.cls] || 2]);
  const nearRoad = (x, y) => segs.some(([a, b, hw]) => segDist(x, y, a[0], a[1], b[0], b[1]) < hw + 3);
  const inset = (q, d) => {
    const [cx, cy] = centroid(q);
    return q.map(([x, y]) => [x + Math.sign(cx - x) * d, y + Math.sign(cy - y) * d]);
  };
  const valid = (poly) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x0 < 8 || y0 < 8 || x1 > W - 8 || y1 > H - 8) return false;
    for (let y = y0; y <= y1 + 0.01; y += 6) {
      for (let x = x0; x <= x1 + 0.01; x += 6) {
        if (!inPoly(poly, x, y) && !(x === x0 || y === y0)) continue;
        if (!inPoly(poly, x, y)) continue;
        if (isWater(x, y) || nearRoad(x, y) || inZone(x, y, 5)) return false;
        // keep fields off the water margin (banks)
        if (isWater(x + 8, y) || isWater(x - 8, y) || isWater(x, y + 8) || isWater(x, y - 8)) return false;
      }
    }
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += 5) { const x = a[0] + ((b[0] - a[0]) * s) / L, y = a[1] + ((b[1] - a[1]) * s) / L; if (isWater(x, y) || nearRoad(x, y) || inZone(x, y, 5)) return false; }
    }
    return true;
  };
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const blocks = [], spare = [];
  const rowPairs = [];
  for (let j = 0; j < NR; j++) rowPairs.push([j, j + 1]);
  for (let j = 0; j < SR; j++) rowPairs.push([NR + 1 + j, NR + 2 + j]);
  for (let i = 0; i < colX.length - 1; i++) {
    for (const [ja, jb] of rowPairs) {
      const q = [Vt[i][ja], Vt[i + 1][ja], Vt[i + 1][jb], Vt[i][jb]];
      const full = inset(q, 5);
      if (valid(full)) { blocks.push({ poly: full, area: polyArea(full), i, j: ja }); continue; }
      // halves: west / east / north / south, keep the largest valid one (≥ 1 ha)
      const halves = [
        [q[0], lerp2(q[0], q[1], 0.5), lerp2(q[3], q[2], 0.5), q[3]],
        [lerp2(q[0], q[1], 0.5), q[1], q[2], lerp2(q[3], q[2], 0.5)],
        [q[0], q[1], lerp2(q[1], q[2], 0.5), lerp2(q[0], q[3], 0.5)],
        [lerp2(q[0], q[3], 0.5), lerp2(q[1], q[2], 0.5), q[2], q[3]],
      ].map((h) => inset(h, 5));
      const ok = halves.map((h) => (valid(h) ? { poly: h, area: polyArea(h), i, j: ja, half: true } : null));
      // both halves of a split (W+E or N+S) when valid: two fields; else the largest half; else quarters
      const pairs = [[0, 1], [2, 3]].filter(([a, b]) => ok[a] && ok[b] && ok[a].area >= 6000 && ok[b].area >= 6000);
      if (pairs.length) { for (const k of pairs[0]) blocks.push(ok[k]); continue; }
      const best = ok.filter((b) => b && b.area >= 6000).sort((u, v) => v.area - u.area)[0];
      if (best) {
        blocks.push(best);
        // the other half may still hold a quarter-size field
        const k = ok.indexOf(best), other = halves[k ^ 1];
        const oq = k < 2 ? [other[0], other[1], lerp2(other[1], other[2], 0.5), lerp2(other[0], other[3], 0.5)] : [other[0], lerp2(other[0], other[1], 0.5), lerp2(other[3], other[2], 0.5), other[3]];
        const oq2 = k < 2 ? [lerp2(other[0], other[3], 0.5), lerp2(other[1], other[2], 0.5), other[2], other[3]] : [lerp2(other[0], other[1], 0.5), other[1], other[2], lerp2(other[3], other[2], 0.5)];
        for (const qq of [oq, oq2]) { const a = polyArea(qq); if (a >= 4500 && valid(qq)) { blocks.push({ poly: qq, area: a, i, j: ja, quarter: true }); break; } }
        continue;
      }
      let nq = 0;
      const mid = [lerp2(q[0], q[2], 0.5)];
      for (let c = 0; c < 4; c++) {
        const a0 = q[c], a1 = lerp2(q[c], q[(c + 1) % 4], 0.5), a3 = lerp2(q[c], q[(c + 3) % 4], 0.5);
        const qq = inset([a0, a1, mid[0], a3], 4);
        const a = polyArea(qq);
        if (a >= 4500 && valid(qq)) { blocks.push({ poly: qq, area: a, i, j: ja, quarter: true }); nq++; }
      }
      if (!nq) spare.push(full);
    }
  }

  return {
    plan: { nodes, edges }, chains, blocks, spare, zones,
    sites: { farm: farmC, yard, field, fieldEast, fieldWest, fieldBig, yardTop, yardBot, village, cross, tJ, west, east, north, ne, farms: farmSites, depot, bridge },
    yRoad,
  };
}
