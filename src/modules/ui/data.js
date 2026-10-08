// Data adapter: everything the built-in HUD/panels read goes through here.
// Live source = the `simulation` / `environment` APIs (optional; any call may return undefined).
// Sample source = a seeded, plausible dataset used ONLY by the ui showcase when simulation
// is absent or still a stub, so every panel can be demonstrated.
import { DAY_SECONDS } from '../../core/world.js';

export const ITEM_META = {
  wheat: { name: 'Wheat', unit: 't', icon: 'wheat' },
  barley: { name: 'Barley', unit: 't', icon: 'barley' },
  oats: { name: 'Oats', unit: 't', icon: 'oats' },
  rapeseed: { name: 'Rapeseed', unit: 't', icon: 'rapeseed' },
  maize: { name: 'Maize', unit: 't', icon: 'maize' },
  potatoes: { name: 'Potatoes', unit: 't', icon: 'potato' },
  sugarBeet: { name: 'Sugar beet', unit: 't', icon: 'beet' },
  grass: { name: 'Grass', unit: 't', icon: 'hay' },
  hay: { name: 'Hay', unit: 't', icon: 'hay' },
  straw: { name: 'Straw', unit: 't', icon: 'hay' },
  milk: { name: 'Milk', unit: 'l', icon: 'milk' },
  eggs: { name: 'Eggs', unit: 'egg', icon: 'egg' },
  wool: { name: 'Wool', unit: 'kg', icon: 'wool' },
  diesel: { name: 'Diesel', unit: 'l', icon: 'diesel' },
};
export function itemMeta(id) {
  if (ITEM_META[id]) return ITEM_META[id];
  const name = String(id).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  return { name, unit: 'unit', icon: 'coin' };
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = (v) => (Array.isArray(v) ? v : []);
const fn = (o, k) => !!o && typeof o[k] === 'function';

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// ------------------------------------------------------------------ sample dataset
function buildSample(ctx) {
  const rng = ctx.rng('sample');
  const now = ctx.clock.t;
  const today = ctx.clock.day;
  const base = {
    wheat: 210, barley: 185, oats: 200, rapeseed: 430, maize: 195, potatoes: 160, sugarBeet: 42,
    hay: 120, straw: 70, milk: 0.46, eggs: 0.22, wool: 1.8,
  };
  const prices = {}, history = {};
  for (const [id, p] of Object.entries(base)) {
    let v = p * (0.93 + rng.float() * 0.1);
    const h = [];
    for (let i = 0; i < 36; i++) {
      v += (p - v) * 0.12 + p * (rng.float() - 0.5) * 0.07;
      h.push(+v.toFixed(p < 5 ? 3 : 2));
    }
    history[id] = h;
    prices[id] = h[h.length - 1];
  }
  const sellPoints = [
    { id: 'mill', name: 'Van Damme Mill', x: 610, y: 470, accepts: ['wheat', 'barley', 'oats', 'maize'], mult: 1.03 },
    { id: 'coop', name: 'Hageland Co-op', x: 430, y: 610, accepts: ['wheat', 'barley', 'rapeseed', 'potatoes', 'sugarBeet'], mult: 0.99 },
    { id: 'dairy', name: 'Zuivel De Smet', x: 700, y: 640, accepts: ['milk'], mult: 1.0 },
    { id: 'market', name: 'Saturday market', x: 520, y: 700, accepts: ['eggs', 'potatoes', 'wool', 'hay', 'straw'], mult: 1.06 },
  ];
  const inventory = { wheat: 12.4, hay: 6.8, straw: 3.2, potatoes: 0, eggs: 140 };

  // ledger over the last 30 days, oldest first
  const L = [];
  const add = (daysAgo, hour, amount, category, memo) => L.push({ t: now - daysAgo * DAY_SECONDS - (ctx.clock.timeOfDay - hour) * 3600, amount, category, memo });
  add(29.6, 9, -2150, 'seed', 'Seed — spring barley, 3.2 ha');
  add(28.2, 14, 4480, 'sale', 'Sold 21.3 t wheat — Van Damme Mill');
  add(27, 8, -412.5, 'rent', 'Rent — Hoogveld (month)');
  add(25.4, 11, -228.75, 'fuel', 'Diesel, 183 l');
  add(24, 16, 1260, 'job', 'Contract: ploughing for M. Peeters');
  add(22.5, 10, -1840, 'fertiliser', 'Fertiliser — 2.4 t NPK');
  add(21, 9, -290, 'upkeep', 'Tractor service, Garage Wouters');
  add(19.2, 13, 690, 'job', 'Contract: hay transport for A. Lambert');
  add(18, 8, -135, 'wages', 'Wages — Jonas, 1 day');
  add(17, 8, -135, 'wages', 'Wages — Jonas, 1 day');
  add(15.6, 15, 2360, 'sale', 'Sold 14.8 t potatoes — Hageland Co-op');
  add(14, 7, -180, 'insurance', 'Farm insurance (month)');
  add(12.3, 12, -3100, 'purchase', 'Used seed drill, 3 m');
  add(10.8, 10, 940, 'job', 'Contract: mowing verges, gemeente Tielt');
  add(9, 8, -412.5, 'rent', 'Rent — Hoogveld (month)');
  add(8.2, 11, -64.2, 'interest', 'Loan interest');
  add(6.5, 16, 1535, 'sale', 'Sold 8.1 t barley — Van Damme Mill');
  add(5, 9, -212.4, 'fuel', 'Diesel, 170 l');
  add(3.4, 14, 820, 'job', 'Contract: feeding sheep for P. Dubois');
  add(2, 8, -135, 'wages', 'Wages — Jonas, 1 day');
  add(1.2, 10, 318.6, 'sale', 'Sold 1 420 eggs — Saturday market');
  add(0.3, 6.5, -58.9, 'upkeep', 'Fence repair, Kouter');
  const money = 18240.5;

  const clients = ['Marc Peeters', 'Els Janssens', 'Pierre Dubois', 'Anne Lambert', 'Wout Maes', 'Lieve Claes', 'Luc Dupont', 'Martine Leroy'];
  const jobs = [
    { id: 'job:11', type: 'plough', client: clients[0], title: 'Plough the Brem parcel', amount: 2.1, unit: 'ha', pay: 610, deadlineDay: today + 2, status: 'offered' },
    { id: 'job:12', type: 'sow', client: clients[1], title: 'Sow spring barley on Lindeveld', amount: 3.4, unit: 'ha', pay: 780, deadlineDay: today + 3, status: 'offered' },
    { id: 'job:13', type: 'transport', client: clients[3], title: 'Haul 18 t potatoes to the Co-op', amount: 18, unit: 't', pay: 540, deadlineDay: today + 1, status: 'offered' },
    { id: 'job:14', type: 'animalCare', client: clients[2], title: 'Feed and check 40 ewes, 2 days', amount: 2, unit: 'days', pay: 420, deadlineDay: today + 4, status: 'offered' },
    { id: 'job:15', type: 'shopHelp', client: 'Bakkerij Claes', title: 'Help at the bakery counter', amount: 6, unit: 'h', pay: 145, deadlineDay: today + 1, status: 'offered' },
    { id: 'job:16', type: 'deliver', client: clients[6], title: 'Deliver 24 hay bales to Beemd farm', amount: 24, unit: 'bales', pay: 360, deadlineDay: today + 5, status: 'offered' },
    { id: 'job:9', type: 'plough', client: clients[4], title: 'Plough the Kapelakker', amount: 4.2, unit: 'ha', pay: 1260, deadlineDay: today + 2, status: 'accepted', progress: 0.45 },
    { id: 'job:8', type: 'transport', client: clients[5], title: 'Haul 12 t barley to the Mill', amount: 12, unit: 't', pay: 380, deadlineDay: today + 1, status: 'accepted', progress: 0.8 },
    { id: 'job:6', type: 'animalCare', client: clients[2], title: 'Feed and check 40 ewes', amount: 1, unit: 'day', pay: 820, deadlineDay: today - 2, status: 'completed', progress: 1 },
    { id: 'job:5', type: 'mow', client: 'Gemeente Tielt', title: 'Mow the village verges', amount: 3, unit: 'km', pay: 940, deadlineDay: today - 10, status: 'completed', progress: 1 },
    { id: 'job:4', type: 'sow', client: clients[7], title: 'Sow oats on the Heide', amount: 2.2, unit: 'ha', pay: 520, deadlineDay: today - 12, status: 'failed', progress: 0.3 },
  ];

  const P = (id, name, state, soil, poly, extra = {}) => {
    const area = polyArea(poly);
    const ha = area / 10000;
    return { id, name, state, soil, poly, area, price: Math.round(ha * (38000 + soil * 27000) / 100) * 100, rentPerDay: +(ha * (350 + soil * 300) / 36).toFixed(2), ...extra };
  };
  const parcels = [
    P('land:1', 'Kouter', 'owned', 0.82, [[380, 400], [500, 392], [508, 500], [372, 510]], { crop: 'Ploughed' }),
    P('land:2', 'Hoogveld', 'rented', 0.64, [[510, 392], [640, 380], [652, 470], [518, 498]], { crop: 'Winter wheat' }),
    P('land:3', 'Molenakker', 'forSale', 0.71, [[372, 516], [508, 506], [520, 610], [380, 628]]),
    P('land:4', 'Beemd', 'forSale', 0.48, [[520, 506], [660, 478], [690, 580], [530, 606]]),
    P('land:5', 'Brem', 'npc', 0.55, [[648, 380], [722, 372], [732, 455], [660, 466]]),
    P('land:6', 'Lindeveld', 'forSale', 0.9, [[386, 634], [522, 616], [540, 690], [392, 704]]),
    P('land:7', 'Oude Weide', 'npc', 0.6, [[534, 612], [694, 588], [706, 670], [550, 692]]),
  ];
  const loans = [{ id: 'loan:1', principal: 20000, balance: 17350, rate: 0.045, perDay: 64.2 }];
  const workers = [{ id: 'worker:1', name: 'Jonas', wage: 135 }];
  return { money, ledger: L, prices, history, sellPoints, inventory, jobs, parcels, loans, workers };
}

function sampleWeather(ctx) {
  const tod = ctx.clock.timeOfDay;
  const temp = 7 + 6 * Math.max(0, Math.sin(((tod - 8) / 24) * Math.PI * 2 * 0.9 + 0.2));
  return { kind: 'clear', intensity: 0, cloudCover: 0.2, wetness: 0.1, fog: 0, wind: { x: 2, y: 1, speed: 3.2 }, temperature: Math.round(tod > 21 || tod < 6 ? 4 : temp) };
}

// ------------------------------------------------------------------ adapter
export function createData(ctx) {
  let sample = null;
  let sampleEnabled = false;
  let empty = false;
  const sim = () => {
    if (empty) return null;
    const s = ctx.modules.get('simulation');
    return s && fn(s, 'money') ? s : null;
  };
  const S = () => {
    if (!sampleEnabled || empty) return null;
    if (!sample) sample = buildSample(ctx);
    return sample;
  };

  const D = {
    enableSample() { sampleEnabled = true; },
    /** showcase only: behave as if no economy exists (demonstrates empty states) */
    forceEmpty() { empty = true; sampleEnabled = false; },
    get usingSample() { return !sim() && sampleEnabled; },
    get hasEconomy() { return !!sim() || sampleEnabled; },

    money() {
      const s = sim();
      if (s) { const v = s.money(); if (typeof v === 'number') return v; const w = ctx.world.economy; return w && typeof w.money === 'number' ? w.money : null; }
      const x = S();
      return x ? x.money : null;
    },
    /** newest first */
    ledger(n = 60) {
      const s = sim();
      let list;
      if (s) list = arr(fn(s, 'ledger') ? s.ledger(n) : (ctx.world.economy && ctx.world.economy.ledger));
      else list = S() ? S().ledger : [];
      list = list.filter((e) => e && typeof e.amount === 'number').slice();
      list.sort((a, b) => num(b.t) - num(a.t));
      return list.slice(0, n);
    },
    summary(days = 30) {
      const s = sim();
      if (s && fn(s, 'summary')) {
        const r = s.summary(days);
        if (r && typeof r.income === 'number') return { income: r.income, expenses: Math.abs(num(r.expenses)), byCategory: r.byCategory || {} };
      }
      const since = ctx.clock.t - days * DAY_SECONDS;
      let income = 0, expenses = 0;
      const byCategory = {};
      for (const e of D.ledger(500)) {
        if (num(e.t) < since) continue;
        if (e.amount >= 0) income += e.amount; else expenses -= e.amount;
        const c = e.category || 'other';
        byCategory[c] = (byCategory[c] || 0) + e.amount;
      }
      return { income, expenses, byCategory };
    },
    /** end-of-day balances for the last `days` days, reconstructed backwards from the ledger */
    balanceHistory(days = 30) {
      const m = D.money();
      if (m == null) return [];
      const led = D.ledger(1000);
      const out = [];
      let bal = m, k = 0;
      const today = ctx.clock.day;
      const first = led.length ? Math.floor(num(led[led.length - 1].t) / DAY_SECONDS) - 1 : today - 1;
      const span = Math.max(2, Math.min(days, today - first + 1));
      for (let d = 0; d < span; d++) {
        const dayStart = (today - d) * DAY_SECONDS;
        out.push({ day: today - d, balance: bal });
        while (k < led.length && num(led[k].t) >= dayStart) { bal -= led[k].amount; k++; }
      }
      return out.reverse();
    },
    loans() {
      const s = sim();
      if (s) return arr(fn(s, 'loans') ? s.loans() : []);
      return S() ? S().loans : [];
    },
    inventory() {
      const s = sim();
      if (s) { const v = fn(s, 'inventory') ? s.inventory() : null; return v && typeof v === 'object' ? v : {}; }
      return S() ? S().inventory : {};
    },
    sellPoints() {
      const s = sim();
      if (s) return arr(fn(s, 'sellPoints') ? s.sellPoints() : []).filter(Boolean);
      return S() ? S().sellPoints : [];
    },
    /** market rows [{ id, name, unit, icon, price, history, change, stock, best }] */
    market() {
      const s = sim();
      let ids, priceOf, histOf;
      if (s) {
        const pr = (ctx.world.economy && ctx.world.economy.prices) || {};
        ids = Object.keys(pr).filter((k) => k !== 'diesel');
        priceOf = (id) => { const v = fn(s, 'price') ? s.price(id) : undefined; return typeof v === 'number' ? v : num(pr[id], null); };
        histOf = (id) => arr(fn(s, 'priceHistory') ? s.priceHistory(id) : []).map((h) => (typeof h === 'number' ? h : Array.isArray(h) ? num(h[1], NaN) : h && num(h.price != null ? h.price : h.value, NaN))).filter(Number.isFinite);
      } else {
        const x = S();
        if (!x) return [];
        ids = Object.keys(x.prices);
        priceOf = (id) => x.prices[id];
        histOf = (id) => x.history[id];
      }
      const inv = D.inventory();
      const sps = D.sellPoints();
      const rows = [];
      for (const id of ids) {
        const price = priceOf(id);
        if (price == null) continue;
        const history = histOf(id) || [];
        const ref = history.length > 7 ? history[history.length - 8] : history[0];
        const change = ref ? (price - ref) / ref : 0;
        let best = null;
        for (const sp of sps) {
          if (!arr(sp.accepts).includes(id)) continue;
          let p = price;
          if (s && fn(s, 'price')) { const v = s.price(id, sp.id); if (typeof v === 'number') p = v; } else if (sp.mult) p = price * sp.mult;
          if (!best || p > best.price) best = { id: sp.id, name: sp.name, price: p };
        }
        rows.push({ id, ...itemMeta(id), price, history, change, stock: num(inv[id]), best });
      }
      return rows;
    },
    jobs() {
      const s = sim();
      if (s) return arr(fn(s, 'jobs') ? s.jobs() : (ctx.world.jobs && ctx.world.jobs.list)).filter(Boolean);
      return S() ? S().jobs : [];
    },
    /** why acceptJob(id) would be / was refused (simulation only returns false) — null when unknown */
    acceptRefusal(id) {
      const s = sim();
      if (!s) return null;
      const j = this.jobs().find((x) => x.id === id);
      if (!j || j.status !== 'offered') return 'That contract is no longer available.';
      const hands = fn(s, 'workers') ? arr(s.workers()).length : 0;
      if (j.crewOnly && !hands) return 'This is a crew job — hire a hand first, then delegate it to them.';
      const cap = fn(s, 'activeJobCap') ? s.activeJobCap() : null;
      const held = this.jobs().filter((x) => x.status === 'accepted').length;
      if (typeof cap === 'number' && held >= cap) return `You already hold ${held} of ${cap} contracts. Finish one${hands ? '' : ' or hire a hand'} to take on more.`;
      return null;
    },
    acceptJob(id) {
      const s = sim();
      if (s) return fn(s, 'acceptJob') ? s.acceptJob(id) !== false : false;
      const j = S() && S().jobs.find((x) => x.id === id);
      if (!j) return false;
      j.status = 'accepted'; j.progress = 0;
      return true;
    },
    parcels() {
      const s = sim();
      if (s) return arr(fn(s, 'parcels') ? s.parcels() : (ctx.world.land && ctx.world.land.parcels)).filter((p) => p && Array.isArray(p.poly));
      return S() ? S().parcels : [];
    },
    buyParcel(id) {
      const s = sim();
      if (s) return fn(s, 'buyParcel') ? s.buyParcel(id) !== false : false;
      const x = S(); const p = x && x.parcels.find((q) => q.id === id);
      if (!p || x.money < p.price) return false;
      x.money -= p.price; p.state = 'owned';
      x.ledger.push({ t: ctx.clock.t, amount: -p.price, category: 'land', memo: 'Bought parcel ' + p.name });
      return true;
    },
    /** lease terms of a for-rent parcel, from the parcel record (simulation: monthly in advance, 1-year minimum,
     *  early exit = min(rest of the minimum term, 3 months' rent); a game year is 12 months × 3 days) */
    leaseTerms(p) {
      if (!p) return null;
      const ha = (p.area || 0) / 10000;
      const perHa = typeof p.rentPerHaYear === 'number' ? p.rentPerHaYear : (typeof p.rentPerDay === 'number' && ha > 0 ? p.rentPerDay * 36 / ha : null);
      if (perHa == null) return null;
      const year = perHa * ha;
      return { perHa, year, month: year / 12, exitMax: year * 3 / 12, minYears: 1 };
    },
    rentRefusal(id) {
      const s = sim();
      if (!s) return null;
      const p = this.parcels().find((q) => q.id === id);
      if (!p || p.state !== 'forRent') return 'That parcel is no longer offered to let.';
      const sv = fn(s, 'solvency') ? s.solvency() : null;
      if ((sv && sv.blocked) || (fn(s, 'blocked') && s.blocked())) return 'The bank has blocked new land deals until the farm is back under its credit limit.';
      const t = this.leaseTerms(p);
      if (t && fn(s, 'money') && s.money() < t.month) return `The first month's rent (€${Math.round(t.month).toLocaleString('en-GB')}) is due in advance, and the account can't cover it.`;
      return null;
    },
    leaseExitCost(id) { const s = sim(); return s && fn(s, 'leaseExitCost') ? s.leaseExitCost(id) : null; },
    endLease(id) {
      const s = sim();
      if (s) return fn(s, 'endLease') ? s.endLease(id) !== false : false;
      const x = S(); const p = x && x.parcels.find((q) => q.id === id);
      if (!p) return false;
      p.state = 'npc';
      return true;
    },
    /** machines/kit the player can sell: one row per asset (vehicles' kit despawns together) */
    machines() {
      const veh = ctx.modules.get('vehicles'), s = sim();
      if (!veh || !fn(veh, 'list')) return [];
      const assets = s && fn(s, 'assets') ? arr(s.assets()) : [];
      const seen = new Set(), out = [];
      for (const v of arr(veh.list())) {
        if (!v || v.owner === 'npc') continue;
        const key = v.assetId || v.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = v.assetId ? assets.find((q) => q.id === v.assetId) : null;
        if (!v.assetId && v.owner !== 'owned' && v.owner !== 'leased') continue;
        out.push({ id: v.id, name: v.name || v.type, type: v.type, assetId: v.assetId || null, asset: a || null, mode: a ? a.mode : (v.owner || null), value: a ? a.value : null, driverId: v.driverId || null });
      }
      return out;
    },
    /** why vehicles.sell(id) would refuse, mirroring its checks (it only returns false) */
    sellRefusal(id) {
      const veh = ctx.modules.get('vehicles'), s = sim();
      if (!veh || !fn(veh, 'sell')) return 'Machines can’t be traded right now.';
      const v = fn(veh, 'get') ? veh.get(id) : null;
      if (!v) return 'That machine is gone.';
      const nm = v.name || v.type || 'This machine';
      if (!v.assetId) return `${nm} isn’t on the farm’s asset register, so the dealer won’t take it.`;
      if (v.driverId) return `Someone is sitting in the ${nm}. Get out first.`;
      if (!s || !fn(s, 'releaseAsset')) return 'No dealer is open to buy machines.';
      if (fn(s, 'assets') && !arr(s.assets()).some((a) => a.id === v.assetId)) return `${nm} has no papers in the farm’s books (its asset record is missing), so it can’t be sold.`;
      return null;
    },
    sellMachine(id) {
      const why = this.sellRefusal(id);
      if (why) return { ok: false, reason: why };
      const veh = ctx.modules.get('vehicles');
      const r = veh.sell(id);
      if (r === false || r === undefined || r === null) return { ok: false, reason: this.sellRefusal(id) || 'The dealer refused the sale.' };
      return { ok: true, value: typeof r === 'number' ? r : 0 };
    },
    rentParcel(id) {
      const s = sim();
      if (s) return fn(s, 'rentParcel') ? s.rentParcel(id) !== false : false;
      const x = S(); const p = x && x.parcels.find((q) => q.id === id);
      if (!p) return false;
      p.state = 'rented';
      return true;
    },
    canAfford(v) {
      const s = sim();
      if (s && fn(s, 'canAfford')) return !!s.canAfford(v);
      const m = D.money();
      return m != null && m >= v;
    },
    weather() {
      const e = ctx.world.environment;
      if (e && e.weather && typeof e.weather === 'object' && e.weather.kind) return e.weather;
      return sampleEnabled ? sampleWeather(ctx) : null;
    },
    daylight() {
      const e = ctx.world.environment;
      if (e && typeof e.daylight === 'number') return e.daylight;
      const t = ctx.clock.timeOfDay; // fallback curve: dawn ~6, dusk ~20
      const up = Math.min(1, Math.max(0, (t - 5.5) / 1.6));
      const dn = Math.min(1, Math.max(0, (20.8 - t) / 1.6));
      return Math.min(up, dn);
    },
  };
  return D;
}
