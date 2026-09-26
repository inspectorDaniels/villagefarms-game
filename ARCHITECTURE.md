# Harvest Valley — Architecture

A 2D top-down farming game. The player controls several farmhands (one at a time),
grows a farm from one rented field to a large estate, buys/rents land, upgrades
vehicles, takes paid contract jobs, and lives in a small valley with a village,
roads, light traffic and a full day/night + weather cycle.

Tech: vanilla ES modules, Canvas2D, no build step, no runtime dependencies.
Dev server: `npm run serve` → http://localhost:5173. Node 14 compatible tooling.

---

## 1. Folder layout

```
index.html                 entry; <canvas id="game"> + <div id="ui">
src/core/                  engine — OWNED BY THE INTEGRATOR ONLY
  boot.js                  URL params, module loading, showcase/game start, ready flag
  engine.js                main loop (fixed 60 Hz sim + per-frame render), stats
  world.js                 shared world data model + constants
  clock.js                 game time (day, hour, season, year)
  rng.js  noise.js         seeded RNG streams, seeded 2D noise / fbm
  events.js                event bus (guarded handlers)
  health.js                module isolation: guard(), error counting, disabling
  camera.js  input.js      camera (metres) and input (actions, mouse in world coords)
  renderer.js              layered renderer, y-sorted objects, shadow + lighting passes
  spatial.js               spatial hash for colliders / picking
  art.js  palette.js       sprite cache, painting helpers, the shared palette
src/modules/<id>/          one folder per subsystem, OWNED BY ITS BUILDER ONLY
  index.js                 exports manifest, init(ctx), showcase
  README.md                what it does, API, events, known issues
src/modules/registry.js    list of module ids in load order (integrator-owned)
tools/                     serve.js, shot.js, shots.js, lint.js  (integrator-owned)
docs/STATUS.json           scores, rounds, open issues per module (orchestrator)
docs/reviews/              critic reviews  <module>-r<N>.md
docs/core-requests/        builder → integrator change requests  <module>.md
shots/                     screenshot output (git-ignored)
```

### Modules and waves

| Wave | Module        | Owns (world namespaces)       | Purpose |
|------|---------------|-------------------------------|---------|
| 1 | `terrain`     | `terrain`                      | heightmap, ground types (grass, meadow, soil, sand, water, rock), rivers/pond, seasonal ground textures, chunked cached rendering |
| 1 | `environment` | `environment`                  | sun position (lat 51°N), ambient light colour, sky tint, weather (clear/cloudy/rain/fog/storm/snow), wind, cloud shadows, seasons visuals input |
| 1 | `roads`       | `roads`                        | road graph (lanes, widths, classes: asphalt, gravel, dirt track), markings, kerbs, intersections, street lights, `pathfind` over graph |
| 1 | `simulation`  | `economy`, `land`, `jobs`      | money, ledger, market prices (seasonal + supply/demand random walk), loans, land parcels (buy/rent/lease), paid contract jobs, wages, fuel & upkeep |
| 1 | `ui`          | `ui`                           | DOM HUD (money, date/time, weather), panels, toasts, toolbar, menus; other modules register panels via API |
| 1 | `audio`       | `audio`                        | procedural WebAudio: ambience (birds day / crickets night / rain / wind), engines, UI clicks, positional volume |
| 1 | `effects`     | `effects`                      | particles (dust, exhaust, rain splash, leaves, fireflies, chimney smoke), decals (tyre tracks), pooled |
| 2 | `crops`       | `crops`                        | field cells, soil states (stubble → ploughed → sown → growth stages → ripe → harvested → withered), 6+ crop types, yields, fertiliser, weeds |
| 2 | `buildings`   | `buildings`                    | farmhouse, barns, silos, sheds, greenhouse, village houses, shop, garage; roofs, windows lit at night, doors |
| 2 | `props`       | `props`                        | trees (seasonal), hedges, bushes, fences, stone walls, rocks, flowers, hay bales, crates, mailboxes, signs |
| 2 | `vehicles`    | `vehicles`                     | tractors (3 tiers), combine, pickup, trailer, implements (plough, seeder, sprayer), physics-lite driving, fuel, wear, headlights |
| 2 | `characters`  | `characters`, `player`         | multiple farmhands, walking, possession/switching (Tab), enter/exit vehicles (F), hand tools, idle AI for non-active characters |
| 2 | `animals`     | `animals`                      | chickens, cows, sheep, dog; pens, feeding, produce (eggs, milk, wool), wandering AI, sleep at night |
| 2 | `traffic`     | `traffic`                      | NPC cars/vans/tractors on the road graph, lane following, intersection yielding, headlights at night, density by time of day |
| 2 | `buildtools`  | `buildtools`                   | placement mode: fields, fences, buildings, paths; ghost preview, validity (collisions, land ownership), cost via simulation |
| 3 | `demo`        | `demo`                         | world composition: generates the valley via the other modules' public APIs, starting farm, village, the game flow |

