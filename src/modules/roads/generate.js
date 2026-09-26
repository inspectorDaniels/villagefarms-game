// Default network for a world: a regional road crossing the valley west→east, a village
// hanging off it (T junction + crossroads + loop), gravel farm lanes and dirt field tracks.
// Uses the terrain API (optional) to keep control points off water / steep ground.

export function defaultPlan(W, H, T, rng, noise) {
  const isWater = (x, y) => !!(T && typeof T.isWater === 'function' && T.isWater(x, y));
  const slope = (x, y) => { const s = T && typeof T.slopeAt === 'function' ? T.slopeAt(x, y) : 0; return Number.isFinite(s) ? s : 0; };
  const cost = (x, y) => (isWater(x, y) ? 1000 : 0) + slope(x, y) * 60 + ((x < 20 || y < 20 || x > W - 20 || y > H - 20) ? 500 : 0);
  /** nudge a point perpendicular to dir to cheaper ground */
  const settle = (x, y, dx, dy) => {
    let best = [x, y], bc = cost(x, y);
    if (bc < 1) return best;
    for (const o of [12, -12, 24, -24, 36, -36, 50, -50, 70, -70]) {
      const px = x - dy * o, py = y + dx * o;
      const c = cost(px, py) + Math.abs(o) * 0.2;
      if (c < bc) { bc = c; best = [px, py]; }
    }
    return best;
  };

  const nodes = [], edges = [];
  const N = (x, y) => { nodes.push([+x.toFixed(2), +y.toFixed(2)]); return nodes.length - 1; };
  const E = (i, j, cls, via = [], opts) => edges.push(opts ? [i, j, cls, via, opts] : [i, j, cls, via]);

  // regional: control points every ~85 m with a noise meander
  const yMid = H * (0.5 + rng.range(-0.06, 0.06));
  const reg = [];
  const steps = Math.max(4, Math.round(W / 85));
  for (let k = 0; k <= steps; k++) {
    const x = k === 0 ? 2 : k === steps ? W - 2 : (W * k) / steps;
    let y = yMid + noise.fbm(k * 0.35, 4.2, 2) * H * 0.12;
    const p = k === 0 || k === steps ? [x, y] : settle(x, y, 1, 0);
    reg.push(p);
  }
  // village hangs north of the regional at ~58% of the width
  const vk = Math.max(2, Math.min(steps - 2, Math.round(steps * 0.58)));
  const lk = Math.max(1, Math.min(steps - 1, Math.round(steps * 0.25)));
  const ek = Math.max(vk + 1, Math.min(steps - 1, Math.round(steps * 0.82)));
  const ids = reg.map((p, k) => (k === 0 || k === steps || k === vk || k === lk || k === ek || k === vk - 1) ? N(p[0], p[1]) : null);
  let prev = 0, via = [];
  for (let k = 1; k <= steps; k++) {
    if (ids[k] == null) { via.push(reg[k]); continue; }
    E(ids[prev], ids[k], 'regional', via);
    prev = k; via = [];
  }
  const tJ = ids[vk], tJ2 = ids[vk - 1];
  const [vx, vy] = reg[vk];
  const cross = N(...settle(vx + 4, vy - 70, 0, -1));
  const [cx, cy] = nodes[cross];
  E(tJ, cross, 'village', [[vx + 2, vy - 35]]);
  const west = N(...settle(cx - 75, cy - 4, -1, 0));
  const east = N(...settle(cx + 80, cy + 6, 1, 0));
  const north = N(...settle(cx + 3, cy - 65, 0, -1));
  E(cross, west, 'village', [[cx - 38, cy + 2]]);
  E(cross, east, 'village', [[cx + 40, cy - 2]]);
  E(cross, north, 'village', [[cx - 4, cy - 32]]);
  // loop back to the regional from the west street
  E(west, tJ2, 'village', [[nodes[west][0] - 10, (nodes[west][1] + nodes[tJ2][1]) / 2]]);
  // lane east out of the village, tracks north into fields
  const ne = N(...settle(cx + 170, cy - 40, 1, 0));
  E(east, ne, 'lane', [[cx + 125, cy - 10]]);
  const nf = N(...settle(cx + 20, cy - 150, 0, -1));
  E(north, nf, 'track', [[cx + 12, cy - 110]]);
  const ne2 = N(...settle(cx + 250, cy - 70, 1, 0));
  E(ne, ne2, 'track', [[cx + 210, cy - 60]]);
  // farm lane south from the western regional junction
  const [lx, ly] = reg[lk];
  const farm = N(...settle(lx + 20, ly + 170, 0, 1));
  const mid = N(...settle(lx + 8, ly + 90, 0, 1));
  E(ids[lk], mid, 'lane', [[lx + 2, ly + 45]]);
  E(mid, farm, 'lane', [[lx + 18, ly + 130]]);
  const field = N(...settle(lx + 130, ly + 100, 1, 0));
  E(mid, field, 'track', [[lx + 70, ly + 92]]);
  // lane north from the eastern regional junction
  const [ex, ey] = reg[ek];
  const nfarm = N(...settle(ex - 10, ey - 160, 0, -1));
  E(ids[ek], nfarm, 'lane', [[ex + 6, ey - 60], [ex - 4, ey - 115]]);
  const nfield = N(...settle(ex - 120, ey - 190, -1, 0));
  E(nfarm, nfield, 'track', [[ex - 60, ey - 170]]);
  return { nodes, edges };
}
