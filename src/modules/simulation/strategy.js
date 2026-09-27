// Scripted players for balance testing (tests/progression.mjs) and for the showcase fast-forward.
// Everything goes through the public API. The farm-manager model (crew hours, machines, work windows,
// contractors, timeliness losses) lives here, not in the economy module itself.
import { CROPS, WORK, YEAR_DAYS, MONTH_DAYS, CLIENTS, JOB_TYPES } from './data.js';
import { hashString } from './util.js';

const h01 = (s) => hashString(String(s)) / 4294967296;
const doyOf = (d) => ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;

// ============================ the valley ============================
const NAMES = ['Kerkakker', 'Heiveld', 'Bergske', 'Meersen', 'Lindeveld', 'Hoge Kouter', 'Beekkant', 'Grote Kouter',
  'Vijverstuk', 'Broekweide', 'Molenveld', 'Suikerkouter', 'Kapelleveld', 'Zavelberg', 'Blokske', 'Leemputten',
  'Galgenveld', 'Rootput', 'Hazelaar', 'Steenakker', 'Veldeken', 'Paardenwei', 'Nieuwland', 'Kalvermeers',
  'Boomgaardveld', 'Dries', 'Hoogveld', 'Laag Veld', 'Schuurveld', 'Wijngaard', 'Hofstuk', 'Tiendeveld',
  'Pastorijveld', 'Ganzenweide', 'Zandberg', 'Dennenveld', 'Koeweide', 'Kasteelveld', 'Rozenveld', 'Molenakker',
  'Beukenveld', 'Keiberg', 'Kouterken', 'Braakveld', 'Achterveld', 'Hollestraat', 'Spiegelveld', 'Eikenveld'];
const LAYOUT = [
  [['woods', 2], ['p', 3], ['p', 1], ['p', 2], ['p', 1]],
  [['p', 2], ['p', 1], ['p', 2], ['p', 1], ['p', 3]],
  [['p', 1], ['p', 2], ['p', 1], ['village', 2], ['p', 2], ['p', 1]],
  [['p', 2], ['p', 1], ['yard', 1], ['p', 1], ['p', 2], ['p', 2]],
  [['p', 1], ['p', 2], ['start', 1], ['p', 2], ['p', 1], ['p', 2]],
  [['p', 3], ['p', 1], ['p', 2], ['p', 1], ['woods', 1], ['p', 1]],
  [['p', 2], ['p', 2], ['p', 1], ['p', 3], ['p', 1]],
];
const CW = 170, CH = 160, OX = 40, OY = 40, NI = 9, NJ = 7;

