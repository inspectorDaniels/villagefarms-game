// Paid contract jobs from seeded NPC neighbours.
import { JOB_TYPES, CLIENTS, CROPS, ITEMS, CONST, YEAR_DAYS, MONTH_DAYS } from './data.js';

const PRESENCE = ['animalCare', 'shopHelp', 'villageWork'];
const AREA = ['plough', 'sow', 'harvest', 'mow'];
const CROP_FOR = {
  sow: ['wheat', 'barley', 'maize', 'sugarBeet', 'oats'],
  harvest: ['wheat', 'barley', 'rapeseed', 'maize', 'potatoes', 'sugarBeet', 'oats'],
};

export function installJobs(sim) {
  const J = sim.world.jobs;
  const api = sim.api;

  function initJobs() {
    J.list = [];
    J.nextId = 1;
    J.clients = {};
    for (const c of CLIENTS) J.clients[c.name] = { rep: 0.5, done: 0, failed: 0 };
    J.reputation = 0.5;
    J.stats = { offered: 0, completed: 0, failed: 0, expired: 0, earned: 0 };
  }

  const find = (id) => J.list.find((j) => j.id === id);
  const month = (day) => Math.floor((((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / MONTH_DAYS);
  const pub = (j) => ({ ...j, from: j.from && { ...j.from }, to: j.to && { ...j.to } });

  function place(spOrParcel) {
    if (!spOrParcel) return null;
    if (spOrParcel.poly) return { kind: 'parcel', id: spOrParcel.id, name: spOrParcel.name, x: spOrParcel.center[0], y: spOrParcel.center[1] };
    return { kind: 'sellPoint', id: spOrParcel.id, name: spOrParcel.name, x: spOrParcel.x, y: spOrParcel.y };
  }

  function makeOffer(day, rng) {
    const m = month(day);
    const weather = sim.world.environment && sim.world.environment.weather;
    const snowy = weather && weather.kind === 'snow';
    const types = Object.entries(JOB_TYPES).map(([k, t]) => [k, t.months[m] * (k === 'snowClear' ? (snowy ? 4 : 0.5) : 1)]).filter((x) => x[1] > 0);
    const type = rng.weighted(types);
    const T = JOB_TYPES[type];
    const village = type === 'shopHelp' || type === 'villageWork' || type === 'snowClear' || type === 'deliver';
    const pool = CLIENTS.filter((c) => (village ? c.kind === 'village' : c.kind === 'farm'));
    const client = rng.pick(pool);
    const rec = J.clients[client.name] || (J.clients[client.name] = { rep: 0.5, done: 0, failed: 0 });
    const npcParcels = sim.world.land.parcels.filter((p) => p.state === 'npc');
    const sps = Object.values(sim.world.economy.sellPoints || {});

    const job = {
      id: `simulation:job:${J.nextId++}`, type, client: client.name, clientFarm: client.farm,
      unit: T.unit, requiresMachine: T.machine, progress: 0, status: 'offered', offeredDay: day,
      parcelId: null, from: null, to: null, crop: null, x: null, y: null, needs: T.needs || null,
    };
    let amount = rng.range(T.amount[0], T.amount[1]);
    let km = 0;
    if (AREA.includes(type) && npcParcels.length) {
      const p = rng.pick(npcParcels);
      job.parcelId = p.id; job.x = p.center[0]; job.y = p.center[1];
      amount = Math.max(0.3, p.area / 1e4);
      job.to = place(p);
    } else if (AREA.includes(type) || PRESENCE.includes(type) || type === 'snowClear') {
      job.to = { kind: 'farm', name: client.farm }; // always somewhere to go
    }
    if (type === 'sow' || type === 'harvest') {
      const opts = CROP_FOR[type].filter((c) => (type === 'sow' ? CROPS[c].sowMonths : CROPS[c].harvestMonths).includes(m));
      job.crop = opts.length ? rng.pick(opts) : rng.pick(CROP_FOR[type]);
    }
    if (type === 'transport') {
      const crop = rng.pick(['wheat', 'barley', 'maize', 'potatoes', 'sugarBeet', 'straw', 'hay']);
      job.crop = crop;
      const src = npcParcels.length ? rng.pick(npcParcels) : null;
      const dsts = sps.filter((s) => !s.accepts || s.accepts.includes(crop));
      const dst = dsts.length ? rng.pick(dsts) : (sps.length ? rng.pick(sps) : null);
      job.from = place(src) || { kind: 'farm', name: client.farm };
      job.to = place(dst) || { kind: 'place', name: 'Coöperatie depot' };
      if (job.from.x != null && job.to.x != null) {
        const d = Math.hypot(job.to.x - job.from.x, job.to.y - job.from.y);
        km = 1.5 + (d / 1000) * 1.4; // by road, plus the yard-to-gate part
      }
      else km = 3;
      if (crop === 'sugarBeet' || crop === 'potatoes') amount *= 1.6;
      job.x = job.from.x; job.y = job.from.y;
    }
    if (type === 'deliver') {
      const src = sps.length ? rng.pick(sps) : null;
      job.from = place(src) || { kind: 'place', name: 'Landbouwaanvoer Ter Beek' };
      job.to = { kind: 'farm', name: client.farm };
      amount = Math.round(amount);
      job.cargo = rng.pick(['fence posts', 'feed pellets', 'seed potatoes', 'lime', 'bagged fertiliser', 'a workbench', 'barrels of cider']);
    }
    if (PRESENCE.includes(type) || type === 'snowClear') amount = Math.round(amount * 2) / 2;
    job.amount = type === 'transport' ? Math.round(amount) : +amount.toFixed(type === 'deliver' ? 0 : 1);

    const repMult = 0.92 + 0.16 * rec.rep;
    const unitRate = type === 'transport' ? T.rate + T.perTkm * km : T.rate;
    let pay = unitRate * job.amount * repMult * (1 + T.spread * (rng.float() * 2 - 1));
    if (type === 'harvest' && (job.crop === 'potatoes' || job.crop === 'sugarBeet')) { pay *= 1.6; job.needs = 'harvester'; } // lifting roots
    if (km) job.km = +km.toFixed(1);
    job.pay = Math.max(40, Math.round(pay / 5) * 5);
    const quick = PRESENCE.includes(type) || type === 'snowClear';
    job.deadlineDay = day + (quick ? rng.int(1, 2) : rng.int(2, 4));
    job.expiresDay = Math.min(job.deadlineDay - 1, day + rng.int(1, 3));
    if (quick) job.expiresDay = day + 1;
    job.title = titleFor(job);
    J.list.push(job);
    J.stats.offered++;
    sim.world.economy.version++;
    sim.emit('jobs:offered', pub(job));
    return job;
  }

  function titleFor(j) {
    const T = JOB_TYPES[j.type];
    const cropName = j.crop ? (CROPS[j.crop] ? CROPS[j.crop].name : (ITEMS[j.crop] || {}).name || j.crop).toLowerCase() : '';
    switch (j.type) {
      case 'plough': return `Plough ${j.amount.toFixed(1)} ha`;
      case 'sow': return `Drill ${j.amount.toFixed(1)} ha of ${cropName}`;
      case 'harvest': return `${j.crop === 'potatoes' || j.crop === 'sugarBeet' ? 'Lift' : 'Combine'} ${j.amount.toFixed(1)} ha of ${cropName}`;
      case 'mow': return `Mow ${j.amount.toFixed(1)} ha of grass`;
      case 'transport': return `Haul ${j.amount} t of ${cropName}`;
      case 'deliver': return `Deliver ${j.cargo}`;
      case 'snowClear': return `Clear snow, ${j.amount} h`;
      default: return `${T.title}, ${j.amount} h`;
    }
  }

  function settleRep(j, delta) {
    const c = J.clients[j.client];
    // diminishing returns on success, sharp loss on failure; see jobsDay for the slow decay toward neutral
    if (c) { c.rep = Math.max(0, Math.min(1, delta > 0 ? c.rep + delta * (1 - c.rep) : c.rep + delta)); if (delta > 0) c.done++; else c.failed++; }
    J.reputation = Math.max(0, Math.min(1, delta > 0 ? J.reputation + 0.03 * (1 - J.reputation) : J.reputation - 0.08));
  }

  Object.assign(api, {
    /** filter: status string, {status,type,client,requiresMachine}, or predicate */
    jobs(filter) {
      let list = J.list;
      if (typeof filter === 'string') list = list.filter((j) => j.status === filter);
      else if (typeof filter === 'function') list = list.filter((j) => filter(pub(j)));
      else if (filter && typeof filter === 'object') list = list.filter((j) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(j[k]) : j[k] === v)));
      return list.map(pub);
    },
    acceptJob(id) {
      const j = find(id);
      if (!j || j.status !== 'offered') return false;
      if (J.list.filter((x) => x.status === 'accepted').length >= CONST.maxActiveJobs) return false;
      j.status = 'accepted'; j.acceptedDay = sim.today();
      sim.world.economy.version++;
      sim.emit('jobs:accepted', pub(j));
      return true;
    },
    /** add delta (0..1) of progress; completes automatically at 1. Returns new progress. */
    reportProgress(id, delta) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || !Number.isFinite(delta)) return j ? j.progress : 0;
      j.progress = Math.max(0, Math.min(1, j.progress + delta));
      if (j.progress >= 0.9999) api.completeJob(id);
      return j.progress;
    },
    /** presence jobs: count gameSeconds spent at the job site */
    tickPresence(id, gameSeconds) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || !(gameSeconds > 0)) return j ? j.progress : 0;
      const need = (j.unit === 'h' ? j.amount : 2) * 3600;
      return api.reportProgress(id, gameSeconds / need);
    },
    /** pays out (pro-rata if ≥ 90 % done). Returns € paid, 0 if not completable. */
    completeJob(id) {
      const j = find(id);
      if (!j || j.status !== 'accepted' || j.progress < 0.9) return 0;
      const early = sim.today() < j.deadlineDay;
      const paid = Math.round(j.pay * Math.min(1, j.progress) * (early ? 1.05 : 1));
      j.status = 'completed'; j.completedDay = sim.today(); j.paid = paid; j.progress = Math.min(1, j.progress);
      api.credit(paid, 'jobs', `${j.title} for ${j.clientFarm}${early ? ' (early bonus)' : ''}`);
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

  function jobsDay(day) {
    for (const j of J.list) {
      if (j.status === 'offered' && day > j.expiresDay) { j.status = 'expired'; J.stats.expired++; }
      else if (j.status === 'accepted' && day > j.deadlineDay) api.failJob(j.id);
    }
    // archive finished jobs after 12 days
    J.list = J.list.filter((j) => !((j.status === 'expired' && day - j.expiresDay > 2) || ((j.status === 'completed' || j.status === 'failed') && day - (j.completedDay || j.failedDay || day) > 12)));
    const rng = sim.rngFor('jobs:' + day);
    const open = J.list.filter((j) => j.status === 'offered').length;
    if (((day % YEAR_DAYS) + YEAR_DAYS) % MONTH_DAYS === 0) { // monthly drift back toward neutral
      J.reputation += (0.5 - J.reputation) * 0.04;
      for (const c of Object.values(J.clients)) c.rep += (0.5 - c.rep) * 0.04;
    }
    let n = rng.weighted([[2, 3], [3, 3], [4, 1.5]]) + (J.reputation > 0.8 && rng.chance(0.5) ? 1 : 0);
    n = Math.min(n, CONST.maxOpenOffers - open);
    for (let i = 0; i < n; i++) makeOffer(day, rng);
  }

  sim.jobs = { initJobs, jobsDay, makeOffer };
}
