// Money, ledger, summaries, inventory, catalog/assets, loans, hired workers.
import { CONST, YEAR_DAYS, MONTH_DAYS, WORKER_NAMES, MACHINES, ITEMS } from './data.js';

// categories that move capital or debt rather than profit (excluded from operating P&L)
const CONSUMABLE_SEIZE = { diesel: 0.5, fertiliser: 0.5 };
export const CAPITAL_CATEGORIES = ['loan', 'loanRepay', 'land', 'landSale', 'machinery', 'buildings', 'assetSale', 'writeOff'];
/** capital books an owned asset can sit in (r6): 'machinery' (default) or 'buildings' */
export const ASSET_BOOKS = ['machinery', 'buildings'];

export function installEconomy(sim) {
  const E = sim.world.economy;
  const api = sim.api;

  function initEconomy(opts = {}) {
    E.money = opts.money != null ? opts.money : CONST.startMoney;
    E.ledger = [];
    E.inventory = {};
    E.capacity = {};
    E.loans = [];
    E.catalog = E.catalog && Object.keys(E.catalog).length ? E.catalog : {};
    for (const m of MACHINES) if (!E.catalog[m.id]) E.catalog[m.id] = catalogEntry(m);
    E.assets = [];
    E.workers = [];
    E.fieldWork = { list: [], seq: 0 };
    E.days = [];
    E.nextId = 1;
    E.negativeDays = 0;
    E.overLimitDays = 0;
    E.version = 0;
  }

  const nid = (kind) => `simulation:${kind}:${E.nextId++}`;

  function bucket(day) {
    let b = E.days.length ? E.days[E.days.length - 1] : null;
    if (!b || b.day !== day) {
      b = { day, income: 0, expenses: 0, by: {} };
      E.days.push(b);
      if (E.days.length > CONST.historyDays) E.days.splice(0, E.days.length - CONST.historyDays);
    }
    return b;
  }

  /** the single place money changes. amount signed. */
  sim.record = function record(amount, category, memo, extra) {
    if (!Number.isFinite(amount)) throw new Error('economy: non-finite amount');
    amount = Math.round(amount * 100) / 100;
    if (amount === 0) return;
    E.money = Math.round((E.money + amount) * 100) / 100;
    const day = sim.today();
    const entry = { t: sim.now(), day, amount, category: category || 'misc', memo: memo || '', balance: E.money };
    E.ledger.push(entry);
    if (E.ledger.length > CONST.ledgerMax) E.ledger.splice(0, E.ledger.length - CONST.ledgerMax);
    const b = bucket(day);
    if (amount > 0) b.income += amount; else b.expenses -= amount;
    b.by[entry.category] = Math.round(((b.by[entry.category] || 0) + amount) * 100) / 100;
    E.version++;
    sim.emit('economy:transaction', { ...entry, ...(extra || {}) });
  };

  /** r6: one ledger row per `key` per game day. Repeated calls the same day add to that row (it moves to the end
   *  with the new running balance) instead of writing a new one. parts: {category: signed €} — each part is
   *  booked to its own category in the day totals (P&L stays split); the row shows the first part's category.
   *  acc: numbers summed on the row (e.g. {ha}); describe(row) → memo. Always books (like a forced charge). */
  sim.recordGrouped = function recordGrouped(key, parts, describe, acc, extra) {
    const r2 = (x) => Math.round(x * 100) / 100;
    const day = sim.today();
    let i = -1;
    for (let k = E.ledger.length - 1; k >= Math.max(0, E.ledger.length - 60); k--) if (E.ledger[k].key === key && E.ledger[k].day === day) { i = k; break; }
    const old = i >= 0 ? E.ledger[i] : null;
    const exact = { ...((old && old.exact) || {}) };
    // book whole cents of the exact running total, so many small calls add up to the cent
    const ps = [];
    for (const [k, v] of Object.entries(parts || {})) {
      if (!Number.isFinite(+v) || +v === 0) continue;
      const before = r2(exact[k] || 0);
      exact[k] = (exact[k] || 0) + +v;
      ps.push([k, r2(r2(exact[k]) - before)]);
    }
    if (!ps.length) return null;
    const amount = r2(ps.reduce((t, [, v]) => t + v, 0));
    E.money = r2(E.money + amount);
    const row = old ? E.ledger.splice(i, 1)[0] : { key, day, amount: 0, category: ps[0][0], parts: {}, acc: {} };
    row.exact = exact;
    row.t = sim.now();
    row.amount = r2(row.amount + amount);
    for (const [k, v] of ps) row.parts[k] = r2((row.parts[k] || 0) + v);
    for (const [k, v] of Object.entries(acc || {})) row.acc[k] = (row.acc[k] || 0) + (+v || 0);
    row.balance = E.money;
    row.memo = describe ? describe(row) : key;
    E.ledger.push(row);
    if (E.ledger.length > CONST.ledgerMax) E.ledger.splice(0, E.ledger.length - CONST.ledgerMax);
    const b = bucket(day);
    for (const [k, v] of ps) { if (v > 0) b.income += v; else b.expenses -= v; if (v) b.by[k] = r2((b.by[k] || 0) + v); }
    E.version++;
    sim.emit('economy:transaction', { ...row, parts: { ...row.parts }, acc: { ...row.acc }, exact: undefined, amount, rowTotal: row.amount, merged: i >= 0, ...(extra || {}) });
    return row;
  };

  function catalogEntry(def) {
    return {
      id: def.id, category: def.category || 'misc', name: def.name || def.id, price: +def.price || 0,
      leasePerDay: def.leasePerDay != null ? +def.leasePerDay : Math.round((+def.price || 0) * 0.2 / YEAR_DAYS * 100) / 100,
      upkeepPerDay: def.upkeepPerDay != null ? +def.upkeepPerDay : Math.round((+def.price || 0) * CONST.upkeepYear / YEAR_DAYS * 100) / 100,
      meta: { ...(def.meta || {}) },
    };
  }
  /** r6: which capital book an asset sits in. Buildings: purchase(…, {category:'buildings'}) or a catalog item
   *  whose meta.building is set (buildings module registrations, also when granted). */
  const bookOf = (a) => (a && a.book === 'buildings' ? 'buildings' : 'machinery');
  function bookFor(c, opts) {
    if (opts && ASSET_BOOKS.includes(opts.category)) return opts.category;
    return c && c.meta && c.meta.building ? 'buildings' : 'machinery';
  }
  function assetValue(a) {
    const years = Math.max(0, (sim.today() - a.boughtDay) / YEAR_DAYS);
    if (bookOf(a) === 'buildings') return a.price * Math.max(CONST.buildingFloor, CONST.buildingResaleNew - CONST.buildingDepreciationYear * years);
    return a.price * Math.max(0.2, CONST.assetResaleNew - CONST.assetDepreciationYear * years);
  }
  /** r7: upkeep scales with current value, not list price (an old machine/building costs less to keep) */
  function upkeepToday(a) { return a.price > 0 ? a.upkeepPerDay * assetValue(a) / a.price : a.upkeepPerDay; }
  /** owned asset value per book → { machinery, buildings } */
  function bookValues() {
    const r = { machinery: 0, buildings: 0 };
    for (const x of E.assets) if (x.mode === 'owned') r[bookOf(x)] += assetValue(x);
    return r;
  }
  /** collateral the bank lends against: land 60 %, machinery 50 %, buildings 40 % */
  function collateral() {
    const land = sim.landValue ? sim.landValue() : 0;
    const v = bookValues();
    return CONST.creditLandLTV * land + CONST.creditMachineLTV * v.machinery + CONST.creditBuildingLTV * v.buildings;
  }

  Object.assign(api, {
    money() { return E.money; },
    canAfford(x) { return Number.isFinite(x) && E.money >= x; },
    /** pay `amount` (≥0). Returns false (nothing charged) if unaffordable, unless opts.force. */
    charge(amount, category = 'misc', memo = '', opts = {}) {
      if (!Number.isFinite(amount) || amount < 0) return false;
      if (!opts.force && E.money < amount) return false;
      sim.record(-amount, category, memo);
      return true;
    },
    credit(amount, category = 'misc', memo = '') {
      if (!Number.isFinite(amount) || amount < 0) return false;
      sim.record(amount, category, memo);
      return true;
    },
    /** newest first */
    ledger(n = 20) { return E.ledger.slice(-n).reverse().map((e) => ({ ...e, ...(e.parts ? { parts: { ...e.parts }, acc: { ...e.acc } } : {}) })); },
    /** totals over the last `periodDays` game days (inclusive of today). operating* excludes capital/financing. */
    summary(periodDays = YEAR_DAYS, endDay) {
      const to = endDay == null ? sim.today() : endDay;
      const from = to - periodDays + 1;
      const r = { income: 0, expenses: 0, net: 0, operatingIncome: 0, operatingExpenses: 0, operatingNet: 0, byCategory: {}, days: periodDays };
      for (const b of E.days) {
        if (b.day < from || b.day > to) continue;
        for (const [k, v] of Object.entries(b.by)) {
          r.byCategory[k] = (r.byCategory[k] || 0) + v;
          if (v > 0) r.income += v; else r.expenses -= v;
          if (!CAPITAL_CATEGORIES.includes(k)) { if (v > 0) r.operatingIncome += v; else r.operatingExpenses -= v; }
        }
      }
      for (const k of Object.keys(r.byCategory)) r.byCategory[k] = Math.round(r.byCategory[k] * 100) / 100;
      r.net = Math.round((r.income - r.expenses) * 100) / 100;
      r.operatingNet = Math.round((r.operatingIncome - r.operatingExpenses) * 100) / 100;
      return r;
    },

    // ---------- inventory ----------
    inventory() { return { ...E.inventory }; },
    storageRoom(item) {
      const cap = E.capacity[item];
      const own = cap == null ? Infinity : Math.max(0, cap - (E.inventory[item] || 0));
      return CONST.bulkItems.includes(item) ? Math.min(own, api.bulkRoom()) : own;
    },
    /** t free in the shared bulk store (wheat, barley, oats, rapeseed, maize): the barn + grain stores */
    bulkRoom() {
      const cap = CONST.bulkBase + E.assets.reduce((t, a) => t + (a.mode === 'owned' && a.category === 'storage' ? (+(a.meta && a.meta.capacity) || 0) : 0), 0);
      const used = CONST.bulkItems.reduce((t, k) => t + (E.inventory[k] || 0), 0);
      return Math.max(0, cap - used);
    },
    /** returns the quantity actually stored (capacity-limited) */
    addInventory(item, qty) {
      if (!(qty > 0)) return 0;
      const add = Math.min(qty, api.storageRoom(item));
      if (add > 0) { E.inventory[item] = (E.inventory[item] || 0) + add; E.version++; }
      return add;
    },
    /** returns the quantity actually removed */
    removeInventory(item, qty) {
      const have = E.inventory[item] || 0;
      const take = Math.max(0, Math.min(have, qty));
      if (take > 0) { E.inventory[item] = have - take; if (E.inventory[item] < 1e-9) delete E.inventory[item]; E.version++; }
      return take;
    },
    setCapacity(item, qty) { if (qty == null) delete E.capacity[item]; else E.capacity[item] = Math.max(0, qty); E.version++; },

    // ---------- catalog / assets ----------
    registerCatalogItem(def) {
      if (!def || !def.id) throw new Error('registerCatalogItem: id required');
      E.catalog[def.id] = catalogEntry(def);

      return def.id;
    },
    catalog(category) { return Object.values(E.catalog).filter((c) => !category || c.category === category).map((c) => ({ ...c })); },
    /** buy a catalog item. Returns true on success; the owned asset is listed in assets().
     *  opts.finance: dealer finance — pay 25 % now, the rest as a 5-year loan secured on the machine
     *  (needs enough credit headroom once the machine is counted as collateral).
     *  opts.category: 'buildings' books the purchase in the buildings capital book (r6) — its own ledger category,
     *  2 %/yr depreciation, 40 % collateral; default 'machinery'. */
    purchase(id, opts = {}) {
      const c = E.catalog[id];
      if (!c || sim.blocked()) return false;
      opts = opts && typeof opts === 'object' ? opts : {};
      const book = bookFor(c, opts);
      if (opts && opts.finance) {
        const loan = Math.ceil(c.price * CONST.machineFinanceLTV / 100) * 100;
        const down = c.price - loan;
        const headroom = api.creditLimit() + (book === 'buildings' ? CONST.creditBuildingLTV * CONST.buildingResaleNew : CONST.creditMachineLTV * CONST.assetResaleNew) * c.price;
        if (E.money < down || headroom < loan) return false;
      }
      const assetId = nid('asset');
      if (opts && opts.finance) securedLoan(Math.ceil(c.price * CONST.machineFinanceLTV / 100) * 100, CONST.machineFinanceMonths, `Dealer finance on ${c.name}`, { assetId });
      if (!api.charge(c.price, book, book === 'buildings' ? `Built ${c.name}` : `Bought ${c.name}`)) return false;
      E.assets.push({ id: assetId, itemId: id, name: c.name, category: c.category, book, meta: c.meta, mode: 'owned', price: c.price, upkeepPerDay: c.upkeepPerDay, boughtDay: sim.today() });
      return true;
    },
    /** lease a catalog item (first day paid now). Returns true on success. */
    lease(id) {
      const c = E.catalog[id];
      if (!c || !(c.leasePerDay > 0) || sim.blocked()) return false;
      if (!api.charge(c.leasePerDay, 'lease', `Lease ${c.name} (first day)`)) return false;
      E.assets.push({ id: nid('asset'), itemId: id, name: c.name, category: c.category, meta: c.meta, mode: 'leased', price: c.price, leasePerDay: c.leasePerDay, upkeepPerDay: 0, boughtDay: sim.today() });
      return true;
    },
    /** give the player a catalog item without payment (starting kit, gifts). Returns asset id or null. */
    grantAsset(id, opts = {}) {
      const c = E.catalog[id];
      if (!c) return null;
      opts = opts && typeof opts === 'object' ? opts : {};
      // r7: opts.ageYears — an old grant (starting kit, the family farm): valued and maintained as that old
      const age = Number.isFinite(+opts.ageYears) && +opts.ageYears > 0 ? +opts.ageYears : 0;
      const boughtDay = opts.boughtDay != null ? opts.boughtDay : sim.today() - Math.round(age * YEAR_DAYS);
      const a = { id: nid('asset'), itemId: id, name: c.name, category: c.category, book: bookFor(c, opts), meta: c.meta, mode: 'owned', price: c.price, upkeepPerDay: c.upkeepPerDay, boughtDay, granted: true };
      E.assets.push(a);
      E.version++;
      return a.id;
    },
    assets() { return E.assets.map((a) => ({ ...a, value: a.mode === 'owned' ? Math.round(assetValue(a)) : 0, upkeepToday: a.mode === 'owned' ? Math.round(upkeepToday(a) * 100) / 100 : 0 })); },
    /** sell an owned asset (returns €) or hand back a leased one (returns 0).
     *  r6: opts.writeOff — demolish/scrap instead: no cash, one 'writeOff' ledger entry (amount 0, bookValue =
     *  what was written off); returns 0. Loans secured on it stay (they are still owed). */
    releaseAsset(assetId, opts = {}) {
      const i = E.assets.findIndex((a) => a.id === assetId);
      if (i < 0) return undefined;
      const a = E.assets[i];
      E.assets.splice(i, 1);
      if (a.mode === 'owned' && opts && opts.writeOff) {
        const v = Math.round(assetValue(a) * 100) / 100;
        writeOffEntry(v, `${bookOf(a) === 'buildings' ? 'Demolished' : 'Scrapped'} ${a.name} — €${Math.round(v).toLocaleString('en-GB')} book value written off`, { assetId: a.id, book: bookOf(a) });
        return 0;
      }
      if (a.mode === 'owned') { const v = assetValue(a); api.credit(v, 'assetSale', bookOf(a) === 'buildings' ? `Sold ${a.name}` : `Sold used ${a.name}`); return v - settleLinked({ assetId: a.id }); }
      E.version++;
      return 0;
    },

    /** cash + land market value + machinery value + buildings value + stored produce − debt */
    netWorth() {
      const land = sim.landValue ? sim.landValue() : 0;
      const { machinery, buildings } = bookValues();
      let stock = 0;
      for (const [k, q] of Object.entries(E.inventory)) if (ITEMS[k] && E.prices[k]) stock += q * E.prices[k] * 0.95;
      const debt = E.loans.reduce((a, l) => a + l.balance, 0);
      const r = { cash: E.money, land, machinery, buildings, stock, debt };
      r.total = Math.round(E.money + land + machinery + buildings + stock - debt);
      return r;
    },

    // ---------- loans ----------
    /** unsecured borrowing headroom: base + 60 % of last year's operating result + collateral − debt */
    creditLimit() {
      const debt = E.loans.reduce((a, l) => a + l.balance, 0) + Math.max(0, -E.money); // an overdraft is debt too
      const income = Math.max(0, api.summary(YEAR_DAYS).operatingNet);
      return Math.max(0, CONST.creditLimitBase + CONST.creditIncomeMult * income + collateral() - debt);
    },
    /** borrow; repaid monthly over opts.months (default 60). Returns loan id or null. */
    takeLoan(amount, opts = {}) {
      if (!(amount > 0) || sim.blocked() || amount > api.creditLimit() + 1e-6) return null;
      const months = Math.round(Math.max(3, Math.min(240, +opts.months || 60)));
      const [rlo, rhi] = CONST.loanRateRange;
      const rate = Math.max(rlo, Math.min(rhi, Number.isFinite(+opts.rate) && opts.rate != null ? +opts.rate : CONST.loanRate));
      const loan = { id: nid('loan'), principal: amount, balance: amount, rate, takenDay: sim.today(), months, monthly: amount / months, interestPaid: 0 };
      E.loans.push(loan);
      sim.record(amount, 'loan', `Loan €${Math.round(amount).toLocaleString('en-GB')} at ${(loan.rate * 100).toFixed(1)} %/yr over ${months} months`);
      return loan.id;
    },
    /** extra repayment. Returns amount repaid. */
    repayLoan(id, amount) {
      const l = E.loans.find((x) => x.id === id);
      if (!l) return 0;
      const pay = Math.max(0, Math.min(amount == null ? l.balance : amount, l.balance, E.money));
      if (pay <= 0) return 0;
      l.balance -= pay;
      sim.record(-pay, 'loanRepay', `Repaid €${Math.round(pay).toLocaleString('en-GB')} of loan`);
      if (l.balance < 0.01) E.loans.splice(E.loans.indexOf(l), 1);
      return pay;
    },
    loans() { return E.loans.map((l) => ({ ...l })); },

    // ---------- workers (r3: paid a day rate for days worked, a retainer when idle) ----------
    hireWorker(name) {
      if (sim.blocked()) return null;
      const rng = sim.rngFor('worker:' + E.nextId);
      const skill = rng.range(0, 1);
      const [lo, hi] = CONST.wageRange;
      const dayRate = Math.max(lo, Math.min(hi, Math.round((lo + (hi - lo) * (0.15 + 0.85 * skill) - rng.range(0, 10)) / 5) * 5));
      const w = { id: nid('worker'), name: name || rng.pick(WORKER_NAMES), dayRate, retainer: CONST.retainer, wage: dayRate, skill: +skill.toFixed(2), hiredDay: sim.today(), paid: 0, hoursToday: 0, daysWorked: 0 };
      E.workers.push(w);
      E.version++;
      return { ...w };
    },
    /** a hand worked `hours` game hours today (field work, jobs …); settles into wages the next morning */
    /** r4: logWork(workerId, gameHours, kind?) — a hand was active for `gameHours` today (kind: 'possessed' |
     *  'task' | 'job' | 'field' | …). ≥ 1 h on a day → that day is paid at the day rate, else the retainer.
     *  Returns the hours logged today (0 for an unknown worker). */
    logWork(workerId, hours, kind) {
      const w = E.workers.find((x) => x.id === workerId);
      if (!w || !(hours > 0) || !Number.isFinite(+hours)) return w ? w.hoursToday : 0;
      w.hoursToday = Math.min(24, (w.hoursToday || 0) + +hours);
      w.kinds = w.kinds || {};
      const k = String(kind || 'work');
      w.kinds[k] = +(((w.kinds[k] || 0) + +hours).toFixed(2));
      if (k === 'possessed') w.possessedAt = sim.now(); // r4c: that hour he is the player's, not on delegated jobs
      return w.hoursToday;
    },
    /** r4c: what a hand costs today — for the UI ("Dries is on the clock today").
     *  → { dayRate, retainer, onTheClock (≥ 1 h logged or a delegated job today), costToday, extraIfUsed } */
    workerDayCost(workerId) {
      const w = E.workers.find((x) => x.id === workerId);
      if (!w) return null;
      const on = (w.hoursToday || 0) >= 1 || !!w.delegatedToday;
      return { dayRate: w.dayRate, retainer: w.retainer, hoursToday: +(w.hoursToday || 0).toFixed(2), onTheClock: on, costToday: on ? w.dayRate : w.retainer, extraIfUsed: on ? 0 : w.dayRate - w.retainer };
    },
    /** r4: machines are reserved per day by category (tractor, combine, harvester, trailer, tillage, …).
     *  Returns true if one more unit of `category` was free today and is now held by `holderId`. */
    reserveMachine(category, holderId) {
      const R = machineDay();
      const key = category + '|' + holderId;
      if (R.by[key]) return true; // the same holder keeps its machine all day
      if ((R.used[category] || 0) >= ownedCount(category)) return false;
      R.used[category] = (R.used[category] || 0) + 1;
      R.by[key] = 1;
      return true;
    },
    /** units of a category owned and not yet reserved today */
    machinesFree(category) { const R = machineDay(); return Math.max(0, ownedCount(category) - (R.used[category] || 0)); },
    fireWorker(id) {
      const i = E.workers.findIndex((w) => w.id === id);
      if (i < 0) return false;
      const w = E.workers[i];
      settleWorker(w);
      E.workers.splice(i, 1);
      for (const j of (sim.world.jobs.list || [])) if (j.assignee === id && j.status === 'accepted') j.assignee = null;
      E.version++;
      return true;
    },
    workers() {
      const jobs = sim.world.jobs.list || [];
      return E.workers.map((w) => ({ ...w, assignedJobs: jobs.filter((j) => j.assignee === w.id && j.status === 'accepted').map((j) => j.id) }));
    },
    /** insolvency state: an overdraft beyond the credit headroom counts days; 30 → blocked, 60 → the bank sells assets */
    solvency() {
      const n = E.overLimitDays || 0, over = overLimit();
      return {
        overLimit: over, daysOverLimit: n, blocked: sim.blocked(), overdraft: Math.max(0, -E.money), creditLimit: api.creditLimit(),
        restructured: !!E.restructured, bankrupt: !!E.bankrupt,
        // r5: countdowns for the UI (null when not over the limit)
        daysToBlock: over ? Math.max(0, CONST.overLimitBlockDays - n) : null,
        daysToSettlement: over ? Math.max(0, CONST.overLimitSeizeDays - n) : null,
        nextStage: !over ? null : n < CONST.overLimitBlockDays ? 'blocked' : E.restructured ? 'bankrupt' : 'settlement',
      };
    },
  });

  /** daily running costs; called at the start of each new game day */
  function economyDay(day) {
    const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    for (const w of E.workers) settleWorker(w);
    for (const a of E.assets) {
      if (a.mode === 'owned' && a.upkeepPerDay > 0) api.charge(upkeepToday(a), 'upkeep', `Upkeep — ${a.name}`, { force: true });
      if (a.mode === 'leased') api.charge(a.leasePerDay, 'lease', `Lease — ${a.name}`, { force: true });
    }
    for (const l of E.loans.slice()) {
      const interest = l.balance * l.rate / YEAR_DAYS;
      l.interestPaid += interest;
      api.charge(interest, 'interest', 'Loan interest', { force: true });
      if (doy % MONTH_DAYS === 0 && !(l.graceUntil > day)) {
        const p = Math.min(l.balance, l.monthly);
        l.balance -= p;
        sim.record(-p, 'loanRepay', 'Loan instalment');
        if (l.balance < 0.01) E.loans.splice(E.loans.indexOf(l), 1);
      }
    }
    if (doy % MONTH_DAYS === 0) {
      const ha = sim.farmedHa ? sim.farmedHa() : 0;
      const fixed = CONST.fixedCostsMonthly + CONST.fixedCostsPerHaMonthly * ha;
      api.charge(fixed, 'insurance', `Insurance & overheads, ${ha.toFixed(1)} ha`, { force: true });
    }
    if (E.money < 0) {
      api.charge(-E.money * CONST.overdraftRate / YEAR_DAYS, 'interest', 'Overdraft interest', { force: true });
      E.negativeDays++;
    } else E.negativeDays = 0;
    // insolvency: over the limit = an overdraft the credit headroom no longer covers
    if (overLimit()) {
      E.overLimitDays = (E.overLimitDays || 0) + 1;
      const n = E.overLimitDays;
      const stage = n >= CONST.overLimitSeizeDays ? 'seizure' : n >= CONST.overLimitBlockDays ? 'blocked' : 'warning';
      sim.emit('economy:bankrupt-warning', { money: E.money, daysNegative: E.negativeDays, daysOverLimit: n, stage, creditLimit: api.creditLimit() });
      if (n >= CONST.overLimitSeizeDays) {
        // r5: one settlement day, 30 days into the block — the bank sells what it needs (machines, stock incl.
        // diesel/fertiliser, then land); if that is not enough, the hands are laid off and the overdraft is
        // restructured once, the same day. A second time it is bankruptcy.
        let k = 0;
        while (overLimit() && k++ < 200 && seizeOne());
        if (overLimit()) {
          if (E.workers.length) {
            const names = E.workers.map((w) => w.name);
            for (const w of E.workers.slice()) api.fireWorker(w.id);
            sim.emit('economy:hands-laid-off', { names, reason: 'insolvency' });
          }
          restructure();
        }
      }
    } else {
      E.overLimitDays = 0;
      if (E.money < 0) sim.emit('economy:bankrupt-warning', { money: E.money, daysNegative: E.negativeDays, daysOverLimit: 0, stage: 'overdraft', creditLimit: api.creditLimit() });
    }
  }

  /** r4c: restructure once, sized to what the farm can service: instalments ≤ ⅓ of last year's operating
   *  result (min €150/month), up to 20 years, 6 months' grace; whatever that cannot carry is written off. */
  function restructure() {
    if (E.restructured) { goBankrupt(); return; }
    E.restructured = true;
    const debt = Math.ceil(-E.money / 100) * 100;
    const income = Math.max(0, api.summary(YEAR_DAYS).operatingNet);
    const monthlyCap = Math.max(150, income / 12 / 3);
    const r = 0.06 / 12, n = 240;
    const carry = Math.floor(monthlyCap * (1 - Math.pow(1 + r, -n)) / r / 100) * 100; // annuity the farm can pay
    const loan = Math.min(debt, carry);
    const writeOff = debt - loan;
    if (writeOff > 0) sim.record(writeOff, 'loan', `Debt written off by the bank (restructuring)`);
    const months = loan > 0 ? Math.max(24, Math.min(n, Math.ceil(loan / monthlyCap))) : 0;
    if (loan > 0) {
      securedLoan(loan, months, 'Bank restructuring of the overdraft', { restructuring: true });
      const l = E.loans[E.loans.length - 1]; l.rate = 0.06; l.graceUntil = sim.today() + 6 * MONTH_DAYS;
    }
    E.overLimitDays = 0; E.nothingLeftDays = 0;
    sim.emit('economy:bankrupt-warning', { money: E.money, stage: 'restructured', daysOverLimit: 0, creditLimit: api.creditLimit(), loan, months, writeOff });
  }
  /** final state: leases are handed back (rent stops), the farm is blocked until cash is positive again */
  function goBankrupt() {
    if (E.bankrupt) return;
    E.bankrupt = true;
    if (sim.endAllLeases) sim.endAllLeases();
    sim.emit('economy:bankrupt-warning', { money: E.money, stage: 'bankrupt', daysOverLimit: E.overLimitDays, creditLimit: 0 });
  }

  function overLimit() {
    if (E.money >= 0) return false;
    // headroom not counting the overdraft itself
    const debt = E.loans.reduce((a, l) => a + l.balance, 0);
    const income = Math.max(0, api.summary(YEAR_DAYS).operatingNet);
    const head = CONST.creditLimitBase + CONST.creditIncomeMult * income + collateral() - debt;
    return -E.money > head;
  }
  sim.blocked = () => (!!E.bankrupt && E.money < 0) || (E.overLimitDays || 0) >= CONST.overLimitBlockDays;

  /** the bank sells the least valuable owned asset (machines first, then land) at 85 % of value */
  function seizeOne() {
    const mach = E.assets.filter((a) => a.mode === 'owned').map((a) => ({ a, v: assetValue(a) })).sort((x, y) => x.v - y.v);
    if (mach.length) {
      const { a, v } = mach[0];
      E.assets.splice(E.assets.indexOf(a), 1);
      const got = v * CONST.seizeValue;
      api.credit(got, 'assetSale', `Bank sale (insolvency): ${a.name}`);
      settleLinked({ assetId: a.id });
      sim.emit('economy:asset-seized', { kind: 'machine', id: a.id, name: a.name, amount: got });
      return true;
    }
    // r4c: stored produce is the easiest thing to liquidate — before any land
    // (r5) consumables too — they can't be resold on the market, so the bank takes them at 50 %
    const stock = Object.entries(E.inventory).filter(([k, q]) => q > 0.05 && ITEMS[k] && E.prices[k]);
    if (stock.length) {
      let got = 0;
      for (const [k, q] of stock) { got += q * E.prices[k] * (CONSUMABLE_SEIZE[k] || CONST.seizeValue); api.removeInventory(k, q); }
      api.credit(got, 'sales', 'Bank sale (insolvency): stored produce');
      sim.emit('economy:asset-seized', { kind: 'stock', id: 'stock', name: 'stored produce', amount: got });
      return true;
    }
    if (sim.seizeLand) return sim.seizeLand(CONST.seizeValue);
    return false;
  }

  /** repay loans secured on an asset/parcel from its sale proceeds; returns € repaid */
  function settleLinked(link) {
    let paid = 0;
    for (const l of E.loans.slice()) {
      if ((link.assetId && l.assetId === link.assetId) || (link.parcelId && l.parcelId === link.parcelId)) {
        const p = l.balance;
        sim.record(-p, 'loanRepay', `Loan settled from the sale — ${l.memo || 'secured loan'}`);
        E.loans.splice(E.loans.indexOf(l), 1);
        paid += p;
      }
    }
    return paid;
  }

  function machineDay(day = sim.today()) {
    if (!E.machineDay || E.machineDay.day !== day) E.machineDay = { day, used: {}, by: {} };
    return E.machineDay;
  }
  function ownedCount(cat) { return E.assets.filter((a) => a.mode === 'owned' && a.category === cat).length; }
  sim.machineDay = machineDay;

  function settleWorker(w) {
    const h = w.hoursToday || 0;
    let pay = h >= 1 || w.delegatedToday ? w.dayRate : w.retainer; // r4: any day with ≥ 1 h (or a delegated job) is a paid day
    // r8: a short day spent only on your own fields (assignFieldWork, < 5 h) is paid as a half day
    if (w.fieldHoursToday > 0 && w.fieldHoursToday >= h - 1e-6 && h < CONST.hoursPerDayHand / 2) pay = Math.max(w.retainer, Math.round(w.dayRate / 2));
    api.charge(pay, 'wages', h > 0 ? `Wages — ${w.name}, ${h.toFixed(1)} h` : `Retainer — ${w.name}`, { force: true });
    w.paid += pay;
    if (h >= 1 || w.delegatedToday) w.daysWorked = (w.daysWorked || 0) + 1;
    w.hoursToday = 0; w.delegatedToday = false; w.jobHoursToday = 0; w.fieldHoursToday = 0; w.kinds = {};
  }

  /** r6: a non-cash ledger line (amount 0) — capital written off without a sale */
  function writeOffEntry(bookValue, memo, extra) {
    const day = sim.today();
    const entry = { t: sim.now(), day, amount: 0, category: 'writeOff', memo, balance: E.money, bookValue };
    E.ledger.push(entry);
    if (E.ledger.length > CONST.ledgerMax) E.ledger.splice(0, E.ledger.length - CONST.ledgerMax);
    E.version++;
    sim.emit('economy:transaction', { ...entry, ...(extra || {}) });
  }

  /** a loan secured on a specific asset (mortgage); bypasses the unsecured credit limit. Internal. */
  function securedLoan(amount, months, memo, link = {}) {
    const loan = { id: nid('loan'), principal: amount, balance: amount, rate: CONST.loanRate, takenDay: sim.today(), months, monthly: amount / months, interestPaid: 0, secured: true, memo, ...link };
    E.loans.push(loan);
    sim.record(amount, 'loan', `${memo} — €${Math.round(amount).toLocaleString('en-GB')} over ${+(months / 12).toFixed(1)} years`);
    return loan.id;
  }

  sim.economy = { initEconomy, economyDay, nid, securedLoan, settleLinked, assetValue, bookValues };
}
