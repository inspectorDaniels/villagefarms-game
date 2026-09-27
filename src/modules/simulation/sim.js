// Assembles the pure simulation (no DOM, no ctx): usable in-game, in the showcase fast-forward
// and in headless Node balance tests.
import { installEconomy } from './economy.js';
import { installMarket } from './market.js';
import { installLand } from './land.js';
import { installJobs } from './jobs.js';
import { installContractors } from './contractors.js';
import { buildWorkRates, AI_WORK_FACTOR } from './work.js';
import { DAY_SECONDS } from './data.js';

/**
 * env = { rngFor(name) → Rng, emit(type, payload), clockT() → game seconds, warn?(msg), aiWorkFactor? }
 */
export function createSim(world, env) {
  for (const ns of ['economy', 'land', 'jobs']) if (!world[ns]) world[ns] = {};
  const sim = { world, api: {}, virtualT: null, tOffset: 0 };
  sim.rngFor = env.rngFor;
  sim.emit = (type, payload) => { if (!sim.silent) env.emit(type, payload); };
  // tOffset shifts the economy's calendar relative to the game clock (showcase history years)
  sim.now = () => (sim.virtualT != null ? sim.virtualT : env.clockT() + sim.tOffset);
  sim.today = () => Math.floor(sim.now() / DAY_SECONDS);
  sim.blocked = () => false; // replaced by economy.js
  sim.rates = buildWorkRates(env.aiWorkFactor || AI_WORK_FACTOR);
  sim.isAvailable = env.isAvailable || null;
  sim.hasCropsFields = env.hasCropsFields || null; // r4c: optional crops.fields() lookup   // r4: optional characters.isAvailable(workerId)
  sim.hourlyDelegation = !!env.hourlyDelegation; // live game: hands work delegated jobs hour by hour

  installEconomy(sim);
  installMarket(sim);
  installLand(sim);
  installJobs(sim);
  installContractors(sim);

  /** wipe and initialise all three namespaces; pre-fills `historyDays` of market history before startDay */
  sim.reset = (startDay, opts = {}) => {
    sim.economy.initEconomy(opts);
    sim.market.initMarket();
    sim.land.initLand();
    sim.jobs.initJobs();
    sim.contractors.initContractors();
    const E = world.economy;
    const was = sim.virtualT;
    sim.silent = true;
    sim.market.warmUp(startDay, opts.historyDays != null ? opts.historyDays : 36);
    sim.silent = false;
    sim.virtualT = was;
    E.lastDay = startDay - 1;
  };

  /** run the daily processing for day `day` (absolute day index) */
  sim.processDay = (day) => {
    const E = world.economy;
    const prevT = sim.virtualT;
    if (prevT == null && day !== sim.today()) sim.virtualT = day * DAY_SECONDS + 60; // stamp catch-up days correctly
    sim.market.stepMarket(day);
    // live game: yesterday was worked hour by hour (clock:hour); fast-forwards (showcase, harness) and catch-ups work it here
    if (!sim.hourlyDelegation || prevT != null || day !== sim.today()) sim.jobs.workDelegated({ day: day - 1 }); // hands work delegated jobs with yesterday's unlogged hours …
    sim.land.landDay(day);
    sim.contractors.contractorDay(day);
    sim.economy.economyDay(day);       // … before their wages settle
    sim.jobs.jobsDay(day);
    E.lastDay = day;
    sim.virtualT = prevT;
    sim.emit('economy:price-changed', { day, prices: { ...E.prices } });
  };

  /** process every day between the last processed one and `day` (max 72 at once) */
  sim.catchUp = (day) => {
    const E = world.economy;
    if (E.lastDay == null) { E.lastDay = day; return 0; }
    let n = 0;
    if (day - E.lastDay > 72) {
      if (env.warn) env.warn(`economy: skipped ${day - E.lastDay - 72} unprocessed day(s) (catch-up is capped at 72)`);
      E.lastDay = day - 72;
    }
    while (E.lastDay < day) { sim.processDay(E.lastDay + 1); n++; }
    return n;
  };

  /** fast-forward helper: run fn(day) for each day with a virtual clock, processing days */
  sim.fastForward = (fromDay, toDay, perDay) => {
    const E = world.economy;
    for (let d = fromDay; d <= toDay; d++) {
      sim.virtualT = d * DAY_SECONDS + 6 * 3600;
      if (E.lastDay < d) sim.processDay(d);
      if (perDay) perDay(d);
    }
    sim.virtualT = null;
  };

  return sim;
}
