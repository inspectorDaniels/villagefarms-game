// Hand tools: definitions, what E would do at the tile in front (prompt text), and the effect of
// a tool strike (terrain / crops / animals / ui / effects / audio). Everything optional is null-safe.

export const TOOLS = [
  { id: 'hoe', label: 'Hoe', icon: 'hoe', key: '1', dur: 0.95, impact: 0.47, cooldown: 0.2, stamina: 0.035, reach: 1.3 },
  { id: 'water', label: 'Watering can', icon: 'water', key: '2', dur: 1.35, impact: 0.3, cooldown: 0.15, stamina: 0.012, reach: 1.2 },
  { id: 'seed', label: 'Seed bag', icon: 'seed', key: '3', dur: 0.95, impact: 0.5, cooldown: 0.1, stamina: 0.01, reach: 1.45 },
  { id: 'fork', label: 'Pitchfork', icon: 'hay', key: '4', dur: 1.05, impact: 0.36, cooldown: 0.2, stamina: 0.03, reach: 1.25 },
  { id: 'hand', label: 'Hands', icon: 'hand', key: '5', dur: 0.7, impact: 0.4, cooldown: 0.1, stamina: 0.004, reach: 0.8 },
];
export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

const TILLABLE = { grass: 'grass', meadow: 'meadow', forestFloor: 'woodland floor', farmyard: 'yard' };
const SEEDABLE = { soil: 1, ploughed: 1 };
const SEED_CROP = 'wheat';

