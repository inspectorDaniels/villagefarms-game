// buildings — showcase: a farmyard cluster and a small village on real terrain.

export const presets = {
  farm: { camera: { x: 512, y: 512, zoom: 20 }, time: '10:30' },
  default: { camera: { x: 512, y: 512, zoom: 14 }, time: '11:00' },
  village: { camera: { x: 512, y: 512, zoom: 12 }, time: '11:00' },
  closeup: { camera: { x: 512, y: 512, zoom: 48 }, time: '15:00' },
  night: { camera: { x: 512, y: 512, zoom: 16 }, time: '22:15' },
  winter: { camera: { x: 512, y: 512, zoom: 20 }, time: '11:30', day: 1 },
};

function findSite(T, x0, y0, rad, avoid) {
  if (!T) return { x: x0, y: y0 };
  const ok = (x, y) => {
    if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < avoid.r + rad) return false;
    for (let dy = -rad; dy <= rad; dy += 8) for (let dx = -rad; dx <= rad; dx += 8) {
      if ((T.waterDepthAt(x + dx, y + dy) || 0) > 0) return false;
      if ((T.slopeAt(x + dx, y + dy) || 0) > 0.12) return false;
    }
    return true;
  };
  for (let r = 0; r < 420; r += 12) {
    const n = Math.max(1, Math.round(r / 8));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.round(x0 + Math.cos(a) * r), y = Math.round(y0 + Math.sin(a) * r);
      if (x < rad + 20 || y < rad + 20 || x > 1004 - rad || y > 1004 - rad) continue;
      if (ok(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

const PI = Math.PI;

export async function stage(ctx, name) {
  const B = ctx.modules.get('buildings');
  const T = ctx.modules.get('terrain');
  const env = ctx.modules.get('environment');
  if (!B) return;
  const farm = findSite(T, 470, 470, 56);
  const vil = findSite(T, farm.x + 150, farm.y, 60, { x: farm.x, y: farm.y, r: 70 });
  const F = (type, dx, dy, rot, variant = 0) => B.place(type, farm.x + dx, farm.y + dy, rot, { owner: 'player', variant, anyLand: true });
  const V = (type, dx, dy, rot, variant = 0) => B.place(type, vil.x + dx, vil.y + dy, rot, { owner: 'npc', variant });

  // farmyard: house north facing the yard, barns around, silos + stores to the south
  F('farmhouse', -14, -16, PI);
  F('barn', 16, -18, PI);
  F('machine_shed', 26, 8, -PI / 2);
  F('grain_silo', 4, 20, 0);
  F('grain_silo', -12, 26, 0, 1);
  F('potato_store', -32, 10, PI / 2);
  F('cow_shed', -8, -44, 0);
  F('chicken_coop', -33, -14, PI / 2);
  F('chicken_coop', -33, -22, PI / 2, 1);
  F('barn', 42, -16, PI, 1);
  F('sheep_shelter', 46, 16, -PI / 2);
  // village: a street running east-west through vil.y
  V('church', -6, -22, 0);
  V('shop', 22, -16, PI);
  V('village_house', 38, -15, PI, 1);
  V('village_house', 45.5, -15, PI, 1);
  V('village_house', 53, -15, PI, 1);
  V('village_house', -36, -15, PI, 0);
  V('village_house', -50, -14, PI, 2);
  V('grain_coop', -30, 20, 0);
  V('dairy', 6, 18, 0);
  V('dealer', 40, 20, 0);
  V('village_house', 60, 14, 0, 0);

  if (env && env.setWeather) {
    if (name === 'winter') env.setWeather('snow', 0.6, { instant: true });
    else if (name !== 'night') env.setWeather('clear', 0.3, { instant: true });
  }
  let cam;
  switch (name) {
    case 'village': case 'night': cam = [vil.x, vil.y, name === 'night' ? 16 : 12]; break;
    case 'closeup': cam = [farm.x - 8, farm.y - 12, 48]; break;
    case 'default': cam = [farm.x + 6, farm.y - 6, 10]; break;
    default: cam = [farm.x + 4, farm.y - 8, 20];
  }
  ctx.camera.set(cam[0], cam[1], cam[2]);
  ctx.camera.follow(() => ({ x: cam[0], y: cam[1] }));
}
