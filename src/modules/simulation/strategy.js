// Scripted players for balance testing (tests/progression.mjs) and for the showcase fast-forward.
// Everything goes through the public API. The farm-manager model (crew hours, machines, work windows,
// contractors, timeliness losses) lives here, not in the economy module itself.
import { CROPS, YEAR_DAYS, MONTH_DAYS, CLIENTS, CONST } from './data.js';
import { haPerGameHour, haulTripHours } from './work.js';
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
const CW = 104, CH = 134, OX = 24, OY = 24, NI = 9, NJ = 7; // fits the 1024 m map (≈ 70 ha of fields)
const JIT = 0.6;

/** Defines the standard valley inside the 1024 m map (≈ 70 ha in 48 parcels, 6 buyers). Returns { ids:{yard,start}, decor }. */
export function defineValley(api) {
  const C = (i, j) => {
    const edge = i === 0 || i === NI || j === 0 || j === NJ;
    return [OX + i * CW + (edge && (i === 0 || i === NI) ? 0 : (h01('cx' + i + ',' + j) - 0.5) * 36 * JIT),
      OY + j * CH + (edge && (j === 0 || j === NJ) ? 0 : (h01('cy' + i + ',' + j) - 0.5) * 30 * JIT)];
  };
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // vertical edges bow a little (both neighbours share the same bow); horizontal edges are straight
  const vmid = (i, j) => { const a = C(i, j), b = C(i, j + 1); const o = (i === 0 || i === NI) ? 0 : (h01('vm' + i + ',' + j) - 0.5) * 16 * JIT; return [(a[0] + b[0]) / 2 + o, (a[1] + b[1]) / 2]; };
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
        ids.yard = api.defineParcel({ name: 'Hoeve Ter Linde', poly: poly(i, j, 1, 0, 0.45), soil: 0.55, state: 'owned', tradeable: false });
        npc(poly(i, j, 1, 0.45, 1), key + 'b');
      } else if (kind === 'start') {
        ids.start = api.defineParcel({ name: 'Lindeveldje', poly: poly(i, j, 1), soil: 0.68, state: 'rented' });
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
  for (let x = OX - 10; x <= OX + NI * CW + 10; x += 30) decor.brook.push([x, OY + 5.55 * CH + Math.sin(x * 0.018) * 16 + Math.sin(x * 0.06) * 4]);
  return { ids, decor };
}

// ============================ farm manager ============================
// Only live-API mechanics: field work is done by hired hands at workRates().ai (logged with
// recordFieldWork → wages + CAP), by the player at workRates().player, or booked with hireContractor
// (lead time, then the op lands). Crew-sized jobs are delegated with assignJob and worked by the sim.
// The crop model itself (yield = table × soil × timeliness × weather noise) stands in for the crops module.
export const STRATEGY_INFO = {
  jobs: 'player alone: takes every job he can do himself, contractors farm the starter plot, never hires or invests',
  contractor: 'contract work only: hires hands (and machines) to take crew-sized jobs, keeps the starter plot, no land',
  smallfarm: 'rents up to 12 ha, contractors do all field work, no hands, no purchases',
  renter: 'rents what it can finance, hires hands and machines when the contractor bill pays for them, never buys land',
  builder: 'as renter, plus buys land on a 75 % mortgage when it can pay the deposit, a grain store and bigger kit',
};
const ROTATION = ['wheat', 'sugarBeet', 'wheat', 'barley', 'rapeseed'];
const PLAYER_HOURS = 12;   // the player's active game hours per game day
const PLAYER_VALUE = 15;   // €/game-hour the player earns with odd jobs; farm work worth less goes to a contractor
const LATE = 0.93;         // yield factor when sowing or harvest lands after its window
const DIESEL = { plough: 22, cultivate: 12, sow: 8, spray: 1.5, mow: 6, harvest: 16, lift: 30, bale: 4 }; // l/ha
const NEEDS = { plough: 'tillage', sow: 'tillage', spray: 'sprayer', harvest: 'combine', lift: 'harvester', bale: 'baler', mow: 'mower' };
const SPRAY_PASSES = 3;

/**
 * createManager(sim, { strategy, rng, ids, rotation?, jobs? }) → { setup(), day(d), fields, tasks, stats }
 * (jobs: false = never takes contract work; rotation overrides the default crop rotation)
 */
