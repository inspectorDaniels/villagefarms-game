// Boot: parse URL params, create core services, load modules in isolation,
// then start either a module showcase or the full game.
import { createWorld } from './world.js';
import { Clock } from './clock.js';
import { createRng, hashString } from './rng.js';
import { Noise2D } from './noise.js';
import { EventBus } from './events.js';
import { Health } from './health.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { Spatial } from './spatial.js';
import { createArt } from './art.js';
import { palette } from './palette.js';
import { Engine } from './engine.js';
import { MODULES } from '../modules/registry.js';

const INIT_TIMEOUT_MS = 15000;

function parseParams() {
  const q = new URLSearchParams(location.search);
  const p = {};
  for (const [k, v] of q) p[k] = v;
  return Object.freeze(p);
}

const G = (window.__GAME__ = {
  ready: false, fatal: null, bootMs: 0,
  stats: () => ({}), health: () => [], contracts: () => [], waitFrames: () => Promise.resolve(0),
});

function fatal(msg) {
  G.fatal = String(msg);
  console.error('[core] FATAL ' + msg);
  const el = document.getElementById('boot-msg');
  if (el) { el.textContent = 'Failed to start: ' + msg; el.style.display = 'block'; }
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[core] unhandled rejection: ' + (e.reason && e.reason.stack ? e.reason.stack.split('\n').slice(0, 3).join(' | ') : e.reason));
});

