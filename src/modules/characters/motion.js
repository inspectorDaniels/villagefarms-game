// Locomotion: surface-dependent speed, deep-water blocking, wading, spatial-hash collisions,
// character separation, facing and walk-cycle phase. Pure functions over a small env object.

export const WALK = 1.4;   // m/s
export const RUN = 3.5;    // m/s
export const RADIUS = 0.28;
const WALK_CYCLE = 1.3;    // metres per full walk cycle (two steps)
const RUN_CYCLE = 2.1;

/** speed multipliers per terrain surface (1 = firm ground) */
export const SURFACE_SPEED = {
  grass: 1, meadow: 0.9, soil: 0.84, ploughed: 0.72, sand: 0.72, gravel: 0.97, rock: 0.9,
  water: 0.3, shallow: 0.48, mud: 0.6, farmyard: 1, forestFloor: 0.88, road: 1.04,
};
/** footstep sound family per surface */
export const STEP_SOUND = {
  grass: 'grass', meadow: 'grass', forestFloor: 'grass', soil: 'mud', ploughed: 'mud', mud: 'mud', shallow: 'mud',
  sand: 'gravel', gravel: 'gravel', rock: 'gravel', farmyard: 'gravel', road: 'asphalt', lane: 'gravel', track: 'grass',
};
/** surfaces that keep footprints */
export const PRINTS = { soil: 1, ploughed: 1, mud: 1, sand: 1 };

