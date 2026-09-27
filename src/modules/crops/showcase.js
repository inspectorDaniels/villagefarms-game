// crops showcase: a patchwork of ten fields on a dry, gentle part of the default valley, staged with
// the REAL mechanics (work() passes for ploughing, harvesting, mowing, raking, baling) wherever the
// preset shows work in progress. Presets pick the season (day of year) and camera.

const SITE = { x: 648, y: 680 };  // dry, low-relief spot of the default seed (found by probing terrain)
const COLW = 44, ROWH = 46, GAP = 5;
const cx = SITE.x + (5 * (COLW + GAP) - GAP) / 2, cy = SITE.y + (2 * ROWH + GAP) / 2;

export const PRESETS = {
  default: { camera: { x: cx, y: cy, zoom: 6.6 }, time: '10:00', day: 16 },      // June: patchwork at every stage
  closeup: { camera: { x: SITE.x + COLW + GAP / 2, y: SITE.y + ROWH + GAP / 2, zoom: 40 }, time: '10:00', day: 16 },
  bloom: { camera: { x: SITE.x + 2 * (COLW + GAP) + COLW / 2, y: SITE.y + ROWH / 2 + 4, zoom: 12 }, time: '11:00', day: 13 },
  harvest: { camera: { x: SITE.x + COLW / 2 + 8, y: SITE.y + ROWH / 2 + 2, zoom: 13 }, time: '16:30', day: 22 },
  winter: { camera: { x: cx, y: cy, zoom: 6.6 }, time: '12:00', day: 1 },
  maize: { camera: { x: SITE.x + COLW + GAP / 2, y: SITE.y + ROWH + GAP / 2 + 6, zoom: 22 }, time: '17:30', day: 20 },
};

function quad(col, row, rng) {
  const x0 = SITE.x + col * (COLW + GAP), y0 = SITE.y + row * (ROWH + GAP);
  const j = () => rng.range(-1.6, 1.6);
  return [[x0 + j(), y0 + j()], [x0 + COLW + j(), y0 + j()], [x0 + COLW + j(), y0 + ROWH + j()], [x0 + j(), y0 + ROWH + j()]];
}
/** drive back-and-forth passes along the field's rows over the fraction [a,b] of its width */
function passes(api, model, fid, tool, width, a = 0, b = 1, step = 0.5) {
  const f = model.byId.get(fid);
  const G = f.grid;
  const Lu = G.nu * G.cell, Lv = G.nv * G.cell;
  let dir = 1;
  for (let v = Lv * a + width / 2; v <= Lv * b - width / 2 + 0.01; v += width) {
    for (let s = -2; s <= Lu + 2; s += step) {
      const u = dir > 0 ? s : Lu - s;
      const x = G.ox + G.ux * u + G.vx * v, y = G.oy + G.uy * u + G.vy * v;
      const hx = G.ux * dir, hy = G.uy * dir;
      api.work(tool, x, y, width, Math.atan2(hx, -hy));
    }
    dir = -dir;
  }
}