async function boot() {
  const t0 = performance.now();
  const params = parseParams();
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  const world = createWorld({ seed: params.seed || 'harvest-1' });
  const health = new Health();
  health.register('core', { status: 'core' });
  const bus = new EventBus(health);
  const clock = new Clock(world, bus);
  const camera = new Camera(world);
  const renderer = new Renderer(canvas, camera, health, world);
  const input = new Input(canvas, camera, health);
  const spatial = new Spatial();
  const art = createArt(world.seed);
  const clockView = clock.view();
  const camFacade = camera.facade();

  const manifests = new Map();   // id -> manifest
  const moduleDefs = new Map();  // id -> module namespace object
  const apis = new Map();        // id -> guarded api
  const instances = [];          // [{id, inst}] in init order
  const contractIssues = [];

  health.onDisable = (id) => {
    renderer.removeOwner(id);
    bus.emit('core:module-disabled', { id });
  };

  function guardApi(id, api) {
    const wrapped = {};
    if (!api || typeof api !== 'object') return wrapped;
    for (const key of Object.keys(api)) {
      const v = api[key];
      if (typeof v !== 'function') { Object.defineProperty(wrapped, key, { get: () => api[key], enumerable: true }); continue; }
      wrapped[key] = (...args) => {
        const r = health.guard(id, `api ${key}`, v, api, args);
        if (r && typeof r.then === 'function') {
          return r.catch((e) => { health.error(id, e, `api ${key} (async)`); return undefined; });
        }
        return r;
      };
    }
    return Object.freeze(wrapped);
  }

  function makeCtx(id) {
    return {
      id, world, params, palette, art, uiRoot,
      clock: clockView,
      rng: (stream = 'main') => createRng(world.seed, id, stream),
      noise: (stream = 'main') => new Noise2D(hashString(world.seed + ':' + id + ':noise:' + stream)),
      events: bus.scoped(id),
      renderer: renderer.scoped(id),
      camera: camFacade,
      input: input.scoped(id),
      spatial: spatial.scoped(id),
      modules: {
        get: (mid) => (apis.has(mid) && health.isActive(mid) ? apis.get(mid) : null),
        has: (mid) => apis.has(mid) && health.isActive(mid),
        list: () => [...apis.keys()],
      },
      log: (...a) => console.log(`[${id}]`, ...a),
      warn: (m) => health.warn(id, String(m)),
      error: (e, label = 'error') => health.error(id, e, label),
    };
  }

  async function importModule(id) {
    if (moduleDefs.has(id)) return moduleDefs.get(id);
    health.register(id);
    try {
      const mod = await import(`../modules/${id}/index.js`);
      if (!mod.manifest || mod.manifest.id !== id) throw new Error(`manifest missing or id mismatch in ${id}`);
      if (typeof mod.init !== 'function') throw new Error(`${id} does not export init()`);
      moduleDefs.set(id, mod);
      manifests.set(id, mod.manifest);
      bus.declare(id, mod.manifest.emits || []);
      return mod;
    } catch (e) {
      health.setStatus(id, 'failed', 'import: ' + (e && e.message));
      console.error(`[core] module ${id} failed to import: ${e && e.message}`);
      moduleDefs.set(id, null);
      return null;
    }
  }

  // ---- decide what to load
  const registryIds = MODULES.map((m) => m.id);
  let wanted;
  if (params.showcase && params.showcase !== 'core') {
    wanted = new Set();
    const visit = async (id, withShowcase) => {
      if (wanted.has(id)) return;
      wanted.add(id);
      const mod = await importModule(id);
      if (!mod) return;
      const deps = [...(mod.manifest.deps || [])];
      if (withShowcase && mod.showcase && mod.showcase.deps) deps.push(...mod.showcase.deps);
      for (const d of deps) await visit(d, false);
    };
    await visit(params.showcase, true);
  } else if (params.showcase === 'core') {
    wanted = new Set();
  } else {
    wanted = new Set(params.only ? params.only.split(',') : registryIds);
    for (const id of wanted) await importModule(id);
  }

  // ---- topological order (deps + optional deps that are present)
  const order = [];
  const state = new Map();
  const visitOrder = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { contractIssues.push(`dependency cycle at ${id}`); return; }
    state.set(id, 1);
    const m = manifests.get(id);
    if (m) for (const d of [...(m.deps || []), ...(m.optionalDeps || [])]) if (wanted.has(d)) visitOrder(d);
    state.set(id, 2);
    order.push(id);
  };
  for (const id of wanted) visitOrder(id);

  // ---- init in isolation
  for (const id of order) {
    const mod = moduleDefs.get(id);
    if (!mod) continue;
    const m = mod.manifest;
    const missing = (m.deps || []).filter((d) => !apis.has(d) || !health.isActive(d));
    if (missing.length) {
      health.setStatus(id, 'skipped', 'missing deps: ' + missing.join(','));
      console.warn(`[core] ${id} skipped, missing deps: ${missing.join(',')}`);
      continue;
    }
    for (const ns of m.namespaces || []) if (!(ns in world)) world[ns] = {};
    const ctx = makeCtx(id);
    health.setStatus(id, 'loading');
    try {
      const inst = await Promise.race([
        Promise.resolve().then(() => mod.init(ctx)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('init timeout')), INIT_TIMEOUT_MS)),
      ]);
      if (!inst || typeof inst !== 'object') throw new Error('init() must return an object { api, update?, frame? }');
      const api = inst.api || {};
      for (const name of m.api || []) {
        if (typeof api[name] !== 'function') contractIssues.push(`${id}: declared api "${name}" is not a function`);
      }
      for (const name of Object.keys(api)) {
        if (!(m.api || []).includes(name)) contractIssues.push(`${id}: api "${name}" not declared in manifest`);
      }
      apis.set(id, guardApi(id, api));
      instances.push({ id, inst, ctx });
      health.setStatus(id, 'ok');
    } catch (e) {
      health.setStatus(id, 'failed', 'init: ' + (e && e.message));
      health.error(id, e, 'init');
      renderer.removeOwner(id);
    }
  }

  // ---- clock / camera params
  if (params.freeze === '1') world.time.frozen = true;
  if (params.speed) world.time.scale = Number(params.speed) || 60;

  const engine = new Engine({ clock, camera, input, renderer, health, instances });

  // ---- start showcase or game
  const applyOverrides = () => {
    if (params.day) clock.setDayOfYear(Number(params.day));
    if (params.time) clock.set(params.time);
    if (params.cam) {
      const [x, y, z] = params.cam.split(',').map(Number);
      camera.follow(null);
      camera.set(x, y, z);
    }
  };

  if (params.showcase === 'core') {
    const { stageCoreSelftest } = await import('./selftest.js');
    stageCoreSelftest({ world, renderer, camera, clock, art, palette });
  } else if (params.showcase) {
    const id = params.showcase;
    const mod = moduleDefs.get(id);
    const entry = instances.find((i) => i.id === id);
    if (!mod || !entry) {
      fatal(`showcase module "${id}" is not available (${(health.get(id) || {}).reason || 'not loaded'})`);
    } else if (!mod.showcase || typeof mod.showcase.stage !== 'function') {
      contractIssues.push(`${id}: no showcase.stage()`);
    } else {
      const presets = mod.showcase.presets || {};
      for (const [name, p] of Object.entries(presets)) if (p.camera) camera.addPreset(name, p.camera);
      const pname = params.preset && presets[params.preset] ? params.preset : (presets.default ? 'default' : Object.keys(presets)[0]);
      if (params.preset && !presets[params.preset]) contractIssues.push(`${id}: unknown preset "${params.preset}"`);
      const p = presets[pname] || {};
      if (p.day != null) clock.setDayOfYear(p.day);
      if (p.time) clock.set(p.time);
      if (p.camera) camera.set(p.camera.x, p.camera.y, p.camera.zoom);
      try {
        await Promise.race([
          Promise.resolve().then(() => mod.showcase.stage(entry.ctx, pname)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stage timeout')), INIT_TIMEOUT_MS)),
        ]);
      } catch (e) {
        health.error(id, e, 'showcase.stage');
      }
      if (p.camera && !params.cam && !camera.following) camera.set(p.camera.x, p.camera.y, p.camera.zoom);
    }
  } else {
    const demo = apis.get('demo');
    if (demo && demo.startGame) {
      await demo.startGame();
    } else {
      renderer.overlay = (g, w, h) => {
        g.fillStyle = 'rgba(243,234,214,0.9)';
        g.font = '20px Georgia';
        g.textAlign = 'center';
        g.fillText('Demo module not built yet — use ?showcase=<module>', w / 2, h - 24);
      };
    }
  }
  applyOverrides();
  if (params.debug === '1') installDebugOverlay(renderer, health, engine, clock);

  // ---- expose
  G.world = world;
  G.clock = clockView;
  G.camera = camFacade;
  G.modules = apis;
  G.input = input;
  G.engine = engine;
  G.art = art;
  G.stats = () => ({ ...engine.stats(), art: art.stats(), time: clock.format(), day: clock.dayOfYear, season: clock.season });
  G.health = () => health.report();
  G.contracts = () => contractIssues.slice();
  G.events = () => Object.fromEntries(bus.counts);
  G.waitFrames = (n) => engine.waitFrames(n);
  G.setTime = (t) => clock.set(t);
  G.setCamera = (x, y, z) => { camera.follow(null); camera.set(x, y, z); };

  engine.start();
  await engine.waitFrames(3);
  G.bootMs = Math.round(performance.now() - t0);
  G.ready = true;
  bus.emit('core:ready', { bootMs: G.bootMs });
  const bm = document.getElementById('boot-msg');
  if (bm && !G.fatal) bm.style.display = 'none';
}

function installDebugOverlay(renderer, health, engine, clock) {
  renderer.overlay = (g) => {
    const s = engine.stats();
    const rep = health.report();
    const lines = [
      `${clock.format()} ${clock.season} d${clock.dayOfYear}  fps ${s.fps}  cpu ${s.frameMsAvg}ms p95 ${s.frameMsP95}  draws ${s.drawCalls}  obj ${s.objects} sh ${s.shadows} li ${s.lights}`,
      ...rep.map((r) => `${r.id.padEnd(12)} ${r.status.padEnd(8)} err ${r.errors}  ${r.msAvg}ms`),
    ];
    g.font = '12px Consolas, monospace';
    g.fillStyle = 'rgba(20,20,24,0.7)';
    g.fillRect(8, 8, 520, lines.length * 15 + 8);
    lines.forEach((l, i) => {
      const r = rep[i - 1];
      g.fillStyle = r && r.status !== 'ok' && r.status !== 'core' ? '#ff8a7a' : '#e8e2d0';
      g.fillText(l, 14, 24 + i * 15);
    });
  };
}

boot().catch((e) => fatal(e && e.stack ? e.stack : e));