export function createManager(sim, opts) {
  const api = sim.api;
  const rng = opts.rng;
  const strat = opts.strategy || 'builder';
  const ROT = opts.rotation || ROTATION;
  const R = api.workRates();
  const HPD = R.hoursPerDay;
  const fields = new Map();
  const tasks = [];
  const booked = new Map(); // bookingId → task
  const M = { hFarmHands: 0, hFarmPlayer: 0, hJobsPlayer: 0, contractorSpend: 0, contractorOwnable: [], declinedCrew: [], startDay: null, lastHire: null, overflowSold: 0, jobsDone: 0 };

  // ---------- helpers ----------
  const owned = (cat) => api.assets().filter((a) => a.mode === 'owned' && a.category === cat);
  const tractorTiers = () => owned('tractor').map((a) => (a.meta && a.meta.tier) || 1).sort((a, b) => b - a);
  const largeTillage = () => owned('tillage').some((a) => a.meta && a.meta.size === 2);
  const combineId = () => (owned('combine').some((a) => a.itemId === 'combine_l') ? 'combine_l' : 'combine_s');
  const hands = () => api.workers();
  const myParcels = () => api.parcels().filter((p) => p.state === 'owned' || p.state === 'rented');
  const farmedHa = () => myParcels().reduce((a, p) => a + p.area / 1e4, 0);
  const tierFor = (op, rank) => { const t = tractorTiers()[rank] || 1; return (op === 'plough' || op === 'sow') && t > 1 && !largeTillage() ? 1 : t; };
  const aiRate = (op, rank = 0) => haPerGameHour(R, op, 'ai', tierFor(op, rank), combineId());
  const playerRate = (op) => haPerGameHour(R, op, 'player', tierFor(op, 0), combineId());
  const hasKit = (op) => (op === 'harvest' ? owned('combine').length > 0 : owned('tractor').length > 0 && owned(NEEDS[op]).length > 0);
  const kitCount = (op) => (op === 'harvest' ? owned('combine').length : Math.min(owned('tractor').length, owned(NEEDS[op]).length));
  const obligationsMonth = () => {
    const wages = hands().reduce((a, w) => a + w.dayRate * 2 + w.retainer, 0);
    const rent = api.parcels().filter((p) => p.state === 'rented').reduce((a, p) => a + (p.lease ? p.lease.rentPerHaYear : p.rentPerHaYear) * p.area / 1e4 / 12, 0);
    const inst = api.loans().reduce((a, l) => a + l.monthly + l.balance * l.rate / 12, 0);
    return wages + rent + inst + 400;
  };
  const reserve = () => 3 * obligationsMonth() + 5000;
  const useDiesel = (op, ha) => { const l = (DIESEL[op] || 5) * ha; if (l > 0) { api.buy('diesel', l); api.removeInventory('diesel', l); } };
  function buyMachine(id) {
    const c = api.catalog().find((x) => x.id === id);
    if (!c) return false;
    if (api.money() - reserve() >= c.price) return api.purchase(id);
    return api.purchase(id, { finance: true });
  }

  // ---------- fields & crop calendar ----------
  function ensureField(p) {
    if (fields.has(p.id)) return fields.get(p.id);
    const m = Math.floor(doyOf(sim.today()) / MONTH_DAYS);
    let crop = ROT[0], best = 99;
    for (const c of new Set(ROT)) for (const sm of CROPS[c].sowMonths) { const wait = (sm - m + 12) % 12; if (wait < best) { best = wait; crop = c; } }
    const f = { id: p.id, crop, rot: ROT.indexOf(crop), stage: 'fallow', factor: 1, yard: p.id === (opts.ids && opts.ids.yard) };
    fields.set(p.id, f);
    return f;
  }
  const windowEnd = (months, doy, d) => d + (months[months.length - 1] * MONTH_DAYS + 2 - doy);
  const hasTask = (f, kinds) => tasks.some((t) => t.fieldId === f.id && kinds.includes(t.op));

  function newTask(f, p, op, ha, deadline) {
    const t = { op, fieldId: f.id, parcelId: p.id, ha, left: ha, deadline, booking: null, created: sim.today() };
    tasks.push(t);
    return t;
  }

  function plan(d) {
    const doy = doyOf(d), m = Math.floor(doy / MONTH_DAYS);
    const mine = new Set(myParcels().map((p) => p.id));
    for (const id of [...fields.keys()]) if (!mine.has(id)) { fields.delete(id); for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].fieldId === id && !tasks[i].booking) tasks.splice(i, 1); }
    for (const p of myParcels()) {
      const f = ensureField(p);
      if (f.yard) continue; // farmyard: not cropped
      const C = CROPS[f.crop], ha = p.area / 1e4;
      if (f.stage === 'fallow' && C.sowMonths.includes(m) && !hasTask(f, ['plough', 'sow'])) {
        newTask(f, p, 'plough', ha, windowEnd(C.sowMonths.filter((x) => x >= m), doy, d));
      }
      if (f.stage === 'sown' && doy === (f.crop === 'sugarBeet' ? 10 : 7) && !f.cared) {
        f.cared = true;
        api.buyInputs(f.crop, ha, ['fertiliser', 'spray']) || api.charge(api.inputCost(f.crop).fertiliser * ha + api.inputCost(f.crop).spray * ha, 'fertiliser', 'Inputs on credit', { force: true });
        newTask(f, p, 'spray', ha * SPRAY_PASSES, d + 6);
      }
      if (f.stage === 'sown' && C.harvestMonths.includes(m) && d > f.sownDay + 6 && !hasTask(f, ['harvest', 'lift'])) {
        const op = f.crop === 'sugarBeet' || f.crop === 'potatoes' ? 'lift' : 'harvest';
        newTask(f, p, op, ha, windowEnd(C.harvestMonths.filter((x) => x >= m), doy, d));
      }
    }
  }

  function finishOp(t, late) {
    const f = fields.get(t.fieldId), p = api.parcel(t.parcelId);
    if (!f || !p) return;
    if (t.op === 'plough') { newTask(f, p, 'sow', t.ha, Math.max(t.deadline, sim.today() + 1)).late = late; return; }
    if (t.op === 'sow') {
      api.buyInputs(f.crop, t.ha, ['seed']) || api.charge(api.inputCost(f.crop).seed * t.ha, 'seed', 'Seed on credit', { force: true });
      f.stage = 'sown'; f.sownDay = sim.today(); f.factor = late || t.late ? LATE : 1; f.cared = false;
      return;
    }
    if (t.op === 'harvest' || t.op === 'lift') { harvestField(f, p, late ? LATE : 1); return; }
    if (t.op === 'bale') { api.addInventory('straw', t.straw || 0); sales.sellSome('straw', 1); }
  }

  function harvestField(f, p, factor) {
    const C = CROPS[f.crop], ha = p.area / 1e4;
    const soilF = 0.82 + 0.36 * p.soil;
    const y = C.yield * ha * soilF * f.factor * factor * rng.range(0.86, 1.12);
    const stored = api.addInventory(C.product, y);
    sales.harvested(C.product);
    if (y - stored > 0.05) { M.overflowSold += y - stored; sales.sellOff(C.product, y - stored); } // no room: sold off the field
    if (C.straw) { const t = newTask(f, p, 'bale', ha, sim.today() + 4); t.straw = C.straw * ha * rng.range(0.85, 1.1); }
    f.stage = 'fallow';
    f.rot = (f.rot + 1) % ROT.length;
    f.crop = ROT[f.rot];
  }

  // ---------- contractors (live API) ----------
  function book(t) {
    const b = api.hireContractor(t.parcelId, t.op, t.op === 'spray' || t.op === 'bale' || t.left !== t.ha ? { ha: t.left } : {});
    if (!b) return false;
    t.booking = b.id; booked.set(b.id, t);
    M.contractorSpend += b.price;
    if (hasKitOrCould(t.op)) M.contractorOwnable.push([sim.today(), b.price]);
    return true;
  }
  const hasKitOrCould = (op) => op !== 'lift' || strat === 'builder' || strat === 'renter';
  function contractorsDone() {
    for (const b of api.contractorBookings('done')) {
      const t = booked.get(b.id);
      if (!t) continue;
      booked.delete(b.id);
      const i = tasks.indexOf(t);
      if (i >= 0) tasks.splice(i, 1);
      finishOp(t, b.doneDay > t.deadline);
    }
  }
  /** book a contractor for tasks our crew cannot finish in time (or has no kit for) */
  function decideContractors(d) {
    const cap = {}; // op → ha our hands can still do before each deadline (greedy, by deadline)
    const open = tasks.filter((t) => !t.booking).sort((a, b) => a.deadline - b.deadline);
    for (const t of open) {
      if (t.op === 'bale' && !owned('baler').length) { book(t); continue; }
      const kit = hasKit(t.op) ? Math.min(kitCount(t.op), hands().length) : 0;
      const q = api.contractorQuote(t.parcelId, t.op, { ha: t.left });
      const lead = q ? q.leadRange[1] + q.days : 3;
      const daysLeft = t.deadline - d;
      // what the player could do himself (only worth it for small jobs)
      const playerH = t.left / Math.max(1e-6, playerRate(t.op));
      const playerOK = hasKitPlayer(t.op) && q && playerH <= q.price / PLAYER_VALUE && playerH <= PLAYER_HOURS * Math.max(0, daysLeft - 1) * 0.6;
      if (!kit) {
        if (playerOK) continue;
        if (daysLeft <= lead + 1 || !isGrowing()) book(t);
        continue;
      }
      const perDay = kit * aiRate(t.op) * HPD;
      const used = cap[t.op] || 0;
      const canDo = Math.max(0, perDay * Math.max(0, daysLeft) - used);
      cap[t.op] = used + t.left;
      if (canDo < t.left && daysLeft <= lead + 1) book(t);
    }
  }
  const hasKitPlayer = (op) => (op === 'harvest' ? owned('combine').length > 0 : owned('tractor').length > 0 && owned(NEEDS[op]).length > 0);
  const isGrowing = () => true;

  // ---------- daily crew allocation ----------
  function work(d) {
    const H = hands().map((w) => ({ id: w.id, left: HPD }));
    const inUse = {}; // machine category → units in use today
    let tractorsFree = owned('tractor').length;
    let playerH = PLAYER_HOURS;
    tasks.sort((a, b) => a.deadline - b.deadline);
    for (const t of tasks) {
      if (t.booking || t.left <= 1e-6) continue;
      if (!hasKit(t.op)) continue;
      const cat = t.op === 'harvest' ? 'combine' : NEEDS[t.op];
      for (const h of H) {
        if (t.left <= 1e-6) break;
        if (h.left <= 0.1) continue;
        const units = t.op === 'harvest' ? owned('combine').length : Math.min(owned(cat).length, owned('tractor').length);
        if ((inUse[cat] || 0) >= units) break;
        if (t.op !== 'harvest' && tractorsFree <= 0) break;
        inUse[cat] = (inUse[cat] || 0) + 1;
        if (t.op !== 'harvest') tractorsFree--;
        const rank = owned('tractor').length - tractorsFree - 1;
        const rate = aiRate(t.op, Math.max(0, rank));
        let hrs = Math.min(h.left, t.left / rate);
        // hauling the harvest home takes trailer time too
        if (t.op === 'harvest' && owned('trailer').length) hrs = Math.min(h.left, hrs * 1.15);
        const ha = Math.min(t.left, (t.op === 'harvest' ? hrs / 1.15 : hrs) * rate);
        t.left -= ha; h.left -= hrs;
        M.hFarmHands += hrs;
        api.recordFieldWork(t.parcelId, t.op, { workerId: h.id, hours: hrs });
        useDiesel(t.op, ha);
      }
    }
    // the player does small farm tasks himself when a contractor would cost more than his time is worth
    for (const t of tasks) {
      if (t.booking || t.left <= 1e-6 || playerH <= 0.5 || !hasKitPlayer(t.op)) continue;
      const q = api.contractorQuote(t.parcelId, t.op, { ha: t.left });
      const needH = t.left / playerRate(t.op);
      if (!q || needH > q.price / PLAYER_VALUE) continue;
      const hrs = Math.min(playerH * 0.6, needH);
      const ha = hrs * playerRate(t.op);
      t.left -= ha; playerH -= hrs; M.hFarmPlayer += hrs;
      api.recordFieldWork(t.parcelId, t.op);
      useDiesel(t.op, ha);
    }
    // finished or overdue tasks
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      if (t.booking) continue;
      if (t.left <= 1e-6) { tasks.splice(i, 1); finishOp(t, d > t.deadline); continue; }
      if (d > t.deadline + 2) book(t); // too late: whatever it costs
    }
    return { handsLeft: H, playerH };
  }

  // ---------- contract jobs ----------
  function jobs(d, free) {
    if (opts.jobs === false) return;
    const J = sim.jobs;
    // the player works his own accepted jobs
    let playerH = free.playerH;
    for (const j of api.jobs('accepted')) {
      if (j.assignee) continue;
      if (playerH <= 0.1) break;
      const need = J.workHours(j, 'player');
      if (!Number.isFinite(need)) continue;
      const h = Math.min(playerH, need);
      playerH -= h; M.hJobsPlayer += h;
      if (AREA_OPS.includes(j.type)) useDiesel(j.op, j.amount * (h / need) * (1 - j.progress));
      if (j.unit === 'h') api.tickPresence(j.id, h * 3600);
      else api.reportProgress(j.id, (h / need) * (1 - j.progress) + 1e-9);
    }
    // hands: delegate crew jobs to whoever has hours left after the farm (the sim works them overnight)
    const handFree = new Map(free.handsLeft.map((h) => [h.id, h.left]));
    for (const j of api.jobs('accepted')) {
      if (!j.crew || j.assignee) continue;
      const h = [...handFree.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!h || h[1] < 3) break;
      api.assignJob(j.id, h[0]);
      handFree.set(h[0], h[1] - Math.min(h[1], J.workHours(j, 'ai')));
    }
    // accept new offers: best € per hour first, within the cap and the time we have
    const canMachine = (j) => !j.requiresMachine || (owned('tractor').length && (!j.needs || j.needs === 'tractor' || owned(j.needs).length));
    const offers = api.jobs('offered').filter(canMachine).map((j) => ({ j, hp: J.workHours(j, 'player'), ha: J.workHours(j, 'ai') }));
    offers.sort((a, b) => b.j.pay / (a.j.crew ? a.ha : a.hp) - a.j.pay / (b.j.crew ? b.ha : b.hp));
    const committedPlayer = api.jobs('accepted').filter((j) => !j.assignee && !j.crew).reduce((t, j) => t + J.workHours(j, 'player'), 0);
    const committedCrew = api.jobs('accepted').filter((j) => j.crew).reduce((t, j) => t + J.workHours(j, 'ai'), 0);
    let pBudget = PLAYER_HOURS * 1.5 - committedPlayer;
    let cBudget = [...handFree.values()].reduce((t, x) => t + x, 0) * 1.5 - committedCrew;
    for (const { j, hp, ha } of offers) {
      if (api.jobs('accepted').length >= api.activeJobCap()) break;
      const days = Math.max(1, j.deadlineDay - d);
      if (j.crew) {
        if (!hands().length) { M.declinedCrew.push([d, j.pay, j.needs]); continue; }
        if (ha <= cBudget + days * HPD * hands().length * 0.4) { if (api.acceptJob(j.id)) cBudget -= ha; }
        else M.declinedCrew.push([d, j.pay, j.needs]);
      } else if (hp <= pBudget + (days - 1) * PLAYER_HOURS * 0.8 && j.pay / Math.max(1, hp) >= 6) {
        if (api.acceptJob(j.id)) pBudget -= hp;
      }
    }
    // offers we could not even consider for lack of a machine count as demand too
    for (const j of api.jobs('offered')) if (j.crew && !canMachine(j) && j.offeredDay === d) M.declinedCrew.push([d, j.pay, j.needs]);
  }
  const AREA_OPS = ['plough', 'sow', 'harvest', 'mow'];

  // ---------- selling: spread over buyers and days, catch the carry ----------
  const sales = {
    ref: {},
    harvested(item) {
      const r = this.ref[item];
      if (!r || sim.today() - r.day > 12) this.ref[item] = { day: sim.today(), p: quote(item) };
      this.sellSome(item, 0.2);
    },
    /** sell `qty` that has nowhere to go (it was never stored): add, then sell across buyers */
    sellOff(item, qty) {
      // the crops module would trailer it straight to a buyer; through the API that is addInventory + sell,
      // so make room first by selling the same amount from store
      let left = qty;
      for (let k = 0; k < 20 && left > 0.05; k++) {
        const had = api.inventory()[item] || 0;
        if (had > 0.05) this.sellSome(item, 0, Math.min(had, left));
        const got = api.addInventory(item, left);
        if (got <= 0.05 && had <= 0.05) break; // no store at all for it
        left -= got;
      }
      this.sellSome(item, 0, Math.min(qty, api.inventory()[item] || 0) * 0); // keep the rest in store
    },
    sellSome(item, frac, abs) {
      const inv = api.inventory()[item] || 0;
      let left = abs != null ? Math.min(inv, abs) : inv * frac;
      const pts = api.sellPoints().filter((s) => !s.accepts || s.accepts.includes(item));
      pts.sort((a, b) => (api.price(item, b.id) || 0) - (api.price(item, a.id) || 0));
      for (const s of pts.slice(0, 2)) {
        if (left <= 0.05) break;
        const lot = Math.min(left, depthOf(item) * 0.3);
        api.sell(item, lot, s.id);
        left -= lot;
      }
      if (left > 0.05 && pts[0]) api.sell(item, left, pts[0].id);
    },
    daily(d) {
      const doy = doyOf(d);
      for (const [item, q] of Object.entries(api.inventory())) {
        if (item === 'diesel' || item === 'fertiliser' || q < 0.1) continue;
        const p = quote(item);
        if (p == null || api.price(item, bestPoint(item)) == null) continue;
        const ref = this.ref[item] ? this.ref[item].p : p;
        const harvestNear = CROPS_BY_PRODUCT[item] && CROPS_BY_PRODUCT[item].some((c) => { const k = doyOf(c.harvestMonths[0] * MONTH_DAYS - doy); return k >= 1 && k <= 7; });
        const needCash = api.money() < reserve() * 0.25;
        if (item === 'straw' || item === 'sugarBeet' || item === 'potatoes') this.sellSome(item, 1);
        else if (p >= ref * 1.1 || harvestNear) this.sellSome(item, 0.35);
        else if (needCash) this.sellSome(item, 0.25);
      }
    },
  };
  const quote = (item) => { const h = api.priceHistory(item); return h.length ? h[h.length - 1][1] : null; };
  const depthOf = (item) => ({ wheat: 160, barley: 150, oats: 90, rapeseed: 80, maize: 160, potatoes: 250, sugarBeet: 3000, straw: 70, hay: 60 }[item] || 100);
  const bestPoint = (item) => {
    let best = null, bp = -1;
    for (const sp of api.sellPoints()) { const p = api.price(item, sp.id); if (p != null && p > bp) { bp = p; best = sp.id; } }
    return best;
  };

  // ---------- growth decisions (monthly) ----------
  const recent = (list, d) => list.filter((x) => x[0] > d - YEAR_DAYS).reduce((t, x) => t + x[1], 0);
  function grow(d) {
    if (M.startDay == null) M.startDay = d;
    const year = Math.floor((d - M.startDay) / YEAR_DAYS) + 1;
    const ha = farmedHa();
    const cash = () => api.money() - reserve();
    const liquid = () => cash() + api.creditLimit();
    const nHands = hands().length;
    const farming = strat === 'renter' || strat === 'builder' || strat === 'smallfarm';
    // seasonal operating credit, repaid when flush
    if (api.money() < reserve() * 0.6 && api.creditLimit() > 5000) api.takeLoan(Math.min(api.creditLimit(), Math.max(10000, reserve())), { months: 12 });
    const surplus = api.money() - reserve() * 2 - 20000;
    if (surplus > 0) for (const l of api.loans().filter((x) => !x.secured).sort((a, b) => a.months - b.months)) api.repayLoan(l.id, surplus);
    M.contractorOwnable = M.contractorOwnable.filter((x) => x[0] > d - YEAR_DAYS);
    M.declinedCrew = M.declinedCrew.filter((x) => x[0] > d - YEAR_DAYS);
    if (strat === 'jobs') return;

    // land: rent what we can finance (smallfarm ≤ 12 ha); builder buys when it can pay the deposit
    const maxHa = strat === 'smallfarm' ? 12 : strat === 'contractor' ? 0 : 20 + 22 * nHands;
    if (farming && year >= 2) {
      for (const id of api.landMarket().forRent) {
        const p = api.parcel(id), pha = p.area / 1e4;
        const needs = 1100 * pha + 3 * p.rentPerHaYear * pha / 12 + 6000;
        if (ha + pha > maxHa) continue;
        if (liquid() > needs && api.rentParcel(id)) break;
      }
    }
    if (strat === 'builder' && year >= 2) {
      for (const id of api.landMarket().forSale) {
        const p = api.parcel(id), pha = p.area / 1e4;
        const own = p.price * (1 - 0.75 + 0.04);
        if (ha + pha > maxHa + 6) continue;
        if (cash() > own + 1100 * pha && api.buyParcel(id, { mortgage: true })) break;
      }
    }
    if (strat === 'smallfarm') return;

    // hands: hire when last year's contractor bill for work we could own + turned-down crew jobs
    // would pay a hand (≈ €6k/yr at 25–30 worked days) with a good margin; a hand needs a tractor
    const demand = recent(M.contractorOwnable, d) * 0.5 + recent(M.declinedCrew, d) * 0.35;
    const maxHands = 3;
    const sinceHire = M.lastHire == null ? 99 : d - M.lastHire;
    if (nHands < maxHands && demand > 9000 + 5000 * nHands && sinceHire >= 9 && cash() > 8000) {
      if (owned('tractor').length >= nHands + 1 || buyMachine('tractor_t1')) { api.hireWorker(); M.lastHire = d; }
    }
    // let a hand go when there has been almost nothing for them for a year
    if (nHands && sinceHire > YEAR_DAYS) {
      const idle = hands().filter((w) => (w.daysWorked || 0) < 6 * Math.max(1, (d - w.hiredDay) / YEAR_DAYS));
      if (idle.length) { api.fireWorker(idle[0].id); M.lastHire = d; }
    }
    if (!nHands) return;
    // machinery for the hands (dealer finance)
    const cereals = myParcels().filter((p) => { const f = fields.get(p.id); return f && !f.yard && f.crop !== 'sugarBeet'; }).reduce((t, p) => t + p.area / 1e4, 0);
    const roots = myParcels().filter((p) => { const f = fields.get(p.id); return f && f.crop === 'sugarBeet'; }).reduce((t, p) => t + p.area / 1e4, 0);
    const declined = (need) => recent(M.declinedCrew.filter((x) => x[2] === need), d);
    if (!owned('sprayer').length && (ha >= 8) && cash() > 5000) buyMachine('sprayer');
    const tiers = tractorTiers();
    if (tiers[0] < 2 && (ha >= 15 || declined('tillage') > 8000) && cash() > 18000) { if (buyMachine('tractor_t2')) buyMachine('tillage_l'); }
    if (!owned('combine').length && (cereals >= 18 || declined('combine') > 15000) && cash() > 30000) buyMachine('combine_s');
    if (!owned('mower').length && declined('mower') > 3000 && cash() > 5000) buyMachine('mower');
    if (!owned('harvester').length && farming && roots >= 6 && cash() > 18000) buyMachine('root_harvester');
    if (!owned('baler').length && farming && cereals >= 20 && cash() > 9000) buyMachine('baler');
    if (strat === 'builder' && owned('storage').length === 0 && M.overflowSold > 60 && cash() > 12000) buyMachine('grain_store');
    if (tiers[0] === 2 && ha >= 40 && cash() > 40000) buyMachine('tractor_t3');
    if (owned('combine').length && !owned('combine').some((a) => a.itemId === 'combine_l') && cereals >= 40 && cash() > 70000) buyMachine('combine_l');
  }

  return {
    setup() {
      api.grantAsset('tractor_t1', { boughtDay: sim.today() - 360 });
      api.grantAsset('tillage_s', { boughtDay: sim.today() - 360 });
      api.grantAsset('trailer', { boughtDay: sim.today() - 360 });
    },
    day(d) {
      if (doyOf(d) % MONTH_DAYS === 0) grow(d);
      contractorsDone();
      plan(d);
      decideContractors(d);
      const free = work(d);
      jobs(d, free);
      sales.daily(d);
    },
    fields, tasks, stats: M,
  };
}

const CROPS_BY_PRODUCT = {};
for (const c of Object.values(CROPS)) (CROPS_BY_PRODUCT[c.product] || (CROPS_BY_PRODUCT[c.product] = [])).push(c);
