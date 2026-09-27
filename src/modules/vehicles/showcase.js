// vehicles — showcase scene: a farmyard with the whole fleet, a field being ploughed, a lane with
// a tractor + grain trailer convoy. Built on the real terrain / roads modules when present.
import { ALL } from './types.js';

// camera x/y are placeholders: the scene origin is found at runtime (a dry, flat spot) and the
// camera is pinned there with camera.follow() during stage().
export const PRESETS = {
  default: { camera: { x: 512, y: 512, zoom: 24 }, time: '10:00', day: 16 },
  working: { camera: { x: 512, y: 512, zoom: 26 }, time: '11:30', day: 16 },
  convoy: { camera: { x: 512, y: 512, zoom: 22 }, time: '16:30', day: 22 },
  night: { camera: { x: 512, y: 512, zoom: 26 }, time: '22:30', day: 16 },
  closeup: { camera: { x: 512, y: 512, zoom: 56 }, time: '09:30', day: 16 },
};

function findSite(terr, bounds) {
  if (!terr || !terr.waterDepthAt) return { x: 400, y: 400 };
  let best = null, bs = Infinity;
  for (let cy = 160; cy <= bounds.h - 160; cy += 48) {
    for (let cx = 160; cx <= bounds.w - 160; cx += 48) {
      let score = 0, wet = false;
      for (let j = -3; j <= 3 && !wet; j++) for (let i = -4; i <= 4; i++) {
        const x = cx + i * 16, y = cy + j * 14;
        if (terr.waterDepthAt(x, y) > 0) { wet = true; break; }
        score += terr.slopeAt ? Math.abs(terr.slopeAt(x, y)) : 0;
        const s = terr.surfaceAt ? terr.surfaceAt(x, y) : 'grass';
        if (s === 'rock' || s === 'forestFloor' || s === 'mud' || s === 'sand') score += 0.3;
      }
      if (wet) continue;
      score += Math.hypot(cx - bounds.w / 2, cy - bounds.h / 2) * 0.0004;
      if (score < bs) { bs = score; best = { x: cx, y: cy }; }
    }
  }
  return best || { x: 400, y: 400 };
}

