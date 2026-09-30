import { createModel } from '../../src/modules/crops/model.js';
const ev = []; const W = {}; let t = 0;
const M = createModel(W, { seed: 'c', emit: (a, p) => ev.push([a, p]), sim: () => null, now: () => ({ t, day: 40, doy: 4 }), moistureAt: () => 0.5 });
const id = M.createField([[0, 0], [80, 0], [80, 60], [0, 60]], { state: 'stubble', parcelId: 'P' });
for (let i = 0; i < 24; i++) { for (let x = 1; x < 11; x += 1) { M.work('plough', x, 1, 3, Math.PI / 2); } for (let x = 1; x < 11; x += 1) M.work('cultivate', x, 1, 3, Math.PI / 2); t += 61; }
M.flush(t, true);
const sum = {}; for (const [a, p] of ev) if (a === 'crops:worked') sum[p.tool] = (sum[p.tool] || 0) + p.areaM2;
console.log('field m2', 4800, 'worked areaM2 by tool from a ~36 m² strip x24 passes:', sum);
