# terrain

The ground of the 1024×1024 m valley: a heightmap with gentle rolling hills, a meandering river with
sandy/gravel/mud banks and reeds, a pond with lily pads, rock outcrops, meadows and forest-floor
patches. It is drawn as cached, chunked, LOD, painted-gouache tiles with animated water shimmer.

Files: `index.js` (manifest, API, layers, showcase), `gen.js` (data generation), `paint.js`
(seasonal LUTs, per-pixel ground shader, decal sprites), `tiles.js` (LOD tile cache and paint jobs).

## API (`ctx.modules.get('terrain')`)
Units are metres, with x east and y south.

| call | returns |
|------|---------|
| `async generate({ w=1024, h=1024, river=true, lakes=1, flatAreas:[{x,y,r,height?}] })` | `{w,h,rivers,lakes}`. Deterministic from `world.seed` (~1.2 s). Emits `terrain:generated`. It is also called once in `init()` with the defaults. |
| `heightAt(x,y)` | ground height in m (bilinear) |
| `slopeAt(x,y)` | rise/run (central difference over 2 m) |
| `surfaceAt(x,y)` | surface name (see SURFACE). It reports `water`/`shallow` from the real water depth. |
| `isWater(x,y)` | `true` if water depth > 2 cm |
| `waterDepthAt(x,y)` | m (0 on land) |
| `moistureAt(x,y)` | 0..1 (near water or in low ground → high) |
| `paintSurface(shape, type, opts?)` | Number of cells painted. `shape` = `{poly:[[x,y],...]}` or `{x,y,r}`. For `ploughed`, furrows run along `opts.angle` (radians); the default is the polygon's longest edge. Edges are drawn at sub-cell precision, not snapped to the 1 m grid. Emits `terrain:changed`. |
| `flatten(shape, height?)` | Target height. It levels the shape with a 4 m smooth falloff (polygon) or out to 1.7·r (circle). With no `height`, it uses the mean height. Emits `terrain:changed`. |
| `riverPaths()` | `[[[x, y, widthM], ...]]`, one polyline per river with a point every ~4 m. The third value is the full water width, for bridges. |
| `lakes()` | `[{id, x, y, r, level, depth, poly:[[x,y]...]}]` |
| `findDry(x, y, radius=64)` | `{x,y}` of the nearest dry point, or `null` |
| `minimap(sizePx=256)` | a cached canvas of the whole map (current season/snow) |
| `surfaceTypes()` | `[{name, code}]` |

### SURFACE table (`world.terrain.surface` codes)
| code | name | notes |
|---|---|---|
| 0 | grass | default lawn/pasture |
| 1 | meadow | taller grass, flower patches |
| 2 | soil | tilled/sown (paint only) |
| 3 | ploughed | furrows (paint only) |
| 4 | sand | river and pond beaches |
| 5 | gravel | river bars; paths (paint) |
| 6 | rock | hilltop outcrops |
| 7 | water | depth > 0.55 m |
| 8 | shallow | 0 < depth ≤ 0.55 m |
| 9 | mud | wet banks |
| 10 | farmyard | packed earth (paint only) |
| 11 | forestFloor | patches for the props module to plant woods on |

## Events
- `terrain:generated` `{w,h,rivers,lakes,version}`
- `terrain:changed` `{kind:'surface'|'height', x0,y0,x1,y1, version, type?|height?}`

## World data (`world.terrain`)
`{ w, h, cell:1, height:Float32Array, surface:Uint8Array, moisture:Float32Array, waterLevel:Float32Array
(-1000 where there is no water body), flags:Uint8Array (1 reed, 2 lily, 4 lake), rivers, lakes,
surfaceTypes, version }`. Arrays are row-major `y*w+x` and sampled at integer node coordinates.
Treat them as read-only and use the API to modify.

## Rendering
- **Tiles**: LOD levels of 2/4/8/16/32 px/m, chosen as the first level ≥ zoom/1.3. Tiles are 32 m at levels 16–32 and 512 px otherwise.
  - A 2 px shaded margin prevents seams.
  - The LRU cap is 150 MB.
  - Painting runs in generator jobs sliced into small steps, with a budget of ~12k px per frame (×3 while visible tiles are blank).
  - The 1-tile ring around the view is prefetched every frame while the camera moves and every 8th frame when it is idle.
  - Fallbacks while a tile paints: its stale version, then a coarser cached tile, then the 1 px/m overview.
- **Shader**, in painterly layers:
  - Seasonal colour gradients per surface, over broad value patches with soft posterisation.
  - Mottling, brush streaks and grain.
  - Warped soft surface boundaries.
  - Non-directional relief shading (curvature + slope; hollows darker, ridges lighter).
  - Moisture/dry tint and a macro hue drift.
  - Depth-graded water with a visible sandy bottom in the shallows, a broken foam line and a wet band above the waterline.
  - Snow cover with blue hollows and drift streaks.
- **Close-up decals** (≥16 px/m): brush dabs, grass tufts, flower patches, clover, clods, pebbles, leaves, twigs, moss, lichen and straw. Reeds and lily pads appear from 8 px/m.
- **Water**: two masked glint/ripple layers crossfaded and drifting on `ground-detail`. At night a faint additive moonlit glint is drawn on `glow`.
- **Weather** (optional environment dependency):
  - `weather.wetness` is applied as a live multiply overlay on `ground-overlay`, so tiles are not repainted.
  - `weather.snowCover` is quantised to 0.25 steps with hysteresis and triggers a tile repaint.
  - The season comes from `ctx.clock.season`.
- **Shadows**: reed clumps submit `F.shadow.circle` casters.
- A JIT warm-up runs the shader over a synthetic terrain at init, so V8 does not deoptimise on first contact with new branches.

## Showcase presets (default seed)
`default` (valley overview, 5 px/m) · `river` (river reach, 24 px/m, 17:00) · `closeup` (painted fields,
gravel strip and grass, 56 px/m) · `lake` (pond + river, 12 px/m, summer) · `autumn` (day 28) · `winter`
(day 1, snow). The stage paints a small demo farm with `paintSurface`/`flatten` and pre-paints the
first view, including a `?cam=` override.

## Known limitations
- `save()` returns null. Terrain regenerates from the seed and the owners of painted edits must re-apply them.
- Painting while panning fast at overview zoom shows the blurry 1 px/m fallback for a moment. Per-frame paint cost while panning is ~1.5–5 ms, above the 2 ms average budget during catch-up.
- There is a single river and no pond outflow stream. There are no river islands and no waterfalls or rapids.
- The pond does not freeze in winter.
- Rock outcrops are flat painted ground; boulders are the props module's job.
