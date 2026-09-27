// crops — fields and everything that grows in them (wave 2).
// Pure logic: model.js (+ data.js). Rendering: render.js + tiles.js. Showcase: showcase.js.
import { CROPS, CROP_IDS, YEAR_DAYS, UNITS, monthOfDoy, inSowWindow, calendarGrowth } from './data.js';
import { createModel } from './model.js';
import { createTiles } from './tiles.js';
import { createRenderer, insetPoly } from './render.js';
import { PRESETS, stageShowcase } from './showcase.js';

export const manifest = {
  id: 'crops',
  wave: 2,
  deps: ['simulation'],
  optionalDeps: ['terrain', 'environment'],
  namespaces: ['crops'],
  api: ['createField', 'removeField', 'fields', 'field', 'fieldAt', 'cellAt', 'work', 'stats', 'forceStage', 'plantAll',
    'crops', 'calendar', 'bales', 'collectBale', 'simulateDays'],
  emits: ['crops:worked', 'crops:sown', 'crops:ripe', 'crops:harvested', 'crops:withered', 'crops:field-changed'],
  listens: ['economy:contractor-done'],
};

// climate fallback (mm of rain per game day by month) when environment gives no plan for a day
const CLIMATE_MM = [6, 5, 5, 4, 5, 5, 6, 6, 5, 6, 7, 7];
const INSTANCES = new WeakMap();

