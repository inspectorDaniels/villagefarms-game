// The game-flow layer on top of the composed world: tutorial toasts, the "Getting started" objectives card,
// and the Farm office panel (K): store sales, the seed drill's crop, hands (hire / fire / delegate jobs) and
// contractor bookings for the player's own fields. Also charges seed & inputs when the player sows
// (nobody else does yet; see docs/core-requests/demo.md).

const GOALS = [
  ['tractor', 'Get into your tractor', 'Walk to the tractor in the yard and press F'],
  ['plough', 'Plough Lindeveldje', 'Drive south to the rented field, E lowers the plough'],
  ['job', 'Accept a contract job', 'J opens the jobs board'],
  ['sell', 'Sell grain', 'Farm office (K): sell last year\'s wheat, or deliver a trailer at the co-op (R)'],
  ['hire', 'Hire a farmhand', 'Farm office (K) → Hire. Tab switches between people'],
  ['sow', 'Sow Lindeveldje', 'H unhitches the plough; hitch the seed drill (H), pick the crop in K, E to sow'],
];
const TIPS = [
  [1.5, 'Welcome to Hoeve Ter Linde', 'You own the farmyard and rent Lindeveldje (1.8 ha) just south of it. Money is tight: contract jobs pay the bills this first year.'],
  [9, 'Walking', 'WASD or arrows walk, Shift runs. Tab switches between your people. 1–5 pick a hand tool, E uses it.'],
  [17, 'Machines', 'F gets in or out of the vehicle next to you. In a tractor: E lowers or raises the implement, H hitches or unhitches, G refuels at the machine shed, L lights.'],
  [25, 'Buildings', 'Stop next to a sell point or workshop and press R to sell your load or repair the machine.'],
  [33, 'Panels', 'J jobs · P market · M land · O finances · K farm office (store, seed, hands, contractors) · H help · Space pause · + / − speed.'],
];
const SELL_FEE = 0.08; // buyer collects from the farm store: 8 % haulage

