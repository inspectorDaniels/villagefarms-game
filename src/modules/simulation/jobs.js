// Paid contract jobs from seeded NPC neighbours.
// r3: offers are sized from workRates() — player-sized (≈5–20 real minutes of the player's own
// driving/walking) or crew-sized (≈1–2 hand-days, meant to be delegated with assignJob). Every job has
// world coordinates. Jobs assigned to a hired hand are worked by the simulation at the AI rate.
import { JOB_TYPES, CLIENTS, CROPS, ITEMS, CONST, YEAR_DAYS, MONTH_DAYS } from './data.js';
import { haPerGameHour, haulTripHours } from './work.js';
import { hashString } from './util.js';

const PRESENCE = ['animalCare', 'shopHelp', 'villageWork'];
const AREA = ['plough', 'sow', 'harvest', 'mow'];
const CROP_FOR = {
  sow: ['wheat', 'barley', 'maize', 'sugarBeet', 'oats'],
  harvest: ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'oats'],
};
const ROOTS = ['potatoes', 'sugarBeet'];
const h01 = (s) => hashString(String(s)) / 4294967296;

export function installJobs(sim) {
  const J = sim.world.jobs;
  const api = sim.api;

  function initJobs() {
    J.list = [];
    J.nextId = 1;
    J.clients = {};
    J.clientFarms = J.clientFarms || {};
    for (const c of CLIENTS) J.clients[c.name] = { rep: 0.5, done: 0, failed: 0 };
    J.reputation = 0.5;
    J.stats = { offered: 0, completed: 0, failed: 0, expired: 0, earned: 0, delegated: 0 };
  }

  const find = (id) => J.list.find((j) => j.id === id);
  const month = (day) => Math.floor((((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / MONTH_DAYS);
  const pub = (j) => ({ ...j, from: j.from && { ...j.from }, to: j.to && { ...j.to } });
  const E = () => sim.world.economy;
  const owned = (cat) => (E().assets || []).filter((a) => a.mode === 'owned' && a.category === cat);
  const hands = () => (E().workers || []).length;
  const bounds = () => sim.world.bounds || { w: 1024, h: 1024 };

  function place(spOrParcel) {
    if (!spOrParcel) return null;
    if (spOrParcel.poly) return { kind: 'parcel', id: spOrParcel.id, name: spOrParcel.name, x: spOrParcel.center[0], y: spOrParcel.center[1] };
    return { kind: 'sellPoint', id: spOrParcel.id, name: spOrParcel.name, x: spOrParcel.x, y: spOrParcel.y };
  }
  /** a deterministic point inside the world (keeps 12 % off the edges) */
  function hashedPoint(key) {
    const b = bounds();
    return { x: Math.round(b.w * (0.12 + 0.76 * h01('x:' + key))), y: Math.round(b.h * (0.12 + 0.76 * h01('y:' + key))) };
  }
  /** where a client's farm is: defineClientFarm, else a parcel they own, else a hashed point */
  function clientFarm(client) {
    const f = J.clientFarms[client.name];
    if (f) return { kind: 'farm', name: client.farm, x: f.x, y: f.y };
    const own = sim.world.land.parcels.filter((p) => p.owner === client.name);
    if (own.length) { const p = own[Math.floor(h01(client.name) * own.length)]; return { kind: 'farm', name: client.farm, x: p.center[0], y: p.center[1] }; }
    return { kind: 'farm', name: client.farm, ...hashedPoint(client.name) };
  }

  // ---------- sizing from workRates() ----------
  const rates = () => sim.rates;
  function playerTier() { return Math.max(1, ...owned('tractor').map((a) => (a.meta && a.meta.tier) || 1)); }
  function opOf(type, crop) { return type === 'harvest' ? (ROOTS.includes(crop) ? 'lift' : 'harvest') : type; }
  function combineId() { return owned('combine').some((a) => a.itemId === 'combine_l') ? 'combine_l' : 'combine_s'; }
  /** ha per game hour for this job's operation by 'player' | 'ai' */
  function areaRate(j, who) {
    const tier = j.type === 'plough' || j.type === 'sow' ? Math.min(playerTier(), owned('tillage').some((a) => a.meta && a.meta.size === 2) ? 3 : 1) : playerTier();
    return haPerGameHour(rates(), j.op, who, tier, combineId());
  }
  /** game hours of work for the rest of this job by 'player' | 'ai' */
  function workHours(j, who) {
    const left = 1 - (j.progress || 0);
    const R = rates();
    if (AREA.includes(j.type)) { const r = areaRate(j, who); return r > 0 ? (j.amount * left) / r : Infinity; }
    if (j.type === 'transport' || j.type === 'deliver') {
      const trips = j.type === 'transport' ? Math.ceil(j.amount / R.kit.haul.trailerT) : j.amount;
      const realH = trips * haulTripHours(j.km || 3);
      return (who === 'player' ? realH * R.clockScale : realH / R.aiWorkFactor) * left;
    }
    return (j.unit === 'h' ? j.amount : 4) * left; // presence / snow: game hours either way
  }

  function makeOffer(day, rng) {
    const m = month(day);
    const weather = sim.world.environment && sim.world.environment.weather;
    const snowy = weather && weather.kind === 'snow';
    const types = Object.entries(JOB_TYPES).map(([k, t]) => [k, t.months[m] * (k === 'snowClear' ? (snowy ? 4 : 0.5) : t.machine ? 1 : 0.45)]).filter((x) => x[1] > 0);
    const type = rng.weighted(types);
    const T = JOB_TYPES[type];
    const village = type === 'shopHelp' || type === 'villageWork' || type === 'snowClear' || type === 'deliver';
    const pool = CLIENTS.filter((c) => (village ? c.kind === 'village' : c.kind === 'farm'));
    const client = rng.pick(pool);
    const rec = J.clients[client.name] || (J.clients[client.name] = { rep: 0.5, done: 0, failed: 0 });
    const npc = sim.world.land.parcels.filter((p) => p.state === 'npc');
    const theirs = npc.filter((p) => p.owner === client.name);
    const sps = Object.values(E().sellPoints || {});
    const farm = clientFarm(client);
    // crew-sized offers become more common with more hands (and with reputation)
    const crew = T.machine && type !== 'snowClear' && rng.chance(Math.min(0.75, 0.3 + 0.15 * Math.min(CONST.marketHands, hands()) + 0.2 * Math.max(0, J.reputation - 0.5)));

    const job = {
      id: `simulation:job:${J.nextId++}`, type, client: client.name, clientFarm: client.farm,
      unit: T.unit, requiresMachine: T.machine, progress: 0, status: 'offered', offeredDay: day,
      parcelId: null, from: null, to: null, crop: null, x: farm.x, y: farm.y, needs: T.needs || null, op: type,
      crew, assignee: null,
    };
    if (type === 'sow' || type === 'harvest') {
      const opts = CROP_FOR[type].filter((c) => (type === 'sow' ? CROPS[c].sowMonths : CROPS[c].harvestMonths).includes(m));
      job.crop = opts.length ? rng.pick(opts) : rng.pick(CROP_FOR[type]);
    }
    job.op = opOf(type, job.crop);
    if (job.op === 'lift') job.needs = 'harvester';
    let km = 0;
    if (AREA.includes(type)) {
      const p = theirs.length ? rng.pick(theirs) : npc.length ? rng.pick(npc) : null;
      if (p) { job.parcelId = p.id; job.x = p.center[0]; job.y = p.center[1]; job.to = place(p); } else job.to = { ...farm };
      // area from the rates: player-sized = 5–20 real minutes of the player's own driving; crew-sized = 8–20 hand-hours
      const r = crew ? areaRate(job, 'ai') * rng.range(8, 20) : areaRate(job, 'player') * rng.range(5, 20);
      job.amount = Math.max(0.1, +r.toFixed(2));
      if (p) job.amount = Math.min(job.amount, Math.max(0.1, +(p.area / 1e4).toFixed(2)));
    } else if (type === 'transport') {
      const crop = rng.pick(['wheat', 'barley', 'maize', 'potatoes', 'sugarBeet', 'straw', 'hay']);
      job.crop = crop;
      const src = theirs.length ? rng.pick(theirs) : npc.length ? rng.pick(npc) : null;
      const dsts = sps.filter((s) => !s.accepts || s.accepts.includes(crop));
      const dst = dsts.length ? rng.pick(dsts) : sps.length ? rng.pick(sps) : null;
      job.from = place(src) || { ...farm };
      job.to = place(dst) || { kind: 'place', name: 'Coöperatie depot', ...hashedPoint('depot') };
      km = 1.5 + (Math.hypot(job.to.x - job.from.x, job.to.y - job.from.y) / 1000) * 1.4; // by road, plus yard-to-gate
      const load = CONSTS_LOAD(crop);
      job.amount = Math.round(crew ? load * rng.int(3, 7) : load * rng.range(0.6, 1));
      job.x = job.from.x; job.y = job.from.y;
    } else if (type === 'deliver') {
      const src = sps.length ? rng.pick(sps) : null;
      job.from = place(src) || { kind: 'place', name: 'Landbouwaanvoer Ter Beek', ...hashedPoint('supplier') };
      job.to = { ...farm };
      km = 1.5 + (Math.hypot(job.to.x - job.from.x, job.to.y - job.from.y) / 1000) * 1.4;
      job.amount = crew ? rng.int(2, 4) : 1;
      job.cargo = rng.pick(['fence posts', 'feed pellets', 'seed potatoes', 'lime', 'bagged fertiliser', 'a workbench', 'barrels of cider']);
      job.x = job.from.x; job.y = job.from.y;
    } else {
      job.to = { ...farm };
      job.amount = Math.round(rng.range(4, 12) * 2) / 2;
    }
    if (km) job.km = +km.toFixed(1);

    const repMult = (0.92 + 0.16 * rec.rep) * (crew ? crewPayMult(day) : 1);
    const unitRate = type === 'transport' ? T.rate + T.perTkm * km : T.rate;
    let pay = unitRate * job.amount * repMult * (1 + T.spread * (rng.float() * 2 - 1));
    if (job.op === 'lift') pay *= 1.6;
    if (T.machine && type !== 'snowClear') pay += rng.range(CONST.callout[0], CONST.callout[1]); // the trip is paid too
    job.pay = Math.max(40, Math.round(pay / 5) * 5);
    job.estPlayerMin = Math.round(workHours(job, 'player')); // 1 game hour = 1 real minute at 60×
    job.estAiHours = +workHours(job, 'ai').toFixed(1);
    const quick = PRESENCE.includes(type) || type === 'snowClear';
    job.deadlineDay = day + (quick ? rng.int(1, 2) : crew ? Math.ceil(job.estAiHours / CONST.hoursPerDayHand) + rng.int(1, 3) : rng.int(1, 3));
    job.expiresDay = quick ? day + 1 : Math.min(job.deadlineDay - 1, day + rng.int(1, 3));
    job.title = titleFor(job);
    J.list.push(job);
    J.stats.offered++;
    E().version++;
    sim.emit('jobs:offered', pub(job));
    return job;
  }
  const CONSTS_LOAD = (crop) => (crop === 'straw' || crop === 'hay' ? 8 : 14); // t per trailer load

  function titleFor(j) {
    const T = JOB_TYPES[j.type];
    const cropName = j.crop ? (CROPS[j.crop] ? CROPS[j.crop].name : (ITEMS[j.crop] || {}).name || j.crop).toLowerCase() : '';
    const a = j.amount < 1 ? j.amount.toFixed(2) : j.amount.toFixed(1);
    switch (j.type) {
      case 'plough': return `Plough ${a} ha`;
      case 'sow': return `Drill ${a} ha of ${cropName}`;
      case 'harvest': return `${j.op === 'lift' ? 'Lift' : 'Combine'} ${a} ha of ${cropName}`;
      case 'mow': return `Mow ${a} ha of grass`;
      case 'transport': return `Haul ${j.amount} t of ${cropName}`;
      case 'deliver': return j.amount > 1 ? `Deliver ${j.amount} loads of ${j.cargo}` : `Deliver ${j.cargo}`;
      case 'snowClear': return `Clear snow, ${j.amount} h`;
      default: return `${T.title}, ${j.amount} h`;
    }
  }

  function settleRep(j, delta) {
    const c = J.clients[j.client];
    if (c) { c.rep = Math.max(0, Math.min(1, delta > 0 ? c.rep + delta * (1 - c.rep) : c.rep + delta)); if (delta > 0) c.done++; else c.failed++; }
    J.reputation = Math.max(0, Math.min(1, delta > 0 ? J.reputation + 0.03 * (1 - J.reputation) : J.reputation - 0.08));
  }
  const activeCap = () => CONST.jobCapBase + hands();
  const isWorker = (id) => typeof id === 'string' && id.startsWith('simulation:worker:');
  /** r4: the regional contract market saturates — the more crew work the farm already holds (accepted, or
   *  finished in the last 2 days), the less neighbours pay for the next crew job (−6 % each, floor −30 %) */
  function crewPayMult(day) {
    const c = J.list.filter((j) => j.crew && (j.status === 'accepted' || (j.status === 'completed' && day - j.completedDay <= 2))).length;
    return Math.max(1 - CONST.crewPayDropMax, 1 - CONST.crewPayDrop * c);
  }
  function progress(j, delta) {
    j.progress = Math.max(0, Math.min(1, j.progress + delta));
    if (j.progress >= 0.9999) api.completeJob(j.id);
    return j.progress;
  }

  Object.assign(api, {
    /** filter: status string, {status,type,client,requiresMachine,assignee}, or predicate */
    jobs(filter) {
      let list = J.list;
      if (typeof filter === 'string') list = list.filter((j) => j.status === filter);
      else if (typeof filter === 'function') list = list.filter((j) => filter(pub(j)));
      else if (filter && typeof filter === 'object') list = list.filter((j) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(j[k]) : j[k] === v)));
      return list.map(pub);
    },
    /** max accepted jobs at once: 2 + hired hands */
    activeJobCap() { return activeCap(); },
    acceptJob(id) {
      const j = find(id);
      if (!j || j.status !== 'offered') return false;
      if (J.list.filter((x) => x.status === 'accepted').length >= activeCap()) return false;
      j.status = 'accepted'; j.acceptedDay = sim.today();
      E().version++;
      sim.emit('jobs:accepted', pub(j));
      return true;
    },
    /** delegate an accepted (or offered → accepts it) job to a hired hand (worked by the sim at the AI rate),
     *  to another character id (caller reports progress), or null (back to the player) */
    assignJob(id, assigneeId) {
      const j = find(id);
      if (!j) return false;
      if (j.status === 'offered' && !api.acceptJob(id)) return false;
      if (j.status !== 'accepted') return false;
      if (assigneeId && String(assigneeId).startsWith('simulation:worker:') && !(E().workers || []).some((w) => w.id === assigneeId)) return false;
      j.assignee = assigneeId || null;
      if (j.assignee) J.stats.delegated++;
      E().version++;
      return true;
    },
    /** place a client's farm (job coordinates for their odd jobs, deliveries and hauls) */
    defineClientFarm(name, pos) {
      if (!name || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
      J.clientFarms[name] = { x: pos.x, y: pos.y };
      return true;
    },
    /** add delta (0..1) of progress; completes automatically at 1. Returns new progress. */
    reportProgress(id, delta) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || !Number.isFinite(delta)) return j ? j.progress : 0;
      if (isWorker(j.assignee)) return j.progress; // r4: a job delegated to a hand is worked by the sim only
      return progress(j, delta);
    },
    /** presence jobs: count gameSeconds spent at the job site */
    tickPresence(id, gameSeconds) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || !(gameSeconds > 0)) return j ? j.progress : 0;
      if (isWorker(j.assignee)) return j.progress;
      const need = (j.unit === 'h' ? j.amount : 2) * 3600;
      return progress(j, gameSeconds / need);
    },
    completeJob(id) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || j.progress < 0.9) return 0;
      const early = sim.today() < j.deadlineDay;
      const paid = Math.round(j.pay * Math.min(1, j.progress) * (early ? 1.05 : 1));
      j.status = 'completed'; j.completedDay = sim.today(); j.paid = paid; j.progress = Math.min(1, j.progress);
      api.credit(paid, 'jobs', `${j.title} — ${j.clientFarm}`);
      settleRep(j, 0.12);
      J.stats.completed++; J.stats.earned += paid;
      sim.emit('jobs:completed', pub(j));
      return paid;
    },
    failJob(id) {
      const j = find(id);
      if (!j || j.status !== 'accepted') return false;
      j.status = 'failed'; j.failedDay = sim.today();
      const penalty = Math.round(j.pay * 0.1);
      api.charge(penalty, 'penalty', `Missed deadline — ${j.title} for ${j.clientFarm}`, { force: true });
      settleRep(j, -0.15);
      J.stats.failed++;
      sim.emit('jobs:failed', pub(j));
      return true;
    },
    reputation() { return { overall: J.reputation, clients: JSON.parse(JSON.stringify(J.clients)) }; },
  });

  /** r4: hands work their delegated jobs. Daily mode (harness): the hours they did not log on `day`.
   *  Hourly mode (live game, opts.hours = 1): only while characters.isAvailable(workerId) says they are awake.
   *  Each job books its machines for that day by category (tractor + implement, or the combine). */
  function workDelegated(opts = {}) {
    const day = opts.day != null ? opts.day : sim.today();
    const W = E().workers || [];
    for (const w of W) {
      if (sim.isAvailable && sim.isAvailable(w.id) === false) continue;
      // r4c: an hour in which the player possessed this hand is his, not the delegated job's
      if (opts.hours != null && w.possessedAt != null && sim.now() - w.possessedAt < 3600) continue;
      // daily mode: what is left of his day; hourly (live) mode: the hand is on the delegated job this hour
      // (characters logs its own activity separately — the day is paid once either way)
      let free = opts.hours != null ? Math.min(opts.hours, CONST.hoursPerDayHand - (w.jobHoursToday || 0)) : CONST.hoursPerDayHand - (w.hoursToday || 0);
      const mine = J.list.filter((j) => j.status === 'accepted' && j.assignee === w.id).sort((a, b) => a.deadlineDay - b.deadlineDay);
      for (const j of mine) {
        if (free <= 0.05) break;
        if (j.requiresMachine) {
          const cats = [];
          if (j.op !== 'harvest') cats.push('tractor');
          if (j.needs && j.needs !== 'tractor') cats.push(j.needs);
          if (!cats.every((c) => canReserve(c, w.id, day))) continue;
          cats.forEach((c) => reserve(c, w.id, day));
        }
        const need = workHours(j, 'ai');
        if (!Number.isFinite(need) || need <= 0) continue;
        const h = Math.min(free, need);
        free -= h;
        api.logWork(w.id, h, 'job');
        w.delegatedToday = true;
        w.jobHoursToday = (w.jobHoursToday || 0) + h;
        if (j.unit === 'h') progress(j, h / Math.max(1e-6, j.amount));
        else progress(j, (h / need) * (1 - j.progress) + 1e-9);
      }
    }
  }
  function canReserve(cat, holder, day) {
    const R = sim.machineDay(day);
    return !!R.by[cat + '|' + holder] || (R.used[cat] || 0) < owned(cat).length;
  }
  function reserve(cat, holder, day) {
    const R = sim.machineDay(day);
    const key = cat + '|' + holder;
    if (R.by[key]) return;
    R.used[cat] = (R.used[cat] || 0) + 1; R.by[key] = 1;
  }

  function jobsDay(day) {
    for (const j of J.list) {
      if (j.status === 'offered' && day > j.expiresDay) { j.status = 'expired'; J.stats.expired++; }
      else if (j.status === 'accepted' && day > j.deadlineDay) api.failJob(j.id);
    }
    J.list = J.list.filter((j) => !((j.status === 'expired' && day - j.expiresDay > 2) || ((j.status === 'completed' || j.status === 'failed') && day - (j.completedDay || j.failedDay || day) > 12)));
    const rng = sim.rngFor('jobs:' + day);
    const open = J.list.filter((j) => j.status === 'offered').length;
    if (((day % YEAR_DAYS) + YEAR_DAYS) % MONTH_DAYS === 0) {
      J.reputation += (0.5 - J.reputation) * 0.04;
      for (const c of Object.values(J.clients)) c.rep += (0.5 - c.rep) * 0.04;
    }
    // more hands → the neighbours call you more (each hand ≈ +1.2 offers/day); still a limited market
    const h = hands();
    // r4: a finite valley — hands beyond the 3rd bring no extra offers, and the day's total is capped
    const hm = Math.min(CONST.marketHands, h);
    let n = rng.weighted([[2, 3], [3, 3], [4, 1.5]]) + (J.reputation > 0.8 && rng.chance(0.5) ? 1 : 0) + Math.floor(hm * 1.2 + rng.float());
    n = Math.min(n, CONST.maxOffersPerDay, CONST.maxOpenOffers + 2 * hm - open);
    for (let i = 0; i < n; i++) makeOffer(day, rng);
  }

  sim.jobs = { initJobs, jobsDay, makeOffer, workDelegated, workHours };
}
