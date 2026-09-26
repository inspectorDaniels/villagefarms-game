// A scripted "typical small farmer" that plays the economy through the public API.
// Used by the showcase fast-forward (so the office board shows two real simulated years)
// and by the headless balance check.
import { CROPS, YEAR_DAYS } from './data.js';

export const STARTER_CATALOG = [
  { id: 'tractor_used', category: 'tractor', name: 'Used 95 hp tractor', price: 19500, upkeepPerDay: 7, leasePerDay: 85 },
  { id: 'tillage_set_used', category: 'implement', name: 'Used plough & drill', price: 6500, upkeepPerDay: 2.5, leasePerDay: 30 },
  { id: 'trailer_12t', category: 'trailer', name: '12 t tipping trailer', price: 8200, upkeepPerDay: 1.5, leasePerDay: 22 },
  { id: 'combine_small', category: 'combine', name: 'Compact combine', price: 145000, upkeepPerDay: 38, leasePerDay: 420 },
];

const DIESEL_PER = { plough: 24, sow: 12, mow: 8, transport: 0.7, deliver: 9, snowClear: 7 };

/**
 * opts: { parcelId, ha, crop='wheat', jobs=true, loan=26000, buyMachines=true, rng }
 * Returns a controller { day(d) } that acts on each day, plus yearly reports.
 */
export function createFarmer(sim, opts) {
  const api = sim.api;
  const crop = opts.crop || 'wheat';
  const C = CROPS[crop];
  const ha = opts.ha;
  const rng = opts.rng;
  const doJobs = opts.jobs !== false;
  const ownMachines = opts.buyMachines !== false;
  // own sprayer/spreader pass = diesel; otherwise a contractor at ~€25/ha
  const spreadCost = (l) => (ownMachines ? useDiesel(l * ha, 'pass') : api.charge(25 * ha, 'contractor', `Spraying/spreading ${ha.toFixed(1)} ha (contractor)`));
  const state = { stored: 0, harvestPrice: 0, sown: false, worker: null, log: [] };

  const useDiesel = (litres, why) => {
    if (litres <= 0) return;
    api.buy('diesel', litres);
    api.removeInventory('diesel', litres);
    state.log.push(why);
  };
  const bestPoint = (item) => {
    let best = null, bp = -1;
    for (const sp of api.sellPoints()) {
      if (sp.accepts && !sp.accepts.includes(item)) continue;
      const p = api.price(item, sp.id);
      if (p > bp) { bp = p; best = sp.id; }
    }
    return best;
  };

  function setup() {
    for (const c of STARTER_CATALOG) api.registerCatalogItem(c);
    if (opts.loan) api.takeLoan(opts.loan, { months: 60 });
    if (ownMachines) { api.purchase('tractor_used'); api.purchase('tillage_set_used'); }
    if (opts.parcelId) api.rentParcel(opts.parcelId);
    api.setCapacity(C.product, 60);
  }

  function farmDay(d) {
    const doy = ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    // winter wheat calendar (spring top-dressing → summer harvest → autumn drilling)
    if (doy === 7) { api.buyInputs(crop, ha, ['fertiliser']); spreadCost(4); }
    if (doy === 10) { api.charge(api.inputCost(crop).spray * ha * 0.5, 'spray', `Fungicide & herbicide, ${ha.toFixed(1)} ha`); spreadCost(3); }
    if (doy === 13) { api.charge(api.inputCost(crop).spray * ha * 0.5, 'spray', `Ear spray, ${ha.toFixed(1)} ha`); spreadCost(3); }
    if (doy === 21) {
      if (!state.worker && doJobs) state.worker = api.hireWorker().id; // extra hand while the boss is out contracting
      api.charge(165 * ha, 'contractor', `Combining ${ha.toFixed(1)} ha (contractor)`);
      const y = C.yield * rng.range(0.88, 1.12) * ha;
      api.addInventory(C.product, y);
      useDiesel(12 * ha, 'haul');
      const sp = bestPoint(C.product);
      state.harvestPrice = api.price(C.product, sp);
      api.sell(C.product, y * 0.5, sp); // sell half off the combine, store the rest
      state.stored = api.inventory()[C.product] || 0;
    }
    if (doy === 22 && C.straw) {
      api.charge(18 * C.straw * ha, 'contractor', `Baling straw, ${ha.toFixed(1)} ha`);
      api.addInventory('straw', C.straw * ha * rng.range(0.85, 1.1));
    }
    if (doy === 23) {
      if (state.worker) { api.fireWorker(state.worker); state.worker = null; }
      const s = api.inventory().straw || 0;
      if (s > 0) api.sell('straw', s, bestPoint('straw'));
    }
    if (doy === 27) { // plough + drill next year's wheat
      if (ownMachines) useDiesel(C.dieselL * 0.55 * ha, 'tillage');
      else api.charge(183 * ha, 'contractor', `Ploughing & drilling ${ha.toFixed(1)} ha (contractor)`);
      api.buyInputs(crop, ha, ['seed']);
    }
    // stored grain: sell once the carry pays ≥ 8 %, or before the next harvest at the latest
    const inv = api.inventory()[C.product] || 0;
    if (inv > 0.1 && doy !== 21) {
      const sp = bestPoint(C.product);
      const p = api.price(C.product, sp);
      if (p >= state.harvestPrice * 1.08 || doy === 18) api.sell(C.product, inv, sp);
    }
  }

  function jobsDay(d) {
    if (!doJobs) return;
    // finish yesterday's work (a farmhand is busy about one day per job; ~7 % slip past the deadline)
    for (const j of api.jobs('accepted')) {
      if (d < j.acceptedDay + 1) continue;
      if (rng.chance(0.07)) continue; // let it slide → may fail
      if (j.requiresMachine) useDiesel((DIESEL_PER[j.type] || 5) * j.amount, 'job');
      if (j.unit === 'h') api.tickPresence(j.id, j.amount * 3600);
      else api.reportProgress(j.id, 1);
    }
    const offers = api.jobs('offered').filter((j) => j.type !== 'harvest'); // no combine of our own
    offers.sort((a, b) => b.pay / (b.amount || 1) - a.pay / (a.amount || 1));
    const active = api.jobs('accepted');
    const mach = active.filter((j) => j.requiresMachine).length;
    const pres = active.filter((j) => !j.requiresMachine).length;
    const m = offers.find((j) => j.requiresMachine);
    if (m && mach < 1 && rng.chance(0.8)) api.acceptJob(m.id);
    const p = offers.find((j) => !j.requiresMachine);
    if (p && pres < 1 && rng.chance(0.6)) api.acceptJob(p.id);
  }

  return { setup, day(d) { farmDay(d); jobsDay(d); }, state };
}

