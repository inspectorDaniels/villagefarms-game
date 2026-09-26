# Brief: terrain (wave 1)

The ground of a 1024×1024 m temperate valley (think Flanders/Ardennes edge): gentle rolling
hills, a meandering river with a pond/lake, meadows, a few rocky outcrops, sandy banks.

## Data (`world.terrain`)
`{ w, h, cell: 1, height: Float32Array(w*h) metres, surface: Uint8Array(w*h) codes, moisture: Float32Array, rivers: [[[x,y],...]], lakes: [...], version }`
Surface codes (export a `SURFACE` table in README): grass, meadow, soil, ploughed, sand, gravel, rock, water, shallow, mud, farmyard (packed earth), forestFloor.

## Required API (exact names; downstream modules rely on them)
- `async generate(opts)` — `{ w=1024, h=1024, river=true, lakes=1, flatAreas:[{x,y,r}] }`; deterministic from world seed. Must be fast (< 1.5 s). Emits `terrain:generated`.
- `heightAt(x, y)` metres (bilinear) · `slopeAt(x, y)` (rise/run) · `surfaceAt(x, y)` → string name
- `isWater(x, y)` · `waterDepthAt(x, y)`
- `paintSurface(shape, type)` — shape `{poly:[[x,y]..]}` or `{x,y,r}`; used by crops (soil/ploughed), buildings (farmyard/gravel). Invalidates affected chunks. Emits `terrain:changed`.
- `flatten(shape, height?)` — levels ground under building plots.
- `riverPaths()` → polylines (so roads can place bridges) · `lakes()`.
- `findDry(x, y, radius)` → nearest dry point.
- `minimap(sizePx)` → a canvas painting the whole map (for the UI minimap).
- `surfaceTypes()` → the SURFACE table.

## Rendering
- Chunked cached canvases (e.g. 64 m chunks) with LOD by zoom (low res far, higher res close);
  LRU cache capped (≤ ~150 MB). Cull to view. Target ≤ 2 ms/frame when panning.
- Painted gouache look: blended noise colour fields, meadow patches, clover/flowers, subtle
  non-directional relief shading (valleys a touch darker/moister, ridges lighter/drier — no baked sun).
- Close-up (≥ 24 px/m): grass tufts, pebbles, small flowers as decals — never a flat fill.
- Water: depth-graded colour, animated shimmer/ripples (cheap), soft shoreline with wet sand band,
  foam line, reeds and lily pads in shallows. Water is on `ground` layer + animated `ground-detail`.
- Seasons via `ctx.clock.season` (spring fresh, summer deeper, autumn straw, winter drab + snow cover
  when `world.environment.weather.snowCover` > 0 if present). Wetness darkens soil when
  `world.environment.weather.wetness` is high (optional dep — tolerate absence).

## Showcase presets (≥ 3)
`default` (valley overview ~5 px/m), `river` (river bend with banks ~24 px/m), `closeup` (grass/soil detail ~56 px/m), plus one autumn/winter preset via `day`.
