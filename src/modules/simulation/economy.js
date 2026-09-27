// Money, ledger, summaries, inventory, catalog/assets, loans, hired workers.
import { CONST, YEAR_DAYS, MONTH_DAYS, WORKER_NAMES, MACHINES, ITEMS } from './data.js';

// categories that move capital or debt rather than profit (excluded from operating P&L)
export const CAPITAL_CATEGORIES = ['loan', 'loanRepay', 'land', 'landSale', 'machinery', 'assetSale'];

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
    E.days = [];
    E.nextId = 1;
    E.negativeDays = 0;
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

  function catalogEntry(def) {
    return {
      id: def.id, category: def.category || 'misc', name: def.name || def.id, price: +def.price || 0,
      leasePerDay: def.leasePerDay != null ? +def.leasePerDay : Math.round((+def.price || 0) * 0.2 / YEAR_DAYS * 100) / 100,
      upkeepPerDay: def.upkeepPerDay != null ? +def.upkeepPerDay : Math.round((+def.price || 0) * CONST.upkeepYear / YEAR_DAYS * 100) / 100,
      meta: { ...(def.meta || {}) },
    };
  }
  function assetValue(a) {
    const years = Math.max(0, (sim.today() - a.boughtDay) / YEAR_DAYS);
    return a.price * Math.max(0.2, CONST.assetResaleNew - CONST.assetDepreciationYear * years);
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
    ledger(n = 20) { return E.ledger.slice(-n).reverse().map((e) => ({ ...e })); },
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
      return cap == null ? Infinity : Math.max(0, cap - (E.inventory[item] || 0));
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
     *  (needs enough credit headroom once the machine is counted as collateral). */
    purchase(id, opts = {}) {
      const c = E.catalog[id];
      if (!c) return false;
      if (opts && opts.finance) {
        const loan = Math.ceil(c.price * CONST.machineFinanceLTV / 100) * 100;
        const down = c.price - loan;
        const headroom = api.creditLimit() + CONST.creditMachineLTV * c.price * CONST.assetResaleNew;
        if (E.money < down || headroom < loan) return false;
        securedLoan(loan, CONST.machineFinanceMonths, `Dealer finance on ${c.name}`);
      }
      if (!api.charge(c.price, 'machinery', `Bought ${c.name}`)) return false;
      E.assets.push({ id: nid('asset'), itemId: id, name: c.name, category: c.category, meta: c.meta, mode: 'owned', price: c.price, upkeepPerDay: c.upkeepPerDay, boughtDay: sim.today() });
      return true;
    },
    /** lease a catalog item (first day paid now). Returns true on success. */
    lease(id) {
      const c = E.catalog[id];
      if (!c || !(c.leasePerDay > 0)) return false;
      if (!api.charge(c.leasePerDay, 'lease', `Lease ${c.name} (first day)`)) return false;
      E.assets.push({ id: nid('asset'), itemId: id, name: c.name, category: c.category, meta: c.meta, mode: 'leased', price: c.price, leasePerDay: c.leasePerDay, upkeepPerDay: 0, boughtDay: sim.today() });
      return true;
    },
    /** give the player a catalog item without payment (starting kit, gifts). Returns asset id or null. */
    grantAsset(id, opts = {}) {
      const c = E.catalog[id];
      if (!c) return null;
      const a = { id: nid('asset'), itemId: id, name: c.name, category: c.category, meta: c.meta, mode: 'owned', price: c.price, upkeepPerDay: c.upkeepPerDay, boughtDay: opts.boughtDay != null ? opts.boughtDay : sim.today() };
      E.assets.push(a);
      E.version++;
      return a.id;
    },
    assets() { return E.assets.map((a) => ({ ...a, value: a.mode === 'owned' ? Math.round(assetValue(a)) : 0 })); },
    /** sell an owned asset (returns €) or hand back a leased one (returns 0) */
    releaseAsset(assetId) {
      const i = E.assets.findIndex((a) => a.id === assetId);
      if (i < 0) return undefined;
      const a = E.assets[i];
      E.assets.splice(i, 1);
      if (a.mode === 'owned') { const v = assetValue(a); api.credit(v, 'assetSale', `Sold used ${a.name}`); return v; }
      E.version++;
      return 0;
    },

    /** cash + land market value + machinery value + stored produce − debt */
    netWorth() {
      const land = sim.landValue ? sim.landValue() : 0;
      const machinery = E.assets.reduce((a, x) => a + (x.mode === 'owned' ? assetValue(x) : 0), 0);
      let stock = 0;
      for (const [k, q] of Object.entries(E.inventory)) if (ITEMS[k] && E.prices[k]) stock += q * E.prices[k] * 0.95;
      const debt = E.loans.reduce((a, l) => a + l.balance, 0);
      const r = { cash: E.money, land, machinery, stock, debt };
      r.total = Math.round(E.money + land + machinery + stock - debt);
      return r;
    },

    // ---------- loans ----------
    /** unsecured borrowing headroom: base + 60 % of last year's operating result + collateral − debt */
    creditLimit() {
      const land = sim.landValue ? sim.landValue() : 0;
      const mach = E.assets.reduce((a, x) => a + (x.mode === 'owned' ? assetValue(x) : 0), 0);
      const debt = E.loans.reduce((a, l) => a + l.balance, 0);
      const income = Math.max(0, api.summary(YEAR_DAYS).operatingNet);
      return Math.max(0, CONST.creditLimitBase + CONST.creditIncomeMult * income + CONST.creditLandLTV * land + CONST.creditMachineLTV * mach - debt);
    },
    /** borrow; repaid monthly over opts.months (default 60). Returns loan id or null. */
    takeLoan(amount, opts = {}) {
      if (!(amount > 0) || amount > api.creditLimit() + 1e-6) return null;
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

    // ---------- workers ----------
    hireWorker(name) {
      const rng = sim.rngFor('worker:' + E.nextId);
      const skill = rng.range(0, 1);
      const wage = Math.round((CONST.wageRange[0] + (CONST.wageRange[1] - CONST.wageRange[0]) * (0.2 + 0.8 * skill) - rng.range(0, 30)) / 5) * 5;
      const w = { id: nid('worker'), name: name || rng.pick(WORKER_NAMES), wage: Math.max(CONST.wageRange[0], wage), skill: +skill.toFixed(2), hiredDay: sim.today(), paid: 0 };
      E.workers.push(w);
      E.version++;
      return { ...w };
    },
    fireWorker(id) {
      const i = E.workers.findIndex((w) => w.id === id);
      if (i < 0) return false;
      const w = E.workers[i];
      E.workers.splice(i, 1);
      api.charge(w.wage, 'wages', `Final day's pay — ${w.name}`, { force: true });
      return true;
    },
    workers() { return E.workers.map((w) => ({ ...w })); },
  });

  /** daily running costs; called at the start of each new game day */
  function economyDay(day) {
    const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    for (const w of E.workers) { api.charge(w.wage, 'wages', `Wages — ${w.name}`, { force: true }); w.paid += w.wage; }
    for (const a of E.assets) {
      if (a.mode === 'owned' && a.upkeepPerDay > 0) api.charge(a.upkeepPerDay, 'upkeep', `Upkeep — ${a.name}`, { force: true });
      if (a.mode === 'leased') api.charge(a.leasePerDay, 'lease', `Lease — ${a.name}`, { force: true });
    }
    for (const l of E.loans.slice()) {
      const interest = l.balance * l.rate / YEAR_DAYS;
      l.interestPaid += interest;
      api.charge(interest, 'interest', 'Loan interest', { force: true });
      if (doy % MONTH_DAYS === 0) {
        const p = Math.min(l.balance, l.monthly);
        l.balance -= p;
        sim.record(-p, 'loanRepay', 'Loan instalment');
        if (l.balance < 0.01) E.loans.splice(E.loans.indexOf(l), 1);
      }
    }
    if (doy % MONTH_DAYS === 0) {
      const ha = sim.farmedHa ? sim.farmedHa() : 0;
      const fixed = CONST.fixedCostsMonthly + CONST.fixedCostsPerHaMonthly * ha;
      api.charge(fixed, 'insurance', `Insurance, accountant & utilities (${ha.toFixed(1)} ha)`, { force: true });
    }
    if (E.money < 0) {
      api.charge(-E.money * CONST.overdraftRate / YEAR_DAYS, 'interest', 'Overdraft interest', { force: true });
      E.negativeDays++;
      sim.emit('economy:bankrupt-warning', { money: E.money, daysNegative: E.negativeDays, creditLimit: api.creditLimit() });
    } else E.negativeDays = 0;
  }

  /** a loan secured on a specific asset (mortgage); bypasses the unsecured credit limit. Internal. */
  function securedLoan(amount, months, memo) {
    if (E.money + amount < 0) return null;
    const loan = { id: nid('loan'), principal: amount, balance: amount, rate: CONST.loanRate, takenDay: sim.today(), months, monthly: amount / months, interestPaid: 0, secured: true };
    E.loans.push(loan);
    sim.record(amount, 'loan', `${memo} — €${Math.round(amount).toLocaleString('en-GB')} over ${+(months / 12).toFixed(1)} years`);
    return loan.id;
  }

  sim.economy = { initEconomy, economyDay, nid, securedLoan };
}
