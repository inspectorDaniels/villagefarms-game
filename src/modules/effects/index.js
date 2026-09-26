// effects — pooled painted particles, ground decals, tyre/furrow trails and the ambient
// life director (fireflies, butterflies, falling leaves, bird flocks, rain splashes).
import { createSprites } from './sprites.js';
import { createParticles, TYPES, TYPE_NAMES, MAX_PARTICLES } from './particles.js';
import { createDecals } from './decals.js';
import { showcase as sc, installShowcaseHooks } from './showcase.js';

export const manifest = {
  id: 'effects',
  wave: 1,
  deps: [],
  optionalDeps: ['environment', 'terrain'],
  namespaces: ['effects'],
  api: ['emit', 'emitter', 'decal', 'trail', 'endTrail', 'clear', 'count', 'types'],
  emits: [],
  listens: [],
};

const DEFAULT_WIND = { x: 1.4, y: 0.5, speed: 1.5 };

export async function init(ctx) {
  const { world, art, palette, clock } = ctx;
  const rng = ctx.rng('fx');
  const env = () => world.environment || {};
  const sprites = createSprites(art, palette);
  const particles = createParticles({ rng, sprites, season: () => clock.season });

  // hooks the showcase can fill when terrain/environment are absent (never used when they exist)
  const hooks = { surfaceAt: null, isWater: null, weather: null, leafSources: null, fireflyZones: null, butterflyZones: null, fallbackNight: false };

  const terrain = () => ctx.modules.get('terrain');
  function surfaceAt(x, y) {
    const t = terrain();
    if (t && typeof t.surfaceAt === 'function') { const s = t.surfaceAt(x, y); if (s) return s; }
    return hooks.surfaceAt ? hooks.surfaceAt(x, y) : null;
  }
  function isWater(x, y) {
    const t = terrain();
    if (t && typeof t.isWater === 'function') { const w = t.isWater(x, y); if (w != null) return !!w; }
    if (hooks.isWater) return hooks.isWater(x, y);
    const s = surfaceAt(x, y);
    return s === 'water' || s === 'shallow';
  }
  function weather() {
    const w = env().weather;
    if (w && typeof w === 'object' && w.kind) return w;
    return hooks.weather || null;
  }
  function wind() {
    const w = weather();
    const wi = w && w.wind;
    if (wi && Number.isFinite(wi.x) && Number.isFinite(wi.y)) return wi;
    return DEFAULT_WIND;
  }
  function daylight() {
    const e = env();
    if (Number.isFinite(e.daylight)) return e.daylight;
    // fallback: rough sun model from the clock
    const tod = clock.timeOfDay;
    const elev = Math.sin(((tod - 6) / 12) * Math.PI) * 0.95;
    return Math.max(0, Math.min(1, elev * 4 + 0.25));
  }

  const decals = createDecals({ sprites, clockT: () => clock.t, surfaceAt, weather });

  // ---------------- emitters ----------------
  const emitters = [];
  function emitter(type, o) {
    o = Object.assign({}, o || {});
    if (!TYPES[type]) { ctx.warn(`emitter: unknown type "${type}"`); }
    const e = { type, x: o.x || 0, y: o.y || 0, rate: o.rate != null ? o.rate : 10, acc: 0, opts: o, alive: true };
    emitters.push(e);
    const h = {
      setPosition(x, y) { e.x = x; e.y = y; return h; },
      setRate(r) { e.rate = Math.max(0, +r || 0); return h; },
      setDir(dx, dy) { e.opts.dirX = dx; e.opts.dirY = dy; return h; },
      set(opts) { Object.assign(e.opts, opts || {}); return h; },
      stop() { e.alive = false; const i = emitters.indexOf(e); if (i >= 0) emitters.splice(i, 1); },
      get alive() { return e.alive; },
    };
    return h;
  }
  function runEmitters(dt) {
    for (let k = emitters.length - 1; k >= 0; k--) {
      const e = emitters[k];
      e.acc += e.rate * dt;
      let n = Math.floor(e.acc);
      if (n <= 0) continue;
      e.acc -= n;
      if (n > 40) n = 40;
      const per = e.opts.count || 1;
      const o = e.opts;
      const saved = o.count;
      o.count = per * n;
      particles.emit(e.type, e.x, e.y, o);
      o.count = saved;
    }
  }

  // ---------------- ambient director ----------------
  const dir = { birdTimer: 6, rainAcc: 0, leafAcc: 0, frame: 0, counts: new Map() };
  const AMB = { ambient: true };
  function countAmbient() {
    const P = particles.P;
    const c = dir.counts; c.clear();
    for (let i = 0; i < P.n; i++) {
      if (!(P.flags[i] & particles.F_AMBIENT)) continue;
      const t = P.type[i];
      c.set(t, (c.get(t) || 0) + 1);
    }
  }
  const tid = (n) => TYPE_NAMES.indexOf(n);
  const TID = { fireflies: tid('fireflies'), butterflies: tid('butterflies'), leaves: tid('leaves'), birds: tid('birds') };

  function pickIn(view, margin) {
    return [view.x0 - margin + rng.float() * (view.x1 - view.x0 + margin * 2), view.y0 - margin + rng.float() * (view.y1 - view.y0 + margin * 2)];
  }
  function inZones(zones, x, y) {
    for (const z of zones) if ((x - z.x) * (x - z.x) + (y - z.y) * (y - z.y) < z.r * z.r) return true;
    return false;
  }

  function director(dt, view) {
    if (dt <= 0) return;
    const area = Math.min(9000, (view.x1 - view.x0) * (view.y1 - view.y0));
    const season = clock.season;
    const day = daylight();
    const night = 1 - day;
    const w = weather() || { kind: 'clear', intensity: 0 };
    const wet = w.kind === 'rain' || w.kind === 'storm';
    const wi = wind();
    const windSpeed = Number.isFinite(wi.speed) ? wi.speed : Math.hypot(wi.x, wi.y);
    const tod = clock.timeOfDay;
    countAmbient();
    const have = (t) => dir.counts.get(t) || 0;

    // rain splashes / ripples, only within view and only when they'd be visible
    if (wet && view.zoom >= 8) {
      const inten = Number.isFinite(w.intensity) ? w.intensity : 0.6;
      dir.rainAcc += Math.min(260, area * 0.12 * (0.3 + inten)) * dt;
      let n = Math.min(40, Math.floor(dir.rainAcc));
      dir.rainAcc -= n;
      while (n-- > 0) {
        const x = view.x0 + rng.float() * (view.x1 - view.x0), y = view.y0 + rng.float() * (view.y1 - view.y0);
        if (isWater(x, y)) particles.emit('ripple', x, y, { count: 1, ambient: true });
        else particles.emit('splash', x, y, { count: 1, ambient: true });
      }
    }

    // fireflies: summer (and late spring) nights, near water / meadows
    if ((season === 'summer' || (season === 'spring' && clock.month === 4)) && night > 0.55 && !wet && view.zoom >= 6) {
      const target = Math.min(70, Math.round(area * 0.022));
      let tries = 6;
      while (have(TID.fireflies) < target && tries-- > 0) {
        const [x, y] = pickIn(view, 2);
        let ok;
        if (hooks.fireflyZones) ok = inZones(hooks.fireflyZones, x, y);
        else {
          const s = surfaceAt(x, y);
          ok = s == null || s === 'meadow' || s === 'grass' || s === 'shallow' || s === 'forestFloor'
            || isWater(x + 4, y) || isWater(x - 4, y) || isWater(x, y + 4) || isWater(x, y - 4);
          if (s === 'water') ok = false;
        }
        if (!ok) continue;
        particles.emit('fireflies', x, y, { count: 1, ambient: true });
        dir.counts.set(TID.fireflies, have(TID.fireflies) + 1);
      }
    }

    // butterflies: sunny spring/summer days over grass & meadow
    if ((season === 'spring' || season === 'summer') && day > 0.6 && !wet && w.kind !== 'fog' && windSpeed < 7 && view.zoom >= 8) {
      const target = Math.min(10, Math.round(area * 0.004));
      if (have(TID.butterflies) < target && rng.chance(dt * 2)) {
        const [x, y] = pickIn(view, -2);
        let ok;
        if (hooks.butterflyZones) ok = inZones(hooks.butterflyZones, x, y);
        else { const s = surfaceAt(x, y); ok = s == null || s === 'meadow' || s === 'grass'; }
        if (ok) particles.emit('butterflies', x, y, { count: 1, ambient: true });
      }
    }

    // autumn leaves drifting on the wind
    if (season === 'autumn' && view.zoom >= 6) {
      const target = 220;
      if (have(TID.leaves) < target) {
        const rate = Math.min(40, (0.6 + windSpeed * 0.5) * area * 0.003);
        dir.leafAcc += rate * dt;
        let n = Math.min(10, Math.floor(dir.leafAcc));
        dir.leafAcc -= n;
        while (n-- > 0) {
          let x, y, z;
          const src = hooks.leafSources;
          if (src && src.length) {
            const s = src[rng.int(0, src.length - 1)];
            const a = rng.float() * Math.PI * 2, r = Math.sqrt(rng.float()) * s.r;
            x = s.x + Math.cos(a) * r; y = s.y + Math.sin(a) * r; z = rng.range(2.5, s.h || 6);
          } else {
            [x, y] = pickIn(view, 4); z = rng.range(3, 8);
          }
          particles.emit('leaves', x, y, { count: 1, z, ambient: true });
        }
      }
    }

    // bird flocks at dawn and dusk (and occasionally by day)
    const dawn = tod > 5.2 && tod < 9, dusk = tod > 17 && tod < 20.8;
    if (!(w.kind === 'storm') && day > 0.15) {
      dir.birdTimer -= dt;
      if (dir.birdTimer <= 0) {
        dir.birdTimer = (dawn || dusk) ? rng.range(14, 30) : rng.range(50, 110);
        if (have(TID.birds) < 30) spawnFlock(view, rng.int(5, 11));
      }
    }
  }

  function spawnFlock(view, n, o) {
    o = o || {};
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    const rad = Math.hypot(view.x1 - view.x0, view.y1 - view.y0) / 2 + 12;
    const a = o.angle != null ? o.angle : rng.float() * Math.PI * 2;
    const dx = -Math.cos(a), dy = -Math.sin(a);
    const off = rng.range(-0.35, 0.35) * rad;
    const x = o.x != null ? o.x : cx + Math.cos(a) * rad - dy * off;
    const y = o.y != null ? o.y : cy + Math.sin(a) * rad + dx * off;
    const sp = o.speed || rng.range(8.5, 11);
    return particles.emit('birds', x, y, { count: n, dirX: o.dirX != null ? o.dirX : dx, dirY: o.dirY != null ? o.dirY : dy, speed: sp, z: o.z, life: (rad * 2 + 30) / sp, ambient: true });
  }

  // ---------------- render hooks ----------------
  let lastView = null;
  ctx.renderer.addCollector((view, F) => {
    lastView = view;
    let shadowCasters = false;
    const P = particles.P;
    for (let i = 0; i < P.n; i++) { if (TYPES[TYPE_NAMES[P.type[i]]].shadow) { shadowCasters = true; break; } }
    if (shadowCasters) F.shadow.custom((sg, sun, v) => particles.drawShadows(sg, sun, v || view));
    particles.lights(F, view, 1 - daylight(), 48);
  });
  // ?fxoff=trails,decals,particles,backdrop,props (debug: isolate costs)
  const off = new Set(String(ctx.params.fxoff || '').split(','));
  ctx.renderer.addLayer('ground-detail', (g, view) => {
    if (!off.has('trails')) decals.drawTrails(g, view);
    if (!off.has('decals')) decals.drawDecals(g, view);
    if (!off.has('particles')) particles.draw(g, view, 0, 1);
  }, 5);
  ctx.renderer.addLayer('overhead', (g, view) => { if (!off.has('particles')) particles.draw(g, view, 1, 1); }, 5);
  ctx.renderer.addLayer('glow', (g, view) => { if (!off.has('particles')) particles.draw(g, view, 2, 1 - daylight()); }, 5);

  const state = world.effects;
  state.maxParticles = MAX_PARTICLES;
  state.particles = 0;

  let frameNo = 0;
  function step(dt, view) {
    frameNo++;
    runEmitters(dt);
    if (view) director(dt, view);
    particles.update(dt, wind(), view, 30);
    decals.expire(frameNo % 60 === 0);
    state.particles = particles.P.n;
  }

  const api = {
    /** one burst. opts { count, dirX, dirY, speed, spread, color, size, z, vz, life, alpha } */
    emit(type, x, y, opts) { return particles.emit(type, x, y, opts); },
    /** continuous emitter handle { setPosition, setRate, setDir, set, stop } */
    emitter,
    /** ground decal: tyre | footprint | hoofprint | puddle | scorch | spill */
    decal(type, x, y, rot, opts) { const d = decals.decal(type, x, y, rot, opts); return d ? true : false; },
    /** continuous trail ribbon for entity `id`: call every frame/step with the current point */
    trail(id, x, y, rot, width, type) { decals.trail(id, x, y, rot, width, type); },
    /** end a trail ribbon (next trail() call starts a fresh ribbon) */
    endTrail(id) { decals.endTrail(id); },
    /** clear everything, one particle type, a decal type, or 'trails' */
    clear(type) {
      if (!type) { particles.clear(); decals.clear(); return; }
      if (TYPES[type]) particles.clear(type); else decals.clear(type);
    },
    /** live particle count (optionally of a type) */
    count(type) { return particles.count(type); },
    /** list of particle type names */
    types() { return TYPE_NAMES.slice(); },
  };

  const internal = { off, api, particles, decals, hooks, spawnFlock, step, sprites, daylight, weather, wind, get lastView() { return lastView; } };
  installShowcaseHooks(ctx, internal);

  return {
    api,
    frame(dt) {
      const view = ctx.camera.view();
      if (internal.showcaseFrame) internal.showcaseFrame(Math.min(dt, 0.1));
      step(Math.min(dt, 0.1), view);
    },
  };
}

export const showcase = sc;
