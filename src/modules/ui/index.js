// ui — the DOM HUD living in #ui: money, clock/date/weather/speed, minimap, toolbar, prompt,
// character switcher, toasts, world labels, panels (Finances, Market, Jobs, Land, Help) and a
// confirm dialog. Other modules register HUD pieces and panels through the API below.
import { icon as iconSvg } from './icons.js';
import { buildCss, paperTexture } from './style.js';
import { createData } from './data.js';
import { builtinPanels, money, esc } from './panels.js';
import { Minimap } from './minimap.js';
import { portrait } from './portraits.js';
import { PRESETS, stageShowcase } from './showcase.js';

const SOLO = typeof location !== 'undefined' && /[?&]uisolo=1/.test(location.search);
const WEEKDAYS = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'];
const SPEEDS = [1, 3, 10];
const BASE_SCALE = 60;
const SLOTS = { 'top-left': 'tl', 'top-center': 'tc', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-center': 'bc', 'bottom-right': 'br' };
const TOAST_ICON = { info: 'info', money: 'coin', warn: 'warn', error: 'warn', success: 'check' };
const WX = {
  clear: ['Clear', null], cloudy: ['Cloudy', 'cloud'], overcast: ['Overcast', 'overcast'], rain: ['Rain', 'rain'],
  storm: ['Thunderstorm', 'storm'], fog: ['Fog', 'fog'], snow: ['Snow', 'snow'],
};

export const manifest = {
  id: 'ui',
  wave: 1,
  deps: [],
  optionalDeps: ['simulation', 'environment', 'terrain', 'roads'],
  namespaces: ['ui'],
  api: ['registerHud', 'removeHud', 'addPanel', 'removePanel', 'openPanel', 'closePanel', 'togglePanel', 'isPanelOpen', 'refreshPanel',
    'toast', 'setToolbar', 'setActiveTool', 'confirm', 'setPrompt', 'worldLabel', 'removeWorldLabel', 'setCharacters', 'icon',
    'formatMoney', 'setSpeed', 'getSpeed'],
  emits: ['ui:action', 'ui:panel-opened', 'ui:panel-closed', 'ui:speed-changed', 'ui:tool-selected', 'ui:character-selected'],
  listens: ['economy:transaction', 'economy:bankrupt-warning', 'jobs:offered', 'jobs:completed', 'jobs:failed', 'land:parcel-changed',
    'env:weather-changed', 'terrain:generated', 'terrain:changed', 'roads:changed', 'clock:day', 'characters:switched'],
};

let INSTANCE = null; // the live instance (single #ui), used by showcase.stage

const keyLabel = (code) => {
  if (!code) return '';
  const c = String(code);
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  return { Space: 'Space', Escape: 'Esc', Equal: '+', Minus: '−', Tab: 'Tab', Enter: 'Enter' }[c] || c;
};
const normKey = (k) => {
  if (!k) return null;
  const s = String(k);
  if (/^[a-z]$/i.test(s)) return 'Key' + s.toUpperCase();
  if (/^\d$/.test(s)) return 'Digit' + s;
  return s;
};
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export async function init(ctx) {
  const W = ctx.world;
  W.ui = { speed: 1, paused: !!(W.time && W.time.paused), openPanel: null, activeTool: null };
  const data = createData(ctx);
  const safe = (label, fn) => (...a) => { try { return fn(...a); } catch (e) { ctx.error(e, label); return undefined; } };
  const foreign = (label, fn, ...a) => { try { return fn(...a); } catch (e) { ctx.warn(`${label}: ${e && e.message}`); return undefined; } };
  const emit = (t, p) => { try { ctx.events.emit(t, p); } catch (e) { /* guarded by bus */ } };

  // ---------------------------------------------------------------- DOM scaffold
  let style = document.getElementById('hv-ui-style');
  if (!style) { style = document.createElement('style'); style.id = 'hv-ui-style'; document.head.appendChild(style); }
  style.textContent = buildCss(ctx.palette, paperTexture(ctx));
  const host = ctx.uiRoot || document.body;
  const old = host.querySelector(':scope > .hv-ui');
  if (old) old.remove();
  const root = el('div', 'hv-ui');
  host.appendChild(root);
  const labelsLayer = el('div', 'hv-labels');
  root.appendChild(labelsLayer);
  const slots = {};
  for (const cls of Object.values(SLOTS)) { slots[cls] = el('div', 'hv-slot ' + cls); root.appendChild(slots[cls]); }
  const panelWrap = el('div', 'hv-panelwrap');
  root.appendChild(panelWrap);
  const toastBox = el('div', 'hv-toasts');
  root.appendChild(toastBox); // above panels: toasts are never hidden by a sheet
  let modal = null;

  // ---------------------------------------------------------------- HUD registry
  const huds = new Map();
  function registerHud(id, spec = {}) {
    if (!id) return null;
    removeHud(id);
    const slot = SLOTS[spec.slot] || SLOTS['top-left'];
    const node = el('div', 'hv-hud ' + (spec.card === false ? 'bare' : 'hv-card hv-hit') + (spec.className ? ' ' + spec.className : ''));
    node.dataset.hud = id;
    const h = { id, spec, el: node, order: spec.order || 0, acc: 0 };
    huds.set(id, h);
    const list = [...slots[slot].children];
    const after = list.find((c) => (huds.get(c.dataset.hud) || {}).order > h.order);
    slots[slot].insertBefore(node, after || null);
    if (typeof spec.render === 'function') foreign(`hud ${id} render`, spec.render, node);
    return id;
  }
  function removeHud(id) {
    const h = huds.get(id);
    if (!h) return false;
    h.el.remove();
    huds.delete(id);
    return true;
  }

  // ---------------------------------------------------------------- money
  const moneyEl = el('div', 'hv-money', `<span class="coin">${iconSvg('coin')}</span><div><div class="lbl">Farm balance</div><div class="val hv-serif">—</div></div><div class="delta"></div>`);
  registerHud('ui:money', { slot: 'top-left', order: -100, className: 'hv-moneycard', render: (n) => { n.style.padding = '0'; n.appendChild(moneyEl); } });
  const mVal = moneyEl.querySelector('.val'), mDelta = moneyEl.querySelector('.delta');
  const M = { shown: null, target: null, deltaSum: 0, deltaT: 0, text: '' };
  function updateMoney(dt) {
    const v = data.money();
    const card = moneyEl.parentNode;
    if (v == null) { if (card) card.style.display = 'none'; return; }
    if (card && card.style.display) card.style.display = '';
    if (M.shown == null) { M.shown = v; M.target = v; }
    if (v !== M.target) {
      const d = v - M.target;
      if (Math.abs(d) >= 0.005) {
        M.deltaSum = M.deltaT > 0 ? M.deltaSum + d : d;
        M.deltaT = M.hold || 3.2;
        M.hold = 0;
        mDelta.textContent = money(M.deltaSum, { sign: true });
        mDelta.className = 'delta on ' + (M.deltaSum >= 0 ? 'pos' : 'neg');
      }
      M.target = v;
    }
    if (M.shown !== v) {
      M.shown += (v - M.shown) * (1 - Math.exp(-dt * 7));
      if (Math.abs(v - M.shown) < 0.01) M.shown = v;
    }
    const txt = money(M.shown);
    if (txt !== M.text) { M.text = txt; mVal.textContent = txt; mVal.classList.toggle('neg', M.shown < 0); }
    if (M.deltaT > 0) { M.deltaT -= dt; if (M.deltaT <= 0) mDelta.className = 'delta ' + (M.deltaSum >= 0 ? 'pos' : 'neg'); }
  }

  // ---------------------------------------------------------------- clock / weather / speed
  const clockEl = el('div', 'hv-clock', `
    <div class="sec"><svg class="dial" viewBox="0 0 50 34"></svg><div><div class="time">07:00</div><div class="cdate"></div></div></div>
    <div class="sec wx"><span class="wi"></span><div><div class="temp hv-serif"></div><div class="wlabel"></div></div></div>
    <div class="sec"><div class="hv-speed">
      <button data-sp="0" title="Pause (Space)">${iconSvg('pause')}</button>
      <button data-sp="1" title="Normal speed">${iconSvg('play')}1×</button>
      <button data-sp="3" title="Fast (+)">${iconSvg('fast')}3×</button>
      <button data-sp="10" title="Very fast (+)">${iconSvg('fastest')}10×</button></div></div>`);
  registerHud('ui:clock', { slot: 'top-center', order: -100, render: (n) => { n.style.padding = '0'; n.appendChild(clockEl); } });
  const C = { dial: clockEl.querySelector('.dial'), time: clockEl.querySelector('.time'), date: clockEl.querySelector(".cdate"),
    wi: clockEl.querySelector('.wi'), temp: clockEl.querySelector('.temp'), wl: clockEl.querySelector('.wlabel'), sig: '', spSig: '', dialSig: '' };
  clockEl.querySelectorAll('[data-sp]').forEach((b) => { b.onclick = safe('speed click', () => setSpeed(Number(b.dataset.sp))); });

  function dialSvg(tod) {
    // day arc 06:00 → 20:00 for the sun, night arc for the moon
    const day = tod >= 6 && tod < 20;
    const f = day ? (tod - 6) / 14 : ((tod >= 20 ? tod - 20 : tod + 4) / 10);
    const a = Math.PI * (1 - f);
    const x = 25 + Math.cos(a) * 19, y = 28 - Math.sin(a) * 19;
    const body = day
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.6" fill="#e6b54a" stroke="#8a5a14" stroke-width="1.1"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" fill="#e6b54a" opacity=".22"/>`
      : `<path transform="translate(${(x - 4.5).toFixed(1)} ${(y - 4.5).toFixed(1)})" d="M5.6 0a4.6 4.6 0 1 0 3.4 7.4A3.8 3.8 0 0 1 5.6 0z" fill="#dfe4ee" stroke="#4a5a7c" stroke-width="1"/>`;
    return `<path d="M6 28a19 19 0 0 1 38 0" fill="none" stroke="rgba(116,96,63,.45)" stroke-width="1" stroke-dasharray="1.5 2.5"/>
      <path d="M2 28.3c7-.5 14 .4 23 0s15-.5 23 0" fill="none" stroke="#5b5246" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M8 31.5h6M20 31.8h9M34 31.5h7" stroke="rgba(91,82,70,.45)" stroke-width="1" stroke-linecap="round"/>${body}`;
  }
  function updateClock() {
    const k = ctx.clock;
    const tod = k.timeOfDay;
    const daylight = data.daylight();
    const w = data.weather();
    const kind = w && WX[w.kind] ? w.kind : null;
    const night = daylight < 0.35;
    const sig = `${k.hour}:${k.minute}|${k.day}|${kind}|${w && Math.round(w.temperature)}|${night}`;
    if (sig !== C.sig) {
      C.sig = sig;
      C.time.textContent = k.format();
      C.date.textContent = `${WEEKDAYS[((k.day % 7) + 7) % 7]} ${k.dayOfMonth} ${k.monthName}, Year ${k.year}`;
      const season = k.season.replace(/^./, (c) => c.toUpperCase());
      let ic = kind ? WX[kind][1] : null;
      if (!ic) ic = night ? 'moon' : 'sun';
      if (kind === 'cloudy' && (w.cloudCover || 0) < 0.55) ic = night ? 'moon' : 'cloud';
      C.wi.className = 'wi ' + ic;
      C.wi.innerHTML = iconSvg(ic);
      const hasT = w && typeof w.temperature === 'number';
      C.temp.textContent = hasT ? `${Math.round(w.temperature)}°C` : season;
      C.wl.textContent = hasT ? `${kind ? WX[kind][0] : 'Fair'} · ${season}` : (night ? 'Night' : 'Day');
      const ds = Math.round(tod * 6);
      if (ds !== C.dialSig) { C.dialSig = ds; C.dial.innerHTML = dialSvg(tod); }
    }
    const paused = !!(W.time && W.time.paused);
    const sp = paused ? 0 : W.ui.speed;
    const spSig = String(sp);
    if (spSig !== C.spSig) {
      C.spSig = spSig;
      clockEl.querySelectorAll('[data-sp]').forEach((b) => {
        const v = Number(b.dataset.sp);
        b.classList.toggle('on', v === sp);
        b.classList.toggle('pz', v === 0);
      });
      C.time.style.opacity = paused ? '0.55' : '';
    }
  }
  function setSpeed(mult) {
    const m = Number(mult);
    if (!(m >= 0)) return false;
    if (m === 0) { ctx.clock.paused = true; }
    else {
      ctx.clock.paused = false;
      ctx.clock.scale = BASE_SCALE * m;
      W.ui.speed = m;
    }
    W.ui.paused = m === 0;
    emit('ui:speed-changed', { speed: m === 0 ? 0 : m, paused: m === 0 });
    return true;
  }
  const getSpeed = () => (W.time && W.time.paused ? 0 : W.ui.speed);
  {
    const s = Math.round((ctx.clock.scale || BASE_SCALE) / BASE_SCALE);
    W.ui.speed = SPEEDS.includes(s) ? s : 1;
  }

  // ---------------------------------------------------------------- minimap
  const mini = new Minimap(ctx, data, 184);
  const miniEl = el('div', 'hv-mini');
  const mframe = el('div', 'frame');
  mframe.appendChild(mini.canvas);
  mframe.appendChild(el('div', 'north', `${iconSvg('compass')}<span>N</span>`));
  miniEl.appendChild(mframe);
  const scaleM = 200, scalePx = Math.round((scaleM / W.bounds.w) * 184);
  miniEl.appendChild(el('div', 'cap', `<b>Harvest Valley</b><span style="display:flex;align-items:center;gap:5px;font-style:normal;font-size:10.5px">
    <i style="display:inline-block;width:${scalePx}px;height:5px;border:1.3px solid var(--ink2);border-top:0"></i>${scaleM} m</span>`));
  registerHud('ui:minimap', { slot: 'top-right', order: -100, render: (n) => { n.style.padding = '0'; n.appendChild(miniEl); } });
  mframe.onclick = safe('minimap click', (e) => {
    const r = mframe.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W.bounds.w, y = ((e.clientY - r.top) / r.height) * W.bounds.h;
    ctx.camera.follow(null);
    ctx.camera.set(x, y);
    emit('ui:action', { id: 'minimap-jump', x, y });
  });
  let miniT = 1;

  // ---------------------------------------------------------------- panels
  const panels = new Map();
  let current = null; // { id, spec, bd, sig }
  const launchEl = el('div', 'hv-launch');
  registerHud('ui:launcher', { slot: 'bottom-right', order: 100, render: (n) => { n.style.padding = '0'; n.appendChild(launchEl); } });
  function renderLauncher() {
    const list = [...panels.values()].filter((p) => p.launcher !== false).sort((a, b) => (a.order || 50) - (b.order || 50));
    launchEl.innerHTML = '';
    for (const p of list) {
      const b = el('button', current && current.id === p.id ? 'on' : '', `${iconSvg(p.icon || 'ledger')}${p.hotkey ? `<span class="kc">${esc(keyLabel(p.hotkey))}</span>` : ''}`);
      b.title = p.title + (p.hotkey ? ` (${keyLabel(p.hotkey)})` : '');
      b.onclick = safe('launcher click', () => togglePanel(p.id));
      launchEl.appendChild(b);
    }
  }
  function addPanel(id, spec = {}) {
    if (!id || typeof spec.render !== 'function') return false;
    panels.set(id, { order: 50, ...spec, id, hotkey: normKey(spec.hotkey) });
    renderLauncher();
    if (current && current.id === id) renderPanel();
    return true;
  }
  function removePanel(id) {
    if (current && current.id === id) closePanel();
    const ok = panels.delete(id);
    renderLauncher();
    return ok;
  }
  function renderBody() {
    if (!current) return;
    const { spec, bd } = current;
    const top = bd.scrollTop;
    if (spec.sig) current.sig = foreign(`panel ${spec.id} sig`, spec.sig);
    foreign(`panel ${spec.id} render`, spec.render, bd);
    bd.scrollTop = top;
  }
  function renderPanel() {
    if (!current) return;
    const spec = current.spec;
    panelWrap.innerHTML = '';
    const tabs = el('div', 'hv-tabs hv-hit');
    const list = [...panels.values()].filter((p) => p.launcher !== false).sort((a, b) => (a.order || 50) - (b.order || 50));
    for (const p of list) {
      const b = el('button', p.id === spec.id ? 'on' : '', `${iconSvg(p.icon || 'ledger')}${esc(p.title || p.id)}`);
      b.onclick = safe('tab click', () => openPanel(p.id));
      tabs.appendChild(b);
    }
    const card = el('div', 'hv-panel hv-card hv-hit');
    const hd = el('div', 'hd', `<span class="pi">${iconSvg(spec.icon || 'ledger')}</span><h2>${esc(spec.title || spec.id)}${spec.subtitle ? `<span class="sub">${esc(spec.subtitle)}</span>` : ''}</h2>`);
    const x = el('button', 'hv-x', `<span class="kc">Esc</span>${iconSvg('close')}`);
    x.title = 'Close';
    x.onclick = safe('panel close', () => closePanel());
    hd.appendChild(x);
    const bd = el('div', 'bd');
    card.appendChild(hd);
    card.appendChild(bd);
    panelWrap.appendChild(tabs);
    panelWrap.appendChild(card);
    current.bd = bd;
    renderBody();
  }
  function openPanel(id) {
    const spec = panels.get(id);
    if (!spec) return false;
    if (current && current.id === id) return true;
    if (current) closePanel(null, true);
    current = { id, spec, bd: null, sig: null, acc: 0 };
    W.ui.openPanel = id;
    renderPanel();
    panelWrap.classList.add('on');
    layout();
    renderLauncher();
    if (spec.onOpen) foreign(`panel ${id} onOpen`, spec.onOpen);
    emit('ui:panel-opened', { id });
    return true;
  }
  function closePanel(id, switching) {
    if (!current || (id && current.id !== id)) return false;
    const { spec } = current;
    const cid = current.id;
    current = null;
    W.ui.openPanel = null;
    if (!switching) { panelWrap.classList.remove('on'); panelWrap.innerHTML = ''; recheckCapture(); }
    if (spec.onClose) foreign(`panel ${cid} onClose`, spec.onClose);
    renderLauncher();
    emit('ui:panel-closed', { id: cid });
    return true;
  }
  const togglePanel = (id) => (current && current.id === id ? closePanel() : openPanel(id));
  const isPanelOpen = (id) => (id ? !!current && current.id === id : current ? current.id : null);
  function refreshPanel(id) {
    if (!current || (id && current.id !== id)) return false;
    renderBody();
    return true;
  }

  // ---------------------------------------------------------------- toasts
  const toasts = [];
  let toastSeq = 0;
  function toast(text, opts = {}) {
    const kind = TOAST_ICON[opts.kind] ? opts.kind : 'info';
    const id = 'toast:' + (++toastSeq);
    const body = opts.html ? String(text) : (opts.title ? `<b>${esc(opts.title)}</b><br>` : '') + esc(text);
    // de-dupe: the same message from two owners (e.g. simulation's jobs:reassigned notify + a listener) shows once
    const dup = toasts.find((q) => !q.out && q.kind === kind && q.body === body);
    if (dup) { dup.age = 0; return dup.id; }
    const n = el('div', `hv-toast hv-card hv-hit ${kind}`, `<span class="ti">${iconSvg(opts.icon || TOAST_ICON[kind])}</span><div class="tx">${body}</div>`);
    n.onclick = safe('toast click', () => dismiss(t));
    const t = { id, kind, body, el: n, life: Math.max(0.8, (opts.ms || (kind === 'error' ? 7000 : 4800)) / 1000), age: 0, out: false };
    toasts.push(t);
    toastBox.appendChild(n);
    requestAnimationFrame(() => n.classList.add('on'));
    while (toasts.filter((q) => !q.out).length > 5) dismiss(toasts.find((q) => !q.out));
    return id;
  }
  function dismiss(t) {
    if (!t || t.out) return;
    t.out = true; t.age = 0; t.life = 0.45;
    t.el.classList.add('out');
  }
  function updateToasts(dt) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.age += dt;
      if (t.age >= t.life) {
        if (t.out) { t.el.remove(); toasts.splice(i, 1); } else dismiss(t);
      }
    }
  }

  // ---------------------------------------------------------------- prompt + toolbar
  const promptEl = el('div', 'hv-prompt hv-card hv-hit');
  promptEl.style.display = 'none';
  registerHud('ui:prompt', { slot: 'bottom-center', order: -10, card: false, render: (n) => n.appendChild(promptEl) });
  let promptText = null;
  function setPrompt(text) {
    const t = text == null || text === '' ? null : String(text);
    if (t === promptText) return true;
    promptText = t;
    if (!t) { promptEl.style.display = 'none'; return true; }
    const m = t.match(/^(\S{1,7})\s+[—–-]\s+(.+)$/);
    promptEl.innerHTML = m ? `<span class="kc lg">${esc(m[1])}</span><span>${esc(m[2])}</span>` : `<span>${esc(t)}</span>`;
    promptEl.style.display = '';
    return true;
  }
  const toolName = el('div', 'hv-toolname');
  const toolsEl = el('div', 'hv-tools');
  const toolsWrap = el('div', '', '');
  toolsWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px';
  toolsWrap.appendChild(toolName);
  toolsWrap.appendChild(toolsEl);
  registerHud('ui:toolbar', { slot: 'bottom-center', order: 10, card: false, render: (n) => n.appendChild(toolsWrap) });
  const toolCard = toolsEl;
  toolCard.classList.add('hv-card', 'hv-hit');
  let tools = [];
  function renderTools() {
    toolsWrap.style.display = tools.length ? 'flex' : 'none';
    toolsEl.innerHTML = '';
    const active = tools.find((t) => t.id === W.ui.activeTool);
    toolName.textContent = active ? active.label || active.id : '';
    toolName.style.visibility = active ? '' : 'hidden';
    for (const t of tools) {
      const b = el('button', 'hv-tool' + (t.id === W.ui.activeTool ? ' on' : ''), `${t.hotkey ? `<span class="n">${esc(keyLabel(t.hotkey))}</span>` : ''}${iconSvg(t.icon || 'hand')}`);
      b.title = (t.label || t.id) + (t.hotkey ? ` (${keyLabel(t.hotkey)})` : '');
      b.onclick = safe('tool click', () => selectTool(t.id, true));
      toolsEl.appendChild(b);
    }
  }
  function setToolbar(items) {
    tools = (Array.isArray(items) ? items : []).filter((t) => t && t.id).map((t) => ({ ...t, hotkey: normKey(t.hotkey) }));
    const act = tools.find((t) => t.active);
    if (act) W.ui.activeTool = act.id;
    else if (!tools.find((t) => t.id === W.ui.activeTool)) W.ui.activeTool = null;
    renderTools();
    return true;
  }
  function selectTool(id, fromUser) {
    const t = tools.find((q) => q.id === id);
    if (!t && id != null) return false;
    W.ui.activeTool = t ? t.id : null;
    renderTools();
    if (fromUser && t) {
      if (typeof t.onSelect === 'function') foreign(`tool ${t.id} onSelect`, t.onSelect, t);
      emit('ui:tool-selected', { id: t.id });
    }
    return true;
  }
  const setActiveTool = (id) => selectTool(id, false);

  // ---------------------------------------------------------------- characters
  const charsEl = el('div', 'hv-chars');
  registerHud('ui:characters', { slot: 'bottom-left', order: 0, render: (n) => { n.style.padding = '0'; n.appendChild(charsEl); } });
  const charsCard = charsEl.parentNode;
  let chars = { list: [], active: null, onSelect: null };
  // hired hands: day-rate tag from simulation.workerDayCost(workerId) (null-safe; hidden without data)
  function charRec(id) {
    const list = W.characters && Array.isArray(W.characters.list) ? W.characters.list : [];
    return list.find((c) => c && String(c.id) === String(id)) || null;
  }
  function handCost(id) {
    const rec = charRec(id);
    if (!rec || rec.workerId == null) return null;
    const sim = ctx.modules.get('simulation');
    if (!sim || typeof sim.workerDayCost !== 'function') return null;
    const d = foreign('simulation.workerDayCost', sim.workerDayCost, rec.workerId);
    return d && typeof d.dayRate === 'number' && Number.isFinite(d.dayRate) ? d : null;
  }
  function updateRates() {
    for (const b of charsEl.querySelectorAll('.hv-char[data-cid]')) {
      const r = b.querySelector('.rate');
      if (!r) continue;
      const d = handCost(b.dataset.cid);
      if (!d) { r.style.display = 'none'; continue; }
      const txt = money(d.dayRate, { dec: 0 }) + '/day';
      if (r.textContent !== txt) r.textContent = txt;
      r.style.display = '';
      r.classList.toggle('clk', !!d.onTheClock);
      r.title = d.onTheClock ? `On the clock today · ${money(d.costToday != null ? d.costToday : d.dayRate, { dec: 0 })}` : `Idle today · retainer ${money(d.retainer || 0, { dec: 0 })} · ${money(d.extraIfUsed || 0, { dec: 0 })} more if used`;
    }
  }
  function renderChars() {
    if (charsCard) charsCard.style.display = chars.list.length ? '' : 'none';
    charsEl.innerHTML = '';
    for (const c of chars.list) {
      const b = el('button', 'hv-char' + (c.id === chars.active ? ' on' : ''),
        `<span class="pt">${portrait(c)}</span><span class="nm">${esc(c.name || c.id)}</span><span class="rate" style="display:none"></span>${c.status ? `<span class="st" title="${esc(c.statusText || '')}">${iconSvg(c.status)}</span>` : ''}`);
      b.title = (c.name || c.id) + (c.statusText ? ' — ' + c.statusText : '');
      b.dataset.cid = String(c.id);
      b.onclick = safe('character click', () => {
        if (typeof chars.onSelect === 'function') foreign('character onSelect', chars.onSelect, c.id);
        emit('ui:character-selected', { id: c.id });
      });
      charsEl.appendChild(b);
    }
    updateRates();
    if (chars.list.length > 1) charsEl.appendChild(el('div', 'tab', `<span class="kc lg">Tab</span><span>switch</span>`));
  }
  function setCharacters(list, activeId, onSelect) {
    chars = { list: (Array.isArray(list) ? list : []).filter((c) => c && c.id != null), active: activeId, onSelect: onSelect || chars.onSelect };
    renderChars();
    return true;
  }

  // ---------------------------------------------------------------- solvency warning (persistent while over the limit)
  const solvEl = el('div', 'hv-solv');
  registerHud('ui:solvency', { slot: 'top-center', order: 10, className: 'hv-solvcard', render: (n) => { n.style.padding = '0'; n.appendChild(solvEl); } });
  const solvCard = solvEl.parentNode;
  if (solvCard) solvCard.style.display = 'none';
  let solvSig = '';
  const plural = (n, w) => `${n} day${n === 1 ? '' : 's'}`;
  function updateSolvency() {
    const sim = ctx.modules.get('simulation');
    const s = sim && typeof sim.solvency === 'function' ? foreign('simulation.solvency', sim.solvency) : null;
    let html = '', cls = '';
    if (s && s.bankrupt) {
      cls = 'bankrupt';
      html = `<b>The farm is bankrupt</b><span>Leases are handed back and the bank blocks purchases while cash is negative. Carry on with odd jobs to get back in the black${sim && typeof sim.restart === 'function' ? ', or start again' : ''}.</span>`;
    } else if (s && s.overLimit) {
      const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
      const toBlock = n(s.daysToBlock), toSettle = n(s.daysToSettlement);
      let cd;
      if (s.nextStage === 'blocked' && toBlock != null) cd = `Purchases blocked in <b>${plural(toBlock)}</b>` + (toSettle != null ? ` · bank settlement in ${plural(toSettle)}` : '');
      else if (s.nextStage === 'settlement' && toSettle != null) cd = `Purchases blocked · <b>bank sells assets in ${plural(toSettle)}</b>`;
      else if (s.nextStage === 'bankrupt') cd = `Already restructured once · <b>bankruptcy in ${plural(toSettle != null ? toSettle : 0)}</b>`;
      else cd = s.blocked ? 'Purchases blocked by the bank' : 'Get back under the credit limit';
      cls = s.nextStage === 'blocked' ? 'over' : 'blocked';
      html = `<b>Over the credit limit${typeof s.overdraft === 'number' ? ' · ' + money(-s.overdraft, { dec: 0 }) : ''}</b><span>${cd}</span>`;
    } else if (s && s.restructured && s.blocked) {
      cls = 'blocked';
      html = `<b>Overdraft restructured</b><span>The bank keeps purchases blocked until cash is positive.</span>`;
    }
    const sig = cls + html;
    if (sig === solvSig) return;
    solvSig = sig;
    if (solvCard) solvCard.style.display = html ? '' : 'none';
    solvEl.className = 'hv-solv ' + cls;
    solvEl.innerHTML = html ? `<span class="si">${iconSvg('warn')}</span><div>${html}</div>` : '';
  }

  // ---------------------------------------------------------------- world labels
  const labels = new Map();
  function worldLabel(id, o = {}) {
    if (!id) return false;
    let L = labels.get(id);
    if (!L) {
      L = { el: el('div', 'hv-wl'), px: NaN, py: NaN, vis: true };
      labelsLayer.appendChild(L.el);
      labels.set(id, L);
    }
    L.x = +o.x || 0; L.y = +o.y || 0;
    const kind = o.kind || 'info';
    const ic = o.icon || { field: 'land', sell: 'coin', warn: 'warn', job: 'jobs' }[kind];
    const html = `<div class="b">${ic ? iconSvg(ic) : ''}<span>${esc(o.text || '')}</span></div><span class="dot"></span>`;
    if (L.html !== html || L.kind !== kind) { L.html = html; L.kind = kind; L.w = 0; L.hid = false; L.el.className = 'hv-wl ' + kind; L.el.innerHTML = html; }
    return true;
  }
  function removeWorldLabel(id) {
    const L = labels.get(id);
    if (!L) return false;
    L.el.remove();
    labels.delete(id);
    return true;
  }
  function updateLabels() {
    if (!labels.size) return;
    const cw = ctx.camera.w, ch = ctx.camera.h;
    for (const L of labels.values()) {
      const s = ctx.camera.worldToScreen(L.x, L.y);
      const vis = s.sx > -150 && s.sx < cw + 150 && s.sy > -40 && s.sy < ch + 80;
      if (vis !== L.vis) { L.vis = vis; L.el.style.display = vis ? '' : 'none'; }
      if (!vis) continue;
      const px = Math.round(s.sx), py = Math.round(s.sy);
      if (px !== L.px || py !== L.py) { L.px = px; L.py = py; L.el.style.transform = `translate(${px}px,${py}px)`; }
      if (!L.w) { const b = L.el.firstChild; L.w = b ? b.offsetWidth : 0; L.h = b ? b.offsetHeight : 0; }
      const x0 = px - L.w / 2 - 4, x1 = px + L.w / 2 + 4, y0 = py - L.h - 13, y1 = py + 4;
      let hit = x0 < 2 || x1 > cw - 2 || y0 < 2;
      for (let i = 0; !hit && i < hudRects.length; i++) { const r = hudRects[i]; hit = x0 < r.right && x1 > r.left && y0 < r.bottom && y1 > r.top; }
      if (hit !== !!L.hid) { L.hid = hit; L.el.classList.toggle('hid', hit); }
    }
  }
  // ---------------------------------------------------------------- layout (panel size, toasts, HUD rects)
  let hudRects = [];
  let pointer = null;
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const tr = slots.tr.getBoundingClientRect(), tl = slots.tl.getBoundingClientRect(), tc = slots.tc.getBoundingClientRect();
    const side = Math.max(tr.width, tl.width) + 14 + 12;
    const pw = Math.round(Math.max(360, Math.min(700, vw - 2 * side)));
    panelWrap.style.width = pw + 'px';
    const top = Math.round(tc.bottom + 48);
    panelWrap.style.top = top + 'px';
    const left = (vw - pw) / 2, right = left + pw;
    let bottom = vh - 14;
    const rects = [];
    for (const k of ['bl', 'bc', 'br', 'tl', 'tc', 'tr']) {
      for (const c of slots[k].children) {
        for (const n of (c.classList.contains('bare') ? c.querySelectorAll('.hv-card, .hv-toolname') : [c])) {
          const r = n.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          rects.push(r);
          if (k[0] === 'b' && r.right > left && r.left < right) bottom = Math.min(bottom, r.top);
        }
      }
    }
    const tabsH = 34;
    panelWrap.style.setProperty('--hv-pmax', Math.max(160, Math.round(bottom - 12 - top - tabsH)) + 'px');
    toastBox.style.top = Math.round(tr.bottom + 12) + 'px';
    const avail = current ? vw - right - 14 - 10 : 330;
    toastBox.style.width = Math.round(Math.max(190, Math.min(330, avail))) + 'px';
    for (const t of toasts) if (!t.out) rects.push(t.el.getBoundingClientRect());
    if (current) for (const n of panelWrap.children) rects.push(n.getBoundingClientRect());
    hudRects = rects;
  }
  function recheckCapture() {
    if (modal) { ctx.input.uiCapturing = true; return; }
    if (!pointer) { ctx.input.uiCapturing = false; return; }
    const t = document.elementFromPoint(pointer.x, pointer.y);
    ctx.input.uiCapturing = !!(t && t.closest && t.closest('.hv-hit') && root.contains(t));
  }

  // ---------------------------------------------------------------- confirm dialog
  function confirm(o = {}) {
    if (modal) modal.finish(false);
    return new Promise((resolve) => {
      const back = el('div', 'hv-modal hv-hit');
      const dlg = el('div', 'hv-dialog hv-card', `<h2>${iconSvg(o.icon || 'help')}${esc(o.title || 'Are you sure?')}</h2>${o.text ? `<p>${esc(o.text)}</p>` : ''}<div class="btns"></div>`);
      const btns = dlg.querySelector('.btns');
      const no = el('button', 'hv-btn', `${esc(o.cancelLabel || 'Cancel')} <span class="kc">Esc</span>`);
      const yes = el('button', 'hv-btn ' + (o.danger ? 'warm' : 'pri'), `${iconSvg('check')}${esc(o.okLabel || 'OK')} <span class="kc" style="margin-left:2px">Enter</span>`);
      btns.appendChild(no); btns.appendChild(yes);
      back.appendChild(dlg);
      root.appendChild(back);
      requestAnimationFrame(() => back.classList.add('on'));
      const m = {
        finish(v) {
          if (modal !== m) return;
          modal = null;
          back.style.pointerEvents = 'none';
          back.classList.remove('on');
          recheckCapture();
          setTimeout(() => back.remove(), 200);
          resolve(!!v);
        },
      };
      modal = m;
      no.onclick = safe('confirm cancel', () => m.finish(false));
      yes.onclick = safe('confirm ok', () => m.finish(true));
      back.onclick = safe('confirm backdrop', (e) => { if (e.target === back) m.finish(false); });
    });
  }

  // ---------------------------------------------------------------- built-in panels
  const K = {
    data, clock: ctx.clock, safe, emit, confirm,
    toast: (t, o) => toast(t, o),
    rerender: (id) => refreshPanel(id),
  };
  for (const p of builtinPanels(K)) addPanel(p.id, p);

  // ---------------------------------------------------------------- input
  const held = new Set();
  // Keys the vehicles/characters modules use while the active character drives (H hitch, G refuel,
  // U auger, L lights, E implement, F exit, R reserved, WASD). ui panel/tool hotkeys yield to them.
  const VEHICLE_KEYS = new Set(['KeyH', 'KeyG', 'KeyU', 'KeyL', 'KeyE', 'KeyF', 'KeyR', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  const activeChar = () => {
    const id = W.player && W.player.activeCharacterId;
    if (id == null) return null;
    const list = W.characters && Array.isArray(W.characters.list) ? W.characters.list : [];
    return list.find((c) => c && c.id === id) || null;
  };
  const driving = () => { const c = activeChar(); return !!(c && c.vehicleId); };
  const offKey = ctx.input.on('key', (ev) => {
    if (!ev.down) { held.delete(ev.code); return; }
    if (held.has(ev.code)) return;
    held.add(ev.code);
    if (modal) {
      if (ev.code === 'Escape') { modal.finish(false); ev.stop = true; }
      else if (ev.code === 'Enter' || ev.code === 'NumpadEnter') { modal.finish(true); ev.stop = true; }
      return;
    }
    if (ev.code === 'Escape' && current) { closePanel(); ev.stop = true; return; }
    for (const m of ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']) if (held.has(m)) return;
    const yieldKey = VEHICLE_KEYS.has(ev.code) && driving();
    if (!yieldKey) for (const p of panels.values()) if (p.hotkey && p.hotkey === ev.code) { togglePanel(p.id); ev.stop = true; return; }
    if (ev.code === 'Space') { setSpeed(W.time.paused ? W.ui.speed : 0); ev.stop = true; return; }
    if (ev.code === 'Equal' || ev.code === 'NumpadAdd') {
      const i = SPEEDS.indexOf(W.ui.speed);
      setSpeed(W.time.paused ? W.ui.speed : SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]);
      ev.stop = true;
      return;
    }
    if (ev.code === 'Minus' || ev.code === 'NumpadSubtract') {
      const i = SPEEDS.indexOf(W.ui.speed);
      if (i <= 0) setSpeed(0); else setSpeed(SPEEDS[i - 1]);
      ev.stop = true;
      return;
    }
    const t = yieldKey ? null : tools.find((q) => q.hotkey === ev.code);
    if (t) { selectTool(t.id, true); ev.stop = true; }
  });
  const CAPTURE = '.hv-hit';
  const onPointer = (e) => {
    const t = e.target;
    pointer = { x: e.clientX, y: e.clientY };
    ctx.input.uiCapturing = !!modal || !!(t && t.closest && t.closest(CAPTURE) && root.contains(t));
  };
  window.addEventListener('pointermove', onPointer, true);
  window.addEventListener('pointerdown', onPointer, true);

  // ---------------------------------------------------------------- events
  const offs = [];
  const on = (type, fn) => { ctx.events.on(type, fn); offs.push([type, fn]); };
  let newJobs = 0, newJobsT = 0;
  on('jobs:offered', () => { newJobs++; newJobsT = 0.6; });
  on('jobs:completed', (p) => {
    const j = (p && (p.job || p)) || {};
    toast(`<b>Contract finished</b><br>${esc(j.title || 'Job done')}${typeof j.pay === 'number' ? ' · ' + money(j.pay, { dec: 0 }) : ''}`, { kind: 'success', icon: 'check', html: true });
  });
  on('jobs:failed', (p) => {
    const j = (p && (p.job || p)) || {};
    toast(`<b>Contract missed</b><br>${esc(j.title || 'A job ran past its deadline')}`, { kind: 'warn', icon: 'clock', html: true });
  });
  on('economy:transaction', (p) => {
    if (!p || typeof p.amount !== 'number' || String(p.category).toLowerCase() !== 'sale' || p.amount < 50) return;
    toast(`<b>${esc(p.memo || 'Sale')}</b><br>${money(p.amount, { sign: true })}`, { kind: 'money', icon: 'coin', html: true });
  });
  on('economy:bankrupt-warning', (p) => {
    const stage = p && p.stage;
    solvSig = null; // refresh the persistent card now
    updateSolvency();
    if (stage === 'bankrupt') {
      toast('<b>The farm has gone bankrupt</b><br>The bank has taken back the leases. Carry on with odd jobs to rebuild.', { kind: 'error', icon: 'warn', html: true, ms: 12000 });
    } else if (stage === 'restructured') {
      const extra = p && typeof p.loan === 'number' ? ` A ${money(p.loan, { dec: 0 })} loan over ${esc(p.months)} months${typeof p.writeOff === 'number' && p.writeOff > 0 ? `, ${money(p.writeOff, { dec: 0 })} written off` : ''}.` : '';
      toast(`<b>Overdraft restructured</b><br>The bank has given you one second chance.${extra}`, { kind: 'warn', icon: 'loan', html: true, ms: 12000 });
    } else if (stage === 'overdraft') {
      toast(`<b>Overdrawn</b><br>${esc((p && p.message) || 'The farm account is in the red. Overdraft interest is running.')}`, { kind: 'warn', icon: 'warn', html: true });
    } else {
      toast(`<b>The bank is worried</b><br>${esc((p && p.message) || 'Your balance is deep in the red. Sell produce or take on contracts.')}`, { kind: 'error', icon: 'warn', html: true, ms: 9000 });
    }
  });
  on('characters:switched', (p) => {
    const id = p && p.id;
    if (id == null) return;
    const d = handCost(id);
    updateRates();
    if (!d) return;
    const rec = charRec(id);
    const nm = esc((rec && rec.name) || 'This hand');
    const txt = d.onTheClock
      ? `${nm} is on the clock today · ${money(d.dayRate, { dec: 0 })}/day`
      : `${nm} is idle today (retainer ${money(d.retainer || 0, { dec: 0 })}). Putting them to work costs ${money(d.extraIfUsed != null ? d.extraIfUsed : d.dayRate, { dec: 0 })} more · ${money(d.dayRate, { dec: 0 })}/day`;
    toast(txt, { kind: 'money', icon: 'person', html: true, ms: 5200 });
  });
  on('env:weather-changed', (p) => {
    const k = p && (p.kind || (p.weather && p.weather.kind));
    if (!['rain', 'storm', 'snow', 'fog'].includes(k)) return;
    const txt = { rain: 'Rain is setting in.', storm: 'A thunderstorm is rolling in — get the animals inside.', snow: 'It has started to snow.', fog: 'Fog is settling over the valley.' }[k];
    toast(txt, { kind: 'info', icon: k });
  });
  const inval = () => mini.invalidate();
  on('terrain:generated', inval); on('terrain:changed', inval); on('roads:changed', inval);
  on('land:parcel-changed', () => { inval(); if (current) current.sig = null; });
  on('clock:day', () => { if (current) current.sig = null; });

  // ---------------------------------------------------------------- frame
  let slowT = 0, panelT = 0, hudT = 0, night = null, layoutT = 1, demoDelay = 0, demoDelta = 0;
  const onResize = () => { layoutT = 1; };
  window.addEventListener('resize', onResize);
  function frame(dt) {
    dt = Math.min(0.1, dt || 0);
    if (demoDelay > 0) { demoDelay -= dt; if (demoDelay <= 0) { const v = data.money(); if (v != null) { M.shown = v - demoDelta; M.target = v - demoDelta; M.deltaT = 0; M.deltaSum = 0; M.hold = 30; } } }
    updateMoney(dt);
    layoutT += dt;
    if (layoutT >= 0.5) { layoutT = 0; layout(); }
    updateClock();
    updateLabels();
    updateToasts(dt);
    if (newJobsT > 0) {
      newJobsT -= dt;
      if (newJobsT <= 0 && newJobs) {
        toast(newJobs === 1 ? 'A new contract is pinned on the jobs board.' : `${newJobs} new contracts are pinned on the jobs board.`, { kind: 'info', icon: 'jobs' });
        newJobs = 0;
      }
    }
    miniT += dt;
    if (miniT >= 0.25) { miniT = 0; mini.draw(); }
    hudT += dt;
    if (hudT >= 0.1) {
      hudT = 0;
      for (const h of huds.values()) if (typeof h.spec.update === 'function') foreign(`hud ${h.id} update`, h.spec.update, h.el);
    }
    panelT += dt;
    if (current && panelT >= 0.5) {
      panelT = 0;
      const s = current.spec;
      if (s.sig) {
        const sig = foreign(`panel ${s.id} sig`, s.sig);
        if (sig !== current.sig) renderBody();
      }
      if (typeof s.update === 'function' && current.bd) foreign(`panel ${s.id} update`, s.update, current.bd);
    }
    slowT += dt;
    if (slowT >= 0.5 || night === null) {
      slowT = 0;
      updateRates();
      updateSolvency();
      const n = data.daylight() < 0.3;
      if (n !== night) { night = n; root.classList.toggle('hv-night', n); }
    }
  }

  // ---------------------------------------------------------------- api
  const api = {
    registerHud, removeHud, addPanel, removePanel, openPanel, closePanel: (id) => closePanel(id), togglePanel, isPanelOpen, refreshPanel,
    toast, setToolbar, setActiveTool, confirm, setPrompt, worldLabel, removeWorldLabel, setCharacters,
    icon: (name) => iconSvg(name),
    formatMoney: (v, o) => money(v, o),
    setSpeed, getSpeed,
  };
  const hooks = {
    invalidateMinimap: () => { mini.invalidate(); miniT = 1; },
    demoMoneyDelta: (d) => { demoDelta = d; demoDelay = 0.35; },
  };
  renderTools();
  renderChars();
  INSTANCE = { api, data, hooks, ctx };
  frame(0);

  return {
    api,
    frame,
    save: () => ({ speed: W.ui.speed, paused: !!W.ui.paused, activeTool: W.ui.activeTool }),
    load: (d) => { if (!d) return; if (d.speed) setSpeed(d.speed); if (d.paused) setSpeed(0); if (d.activeTool) setActiveTool(d.activeTool); },
    dispose() {
      offKey && offKey();
      for (const [t, f] of offs) ctx.events.off(t, f);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onResize);
      root.remove();
      if (INSTANCE && INSTANCE.api === api) INSTANCE = null;
    },
  };
}

export const showcase = {
  deps: SOLO ? [] : ['simulation', 'environment', 'terrain'],
  presets: PRESETS,
  async stage(ctx, preset) {
    if (!INSTANCE) throw new Error('ui not initialised');
    await stageShowcase(ctx, INSTANCE.api, INSTANCE.data, preset, INSTANCE.hooks);
  },
};
