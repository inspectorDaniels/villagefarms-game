// Simple AI for non-active characters: goto / work / idle / follow tasks, night sleep for
// farmhands, pavement walking for villagers (road graph when roads exists, wandering otherwise).
// Decisions run in update() at 60 Hz but only re-plan on timers; steering is direct with
// stuck detection and a sidestep.

const TAU = Math.PI * 2;

export function isNight(clock) {
  const h = clock.timeOfDay;
  return h >= 21.75 || h < 6;
}
export function isVillagerNight(clock) {
  const h = clock.timeOfDay;
  return h >= 20.5 || h < 6.5;
}

export function createAI(ctx, S) {
  const mod = (id) => ctx.modules.get(id);
  const rng = ctx.rng('ai');

  /** steer toward (tx,ty); returns remaining distance */
  function steerTo(ch, tx, ty, dt, now, run = false, arrive = 0.35) {
    const dx = tx - ch.x, dy = ty - ch.y;
    const d = Math.hypot(dx, dy);
    if (d <= arrive) { S.motion.step(ch, 0, 0, false, dt, now); return d; }
    let ux = dx / d, uy = dy / d;
    // sidestep when stuck
    if (ch._side > 0) {
      ch._side -= dt;
      const s = ch._sideDir || 1;
      ux = ux * 0.35 - uy * s; uy = uy * 0.35 + (dx / d) * s;
      const l = Math.hypot(ux, uy); ux /= l; uy /= l;
    }
    // slow down on the last metre
    const mul = (d < 1.2 ? 0.55 + 0.45 * (d / 1.2) : 1) * (ch.pace || 1);
    const r = S.motion.step(ch, ux, uy, run && d > 6, dt, now, mul);
    S.onStep(ch, r);
    // stuck detection
    ch._stuckT = (ch._stuckT || 0) + dt;
    if (ch._stuckT > 1.5) {
      const prog = Math.hypot(ch.x - (ch._sx || 0), ch.y - (ch._sy || 0));
      if (prog < 0.25 && d > arrive + 0.2) { ch._side = 1.1; ch._sideDir = rng.chance(0.5) ? 1 : -1; ch._stuckN = (ch._stuckN || 0) + 1; }
      else ch._stuckN = 0;
      ch._stuckT = 0; ch._sx = ch.x; ch._sy = ch.y;
    }
    return d;
  }

  function wanderPoint(cx, cy, r) {
    for (let i = 0; i < 8; i++) {
      const a = rng.float() * TAU, d = r * Math.sqrt(rng.float());
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (!S.motion.blocked(x, y)) return { x, y };
    }
    return { x: cx, y: cy };
  }

  // ------------------------------------------------------------------ farmhands
  function tickFarmhand(ch, dt, now) {
    const clock = ctx.clock;
    let task = ch.task || { kind: 'idle' };
    // night: idle hands go home and sleep; workers stop at 22:00; followers keep following
    if (task.kind !== 'follow' && task.kind !== 'sleep' && !task.pinned && isNight(clock)) {
      ch._dayTask = task;
      task = ch.task = { kind: 'sleep' };
    }
    if (task.kind === 'sleep' && !task.pinned && !isNight(clock)) {
      ch.task = ch._dayTask || { kind: 'idle' };
      ch._dayTask = null;
      if (ch.state === 'sleeping') { ch.state = 'idle'; }
      return;
    }
    switch (task.kind) {
      case 'goto': {
        ch.state = 'walking';
        const d = steerTo(ch, task.x, task.y, dt, now, !!task.run, task.arrive || 0.35);
        if (d <= (task.arrive || 0.35)) { ch.task = task.then || { kind: 'idle', x: task.x, y: task.y, r: 2 }; ch.state = 'idle'; }
        break;
      }
      case 'follow': {
        const tgt = S.get(task.targetId) || S.active();
        if (!tgt || tgt.id === ch.id) { ch.task = { kind: 'idle' }; break; }
        const dist = task.dist || 2.4;
        // stand behind-left of the leader
        const bx = tgt.x - Math.sin(tgt.rot) * dist * 0.8 - Math.cos(tgt.rot) * 0.9;
        const by = tgt.y + Math.cos(tgt.rot) * dist * 0.8 - Math.sin(tgt.rot) * 0.9;
        const far = Math.hypot(tgt.x - ch.x, tgt.y - ch.y);
        if (far > dist + 0.6 || (ch.walk > 0.2 && far > dist * 0.7)) {
          ch.state = 'walking';
          steerTo(ch, bx, by, dt, now, far > 7 || tgt.running, 0.5);
        } else {
          S.motion.step(ch, 0, 0, false, dt, now);
          S.motion.face(ch, Math.atan2(tgt.x - ch.x, -(tgt.y - ch.y)), dt, 4);
          ch.state = 'idle';
        }
        break;
      }
      case 'work': {
        // walk to the site, then strike the ground in a small area row by row
        const site = task.jobId ? (S.jobSite(task.jobId) || task) : task;
        if (site.x == null) { ch.task = { kind: 'idle' }; break; }
        const r = task.r || 2.5;
        if (!task._spot) {
          const n = task._n = (task._n || 0) + 1;
          const cols = Math.max(1, Math.round(r));
          const i = n % (cols * cols);
          const gx = (i % cols) - (cols - 1) / 2, gy = Math.floor(i / cols) - (cols - 1) / 2;
          task._spot = { x: site.x + gx * 1.0 + 0.5, y: site.y + gy * 1.0 + 1.4 };
        }
        const sp = task._spot;
        if (ch.action) { S.motion.step(ch, 0, 0, false, dt, now); ch.state = 'working'; break; }
        const d = Math.hypot(sp.x - ch.x, sp.y - ch.y);
        if (d > 0.4) { ch.state = 'walking'; steerTo(ch, sp.x, sp.y, dt, now, d > 12, 0.3); break; }
        S.motion.step(ch, 0, 0, false, dt, now);
        ch.state = 'working';
        // face "north" of the spot (rows run upward) and work
        const faced = S.motion.face(ch, task.rot != null ? task.rot : 0, dt, 5);
        ch._cool = (ch._cool || 0) - dt;
        if (faced && ch._cool <= 0) {
          const tool = task.tool || ch.tool || 'hoe';
          if (ch.tool !== tool) ch.tool = tool;
          if (ch.stamina > 0.15) {
            S.useTool(ch, { quiet: false, force: !!task.showcase });
            ch._cool = task.pace || 1.3 + rng.range(0, 0.8);
            if (!task.stay) task._spot = null;
          } else { ch._cool = 3; ch.state = 'resting'; }
        }
        break;
      }
      case 'sleep': {
        const home = ch.home || { x: ch.x, y: ch.y };
        if (ch.state === 'sleeping' || ch.state === 'inside') { S.motion.step(ch, 0, 0, false, dt, now); break; }
        const bld = mod('buildings');
        let door = null;
        if (bld && bld.nearest) {
          const b = bld.nearest('farmhouse', home.x, home.y);
          const dd = b && bld.doorOf ? bld.doorOf(b.id || b) : null;
          if (dd && Math.hypot(dd.x - home.x, dd.y - home.y) < 60) door = dd;
        }
        const tx = door ? door.x : home.x, ty = door ? door.y : home.y;
        ch.state = 'walking';
        const d = steerTo(ch, tx, ty, dt, now, false, 0.4);
        if (d <= 0.4) { ch.state = door ? 'inside' : 'sleeping'; ch.walk = 0; ch.speed = 0; if (!door && ch.home && ch.home.rot != null) ch.rot = ch.home.rot; }
        break;
      }
      case 'idle':
      default: {
        const cx = task.x != null ? task.x : (ch.home ? ch.home.x : ch.x);
        const cy = task.y != null ? task.y : (ch.home ? ch.home.y : ch.y);
        const r = task.r != null ? task.r : 4;
        if (ch._wait > 0) {
          ch._wait -= dt;
          S.motion.step(ch, 0, 0, false, dt, now);
          ch.state = 'idle';
          if (ch._look != null) S.motion.face(ch, ch._look, dt, 2.5);
          break;
        }
        if (!ch._wp) ch._wp = wanderPoint(cx, cy, r);
        ch.state = 'walking';
        const d = steerTo(ch, ch._wp.x, ch._wp.y, dt, now, false, 0.35);
        if (d <= 0.35 || ch._stuckN > 2) { ch._wp = null; ch._stuckN = 0; ch._wait = rng.range(2.5, 7); ch._look = rng.chance(0.6) ? rng.float() * TAU : null; }
      }
    }
  }

  // ------------------------------------------------------------------ villagers
  let graph = null, graphVersion = -1;
  function roadGraph() {
    const roads = mod('roads');
    if (!roads) return null;
    const ver = ctx.world.roads && ctx.world.roads.version;
    if (graph && graphVersion === ver) return graph;
    const edges = (roads.edges() || []).filter((e) => (e.class === 'village' || e.class === 'lane') && e.points && e.points.length > 1);
    const adj = new Map();
    for (const e of edges) {
      for (const n of [e.a, e.b]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(e); }
    }
    graph = { edges, adj };
    graphVersion = ver;
    return graph;
  }

  /** pavement polyline for walking edge e from node `from`, on side s (+1 right of travel) */
  function pavementPath(e, fromNode, side) {
    const pts = e.a === fromNode ? e.points : e.points.slice().reverse();
    const off = (e.width || 6) / 2 + (e.class === 'village' ? 0.95 : 0.6);
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let tx = q[0] - o[0], ty = q[1] - o[1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      // right-hand normal of travel direction (x east, y south): (-ty, tx)
      out.push({ x: p[0] - ty * off * side, y: p[1] + tx * off * side });
    }
    return out;
  }

  function planVillager(ch) {
    const G = roadGraph();
    const v = ch.villager;
    if (G && G.edges.length && v.useRoads !== false) {
      let e = v.edge ? G.edges.find((q) => q.id === v.edge) : null;
      let from = v.node;
      if (!e) {
        // nearest edge to the villager inside its area
        let best = null, bd = 1e9;
        for (const q of G.edges) {
          for (const p of q.points) { const d = Math.hypot(p[0] - ch.x, p[1] - ch.y); if (d < bd) { bd = d; best = q; } }
        }
        e = best; from = rng.chance(0.5) ? e.a : e.b;
      } else {
        // continue from the node we arrived at to a connected edge (avoid U-turn when possible)
        const opts = (G.adj.get(from) || []).filter((q) => q.id !== e.id);
        const inArea = opts.filter((q) => !v.area || q.points.some((p) => p[0] > v.area.x0 && p[0] < v.area.x1 && p[1] > v.area.y0 && p[1] < v.area.y1));
        const pool = inArea.length ? inArea : opts;
        e = pool.length ? rng.pick(pool) : e;
      }
      const to = e.a === from ? e.b : e.a;
      v.edge = e.id; v.node = to;
      v.path = pavementPath(e, from, v.side);
      // start from the nearest path point ahead of us
      let bi = 0, bd = 1e9;
      for (let i = 0; i < v.path.length; i++) { const d = Math.hypot(v.path[i].x - ch.x, v.path[i].y - ch.y); if (d < bd) { bd = d; bi = i; } }
      v.i = Math.min(v.path.length - 1, bi + (bd < 1.5 ? 1 : 0));
      return;
    }
    // no roads: wander within the area
    const A = v.area;
    const p = A ? { x: A.x0 + rng.float() * (A.x1 - A.x0), y: A.y0 + rng.float() * (A.y1 - A.y0) } : wanderPoint(ch.x, ch.y, 20);
    v.path = [p]; v.i = 0;
  }

  function tickVillager(ch, dt, now) {
    const v = ch.villager;
    const night = isVillagerNight(ctx.clock) && !v.noHome;
    if (night) {
      if (ch.state === 'inside') return;
      const home = ch.home || { x: ch.x, y: ch.y };
      ch.state = 'walking';
      const d = steerTo(ch, home.x, home.y, dt, now, false, 0.5);
      if (d <= 0.5) { ch.state = 'inside'; ch.walk = 0; ch.speed = 0; }
      return;
    }
    if (ch.state === 'inside') { ch.state = 'walking'; v.path = null; }
    if (v.wait > 0) {
      v.wait -= dt; S.motion.step(ch, 0, 0, false, dt, now); ch.state = 'idle';
      if (v.look != null) S.motion.face(ch, v.look, dt, 2);
      return;
    }
    if (!v.path || v.i >= v.path.length) planVillager(ch);
    const p = v.path[v.i];
    ch.state = 'walking';
    const d = steerTo(ch, p.x, p.y, dt, now, false, 0.6);
    if (d <= 0.6 || ch._stuckN > 3) {
      v.i++; ch._stuckN = 0;
      // now and then stop for a chat / window shopping
      if (rng.chance(v.path.length > 1 ? 0.035 : 0.4)) { v.wait = rng.range(3, 9); v.look = rng.chance(0.5) ? rng.float() * TAU : null; }
    }
  }

  return { tickFarmhand, tickVillager, steerTo, roadGraph };
}