export function createOffice(ctx, D) {
  const mod = (id) => ctx.modules.get(id);
  const W = ctx.world;
  let UI = null, started = false, tipT = 0, checkT = 0, hudOn = false;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => { const ui = mod('ui'); return ui && ui.formatMoney ? ui.formatMoney(v, { dec: 0 }) : '€' + Math.round(v); };
  const toast = (text, o) => { const ui = mod('ui'); if (ui && ui.toast) ui.toast(text, o || {}); };
  const progress = {};

  function done(key, info) {
    if (D.objectives[key]) return;
    D.objectives[key] = { t: Math.round(ctx.clock.t || 0) };
    const g = GOALS.find((x) => x[0] === key);
    ctx.events.emit('demo:objective', { id: key, info: info || null });
    if (g) toast(`Done: ${g[1]}`, { kind: 'success', icon: 'check', ms: 4500 });
    const next = GOALS.find((x) => !D.objectives[x[0]]);
    if (next) setTimeoutToast(next);
    else toast('The farm is yours to grow: rent more land (M), buy better machines, hire hands and delegate jobs.', { kind: 'info', title: 'Getting started — complete', ms: 9000 });
  }
  let pendingNext = null;
  function setTimeoutToast(next) { pendingNext = { g: next, t: 2.5 }; }

  // ---------------------------------------------------------------- field progress
  function fieldShare(kinds) {
    const cr = mod('crops');
    const st = cr && D.fields.start ? cr.stats(D.fields.start) : null;
    if (!st || !st.cells) return 0;
    let n = 0;
    for (const k of kinds) n += (st.counts && st.counts[k]) || 0;
    return n / st.cells;
  }

  // ---------------------------------------------------------------- events
  ctx.events.on('vehicles:entered', (e) => { if (e && D.ids.tractor && e.vehicleId === D.ids.tractor) done('tractor'); });
  ctx.events.on('jobs:accepted', () => done('job'));
  ctx.events.on('economy:transaction', (e) => {
    if (e && e.amount > 0 && (e.item || e.category === 'sale' || e.category === 'sales')) done('sell', { item: e.item, amount: e.amount });
  });
  ctx.events.on('crops:worked', (e) => {
    if (!e || e.contractor) return;
    D.stats.lastWorked = { tool: e.tool, parcelId: e.parcelId, areaM2: e.areaM2 };
    // seed & inputs are charged by simulation on crops:worked (seed:<crop>) since simulation r6
  });

  // ---------------------------------------------------------------- actions
  function sellPointsFor(item) {
    const S = mod('simulation');
    const sps = (S && S.sellPoints && S.sellPoints()) || [];
    return (Array.isArray(sps) ? sps : Object.values(sps)).filter((s) => s && (!s.accepts || s.accepts.includes(item)) && S.price(item, s.id) > 0);
  }
  /** sell from the farm store; the buyer collects and keeps SELL_FEE for haulage */
  function sellFromStore(item, qty, sellPointId) {
    const S = mod('simulation');
    if (!S) return 0;
    const inv = S.inventory() || {};
    const have = +inv[item] || 0;
    const q = Math.min(have, qty == null ? have : +qty);
    if (!(q > 0)) return 0;
    const sp = sellPointId || (sellPointsFor(item).sort((a, b) => S.price(item, b.id) - S.price(item, a.id))[0] || {}).id;
    if (!sp) return 0;
    const got = S.sell(item, q, sp) || 0;
    if (got > 0) S.charge(got * SELL_FEE, 'transport', `Collection by buyer: ${q.toFixed(1)} ${item}`, { force: true });
    return got * (1 - SELL_FEE);
  }
  function hireHand() {
    const CH = mod('characters'), S = mod('simulation');
    if (!CH || !CH.hire) return null;
    const home = D.sites && D.sites.farm;
    const n = S && S.workers ? (S.workers() || []).length : 0;
    const id = CH.hire(home ? { x: home.x - 14 + n * 1.5, y: home.y - 20 } : {});
    if (id) done('hire');
    return id;
  }

  // ---------------------------------------------------------------- panel
  let tab = 'farm';
  function panelHtml() {
    const S = mod('simulation'), V = mod('vehicles'), CR = mod('crops'), CH = mod('characters');
    let h = `<div class="hv-seg" style="margin-bottom:12px">${[['farm', 'Store & seed'], ['crew', 'Hands'], ['fields', 'Fields & contractors']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (!S) return h + '<p class="muted">The farm office needs the economy.</p>';
    if (tab === 'farm') {
      const inv = S.inventory() || {};
      const items = Object.keys(inv).filter((k) => inv[k] > 0.01 && k !== 'diesel' && k !== 'fertiliser');
      h += `<h3 style="font:600 15px Georgia,serif;margin:4px 0 8px">Farm store</h3>`;
      if (!items.length) h += `<p class="muted">The store is empty. Harvests you unload at the farm end up here.</p>`;
      for (const it of items) {
        const sps = sellPointsFor(it);
        const best = sps.slice().sort((a, b) => S.price(it, b.id) - S.price(it, a.id))[0];
        h += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><b style="width:90px">${esc(it)}</b><span style="width:70px">${(+inv[it]).toFixed(1)}</span>`;
        if (best) h += `<span class="muted grow" style="flex:1">${esc(best.name)} · ${money(S.price(it, best.id))}/unit</span><button class="hv-btn" data-sell="${esc(it)}" data-sp="${esc(best.id)}">Sell all (−${Math.round(SELL_FEE * 100)}% pickup)</button>`;
        else h += `<span class="muted" style="flex:1">no buyer takes this</span>`;
        h += `</div>`;
      }
      h += `<p class="muted" style="font-size:12px">Deliver it yourself with the trailer and press R at the buyer to avoid the pickup fee.</p>`;
      const seeder = D.ids.seeder && V && V.get ? V.get(D.ids.seeder) : null;
      if (seeder) {
        const cal = CR && CR.calendar ? CR.calendar() || {} : {};
        const crops = Object.keys(cal).filter((c) => cal[c] && cal[c].canSow);
        h += `<h3 style="font:600 15px Georgia,serif;margin:14px 0 8px">Seed drill</h3><p>Loaded with <b>${esc(seeder.seed)}</b>. In season now:</p><div style="display:flex;flex-wrap:wrap;gap:6px">`;
        for (const c of crops) {
          const cost = S.inputCost(c);
          h += `<button class="hv-btn ${seeder.seed === c ? 'pri' : ''}" data-seed="${esc(c)}">${esc(c)}${cost ? ` · ${money(cost.total)}/ha` : ''}</button>`;
        }
        if (!crops.length) h += `<span class="muted">nothing can be sown this month</span>`;
        h += `</div>`;
      }
    } else if (tab === 'crew') {
      const ws = S.workers() || [];
      const chars = CH && CH.list ? CH.list('hired') || [] : [];
      h += `<p>Hands are paid their day rate on days they work (possessed by you, on a task or a delegated job), a small retainer otherwise.</p>`;
      for (const w of ws) {
        const c = chars.find((q) => q.workerId === w.id);
        const cost = S.workerDayCost ? S.workerDayCost(w.id) : null;
        h += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><b style="flex:1">${esc(w.name)}</b><span>${money(w.dayRate || w.wage || 0)}/day</span><span class="muted">${cost && cost.onTheClock ? 'on the clock today' : 'idle'}${c ? '' : ' · arriving'}</span><button class="hv-btn" data-fire="${esc(w.id)}">Let go</button></div>`;
      }
      h += `<button class="hv-btn pri" data-hire="1">Hire a hand</button>`;
      const jobs = (S.jobs({ status: 'accepted' }) || []);
      h += `<h3 style="font:600 15px Georgia,serif;margin:14px 0 8px">Accepted jobs (cap ${S.activeJobCap ? S.activeJobCap() : '?'})</h3>`;
      if (!jobs.length) h += `<p class="muted">No accepted jobs. Accept offers on the jobs board (J), then delegate them here.</p>`;
      for (const j of jobs) {
        const who = j.assignee ? (ws.find((w) => w.id === j.assignee) || {}).name || 'assigned' : 'you';
        h += `<div style="margin:6px 0"><div><b>${esc(j.title || j.type)}</b> · ${money(j.pay || 0)} · ${Math.round((j.progress || 0) * 100)}% · ${esc(who)}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">`;
        for (const w of ws) if (j.assignee !== w.id) h += `<button class="hv-btn" data-assign="${esc(j.id)}" data-w="${esc(w.id)}">Give to ${esc(w.name)}</button>`;
        if (j.assignee) h += `<button class="hv-btn" data-assign="${esc(j.id)}" data-w="">Take it back</button>`;
        h += `</div></div>`;
      }
    } else {
      const ps = (S.parcels() || []).filter((p) => p.state === 'owned' || p.state === 'rented');
      const ops = ['plough', 'cultivate', 'sow', 'harvest'];
      for (const p of ps) {
        const f = CR && CR.fields ? (CR.fields() || []).find((q) => q.parcelId === p.id) : null;
        const st = f && CR.stats ? CR.stats(f.id) : null;
        h += `<div style="margin:8px 0"><div><b>${esc(p.name)}</b> · ${(p.area / 1e4).toFixed(2)} ha · ${esc(p.state)}${st ? ` · ${esc(st.cropName || st.state || '')} ${st.stage != null ? esc(st.stage) : ''}` : ' · farmyard'}</div>`;
        if (f) {
          h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">`;
          for (const op of ops) {
            const q = S.contractorQuote ? S.contractorQuote(p.id, op, { areaM2: p.area, fieldId: f.id, crop: op === 'sow' ? seedCrop() : undefined }) : null;
            if (q) h += `<button class="hv-btn" data-book="${esc(p.id)}" data-op="${op}" data-f="${esc(f.id)}">Contractor: ${op} ${money(q.price)} (${q.leadDays}d)</button>`;
          }
          h += `</div>`;
        }
        h += `</div>`;
      }
      const bk = S.contractorBookings ? S.contractorBookings() || [] : [];
      if (bk.length) h += `<h3 style="font:600 15px Georgia,serif;margin:14px 0 8px">Bookings</h3>` + bk.slice(-6).map((b) => `<div class="muted">${esc(b.op)} · ${esc(b.status || '')} · ${money(b.price || 0)}</div>`).join('');
    }
    return h;
  }
  function seedCrop() {
    const V = mod('vehicles');
    const s = D.ids.seeder && V && V.get ? V.get(D.ids.seeder) : null;
    return (s && s.seed) || 'barley';
  }
  function bind(el) {
    const S = mod('simulation'), V = mod('vehicles');
    const ui = mod('ui');
    const re = () => { if (ui && ui.refreshPanel) ui.refreshPanel('demo:office'); };
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; re(); }; });
    el.querySelectorAll('[data-sell]').forEach((b) => { b.onclick = () => { const got = sellFromStore(b.dataset.sell, null, b.dataset.sp); toast(got > 0 ? `Sold ${b.dataset.sell}: ${money(got)} after pickup` : 'Nothing sold', { kind: got > 0 ? 'money' : 'warn' }); re(); }; });
    el.querySelectorAll('[data-seed]').forEach((b) => { b.onclick = () => { if (V && V.setSeed) V.setSeed(D.ids.seeder, b.dataset.seed); re(); }; });
    el.querySelectorAll('[data-hire]').forEach((b) => { b.onclick = () => { const id = hireHand(); toast(id ? 'A new hand is on the way to the farmhouse.' : 'Could not hire (money or credit?)', { kind: id ? 'success' : 'warn' }); re(); }; });
    el.querySelectorAll('[data-fire]').forEach((b) => { b.onclick = () => { if (S && S.fireWorker) S.fireWorker(b.dataset.fire); re(); }; });
    el.querySelectorAll('[data-assign]').forEach((b) => { b.onclick = () => { if (S && S.assignJob) S.assignJob(b.dataset.assign, b.dataset.w || null); re(); }; });
    el.querySelectorAll('[data-book]').forEach((b) => {
      b.onclick = () => {
        const p = S.parcel(b.dataset.book);
        const r = p ? S.hireContractor(p.id, b.dataset.op, { areaM2: p.area, fieldId: b.dataset.f, crop: b.dataset.op === 'sow' ? seedCrop() : undefined }) : null;
        toast(r ? `Contractor booked: ${b.dataset.op}, starts in ${r.leadDays} day(s)` : 'The contractor could not take it (money?)', { kind: r ? 'success' : 'warn' });
        re();
      };
    });
  }
  function sig() {
    const S = mod('simulation');
    if (!S) return tab;
    const inv = S.inventory() || {};
    return [tab, Object.entries(inv).map(([k, v]) => k + (+v).toFixed(1)).join(), (S.workers() || []).length, (S.jobs({ status: 'accepted' }) || []).map((j) => j.id + j.assignee + (j.progress || 0).toFixed(2)).join(),
      (S.contractorBookings ? S.contractorBookings() || [] : []).length, seedCrop(), Math.round(S.money() / 50)].join('|');
  }

  // ---------------------------------------------------------------- objectives HUD
  function goalsHtml() {
    let h = `<div style="font:600 13px Georgia,serif;margin-bottom:4px">Getting started</div>`;
    for (const [k, title, hint] of GOALS) {
      const ok = !!D.objectives[k];
      let extra = '';
      if (k === 'plough' && !ok) extra = ` ${Math.round((progress.plough || 0) * 100)}%`;
      if (k === 'sow' && !ok) extra = ` ${Math.round((progress.sow || 0) * 100)}%`;
      h += `<div style="font-size:12px;line-height:1.35;${ok ? 'opacity:.55;text-decoration:line-through' : ''}" title="${esc(hint)}">${ok ? '&#10003;' : '&#9675;'} ${esc(title)}${extra}</div>`;
    }
    const next = GOALS.find((x) => !D.objectives[x[0]]);
    if (next) h += `<div class="muted" style="font-size:11.5px;font-style:italic;margin-top:3px;max-width:230px">${esc(next[2])}</div>`;
    return h;
  }

  function start({ UI: ui }) {
    UI = ui;
    started = true;
    if (!UI) return;
    if (UI.addPanel) {
      UI.addPanel('demo:office', { title: 'Farm office', icon: 'barn', hotkey: 'KeyK', order: 5, subtitle: 'Store, seed, hands, contractors', sig, render(el) { el.innerHTML = panelHtml(); bind(el); } });
    }
    showGoals();
  }
  function showGoals() {
    if (!UI || !UI.registerHud || hudOn) return;
    if (GOALS.every((g) => D.objectives[g[0]])) return;
    UI.registerHud('demo:goals', { slot: 'top-left', order: 20, render(el) { el.innerHTML = goalsHtml(); }, update(el) { el.innerHTML = goalsHtml(); } });
    hudOn = true;
  }

  function update(dt) {
    if (!started) return;
    tipT += dt;
    while (D.tutorial < TIPS.length && tipT >= TIPS[D.tutorial][0]) {
      const [, title, text] = TIPS[D.tutorial];
      toast(text, { title, kind: 'info', ms: 9000 });
      D.tutorial++;
    }
    if (pendingNext) { pendingNext.t -= dt; if (pendingNext.t <= 0) { toast(pendingNext.g[2], { title: 'Next: ' + pendingNext.g[1], kind: 'info', ms: 8000 }); pendingNext = null; } }
    checkT -= dt;
    if (checkT <= 0) {
      checkT = 0.5;
      progress.plough = fieldShare(['ploughed', 'cultivated', 'sown']);
      progress.sow = fieldShare(['sown', 'ripe']);
      if (progress.plough >= 0.95) done('plough');
      if (progress.sow >= 0.95) done('sow');
      const S = mod('simulation');
      if (S && S.workers && (S.workers() || []).length) done('hire');
      if (hudOn && GOALS.every((g) => D.objectives[g[0]]) && UI && UI.removeHud) { UI.removeHud('demo:goals'); hudOn = false; }
    }
  }

  return {
    start, update, sellFromStore, hireHand,
    reload() { tipT = 999; if (started) showGoals(); },
    objectives: () => GOALS.map(([id, title]) => ({ id, title, done: !!D.objectives[id], progress: id === 'plough' ? progress.plough || 0 : id === 'sow' ? progress.sow || 0 : D.objectives[id] ? 1 : 0 })),
  };
}