export async function stageShowcase(ctx, presetName, inst) {
  const { api, model } = inst;
  const envApi = ctx.modules.get('environment');
  const P = PRESETS[presetName] || PRESETS.default;
  if (envApi) {
    if (ctx.params.weather) envApi.setWeather(ctx.params.weather, ctx.params.intensity != null ? Number(ctx.params.intensity) : 0.7, { instant: true });
    else if (presetName === 'winter') envApi.setWeather('snow', 0.45, { instant: true });
    else envApi.setWeather(presetName === 'bloom' ? 'clear' : 'cloudy', presetName === 'bloom' ? 0.2 : 0.35, { instant: true });
  }
  const rng = ctx.rng('showcase');
  const ids = [];
  const angles = [0, 0.03, -0.02, 0.02, 0, 1.5708, 0, -0.03, 0.02, 0];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 5; col++) {
    const i = row * 5 + col;
    const poly = quad(col, row, rng);
    // most fields run their rows east-west; one runs north-south
    ids.push(api.createField(poly, { state: 'stubble', soil: 0.7, angle: angles[i], name: 'Field ' + (i + 1) }));
  }
  const [F1, F2, F3, F4, F5, F6, F7, F8, F9, F10] = ids;
  const W = (id, t, w, a, b) => passes(api, model, id, t, w, a, b);

  if (presetName === 'winter') {
    api.plantAll(F1, 'wheat', 'auto'); api.plantAll(F2, 'barley', 'auto'); api.plantAll(F3, 'rapeseed', 'auto');
    api.forceStage(F4, 'grass'); api.forceStage(F5, 'ploughed'); api.forceStage(F6, 'stubble', 'maize');
    api.forceStage(F7, 'ploughed'); api.forceStage(F8, 'cultivated'); api.forceStage(F9, 'stubble', 'wheat'); api.plantAll(F10, 'wheat', 1);
  } else if (presetName === 'bloom') {
    api.plantAll(F1, 'wheat', 3); api.plantAll(F2, 'barley', 3); api.plantAll(F3, 'rapeseed', 4); api.plantAll(F4, 'grass', 4);
    api.plantAll(F5, 'rapeseed', 4); api.plantAll(F6, 'maize', 1); api.plantAll(F7, 'potatoes', 1); api.plantAll(F8, 'sugarBeet', 2);
    api.plantAll(F9, 'oats', 2); api.forceStage(F10, 'cultivated'); W(F10, 'seed:maize', 4, 0, 0.5);
  } else if (presetName === 'harvest') {
    // wheat half combined (6 m header) with straw swaths, part of the straw already baled
    api.plantAll(F1, 'wheat', 'ripe'); W(F1, 'harvest', 6, 0, 0.55); W(F1, 'bale', 3, 0, 0.2);
    api.forceStage(F2, 'harvested', 'barley'); W(F2, 'bale', 3, 0, 1); api.forceStage(F3, 'stubble', 'rapeseed'); W(F3, 'cultivate', 4, 0, 0.4);
    api.plantAll(F4, 'grass', 'ripe'); W(F4, 'mow', 3, 0, 1); W(F4, 'rake', 6, 0, 0.7); W(F4, 'bale', 3, 0, 0.3);
    api.forceStage(F5, 'ploughed'); api.plantAll(F6, 'maize', 4); api.plantAll(F7, 'potatoes', 5); api.plantAll(F8, 'sugarBeet', 4);
    api.plantAll(F9, 'oats', 'ripe'); api.plantAll(F10, 'barley', 'withered');
  } else {
    // June patchwork (default / closeup / maize)
    api.plantAll(F1, 'wheat', 4); api.plantAll(F2, 'barley', 'ripe'); api.plantAll(F3, 'rapeseed', 'pods');
    api.plantAll(F4, 'grass', 'ripe'); W(F4, 'mow', 3, 0, 0.8); W(F4, 'rake', 6, 0, 0.66); W(F4, 'bale', 3, 0, 0.4);
    api.forceStage(F5, 'stubble', 'wheat'); W(F5, 'plough', 3, 0.35, 1);
    api.plantAll(F6, 'maize', 3); api.plantAll(F7, 'potatoes', 4); api.plantAll(F8, 'sugarBeet', 3); api.plantAll(F9, 'oats', 2);
    api.forceStage(F10, 'ploughed'); W(F10, 'cultivate', 4, 0, 0.7); W(F10, 'seed:sugarBeet', 4, 0, 0.35);
    if (presetName === 'maize') api.plantAll(F6, 'maize', 4);
  }
  // weeds on one field so the weed overlay is visible
  const f9 = model.byId.get(F9);
  if (f9) { for (let k = 0; k < f9.cells.weeds.length; k++) if (f9.cells.state[k] && (k % 7 < 3)) f9.cells.weeds[k] = 0.6; model.refresh(F9); }
  // paint everything visible now so the first screenshot frame is complete
  const z = P.camera.zoom;
  const hw = 1700 / 2 / z, hh = 1000 / 2 / z;
  inst.renderer.prewarm({ x0: P.camera.x - hw, x1: P.camera.x + hw, y0: P.camera.y - hh, y1: P.camera.y + hh, zoom: z, dpr: 1 });
  inst.setBudget(6000);
}
