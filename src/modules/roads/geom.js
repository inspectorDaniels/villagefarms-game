// Polyline / geometry helpers for the roads module (pure functions, metres).

export const hyp = Math.hypot;

export function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/** centripetal Catmull-Rom through control points, sampled ~every `step` metres.
 *  Returns { pts, ctrlIdx } where ctrlIdx[k] = index in pts of control point k. */
export function smoothPolyline(ctrl, step = 0.75) {
  const n = ctrl.length;
  if (n < 2) return { pts: ctrl.map((p) => [p[0], p[1]]), ctrlIdx: ctrl.map((_, i) => i) };
  const pts = [[ctrl[0][0], ctrl[0][1]]];
  const ctrlIdx = [0];
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
    // phantom end points: mirror so ends are straight-ish
    const P0 = i === 0 ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : p0;
    const P3 = i + 2 > n - 1 ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : p3;
    const len = dist(p1, p2);
    const segs = Math.max(1, Math.ceil(len / step));
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(1e-4, dist(P0, p1)), 0.5);
    const t2 = t1 + Math.pow(Math.max(1e-4, dist(p1, p2)), 0.5);
    const t3 = t2 + Math.pow(Math.max(1e-4, dist(p2, P3)), 0.5);
    for (let s = 1; s <= segs; s++) {
      const t = t1 + (t2 - t1) * (s / segs);
      const pt = [0, 0];
      for (let k = 0; k < 2; k++) {
        const A1 = (t1 - t) / (t1 - t0) * P0[k] + (t - t0) / (t1 - t0) * p1[k];
        const A2 = (t2 - t) / (t2 - t1) * p1[k] + (t - t1) / (t2 - t1) * p2[k];
        const A3 = (t3 - t) / (t3 - t2) * p2[k] + (t - t2) / (t3 - t2) * P3[k];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        pt[k] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
      }
      if (s === segs) { pt[0] = p2[0]; pt[1] = p2[1]; }
      pts.push(pt);
    }
    ctrlIdx.push(pts.length - 1);
  }
  return { pts, ctrlIdx };
}

export function cumLengths(pts) {
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + dist(pts[i - 1], pts[i]);
  return s;
}

/** unit tangents (averaged) and right-hand normals (screen coords, y down: right of travel dir) */
export function frames(pts) {
  const n = pts.length;
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  return { tx, ty };
}

/** point + tangent at arc length s */
export function sampleAt(pts, cum, s) {
  const n = pts.length;
  if (s <= 0) { const d = norm(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]); return { x: pts[0][0], y: pts[0][1], tx: d[0], ty: d[1], i: 0 }; }
  if (s >= cum[n - 1]) { const d = norm(pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]); return { x: pts[n - 1][0], y: pts[n - 1][1], tx: d[0], ty: d[1], i: n - 2 }; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const a = pts[lo], b = pts[hi];
  const d = norm(b[0] - a[0], b[1] - a[1]);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: d[0], ty: d[1], i: lo };
}

export function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

/** resample a polyline between arc lengths s0..s1 at spacing `step` */
export function resample(pts, cum, s0, s1, step = 0.75) {
  const out = [];
  const L = s1 - s0;
  const n = Math.max(1, Math.ceil(L / step));
  for (let k = 0; k <= n; k++) {
    const p = sampleAt(pts, cum, s0 + (L * k) / n);
    out.push([p.x, p.y]);
  }
  return out;
}

/** offset polyline by per-point distance fn(i) along the right-hand normal (negative = left) */
export function offsetPts(pts, tx, ty, fn) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const d = typeof fn === 'number' ? fn : fn(i);
    out[i] = [pts[i][0] - ty[i] * d, pts[i][1] + tx[i] * d];
  }
  return out;
}

export function nearestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** intersection of lines p + t*d and q + u*e → {t,u} or null if parallel */
export function lineIntersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const wx = q[0] - p[0], wy = q[1] - p[1];
  return { t: (wx * e[1] - wy * e[0]) / den, u: (wx * d[1] - wy * d[0]) / den };
}

export function segIntersect(a, b, c, d) {
  const r = lineIntersect(a, [b[0] - a[0], b[1] - a[1]], c, [d[0] - c[0], d[1] - c[1]]);
  if (!r || r.t < 0 || r.t > 1 || r.u < 0 || r.u > 1) return null;
  return { x: a[0] + (b[0] - a[0]) * r.t, y: a[1] + (b[1] - a[1]) * r.t, t: r.t, u: r.u };
}

export function bboxOf(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export function bboxHit(b, x0, y0, x1, y1) { return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1; }

/** quadratic bezier samples (excluding start, including end) */
export function quadPts(a, c, b, n = 8) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export function pathFrom(g, pts, closed = false) {
  if (!pts.length) return;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (closed) g.closePath();
}
