// characters — playable farmhands (possession, Tab switching, hand tools, vehicles),
// hired-hand AI, ambient villagers, painted top-down people with a walk cycle.
import { makeAppearance, portraitOf, pickName } from './appearance.js';
import { createSprites, SPPM } from './sprites.js';
import { createBody, K } from './body.js';
import { createMotion, PRINTS, STEP_SOUND } from './motion.js';
import { createTools, TOOLS, TOOL } from './tools.js';
import { createAI } from './ai.js';
import { presets, stage } from './showcase.js';

export const manifest = {
  id: 'characters',
  wave: 2,
  deps: [],
  optionalDeps: ['terrain', 'environment', 'roads', 'simulation', 'ui', 'audio', 'effects', 'vehicles', 'crops', 'animals', 'buildings'],
  namespaces: ['characters', 'player'],
  api: ['spawn', 'despawn', 'list', 'get', 'active', 'setActive', 'cycle', 'assignTask', 'positionOf', 'villagers',
    'setAutoSpawn', 'hire', 'setTool', 'useTool', 'tools', 'isAvailable', 'setFollowZoom'],
  emits: ['characters:switched', 'characters:spawned', 'characters:interact', 'characters:despawned'],
  listens: ['jobs:completed', 'jobs:failed', 'vehicles:exited'],
};

