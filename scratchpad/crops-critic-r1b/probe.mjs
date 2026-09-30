import { createModel } from '../../src/modules/crops/model.js';
import { YEAR_DAYS, CROPS } from '../../src/modules/crops/data.js';
const DAY = 86400;
function mk(seed = 's', day = YEAR_DAYS + 29) {
  const W = {}; const clock = { day }; const ev = [];
  const M = createModel(W, { seed, emit: (t, p) => ev.push([t, p]), sim: () => null,
    now: () => ({ t: clock.day * DAY + 36000, day: clock.day, doy: ((clock.day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS }), moistureAt: () => 0.5 });
  return { W, M, clock, ev };
}
const sq = (x, y, L, H) => [[x, y], [x + L, y], [x + L, y + H], [x, y + H]];
const T = (name, fn) => { try { const r = fn(); console.log('ok   ', name, JSON.stringify(r)?.slice(0, 160)); } catch (e) { console.log('THROW', name, e.message); } };
// ---- bad input
{
  const { M } = mk();
  const id = M.createField(sq(0, 0, 100, 60), { state: 'stubble' });
  T('work NaN', () => M.work('plough', NaN, NaN, 3, 0));
  T('work NaN width', () => M.work('plough', 10, 10, NaN, NaN, NaN));
  T('work unknown tool', () => M.work('flamethrower', 10, 10, 3, 0));
  T('work seed:unicorn', () => M.work('seed:unicorn', 10, 10, 3, 0));
  T('work null tool', () => M.work(null, 10, 10, 3, 0));
  T('work width 1e9', () => { const t0 = performance.now(); const r = M.work('plough', 50, 30, 1e9, 0); return { ...r, ms: performance.now() - t0 }; });
  T('work width Infinity', () => M.work('cultivate', 50, 30, Infinity, 0.3));
  T('work width -5', () => M.work('spray', 50, 30, -5, 0));
  T('work len 1e9', () => M.work('fertilise', 50, 30, 3, 0, 1e9));
  T('work string coords', () => M.work('water', '50', '30', 3, 0));
  T('createField null', () => M.createField(null));
  T('createField 2pts', () => M.createField([[0, 0], [1, 1]]));
  T('createField NaN pts', () => M.createField([[NaN, 0], [10, 0], [10, 10]]));
  T('createField degenerate line', () => M.createField([[0, 0], [10, 0], [20, 0]]));
  T('createField 1e5 m side', () => { const t0 = performance.now(); const r = M.createField(sq(0, 0, 5000, 5000)); return { r, ms: performance.now() - t0 }; });
  T('stats unknown', () => M.stats('nope'));
  T('forceStage unknown field', () => M.forceStage('nope', 'ripe'));
  T('forceStage garbage stage', () => M.forceStage(id, 'banana'));
  T('forceStage 99', () => M.forceStage(id, 99));
  T('plantAll unicorn', () => M.plantAll(id, 'unicorn', 2));
  T('plantAll NaN stage', () => M.plantAll(id, 'wheat', NaN));
  T('cellAt NaN', () => M.cellAt(NaN, 1));
  T('workField unknown tool', () => M.workField(id, 'foo'));
  T('workField undefined tool', () => M.workField(id, undefined));
  T('removeField twice', () => [M.removeField(id), M.removeField(id)]);
  T('dayTick NaN rain', () => { const i2 = M.createField(sq(0, 0, 40, 40), { crop: 'wheat', stage: 2 }); M.dayTick(YEAR_DAYS + 30, NaN); return M.stats(i2); });
}
// ---- rain dependence: identical wheat fields, 0 mm vs 6 mm vs 30 mm/day for 20 days from doy 0 (winter→spring)
{
  const res = {};
  for (const mm of [0, 3, 6, 15, 40]) {
    const { M, clock } = mk('rain', YEAR_DAYS * 2 + 12);
    const id = M.createField(sq(0, 0, 100, 100), { state: 'ploughed' });
    M.work; M.plantAll(id, 'wheat', 2);
    for (let d = 1; d <= 20; d++) { clock.day++; M.dayTick(clock.day, mm); }
    const s = M.stats(id); res[mm] = { g: s.growth, stage: s.stage, moist: s.moisture, yPerHa: s.expectedYieldPerHa, days: s.daysToRipe };
  }
  console.log('rain', JSON.stringify(res));
}
// ---- fertiliser dependence
{
  const res = {};
  for (const fert of [0, 1, 2]) {
    const { M, clock } = mk('fert', YEAR_DAYS * 2 + 12);
    const id = M.createField(sq(0, 0, 100, 100), { state: 'ploughed' });
    M.plantAll(id, 'wheat', 2);
    for (let i = 0; i < fert; i++) M.workField(id, 'fertilise');
    for (let d = 1; d <= 20; d++) { clock.day++; M.dayTick(clock.day, 6); }
    const s = M.stats(id); res[fert] = { g: s.growth, fert: s.fertility, weeds: s.weeds, yPerHa: s.expectedYieldPerHa };
  }
  console.log('fert', JSON.stringify(res));
}
// ---- yields vs table, ripe with forceStage, soil 0.6 default
{
  const out = {};
  for (const c of Object.keys(CROPS)) {
    const { M } = mk('y');
    const id = M.createField(sq(0, 0, 100, 100), { state: 'ploughed', soil: 0.6 });
    M.forceStage(id, 'ripe', c);
    const s = M.stats(id);
    const r = M.workField(id, 'harvest');
    out[c] = { table: CROPS[c].yieldT, expPerHa: s.expectedYieldPerHa, harvT_ha: +(r.yieldKg / 1000 / s.ha).toFixed(2), item: r.item, mownKg: r.mownKg };
  }
  console.log('yields', JSON.stringify(out));
}
// ---- large farm: 20 fields × 3 ha = 60 ha, daily tick cost
{
  const { M, clock } = mk('big', YEAR_DAYS * 2 + 12);
  const crops = Object.keys(CROPS);
  for (let i = 0; i < 20; i++) { const id = M.createField(sq((i % 5) * 200, Math.floor(i / 5) * 160, 190, 158)); M.plantAll(id, crops[i % crops.length], 2); }
  const cells = M.W.fields.reduce((a, f) => a + f.nCells, 0), ha = M.W.fields.reduce((a, f) => a + f.area, 0) / 1e4;
  const t = [];
  for (let d = 1; d <= 10; d++) { clock.day++; const t0 = performance.now(); M.beginDay(clock.day, 5); let steps = 0, worst = 0; while (M.pendingDay() != null) { const s0 = performance.now(); M.stepDay(4000); worst = Math.max(worst, performance.now() - s0); steps++; } t.push([+(performance.now() - t0).toFixed(1), steps, +worst.toFixed(2)]); }
  console.log('bigfarm', { ha: ha.toFixed(1), cells, perDay_ms_steps_worstStep: t.slice(2) });
  const s0 = JSON.stringify(M.save()).length; console.log('save KB', (s0 / 1024).toFixed(0));
}
