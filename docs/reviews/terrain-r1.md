# terrain — review round 1
Score: 5/10   Pass: no
Screenshots examined:
- shots/terrain/review-r1/default_1230.png, river_1230.png, closeup_1230.png, autumn_1230.png, winter_1230.png, lake_2330.png (plus JSON for all 24 preset×time shots)
- shots/review/terrain-r1/game_z12_1230.png (full game, 540,500 @12), diag_river_z6.png (showcase, 322,300 @6)
- JSON only: shots/review/terrain-r1/{lake_settle300, river_settle300, diag_close_z24, diag_close_z12, diag_river_z12, diag_river_z56, river_rain, closeup_winter_snow}.json

Perf (headless, 4-core box under load avg ~4 from concurrent agents, so absolute ms are inflated but attribution is solid):
- Showcase presets: default/closeup frameMsAvg 1.3–2.4 ms. **river 30.8 ms (p95 39), lake 20.5 (p95 31), autumn 33 (p95 46), winter 19.6–32 ms**. drawCalls 17–98.
- Terrain `msAvg` in health **under-reports**: river preset shows terrain 0.35 ms while the frame is 31 ms. Canvas raster work is deferred and flushed later, in core passes. I attributed the cost by removing terrain's layers at runtime (scratch puppeteer script, no source edits):
  | scene | base frame | − shimmer/glow | − all terrain layers |
  |---|---|---|---|
  | showcase river @24 | 30.4 | 15.7 | 0.8 |
  | showcase lake @12 | 24.7 | 13.5 | 4.2 |
  | full game 322,300 @12 | 45.4 (p95 161) | 19.7 | 1.8 |
  | full game 392,757 @12 (terrain msAvg 39) | 30.7 | 18.1 | 1.7 |
  | full game 512,512 @6 (terrain msAvg 41) | 47.2 (p95 162) | 24.8 | 1.8 |
  | full game default cam | 13.0 | 12.5 | 8.7 |
  So **any view containing water at 6–24 px/m costs ~20–45 ms/frame for terrain alone, steady state with the camera idle**. That is 10–20× the 2 ms budget. Views without water (closeup @12/24/56) are fine at ~0.3 ms.
- Boot: 2.0–4.9 s typical. **7.4 s once for the full game at 322,300 @12**, which is over the 6 s budget. `generate()` alone takes 1.37–1.59 s (brief: < 1.5 s) and runs inside `init`.

Errors: 0 console/page errors in all 24 preset shots and all extras. The API probe did produce one console error (see Must fix 2).
Contract: 0 issues. The manifest `api` matches the README and the implementation. Only `terrain:generated` and `terrain:changed` are emitted, and both are declared. The module imports only from its own folder, writes only to `world.terrain`, and null-checks `environment`.
Lint: `lint OK`.
Determinism: the height and surface hashes are identical across two page loads and repeated `generate({})`, and they differ for `seed=other`. OK.

Functional API probe (21k-point grid plus targeted calls):
- `heightAt` values are finite everywhere and clamp out of bounds. Heights range 2–35 m and max slope is 0.85.
- `isWater` ⇔ `waterDepthAt > 0.02` holds with 0 mismatches.
- `riverPaths()` returns 1 river with 371 points `[x,y,width]`, and the midpoint is water at 1.82 m depth.
- `lakes()` returns 1 lake (r 30 m, depth 3 m), and its centre is water.
- `findDry` returns a dry point 7 m from mid-river, and `null` when the radius is too small.
- `paintSurface` (poly and circle), `flatten` (poly mean, circle explicit), `minimap` and `surfaceTypes` behave as documented.

## Verdict
Functionally this is a solid foundation. The data model is complete, the query API is correct and consistent, generation is deterministic, and the contract is clean. Gameplay modules can build on `heightAt/surfaceAt/isWater/findDry/paintSurface/flatten` today. It fails on performance, which is the one hard gate. Wherever the river or pond is on screen at normal play zooms (6–24 px/m), terrain drawing costs 20–45 ms/frame with an idle camera. The module's own health timing hides this, so the "~1 ms" full-game number is an artefact of a camera without water. Two API robustness holes would also hurt gameplay callers: a bad shape throws into the health counter, and painting onto water silently "succeeds". Visually it reads as a pleasant painted valley, with some blockiness at far zoom.