/** Defines the standard valley (≈ 157 ha in 49 parcels, 6 buyers). Returns { ids:{yard,start}, decor }. */
export function defineValley(api) {
  const C = (i, j) => {
    const edge = i === 0 || i === NI || j === 0 || j === NJ;
    return [OX + i * CW + (edge && (i === 0 || i === NI) ? 0 : (h01('cx' + i + ',' + j) - 0.5) * 36),
      OY + j * CH + (edge && (j === 0 || j === NJ) ? 0 : (h01('cy' + i + ',' + j) - 0.5) * 30)];
  };
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // vertical edges bow a little (both neighbours share the same bow); horizontal edges are straight
  const vmid = (i, j) => { const a = C(i, j), b = C(i, j + 1); const o = (i === 0 || i === NI) ? 0 : (h01('vm' + i + ',' + j) - 0.5) * 16; return [(a[0] + b[0]) / 2 + o, (a[1] + b[1]) / 2]; };
  const poly = (i, j, n, f0 = 0, f1 = 1) => {
    const top = [], bot = [];
    // top edge from x-fraction f0 to f1 of the span (only single cells are split)
    if (n === 1) { top.push(lerp2(C(i, j), C(i + 1, j), f0), lerp2(C(i, j), C(i + 1, j), f1)); bot.push(lerp2(C(i, j + 1), C(i + 1, j + 1), f0), lerp2(C(i, j + 1), C(i + 1, j + 1), f1)); }
    else { for (let k = i; k <= i + n; k++) { top.push(C(k, j)); bot.push(C(k, j + 1)); } }
    const pts = [...top];
    if (f1 === 1) pts.push(vmid(i + n, j));
    pts.push(...bot.reverse());
    if (f0 === 0) pts.push(vmid(i, j));
    return pts;
  };
  const ids = {};
  const decor = { woods: [], village: [], lanes: [], brook: [] };
  let nameI = 0, ownerI = 0;
  const farms = CLIENTS.filter((c) => c.kind === 'farm');
  const npc = (pts, key) => {
    const soil = 0.35 + 0.55 * h01('soil:' + key);
    const owner = farms[ownerI++ % farms.length].name;
    return api.defineParcel({ name: NAMES[nameI++ % NAMES.length], poly: pts, soil, state: 'npc', owner });
  };
  LAYOUT.forEach((row, j) => {
    let i = 0;
    for (const [kind, n] of row) {
      const key = i + ',' + j;
      if (kind === 'woods') decor.woods.push(poly(i, j, n));
      else if (kind === 'village') decor.village.push(poly(i, j, n));
      else if (kind === 'yard') {
        ids.yard = api.defineParcel({ name: 'Hoeve Ter Linde', poly: poly(i, j, 1, 0, 0.24), soil: 0.55, state: 'owned', tradeable: false });
        npc(poly(i, j, 1, 0.24, 1), key + 'b');
      } else if (kind === 'start') {
        ids.start = api.defineParcel({ name: 'Lindeveldje', poly: poly(i, j, 1, 0, 0.8), soil: 0.68, state: 'rented' });
        npc(poly(i, j, 1, 0.8, 1), key + 'b');
      } else npc(poly(i, j, n), key);
      i += n;
    }
  });
  const P = (i, j) => C(i, j);
  const sp = (id, name, i, j, accepts, bias) => api.defineSellPoint(id, { name, x: P(i, j)[0], y: P(i, j)[1], accepts, bias });
  sp('trader', 'Graanhandel Vermeulen', 0, 3, ['wheat', 'barley', 'oats', 'rapeseed', 'maize'], { wheat: 1.02, barley: 1.02, rapeseed: 1.03 });
  sp('coop', 'Coöperatie De Vallei', 9, 3, ['wheat', 'barley', 'oats', 'rapeseed', 'maize', 'straw', 'hay']);
  sp('dairy', 'Zuivel Maasland', 4, 0, ['milk']);
  sp('shop', 'Hoevewinkel Ter Linde', 4, 3, ['eggs', 'wool', 'potatoes', 'hay'], { eggs: 1.18, potatoes: 1.15, wool: 1.05 });
  sp('sugar', 'Suikerfabriek Ter Beek', 9, 7, ['sugarBeet']);
  sp('potato', 'Aardappelhandel Maes', 4, 7, ['potatoes', 'straw']);
  const line = (pts) => pts.map(([i, j]) => P(i, j));
  decor.lanes.push(line(Array.from({ length: NI + 1 }, (_, i) => [i, 3])));
  decor.lanes.push(line(Array.from({ length: NJ + 1 }, (_, j) => [4, j])));
  decor.lanes.push(line([[9, 3], [9, 4], [9, 5], [9, 6], [9, 7]]));
  for (let x = OX - 10; x <= OX + NI * CW + 10; x += 30) decor.brook.push([x, OY + 5.55 * CH + Math.sin(x * 0.012) * 26 + Math.sin(x * 0.041) * 7]);
  return { ids, decor };
}

// ============================ farm manager ============================
export const STRATEGY_INFO = {
  jobs: 'greedy jobs-only: takes every contract it can do, keeps the starting 2.4 ha, never invests',
  contractor: 'keeps the starting farm, picks the best-paying contracts, invests only in machines for contract work',
  smallfarm: 'rents up to ~12 ha, keeps the starter tractor, no hands, no land purchases',
  renter: 'rents every field offered it can afford and farm, never buys land',
  builder: 'rents early, buys land on a mortgage from the moment the bank allows, grows crew and machines',
};
const ROTATION = ['wheat', 'sugarBeet', 'wheat', 'barley', 'rapeseed'];
const HARVEST_PENALTY = 0.93;  // contractor combining comes late: −7 % yield
const TILLAGE_PENALTY = 0.96;  // late drilling by a contractor: −4 %
const DIESEL_LH = { 1: 11, 2: 17, 3: 24, combine: 28 };

/**
 * createManager(sim, { strategy, rng, ids, rotation?, jobs? }) → { setup(), day(d), fields, tasks, stats }
 * (jobs: false = never takes contract work; rotation overrides the default crop rotation)
 */