Every module depends only on **core** plus the modules listed in its `manifest.deps`
(only lower-wave modules). Optional deps must be null-checked.

---

## 2. Module contract

Each `src/modules/<id>/index.js` exports exactly:

```js
export const manifest = {
  id: 'terrain',                 // == folder name
  wave: 1,
  deps: [],                      // hard deps: module fails to init if one is missing/failed
  optionalDeps: ['environment'], // may be absent → ctx.modules.get() returns null
  namespaces: ['terrain'],       // world keys this module OWNS (only it writes them)
  api: ['heightAt', 'surfaceAt', 'generate'],   // public function names (checked at load)
  emits: ['terrain:generated'],  // events it may emit (bus warns on undeclared)
  listens: ['env:season-changed'],
};

export async function init(ctx) {
  // build state in ctx.world.<namespace>, register layers/collectors/handlers
  return {
    api: { heightAt(x, y) {...}, surfaceAt(x, y) {...}, async generate(opts) {...} },
    update(dt) {},        // optional, fixed 60 Hz, dt = real seconds (1/60); game dt = dt * ctx.clock.scale
    frame(dt) {},         // optional, once per rendered frame (animation only, no sim state)
    save() {}, load(d) {},// optional persistence
    dispose() {},         // optional
  };
}

export const showcase = {
  deps: ['environment'],          // extra modules loaded ONLY for the showcase
  presets: {                      // camera presets, one per representative view
    default: { camera: { x: 64, y: 64, zoom: 24 }, time: '10:00' },
    closeup: { camera: { x: 60, y: 60, zoom: 64 }, time: '18:45' },
  },
  async stage(ctx, presetName) { /* build a small representative scene of JUST this module */ },
};
```

### The `ctx` a module receives (scoped to that module)

| field | description |
|-------|-------------|
| `ctx.id` | module id |
| `ctx.world` | the shared world data model (read anything, write only own namespaces) |
| `ctx.clock` | game time: `hour`, `minute`, `timeOfDay` (0..24 float), `day`, `dayOfYear`, `yearFrac`, `season`, `year`, `scale`, `paused`, `set('HH:MM')` |
| `ctx.rng(stream)` | seeded `Rng` for stream `<moduleId>:<stream>` — the ONLY randomness allowed |
| `ctx.noise(stream)` | seeded 2D gradient noise (`n.at(x,y)`, `n.fbm(x,y,oct)`) |
| `ctx.events` | `on(type, fn)`, `off`, `emit(type, payload)`; handlers are guarded |
| `ctx.renderer` | `addLayer(layer, drawFn, order?)`, `addCollector(fn)` (see §4) |
| `ctx.camera` | `x, y, zoom`, `worldToScreen`, `screenToWorld`, `view()`, `follow(fn)`, `setPreset` |
| `ctx.input` | `down(action)`, `pressed(action)`, `mouse {sx,sy,x,y,buttons}`, `on('click'|'wheel'|'key', fn)` |
| `ctx.spatial` | `insert(item)`, `update(item)`, `remove(id)`, `queryRect`, `queryCircle`, `queryPoint` |
| `ctx.art` | sprite cache & painting helpers (see §7) |
| `ctx.palette` | shared colour palette tokens |
| `ctx.modules.get(id)` | another module's **guarded** API, or `null` if absent/failed |
| `ctx.log/warn/error` | scoped logging (`error` counts against module health) |
| `ctx.params` | URL parameters (read-only) |
| `ctx.uiRoot` | the `#ui` DOM element (the `ui` module owns it; others use the ui API) |

### Isolation (one broken module never takes the game down)

* `boot` imports each module inside try/catch. A failed import/init marks the module
  `failed`; dependants of a failed hard dep are marked `skipped`; the game continues.
* Every call into a module (update, frame, layer draw, collector, event handler, input
  handler, API call from another module) goes through `health.guard(owner, …)`.
  Exceptions are caught, logged once per unique message via `console.error`
  (so the screenshot tool sees them) and counted.
