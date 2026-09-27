// Built-in panels: Finances, Market, Jobs, Land, Help. Pure DOM/SVG renderers that read
// through the data adapter; every one has a finished-looking empty state.
import { icon } from './icons.js';
import { MONTH_NAMES } from '../../core/clock.js';
import { DAY_SECONDS, YEAR_DAYS, MONTH_DAYS, START_DAY_OF_YEAR } from '../../core/world.js';

// ------------------------------------------------------------------ formatting
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
/** €1,234.50 · opts: { sign: true → +/−, dec: 0|2, compact: true → €12.4k } */
export function money(v, opts = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const neg = v < 0;
  const a = Math.abs(v);
  let body;
  if (opts.compact && a >= 10000) body = (a / 1000).toFixed(a >= 100000 ? 0 : 1) + 'k';
  else {
    const dec = opts.dec != null ? opts.dec : 2;
    const fixed = a.toFixed(dec);
    const [i, f] = fixed.split('.');
    body = group(i) + (f ? '.' + f : '');
  }
  const sign = neg ? '−' : (opts.sign ? '+' : '');
  return sign + '€' + body;
}
export function priceStr(v) {
  if (typeof v !== 'number') return '—';
  return v < 5 ? '€' + v.toFixed(v < 1 ? 3 : 2) : money(v);
}
export function dayLabel(day) {
  const d = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  const m = Math.floor(d / MONTH_DAYS);
  return `${(d % MONTH_DAYS) + 1} ${MONTH_NAMES[m].slice(0, 3)}`;
}
export const dateOf = (t) => dayLabel(Math.floor(t / DAY_SECONDS));

const CAT_ICON = {
  sale: 'market', sales: 'market', job: 'jobs', jobs: 'jobs', rent: 'land', land: 'land', lease: 'land', wages: 'person', wage: 'person',
  fuel: 'diesel', diesel: 'diesel', seed: 'seed', fertiliser: 'seed', fertilizer: 'seed', upkeep: 'build', repair: 'build',
  insurance: 'ledger', interest: 'loan', loan: 'loan', purchase: 'tractor', vehicle: 'tractor', animals: 'cow',
};
const catIcon = (c) => CAT_ICON[String(c || '').toLowerCase()] || 'coin';
const cap = (s) => String(s || 'other').replace(/^./, (c) => c.toUpperCase());

function empty(ic, title, text) {
  return `<div class="hv-empty">${icon(ic)}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

// ------------------------------------------------------------------ charts
function niceStep(range, target) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function balanceChart(hist, uid) {
  const W = 640, H = 150, L = 54, R = 58, T = 12, B = 22;
  const vals = hist.map((h) => h.balance);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const mid = (hi + lo) / 2, minSpan = Math.max(400, Math.abs(mid) * 0.1);
  if (hi - lo < minSpan) { lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (i / Math.max(1, hist.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let grid = '';
  for (let v = lo; v <= hi + 1e-6; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(116,96,63,.28)" stroke-dasharray="2 3"/>`;
    grid += `<text x="${L - 7}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${step >= 1000 ? money(v, { compact: true, dec: 0 }) : money(v, { dec: 0 })}</text>`;
  }
  // steps: the ledger is discrete (balance holds, then changes at the day boundary)
  const pts = hist.map((h, i) => [x(i), y(h.balance)]);
  let line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) line += ` H${pts[i][0].toFixed(1)} V${pts[i][1].toFixed(1)}`;
  const area = `${line} L${x(hist.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z`;
  const last = pts[pts.length - 1];
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? '#3f6b3a' : '#a8392f';
  const lbls = [0, Math.floor((hist.length - 1) / 2), hist.length - 1].map((i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === hist.length - 1 ? 'end' : 'middle'}">${i === hist.length - 1 ? 'Today' : dayLabel(hist[i].day)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
    <defs><pattern id="hatch${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="${col}" stroke-opacity=".32" stroke-width="1.4"/></pattern>
      <linearGradient id="fade${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".16"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#fade${uid})"/><path d="${area}" fill="url(#hatch${uid})"/>
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="rgba(90,68,40,.55)"/>
    <path d="${line}" fill="none" stroke="#2e2a24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.2" fill="#f3ead6" stroke="#2e2a24" stroke-width="1.8"/>
    <text x="${(last[0] + 8).toFixed(1)}" y="${(last[1] + 4).toFixed(1)}" style="font:600 12px Georgia,serif;fill:#2e2a24">${money(vals[vals.length - 1], { compact: true })}</text>
    ${lbls}
  </svg>`;
}

function sparkline(h, rising) {
  if (!h || h.length < 2) return '<svg class="spark" viewBox="0 0 92 26"><path d="M2 16H90" stroke="#8a7e6c" stroke-opacity=".5" stroke-dasharray="2 3"/><text x="46" y="11" text-anchor="middle" style="font:italic 9.5px Georgia,serif;fill:#8a7e6c">new listing</text></svg>';
  const lo = Math.min(...h), hi = Math.max(...h), r = hi - lo || 1;
  const pts = h.map((v, i) => [(i / (h.length - 1)) * 90 + 1, 23 - ((v - lo) / r) * 20]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const col = rising ? '#3f6b3a' : '#a8392f';
  const l = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 92 26"><path d="${d}L91 25L1 25Z" fill="${col}" fill-opacity=".1"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${l[0].toFixed(1)}" cy="${l[1].toFixed(1)}" r="2.2" fill="${col}"/></svg>`;
}

