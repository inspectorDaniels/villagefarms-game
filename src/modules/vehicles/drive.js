// vehicles — driving physics (kinematic bicycle), hitch articulation, collisions, work, fuel & wear.
// Everything here runs inside the fixed 60 Hz update: deterministic, no DOM.
import { ALL, TYPES, SURFACE_FACTOR, WADE, FUEL_TIME, WEAR_PER_HOUR } from './types.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
export const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };

/** local (lx right, ly rearwards) → world for a pose */
export function toWorld(x, y, rot, lx, ly) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + lx * c - ly * s, y + lx * s + ly * c];
}
export function corners(x, y, rot, w, l) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hl = l / 2;
  return [
    [x - hw * c + hl * s, y - hw * s - hl * c], [x + hw * c + hl * s, y + hw * s - hl * c],
    [x + hw * c - hl * s, y + hw * s + hl * c], [x - hw * c - hl * s, y - hw * s + hl * c],
  ];
}
function aabbOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
function projRange(pts, ax, ay) {
  let a = Infinity, b = -Infinity;
  for (const p of pts) { const d = p[0] * ax + p[1] * ay; if (d < a) a = d; if (d > b) b = d; }
  return [a, b];
}
/** SAT: convex polygon vs convex polygon */
export function polysOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      const ax = -(q[1] - p[1]), ay = q[0] - p[0];
      const ra = projRange(A, ax, ay), rb = projRange(B, ax, ay);
      if (ra[1] <= rb[0] || rb[1] <= ra[0]) return false;
    }
  }
  return true;
}
function polyCircle(P, cx, cy, r) {
  // inside test + edge distance
  let inside = true;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    if (ex * (cy - p[1]) - ey * (cx - p[0]) < 0) inside = false;
    const t = clamp(((cx - p[0]) * ex + (cy - p[1]) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = p[0] + ex * t - cx, dy = p[1] + ey * t - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  if (inside) return true;
  // winding may be the other way round
  let inside2 = true;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    if ((q[0] - p[0]) * (cy - p[1]) - (q[1] - p[1]) * (cx - p[0]) > 0) inside2 = false;
  }
  return inside2;
}
/** distance from a point to an oriented box (0 inside) */
export function distToBox(px, py, x, y, rot, w, l) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = px - x, dy = py - y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const ox = Math.max(0, Math.abs(lx) - w / 2), oy = Math.max(0, Math.abs(ly) - l / 2);
  return Math.hypot(ox, oy);
}