export async function init(ctx) {
  const { world, clock } = ctx;
  const W = world.crops;
  const mod = (id) => ctx.modules.get(id);
  let renderer = null;

  // ---- yields & calendar from the simulation so both modules agree on t/ha and seasons
  const sim = mod('simulation');
  const table = sim && sim.yieldTable ? sim.yieldTable() : null;
  if (table) {
    for (const id of CROP_IDS) {
      const t = table[id];
      if (!t) continue;
      const C = CROPS[id];
      if (Number.isFinite(t.yield)) C.yieldT = t.yield;
      if (Number.isFinite(t.straw)) C.strawT = t.straw;
      if (t.product) C.product = t.product;
    }
  }

  const model = createModel(W, {
    seed: world.seed,
    emit: (t, p) => ctx.events.emit(t, p),
    sim: () => mod('simulation'),
    now: () => { const day = clock.day + (W.dayOffset || 0); return { t: clock.t, day, doy: ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS }; },
    moistureAt: (x, y) => { const t = mod('terrain'); const v = t && t.moistureAt ? t.moistureAt(x, y) : null; return Number.isFinite(v) ? v : 0.5; },
    onDirty: (f, k) => { if (renderer) renderer.onDirty(f, k); },
    onField: (f, change) => { if (renderer) renderer.onField(f, change); },
  });

  // ---- rain bookkeeping: plan (environment forecast for tomorrow) + measured rain rate
  W.rain = W.rain || { plan: {}, measured: {} };
  function rainFor(day) {
    const real = day - (W.dayOffset || 0);
    const plan = W.rain.plan[real];
    const meas = W.rain.measured[real];
    if (plan != null || meas != null) return Math.max(plan || 0, (meas || 0) * 0.3);
    // deterministic climate fallback
    const m = monthOfDoy(real);
    let h = (Math.imul(real + 7919, 2654435761) >>> 0) / 4294967296;
    return CLIMATE_MM[m] * (h < 0.3 ? 0.1 : 0.4 + 1.6 * h);
  }
  function trackRain(dtGame) {
    const envApi = mod('environment');
    const w = world.environment && world.environment.weather;
    const d = clock.day;
    if (w && w.rainRate > 0) W.rain.measured[d] = (W.rain.measured[d] || 0) + w.rainRate * dtGame / 3600;
    if (W.rain.planDay !== d && envApi && envApi.forecast) {
      const fc = envApi.forecast(1);
      if (fc && fc[0] && Number.isFinite(fc[0].rainMm)) W.rain.plan[fc[0].day] = fc[0].rainMm;
      W.rain.planDay = d;
      for (const k of Object.keys(W.rain.plan)) if (+k < d - 80) delete W.rain.plan[k];
      for (const k of Object.keys(W.rain.measured)) if (+k < d - 80) delete W.rain.measured[k];
    }
  }

  // ---- simulation contractors (r3): a finished booking is applied to every field on that parcel.
  // Harvested grain/roots and baled hay/straw go into farm inventory (the contractor delivers to the yard).
  const SOW_PREF = ['wheat', 'barley', 'rapeseed', 'maize', 'sugarBeet', 'potatoes', 'oats', 'grass'];
  const CONTRACT_TOOL = { plough: 'plough', cultivate: 'cultivate', spray: 'spray', mow: 'mow', harvest: 'harvest', lift: 'harvest', bale: 'bale', rake: 'rake', fertilise: 'fertilise' };
  ctx.events.on('economy:contractor-done', (ev) => {
    const b = ev && ev.booking;
    if (!b || !b.parcelId) return;
    const s = mod('simulation');
    const fs = W.fields.filter((f) => f.parcelId === b.parcelId);
    const doy = ((clock.day + (W.dayOffset || 0)) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
    for (const f of fs) {
      let tool = CONTRACT_TOOL[b.op];
      if (b.op === 'sow') {
        const crop = b.crop || f.plannedCrop || SOW_PREF.find((c) => inSowWindow(c, doy)) || 'wheat';
        tool = 'seed:' + crop;
      }
      if (!tool) continue;
      const r = model.workField(f.id, tool, { report: false }); // simulation already recorded the CAP work
      if (!s || !s.addInventory) continue;
      if (b.op === 'harvest' || b.op === 'lift') { if (r.yieldKg > 0 && r.item) s.addInventory(r.item, r.yieldKg / 1000); }
      if (b.op === 'bale') for (const [item, kg] of Object.entries(r.baleKg || {})) if (kg > 0) s.addInventory(item, kg / 1000);
    }
  });

  // ---- rendering
  const tiles = createTiles(ctx.art, ctx.palette);
  renderer = createRenderer(ctx, model, tiles);
  for (const f of W.fields) renderer.onField(f, 'add');
  let budget = 2200;
  ctx.renderer.addLayer('ground', (g, view) => renderer.drawGround(g, view, budget), 5);
  ctx.renderer.addLayer('ground-detail', (g, view) => renderer.drawSway(g, view), 2);
  ctx.renderer.addCollector((view, F) => renderer.collect(view, F));

  function publicField(f) {
    return f ? { id: f.id, name: f.name, parcelId: f.parcelId, crop: f.crop, state: f.state, stage: f.stage, growth: +f.growth.toFixed(3),
      readiness: +f.readiness.toFixed(3), area: +f.area.toFixed(1), poly: f.poly.map((p) => p.slice()), angle: f.angle, soil: { ...f.soil },
      sownDay: f.sownDay, lastWorked: f.lastWorked } : null;
  }

  const api = {
    /** poly [[x,y]…] metres; opts { parcelId?, crop?, stage? ('auto'|0..5|name), state? ('grass'|'stubble'|'ploughed'|'cultivated'), angle?, cell? (m, default 2), soil? 0..1, name?, paintTerrain? } → id */
    createField(poly, opts = {}) {
      const id = model.createField(poly, opts);
      const fo = model.byId.get(id); if (fo && opts.plannedCrop) fo.plannedCrop = opts.plannedCrop;
      const t = mod('terrain');
      const inner = insetPoly(poly, 1.3); // the outer metre stays verge grass (the field edge is feathered onto it)
      if (t && t.paintSurface && opts.paintTerrain !== false && inner) t.paintSurface({ poly: inner }, 'soil');
      return id;
    },
    removeField: (id) => model.removeField(id),
    fields: () => W.fields.map(publicField),
    field: (id) => publicField(model.byId.get(id)),
    /** field summary at a point, or null */
    fieldAt: (x, y) => publicField(model.fieldAtObj(x, y)),
    /** detailed cell under a point: { fieldId, state, crop, stage, growth, moisture, fertility, weeds, health, lyingKg } */
    cellAt: (x, y) => model.cellAt(x, y),
    /** tool: plough|cultivate|seed:<crop>|fertilise|spray|harvest|mow|rake|bale|water; width m; rot rad (0 = north) → { cellsChanged, yieldKg, item, fieldId, strawKg?, mownKg?, bales? } */
    work: (tool, x, y, width, rot, len) => model.work(tool, x, y, width, rot, len),
    stats: (id) => model.stats(id),
    forceStage: (id, stage, crop) => model.forceStage(id, stage, crop),
    plantAll: (id, crop, stage) => model.plantAll(id, crop, stage),
    /** crop table: { id: { name, product, yieldT, strawT, sowMonths, harvestMonths, height, need, stageNames } } */
    crops() {
      const out = {};
      for (const id of CROP_IDS) { const C = CROPS[id]; out[id] = { name: C.name, product: C.product, yieldT: C.yieldT, strawT: C.strawT, sowMonths: C.sowMonths.slice(), harvestMonths: C.harvestMonths.slice(), height: C.height, need: C.need, stageNames: C.stageNames.slice(), kind: C.kind }; }
      return out;
    },
    /** sowing advice for today (or dayOfYear): { crop: { canSow, growthIfOnSchedule, units } } */
    calendar(doy) {
      const d = doy == null ? model.W && (clock.dayOfYear) : doy;
      const out = {};
      for (const id of CROP_IDS) out[id] = { canSow: inSowWindow(id, d), growthIfOnSchedule: calendarGrowth(id, d), units: UNITS[CROPS[id].units][monthOfDoy(d)] };
      return out;
    },
    bales: () => W.bales.map((b) => ({ ...b })),
    /** pick a bale up (loader / trailer) → { item, kg } or null */
    collectBale(id) {
      const i = W.bales.findIndex((b) => b.id === id);
      if (i < 0) return null;
      const [b] = W.bales.splice(i, 1);
      return { item: b.item, kg: b.kg, id: b.id };
    },
    /** time-lapse (demo/tests): run n growth days now with `rainMm` per day (default: climate) */
    simulateDays(n = 1, opts = {}) {
      model.stepDay(Infinity);
      if (W.day == null) W.day = clock.day + (W.dayOffset || 0);
      n = Math.max(0, Math.min(400, n | 0));
      for (let i = 0; i < n; i++) {
        const d = W.day + 1;
        const mm = typeof opts.rainMm === 'function' ? opts.rainMm(d) : opts.rainMm != null ? opts.rainMm : rainFor(d);
        model.dayTick(d, mm);
        W.dayOffset = (W.dayOffset || 0) + 1;
      }
      model.flush(clock.t, true);
      return W.fields.map((f) => ({ id: f.id, crop: f.crop, stage: f.stage, growth: +f.growth.toFixed(3) }));
    },
  };

  const inst = { model, renderer, tiles, api, setBudget: (b) => { budget = b; } };
  INSTANCES.set(ctx, inst);
  if (ctx.params.cropsdebug) globalThis.__CROPS__ = inst; // dev: profiling hooks

  return {
    api,
    update(dt) {
      const dtGame = clock.paused ? 0 : dt * clock.scale;
      trackRain(dtGame);
      const target = clock.day + (W.dayOffset || 0);
      if (W.day == null) W.day = target;
      if (model.pendingDay() == null && W.day < target) {
        if (target - W.day > 72) { ctx.warn(`crops: skipped ${target - W.day - 72} day(s) of growth (catch-up capped at 72)`); W.day = target - 72; }
        model.beginDay(W.day + 1, rainFor(W.day + 1));
      }
      if (model.pendingDay() != null) model.stepDay(4000); // ≈ 0.5 ms per step; a 60 ha farm finishes a day in ~40 steps
      model.flush(clock.t, false);
    },
    save() { model.stepDay(Infinity); return { model: model.save(), rain: JSON.parse(JSON.stringify(W.rain)) }; },
    load(d) {
      if (!d || !d.model) return;
      renderer.invalidateAll();
      model.load(d.model);
      W.rain = d.rain || { plan: {}, measured: {} };
    },
  };
}

export const showcase = {
  deps: ['terrain', 'environment'],
  presets: PRESETS,
  async stage(ctx, presetName) {
    const inst = INSTANCES.get(ctx);
    if (!inst) return;
    await stageShowcase(ctx, presetName, inst);
  },
};