export function createManager(sim, opts) {
  const api = sim.api;
  const rng = opts.rng;
  const strat = opts.strategy || 'builder';
  const ROT = opts.rotation || ROTATION; // opts.rotation: e.g. ['wheat'] for the 5 ha wheat check
  const fields = new Map(); // parcelId -> { crop, stage, tasks }
  const tasks = [];          // {kind, fieldId, ha, hours, left, deadline}
  const jobWork = new Map(); // jobId -> hours left
  const M = { declined: 0, contractorSpend: 0, jobsDone: 0, overflow: [], hFarm: 0, hJobs: 0 }; // overflow: [day, € lost to lack of hands]

  // ---------- helpers ----------
  const owned = (cat) => api.assets().filter((a) => a.mode === 'owned' && a.category === cat);
  const tractorTiers = () => owned('tractor').map((a) => (a.meta && a.meta.tier) || 1).sort((a, b) => b - a);
  const hasLargeTillage = () => owned('tillage').some((a) => a.meta && a.meta.size === 2);
  const tillTier = () => Math.min(tractorTiers()[0] || 1, hasLargeTillage() ? 3 : 1);
  const combineRate = () => { const c = owned('combine').map((a) => a.itemId); return c.includes('combine_l') ? WORK.harvest.combine_l : c.includes('combine_s') ? WORK.harvest.combine_s : null; };
  const people = () => 1 + api.workers().length;
  const myParcels = () => api.parcels().filter((p) => p.state === 'owned' || p.state === 'rented');
  const farmedHa = () => myParcels().reduce((a, p) => a + p.area / 1e4, 0);
  const obligationsMonth = () => {
    const wages = api.workers().reduce((a, w) => a + w.wage * 3, 0);
    const rent = api.parcels().filter((p) => p.state === 'rented').reduce((a, p) => a + (p.lease ? p.lease.rentPerHaYear : p.rentPerHaYear) * p.area / 1e4 / 12, 0);
    const inst = api.loans().reduce((a, l) => a + l.monthly + l.balance * l.rate / 12, 0);
    return wages + rent + inst + 400;
  };
  const reserve = () => 3 * obligationsMonth() + 6000;
  const useDiesel = (litres) => { if (litres > 0) { api.buy('diesel', litres); api.removeInventory('diesel', litres); } };
  const contractor = (cost, memo) => { api.charge(cost, 'contractor', memo, { force: true }); M.contractorSpend += cost; };

  function buyMachine(id) {
    const c = api.catalog().find((x) => x.id === id);
    if (!c) return false;
    // pay cash when there is plenty above the reserve, otherwise dealer finance (25 % down)
    if (api.money() - reserve() >= c.price) return api.purchase(id);
    return api.purchase(id, { finance: true });
  }

  // ---------- fields & crop calendar ----------
  function ensureField(p) {
    if (fields.has(p.id)) return fields.get(p.id);
    // a new field starts with whichever rotation crop can be sown soonest
    const m = Math.floor(doyOf(sim.today()) / MONTH_DAYS);
    let crop = 'wheat', best = 99;
    for (const c of new Set(ROT)) for (const sm of CROPS[c].sowMonths) { const wait = (sm - m + 12) % 12; if (wait < best) { best = wait; crop = c; } }
    const f = { id: p.id, crop, rot: ROT.indexOf(crop), stage: 'fallow', factor: 1, yard: p.id === (opts.ids && opts.ids.yard) };
    fields.set(p.id, f);
    return f;
  }
  const windowEnd = (months, doy, d) => { const lastM = months[months.length - 1]; return d + (lastM * MONTH_DAYS + 2 - doy); };

  function plan(d) {
    const doy = doyOf(d), m = Math.floor(doy / MONTH_DAYS);
    const mine = new Set(myParcels().map((p) => p.id));
    for (const id of [...fields.keys()]) if (!mine.has(id)) { fields.delete(id); for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].fieldId === id) tasks.splice(i, 1); }
    for (const p of myParcels()) {
      const f = ensureField(p);
      if (f.yard) continue; // farmyard & orchard: not cropped
      const C = CROPS[f.crop], ha = p.area / 1e4;
      const has = (kind) => tasks.some((t) => t.fieldId === f.id && t.kind === kind);
      if (f.stage === 'fallow' && C.sowMonths.includes(m) && !has('tillage')) {
        const tier = tillTier();
        const h = ha * (WORK.plough[tier - 1] + WORK.sow[tier - 1]);
        tasks.push({ kind: 'tillage', fieldId: f.id, ha, hours: h, left: h, deadline: windowEnd(C.sowMonths.filter((x) => x >= m), doy, d), crop: f.crop });
      }
      if (f.stage === 'sown' && doy === (f.crop === 'sugarBeet' ? 10 : 7) && !f.cared) {
        f.cared = true;
        api.buyInputs(f.crop, ha, ['fertiliser', 'spray']) || api.charge(api.inputCost(f.crop).fertiliser * ha + api.inputCost(f.crop).spray * ha, 'fertiliser', 'Inputs on credit', { force: true });
        if (owned('sprayer').length) tasks.push({ kind: 'care', fieldId: f.id, ha, hours: ha * WORK.care, left: ha * WORK.care, deadline: d + 8 });
        else contractor(WORK.contractor.care * ha, `Spraying & spreading ${ha.toFixed(1)} ha (contractor)`);
      }
      if (f.stage === 'sown' && C.harvestMonths.includes(m) && d > f.sownDay + 6 && !has('harvest')) {
        if (f.crop === 'sugarBeet' || f.crop === 'potatoes') { // lifting is always contracted
          contractor(WORK.contractor.lift * ha, `Lifting ${ha.toFixed(1)} ha of ${C.name.toLowerCase()} (contractor)`);
          harvestField(f, p, 1);
        } else {
          const rate = combineRate();
          const h = rate ? ha * rate : 0;
          tasks.push({ kind: 'harvest', fieldId: f.id, ha, hours: h, left: h, deadline: windowEnd(C.harvestMonths.filter((x) => x >= m), doy, d), own: !!rate });
          if (!rate) { contractor(WORK.contractor.harvest * ha, `Combining ${ha.toFixed(1)} ha (contractor)`); tasks.pop(); harvestField(f, p, HARVEST_PENALTY); }
        }
      }
    }
  }

  function sow(f, p, factor) {
    api.buyInputs(f.crop, p.area / 1e4, ['seed']) || api.charge(api.inputCost(f.crop).seed * p.area / 1e4, 'seed', 'Seed on credit', { force: true });
    f.stage = 'sown'; f.sownDay = sim.today(); f.factor = factor; f.cared = false;
  }

  function harvestField(f, p, factor) {
    const C = CROPS[f.crop], ha = p.area / 1e4;
    const soilF = 0.82 + 0.36 * p.soil;
    const y = C.yield * ha * soilF * f.factor * factor * rng.range(0.86, 1.12);
    api.addInventory(C.product, y);
    // haul own grain: hours on the trailer (booked as a haul task), or a contractor
    if (C.straw) { const st = C.straw * ha * rng.range(0.85, 1.1); contractor(18 * st, `Baling ${st.toFixed(0)} t straw`); api.addInventory('straw', st); }
    if (owned('trailer').length) tasks.push({ kind: 'haul', fieldId: f.id, ha, hours: y * WORK.haulPerT, left: y * WORK.haulPerT, deadline: sim.today() + 3 });
    else contractor(4 * y, `Haulage ${y.toFixed(0)} t (contractor)`);
    f.stage = 'fallow';
    f.rot = (f.rot + 1) % ROT.length;
    f.crop = ROT[f.rot];
    sales.harvested(C.product);
  }

  // ---------- selling: spread over buyers and days, catch the carry ----------
  const sales = {
    ref: {},
    // sell ~20 % off the combine (cash flow), store the rest and sell into the carry: over several
    // days and across the best two buyers so no single buyer's price sags much
    harvested(item) {
      const r = this.ref[item];
      if (!r || sim.today() - r.day > 12) this.ref[item] = { day: sim.today(), p: quote(item) };
      this.sellSome(item, 0.2);
    },
    sellSome(item, frac) {
      const inv = api.inventory()[item] || 0;
      let left = inv * frac;
      const pts = api.sellPoints().filter((s) => !s.accepts || s.accepts.includes(item));
      pts.sort((a, b) => (api.price(item, b.id) || 0) - (api.price(item, a.id) || 0));
      for (const s of pts.slice(0, 2)) {
        if (left <= 0.05) break;
        const lot = Math.min(left, depthOf(item) * 0.3);
        api.sell(item, lot, s.id);
        left -= lot;
      }
    },
    daily(d) {
      const doy = doyOf(d);
      for (const [item, q] of Object.entries(api.inventory())) {
        if (item === 'diesel' || item === 'fertiliser' || q < 0.1) continue;
        const p = quote(item);
        if (p == null || api.price(item, bestPoint(item)) == null) continue;
        const ref = this.ref[item] ? this.ref[item].p : p;
        // the carry peaks a few weeks before the next harvest: clear the store then
        const harvestNear = CROPS_BY_PRODUCT[item] && CROPS_BY_PRODUCT[item].some((c) => { const k = doyOf(c.harvestMonths[0] * MONTH_DAYS - doy); return k >= 1 && k <= 7; });
        const needCash = api.money() < reserve() * 0.25;
        if (item === 'straw' || item === 'sugarBeet') this.sellSome(item, 1);
        else if (p >= ref * 1.1 || harvestNear) this.sellSome(item, 0.35);
        else if (needCash) this.sellSome(item, 0.25);
      }
    },
  };
  const quote = (item) => { const h = api.priceHistory(item); return h.length ? h[h.length - 1][1] : null; }; // market reference, no glut
  const depthOf = (item) => ({ wheat: 160, barley: 150, oats: 90, rapeseed: 80, maize: 160, potatoes: 250, sugarBeet: 3000, straw: 70, hay: 60 }[item] || 100);
  const bestPoint = (item) => {
    let best = null, bp = -1;
    for (const sp of api.sellPoints()) { const p = api.price(item, sp.id); if (p != null && p > bp) { bp = p; best = sp.id; } }
    return best;
  };

  // ---------- daily crew allocation ----------
  function work(d) {
    const P = people();
    const tractors = tractorTiers().length;
    let personH = P * WORK.hoursPerDay;
    let tractorH = Math.min(P, tractors) * WORK.hoursPerDay;
    let combineH = Math.min(P, owned('combine').length) * WORK.hoursPerDay;
    tasks.sort((a, b) => a.deadline - b.deadline);
    const tier = tillTier();
    for (const t of tasks) {
      const pool = t.kind === 'harvest' ? combineH : tractorH;
      const h = Math.min(t.left, pool, personH);
      if (h <= 0) continue;
      t.left -= h; personH -= h; M.hFarm += h;
      if (t.kind === 'harvest') { combineH -= h; useDiesel(h * DIESEL_LH.combine); } else { tractorH -= h; useDiesel(h * DIESEL_LH[tier]); }
    }
    // finished or overdue tasks
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      const f = fields.get(t.fieldId);
      const p = api.parcel(t.fieldId);
      const done = t.left <= 1e-6, overdue = d >= t.deadline;
      if (!done && !overdue) continue;
      tasks.splice(i, 1);
      if (!f || !p) continue;
      const rest = t.hours > 0 ? t.left / t.hours : 1;
      if (!done && t.hours > 0) M.overflow.push([d, rest * t.ha * (t.kind === 'harvest' ? WORK.contractor.harvest + 130 : t.kind === 'tillage' ? WORK.contractor.tillage + 70 : WORK.contractor.care)]);
      if (t.kind === 'tillage') {
        if (!done) contractor(WORK.contractor.tillage * t.ha * rest, `Ploughing & drilling ${(t.ha * rest).toFixed(1)} ha (contractor)`);
        sow(f, p, done ? 1 : 1 - (1 - TILLAGE_PENALTY) * rest);
      } else if (t.kind === 'harvest') {
        if (!done) contractor(WORK.contractor.harvest * t.ha * rest, `Combining ${(t.ha * rest).toFixed(1)} ha (contractor)`);
        harvestField(f, p, done ? 1 : 1 - (1 - HARVEST_PENALTY) * rest);
      } else if (t.kind === 'care' && !done) contractor(WORK.contractor.care * t.ha * rest, `Spraying ${(t.ha * rest).toFixed(1)} ha (contractor)`);
      else if (t.kind === 'haul' && !done) contractor(t.left / WORK.haulPerT * 4, 'Haulage (contractor)');
    }
    // contract jobs with what is left
    if (opts.jobs !== false) jobs(d, personH, tractorH, combineH);
  }

  function jobHours(j) {
    const tier = tillTier();
    switch (j.type) {
      case 'plough': return j.amount * WORK.plough[tier - 1];
      case 'sow': return j.amount * WORK.sow[tier - 1];
      case 'mow': return j.amount * WORK.mow[Math.min(3, tractorTiers()[0] || 1) - 1];
      case 'harvest': return combineRate() ? j.amount * combineRate() : Infinity;
      case 'transport': return j.amount * (WORK.haulPerT + WORK.haulPerTkm * (j.km || 3));
      case 'deliver': return j.amount * WORK.deliverPerLoad;
      default: return j.unit === 'h' ? j.amount : 4;
    }
  }
  const canDo = (j) => {
    if (!j.requiresMachine) return true;
    if (!tractorTiers().length) return false;
    if (j.needs === 'combine') return !!combineRate();
    if (j.needs === 'harvester') return false;
    if (j.needs === 'trailer') return owned('trailer').length > 0;
    if (j.needs === 'tillage') return owned('tillage').length > 0;
    return true;
  };

  function jobs(d, personH, tractorH, combineH) {
    // progress accepted jobs
    for (const j of api.jobs('accepted')) {
      if (!jobWork.has(j.id)) jobWork.set(j.id, jobHours(j));
      let left = jobWork.get(j.id);
      const pool = j.type === 'harvest' ? combineH : j.requiresMachine ? tractorH : personH;
      const h = Math.min(left, pool, personH);
      if (h <= 0) continue;
      personH -= h; left -= h; M.hJobs += h;
      if (j.type === 'harvest') combineH -= h; else if (j.requiresMachine) tractorH -= h;
      if (j.requiresMachine) useDiesel(h * (j.type === 'harvest' ? DIESEL_LH.combine : DIESEL_LH[tillTier()]));
      const total = jobHours(j);
      jobWork.set(j.id, left);
      if (j.unit === 'h') api.tickPresence(j.id, h * 3600);
      else api.reportProgress(j.id, h / total);
      if (left <= 1e-6) { jobWork.delete(j.id); M.jobsDone++; }
    }
    // take new ones that fit before their deadline, best €/hour first
    const offers = api.jobs('offered').filter(canDo).map((j) => ({ j, h: jobHours(j) })).filter((x) => x.h < 60);
    offers.sort((a, b) => b.j.pay / b.h - a.j.pay / a.h);
    for (const { j, h } of offers) {
      const active = api.jobs('accepted').length;
      if (active >= 3) break;
      const machineOffers = offers.some((x) => x.j.requiresMachine);
      if (strat !== 'jobs' && j.pay / h < (machineOffers ? 35 : 12)) continue; // odd jobs only when there is no machine work about
      const days = Math.max(1, j.deadlineDay - d);
      const budget = (j.requiresMachine ? Math.min(personH + days * 3, tractorH + days * 3) : personH + days * 3);
      if (h <= budget + days * WORK.hoursPerDay * 0.5) api.acceptJob(j.id);
      else M.declined += j.pay;
    }
  }

  // ---------- growth decisions (monthly) ----------
  // No scripted pace: growth is limited by cash/credit, by the crew's hours and by how much land
  // the market actually offers (a few listings at a time).
  const capacityHa = () => {
    const tier = hasLargeTillage() ? (tractorTiers()[0] || 1) : 1;
    return [8, 30, 45][tier - 1] * Math.min(people(), Math.max(1, tractorTiers().length)) + (combineRate() ? 10 : 0);
  };
  function grow(d) {
    const doy = doyOf(d);
    const ha = farmedHa();
    const tiers = tractorTiers();
    const cash = () => api.money() - reserve();
    const liquid = () => cash() + api.creditLimit();
    const small = strat === 'smallfarm';
    // seasonal operating credit: borrow against the credit line when cash runs low, repay when flush
    if (api.money() < reserve() * 0.6 && api.creditLimit() > 5000) api.takeLoan(Math.min(api.creditLimit(), Math.max(10000, reserve())), { months: 12 });
    // the builder spends its first year on contract work and the starter plot, as the brief's opening
    const firstYear = M.startDay != null && d - M.startDay < YEAR_DAYS;
    if (M.startDay == null) M.startDay = d;
    const farming = strat === 'renter' || small || (strat === 'builder' && !firstYear);
    const maxHa = small ? 12 : Infinity;
    // rent: only what the crew can work and the inputs + 3 months' rent are covered
    if (farming) {
      for (const id of api.landMarket().forRent) {
        const p = api.parcel(id);
        const pha = p.area / 1e4;
        const needs = 800 * pha + 3 * p.rentPerHaYear * pha / 12 + 8000;
        if (ha + pha > Math.min(maxHa, capacityHa() + 6)) continue;
        if (liquid() > needs && api.rentParcel(id)) break;
      }
    }
    // buy: builder takes a 15-year mortgage (75 %) and pays 25 % + fees from its own cash
    if (strat === 'builder' && !firstYear) {
      for (const id of api.landMarket().forSale) {
        const p = api.parcel(id);
        const own = p.price * (1 - 0.75 + 0.04);
        if (ha + p.area / 1e4 > capacityHa() + 12) continue;
        if (cash() > own + 800 * p.area / 1e4 && api.buyParcel(id, { mortgage: true })) break;
      }
      // a rented field that comes up for sale: buy it at the end of the lease instead of renting on
    }
    // machinery (dealer finance, 25 % down)
    const busy = strat === 'contractor' && M.declined > 6000;
    // repay short-term / unsecured debt when flush (shortest term first)
    const surplus = api.money() - reserve() * 2 - 20000;
    if (surplus > 0) for (const l of api.loans().filter((x) => !x.secured).sort((a, b) => a.months - b.months)) api.repayLoan(l.id, surplus);
    if (strat === 'jobs' || small) { M.declined = 0; return; } // never invests beyond the starter kit
    if (tiers[0] < 2 && (ha >= 8 || busy) && cash() > 26000) { if (buyMachine('tractor_t2')) buyMachine('tillage_l'); }
    if (tiers[0] === 2 && ha >= capacityHa() - 6 && cash() > 45000) buyMachine('tractor_t3');
    if (!owned('sprayer').length && ha >= 6 && cash() > 8000) buyMachine('sprayer');
    const cereals = myParcels().filter((p) => { const f = fields.get(p.id); return f && !f.yard && f.crop !== 'sugarBeet'; }).reduce((t, p) => t + p.area / 1e4, 0);
    if (!owned('combine').length && (cereals >= 22 || (strat === 'contractor' && busy)) && cash() > 25000) buyMachine('combine_s');
    // crew: hire a hand (plus a tractor) when last year's overflow to contractors / late work cost
    // more than ~60 % of a wage; let one go after 1.5 years with almost no overflow
    M.overflow = M.overflow.filter((o) => o[0] > d - YEAR_DAYS);
    const lost = M.overflow.reduce((t, o) => t + o[1], 0);
    const wageYear = 950 * YEAR_DAYS;
    const lastYear = api.summary(YEAR_DAYS).operatingNet;
    const outgrown = ha > capacityHa() - 4 && lastYear > 60000 && (api.landMarket().forRent.length + api.landMarket().forSale.length) > 0;
    if (farming && !small && (lost > 0.6 * wageYear || outgrown) && cash() > 20000 && api.workers().length < 3 && (!M.lastHire || d - M.lastHire >= YEAR_DAYS / 2)) {
      if (tractorTiers().length >= people() + 1 || buyMachine('tractor_t1')) { api.hireWorker(); M.lastHire = d; M.overflow = []; }
    } else if (api.workers().length && lost < 0.1 * wageYear && d - (M.lastHire || 0) > YEAR_DAYS * 1.5) { api.fireWorker(api.workers()[0].id); M.lastHire = d; }
    if (ha >= 90 && !owned('combine').some((a) => a.itemId === 'combine_l') && cash() > 120000) buyMachine('combine_l');
    M.declined = 0;
    if (doy === 6) M.haYearAgo = ha;
  }

  return {
    setup() {
      api.grantAsset('tractor_t1', { boughtDay: sim.today() - 360 });
      api.grantAsset('tillage_s', { boughtDay: sim.today() - 360 });
      api.grantAsset('trailer', { boughtDay: sim.today() - 360 });
    },
    day(d) {
      if (doyOf(d) % MONTH_DAYS === 0) grow(d);
      plan(d);
      work(d);
      sales.daily(d);
    },
    fields, tasks, stats: M,
  };
}

const CROPS_BY_PRODUCT = {};
for (const c of Object.values(CROPS)) (CROPS_BY_PRODUCT[c.product] || (CROPS_BY_PRODUCT[c.product] = [])).push(c);
export const _jobTypes = JOB_TYPES;
