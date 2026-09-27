# effects

Pooled painted particles, baked ground decals, continuous tyre/furrow trails and the ambient
life director (fireflies, butterflies, falling leaves, bird flocks, rain splashes/ripples).
Wave 1. Hard deps: none. Optional deps: `environment` (weather, wind via `windAt`, daylight),
`terrain` (`surfaceAt`, `isWater`). Everything tolerates both being absent.

Files: `index.js` (manifest, API, director, render hooks), `particles.js` (SoA pool + type table),
`decals.js` (decals baked into tile canvases, trail ribbons), `sprites.js` (all painted sprites),
`showcase.js` (own painted farm backdrop + staged scenes).

## API (`ctx.modules.get('effects')`)
Units: metres, radians (0 = north, clockwise), real seconds for particles, game seconds for decals/trails.

| call | notes |
|------|-------|
| `emit(type, x, y, opts)` → count | one burst. `opts { count, dirX, dirY, speed (m/s), spread (half-angle rad), color (hex), size (diameter m), z (height m), vz, life (s), alpha, jitter (m), variant }` |
| `emitter(type, opts)` → handle | continuous; `opts` as `emit` plus `x, y, rate` (particles/s). Handle: `setPosition(x,y)`, `setRate(perSec)`, `setDir(dx,dy)`, `set(opts)`, `stop()`, `alive` |
| `decal(type, x, y, rot, opts)` → bool | `tyre`, `footprint`, `hoofprint`, `puddle`, `scorch`, `spill`. `opts { size, width, length, life (game s), alpha, color (spill), variant }`. Fades over game time; puddles scale with `weather.wetness`. |
| `trail(id, x, y, rot, width, type)` | call every step with the current contact point; `type` = `tyre` (default), `furrow`, `foot`, `track`. Ribbons fade over game time (tyre 5 h, furrow 12 h), darker/longer-lived in mud & wet, blue-grey with bright rim in snow, none on water (ribbon breaks). A jump > 4 m starts a new ribbon. |
| `endTrail(id)` | finish a ribbon (e.g. vehicle lifts implement) |
| `clear(type?)` | everything / one particle type / one decal type / `'trails'` |
| `count(type?)` | live particles |
| `types()` | particle type names |

Particle types: `dust exhaust chimney steam snowpuff spray splash ripple leaves petals chaff clods
sparkle fireflies butterflies birds`. Pool capacity 3000 (swap-remove, no per-particle allocation).

Layers: trails + baked decals + ripples/splashes/landed leaves in `ground-detail`; smoke, dust, chaff,
leaves, butterflies, birds in `overhead` (so they are darkened by the lighting pass); fireflies and
sparkles additive in `glow`. Height is conveyed by shadows: chimney plumes (faint, older puffs),
birds (bird-shaped), butterflies submit into the core shadow pass via `F.shadow.custom`.
Fireflies submit `F.light` (capped at 48).

## Ambient director (automatic, only within view)
- rain/storm: splashes on ground, ripples on water and inside puddle decals
- fireflies: summer (and May) nights near water/meadow, not in rain
- butterflies: sunny spring/summer days over grass/meadow
- leaves: autumn, rate grows with wind
- bird flocks: dawn/dusk every 14–30 s, rarely by day; they cross the whole view

Wind: `environment.windAt(view centre)` once per frame, else `weather.wind`, else a gentle default.

## World data
`world.effects = { maxParticles, particles }` (live count). No save state (cosmetic only).

## Showcase presets
`default` (May 10:00: tractor dust plume + exhaust + tyre trails, sprayer mist, chimney smoke,
footprints, hoofprints, puddles, blossom petals, butterflies, bird flock, pond glints),
`harvest` (Aug 16:30: combine chaff + dust, plough clods + furrow trails, grain spill),
`night` (Jul 22:30: fireflies, chimney smoke, window lights), `autumn` (Oct: wind-blown leaves,
bonfire scorch + smoke + embers), `rain` (splashes, pond + puddle ripples, idling tractor steam/exhaust),
`winter` (snow tyre tracks, snow puffs), `closeup` (60 px/m detail of dust/trails/puddles).
The showcase paints its own backdrop so it does not depend on terrain. Debug: `?fxoff=trails,decals,particles,backdrop,props`.

## Known limitations
- Per-frame cost is dominated by `drawImage` call count (~4–8 µs each headless); keep busy scenes
  to ~150 visible particles. Decals are baked, so they cost one blit per 32 m tile.
- Leaves in the full game spawn from the upwind view area (no tree sources until props offers them).
- Trail fading is quantised per chunk; decal tiles re-bake at most one per frame (fade steps of 10 game min).
- The showcase backdrop (painted tiles, simple tractor/combine/cottage) is a stand-in, not game art.