const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function createMotion(ctx) {
  const mod = (id) => ctx.modules.get(id);

  /** sample ground info at (x,y): { surf, speed, depth, road, snow } (cached ~0.25 m / 0.2 s per char) */
  function ground(x, y) {
    const terrain = mod('terrain');
    const roads = mod('roads');
    let surf = 'grass', depth = 0, road = null;
    if (terrain) {
      surf = terrain.surfaceAt(x, y) || 'grass';
      depth = terrain.waterDepthAt(x, y) || 0;
    }
    if (roads && roads.roadAt) road = roads.roadAt(x, y) || null;
    const w = ctx.world.environment && ctx.world.environment.weather;
    const snow = w && w.snowCover > 0.3 ? w.snowCover : 0;
    let speed = SURFACE_SPEED[surf] != null ? SURFACE_SPEED[surf] : 1;
    if (road) speed = road === 'track' ? 0.98 : road === 'lane' ? 1.0 : SURFACE_SPEED.road;
    if (snow && surf !== 'water' && surf !== 'shallow') speed *= 1 - 0.22 * snow;
    if (depth > 0.02 && depth <= 0.55) speed = Math.min(speed, 0.62 - depth * 0.5);
    return { surf, speed, depth, road, snow };
  }

  function groundCached(ch, now) {
    const g = ch._g;
    if (g && now - ch._gT < 0.2 && Math.abs(ch.x - ch._gX) < 0.25 && Math.abs(ch.y - ch._gY) < 0.25) return g;
    ch._g = ground(ch.x, ch.y); ch._gT = now; ch._gX = ch.x; ch._gY = ch.y;
    return ch._g;
  }

  function blocked(x, y) {
    const terrain = mod('terrain');
    if (!terrain) return false;
    const d = terrain.waterDepthAt(x, y);
    return d > 0.5;
  }

  /** push a circle out of solid spatial items (other modules' colliders) */
  function collide(x, y, r) {
    const hits = ctx.spatial.queryCircle(x, y, r + 0.05, (it) => it.solid && it.owner !== 'characters');
    for (let iter = 0; iter < 2 && hits.length; iter++) {
      for (const it of hits) {
        if (it.x0 != null) {
          const cx = Math.max(it.x0, Math.min(x, it.x1)), cy = Math.max(it.y0, Math.min(y, it.y1));
          let dx = x - cx, dy = y - cy;
          let d = Math.hypot(dx, dy);
          if (d >= r) continue;
          if (d < 1e-4) {
            // centre inside the box: exit via the nearest side
            const l = x - it.x0, rr = it.x1 - x, t = y - it.y0, b = it.y1 - y;
            const m = Math.min(l, rr, t, b);
            if (m === l) x = it.x0 - r; else if (m === rr) x = it.x1 + r; else if (m === t) y = it.y0 - r; else y = it.y1 + r;
            continue;
          }
          x = cx + (dx / d) * r; y = cy + (dy / d) * r;
        } else {
          const R = (it.r || 0.5) + r;
          const dx = x - it.x, dy = y - it.y;
          const d = Math.hypot(dx, dy);
          if (d >= R || d < 1e-5) continue;
          x = it.x + (dx / d) * R; y = it.y + (dy / d) * R;
        }
      }
    }
    return { x, y };
  }

  /**
   * advance a character by desired direction (dx,dy unit or 0) for dt real seconds.
   * returns { moved (m), stepped (footfall count this step), g (ground) }
   */
  function step(ch, dx, dy, running, dt, now, speedMul = 1) {
    const g = groundCached(ch, now);
    const want = dx !== 0 || dy !== 0;
    const base = (running ? RUN : WALK) * speedMul;
    const target = want ? base * g.speed : 0;
    // accelerate / decelerate (feet are quick, but not instant)
    const acc = want ? 9 : 12;
    ch.speed = ch.speed + Math.max(-acc * dt, Math.min(acc * dt, target - ch.speed));
    let moved = 0;
    if (ch.speed > 0.01) {
      let hx = want ? dx : Math.sin(ch.rot), hy = want ? dy : -Math.cos(ch.rot);
      const len = Math.hypot(hx, hy) || 1; hx /= len; hy /= len;
      const s = ch.speed * dt;
      let nx = ch.x + hx * s, ny = ch.y + hy * s;
      // deep water: slide along the shore, else stop
      if (blocked(nx, ny)) {
        if (!blocked(nx, ch.y)) ny = ch.y;
        else if (!blocked(ch.x, ny)) nx = ch.x;
        else { nx = ch.x; ny = ch.y; ch.speed *= 0.5; }
      }
      const c = collide(nx, ny, RADIUS);
      nx = c.x; ny = c.y;
      if (blocked(nx, ny)) { nx = ch.x; ny = ch.y; }
      const W = ctx.world.bounds;
      nx = Math.max(0.5, Math.min(W.w - 0.5, nx)); ny = Math.max(0.5, Math.min(W.h - 0.5, ny));
      moved = Math.hypot(nx - ch.x, ny - ch.y);
      ch.x = nx; ch.y = ny;
      if (want) {
        const tr = Math.atan2(hx, -hy);
        const d = angDiff(ch.rot, tr);
        const turn = (running ? 9 : 11) * dt;
        ch.rot += Math.max(-turn, Math.min(turn, d));
      }
    }
    // walk-cycle blend + phase from true distance travelled
    const walkTarget = moved > 0.0005 ? Math.min(1, ch.speed / 0.9) : 0;
    ch.walk += (walkTarget - ch.walk) * Math.min(1, dt * 10);
    ch.running = running && ch.speed > WALK * 1.25;
    let stepped = 0;
    if (moved > 0) {
      const before = ch.phase;
      ch.phase += moved / (ch.running ? RUN_CYCLE : WALK_CYCLE);
      // a footfall at each half cycle
      stepped = Math.floor(ch.phase * 2) - Math.floor(before * 2);
      if (ch.phase > 1000) ch.phase -= 1000;
    }
    return { moved, stepped, g };
  }

  /** turn toward an angle */
  function face(ch, rot, dt, rate = 8) {
    const d = angDiff(ch.rot, rot);
    const t = rate * dt;
    ch.rot += Math.max(-t, Math.min(t, d));
    return Math.abs(d) < 0.08;
  }

  return { ground, groundCached, step, face, collide, blocked, angDiff };
}

export { angDiff };
