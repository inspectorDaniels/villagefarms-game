// vehicles — driving HUD card (shown only while the active character drives).
import { ALL } from './types.js';

export function createHud({ ctx, mod, get, byId, repairCost, refuel, repair }) {
  let installed = false;
  let node = null;
  let lastSig = '';

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function bar(frac, col) {
    const f = Math.max(0, Math.min(1, frac));
    return `<span style="display:inline-block;width:70px;height:7px;border-radius:4px;background:rgba(90,70,40,.18);vertical-align:middle;overflow:hidden"><i style="display:block;height:100%;width:${(f * 100).toFixed(0)}%;background:${col}"></i></span>`;
  }
  function render(el) {
    node = el;
    el.style.display = 'none';
    el.style.minWidth = '300px';
    el.style.font = '12px system-ui, Segoe UI, sans-serif';
    el.addEventListener('click', (e) => {
      const b = e.target && e.target.closest && e.target.closest('[data-veh]');
      const v = get();
      if (!b || !v) return;
      const ui = mod('ui');
      if (b.dataset.veh === 'refuel') { const l = refuel(v.id); if (ui) ui.toast(l > 0 ? `Refuelled ${l.toFixed(0)} L` : 'Tank full or no money', { kind: l > 0 ? 'info' : 'warn', icon: 'diesel' }); }
      if (b.dataset.veh === 'repair') { const c = repair(v.id); if (ui) ui.toast(c ? `Repaired for €${c}` : 'Cannot afford the repair', { kind: c ? 'money' : 'warn' }); }
      lastSig = '';
    });
  }
  function update(el) {
    const v = get();
    if (!v) { if (el.style.display !== 'none') el.style.display = 'none'; lastSig = ''; return; }
    el.style.display = '';
    const T = ALL[v.type];
    const kmh = Math.abs(v.speed) * 3.6;
    const parts = (v.attached || []).map((id) => byId.get(id)).filter(Boolean);
    const impl = parts.map((p) => `${esc(p.name)} <b>${p.lowered ? 'LOWERED' : 'raised'}</b>`).join(' · ') || (T.header ? `Header <b>${v.lowered ? 'LOWERED' : 'raised'}</b>` : '<i>no implement</i>');
    const worked = parts.reduce((a, p) => a + (p.workedArea || 0), T.header ? v.workedArea || 0 : 0);
    const cargo = v.cargo && v.cargo.kg > 0 ? ` · tank ${(v.cargo.kg / 1000).toFixed(2)} t ${esc(v.cargo.item || '')}` : '';
    const rc = repairCost(v);
    const warn = v.fuel <= 0 ? '<span style="color:#a8392f">Out of fuel — G to refuel</span>' : v.blocked === 'water' ? '<span style="color:#a8392f">Too deep to drive</span>' : v.blocked === 'solid' ? '<span style="color:#b8652e">Blocked</span>' : '';
    const sig = [v.id, kmh.toFixed(0), v.fuel.toFixed(0), (v.wear * 100).toFixed(0), impl, worked.toFixed(0), cargo, warn, v.lights, v.surface].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
      <b style="font:600 14px Georgia,serif">${esc(v.name)}</b><span style="font:600 18px Georgia,serif">${kmh.toFixed(0)} <small>km/h</small></span></div>
      <div>Diesel ${bar(v.fuel / v.tank, v.fuel / v.tank < 0.15 ? '#a8392f' : '#3f6b3a')} ${v.fuel.toFixed(0)} / ${v.tank} L
       · Wear ${bar(v.wear, v.wear > 0.6 ? '#a8392f' : '#b8652e')} ${(v.wear * 100).toFixed(0)}%</div>
      <div>${impl}${worked > 1 ? ` · worked ${(worked / 10000).toFixed(2)} ha` : ''}${cargo}</div>
      <div style="opacity:.75">${esc(v.surface || '')}${v.lights ? ' · lights on' : ''} ${warn}</div>
      <div style="opacity:.8;margin-top:3px">E lower/raise · H hitch · L lights · G refuel${T.header ? ' · U unload' : ''}
       <button data-veh="refuel" style="margin-left:6px">Refuel</button>${rc > 0 ? `<button data-veh="repair">Repair €${rc}</button>` : ''}</div>`;
  }
  function install() {
    const ui = mod('ui');
    if (!ui || !ui.registerHud || installed) return;
    ui.registerHud('vehicles:drive', { slot: 'bottom-center', order: 5, render, update });
    installed = true;
  }
  function dispose() { const ui = mod('ui'); if (ui && installed) ui.removeHud('vehicles:drive'); installed = false; }
  void ctx;
  return { install, dispose };
}