export function createDriver(env) {
  // env: { ctx, W (world.vehicles), mod(id), byId(id), spec(v), onWork(v, imp, info), fx(v, info) }
  const { ctx, mod } = env;
  const S = { stepN: 0 };

  // ---------------------------------------------------------------- surface
  function surfaceAt(x, y) {
    const roads = mod('roads');
    const rc = roads && roads.roadAt ? roads.roadAt(x, y) : null;
    if (rc) return rc === 'track' ? 'track' : rc === 'lane' ? 'lane' : 'road';
    const terr = mod('terrain');
    const s = terr && terr.surfaceAt ? terr.surfaceAt(x, y) : null;
    return s || 'grass';
  }
  function waterDepth(x, y) {
    const roads = mod('roads');
    if (roads && roads.roadAt && roads.roadAt(x, y)) return 0; // bridges / fords on the road
    const terr = mod('terrain');
    const d = terr && terr.waterDepthAt ? terr.waterDepthAt(x, y) : 0;
    return Number.isFinite(d) ? d : 0;
  }
  function surfaceFactor(v, T, surf) {
    const tab = SURFACE_FACTOR[T.kind] || SURFACE_FACTOR.tractor;
    let f = tab[surf];
    if (f == null) f = tab.grass;
    if (surf === 'road' || surf === 'lane') return f;
    // 4WD and flotation tyres help in soft going
    const soft = 1 - f;
    let help = (T.fourWD ? 0.3 : 0) + (v.upgrades && v.upgrades.tyres ? 0.3 : 0);
    const env = ctx.world.environment || {};
    const wet = env.weather && Number.isFinite(env.weather.wetness) ? env.weather.wetness : 0;
    const wetPenalty = (surf === 'soil' || surf === 'ploughed' || surf === 'mud' || surf === 'track' || surf === 'farmyard') ? 0.25 * wet : 0.08 * wet;
    return clamp(1 - soft * (1 - Math.min(0.55, help)) - wetPenalty * (1 - help), 0.08, 1);
  }

  // ---------------------------------------------------------------- rig geometry
  function rigParts(v) {
    const out = [];
    for (const id of v.attached || []) { const imp = env.byId(id); if (imp) out.push(imp); }
    return out;
  }
  /** pose of an attached implement given the parent's pose. For trailed, uses the implement's current axle. */
  function implementPose(parent, P, imp, px, py, prot) {
    const I = ALL[imp.type];
    if (I.mount === 'front') {
      const [hx, hy] = toWorld(px, py, prot, 0, P.hitchF != null ? P.hitchF : -P.len / 2);
      const [cx, cy] = toWorld(hx, hy, prot, 0, -I.hitch);
      return { x: cx, y: cy, rot: prot };
    }
    const [hx, hy] = toWorld(px, py, prot, 0, P.hitchR != null ? P.hitchR : P.len / 2);
    if (I.mount === 'rear') {
      const [cx, cy] = toWorld(hx, hy, prot, 0, I.hitch);
      return { x: cx, y: cy, rot: prot };
    }
    // trailed: axle A follows the hitch at fixed tongue length
    const [ax0, ay0] = toWorld(imp.x, imp.y, imp.rot, 0, I.axleY);
    let dx = hx - ax0, dy = hy - ay0;
    let d = Math.hypot(dx, dy) || 1;
    let rot = Math.atan2(dx / d, -dy / d);
    // clamp articulation (jack-knife) to ±78°
    const rel = wrapAngle(rot - prot);
    const lim = 1.36;
    if (Math.abs(rel) > lim) rot = prot + Math.sign(rel) * lim;
    const fx = Math.sin(rot), fy = -Math.cos(rot);
    const ax = hx - fx * I.tongue, ay = hy - fy * I.tongue;
    return { x: ax + fx * I.axleY, y: ay + fy * I.axleY, rot };
  }
  function hitchPoint(v, front) {
    const T = ALL[v.type];
    return toWorld(v.x, v.y, v.rot, 0, front ? (T.hitchF != null ? T.hitchF : -T.len / 2) : (T.hitchR != null ? T.hitchR : T.len / 2));
  }
  /** the implement's own hitch point (where it couples) */
  function implementHitch(imp) {
    const I = ALL[imp.type];
    if (I.mount === 'front') return toWorld(imp.x, imp.y, imp.rot, 0, I.hitch);
    if (I.mount === 'rear') return toWorld(imp.x, imp.y, imp.rot, 0, -I.hitch);
    return toWorld(imp.x, imp.y, imp.rot, 0, I.axleY - I.tongue);
  }
  /** collision boxes of a single unit at a pose: [[corners]] */
  function boxesAt(v, x, y, rot) {
    const T = ALL[v.type];
    const out = [corners(x, y, rot, T.wid, T.len)];
    if (T.header) {
      const [hx, hy] = toWorld(x, y, rot, 0, -T.len / 2 - T.header.depth / 2 + 0.1);
      out.push(corners(hx, hy, rot, T.header.width, T.header.depth));
    }
    if (T.work && T.work.width > T.wid && v.lowered && T.look === 'sprayer') {
      // unfolded booms are high and flexible: not solid
    }
    if (T.mount === 'trailed') {
      // drawbar is thin; body only
    }
    return out;
  }

  // ---------------------------------------------------------------- collisions
  function hitsSolid(boxes, ignore) {
    for (const P of boxes) {
      const bb = aabbOf(P);
      const hits = ctx.spatial.queryRect(bb[0], bb[1], bb[2], bb[3], (it) => it.solid && !ignore.has(it.id));
      for (const it of hits) {
        if (it.data && it.data.poly) { if (polysOverlap(P, it.data.poly)) return it; continue; }
        if (it.data && Array.isArray(it.data.polys)) { for (const q of it.data.polys) if (polysOverlap(P, q)) return it; continue; }
        if (it.x0 != null) {
          const R = [[it.x0, it.y0], [it.x1, it.y0], [it.x1, it.y1], [it.x0, it.y1]];
          if (polysOverlap(P, R)) return it;
        } else if (polyCircle(P, it.x, it.y, it.r || 0.5)) return it;
      }
    }
    return null;
  }
  function outOfBounds(boxes) {
    const b = ctx.world.bounds || { w: 1024, h: 1024 };
    for (const P of boxes) for (const p of P) if (p[0] < 0.5 || p[1] < 0.5 || p[0] > b.w - 0.5 || p[1] > b.h - 0.5) return true;
    return false;
  }
  /** can this whole rig stand at the given pose? returns {ok, hit, water} */
  function rigFits(v, x, y, rot, dirSign) {
    const T = ALL[v.type];
    const ignore = new Set([v.id, ...(v.attached || [])]);
    const boxes = boxesAt(v, x, y, rot);
    const poses = [];
    for (const imp of rigParts(v)) {
      const p = implementPose(v, T, imp, x, y, rot);
      poses.push([imp, p]);
      for (const b of boxesAt(imp, p.x, p.y, p.rot)) boxes.push(b);
    }
    if (outOfBounds(boxes)) return { ok: false, bounds: true, poses };
    // deep water probe at the leading edge (and the body centre)
    const lead = toWorld(x, y, rot, 0, dirSign >= 0 ? -T.len / 2 - (T.header ? T.header.depth * 0.6 : 0) : T.len / 2);
    const wade = WADE[T.kind] || 0.5;
    const d1 = waterDepth(lead[0], lead[1]);
    if (d1 > wade) return { ok: false, water: d1, poses };
    const hit = hitsSolid(boxes, ignore);
    if (hit) return { ok: false, hit, poses };
    return { ok: true, poses };
  }

  // ---------------------------------------------------------------- per-step drive
  function effectiveHp(v, T) { return (T.hp || 100) * (v.upgrades && v.upgrades.engine ? 1.2 : 1) * (1 - 0.15 * (v.wear || 0)); }

  function step(v, dt) {
    const T = TYPES[v.type];
    if (!T) return;
    S.stepN++;
    const c = v.ctl || {};
    const fresh = v.driverId && (v.ctlHold || (env.stepCount() - (v.ctlStep || -99)) <= 3);
    let thr = fresh ? clamp(+c.throttle || 0, 0, 1) : 0;
    let brk = fresh ? clamp(+c.brake || 0, 0, 1) : (v.driverId ? 0 : 1);
    let str = fresh ? clamp(+c.steer || 0, -1, 1) : 0;
    const running = !!v.driverId && v.fuel > 0;
    v.engine = running;
    if (!running) thr = 0;

    // ---- surface (sampled every few steps or after moving)
    if (v._sx == null || Math.abs(v.x - v._sx) + Math.abs(v.y - v._sy) > 0.7 || (S.stepN % 12) === 0) {
      v.surface = surfaceAt(v.x, v.y);
      v._sx = v.x; v._sy = v.y;
    }
    const surf = v.surface || 'grass';
    const hp = effectiveHp(v, T);
    const parts = rigParts(v);
    let towMass = 0, draft = 0, workCap = Infinity;
    for (const imp of parts) {
      const I = ALL[imp.type];
      towMass += (I.mass || 0) + (imp.cargo ? imp.cargo.kg || 0 : 0);
      if (imp.lowered && I.work) {
        const pr = clamp(hp / I.work.needHp, 0.35, 1.25);
        workCap = Math.min(workCap, I.work.speed * Math.min(1, pr));
        draft += Math.min(1, I.work.needHp / hp);
      }
    }
    if (T.header && v.lowered) {
      workCap = Math.min(workCap, T.workSpeed);
      draft += 0.55;
    }
    const massF = T.mass / (T.mass + towMass * (surf === 'road' ? 0.35 : 0.7));
    const wearF = 1 - 0.2 * (v.wear || 0);
    const sf = surfaceFactor(v, T, surf);
    const powerF = Math.min(1.15, hp / (T.hp || hp));
    let cap = Math.min(T.vmax * sf * wearF * (0.85 + 0.15 * powerF), workCap);
    // heavy trailers slow you uphill-ish: modest top speed penalty with load
    cap *= 1 - 0.25 * (1 - massF);
    const capRev = Math.min(T.vrev * Math.max(0.4, sf), cap);
    v.cap = cap;
    const accel = T.accel * massF * powerF * (0.6 + 0.4 * sf);

    // ---- longitudinal
    let sp = v.speed || 0;
    const coast = T.roll + (1 - sf) * 2.5;
    if (sp > 0.05) {
      if (brk > 0) sp = Math.max(0, sp - T.brake * brk * dt);
      else if (thr > 0 && sp < cap * thr) sp = Math.min(cap * thr, sp + accel * thr * dt);
      else sp = Math.max(thr > 0 ? cap * thr : 0, sp - (sp > cap ? 3.5 + coast : coast) * dt);
    } else if (sp < -0.05) {
      if (thr > 0) sp = Math.min(0, sp + T.brake * thr * dt);
      else if (brk > 0 && sp > -capRev) sp = Math.max(-capRev, sp - accel * 0.7 * brk * dt);
      else sp = Math.min(brk > 0 ? -capRev : 0, sp + (sp < -capRev ? 3.5 + coast : coast) * dt);
    } else {
      if (thr > 0) sp = accel * thr * dt;
      else if (brk > 0 && running) sp = -accel * 0.7 * brk * dt;
      else sp = 0;
    }

    // ---- steering (rate limited, less lock at speed); GPS auto-steer while working
    let target = str * T.maxSteer * (1 - 0.55 * clamp(Math.abs(sp) / T.vmax, 0, 1));
    const working = parts.some((p) => p.lowered) || (T.header && v.lowered);
    if (v.upgrades && v.upgrades.gps && working && Math.abs(str) < 0.05 && Math.abs(sp) > 0.3) {
      if (!v.gpsLine) v.gpsLine = { x: v.x, y: v.y, rot: Math.round(v.rot / (Math.PI / 180)) * (Math.PI / 180) };
      const L = v.gpsLine;
      const rx = Math.cos(L.rot), ry = Math.sin(L.rot);
      const xte = (v.x - L.x) * rx + (v.y - L.y) * ry;          // + = right of line
      const he = wrapAngle(v.rot - L.rot);
      target = clamp(-(he * 1.6 + xte * 0.35) * Math.sign(sp || 1), -T.maxSteer * 0.5, T.maxSteer * 0.5);
    } else if (Math.abs(str) >= 0.05) v.gpsLine = null;
    const sr = 1.9 * dt;
    v.steer = (v.steer || 0) + clamp(target - (v.steer || 0), -sr, sr);

    // ---- kinematic bicycle
    const wb = T.ry - T.fy;
    const dist = sp * dt;
    const odo0 = v.odo || 0;
    if (Math.abs(dist) > 1e-6) {
      const nsub = Math.max(1, Math.ceil(Math.abs(dist) / 0.35));
      const dd = dist / nsub;
      for (let k = 0; k < nsub; k++) {
        const dYaw = dd * Math.tan(v.steer) / wb;
        const mid = v.rot + dYaw / 2;
        const nx = v.x + Math.sin(mid) * dd, ny = v.y - Math.cos(mid) * dd;
        const nrot = wrapAngle(v.rot + dYaw);
        const fit = rigFits(v, nx, ny, nrot, Math.sign(sp));
        if (!fit.ok) {
          // impact: wear on hard hits, then stop
          const impact = Math.abs(sp);
          if (fit.hit && impact > 1.5) v.wear = clamp((v.wear || 0) + 0.004 * impact, 0, 1);
          v.blocked = fit.water ? 'water' : fit.hit ? 'solid' : 'bounds';
          v.blockedBy = fit.hit ? fit.hit.id : null;
          if (fit.hit && impact > 2 && env.onImpact) env.onImpact(v, impact);
          sp = 0;
          break;
        }
        v.blocked = null; v.blockedBy = null;
        v.x = nx; v.y = ny; v.rot = nrot;
        for (const [imp, p] of fit.poses) {
          const moved = Math.hypot(p.x - imp.x, p.y - imp.y);
          imp.x = p.x; imp.y = p.y; imp.rot = p.rot;
          imp.speed = sp; imp.odo = (imp.odo || 0) + moved;
        }
        v.odo = (v.odo || 0) + Math.abs(dd);
      }
      env.moved(v);
      for (const imp of parts) env.moved(imp);
    }
    v.speed = sp;

    // ---- fuel & wear
    if (running) {
      const load = clamp(0.08 + 0.5 * thr * (0.4 + 0.6 * Math.min(1, Math.abs(sp) / Math.max(0.5, T.vmax))) * (1.2 - 0.2 * sf) + (working && Math.abs(sp) > 0.2 ? draft * 0.7 : 0) + (1 - massF) * 0.25 * thr, 0, 1);
      v.load = load;
      const lph = (T.burnIdle + (T.burnMax - T.burnIdle) * load) * (1 + 0.25 * (v.wear || 0)) * (v.upgrades && v.upgrades.engine ? 1.08 : 1);
      const used = lph / 3600 * FUEL_TIME * dt;
      v.fuel = Math.max(0, v.fuel - used);
      v.fuelUsed = (v.fuelUsed || 0) + used;
      v.hours = (v.hours || 0) + dt / 3600 * FUEL_TIME;
      v.wear = clamp((v.wear || 0) + WEAR_PER_HOUR * (0.15 + load) / 3600 * dt, 0, 1);
      for (const imp of parts) if (imp.lowered && Math.abs(sp) > 0.2) imp.wear = clamp((imp.wear || 0) + WEAR_PER_HOUR * 1.2 / 3600 * dt, 0, 1);
    } else v.load = 0;

    // ---- work
    const moved = (v.odo || 0) - odo0;
    if (moved > 1e-4 && sp > 0.15) {
      for (const imp of parts) if (imp.lowered && ALL[imp.type].work) env.onWork(v, imp, moved);
      if (T.header && v.lowered) env.onWork(v, v, moved);
    }
    if (env.fx) env.fx(v, parts, surf, sp, thr);
  }

  /** settle an idle rig (after spawn/attach/load) */
  function settle(v) {
    const T = ALL[v.type];
    for (const imp of rigParts(v)) {
      const p = implementPose(v, T, imp, v.x, v.y, v.rot);
      imp.x = p.x; imp.y = p.y; imp.rot = p.rot;
      env.moved(imp);
    }
  }

  return { step, settle, surfaceAt, waterDepth, surfaceFactor, rigFits, boxesAt, implementPose, implementHitch, hitchPoint, hitsSolid, rigParts };
}
