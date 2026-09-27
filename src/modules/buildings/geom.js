// buildings — geometry helpers (pure).

/** local → world: rot 0 = facing north, clockwise */
export function toWorld(bx, by, rot, lx, ly) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [bx + lx * c - ly * s, by + lx * s + ly * c];
}

/** polygon of one part in world coordinates (grow = margin in m) */
export function partPoly(part, bx, by, brot, grow = 0) {
  const [px, py] = toWorld(bx, by, brot, part.x || 0, part.y || 0);
  const rot = brot + (part.rot || 0);
  if (part.k === 'silo') {
    const r = part.r + grow, n = 16, out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([px + Math.cos(a) * r, py + Math.sin(a) * r]); }
    return out;
  }
  const hw = part.w / 2 + grow, hd = part.d / 2 + grow;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => toWorld(px, py, rot, x, y));
}

export function aabbOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const P of polys) for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

export function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

export function pointInPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** SAT overlap test of two convex polygons */
export function polysOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      const nx = y0 - y1, ny = x1 - x0;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of A) { const d = x * nx + y * ny; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const [x, y] of B) { const d = x * nx + y * ny; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

export function circleHitsPoly(P, x, y, r) {
  if (pointInPoly(P, x, y)) return true;
  const r2 = r * r;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    const ex = xi - xj, ey = yi - yj, L = ex * ex + ey * ey;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / L)) : 0;
    const dx = xj + t * ex - x, dy = yj + t * ey - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** sample points covering a convex polygon (every `step` m + the vertices) */
export function samplePoly(P, step = 1.5) {
  const bb = aabbOf([P]);
  const out = P.map((p) => [p[0], p[1]]);
  for (let y = bb.y0 + step / 2; y < bb.y1; y += step) for (let x = bb.x0 + step / 2; x < bb.x1; x += step) if (pointInPoly(P, x, y)) out.push([x, y]);
  return out;
}

/** stable 0..1 hash of a string */
export function h01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