const INSTANCES = new WeakMap();
const PRESENCE = { shopHelp: 1, villageWork: 1, animalCare: 1 };
const TASK_KINDS = { goto: 1, idle: 1, follow: 1, work: 1, patrol: 1, sleep: 1, hold: 1 };
const JOB_TOOL = { animalCare: 'fork', shopHelp: 'hand', villageWork: 'hoe', snowClear: 'fork', deliver: 'hand' };
const SAVE_FIELDS = ['id', 'name', 'role', 'x', 'y', 'rot', 'state', 'vehicleId', 'task', 'appearance', 'tool', 'stamina', 'home', 'workerId', 'villager', 'pace', 'umbrella'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export async function init(ctx) {
  const W = ctx.world;
  const C = W.characters;
  C.list = C.list || [];
  C.nextId = C.nextId || 1;
  C.plots = C.plots || {};
  C.jobSites = C.jobSites || {};
  W.player.activeCharacterId = W.player.activeCharacterId || null;
  const mod = (id) => ctx.modules.get(id);
  const art = ctx.art;
  const parts = createSprites(art, ctx.palette);
  const body = createBody(art, parts);
  const motion = createMotion(ctx);
  const rngApp = ctx.rng('appearance');
  const fxr = ctx.rng('fx');

  let now = 0;            // real seconds since init (cosmetic timers)
  let autoSpawn = !ctx.params.showcase;
  let handover = null;    // camera hand-over { x0, y0, t0, dur }
  let promptT = 0, barT = 0, jobT = 0, syncT = 0, spatialT = 0;
  let lastBarSig = '';
  const jobLabels = new Set();

  // ------------------------------------------------------------------ registry
  const byId = new Map();
  function index() { byId.clear(); for (const c of C.list) byId.set(c.id, c); }
  const get = (id) => byId.get(id) || null;
  const active = () => get(W.player.activeCharacterId);
  const farmhand = (c) => c.role === 'player' || c.role === 'hired';

  function runtime(c) {
    c.phase = c.phase || 0; c.walk = 0; c.speed = 0; c.running = false; c.action = null; c.cool = 0;
    c.lantern = false; c._g = null;
    if (c.stamina == null) c.stamina = 1;
    if (!c.tool) c.tool = c.role === 'villager' ? null : 'hoe';
    c.carry = c.role === 'villager' ? (c.appearance.carry || 'none') : null;
    return c;
  }

  function spawn(o = {}) {
    const role = o.role || 'hired';
    const used = new Set(C.list.map((c) => c.name));
    const appearance = o.appearance && o.appearance.skin ? { ...o.appearance }
      : makeAppearance(rngApp, role, ctx.palette, { sex: o.sex, age: o.age, appearance: o.appearance });
    const id = o.id || `characters:${C.nextId++}`;
    const c = runtime({
      id, name: o.name || pickName(rngApp, appearance.sex, used), role,
      x: +o.x || W.bounds.w / 2, y: +o.y || W.bounds.h / 2, rot: o.rot || 0,
      state: 'idle', vehicleId: null, task: o.task || { kind: 'idle' }, appearance,
      tool: o.tool, stamina: 1, home: o.home || { x: +o.x || 0, y: +o.y || 0, rot: o.rot || 0 },
      workerId: o.workerId || null, villager: o.villager || null, pace: o.pace || (role === 'villager' ? 0.78 + rngApp.range(0, 0.18) : 1),
      umbrella: o.umbrella || (role === 'villager' ? rngApp.pick(['#8a3a30', '#3f5f86', '#5d6b3a', '#c49a3c', '#3a3a40', '#6b4d7a']) : null),
    });
    C.list.push(c);
    byId.set(id, c);
    ctx.spatial.insert({ id, kind: 'character', x: c.x, y: c.y, r: 0.3, solid: false });
    if (role === 'player' && !W.player.activeCharacterId) setActive(id, true);
    ctx.events.emit('characters:spawned', { id, role, name: c.name, x: c.x, y: c.y });
    barT = 0;
    return id;
  }

  function despawn(id) {
    const i = C.list.findIndex((c) => c.id === id);
    if (i < 0) return false;
    C.list.splice(i, 1);
    byId.delete(id);
    ctx.spatial.remove(id);
    if (W.player.activeCharacterId === id) { W.player.activeCharacterId = null; const n = C.list.find(farmhand); if (n) setActive(n.id); }
    ctx.events.emit('characters:despawned', { id });
    barT = 0;
    return true;
  }

  // ------------------------------------------------------------------ possession / camera
  let driveZoom = null; // zoom before entering a vehicle (restored on exit)
  function restoreZoom() { if (driveZoom != null) { zoomBack = driveZoom; driveZoom = null; } }
  let zoomBack = null;
  // follow-camera zoom on foot (px/m). Set by demo (setFollowZoom) or adopted from the player's own wheel zoom.
  let followZoom = null;
  const clampZoom = (z) => Math.max(8, Math.min(80, +z));
  function setFollowZoom(z) {
    if (!Number.isFinite(+z)) return null;
    followZoom = clampZoom(z);
    const a = active();
    if (a && a.vehicleId) driveZoom = followZoom;   // driving zooms out relative to the new base
    else { zoomBack = null; ctx.camera.set(null, null, followZoom); }
    return followZoom;
  }
  function camTarget(c) {
    if (!c) return null;
    if (c.vehicleId) {
      const v = vehicleOf(c);
      if (v) {
        const sp = Math.abs(v.speed || 0), la = Math.min(14, sp * 1.1), a = v.rot || 0, dir = (v.speed || 0) < 0 ? -1 : 1;
        let ox = Math.sin(a) * la * dir, oy = -Math.cos(a) * la * dir;
        // keep the machine inside the central ~60 % of the screen, and never pushed down toward the
        // bottom HUD band (prompt / toolbar / vehicle card): a northward lead may only move it 10 % down
        const z = ctx.camera.zoom || 24, hw = (ctx.camera.w || 1280) / z, hh = (ctx.camera.h || 720) / z;
        ox = Math.max(-0.2 * hw, Math.min(0.2 * hw, ox));
        oy = Math.max(-0.1 * hh, Math.min(0.2 * hh, oy));
        return { x: v.x + ox, y: v.y + oy };
      }
    }
    return { x: c.x, y: c.y };
  }
  function follow() {
    ctx.camera.follow(() => {
      const c = active();
      const t = camTarget(c);
      if (!t) return null;
      if (handover) {
        const u = (now - handover.t0) / handover.dur;
        if (u >= 1) handover = null;
        else { const e = smooth(u); return { x: handover.x0 + (t.x - handover.x0) * e, y: handover.y0 + (t.y - handover.y0) * e }; }
      }
      return t;
    });
  }
  function setActive(id, silent = false) {
    const c = get(id);
    if (!c || !farmhand(c)) return false;
    const prev = active();
    if (prev && prev.id === id) return true;
    W.player.activeCharacterId = id;
    if (prev) { prev.action = null; prev.task = prev.task && prev.task.kind !== 'sleep' ? prev.task : { kind: 'idle', x: prev.x, y: prev.y, r: 2 }; if (prev.workerId) flushWork(prev); }
    if (c.state === 'sleeping' || c.state === 'inside') { c.state = 'idle'; if (c.task && c.task.kind === 'sleep') c.task = { kind: 'idle' }; }
    if (!(c.task && c.task.delegated)) c.task = { kind: 'idle', x: c.x, y: c.y, r: 2 };
    if (ctx.camera.following || !ctx.params.showcase) {
      const t = camTarget(c);
      const d = t ? Math.hypot(t.x - ctx.camera.x, t.y - ctx.camera.y) : 0;
      handover = { x0: ctx.camera.x, y0: ctx.camera.y, t0: now, dur: clamp(0.45 + d / 90, 0.45, 1.6) };
      follow();
    }
    barT = 0; promptT = 0;
    if (!silent) ctx.events.emit('characters:switched', { id, prev: prev ? prev.id : null });
    return true;
  }
  function cycle() {
    const hands = C.list.filter(farmhand);
    if (!hands.length) return null;
    const i = hands.findIndex((c) => c.id === W.player.activeCharacterId);
    const n = hands[(i + 1) % hands.length];
    setActive(n.id);
    return n.id;
  }

  // ------------------------------------------------------------------ vehicles (null-safe)
  function vehicleOf(c) {
    const veh = mod('vehicles');
    if (!veh || !c.vehicleId) return null;
    const v = veh.get(c.vehicleId);
    return v && typeof v === 'object' ? v : null;
  }
  function nearVehicle(c) {
    const veh = mod('vehicles');
    if (!veh || !veh.nearest) return null;
    let v = veh.nearest(c.x, c.y, 3, { free: true });
    if (typeof v === 'string') v = veh.get(v);
    if (!v || typeof v !== 'object' || v.driverId) return null;
    return v;
  }
  function toggleVehicle(c) {
    const veh = mod('vehicles');
    if (!veh) return false;
    if (c.vehicleId) {
      const vid = c.vehicleId;
      const r = veh.exit(vid);
      // null / blocked = refused (moving above 1 m/s or no free spot; vehicles shows the toast):
      // stay seated. Confirm with driverOf that the seat really is free before stepping out.
      if (!r || r.blocked || !Number.isFinite(r.x)) return false;
      const still = veh.driverOf ? veh.driverOf(vid) : null;
      if (still && still === c.id) return false;
      leaveVehicle(c, r.x, r.y);
      return true;
    }
    const v = nearVehicle(c);
    if (!v) return false;
    if (veh.enter(v.id, c.id) === false) return false;
    c.vehicleId = v.id; c.state = 'driving'; c.action = null; c.walk = 0; c.speed = 0; c._vehIdle = 0;
    if (c.id === W.player.activeCharacterId) promptT = 0;
    if (c.id === W.player.activeCharacterId && driveZoom == null) { driveZoom = followZoom != null ? followZoom : ctx.camera.zoom; handover = { x0: ctx.camera.x, y0: ctx.camera.y, t0: now, dur: 0.5 }; }
    return true;
  }
  function leaveVehicle(c, x, y) {
    if (!c.vehicleId) return;
    if (Number.isFinite(x)) { c.x = x; c.y = y; }
    c.vehicleId = null; c.state = 'idle'; c._vehIdle = 0; c._g = null;
    if (c.id === W.player.activeCharacterId) { restoreZoom(); toolbarSet = false; }
  }
  function vehicleLabel(v) {
    if (v.name && String(v.name).length < 28) return String(v.name);
    const veh = mod('vehicles');
    const T = veh && veh.types ? veh.types() : null;
    const t = T && (Array.isArray(T) ? T.find((q) => q && (q.id === v.type || q.type === v.type)) : T[v.type]);
    if (t && t.name) return String(t.name);
    const kind = v.kind || String(v.type || 'vehicle').split(/[_-]/)[0];
    return String(kind).replace(/[_-]/g, ' ');
  }

  // ------------------------------------------------------------------ jobs (presence)
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function homeBase() {
    const p = C.list.find((c) => c.role === 'player') || C.list[0];
    return p ? (p.home || p) : { x: W.bounds.w / 2, y: W.bounds.h / 2 };
  }
  function jobSite(jobId) {
    if (C.jobSites[jobId]) return C.jobSites[jobId];
    const sim = mod('simulation');
    const jobs = (sim && sim.jobs && sim.jobs((j) => j.id === jobId)) || [];
    const j = jobs[0];
    if (!j) return null;
    let site = null;
    if (Number.isFinite(j.x) && Number.isFinite(j.y)) site = { x: j.x, y: j.y };
    else if (j.to && Number.isFinite(j.to.x)) site = { x: j.to.x, y: j.to.y };
    if (!site && j.type === 'shopHelp') {
      const sps = (sim.sellPoints && sim.sellPoints()) || [];
      const sp = sps.find((s) => /shop|store|winkel|market|bakery/i.test(s.name || '')) || sps[0];
      if (sp && sp.x != null) site = { x: sp.x + 3, y: sp.y + 3 };
    }
    if (!site && j.type === 'animalCare') {
      const pens = (W.animals && W.animals.pens) || [];
      if (pens[0] && pens[0].trough) site = { x: pens[0].trough.x + 1.5, y: pens[0].trough.y };
    }
    if (!site && (j.type === 'villageWork' || j.type === 'shopHelp')) {
      const roads = mod('roads');
      if (roads && roads.junctions) {
        const nodes = new Map((roads.nodes() || []).map((n) => [n.id, n]));
        const vil = new Set((roads.edges() || []).filter((e) => e.class === 'village').flatMap((e) => [e.a, e.b]));
        const jn = (roads.junctions() || []).find((id) => vil.has(id));
        const n = jn && nodes.get(jn);
        if (n) site = { x: n.x + 6, y: n.y + 6 };
      }
    }
    if (!site) {
      const h = homeBase(), k = hash(jobId);
      const a = (k % 360) * Math.PI / 180, d = 14 + (k % 9);
      site = { x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d };
      const terrain = mod('terrain');
      if (terrain && terrain.findDry) { const p = terrain.findDry(site.x, site.y, 20); if (p) site = { x: p.x, y: p.y }; }
    }
    C.jobSites[jobId] = site;
    return site;
  }
  function presenceJobs() {
    const sim = mod('simulation');
    if (!sim || !sim.jobs) return [];
    return sim.jobs((j) => j.status === 'accepted' && PRESENCE[j.type]) || [];
  }
  let lastPresenceT = null;
  function tickJobs() {
    const sim = mod('simulation');
    const ui = mod('ui');
    const jobs = presenceJobs();
    const t = ctx.clock.t;
    const gdt = lastPresenceT == null ? 0 : Math.max(0, Math.min(3600, t - lastPresenceT));
    lastPresenceT = t;
    const seen = new Set();
    for (const j of jobs) {
      const site = jobSite(j.id);
      if (!site) continue;
      const here = C.list.filter((c) => farmhand(c) && !c.vehicleId && c.state !== 'sleeping' && c.state !== 'inside' && Math.hypot(c.x - site.x, c.y - site.y) < 7);
      let prog = j.progress || 0;
      const delegated = j.assignee && String(j.assignee).startsWith('simulation:worker:');
      if (!delegated && here.length && gdt > 0 && sim.tickPresence) {
        const r = sim.tickPresence(j.id, gdt * Math.min(1.6, 1 + 0.6 * (here.length - 1)));
        if (Number.isFinite(r)) prog = r;
      }
      const lid = 'characters:job:' + j.id;
      seen.add(lid);
      if (ui) {
        const pct = Math.floor(prog * 100);
        ui.worldLabel(lid, { x: site.x, y: site.y - 2.2, text: `${j.title || j.type} — ${pct}%${here.length ? ' · working' : ''}`, kind: 'job' });
        jobLabels.add(lid);
      }
    }
    for (const lid of [...jobLabels]) if (!seen.has(lid)) { if (ui) ui.removeWorldLabel(lid); jobLabels.delete(lid); }
  }
  function jobSiteNear(x, y, r) {
    for (const j of presenceJobs()) { const s = jobSite(j.id); if (s && Math.hypot(s.x - x, s.y - y) < r) return s; }
    return null;
  }

  // ------------------------------------------------------------------ steps: sound, prints, splashes
  function inView(x, y, m = 4) {
    const v = ctx.camera.view();
    return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  }
  function onStep(c, r) {
    if (!r || !r.stepped || !r.g) return;
    if (!inView(c.x, c.y, 6)) return;
    const g = r.g;
    const audio = mod('audio');
    const fx = mod('effects');
    const isActive = c.id === W.player.activeCharacterId;
    const snow = g.snow > 0.3;
    const fam = snow ? 'snow' : (g.road && g.road !== 'track' ? (g.road === 'lane' ? 'gravel' : 'asphalt') : (STEP_SOUND[g.surf] || 'grass'));
    if (audio && (isActive || fxr.chance(c.role === 'villager' ? 0.25 : 0.6))) {
      audio.play('footstep-' + fam, { x: c.x, y: c.y, volume: (c.running ? 0.95 : 0.6) * (isActive ? 1 : 0.6), pitch: 0.92 + fxr.range(0, 0.16) });
    }
    if (!fx) return;
    if (g.depth > 0.03) {
      fx.emit('ripple', c.x, c.y, { size: 0.3 });
      if (c.running || fxr.chance(0.4)) fx.emit('splash', c.x + Math.sin(c.rot) * 0.2, c.y - Math.cos(c.rot) * 0.2, { size: 0.35 });
      return;
    }
    // one print pair per full cycle on soft ground or snow
    const full = Math.floor(c.phase) !== c._lastPrint;
    if (full && (PRINTS[g.surf] || snow)) {
      c._lastPrint = Math.floor(c.phase);
      fx.decal('footprint', c.x, c.y, c.rot, { variant: Math.floor(c.phase) % 3, size: 0.95 });
    }
    if (snow && fxr.chance(0.5)) fx.emit('snowpuff', c.x, c.y, { count: c.running ? 3 : 1, size: 0.18, speed: 0.6 });
    else if (c.running && (g.surf === 'sand' || g.surf === 'farmyard' || g.road === 'lane' || g.road === 'track') && fxr.chance(0.5)) {
      fx.emit('dust', c.x, c.y + 0.1, { count: 1, size: 0.5, alpha: 0.3, speed: 0.3 });
    }
  }

  // ------------------------------------------------------------------ tools
  const S = { motion, onStep, get, active, jobSite, jobSiteNear, offscreen: (p) => !inView(p.x, p.y, 10) };
  const tools = createTools(ctx, S);
  function setTool(id, toolId) {
    const c = typeof id === 'object' && id ? id : get(id);
    if (!c || !TOOL[toolId]) return false;
    if (c.action && !c.action.frozen) { c._pendingTool = toolId; if (c.id === W.player.activeCharacterId) { const ui = mod('ui'); if (ui) ui.setActiveTool(toolId); } return true; }
    c.tool = toolId;
    if (c.id === W.player.activeCharacterId) { const ui = mod('ui'); if (ui) ui.setActiveTool(toolId); promptT = 0; }
    return true;
  }
  /** start a tool action; the effect lands at the impact moment of the animation */
  function useTool(idOrCh, o = {}) {
    const c = typeof idOrCh === 'object' && idOrCh ? idOrCh : get(idOrCh || W.player.activeCharacterId);
    if (!c || c.vehicleId || c.action || c.cool > 0 || c.state === 'sleeping') return false;
    const tool = c.tool || 'hand';
    const T = TOOL[tool] || TOOL.hand;
    const d = tools.describe(c, tool);
    if (!d.ok && !o.force && !o.mime && tool === 'hand') return false;
    if (c.stamina < T.stamina * 0.5 && !o.force && !o.mime) return false;
    c.action = { tool, t: 0, dur: T.dur, u: 0, fired: false, d, ok: o.mime ? false : (d.ok || !!o.force), mime: !!o.mime };
    c.stamina = Math.max(0, c.stamina - T.stamina);
    c.walk = 0;
    return true;
  }
  function tickAction(c, dt) {
    const a = c.action;
    if (!a) { if (c.cool > 0) c.cool -= dt; return; }
    if (a.frozen) { if (!(c.task && c.task.kind === 'hold')) c.action = null; return; }
    a.t += dt;
    a.u = Math.min(1, a.t / a.dur);
    const T = TOOL[a.tool] || TOOL.hand;
    if (!a.fired && a.u >= T.impact) {
      a.fired = true;
      if (a.ok) { a.d = tools.describe(c, a.tool); if (a.d.ok || a.tool !== 'hand') tools.apply(c, a.tool, a.d); }
      else if (!a.mime && (a.tool === 'hoe' || a.tool === 'fork')) { const fx = mod('effects'); if (fx) fx.emit('dust', a.d.target.fx, a.d.target.fy, { count: 1, size: 0.5, alpha: 0.3 }); }
    }
    if (a.u >= 1) {
      c.action = null; c.cool = T.cooldown;
      if (c._pendingTool) { const t = c._pendingTool; c._pendingTool = null; setTool(c, t); }
    }
  }

  const ai = createAI(ctx, { ...S, useTool, motion, onStep });

  // ------------------------------------------------------------------ player input
  let lastVehPress = 0;
  function controlActive(c, dt) {
    const input = ctx.input;
    for (let i = 0; i < TOOLS.length; i++) if (input.pressed('tool' + (i + 1))) setTool(c, TOOLS[i].id);
    const up = input.down('up'), dn = input.down('down'), lf = input.down('left'), rt = input.down('right');
    if (input.pressed('vehicle') && now - lastVehPress > 0.25) { lastVehPress = now; toggleVehicle(c); promptT = 0; }
    if (c.vehicleId) {
      const veh = mod('vehicles');
      const v = vehicleOf(c);
      if (!veh || !v) { c.vehicleId = null; c.state = 'idle'; return; }
      veh.control(c.vehicleId, {
        throttle: up ? 1 : 0, brake: dn ? 1 : 0, steer: (rt ? 1 : 0) - (lf ? 1 : 0),
        lights: input.pressed('lights') ? 'toggle' : undefined, implementDown: input.pressed('interact') ? 'toggle' : undefined,
      });
      c.x = v.x; c.y = v.y; c.rot = v.rot || 0;
      return;
    }
    if (input.pressed('interact')) useTool(c);
    let dx = (rt ? 1 : 0) - (lf ? 1 : 0), dy = (dn ? 1 : 0) - (up ? 1 : 0);
    // the tool swing roots the feet until the follow-through
    if (c.action && c.action.u < 0.8) { dx = 0; dy = 0; }
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    const wantRun = input.down('run') && c.stamina > 0.06 && (dx || dy);
    const r = motion.step(c, dx, dy, wantRun, dt, now);
    onStep(c, r);
    c.state = c.action ? 'working' : r.moved > 0.001 ? (c.running ? 'running' : 'walking') : 'idle';
    if (c.running) c.stamina = Math.max(0, c.stamina - dt * 0.035);
  }

  // ------------------------------------------------------------------ auto spawn (full game)
  function findSpot(x0, y0) {
    const terrain = mod('terrain');
    const roads = mod('roads');
    if (!terrain) return { x: x0, y: y0 };
    const base = terrain.findDry ? terrain.findDry(x0, y0, 120) || { x: x0, y: y0 } : { x: x0, y: y0 };
    const ok = (x, y) => {
      const s = terrain.surfaceAt(x, y);
      if (s === 'water' || s === 'shallow' || s === 'mud' || s === 'rock') return false;
      if ((terrain.slopeAt(x, y) || 0) > 0.07) return false;
      if (roads && roads.roadAt && roads.roadAt(x, y)) return false;
      for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) { const t = terrain.surfaceAt(x + dx, y + dy); if (t === 'water' || t === 'shallow') return false; }
      return true;
    };
    for (let r = 0; r < 90; r += 3) {
      const n = Math.max(1, Math.round(r * 1.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.37;
        const x = base.x + Math.cos(a) * r, y = base.y + Math.sin(a) * r;
        if (ok(x, y)) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
      }
    }
    return base;
  }
  function doAutoSpawn() {
    autoSpawn = false;
    if (C.list.some(farmhand)) return;
    const p = findSpot(W.bounds.w / 2, W.bounds.h / 2);
    const pid = spawn({ role: 'player', name: 'You', x: p.x, y: p.y, rot: 0, tool: 'hoe', sex: 'm', age: 'adult' });
    setActive(pid, true);
    hire({ x: p.x + 2.6, y: p.y + 1.1, rot: -0.6 });
    if (!ctx.params.cam) ctx.camera.set(p.x, p.y, followZoom != null ? followZoom : Math.max(ctx.camera.zoom, 46));
    handover = null;
    follow();
  }
  /** hire a farmhand: simulation.hireWorker (wages) when available, then a character for it */
  function hire(o = {}) {
    const sim = mod('simulation');
    let w = null;
    if (sim && sim.hireWorker && !o.noWage) w = sim.hireWorker(o.name);
    const home = homeBase();
    const x = o.x != null ? o.x : home.x + 3, y = o.y != null ? o.y : home.y + 2;
    return spawn({ role: 'hired', name: (w && w.name) || o.name, workerId: w ? w.id : null, x, y, rot: o.rot || 0, tool: o.tool || 'hoe', task: o.task || { kind: 'idle', x, y, r: 4 } });
  }
  function syncWorkers() {
    const sim = mod('simulation');
    if (!sim || !sim.workers) return;
    const ws = sim.workers() || [];
    const have = new Set(C.list.map((c) => c.workerId).filter(Boolean));
    // link hired characters that have no worker record yet (spawned directly, older saves) by name, then in order
    for (const pass of [0, 1]) {
      for (const c of C.list) {
        if (c.role !== 'hired' || c.workerId) continue;
        const w = ws.find((q) => !have.has(q.id) && (pass === 1 || q.name === c.name));
        if (w) { c.workerId = w.id; have.add(w.id); barT = 0; }
      }
    }
    for (const w of ws) {
      if (have.has(w.id)) continue;
      const h = homeBase();
      const n = C.list.filter((c) => c.role === 'hired').length;
      spawn({ role: 'hired', name: w.name, workerId: w.id, x: h.x + 2 + (n % 3) * 1.4, y: h.y + 2.5 + Math.floor(n / 3) * 1.4, tool: 'hoe' });
    }
    // fired workers leave
    const ids = new Set(ws.map((w) => w.id));
    for (const c of C.list.slice()) if (c.role === 'hired' && c.workerId && !ids.has(c.workerId)) despawn(c.id);
  }

  // ------------------------------------------------------------------ villagers
  function villagers(count = 8, area = null) {
    const ids = [];
    const roads = mod('roads');
    const A = area ? { x0: area.x0 != null ? area.x0 : area.x - (area.r || 60), y0: area.y0 != null ? area.y0 : area.y - (area.r || 60), x1: area.x1 != null ? area.x1 : area.x + (area.r || 60), y1: area.y1 != null ? area.y1 : area.y + (area.r || 60) } : null;
    const G = ai.roadGraph();
    const edges = G ? G.edges.filter((e) => !A || e.points.some((p) => p[0] > A.x0 && p[0] < A.x1 && p[1] > A.y0 && p[1] < A.y1)) : [];
    const r = ctx.rng('villagers:' + C.nextId);
    for (let i = 0; i < count; i++) {
      let x, y, rot = 0, home;
      const side = r.chance(0.5) ? 1 : -1;
      if (edges.length && roads) {
        const e = r.pick(edges);
        const inside = A ? e.points.map((q, i) => i).filter((i) => { const q = e.points[i]; return q[0] > A.x0 && q[0] < A.x1 && q[1] > A.y0 && q[1] < A.y1; }) : [];
        const k = inside.length ? r.pick(inside) : r.int(0, e.points.length - 1);
        const p = e.points[k], q = e.points[Math.min(e.points.length - 1, k + 1)], o = e.points[Math.max(0, k - 1)];
        let tx = q[0] - o[0], ty = q[1] - o[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const off = (e.width || 6) / 2 + 0.95;
        x = p[0] - ty * off * side; y = p[1] + tx * off * side; rot = Math.atan2(tx * side, -ty * side);
        const hoff = off + 5 + r.range(0, 4);
        home = { x: p[0] - ty * hoff * side, y: p[1] + tx * hoff * side };
      } else {
        const B = A || { x0: W.bounds.w / 2 - 40, y0: W.bounds.h / 2 - 40, x1: W.bounds.w / 2 + 40, y1: W.bounds.h / 2 + 40 };
        x = B.x0 + r.float() * (B.x1 - B.x0); y = B.y0 + r.float() * (B.y1 - B.y0); rot = r.float() * 6.28;
        home = { x, y };
      }
      ids.push(spawn({ role: 'villager', x, y, rot, home, villager: { area: A, side, useRoads: true } }));
    }
    return ids;
  }

  // ------------------------------------------------------------------ separation
  function separate(dt) {
    const L = C.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.vehicleId || a.state === 'inside' || a.state === 'sleeping') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.vehicleId || b.state === 'inside' || b.state === 'sleeping') continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > 0.62 || dx < -0.62 || dy > 0.62 || dy < -0.62) continue;
        const d = Math.hypot(dx, dy);
        if (d >= 0.62 || d < 1e-4) continue;
        const push = (0.62 - d) * Math.min(1, dt * 8);
        const ux = dx / d, uy = dy / d;
        const aw = a.id === W.player.activeCharacterId ? 0.15 : 0.5, bw = b.id === W.player.activeCharacterId ? 0.15 : 0.5;
        a.x -= ux * push * aw; a.y -= uy * push * aw;
        b.x += ux * push * bw; b.y += uy * push * bw;
      }
    }
  }

  // ------------------------------------------------------------------ prompt + portrait bar
  function updatePrompt() {
    const ui = mod('ui');
    if (!ui) return;
    const c = active();
    if (!c) { ui.setPrompt(null); return; }
    let text = null;
    if (c.vehicleId) { const v = vehicleOf(c); text = v && Math.abs(v.speed || 0) > 1 ? 'Stop to get out' : 'F — Get out'; }
    else {
      const v = nearVehicle(c);
      if (v) text = `F — Enter ${vehicleLabel(v)}`;
      else {
        const js = jobSiteNear(c.x, c.y, 7);
        const d = tools.describe(c, c.tool || 'hand');
        c._desc = d;
        if (d.text && (!js || (d.ok && c.tool === 'hand'))) text = d.text;
        else if (js) {
          const j = presenceJobs().find((q) => { const s = jobSite(q.id); return s && Math.hypot(s.x - c.x, s.y - c.y) < 7; });
          text = j ? `On the job: ${j.title || j.type} (${Math.floor((j.progress || 0) * 100)}%)` : null;
        }
      }
    }
    ui.setPrompt(text);
  }
  const STATUS = {
    sleeping: ['moon', 'Asleep'], inside: ['moon', 'Indoors'], driving: ['tractor', 'Driving'], working: ['hoe', 'Working'],
    walking: ['person', 'Walking'], running: ['person', 'Running'], idle: [null, 'Idle'], resting: ['clock', 'Resting'],
  };
  function updateBar() {
    const ui = mod('ui');
    if (!ui) return;
    const hands = C.list.filter(farmhand);
    const list = hands.map((c) => {
      const st = STATUS[c.state] || STATUS.idle;
      let icon = st[0], text = st[1];
      if (c.state === 'working') { const T = TOOL[c.tool]; icon = T ? T.icon : 'hand'; text = c.task && c.task.jobId ? 'On a job' : 'Working the ground'; }
      if (c.task && c.task.kind === 'follow' && c.id !== W.player.activeCharacterId) { icon = 'person'; text = 'Following'; }
      if (c.task && c.task.delegated && c.id !== W.player.activeCharacterId && c.state !== 'sleeping') { icon = 'jobs'; text = 'On a job'; }
      return { id: c.id, name: c.name, ...portraitOf(c.appearance), status: icon, statusText: `${text} · stamina ${Math.round(c.stamina * 100)}%` };
    });
    const sig = JSON.stringify([W.player.activeCharacterId, list.map((l) => [l.id, l.name, l.status, l.statusText.replace(/\d+%$/, (m) => String(Math.round(parseInt(m, 10) / 10)))])]);
    if (sig === lastBarSig) return;
    lastBarSig = sig;
    ui.setCharacters(list, W.player.activeCharacterId, (id) => setActive(id));
    const a = active();
    if (a && a.tool) ui.setActiveTool(a.tool);
  }
  let toolbarSet = false;
  let toolbarHidden = false;
  function ensureToolbar() {
    const ui = mod('ui');
    if (!ui || !active()) return;
    if (active().vehicleId) { if (!toolbarHidden) { ui.setToolbar([]); toolbarHidden = true; toolbarSet = false; } return; }
    if (toolbarSet && !toolbarHidden) return;
    toolbarSet = true; toolbarHidden = false;
    ui.setToolbar(TOOLS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, hotkey: t.key, active: active().tool === t.id, onSelect: (item) => { const a = active(); if (a) setTool(a, item.id); } })));
  }

  /** 'hold' task: a frozen pose (showcase turnarounds, cut-scenes) */
  function applyHold(c) {
    const t = c.task;
    if (t.rot != null) c.rot = t.rot;
    c.walk = t.walk || 0; c.phase = t.phase || 0; c.running = !!t.running; c.speed = 0;
    if (t.action) {
      if (!c.action || !c.action.frozen) c.action = { tool: t.action.tool, t: 0, dur: 1, u: t.action.u, fired: true, frozen: true, d: tools.describe(c, t.action.tool), ok: true };
      c.state = 'working';
    } else c.state = c.walk > 0.3 ? 'walking' : 'idle';
  }

  // ------------------------------------------------------------------ update
  /** delegated jobs: a hand whose worker record is the assignee of an accepted job walks there and works */
  function syncDelegation() {
    const sim = mod('simulation');
    const jobs = (sim && sim.jobs && sim.jobs((j) => j.status === 'accepted' && j.assignee)) || [];
    for (const c of C.list) {
      if (c.role !== 'hired' || !c.workerId) continue;
      const j = jobs.find((q) => q.assignee === c.workerId || q.assignee === c.id);
      const t = c.task || {};
      if (t.kind === 'sleep' || c.state === 'sleeping' || c.state === 'inside') continue; // night: the job waits until morning
      if (j) {
        if (t.jobId === j.id) continue;
        const site = jobSite(j.id);
        if (!site) continue;
        if (!t.delegated) c._preJobTask = t.kind === 'sleep' ? null : t;
        c.task = { kind: 'work', jobId: j.id, delegated: true, x: site.x, y: site.y, r: 3, tool: JOB_TOOL[j.type] || 'hand', mime: true, pace: 2.2 };
        c._wp = null; c._wait = 0;
        if (c.state === 'sleeping' || c.state === 'inside') c.state = 'idle';
        barT = 0;
      } else if (t.delegated) {
        c.task = c._preJobTask && c._preJobTask.kind !== 'hold' ? c._preJobTask : { kind: 'idle' };
        if (c.task.kind === 'idle') { c.task = { kind: 'goto', x: c.home.x, y: c.home.y, run: true, then: { kind: 'idle' } }; }
        c._preJobTask = null; barT = 0;
      }
    }
  }
  /** r4.5: game-hours a hired hand spends active are logged to its worker record (wages from real activity).
   *  Delegated jobs are NOT logged here: simulation works them abstractly and logs those hours itself. */
  const LOG_STEP = 0.25; // game hours per logWork call
  function accrueWork(c, gdt) {
    if (c.role !== 'hired' || !c.workerId || !(gdt > 0)) return;
    const t = c.task || {};
    let kind = null;
    if (c.id === W.player.activeCharacterId) kind = 'possessed';
    else if (c.vehicleId) kind = 'task';
    else if (t.delegated) kind = null;
    else if (t.kind === 'work' || t.kind === 'goto') kind = 'task';
    if (!kind || c.state === 'sleeping' || c.state === 'inside') return;
    c._logAcc = (c._logAcc || 0) + gdt / 3600;
    c._logKind = kind;
    if (c._logAcc >= LOG_STEP) flushWork(c);
  }
  function flushWork(c) {
    const sim = mod('simulation');
    if (c._logAcc > 0 && sim && sim.logWork) sim.logWork(c.workerId, +c._logAcc.toFixed(4), c._logKind || 'task');
    c._logAcc = 0;
  }

  function update(dt) {
    now += dt;
    if (autoSpawn && !ctx.params.showcase) doAutoSpawn();
    // user pause (world.time.paused): nothing moves, no work is done. (clock.paused also includes the
    // showcase `frozen` flag, which must keep animating.)
    if (W.time.paused) {
      promptT -= dt; if (promptT <= 0) { promptT = 0.15; ensureToolbar(); updatePrompt(); }
      barT -= dt; if (barT <= 0) { barT = 0.5; updateBar(); }
      return;
    }
    const gdt = ctx.clock.paused ? 0 : dt * ctx.clock.scale;
    const env = W.environment || {};
    const dark = env.daylight != null ? env.daylight < 0.32 : (ctx.clock.timeOfDay > 20.5 || ctx.clock.timeOfDay < 6);
    if (ctx.input.pressed('switchChar')) cycle();
    const actId = W.player.activeCharacterId;
    const recover = (c, rate) => { c.stamina = Math.min(1, c.stamina + rate * dt); };
    for (const c of C.list) {
      tickAction(c, dt);
      if (c.task && c.task.kind === 'hold') {
        applyHold(c);
      } else if (c.id === actId) {
        controlActive(c, dt);
      } else if (c.vehicleId) {
        const v = vehicleOf(c);
        if (v) {
          c.x = v.x; c.y = v.y; c.rot = v.rot || 0;
          // a hand left alone in a machine gets out after 30 game minutes, or at night
          c._vehIdle = (c._vehIdle || 0) + gdt;
          c._exitTry = (c._exitTry || 0) - dt;
          if ((c._vehIdle > 1800 || isNightNow()) && farmhand(c) && c._exitTry <= 0) {
            c._exitTry = 1; // a refused exit (moving / boxed in) is retried about once a second
            if (toggleVehicle(c)) c.task = { kind: 'idle' };
          }
        } else { c.vehicleId = null; c.state = 'idle'; }
      } else if (c.role === 'villager') {
        ai.tickVillager(c, dt, now);
      } else {
        ai.tickFarmhand(c, dt, now);
      }
      // stamina: resting & sleeping recover
      if (c.state === 'sleeping' || c.state === 'inside') recover(c, 0.02);
      else if (!c.action && c.speed < 0.2) recover(c, 0.05);
      else if (!c.action && !c.running) recover(c, 0.018);
      accrueWork(c, gdt);
      c.lantern = dark && farmhand(c) && !c.vehicleId && c.state !== 'sleeping' && c.state !== 'inside';
    }
    separate(dt);
    // spatial sync (5 Hz) for picking by other modules
    spatialT -= dt;
    if (spatialT <= 0) {
      spatialT = 0.2;
      for (const c of C.list) ctx.spatial.update({ id: c.id, kind: 'character', x: c.x, y: c.y, r: 0.3, solid: false, data: { role: c.role } });
    }
    promptT -= dt; if (promptT <= 0) { promptT = 0.15; ensureToolbar(); updatePrompt(); }
    barT -= dt; if (barT <= 0) { barT = 0.5; updateBar(); }
    jobT -= dt; if (jobT <= 0) { jobT = 0.5; tickJobs(); }
    syncT -= dt; if (syncT <= 0) { syncT = 2; if (!ctx.params.showcase || C.syncWorkers) syncWorkers(); }
    delegT -= dt; if (delegT <= 0) { delegT = 1; syncDelegation(); }
  }
  let delegT = 0;
  const isNightNow = () => { const h = ctx.clock.timeOfDay; return h >= 21.75 || h < 6; };

  // ------------------------------------------------------------------ cosmetic per-frame
  function frame(dt) {
    if (!ctx.params.showcase) {
      const a = active();
      const k = 1 - Math.exp(-dt * 1.5);
      if (a && a.vehicleId && driveZoom != null) {
        const v = vehicleOf(a);
        const sp = v ? Math.abs(v.speed || 0) : 0;
        // zoom out with speed, relative to the on-foot zoom (−2.2 px/m per m/s at a 46 px/m base)
        const target = Math.max(driveZoom * 0.45, Math.min(driveZoom, driveZoom - sp * 2.2 * driveZoom / 46));
        ctx.camera.set(null, null, ctx.camera.zoom + (target - ctx.camera.zoom) * k);
      } else if (zoomBack != null) {
        const z = ctx.camera.zoom + (zoomBack - ctx.camera.zoom) * Math.min(1, k * 2);
        ctx.camera.set(null, null, z);
        if (Math.abs(z - zoomBack) < 0.3) { ctx.camera.set(null, null, zoomBack); zoomBack = null; }
      } else if (a && !a.vehicleId && followZoom != null && Math.abs(ctx.camera.zoom - followZoom) > 0.01) {
        followZoom = clampZoom(ctx.camera.zoom); // the player zoomed with the wheel: keep it as the new base
      }
    }
    const fx = mod('effects');
    if (!fx) return;
    for (const c of C.list) {
      const a = c.action;
      if (!a || a.tool !== 'water' || !(a.u > 0.3 && a.u < 0.82)) continue;
      c._pourT = (c._pourT || 0) - dt;
      if (c._pourT > 0) continue;
      c._pourT = 0.09;
      const tg = a.d && a.d.target;
      if (!tg || !inView(tg.fx, tg.fy)) continue;
      fx.emit('splash', tg.fx + fxr.range(-0.18, 0.18), tg.fy + fxr.range(-0.18, 0.18), { size: 0.22, alpha: 0.7 });
    }
  }

  // ------------------------------------------------------------------ rendering
  const tileSprite = () => art.sprite('chr:target', 44, 44, (g, w, h, rng) => {
    g.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      g.strokeStyle = k ? 'rgba(255,244,214,0.9)' : 'rgba(40,34,26,0.35)';
      g.lineWidth = k ? 1.6 : 3;
      const m = 5 + (k ? 0 : 0.5);
      const L = 10;
      for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
        g.beginPath();
        g.moveTo(x + sx * L + rng.range(-0.4, 0.4), y);
        g.quadraticCurveTo(x, y, x, y + sy * L + rng.range(-0.4, 0.4));
        g.stroke();
      }
    }
  });
  const lampSprite = () => art.sprite('chr:groundlamp', 20, 20, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#fff3cf'); gr.addColorStop(0.4, '#f0b85a'); gr.addColorStop(0.75, '#6b5a45'); gr.addColorStop(1, 'rgba(58,48,40,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3f3428'; g.lineWidth = 1.5; g.strokeRect(w / 2 - 4, h / 2 - 4, 8, 8);
  });

  function drawStream(g, c, P) {
    const a = c.action;
    if (!a || a.tool !== 'water' || !P || !P.spout || a.u < 0.24 || a.u > 0.86) return;
    const f = Math.min(1, (a.u - 0.24) / 0.08) * Math.min(1, (0.86 - a.u) / 0.06);
    g.save();
    g.translate(c.x, c.y); g.rotate(c.rot); g.scale(K, K);
    const sx = P.spout.x, sy = P.spout.y - P.lean;
    const tx = 0.04, ty = -(TOOL.water.reach / K) + 0.02;
    g.lineCap = 'round';
    g.strokeStyle = `rgba(214,232,240,${0.55 * f})`; g.lineWidth = 0.035;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + 0.02, sy - 0.35, tx, ty); g.stroke();
    g.strokeStyle = `rgba(255,255,255,${0.5 * f})`; g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + 0.02, sy - 0.35, tx, ty); g.stroke();
    g.fillStyle = `rgba(220,236,244,${0.7 * f})`;
    for (let i = 0; i < 7; i++) {
      const u = ((now * 3.1 + i / 7) % 1);
      const x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * (sx + 0.02) + u * u * tx + Math.sin(i * 7.1) * 0.03;
      const y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * (sy - 0.35) + u * u * ty;
      g.beginPath(); g.arc(x, y, 0.012, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  ctx.renderer.addCollector((view, F) => {
    const env = W.environment || {};
    const w = env.weather || {};
    const raining = (w.kind === 'rain' || w.kind === 'storm') && (w.intensity == null || w.intensity > 0.15);
    const live = view.zoom * (view.dpr || 1) * K >= 88;
    const flick = 0.9 + 0.1 * Math.sin(now * 13.7) * Math.sin(now * 7.3);
    for (const c of C.list) {
      if (c.vehicleId || c.state === 'inside') continue;
      if (c.x < view.x0 - 3 || c.x > view.x1 + 3 || c.y < view.y0 - 3 || c.y > view.y1 + 3) continue;
      if (c.state === 'sleeping') {
        const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
        F.shadow.box(c.x, c.y, 0.8 * K, 1.9 * K, c.rot, 0.22);
        F.object({ y: c.y - 0.4, draw: (g) => body.drawSleeper(g, c, parts, now) });
        // a little storm lantern beside the bedroll
        const lx = c.x + (cr * 0.62 - sr * -0.55) * K, ly = c.y + (sr * 0.62 + cr * -0.55) * K;
        F.object({ y: ly, draw: (g) => { const s = lampSprite(); g.drawImage(s, lx - 0.1, ly - 0.1, 0.2, 0.2); } });
        F.light({ x: lx, y: ly, radius: 3.2, color: [255, 184, 110], intensity: 0.55 * flick, glow: 0.5, glowRadius: 0.35 });
        continue;
      }
      const umb = c.umbrella && raining && c.role === 'villager';
      F.shadow.circle(c.x, c.y, 0.3 * K, 0, 1.75);
      if (umb) F.shadow.circle(c.x, c.y - 0.05, 0.5, 1.85, 1.95);
      F.object({
        y: c.y,
        draw: (g) => {
          const P = body.draw(g, c, now, live);
          if (P) drawStream(g, c, P);
          if (umb) { const u = parts.umbrella(c.umbrella); const s = u.width / SPPM * K; g.drawImage(u, c.x - s / 2, c.y - 0.05 - s / 2, s, s); }
        },
      });
      if (c.lantern) {
        const L = body.lanternWorld(c);
        F.light({ x: L.x, y: L.y, radius: 7.5, color: [255, 190, 118], intensity: 0.92 * flick, glow: 0.75, glowRadius: 0.55 });
      }
    }
  });

  // active ring, target tile, stamina — world-ui (never darkened)
  ctx.renderer.addLayer('world-ui', (g, view) => {
    const c = active();
    if (!c || c.vehicleId || c.state === 'sleeping') return;
    if (ctx.params.showcase && ctx.params.noring === '1') return;
    const ring = parts.ring();
    const s = ring.width / SPPM * K;
    g.globalAlpha = 0.55;
    g.save(); g.translate(c.x, c.y + 0.02); g.rotate(c.rot); g.drawImage(ring, -s / 2, -s / 2, s, s); g.restore();
    g.globalAlpha = 1;
    // stamina arc (only when spent)
    if (c.stamina < 0.985) {
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(40,34,26,0.35)'; g.lineWidth = 0.075;
      g.beginPath(); g.arc(c.x, c.y, 0.56 * K, Math.PI * 0.62, Math.PI * 1.38); g.stroke();
      g.strokeStyle = c.stamina < 0.2 ? 'rgba(214,106,74,0.95)' : 'rgba(236,208,120,0.95)'; g.lineWidth = 0.045;
      g.beginPath(); g.arc(c.x, c.y, 0.56 * K, Math.PI * 1.38 - Math.PI * 0.76 * c.stamina, Math.PI * 1.38); g.stroke();
    }
    // target tile for the current tool
    const d = c._desc;
    if (d && d.ok && c.tool && c.tool !== 'hand' && view.zoom >= 14 && !c.action) {
      const tg = d.target;
      const pulse = 0.65 + 0.25 * Math.sin(now * 4);
      g.globalAlpha = pulse;
      g.drawImage(tileSprite(), tg.x - 0.55, tg.y - 0.55, 1.1, 1.1);
      g.globalAlpha = 1;
    }
  }, 5);

  // sown / watered hand plots (only while no crops module owns fields)
  const seedSprite = (v) => art.sprite(`chr:sown:${v}`, 32, 32, (g, w, h, rng) => {
    for (let r = 0; r < 3; r++) {
      const y = 6 + r * 10 + rng.range(-1, 1);
      g.strokeStyle = 'rgba(52,38,28,0.55)'; g.lineWidth = 2.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(3, y); g.lineTo(w - 3, y + rng.range(-1, 1)); g.stroke();
      g.strokeStyle = 'rgba(190,160,120,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(3, y + 2); g.lineTo(w - 3, y + 2); g.stroke();
      for (let i = 0; i < 6; i++) { g.fillStyle = rng.pick(['#e6c860', '#d9b95c', '#c9a24a']); g.beginPath(); g.ellipse(4 + i * 4.6 + rng.range(-1, 1), y + rng.range(-0.8, 0.8), 1.1, 0.8, rng.float() * 3, 0, Math.PI * 2); g.fill(); }
    }
  });
  ctx.renderer.addLayer('ground-detail', (g, view) => {
    if (mod('crops')) return;
    const P = C.plots;
    for (const k in P) {
      const p = P[k];
      if (!p.sown) continue;
      const [cx, cy] = k.split(',').map(Number);
      if (cx + 1 < view.x0 || cx > view.x1 || cy + 1 < view.y0 || cy > view.y1) continue;
      const img = seedSprite((cx * 7 + cy * 3) & 3);
      g.save(); g.translate(cx + 0.5, cy + 0.5); g.rotate(Math.round((p.rot || 0) / (Math.PI / 2)) * (Math.PI / 2));
      g.drawImage(img, -0.48, -0.48, 0.96, 0.96); g.restore();
    }
  }, 20);

  ctx.events.on('vehicles:exited', (e) => {
    const c = e && (get(e.characterId) || C.list.find((q) => q.vehicleId === e.vehicleId || q.vehicleId === e.id));
    if (c && c.vehicleId) leaveVehicle(c, e.x, e.y);
  });
  const dropSite = (e) => {
    if (!e || !e.id) return;
    delete C.jobSites[e.id];
    for (const c of C.list) {
      if (!c.task || c.task.jobId !== e.id) continue;
      const prev = c._preJobTask && c._preJobTask.kind !== 'hold' && c._preJobTask.kind !== 'idle' ? c._preJobTask : null;
      c.task = prev || { kind: 'goto', x: c.home.x, y: c.home.y, run: true, then: { kind: 'idle' } };
      c._preJobTask = null; barT = 0;
    }
  };
  ctx.events.on('jobs:completed', dropSite);
  ctx.events.on('jobs:failed', dropSite);

  // ------------------------------------------------------------------ api
  const pub = (c) => c && { id: c.id, name: c.name, role: c.role, x: c.x, y: c.y, rot: c.rot, state: c.state, vehicleId: c.vehicleId, task: c.task ? { ...c.task, _spot: undefined } : null, appearance: c.appearance, tool: c.tool, stamina: c.stamina, workerId: c.workerId || null };
  const api = {
    spawn,
    despawn,
    list: (filter) => C.list.filter((c) => !filter || (typeof filter === 'string' ? c.role === filter : typeof filter === 'function' ? filter(c) : true)).map(pub),
    get: (id) => pub(get(id)),
    active: () => pub(active()),
    setActive: (id) => setActive(id),
    cycle,
    assignTask(id, task) {
      const c = get(id);
      if (!c || !task || !TASK_KINDS[task.kind]) return false;
      c.task = { ...task };
      if (c.state === 'sleeping' || c.state === 'inside') c.state = 'idle';
      if (task.kind === 'follow' && !task.targetId) c.task.targetId = W.player.activeCharacterId;
      if (task.tool && TOOL[task.tool]) c.tool = task.tool;
      c._wp = null; c._wait = 0;
      barT = 0;
      return true;
    },
    positionOf(id) {
      const c = get(id); if (!c) return null;
      const v = c.vehicleId ? vehicleOf(c) : null;
      return v ? { x: v.x, y: v.y, rot: v.rot || 0, vehicleId: c.vehicleId } : { x: c.x, y: c.y, rot: c.rot, vehicleId: null };
    },
    villagers,
    setAutoSpawn(v) { autoSpawn = !!v && !ctx.params.showcase; return autoSpawn; },
    hire,
    setTool: (id, tool) => setTool(id, tool),
    useTool: (id) => useTool(id),
    tools: () => TOOLS.map((t) => ({ ...t })),
    /** follow-camera zoom in px/m (clamped 8–80); driving zooms out relative to it. Returns the applied value. */
    setFollowZoom,
    /** r4.7: is the hand linked to this simulation worker awake and able to take a job? */
    isAvailable(workerId) {
      const c = C.list.find((q) => q.workerId === workerId || q.id === workerId);
      // r4c: not available while possessed by the player or driving a vehicle
      return !!c && c.id !== W.player.activeCharacterId && !c.vehicleId && c.state !== 'sleeping' && c.state !== 'inside' && !isNightNow();
    },
  };

  const S2 = { ctx, api, spawn, setActive, useTool, setTool, villagers, follow, parts, body, get, C, motion, internal: { get handover() { return handover; } }, setNow: (t) => { now = t; }, simulate: (dt) => update(dt) };
  INSTANCES.set(ctx, S2);

  return {
    api,
    update,
    frame,
    save() {
      return {
        v: 1, nextId: C.nextId, active: W.player.activeCharacterId, followZoom: driveZoom != null ? driveZoom : followZoom, plots: C.plots, jobSites: C.jobSites, autoSpawn,
        list: C.list.map((c) => { const o = {}; for (const k of SAVE_FIELDS) if (c[k] !== undefined) o[k] = c[k]; if (o.task) { o.task = { ...o.task }; delete o.task._spot; } return JSON.parse(JSON.stringify(o)); }),
      };
    },
    load(d) {
      if (!d || !Array.isArray(d.list)) return;
      for (const c of C.list) ctx.spatial.remove(c.id);
      C.list = d.list.map((o) => runtime({ ...o }));
      C.nextId = d.nextId || C.list.length + 1;
      C.plots = d.plots || {};
      C.jobSites = d.jobSites || {};
      autoSpawn = false;
      index();
      for (const c of C.list) ctx.spatial.insert({ id: c.id, kind: 'character', x: c.x, y: c.y, r: 0.3, solid: false });
      W.player.activeCharacterId = null;
      const a = d.active && get(d.active) ? d.active : (C.list.find(farmhand) || {}).id;
      if (a) setActive(a, true);
      lastBarSig = ''; barT = 0; toolbarSet = false;
      if (Number.isFinite(d.followZoom)) { driveZoom = null; zoomBack = null; setFollowZoom(d.followZoom); }
    },
    dispose() {
      const ui = mod('ui');
      if (ui) { ui.setPrompt(null); for (const l of jobLabels) ui.removeWorldLabel(l); }
      for (const c of C.list) ctx.spatial.remove(c.id);
    },
  };
}

export const showcase = {
  deps: ['terrain', 'environment', 'roads', 'effects', 'audio', 'ui', 'simulation'],
  presets,
  async stage(ctx, presetName) {
    const S = INSTANCES.get(ctx);
    if (!S) return;
    await stage(ctx, presetName, S);
  },
};