export function createTools(ctx, S) {
  const mod = (id) => ctx.modules.get(id);
  const W = ctx.world;
  const fx = ctx.rng('tools-fx');

  /** 1 m cell in front of the character */
  function targetOf(ch, tool) {
    const t = TOOL[tool] || TOOL.hand;
    const x = ch.x + Math.sin(ch.rot) * t.reach, y = ch.y - Math.cos(ch.rot) * t.reach;
    return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, fx: x, fy: y };
  }
  const cellKey = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  const plots = () => (W.characters.plots || (W.characters.plots = {}));

  function nearestPen(x, y, r) {
    const animals = mod('animals');
    const pens = (W.animals && W.animals.pens) || [];
    if (!animals) return null;
    let best = null, bd = r;
    for (const p of pens) {
      const t = p.trough; if (!t) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function nearestSellPoint(x, y, r) {
    const sim = mod('simulation');
    const sps = (sim && sim.sellPoints && sim.sellPoints()) || [];
    let best = null, bd = r;
    for (const s of sps) { if (s.x == null) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  /**
   * what the tool would do at the target. → { ok, text, verb, surf, ... } ; text is the prompt
   * ("E — Hoe the grass") or a hint without a key when nothing can be done.
   */
  function describe(ch, tool) {
    const tg = targetOf(ch, tool);
    const terrain = mod('terrain');
    const crops = mod('crops');
    const surf = terrain ? terrain.surfaceAt(tg.x, tg.y) : 'grass';
    const out = { ok: false, text: null, target: tg, surf };
    if (surf === 'water') { out.text = null; return out; }
    const field = crops && crops.fieldAt ? crops.fieldAt(tg.x, tg.y) : null;
    const plot = plots()[cellKey(tg.x, tg.y)];
    if (TILLABLE[surf] && tool === 'hoe') {
      const roads = mod('roads');
      const n = roads && roads.nearest ? roads.nearest(tg.x, tg.y) : null;
      ch.onVerge = !!(n && n.dist < 5.5);
    }
    switch (tool) {
      case 'hoe':
        if (field) { out.ok = true; out.text = 'E — Hoe the field'; }
        else if (surf === 'ploughed') { out.ok = true; out.text = 'E — Break up the clods'; }
        else if (TILLABLE[surf]) { out.ok = true; out.text = `E — Hoe the ${ch.onVerge ? 'verge' : TILLABLE[surf]}`; }
        else if (surf === 'soil') out.text = plot && plot.sown ? 'Sown: water it' : 'Tilled: ready for seed';
        else if (surf === 'shallow' || surf === 'mud') out.text = 'Too wet to hoe';
        else out.text = 'Ground too hard to hoe';
        break;
      case 'water':
        if (field || surf === 'soil' || surf === 'ploughed') { out.ok = true; out.text = plot && plot.sown ? 'E — Water the seedbed' : 'E — Water the soil'; }
        else if (surf === 'shallow') { out.ok = true; out.text = 'E — Fill the watering can'; out.fill = true; }
        else { out.ok = true; out.text = 'E — Water the grass'; }
        break;
      case 'seed':
        if (field || (SEEDABLE[surf] && !(plot && plot.sown))) { out.ok = true; out.text = `E — Sow ${SEED_CROP}`; }
        else if (plot && plot.sown) out.text = 'Already sown';
        else out.text = 'Seed needs tilled soil (hoe first)';
        break;
      case 'fork':
        if (field) { out.ok = true; out.text = 'E — Rake with the fork'; }
        else if (surf === 'ploughed' || surf === 'soil') { out.ok = true; out.text = 'E — Loosen the soil'; }
        else if (surf === 'grass' || surf === 'meadow') { out.ok = true; out.text = 'E — Toss the cut grass'; }
        else out.text = null;
        break;
      default: {
        const pen = nearestPen(ch.x, ch.y, 2.2);
        if (pen) { out.ok = true; out.text = `E — Feed the ${pen.species || 'animals'}`; out.pen = pen; break; }
        const sp = nearestSellPoint(ch.x, ch.y, 5);
        if (sp) { out.ok = true; out.text = `E — Trade at ${sp.name || 'the market'}`; out.sell = sp; break; }
        const js = S.jobSiteNear && S.jobSiteNear(ch.x, ch.y, 5);
        if (js) { out.ok = true; out.text = 'E — Read the job board'; out.jobs = true; break; }
        out.text = null;
      }
    }
    if (out.ok && ch.stamina < (TOOL[tool] || TOOL.hand).stamina) { out.ok = false; out.text = 'Too tired: rest a moment'; }
    return out;
  }

  const sfx = (id, x, y, o = {}) => { const a = mod('audio'); if (a) a.play(id, { x, y, ...o }); };
  const emit = (type, x, y, o) => { const e = mod('effects'); if (e) e.emit(type, x, y, o); };

  /** apply the tool strike at impact time. Returns true when something changed. */
  function apply(ch, tool, d) {
    const tg = d.target;
    const terrain = mod('terrain');
    const crops = mod('crops');
    const dirX = Math.sin(ch.rot), dirY = -Math.cos(ch.rot);
    const k = cellKey(tg.x, tg.y);
    let changed = false;
    switch (tool) {
      case 'hoe': {
        if (crops && crops.work && crops.fieldAt && crops.fieldAt(tg.x, tg.y)) {
          const r = crops.work('cultivate', tg.x, tg.y, 1, ch.rot); changed = !!(r && r.cellsChanged);
        } else if (terrain && (TILLABLE[d.surf] || d.surf === 'ploughed')) {
          const j = 0.04;
          terrain.paintSurface({ poly: [[tg.x - 0.5 - j, tg.y - 0.5], [tg.x + 0.5, tg.y - 0.5 - j], [tg.x + 0.5 + j, tg.y + 0.5], [tg.x - 0.5, tg.y + 0.5 + j]] }, 'soil');
          delete plots()[k];
          changed = true;
        }
        emit('clods', tg.fx, tg.fy, { count: 5, dirX: -dirX, dirY: -dirY, speed: 1.1, spread: 1.2, color: '#5e4632' });
        emit('dust', tg.fx, tg.fy, { count: 2, size: 0.6, alpha: 0.35, speed: 0.4 });
        sfx('plough-clod', tg.x, tg.y, { volume: 0.8, pitch: 1.25 + fx.range(-0.1, 0.1) });
        break;
      }
      case 'water': {
        if (d.fill) { sfx('splash', tg.x, tg.y, { volume: 0.6 }); ch.water = 1; break; }
        if (crops && crops.work && crops.fieldAt && crops.fieldAt(tg.x, tg.y)) { crops.work('water', tg.x, tg.y, 1, ch.rot); changed = true; }
        else {
          const p = plots()[k] || (plots()[k] = {});
          p.watered = ctx.clock.t; changed = true;
          const e = mod('effects');
          if (e && e.decal) e.decal('spill', tg.x + fx.range(-0.1, 0.1), tg.y + fx.range(-0.1, 0.1), fx.range(0, 6.28), { color: '#2e2a26', size: 1.15, alpha: 0.5, life: 3 * 3600 });
        }
        sfx('splash', tg.x, tg.y, { volume: 0.35, pitch: 1.4 });
        break;
      }
      case 'seed': {
        if (crops && crops.work && crops.fieldAt && crops.fieldAt(tg.x, tg.y)) { const r = crops.work('seed:' + SEED_CROP, tg.x, tg.y, 1.2, ch.rot); changed = !!(r && r.cellsChanged); }
        else if (SEEDABLE[d.surf]) { const p = plots()[k] || (plots()[k] = {}); p.sown = ctx.clock.t; p.crop = SEED_CROP; p.rot = ch.rot; changed = true; }
        emit('chaff', tg.fx - dirX * 0.4, tg.fy - dirY * 0.4, { count: 9, dirX, dirY, speed: 1.3, spread: 0.7, color: '#d9b95c', size: 0.3, z: 1.1, vz: 0.6 });
        sfx('footstep-gravel', tg.x, tg.y, { volume: 0.35, pitch: 1.9 });
        break;
      }
      case 'fork': {
        if (crops && crops.work && crops.fieldAt && crops.fieldAt(tg.x, tg.y)) { crops.work('rake', tg.x, tg.y, 1, ch.rot); changed = true; }
        else if (terrain && d.surf === 'ploughed') { terrain.paintSurface({ x: tg.x, y: tg.y, r: 0.62 }, 'soil'); changed = true; }
        const soil = d.surf === 'soil' || d.surf === 'ploughed';
        if (soil) emit('clods', tg.fx, tg.fy, { count: 4, dirX: dirY, dirY: -dirX, speed: 1.4, spread: 0.6, color: '#5e4632' });
        else emit('chaff', tg.fx, tg.fy, { count: 10, dirX: -dirY, dirY: dirX, speed: 1.6, spread: 0.6, color: '#b9b36a', size: 0.5 });
        sfx(soil ? 'plough-clod' : 'footstep-grass', tg.x, tg.y, { volume: 0.6, pitch: 0.8 });
        break;
      }
      default: {
        if (d.pen) {
          const an = mod('animals');
          if (an && an.feed) { an.feed(d.pen.id, 5); changed = true; }
        } else if (d.sell) {
          const ui = mod('ui'); if (ui) ui.openPanel('market'); changed = true;
        } else if (d.jobs) {
          const ui = mod('ui'); if (ui) ui.openPanel('jobs'); changed = true;
        }
      }
    }
    if (changed) ctx.events.emit('characters:interact', { id: ch.id, tool, x: tg.x, y: tg.y, surface: d.surf });
    return changed;
  }

  return { describe, apply, targetOf, cellKey };
}