/** Standard showcase valley: a patchwork of fields on a jittered grid with shared borders,
 * lanes along some grid lines, a brook, a wood and the village. Returns { ids, decor }. */
export function defineShowcaseValley(api) {
  const xs = [60, 225, 395, 560, 725, 890], ys = [70, 225, 380, 525, 670];
  const jit = (i, j, k) => ((Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453) % 1) * 22;
  const C = (i, j) => [xs[i] + (i > 0 && i < 5 ? jit(i, j, 1) : 0), ys[j] + (j > 0 && j < 4 ? jit(i, j, 2) : 0)];
  // shared, slightly bowed field edges (same midpoint for both neighbours)
  const mid = (a, b) => {
    const k = [a, b].sort().join('/');
    const [ax, ay] = C(...a), [bx, by] = C(...b);
    const o = ((Math.sin(k.length * 3.1 + ax * 0.37 + by * 0.21) * 9973) % 1) * 9;
    const nx = -(by - ay), ny = bx - ax, L = Math.hypot(nx, ny) || 1;
    return [(ax + bx) / 2 + (nx / L) * o, (ay + by) / 2 + (ny / L) * o];
  };
  const ring = (cells) => { // cells: list of [i,j] in one row, contiguous
    const i0 = cells[0][0], i1 = cells[cells.length - 1][0] + 1, j = cells[0][1];
    const pts = [];
    for (let i = i0; i < i1; i++) { pts.push(C(i, j)); pts.push(mid([i, j], [i + 1, j])); }
    pts.push(C(i1, j)); pts.push(mid([i1, j], [i1, j + 1]));
    for (let i = i1; i > i0; i--) { pts.push(C(i, j + 1)); pts.push(mid([i, j + 1], [i - 1, j + 1])); }
    pts.push(C(i0, j + 1)); pts.push(mid([i0, j + 1], [i0, j]));
    return pts;
  };
  const cell = (i, j, n = 1) => ring(Array.from({ length: n }, (_, k) => [i + k, j]));
  const ids = {};
  ids.kerk = api.defineParcel({ name: 'Kerkakker', poly: cell(0, 0, 2), soil: 0.78, state: 'npc', owner: 'Annelies De Smet' });
  ids.heide = api.defineParcel({ name: 'Heiveld', poly: cell(3, 0), soil: 0.5, state: 'npc', owner: 'Josée Lambert' });
  ids.berg = api.defineParcel({ name: 'Bergske', poly: cell(4, 0), soil: 0.66, state: 'forSale' });
  ids.meers = api.defineParcel({ name: 'Meersen', poly: cell(0, 1), soil: 0.42, state: 'forRent' });
  ids.linde = api.defineParcel({ name: 'Lindeveld', poly: cell(2, 1, 2), soil: 0.72, state: 'forRent' });
  ids.hoge = api.defineParcel({ name: 'Hoge Kouter', poly: cell(4, 1), soil: 0.8, state: 'npc', owner: 'Jef Vermeulen' });
  ids.beek = api.defineParcel({ name: 'Beekkant', poly: cell(0, 2), soil: 0.62, state: 'forSale' });
  ids.home = api.defineParcel({ name: 'Hoeve Ter Linde', poly: cell(1, 2), soil: 0.55, state: 'owned' });
  ids.kouter = api.defineParcel({ name: 'Grote Kouter', poly: cell(2, 2, 2), soil: 0.85, state: 'npc', owner: 'Luc Van den Broeck' });
  ids.vijver = api.defineParcel({ name: 'Vijverstuk', poly: cell(4, 2), soil: 0.58, state: 'npc', owner: 'Wim Claes' });
  ids.broek = api.defineParcel({ name: 'Broekweide', poly: cell(0, 3, 2), soil: 0.48, state: 'npc', owner: 'Marleen Peeters' });
  ids.molen = api.defineParcel({ name: 'Molenveld', poly: cell(2, 3), soil: 0.7, state: 'forRent' });
  ids.suiker = api.defineParcel({ name: 'Suikerkouter', poly: cell(3, 3, 2), soil: 0.82, state: 'npc', owner: 'Bart Goossens' });
  const P = (i, j) => C(i, j);
  api.defineSellPoint('trader', { name: 'Graanhandel Vermeulen', x: P(0, 2)[0], y: P(0, 2)[1], accepts: ['wheat', 'barley', 'oats', 'rapeseed', 'maize'], bias: { wheat: 1.025, barley: 1.02, rapeseed: 1.03 } });
  api.defineSellPoint('coop', { name: 'Coöperatie De Vallei', x: P(5, 2)[0], y: P(5, 2)[1], accepts: ['wheat', 'barley', 'oats', 'rapeseed', 'maize', 'straw', 'hay'] });
  api.defineSellPoint('dairy', { name: 'Zuivel Maasland', x: P(2, 0)[0], y: P(2, 0)[1], accepts: ['milk'] });
  api.defineSellPoint('shop', { name: 'Hoevewinkel Ter Linde', x: P(2, 2)[0], y: P(2, 2)[1], accepts: ['eggs', 'wool', 'potatoes', 'hay'], bias: { eggs: 1.18, potatoes: 1.15, wool: 1.05 } });
  api.defineSellPoint('sugar', { name: 'Suikerfabriek Ter Beek', x: P(5, 4)[0], y: P(5, 4)[1], accepts: ['sugarBeet'] });
  api.defineSellPoint('potato', { name: 'Aardappelhandel Maes', x: P(2, 4)[0], y: P(2, 4)[1], accepts: ['potatoes'] });
  const lane = (pts) => pts.map(([i, j]) => P(i, j));
  const brook = [];
  for (let x = 30; x <= 920; x += 30) brook.push([x, 646 + Math.sin(x * 0.021) * 9 + Math.sin(x * 0.057) * 3]);
  const decor = {
    lanes: [lane([[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2]]), lane([[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]]), lane([[5, 2], [5, 3], [5, 4]])],
    brook,
    woods: [cell(2, 0)],
    village: [cell(1, 1)],
  };
  return { ids, decor };
}
