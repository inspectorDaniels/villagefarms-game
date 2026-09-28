// simulation — economy (money, ledger, market, loans, catalog, workers), land parcels, contract jobs.
// Pure logic lives in sim.js/economy.js/market.js/land.js/jobs.js; this file wires it to ctx.
import { createSim } from './sim.js';
import { YEAR_DAYS } from './data.js';
import { presets, fastForwardShowcase, createShowcaseView } from './showcase.js';

export const manifest = {
  id: 'simulation',
  wave: 1,
  deps: [],
  optionalDeps: ['environment'],
  namespaces: ['economy', 'land', 'jobs'],
  api: [
    // money
    'money', 'canAfford', 'charge', 'credit', 'ledger', 'summary', 'netWorth',
    // market
    'price', 'priceHistory', 'sell', 'buy', 'defineSellPoint', 'removeSellPoint', 'sellPoints', 'yieldTable', 'inputCost', 'buyInputs', 'workRates',
    // inventory
    'inventory', 'addInventory', 'removeInventory', 'setCapacity', 'storageRoom', 'bulkRoom',
    // catalog & assets
    'registerCatalogItem', 'catalog', 'purchase', 'lease', 'grantAsset', 'assets', 'releaseAsset',
    // loans
    'takeLoan', 'repayLoan', 'loans', 'creditLimit', 'solvency',
    // contractors (r3)
    'contractorQuote', 'hireContractor', 'contractorBookings', 'cancelContractor',
    // land
    'defineParcel', 'parcels', 'parcel', 'parcelAt', 'buyParcel', 'rentParcel', 'endLease', 'leaseExitCost', 'sellParcel', 'canUse', 'landMarket', 'recordFieldWork',
    // jobs
    'jobs', 'acceptJob', 'reportProgress', 'completeJob', 'failJob', 'tickPresence', 'reputation', 'assignJob', 'activeJobCap', 'defineClientFarm',
    // workers
    'hireWorker', 'fireWorker', 'workers', 'logWork', 'workerDayCost', 'reserveMachine', 'machinesFree', 'capShare',
    // time helper
    'today',
  ],
  emits: ['economy:transaction', 'economy:price-changed', 'economy:bankrupt-warning', 'economy:contractor-done', 'economy:asset-seized', 'economy:hands-laid-off', 'land:parcel-changed',
    'jobs:offered', 'jobs:accepted', 'jobs:completed', 'jobs:failed', 'jobs:reassigned'],
  listens: ['clock:day', 'clock:hour', 'crops:worked'],
};

const INSTANCES = new WeakMap(); // ctx → { sim, view }

export async function init(ctx) {
  const sim = createSim(ctx.world, {
    rngFor: (name) => ctx.rng(name),
    emit: (type, payload) => ctx.events.emit(type, payload),
    clockT: () => ctx.clock.t,
    warn: (msg) => ctx.warn(msg),
    hourlyDelegation: true,
    notify: (text, kind) => { const ui = ctx.modules.get('ui'); if (ui && typeof ui.toast === 'function') ui.toast(text, { kind: kind || 'info' }); },
    hasCropsFields: (parcelId) => {
      const cr = ctx.modules.get('crops');
      const fs = cr && typeof cr.fields === 'function' ? cr.fields() : null;
      return Array.isArray(fs) && fs.some((f) => f && f.parcelId === parcelId);
    },
    isAvailable: (workerId) => {
      const ch = ctx.modules.get('characters');
      if (!ch || typeof ch.isAvailable !== 'function') return true;
      const r = ch.isAvailable(workerId);
      return r !== false; // undefined (error / unknown) counts as available
    },
  });
  sim.reset(sim.today(), { historyDays: YEAR_DAYS });
  const inst = { sim, view: null };
  INSTANCES.set(ctx, inst);

  const catchUp = () => { if (sim.today() !== ctx.world.economy.lastDay) sim.catchUp(sim.today()); };
  ctx.events.on('clock:day', catchUp);
  // r4: CAP on the worked share — crops reports every worked area
  ctx.events.on('crops:worked', (e) => sim.onCropsWorked(e));
  // r4: delegated jobs are worked in daylight working hours, one game hour at a time
  ctx.events.on('clock:hour', () => {
    const h = ctx.clock.hour;
    if (h >= 7 && h < 17) { catchUp(); sim.jobs.workDelegated({ hours: 1 }); }
  });

  const api = { ...sim.api, today: () => sim.today() };
  return {
    api,
    update() { catchUp(); },
    save() {
      const w = ctx.world;
      return JSON.parse(JSON.stringify({ economy: w.economy, land: w.land, jobs: w.jobs, tOffset: sim.tOffset }));
    },
    load(d) {
      if (!d || !d.economy) return;
      for (const ns of ['economy', 'land', 'jobs']) {
        const tgt = ctx.world[ns];
        for (const k of Object.keys(tgt)) delete tgt[k];
        Object.assign(tgt, d[ns] || {});
      }
      sim.tOffset = d.tOffset || 0;
      ctx.world.economy.version = (ctx.world.economy.version || 0) + 1;
    },
  };
}

export const showcase = {
  deps: [],
  presets,
  async stage(ctx, presetName) {
    const inst = INSTANCES.get(ctx);
    if (!inst) return;
    fastForwardShowcase(ctx, inst.sim);
    inst.view = createShowcaseView(ctx, inst.sim);
    inst.view.setPreset(presetName);
    ctx.renderer.addLayer('screen', (g) => inst.view.drawLayer(g), -10);
    inst.view.prewarm();
  },
};