export async function stageShowcase(ctx, preset, I) {
  if (!I) return;
  const api = (id) => ctx.modules.get(id);
  const terr = api('terrain'), roads = api('roads'), veh = api('vehicles');
  const b = ctx.world.bounds;
  const S = findSite(terr, b);
  const O = { x: S.x - 60, y: S.y - 40 };
  const P = (lx, ly) => [O.x + lx, O.y + ly];

  // ---- ground: farmyard, field, meadow strip
  if (terr && terr.paintSurface) {
    const rect = (x0, y0, x1, y1) => ({ poly: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)] });
    terr.paintSurface(rect(4, 6, 58, 40), 'farmyard');
    terr.paintSurface(rect(66, 6, 124, 70), 'soil');
  }
  // ---- a lane along the south of the yard, a track into the field
  if (roads && roads.generateNetwork) {
    roads.generateNetwork({
      nodes: [P(-30, 50), P(40, 50), P(150, 52), P(62, 50)],
      edges: [[0, 1, 'lane'], [1, 3, 'lane'], [3, 2, 'lane']],
    });
  }
  // yard barrier (a solid for the collision demo: a hay-bale stack as a plain spatial item)
  ctx.spatial.insert({ id: 'vehicles:showcase:wall', kind: 'prop', x0: O.x + 2, y0: O.y + 3, x1: O.x + 60, y1: O.y + 4, solid: true });

  const sp = (type, lx, ly, rot, o) => veh.spawn(type, O.x + lx, O.y + ly, rot, o);
  const N = 0, E = Math.PI / 2, Sd = Math.PI, Wd = -Math.PI / 2;

  // ---- yard lineup (facing south toward the camera-bottom lane)
  const t1 = sp('tractor_t1', 9, 14, Sd, { owner: 'owned' });
  const t2 = sp('tractor_t2', 15, 14, Sd, { owner: 'owned' });
  const t3 = sp('tractor_t3', 22, 14, Sd, { owner: 'owned' });
  const cb = sp('combine_s', 34, 16, Sd, { owner: 'owned' });
  const pk = sp('pickup', 46, 14, Sd, { owner: 'owned' });
  // implements parked in a row behind
  const row = ['plough_s', 'cultivator', 'seeder_s', 'sprayer', 'spreader', 'mower', 'rake', 'loader'];
  let x = 7;
  for (const t of row) { sp(t, x + ALL[t].wid / 2, 29, Sd); x += ALL[t].wid + 1.3; }
  sp('baler', 52, 30, Sd);
  const tg = sp('trailer_grain', 9, 36, E);
  sp('trailer_flat', 30, 37, E);
  void tg;
  veh.attach(t1, veh.spawn('loader', 0, 0, 0));
  const sprayer2 = sp('sprayer', 0, 0, 0);
  veh.attach(t3, sprayer2);

  // ---- working tractor + 5-furrow plough in the field (drive real passes to leave furrows/tracks)
  const wt = sp('tractor_t2', 76, 64, N, { owner: 'owned', fuel: 200 });
  const pl = sp('plough_l', 0, 0, 0);
  veh.attach(wt, pl);
  veh.enter(wt, 'showcase:driver');
  const W = I.W;
  const v = I.byId.get(wt);
  const drivePass = (steps, thr, steer, down) => {
    veh.setImplement(wt, down);
    for (let k = 0; k < steps; k++) { veh.control(wt, { throttle: thr, brake: 0, steer }); I.step(1 / 60); }
  };
  // four adjacent lands, alternating direction (teleported to each headland start)
  for (let pass = 0; pass < 4; pass++) {
    const up = pass % 2 === 0;
    v.x = O.x + 74 + pass * 2.2; v.y = O.y + (up ? 66 : 10); v.rot = up ? 0 : Math.PI; v.speed = 0; v.steer = 0;
    I.driver.settle(v);
    drivePass(pass === 3 ? 520 : 1250, 1, 0, true);
  }
  // combine on the headland, tractor + trailer convoy on the lane, pickup following
  const cv = sp('tractor_t3', 18, 50.5, E, { owner: 'owned' });
  const ct = sp('trailer_grain', 0, 0, 0);
  veh.attach(cv, ct);
  I.byId.get(ct).cargo = { item: 'wheat', kg: 11000 };
  const cvd = I.byId.get(cv);
  veh.enter(cv, 'showcase:driver2');
  for (let k = 0; k < 240; k++) { veh.control(cv, { throttle: 1, steer: 0 }); I.step(1 / 60); }
  const pk2 = sp('pickup', 2, 50.8, E, { owner: 'owned', paint: 'maroon' });
  const cbw = sp('combine_l', 100, 20, Wd, { owner: 'owned' });
  I.byId.get(cbw).cargo = { item: 'wheat', kg: 6000 };
  I.byId.get(cbw).lowered = true;

  // keep the working tractor and the convoy moving during the screenshot
  v.ctlHold = true; v.ctl = { throttle: 1, brake: 0, steer: 0 };
  cvd.ctlHold = true; cvd.ctl = { throttle: 0.7, brake: 0, steer: 0 };
  void pk; void pk2; void cb; void t2; void W;

  const night = preset === 'night';
  if (night) {
    for (const id of [t1, t2, t3, cb, pk, pk2, cbw]) veh.setLights(id, true);
    v.lights = true; cvd.lights = true;
  }

  // ---- camera
  const cams = {
    default: [31, 26],
    convoy: [42, 46],
    night: [40, 36],
    closeup: [0, 0],
  };
  let target;
  if (preset === 'closeup') target = () => ({ x: I.byId.get(pl).x * 0.5 + v.x * 0.5, y: I.byId.get(pl).y * 0.5 + v.y * 0.5 });
  else if (preset === 'working') target = () => ({ x: v.x + 4, y: v.y + 6 });
  else if (preset === 'convoy') target = () => ({ x: (cvd.x + O.x + 30) / 2, y: O.y + 46 });
  else { const c = cams[preset] || cams.default; target = () => ({ x: O.x + c[0], y: O.y + c[1] }); }
  const t0 = target();
  ctx.camera.set(t0.x, t0.y, (PRESETS[preset] || PRESETS.default).camera.zoom);
  ctx.camera.follow(target);
}
