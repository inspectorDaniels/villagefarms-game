// buildtools — small polygon helpers (metres). Polygons are [[x,y]…], open (last != first).

export const snap = (v, step = 0.5) => Math.round(v / step) * step;

export function polyArea(P) {
  let a = 0;
  for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

export function centroid(P) {
  let x = 0, y = 0;
  for (const p of P) { x += p[0]; y += p[1]; }
  return [x / P.length, y / P.length];
}

export function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

export function pointInPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** proper intersection of segments ab and cd (touching endpoints do not count) */
export function segsCross(a, b, c, d) {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** true when a polyline (closed = polygon) crosses itself */
export function selfIntersects(P, closed = true) {
  const n = P.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = P[i], b = P[(i + 1) % n];
    for (let j = i + 2; j < m; j++) {
      if (closed && i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segsCross(a, b, P[j], P[(j + 1) % n])) return true;
    }
  }
  // repeated vertices make degenerate polygons
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) < 0.25) return true;
  return false;
}

/** polygons overlap (edges cross, or one contains a vertex of the other) */
export function polysOverlap(A, B) {
  const a = bbox(A), b = bbox(B);
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return false;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  }
  // containment tests on slightly inset probes (shared edges must not count as overlap)
  const probe = (P, Q) => {
    const c = centroid(P);
    for (const p of P) {
      const x = p[0] + (c[0] - p[0]) * 0.02, y = p[1] + (c[1] - p[1]) * 0.02;
      if (pointInPoly(Q, x, y)) return true;
    }
    return pointInPoly(Q, c[0], c[1]) && pointInPoly(P, c[0], c[1]);
  };
  return probe(A, B) || probe(B, A);
}

/** points every `step` m along the edges of P (closed or open) */
export function edgeSamples(P, step, closed = true) {
  const out = [];
  const m = closed ? P.length : P.length - 1;
  for (let i = 0; i < m; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) out.push([a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k]);
  }
  if (!closed && P.length) out.push(P[P.length - 1].slice());
  return out;
}

/** grid points inside P with spacing `step` */
export function interiorSamples(P, step) {
  const b = bbox(P), out = [];
  for (let y = b.y0 + step / 2; y < b.y1; y += step) for (let x = b.x0 + step / 2; x < b.x1; x += step) if (pointInPoly(P, x, y)) out.push([x, y]);
  return out;
}

export function polylineLength(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return L;
}

/** distance from point to segment ab */
export function distToSeg(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}