## Must fix (ordered, concrete, actionable)
1. **Water-view frame cost (20–45 ms → ≤ 2 ms).** Scenes: showcase `river`/`lake`/`autumn`/`winter`, full game `cam=322,300,12`, `cam=392,757,12` and `cam=512,512,6`. Roughly half the cost is the shimmer: two full-tile alpha `drawImage`s per wet tile on `ground-detail`, and two more on `glow` at night. The rest is the ground tile blits of wet tiles.
   - Draw shimmer only over the water bounding rect of each tile, using a source sub-rect cropped at paint time, not over the whole 32/64 m tile.
   - Use a single shimmer frame with a crossfaded offset, or update the shimmer at ≤ 15 Hz.
   - Skip shimmer entirely below ~8 px/m.
   - Make sure wet tiles are not re-uploaded every frame. Check that the tile and mask canvases are never read back or modified after commit.
   Re-measure with the layer-toggle method, because `health.msAvg` does not capture deferred raster cost. Measure the full game at `cam=322,300,{6,12,24}`, 12:30 and 23:30. Target a full frame ≤ 12 ms avg and ≤ 20 ms p95 with terrain ≤ 2 ms.
2. **`paintSurface` / `flatten` must not throw on a bad shape.** `paintSurface({foo:1}, 'soil')` throws from `shapeBBox`. That logs `console.error` and counts toward terrain's 25-error disable threshold, so one buggy caller loop could disable the ground for the whole game. Validate, `ctx.warn` once, and return `false`/`0` (or `undefined` for flatten), as the unknown-type branch already does. Also reject non-finite x/y/r and polygons with NaN points.
3. **`paintSurface` over water silently no-ops for gameplay.** Painting `gravel` over mid-river returns `28` cells and writes `surface=gravel`, but `surfaceAt`/`isWater` still say water (depth-derived), and the tiles repaint. Crops and buildtools will trust the return value. Either skip cells with depth > 0.02 and exclude them from the count, or document and return the painted-dry count. Then add the rule to the README.
4. **Boot/generate time.**
   - `generate()` takes 1.37–1.59 s (budget < 1.5 s).
   - `init()` already calls `generate({})`, so when `demo` calls `generate({flatAreas})` the valley is generated twice. The second call also wipes all earlier paints and flattens without a warning.
   - The full-game boot hit 7.4 s once (budget 6 s).
   Defer the init-time generate until first use, or let `demo` reuse the init result by applying `flatAreas` via `flatten`. Get `generate` under 1.5 s on this box. Document in the README that `generate` resets every edit.

## Should fix
- `surfaceAt` can return `'water'`/`'shallow'` where `isWater` is false: 4 of 21k samples at banks, where the stored code is water but depth ≤ 0.02. Fall through to the land code (e.g. mud or sand) so the two queries always agree.
- `waterDepthAt(NaN, y)` returns `NaN`. Guard non-finite input to return 0, and do the same in `heightAt`/`slopeAt`.
- `health.msAvg` blind spot: file a core-request so the integrator can attribute deferred canvas flushes. Otherwise every module's msAvg under-reports.
- The module-level `INST` singleton in `index.js` is shared state outside `ctx`. It only exists for the showcase, so keep it out of the gameplay path.
- Cosmetic, brief:
  - Stair-stepped 1 m-grid edges on the river banks at 5–6 px/m (`default_1230.png`, `diag_river_z6.png`) and on the forest-floor patch at z6.
  - Blocky meadow patches at night (`lake_2330.png`, top right).
  - Isolated green blotches in winter snow (`winter_1230.png`).
  - A faint horizontal light seam in `diag_river_z6.png` at around y=430, right half.
  - The pond does not freeze in winter.

## What works
- The full API surface exists and behaves correctly. Height, slope, water and depth queries are mutually consistent. `findDry`, `riverPaths` (with widths, useful for bridges), `lakes`, `minimap` and `surfaceTypes` all work.
- Generation is deterministic per seed and differs across seeds.
- There are zero console errors in every preset, time, season and weather tested, zero contract issues, and lint is clean.
- Views without water are cheap (0.3 ms). LOD tiles, prefetch and fallbacks work, and there are no blank tiles in any screenshot.
- Season, snow and wetness hooks respond, and water and banks read clearly for gameplay at 12–24 px/m.