* After 25 errors a module is **disabled**: its layers/collectors/handlers are skipped,
  its API calls return `undefined`, event `core:module-disabled` is emitted.
* API calls return `undefined` on error — callers must tolerate `undefined`/`null`.
* `g.save()/g.restore()` wraps each owner's drawing so canvas state can't leak.

---

## 3. Shared world data model

`src/core/world.js` creates:

```js
world = {
  version: 1,
  seed: 'harvest-1',               // string seed from ?seed=
  bounds: { w: 1024, h: 1024 },    // metres; origin top-left; x → east, y → south
  time: { t, scale, paused },      // t = game seconds since day 0 00:00 (see clock)
  // module-owned namespaces (created empty by core before init):
  terrain: {}, environment: {}, roads: {}, economy: {}, land: {}, jobs: {},
  ui: {}, audio: {}, effects: {}, crops: {}, buildings: {}, props: {},
  vehicles: {}, characters: {}, player: {}, animals: {}, traffic: {},
  buildtools: {}, demo: {},
}
```

Well-known shapes (owners must keep these fields; others rely on them):

* `world.environment.sun = { azimuth, elevation, dirX, dirY, shadowLen, shadowStrength, color:[r,g,b] }`
  — azimuth radians from north clockwise; `dirX,dirY` = unit vector shadows point along;
  `shadowLen` = metres of shadow per metre of height (1/tan(elevation), clamped ≤ 8).
* `world.environment.ambient = [r,g,b]` 0..255 multiply colour for the lighting pass
  (≈[255,255,255] noon, warm at dusk, ≈[38,48,92] night). `world.environment.daylight` 0..1.
* `world.environment.weather = { kind, intensity, cloudCover, wetness, wind:{x,y,speed}, fog }`
* `world.land.parcels = [{ id, poly:[[x,y]...], area, state:'owned'|'rented'|'forSale'|'npc', price, rentPerDay, soil }]`
* `world.economy = { money, ledger:[], prices:{ itemId: pricePerUnit } }`
* `world.player = { activeCharacterId }`
* entities inside namespaces all use `{ id, x, y, rot }` in metres/radians (`rot` 0 = facing north/up, clockwise).
* entity ids are strings `<module>:<n>`, allocated from a module-local counter (deterministic).

**Units:** metres, seconds, radians, money in € (float, displayed with 2 decimals),
mass kg, volume litres, area m² (UI shows hectares). 1 game day = 24 real minutes at
scale 60 (1 real s = 1 game min). Year = 12 months × 3 days = 36 days; season from month
(Mar–May spring, Jun–Aug summer, Sep–Nov autumn, Dec–Feb winter). Game starts on
dayOfYear 6 (1 March, month index 2), 07:00, year 1. `?day=N` overrides dayOfYear. Sun uses lat 51°N and `yearFrac`.

---

## 4. Rendering

All world drawing happens in **metre coordinates**: the renderer sets the transform so
`(x,y)` in metres maps to screen via the camera. Line widths are in metres.

Frame pipeline (`src/core/renderer.js`):

1. **collect** — every `addCollector(fn)` is called `fn(view, F)`; it submits:
   * `F.object({ y, draw(g) })` — y-sorted drawables (buildings, trees, vehicles, people…)
   * `F.shadow.box(cx, cy, w, h, rot, height)`, `F.shadow.circle(x, y, r, z0, z1)`,
     `F.shadow.poly(points, height)`, `F.shadow.custom(fn(g, sun))` — shadow casters
   * `F.light({ x, y, radius, color:[r,g,b], intensity, glow })` — point lights
2. layers `ground` → `ground-overlay` → `ground-detail`
3. **shadow pass** (core): casters projected along `sun.dir * height * shadowLen` into a
   half-resolution buffer (upscaling gives soft penumbra), composited once with
   `sun.shadowStrength` → overlapping shadows never double-darken. Fades out at sunset.
4. `objects` (y-sorted submissions) → layer `overhead` (canopies, wires, birds)
5. layer `weather`
6. **lighting pass** (core): half-res light buffer filled with `ambient`, point lights
   added (`lighter`), multiplied over the scene. Skipped when ambient is white and no lights.
7. layer `glow` (additive halos; auto glow for lights with `glow>0` at night)
8. layer `world-ui` (selection, placement ghosts — unaffected by darkness)
9. layer `screen` (screen-space, identity transform: vignette, rain streaks)
10. DOM UI (`#ui`)