function stars(q) {
  const n = Math.max(1, Math.min(5, Math.round(q * 5)));
  let s = '<span class="stars" title="Soil quality">';
  for (let i = 0; i < 5; i++) s += i < n ? icon('star') : icon('star', 'off');
  return s + '</span>';
}

// ------------------------------------------------------------------ panels
export function builtinPanels(K) {
  // K = { data, clock, confirm, toast, rerender(id), emit }
  const { data } = K;
  let uid = 0;

  const finances = {
    id: 'finances', title: 'Finances', icon: 'ledger', hotkey: 'KeyO', order: 1,
    sig: () => [data.money(), data.ledger(1).map((e) => e.t).join(), K.clock.day].join('|'),
    render(el) {
      const m = data.money();
      if (m == null) { el.innerHTML = empty('ledger', 'The books are closed', 'No accounts have been opened for this farm yet. Income and expenses will be written here as they happen.'); return; }
      const sum = data.summary(30);
      const net = sum.income - sum.expenses;
      let hist = data.balanceHistory(30);
      if (!data.usingSample) hist = hist.filter((h) => h.day >= START_DAY_OF_YEAR);
      const led = data.ledger(14);
      const loans = data.loans();
      const debt = loans.reduce((a, l) => a + (typeof l.balance === 'number' ? l.balance : (l.principal || 0)), 0);
      let h = `<div class="hv-stats">
        <div class="hv-stat"><div class="k">${icon('coin')}Balance</div><div class="v ${m < 0 ? 'neg' : ''}">${money(m)}</div><div class="s">${debt ? 'Loans outstanding ' + money(debt, { dec: 0 }) : 'No outstanding loans'}</div></div>
        <div class="hv-stat"><div class="k">${icon('up')}Income · 30 days</div><div class="v pos">${money(sum.income, { dec: 0 })}</div><div class="s">Sales, contracts &amp; produce</div></div>
        <div class="hv-stat"><div class="k">${icon('down')}Expenses · 30 days</div><div class="v neg">${money(-sum.expenses, { dec: 0 })}</div><div class="s">Net ${money(net, { sign: true, dec: 0 })}</div></div>
      </div>`;
      h += `<h3>Balance${hist.length > 1 ? ', last ' + hist.length + ' days' : ''}</h3>`;
      h += hist.length > 1 ? balanceChart(hist, ++uid) : empty('calendar', 'Day one on the farm', 'The balance chart fills in as the days go by.');
      // expense breakdown
      const cats = Object.entries(sum.byCategory).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 5);
      if (cats.length) {
        const max = -cats[0][1];
        h += `<h3>Where the money went</h3><div class="hv-rows">`;
        for (const [c, v] of cats) {
          h += `<div class="hv-row" style="min-height:28px;padding:3px 4px"><span style="width:110px;display:flex;align-items:center;gap:7px" class="muted">${icon(catIcon(c))}${esc(cap(c))}</span>
            <div class="grow"><div class="hv-bar"><i style="width:${(100 * -v / max).toFixed(1)}%;background:repeating-linear-gradient(-45deg,#c07a4a 0 5px,#b06a3c 5px 10px)"></i></div></div>
            <span class="num" style="width:84px;font-size:13px">${money(v, { dec: 0 })}</span></div>`;
        }
        h += `</div>`;
      }
      h += `<h3>Ledger</h3>`;
      if (!led.length) h += empty('ledger', 'Nothing written yet', 'No transactions this season.');
      else {
        h += `<div class="hv-rows">`;
        for (const e of led) {
          h += `<div class="hv-row"><span class="date">${dateOf(e.t || 0)}</span><span class="ico">${icon(catIcon(e.category))}</span>
            <div class="grow"><div class="ttl" style="font-size:13.5px">${esc(e.memo || cap(e.category))}</div></div>
            <span class="chip">${esc(cap(e.category))}</span><span class="num ${e.amount >= 0 ? 'pos' : 'neg'}" style="width:92px">${money(e.amount, { sign: true })}</span></div>`;
        }
        h += `</div>`;
      }
      if (loans.length) {
        h += `<h3>Loans</h3><div class="hv-rows">`;
        for (const l of loans) {
          h += `<div class="hv-row"><span class="ico">${icon('loan')}</span><div class="grow"><div class="ttl">${esc(l.name || 'Bank loan')} <span class="faint" style="font-size:12px">${((l.rate || 0) * 100).toFixed(1)} % / yr</span></div>
            <div class="meta">Borrowed ${money(l.principal || 0, { dec: 0 })}${l.perDay ? ' · interest ' + money(l.perDay) + ' / day' : ''}</div></div><span class="num neg">${money(-(l.balance != null ? l.balance : l.principal || 0), { dec: 0 })}</span></div>`;
        }
        h += `</div>`;
      }
      el.innerHTML = h;
    },
  };

  const market = {
    id: 'market', title: 'Market', icon: 'market', hotkey: 'KeyP', order: 2,
    sig: () => K.clock.day + '|' + data.market().map((r) => r.price.toFixed(3) + r.stock).join(),
    render(el) {
      const rows = data.market();
      if (!rows.length) { el.innerHTML = empty('market', 'No prices posted', 'The merchants have not chalked up today’s prices yet. Check back after the morning market opens.'); return; }
      let h = `<h3>Today’s prices <span class="faint" style="text-transform:none;letter-spacing:0;font:italic 12px Georgia,serif">recent trend</span></h3><div class="hv-rows">`;
      for (const r of rows) {
        const pct = (r.change * 100);
        const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
        h += `<div class="hv-row"><span class="ico">${icon(r.icon)}</span>
          <div style="width:118px"><div class="ttl">${esc(r.name)}</div><div class="meta">${r.stock ? 'In store ' + (+r.stock.toFixed(1)) + ' ' + esc(r.unit) : '<span class="faint">None in store</span>'}</div></div>
          <span class="num" style="width:92px">${priceStr(r.price)}<span class="faint" style="font:11px 'Segoe UI',sans-serif"> /${esc(r.unit)}</span></span>
          ${sparkline(r.history, pct >= 0)}
          <span class="${dir === 'up' ? 'pos' : dir === 'down' ? 'neg' : 'muted'}" style="width:62px;display:flex;align-items:center;gap:3px;font-weight:600;font-size:12px">${icon(dir)}${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%</span>
          <div class="grow meta" style="text-align:right">${r.best ? 'Best at <b style="color:var(--ink);font-weight:600">' + esc(r.best.name) + '</b>' : '<span class="faint">No buyer nearby</span>'}</div></div>`;
      }
      h += `</div>`;
      const sps = data.sellPoints();
      h += `<h3>Sell points</h3>`;
      if (!sps.length) h += empty('pin', 'No buyers known', 'Sell points appear here once you have found a mill, co-op or market.');
      else {
        h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
        for (const sp of sps) {
          h += `<div class="hv-stat" style="display:flex;gap:10px;align-items:center"><span class="ico" style="width:30px;height:30px;display:grid;place-items:center;color:#9a6c16">${icon('pin')}</span>
            <div style="min-width:0"><div style="font:600 14px Georgia,serif">${esc(sp.name || sp.id)}</div>
            <div class="muted" style="display:flex;gap:4px;margin-top:3px">${(sp.accepts || []).slice(0, 6).map((a) => `<span title="${esc(a)}" style="display:inline-flex">${icon(({ wheat: 'wheat', barley: 'barley', oats: 'oats', maize: 'maize', rapeseed: 'rapeseed', potatoes: 'potato', sugarBeet: 'beet', milk: 'milk', eggs: 'egg', wool: 'wool', hay: 'hay', straw: 'hay' })[a] || 'coin')}</span>`).join('')}</div></div></div>`;
        }
        h += `</div>`;
      }
      el.innerHTML = h;
    },
  };

  const JOB_TYPE = {
    plough: ['Ploughing', 'tractor'], sow: ['Sowing', 'seed'], harvest: ['Harvest', 'wheat'], mow: ['Mowing', 'hay'],
    transport: ['Transport', 'truck'], deliver: ['Delivery', 'truck'], animalCare: ['Animal care', 'sheep'],
    shopHelp: ['Village work', 'shop'], villageWork: ['Village work', 'shop'], snowClear: ['Snow clearing', 'snow'],
  };
  let jobFilter = 'offered';
  const jobGroup = (j) => (j.status === 'accepted' || j.status === 'active' ? 'active' : j.status === 'completed' || j.status === 'failed' || j.status === 'expired' ? 'done' : 'offered');
  const jobs = {
    id: 'jobs', title: 'Jobs board', icon: 'jobs', hotkey: 'KeyJ', order: 3,
    sig: () => jobFilter + '|' + K.clock.day + '|' + data.jobs().map((j) => j.id + j.status + (j.progress || 0).toFixed(2)).join(),
    render(el) {
      const all = data.jobs();
      const counts = { offered: 0, active: 0, done: 0 };
      for (const j of all) counts[jobGroup(j)]++;
      const list = all.filter((j) => jobGroup(j) === jobFilter);
      const today = K.clock.day;
      let h = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div class="hv-seg">
        ${[['offered', 'Offers'], ['active', 'In progress'], ['done', 'Finished']].map(([k, l]) => `<button data-f="${k}" class="${jobFilter === k ? 'on' : ''}">${l}<span class="c">${counts[k]}</span></button>`).join('')}
        </div><span class="grow"></span><span class="muted" style="font:italic 12.5px Georgia,serif">New notices are pinned up every morning</span></div>`;
      if (!list.length) {
        h += jobFilter === 'offered' ? empty('jobs', 'The board is empty', 'No neighbour needs a hand right now. New contracts are pinned up every morning.')
          : jobFilter === 'active' ? empty('clock', 'No contracts in progress', 'Accept an offer from the board and it will be tracked here.')
            : empty('check', 'Nothing finished yet', 'Completed and missed contracts are kept here for your records.');
      } else {
        h += `<div class="hv-jobs">`;
        for (const j of list) {
          const [kind, ic] = JOB_TYPE[j.type] || [cap(j.type || 'Job'), 'jobs'];
          const left = (j.deadlineDay != null ? j.deadlineDay : today) - today;
          const g = jobGroup(j);
          const due = g === 'done' ? `<span class="due">${j.status === 'completed' ? 'Paid' : 'Missed'}</span>`
            : `<span class="due ${left <= 1 ? 'soon' : ''}">${icon('clock')} ${left <= 0 ? 'Due today' : left === 1 ? '1 day left' : left + ' days left'}</span>`;
          const amt = j.amount != null ? `${+(+j.amount).toFixed(1)} ${esc(j.unit || '')}` : '';
          h += `<div class="hv-job ${g === 'done' ? 'done ' + (j.status === 'failed' ? 'failed' : '') : ''}" data-stamp="${j.status === 'failed' ? 'MISSED' : 'DONE'}">
            <div class="top"><span class="ico">${icon(ic)}</span><span class="kind">${esc(kind)}</span>${amt && !String(j.title || '').includes(String(+(+j.amount).toFixed(1))) ? `<span class="chip">${amt}</span>` : ''}</div>
            <div class="ttl">${esc(j.title || kind)}</div>
            <div class="who">${icon('person')}${esc(j.client || 'A neighbour')}</div>
            ${g === 'active' ? `<div style="display:flex;align-items:center;gap:8px;margin-top:2px"><div class="hv-bar" style="flex:1"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></div><span class="muted" style="font-size:11.5px;width:32px;text-align:right">${Math.round((j.progress || 0) * 100)}%</span></div>` : ''}
            <div class="foot"><span class="pay ${g === 'done' && j.status === 'failed' ? 'faint' : ''}">${money(j.pay || 0, { dec: 0 })}</span>${due}
            ${g === 'offered' ? `<button class="hv-btn pri" data-accept="${esc(j.id)}">${icon('check')}Accept</button>` : ''}</div></div>`;
        }
        h += `</div>`;
      }
      el.innerHTML = h;
      el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = K.safe('jobs filter', () => { jobFilter = b.dataset.f; K.rerender('jobs'); }); });
      el.querySelectorAll('[data-accept]').forEach((b) => {
        b.onclick = K.safe('accept job', () => {
          const j = all.find((x) => x.id === b.dataset.accept);
          if (data.acceptJob(b.dataset.accept)) {
            K.toast(`<b>Contract accepted</b><br>${esc(j ? j.title : '')}`, { kind: 'success', icon: 'jobs', html: true });
            K.emit('ui:action', { id: 'job-accepted', jobId: b.dataset.accept });
          } else K.toast('That contract is no longer available.', { kind: 'warn' });
          K.rerender('jobs');
        });
      });
    },
  };

  let selParcel = null;
  const STATE_LABEL = { owned: 'Owned', rented: 'Rented', forSale: 'For sale', npc: 'Neighbour' };
  const STATE_FILL = { owned: 'rgba(63,107,58,.42)', rented: 'rgba(201,154,46,.42)', forSale: 'rgba(184,101,46,.14)', npc: 'rgba(116,96,63,.16)' };
  const STATE_STROKE = { owned: '#3a6334', rented: '#8a6a1a', forSale: '#a65a26', npc: '#8a7e6c' };
  const land = {
    id: 'land', title: 'Land', icon: 'land', hotkey: 'KeyM', order: 4,
    sig: () => (selParcel || '') + '|' + data.money() + '|' + data.parcels().map((p) => p.id + p.state).join(),
    render(el) {
      const ps = data.parcels();
      if (!ps.length) { el.innerHTML = empty('map', 'No parcels surveyed', 'The land registry has no parcels for this valley yet. Fields for sale or rent will be listed here.'); return; }
      if (!selParcel || !ps.find((p) => p.id === selParcel)) selParcel = (ps.find((p) => p.state === 'forSale') || ps[0]).id;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of ps) for (const [x, y] of p.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const vw = 268, vh = Math.max(160, Math.min(300, vw * (y1 - y0) / (x1 - x0)));
      const sc = Math.min(vw / (x1 - x0), vh / (y1 - y0));
      const ox = (vw - (x1 - x0) * sc) / 2, oy = (vh - (y1 - y0) * sc) / 2;
      const X = (x) => (ox + (x - x0) * sc).toFixed(1), Y = (y) => (oy + (y - y0) * sc).toFixed(1);
      const id = ++uid;
      let svg = `<svg viewBox="0 0 ${vw} ${vh}"><defs><pattern id="lh${id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#8a7e6c" stroke-opacity=".35" stroke-width="1"/></pattern>
        <pattern id="ls${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#b8652e" stroke-opacity=".3" stroke-width="1.2"/></pattern></defs>`;
      for (const p of ps) {
        const d = p.poly.map(([x, y], i) => (i ? 'L' : 'M') + X(x) + ' ' + Y(y)).join('') + 'Z';
        const st = STATE_LABEL[p.state] ? p.state : 'npc';
        const sel = p.id === selParcel;
        svg += `<path d="${d}" fill="${STATE_FILL[st]}" data-pid="${esc(p.id)}" style="cursor:pointer"/>`;
        if (st === 'npc') svg += `<path d="${d}" fill="url(#lh${id})" pointer-events="none"/>`;
        if (st === 'forSale') svg += `<path d="${d}" fill="url(#ls${id})" pointer-events="none"/>`;
        svg += `<path d="${d}" fill="none" stroke="${sel ? '#2e2a24' : STATE_STROKE[st]}" stroke-width="${sel ? 2.4 : 1.2}" ${st === 'forSale' && !sel ? 'stroke-dasharray="4 2.5"' : ''} stroke-linejoin="round" pointer-events="none"/>`;
        const cx = p.poly.reduce((a, q) => a + q[0], 0) / p.poly.length, cy = p.poly.reduce((a, q) => a + q[1], 0) / p.poly.length;
        svg += `<text x="${X(cx)}" y="${Y(cy)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none" ${sel ? 'style="font-weight:700;font-style:normal"' : ''}>${esc(p.name || p.id)}</text>`;
      }
      svg += `</svg>`;
      const owned = ps.filter((p) => p.state === 'owned' || p.state === 'rented');
      const haFarm = owned.reduce((a, p) => a + (p.area || 0), 0) / 10000;
      const rentDay = ps.filter((p) => p.state === 'rented').reduce((a, p) => a + (p.rentPerDay || 0), 0);
      let h = `<div class="hv-stats" style="margin-bottom:14px">
        <div class="hv-stat"><div class="k">${icon('land')}Farmed</div><div class="v">${haFarm.toFixed(2)} ha</div><div class="s">${owned.length} parcel${owned.length === 1 ? '' : 's'} owned or rented</div></div>
        <div class="hv-stat"><div class="k">${icon('calendar')}Rent</div><div class="v">${money(rentDay)}<span class="faint" style="font:12px 'Segoe UI',sans-serif"> / day</span></div><div class="s">Charged every morning</div></div>
        <div class="hv-stat"><div class="k">${icon('coin')}On the market</div><div class="v">${ps.filter((p) => p.state === 'forSale').length}</div><div class="s">parcels for sale or lease</div></div></div>`;
      h += `<div class="hv-land"><div><div class="hv-landmap">${svg}</div><div class="hv-legend">
        <span><i style="background:${STATE_FILL.owned}"></i>Owned</span><span><i style="background:${STATE_FILL.rented}"></i>Rented</span>
        <span><i style="background:repeating-linear-gradient(-45deg,rgba(184,101,46,.35) 0 2px,rgba(243,234,214,1) 2px 5px)"></i>For sale</span><span><i style="background:repeating-linear-gradient(45deg,rgba(138,126,108,.4) 0 2px,rgba(243,234,214,1) 2px 5px)"></i>Neighbours</span></div></div><div class="hv-rows">`;
      const m = data.money();
      for (const p of ps) {
        const st = STATE_LABEL[p.state] ? p.state : 'npc';
        const ha = (p.area || 0) / 10000;
        let act = '';
        if (st === 'forSale') {
          const afford = data.canAfford(p.price || 0);
          act = `<div style="display:flex;gap:5px"><button class="hv-btn" data-rent="${esc(p.id)}" title="Rent for ${money(p.rentPerDay || 0)} per day">Rent</button><button class="hv-btn warm ${afford ? '' : 'dis'}" data-buy="${esc(p.id)}" title="${afford ? '' : 'Not enough money'}">Buy</button></div>`;
        } else if (st === 'owned' || st === 'rented') act = `<span class="chip ${st}">${STATE_LABEL[st]}</span>`;
        else act = `<span class="chip">${STATE_LABEL[st]}</span>`;
        const priceLine = st === 'forSale' ? `${money(p.price || 0, { dec: 0 })} · or ${money(p.rentPerDay || 0)}/day` : st === 'rented' ? `Rent ${money(p.rentPerDay || 0)}/day` : st === 'owned' ? esc(p.crop || 'Your field') : 'Farmed by a neighbour';
        h += `<div class="hv-row click ${p.id === selParcel ? 'sel' : ''}" data-sel="${esc(p.id)}"><div class="grow"><div class="ttl">${esc(p.name || p.id)} <span class="faint" style="font:12px 'Segoe UI',sans-serif">${ha.toFixed(2)} ha</span></div>
          <div class="meta" style="display:flex;align-items:center;gap:6px">${stars(p.soil != null ? p.soil : 0.6)}<span>${priceLine}</span></div></div>${act}</div>`;
      }
      h += `</div></div>`;
      el.innerHTML = h;
      const pick = (pid) => { selParcel = pid; K.rerender('land'); };
      el.querySelectorAll('[data-pid]').forEach((n) => { n.onclick = K.safe('land pick', () => pick(n.getAttribute('data-pid'))); });
      el.querySelectorAll('[data-sel]').forEach((n) => { n.onclick = K.safe('land pick', (e) => { if (e.target.closest('button')) return; pick(n.dataset.sel); }); });
      el.querySelectorAll('[data-buy]').forEach((b) => {
        b.onclick = K.safe('buy parcel', async () => {
          const p = ps.find((q) => q.id === b.dataset.buy);
          if (!p) return;
          if (!data.canAfford(p.price || 0)) { K.toast(`You need ${money((p.price || 0) - (m || 0), { dec: 0 })} more to buy ${esc(p.name)}.`, { kind: 'warn', icon: 'coin' }); return; }
          const ok = await K.confirm({ title: `Buy ${p.name}?`, text: `${((p.area || 0) / 10000).toFixed(2)} ha for ${money(p.price || 0, { dec: 0 })}. The land is yours to farm, with no more rent to pay.`, okLabel: 'Buy parcel', cancelLabel: 'Not now', icon: 'coin' });
          if (!ok) return;
          if (data.buyParcel(p.id)) { K.toast(`<b>${esc(p.name)} is yours</b><br>${money(-(p.price || 0), { dec: 0 })}`, { kind: 'money', icon: 'land', html: true }); K.emit('ui:action', { id: 'parcel-bought', parcelId: p.id }); }
          else K.toast('The notary could not complete the sale.', { kind: 'error' });
          K.rerender('land');
        });
      });
      el.querySelectorAll('[data-rent]').forEach((b) => {
        b.onclick = K.safe('rent parcel', async () => {
          const p = ps.find((q) => q.id === b.dataset.rent);
          if (!p) return;
          const ok = await K.confirm({ title: `Rent ${p.name}?`, text: `${((p.area || 0) / 10000).toFixed(2)} ha for ${money(p.rentPerDay || 0)} per day, charged each morning. You can end the lease at any time.`, okLabel: 'Sign lease', cancelLabel: 'Not now', icon: 'land' });
          if (!ok) return;
          if (data.rentParcel(p.id)) { K.toast(`<b>Lease signed</b><br>${esc(p.name)} · ${money(p.rentPerDay || 0)}/day`, { kind: 'success', icon: 'land', html: true }); K.emit('ui:action', { id: 'parcel-rented', parcelId: p.id }); }
          else K.toast('The owner turned the lease down.', { kind: 'warn' });
          K.rerender('land');
        });
      });
    },
  };

  const KEYS = [
    [['W', 'A', 'S', 'D'], 'Walk / drive'], [['Shift'], 'Run'], [['E'], 'Use / interact'], [['F'], 'Enter or leave a vehicle'],
    [['Tab'], 'Switch farmhand'], [['1', '–', '9'], 'Pick a tool'], [['B'], 'Build mode'], [['R'], 'Rotate while building'],
    [['L'], 'Vehicle lights'], [['Space'], 'Pause / resume'], [['+', '−'], 'Game speed'], [['Esc'], 'Close / cancel'],
    [['O'], 'Finances'], [['P'], 'Market prices'], [['J'], 'Jobs board'], [['M'], 'Land & map'], [['H'], 'This help'], [['Wheel'], 'Zoom'],
  ];
  const help = {
    id: 'help', title: 'Help', icon: 'help', hotkey: 'KeyH', order: 9,
    sig: () => 'static',
    render(el) {
      let h = `<h3>Keys</h3><div class="hv-keys">`;
      for (const [ks, label] of KEYS) {
        h += `<div class="hv-row"><span class="kcs">${ks.map((k) => (k === '–' ? '<span class="faint">–</span>' : `<span class="kc lg">${esc(k)}</span>`)).join('')}</span><span class="grow" style="font:13.5px Georgia,serif">${esc(label)}</span></div>`;
      }
      h += `</div><h3>Getting started</h3><div style="font:14px/1.55 Georgia,serif;color:var(--ink2);columns:2;column-gap:26px">
        <p style="margin:0 0 8px">Rent a field from the <b style="color:var(--ink)">Land</b> sheet, plough it, sow it and keep it clear of weeds. Crops ripen over a few days; sell the harvest at a mill or co-op on the <b style="color:var(--ink)">Market</b> sheet where prices are best.</p>
        <p style="margin:0">Short on money? Neighbours pin contracts on the <b style="color:var(--ink)">Jobs board</b> every morning. Rent and wages are paid each day, so keep an eye on the <b style="color:var(--ink)">Finances</b>.</p></div>`;
      el.innerHTML = h;
    },
  };

  return [finances, market, jobs, land, help];
}
