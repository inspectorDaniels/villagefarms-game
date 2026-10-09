// r8 (season loop S2/S4): hired hands work the player's OWN fields, and the sowing-window rules.
// A field task is worked abstractly at the AI rate (workRates().ai) in the hand's free working hours (after
// his delegated contract jobs), with a machine of the right category reserved for that day. It costs wages
// (logWork → the day rate) and diesel; no contractor fee. When done it emits `economy:contractor-done` with
// `source: 'hand'`, the same shape crops already applies; crops' echo of the sown cells (crops:worked
// {contractor:true}) charges the seed & inputs for exactly the area sown, as for a contractor.
import { CROPS, CONST, YEAR_DAYS, MONTH_DAYS, MONTHS, ITEMS } from './data.js';
import { OPS, OP_NEEDS, SELF_PROPELLED, DIESEL_L_HA, haPerGameHour } from './work.js';

const ROOTS = ['potatoes', 'sugarBeet'];

export function installFieldwork(sim) {
  const E = sim.world.economy;
  const api = sim.api;
  const month = (day) => Math.floor((((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / MONTH_DAYS);
  const owned = (cat) => (E.assets || []).filter((a) => a.mode === 'owned' && a.category === cat);
  const T = () => (E.fieldWork || (E.fieldWork = { list: [], seq: 0 }));
  const pub = (t) => ({ ...t, progress: t.areaM2 > 0 ? Math.min(1, t.doneM2 / t.areaM2) : 0 });
  const r2 = (x) => Math.round(x * 100) / 100;
  let lastRefusal = null;
  const refuse = (reason, extra) => { lastRefusal = { reason, ...(extra || {}) }; return { ok: false, reason, ...(extra || {}) }; };

  // ---------- S4: sowing windows ----------
  /** crops that may be sown in `m` (0..11) */
  const inSeason = (m) => Object.keys(CROPS).filter((c) => CROPS[c].sowMonths.includes(m));
  function seedingWindow(crop, day = sim.today()) {
    const c = CROPS[crop];
    const m = month(day);
    const alternatives = inSeason(m);
    if (!c) return { crop, known: false, inWindow: false, months: [], alternatives, reason: `Unknown crop "${crop}"` };
    const inWindow = c.sowMonths.includes(m);
    // game days until the window next opens (0 when open)
    let opensInDays = 0;
    if (!inWindow) {
      const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
      opensInDays = Math.min(...c.sowMonths.map((sm) => (((sm * MONTH_DAYS - doy) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS));
    }
    const span = c.sowMonths.map((x) => MONTHS[x]).join('–');
    const names = alternatives.map((a) => CROPS[a].name.toLowerCase());
    return {
      crop, known: true, name: c.name, months: c.sowMonths.slice(), monthNames: c.sowMonths.map((x) => MONTHS[x]), nowMonth: MONTHS[m],
      inWindow, opensInDays, alternatives,
      reason: inWindow ? null : `${c.name} is sown in ${span}; it is ${MONTHS[m]} now.${names.length ? ' In season: ' + names.join(', ') + '.' : ' Nothing can be sown this month.'}`,
    };
  }
  /** refusal object for sowing `crop` today, or null when it may be sown */
  function sowRefusal(crop) {
    if (!crop) return null;
    const w = seedingWindow(crop);
    return w.inWindow ? null : { reason: w.reason, alternatives: w.alternatives, opensInDays: w.opensInDays };
  }
  sim.sowRefusal = sowRefusal;
  sim.setRefusal = (r) => { lastRefusal = r ? { ...r } : null; };

  // ---------- S2: field tasks ----------
  function rateFor(op) {
    const tiers = owned('tractor').map((a) => (a.meta && a.meta.tier) || 1);
    let tier = tiers.length ? Math.max(...tiers) : 1;
    if (op === 'plough' || op === 'sow') tier = Math.min(tier, owned('tillage').some((a) => a.meta && a.meta.size === 2) ? 3 : 1);
    const combine = owned('combine').some((a) => a.itemId === 'combine_l') ? 'combine_l' : 'combine_s';
    return haPerGameHour(sim.rates, op, 'ai', tier, combine);
  }
  const catsFor = (op) => { const c = []; if (!SELF_PROPELLED[op]) c.push('tractor'); if (OP_NEEDS[op] && OP_NEEDS[op] !== 'tractor') c.push(OP_NEEDS[op]); return c; };
  /** owned machines of `cat` that are physically being driven right now (live: vehicles; none headless) */
  function drivenCount(cat) {
    const ids = sim.drivenAssets ? sim.drivenAssets() : null;
    if (!ids || !ids.size) return 0;
    return owned(cat).filter((a) => ids.has(a.id)).length;
  }
  /** can `holder` have one `cat` today (already holds one, or one is unreserved and not being driven)? */
  function canUse(cat, holder, day) {
    const R = sim.machineDay(day);
    const mine = !!R.by[cat + '|' + holder];
    const others = (R.used[cat] || 0) - (mine ? 1 : 0);
    return owned(cat).length - others - drivenCount(cat) >= 1;
  }
  function hold(cat, holder, day) {
    const R = sim.machineDay(day);
    const key = cat + '|' + holder;
    if (R.by[key]) return;
    R.used[cat] = (R.used[cat] || 0) + 1; R.by[key] = 1;
  }
  function resolveTarget(target, opts) {
    let parcelId = null, fieldId = null, areaM2 = null;
    const info = sim.fieldInfo ? sim.fieldInfo(target) : null; // live: crops field → {parcelId, areaM2}
    if (info && info.parcelId) { fieldId = target; parcelId = info.parcelId; areaM2 = info.areaM2; }
    else if (api.parcel(target)) parcelId = target;
    else if (opts.parcelId && api.parcel(opts.parcelId)) { fieldId = target; parcelId = opts.parcelId; }
    const p = parcelId ? api.parcel(parcelId) : null;
    if (!p) return null;
    const cap = areaM2 > 0 ? Math.min(areaM2, p.area) : p.area;
    if (opts.areaM2 > 0) areaM2 = Math.min(+opts.areaM2, cap); else areaM2 = cap;
    return { p, parcelId, fieldId, areaM2 };
  }

  Object.assign(api, {
    /** S4: when `crop` can be sown → { crop, name, months, monthNames, nowMonth, inWindow, opensInDays,
     *  alternatives (crops sowable now), reason (null when in window) } */
    seedingWindow(crop) { return seedingWindow(crop); },
    /** the last refusal from hireContractor / assignFieldWork: { reason, alternatives? } or null */
    lastRefusal() { return lastRefusal ? { ...lastRefusal } : null; },
    /** S2: a hired hand works `operation` on the player's own field (crops field id) or parcel.
     *  operation: plough | cultivate | sow | spray | mow | harvest | lift | bale; opts: { crop (sow), areaM2 }.
     *  → { ok: true, id, task } or { ok: false, reason, alternatives? }. Worked in the hand's free working
     *  hours (after his contract jobs) at the AI rate; wages (day rate) and diesel are charged here, sowing inputs
     *  when crops applies the sowing (its crops:worked echo), exactly as for a contractor. */
    assignFieldWork(workerId, target, operation, opts = {}) {
      opts = opts && typeof opts === 'object' ? opts : {};
      lastRefusal = null;
      if (sim.blocked()) return refuse('The bank has blocked the farm (insolvency)');
      const w = (E.workers || []).find((x) => x.id === workerId);
      if (!w) return refuse('No such hired hand');
      const op = operation === 'seed' || operation === 'drill' ? 'sow' : operation;
      if (!OPS.includes(op)) return refuse(`Unknown operation "${operation}"`);
      const t = resolveTarget(target, opts);
      if (!t) return refuse('Unknown field or parcel');
      if (t.p.state !== 'owned' && t.p.state !== 'rented') return refuse(`${t.p.name} is not your land`);
      const missing = catsFor(op).filter((c) => !owned(c).length);
      if (missing.length) return refuse(`You have no ${missing.join(' or ')} for ${op === 'sow' ? 'drilling' : op}`, { needs: missing });
      let crop = opts.crop || null;
      if (op === 'sow') {
        if (crop && !CROPS[crop]) return refuse(`Unknown crop "${crop}"`);
        if (!crop) crop = inSeason(month(sim.today()))[0] || null;
        if (!crop) return refuse(seedingWindow('wheat').reason, { alternatives: [] });
        const no = sowRefusal(crop);
        if (no) return refuse(no.reason, { alternatives: no.alternatives, opensInDays: no.opensInDays });
      }
      if ((op === 'harvest' || op === 'lift') && crop && CROPS[crop]) {
        if (ROOTS.includes(crop) !== (op === 'lift')) return refuse(op === 'lift' ? 'Only potatoes and sugar beet are lifted' : 'Roots are lifted, not combined', { use: ROOTS.includes(crop) ? 'lift' : 'harvest' });
      }
      const dup = T().list.find((x) => (x.status === 'queued' || x.status === 'working') && x.parcelId === t.parcelId && (x.fieldId || null) === (t.fieldId || null) && x.op === op);
      if (dup) return refuse(`${dup.workerName} is already on that (${op})`, { id: dup.id });
      const S = T();
      const task = {
        id: `simulation:fieldwork:${++S.seq}`, workerId, workerName: w.name, parcelId: t.parcelId, fieldId: t.fieldId, name: t.p.name,
        op, crop, areaM2: Math.round(t.areaM2), doneM2: 0, hours: 0, fuel: 0, inputs: 0, status: 'queued', assignedDay: sim.today(),
        startedDay: null, doneDay: null, machines: catsFor(op),
      };
      S.list.push(task);
      E.version++;
      return { ok: true, id: task.id, task: pub(task) };
    },
    /** cancel a queued/working field task (work already done stays done and paid). Returns true if cancelled. */
    cancelFieldWork(id) {
      const t = T().list.find((x) => x.id === id);
      if (!t || (t.status !== 'queued' && t.status !== 'working')) return false;
      t.status = 'cancelled'; t.doneDay = sim.today();
      E.version++;
      sim.emit('economy:fieldwork-progress', { ...pub(t), taskId: t.id });
      return true;
    },
    /** field tasks: filter = status string | { workerId, parcelId, fieldId, status } | predicate; newest last */
    fieldWork(filter) {
      let l = T().list;
      if (typeof filter === 'string') l = l.filter((t) => t.status === filter);
      else if (typeof filter === 'function') l = l.filter((t) => filter(pub(t)));
      else if (filter && typeof filter === 'object') l = l.filter((t) => Object.entries(filter).every(([k, v]) => t[k] === v));
      return l.map(pub);
    },
    fieldWorkStatus(id) { const t = T().list.find((x) => x.id === id); return t ? pub(t) : null; },
    /** € a hand would cost for this task vs a contractor (estimate, no booking): { hours, fuel, inputs, wageExtra, hand, contractor } */
    fieldWorkQuote(workerId, target, operation, opts = {}) {
      const t = resolveTarget(target, opts || {});
      const op = operation === 'seed' || operation === 'drill' ? 'sow' : operation;
      if (!t || !OPS.includes(op)) return null;
      const ha = t.areaM2 / 1e4, rate = rateFor(op);
      const hours = rate > 0 ? ha / rate : Infinity;
      const fuel = r2((DIESEL_L_HA[op] || 5) * ha * dieselPrice());
      const w = (E.workers || []).find((x) => x.id === workerId);
      const onClock = w ? (w.hoursToday || 0) >= 1 || !!w.delegatedToday : false;
      const wageExtra = w ? (onClock ? 0 : w.dayRate - w.retainer) : null;
      const q = api.contractorQuote ? api.contractorQuote(t.parcelId, op, { areaM2: t.areaM2 }) : null;
      const c = opts.crop ? api.inputCost(opts.crop) : null;
      const inputs = op === 'sow' && c ? r2(c.total * ha) : 0;
      return { hours: +hours.toFixed(2), days: Math.ceil(hours / CONST.hoursPerDayHand), fuel, inputs, wageExtra, hand: wageExtra == null ? null : r2(wageExtra + fuel), contractor: q ? q.price : null };
    },
  });

  function dieselPrice() { return (E.prices && E.prices.diesel) || ITEMS.diesel.base; }

  /** work the hand's field tasks with `free` game hours; returns hours used. Called by jobs.workDelegated. */
  function workTasks(w, free, day) {
    let used = 0;
    const mine = T().list.filter((t) => t.workerId === w.id && (t.status === 'queued' || t.status === 'working'));
    for (const t of mine) {
      if (free - used <= 0.05) break;
      if (t.op === 'sow' && sowRefusal(t.crop)) { // the window closed while it waited
        t.status = 'refused'; t.reason = sowRefusal(t.crop).reason; t.doneDay = day; E.version++;
        sim.emit('economy:fieldwork-progress', { ...pub(t), taskId: t.id });
        continue;
      }
      const p = api.parcel(t.parcelId);
      if (!p || (p.state !== 'owned' && p.state !== 'rented')) { t.status = 'cancelled'; t.reason = 'no longer your land'; t.doneDay = day; continue; }
      // one machine of each category for the day, not one the player (or anyone) is driving right now
      if (!t.machines.every((c) => canUse(c, w.id, day))) { t.waiting = 'machine'; continue; }
      t.machines.forEach((c) => hold(c, w.id, day));
      t.waiting = null;
      const rate = rateFor(t.op);
      if (!(rate > 0)) continue;
      const leftHa = Math.max(0, t.areaM2 - t.doneM2) / 1e4;
      const h = Math.min(free - used, leftHa / rate);
      const ha = Math.min(leftHa, h * rate);
      used += h;
      api.logWork(w.id, h, 'field');
      w.delegatedToday = true;
      w.jobHoursToday = (w.jobHoursToday || 0) + h;
      w.fieldHoursToday = (w.fieldHoursToday || 0) + h;
      if (t.status === 'queued') { t.status = 'working'; t.startedDay = day; }
      t.hours = +(t.hours + h).toFixed(3);
      t.doneM2 = Math.min(t.areaM2, t.doneM2 + ha * 1e4);
      // diesel (one ledger row per task per day)
      const litres = (DIESEL_L_HA[t.op] || 5) * ha;
      const fuel = litres * dieselPrice();
      t.fuel = r2(t.fuel + fuel);
      sim.recordGrouped(`hand|${t.id}`, { fuel: -fuel }, (row) => `Diesel — ${w.name}, ${t.op} ${(row.acc.ha || 0).toFixed(2)} ha, ${t.name}`, { ha }, { workerId: w.id, taskId: t.id });
      E.version++;
      if (t.doneM2 >= t.areaM2 - 0.5) finish(t, day);
      else sim.emit('economy:fieldwork-progress', { ...pub(t), taskId: t.id });
    }
    return used;
  }
  function finish(t, day) {
    t.status = 'done'; t.doneDay = day; t.doneM2 = t.areaM2;
    if (sim.creditWork) sim.creditWork(t.parcelId, t.op, t.areaM2); // CAP: the worked area (crops' echo is ignored)
    sim.emit('economy:fieldwork-progress', { ...pub(t), taskId: t.id });
    sim.emit('economy:contractor-done', {
      source: 'hand', workerId: t.workerId, parcelId: t.parcelId, fieldId: t.fieldId, operation: t.op, areaM2: t.areaM2, crop: t.crop,
      bookingId: t.id, booking: { ...pub(t), source: 'hand' },
    });
  }
  /** daily tidy-up: keep a short history */
  function fieldworkDay() {
    const S = T();
    if (S.list.length > 60) S.list = S.list.filter((t, i) => t.status === 'queued' || t.status === 'working' || i >= S.list.length - 40);
  }
  sim.fieldwork = { workTasks, fieldworkDay, seedingWindow, sowRefusal };
}