`view = { x0, y0, x1, y1, zoom, w, h, time, dt }` (visible world rect in metres). Cull against it.

---

## 5. Determinism

* `Math.random`, `Date.now`, `performance.now` for gameplay are **forbidden** in modules
  (`npm run lint` greps for them). Use `ctx.rng(stream)`; streams are derived from
  `hash(world.seed + ':' + moduleId + ':' + stream)`.
* Simulation advances only in fixed 60 Hz `update(dt)` steps; `frame(dt)` is for
  cosmetics only. Same seed + same inputs ⇒ same world.
* Cosmetic randomness (particle jitter) still uses an rng stream (e.g. `ctx.rng('fx')`).

---

## 6. Performance budget (1600×900, mid laptop, headless numbers are indicative)

| item | budget |
|------|--------|
| frame CPU time (update + render), game scene | ≤ 12 ms avg, ≤ 20 ms p95 |
| per module per frame (health timings) | terrain ≤ 2 ms, any other ≤ 1.5 ms |
| canvas draw calls per frame | ≤ 2500 |
| load to ready | ≤ 6 s |
| JS heap | ≤ 350 MB |

Terrain and static art must be pre-rendered/cached (chunk canvases, sprite cache).
Everything must cull to `view`.

---

## 7. Asset & art policy — "never programmer art"

* **No external asset files, no network.** All art is painted procedurally at load into
  cached canvases via `ctx.art`, at `art.PPM = 32` pixels per metre, then drawn scaled.
* **One style:** "painted gouache, top-down orthographic". Soft organic edges, subtle
  noise/grain in every flat area (no flat fills larger than ~0.5 m), hand-drawn feel,
  darker *tinted* outline of the same hue (never pure black), gentle ambient-occlusion
  darkening where things meet the ground. Colour only from `palette.js` (tints/shades allowed).
* **No baked directional light** — the sun moves; directional shading comes from the
  core shadow pass. Only soft top-down form shading (ridges on roofs, crown volume on trees).
* Silhouettes must read at zoom 12 px/m and hold detail up to 64 px/m.
* Seasons: vegetation colours must respond to `ctx.clock.season`.
* Night: windows, street lights, headlights submit `F.light` so the night is alive.
* Audio: synthesised with WebAudio only; no samples.
* Fonts: system fonts only (`Georgia` headings, `Segoe UI`/system-ui body).

---

## 8. Events (namespaced `module:event`)

Core: `core:ready`, `core:module-failed`, `core:module-disabled`, `clock:hour`, `clock:day`,
`clock:season`. Module events are declared in manifests; notable ones:
`terrain:generated`, `env:weather-changed`, `roads:changed`, `economy:transaction`,
`land:parcel-changed`, `jobs:offered|accepted|completed|failed`, `crops:harvested`,
`buildings:placed`, `vehicles:entered|exited`, `characters:switched`, `animals:produced`,
`buildtools:placed`, `ui:action`.

---

## 9. Verification loop

* `?showcase=<id>&preset=<name>&time=HH:MM&seed=<s>&freeze=1&cam=x,y,zoom` loads just that
  module (+deps +`showcase.deps`) and stages its representative scene.
* No showcase param → full game (the `demo` module composes the world).
* `window.__GAME__ = { ready, fatal, stats(), health(), contracts(), waitFrames(n), world, modules }`.
* `node tools/shot.js --showcase terrain --preset default --time 18:30 --out shots/terrain/x`
  writes `x.png` + `x.json` (console errors, page errors, fps, frame ms avg/p95, draw calls,
  per-module ms, module statuses, contract report).
* `node tools/shots.js terrain` renders every preset × {07:00, 12:30, 19:30, 23:30}.
* **Rule:** nobody claims a visual result they have not screenshotted and looked at.

## 10. Process

* Builders own `src/modules/<id>/` only. Anything needed from core → `docs/core-requests/<id>.md`.
* Integrator (only agent allowed in `src/core`, `tools`, `registry.js`, `index.html`) applies
  requests between waves and fixes seams.
* Critic (writes no code) screenshots each module, checks contract/console/perf, scores 0–10.
  Pass = score ≥ 7, zero console errors, contract OK, within perf budget.
* `docs/STATUS.json` persists scores/rounds/issues; each iteration resumes from the weakest module.
