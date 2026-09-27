import { createSim } from '../sim.js';
import { createRng } from '../util.js';
import { defineValley, createManager } from '../strategy.js';
const seed = 'harvest-1', strat = process.argv[2] || 'renter', Y = +process.argv[3] || 6;
const world = { seed, economy: {}, land: {}, jobs: {} };
const sim = createSim(world, { rngFor: (n) => createRng(seed, 'simulation', n), emit: () => {}, clockT: () => 0 });
sim.reset(6); sim.virtualT = 6 * 86400;
const { ids } = defineValley(sim.api);
const mgr = createManager(sim, { strategy: strat, rng: createRng(seed, 's'), ids });
mgr.setup();
const a = sim.api;
for (let y = 0; y < Y; y++) {
  sim.fastForward(6 + y * 36, 6 + y * 36 + 35, (d) => mgr.day(d));
  sim.virtualT = (6 + y * 36 + 35) * 86400 + 80000;
  const s = a.summary(36);
  const ha = a.parcels().filter((p) => p.state === 'owned' || p.state === 'rented').reduce((t, p) => t + p.area / 1e4, 0);
  console.log(`Y${y + 1} ha ${ha.toFixed(1)} opNet ${Math.round(s.operatingNet)} inv ${JSON.stringify(Object.fromEntries(Object.entries(a.inventory()).map(([k, v]) => [k, Math.round(v)])))}`);
  console.log('   ' + Object.entries(s.byCategory).sort((x, z) => x[1] - z[1]).map(([k, v]) => `${k} ${Math.round(v)} (${Math.round(v / Math.max(1, ha))}/ha)`).join(', '));
}
console.log('fields', [...mgr.fields.values()].map((f) => f.crop + ':' + f.stage).join(' '));
