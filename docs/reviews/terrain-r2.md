# terrain — review round 2
Score: 7/10   Pass: yes
Screenshots examined:
- shots/terrain/review-r2/lake_1230.png, plus JSON for all 12 preset×time shots (default/river/closeup/lake/autumn/winter at 12:30 and 23:30)
- shots/review/terrain-r2/game_river_z6.png, game_river_z24.png, game_river_z12_2330.png (full game, cam 322,300), plus game_river_z12.json
- shots/review/terrain-r2/edits_hoe_settled.png (500 hoe strikes), edits_tractor_during.png, edits_tractor_settled.png (500 implement strips)

Perf: steady state in the full game at cam 322,300, with the river in view. Each row is an A/B in one page, measured over 150 frames. Values are CPU frame ms avg / p95. The last column is terrain's `health.msAvg`.

| zoom, time | on | fx off (`debug.fx=false`) | terrain layers removed | terrain msAvg |
|---|---|---|---|---|
| 6, 12:30 | 1.61 / 4.3 | 1.55 / 3.2 | 0.92 / 1.3 | 0.37 |
| 12, 12:30 | 1.56 / 2.5 | 1.36 / 2.2 | 1.03 / 1.3 | 0.41 |
| 24, 12:30 | 1.28 / 2.1 | 1.21 / 1.9 | 0.77 / 1.0 | 0.25 |
| 6, 23:30 | 1.33 / 2.3 | 1.24 / 2.1 | 0.88 / 1.1 | 0.33 |
| 12, 23:30 | 1.58 / 2.5 | 1.53 / 2.4 | 1.03 / 1.3 | 0.40 |
| 24, 23:30 | 1.41 / 2.5 | 1.38 / 2.9 | 0.86 / 1.2 | 0.27 |

- Terrain now costs about 0.4–0.7 ms of the frame with water in view. In round 1 it cost 20–45 ms, so the builder's "~2 ms full frame" claim holds.
- `tools/shot.js` reports higher numbers: 5.8–8.6 ms full game, 2–6 ms in the showcase, with terrain msAvg 5.3 at z6. Its 135-frame window includes the cold-start tile catch-up at triple budget. That transient runs about 2 s after boot and does not recur.
- Draw calls: 73–178 in the full game.
- Boot: 2.2–2.9 s on a quiet box and 3.3–4.2 s under load. One run reached 6.4 s while I had the 12-shot showcase batch running in parallel.
- `generate()`: a full pass takes 0.87–0.96 s. Repeating it with the same settings takes 0 ms. Applying `flatAreas` in place takes 36 ms, and the result is bit-identical (hash 3147531798) to a full regeneration with the same `flatAreas`. A regenerate after an edit warns "discards 1 earlier … edit(s)".
- Many small edits (full game, one `paintSurface` per frame for 500 frames, baseline 1.6–1.9 ms):
  - Hoe-sized cells (0.17 ms per call): 5.8 ms avg / p95 11 during the run, then 4.1 ms for about 150 frames of catch-up, then back to baseline.
  - Implement strips of 3 × 2.6 m: 6.1 ms avg / p95 9.3 during the run.
  - A burst of 500 calls in one frame costs 34–54 ms, one time only.
  - 5,000 more edits leave the JS heap at 41.7 → 42.9 MB and 42.9 → 43.9 MB after GC. There is no leak and terrain has no errors.
  - Real gameplay rates (one hoe strike per second, one tractor strip every ~0.5 s) are well below this stress rate.

Errors: 0 console or page errors in every run, including the full API abuse probe. The terrain health error count stayed at 0, and each distinct bad input produced exactly one `ctx.warn`.
Contract: 0 issues. The manifest, README and implementation match. The module emits only `terrain:generated` and `terrain:changed`.
Lint: `lint OK`.

## Round-1 must-fix verification
1. **Water-view frame cost: fixed.** See the table above. Shimmer is cropped to the water bounding box, baked at 8 px/m and skipped below 8 px/m. `?terrainfx=0` and `world.terrain.debug.fx` both work as A/B switches.
2. **paintSurface/flatten never throw: fixed.** I sent 17 bad shapes (null, string, number, `{foo}`, NaN, null and object points, two points, horizontal-degenerate, negative, zero and infinite r, string coordinates) to both functions. Each returned `0`/`undefined` with no error. Unknown or undefined type and `water` return `false`, and a NaN, string or Infinity `height` returns `undefined`. One gap remains: a collinear-but-diagonal polygon `[[0,0],[1,1],[2,2]]` passes validation, so paint returns 3 and flatten levels (see Should fix).
3. **Painting over water: fixed.** Mid-river `gravel` with r=2 returns 0 and the spot stays `water`. A half-bank circle returns 36, which exactly equals the 36 dry nodes inside it. No wet node became soil. The rule is documented in the README.
4. **Boot/generate: fixed.** There is no double generate, repeat calls are free, `flatAreas` are applied in place, full generation takes about 0.9 s, and boot is under 6 s except under heavy self-induced load.
- Should-fix items from round 1 are also fixed:
  - `surfaceAt`/`isWater` agree with 0 mismatches over 184,840 points, including dense bank and lake-rim sampling. All 38 `findDry` results along the river are dry.
  - NaN, Infinity, string and undefined input to every query returns a neutral value (0 / `grass` / `false` / 0.5 / `null`).

## Verdict
The ground no longer eats the frame. With the river in view at every play zoom, terrain now costs under a millisecond where it used to cost tens. The API has become a well-behaved dependency: bad input produces a warning instead of an exception, water is honestly excluded from painting, and height, water and surface queries all agree. Gameplay painting holds up under stress. Hoed plots look clean, 500 per-frame edits cause no leak and no stale tiles, and the frame returns to baseline once the catch-up repaint finishes. Two things let it down where gameplay touches it. Adjacent implement strips leave a grid of green seams in a ploughed field. A small circular edit centred between nodes paints nothing, which currently breaks the characters' fork-on-ploughed action. The painted valley itself remains pleasant and readable.

## Must fix
1. **Adjacent and overlapping `paintSurface` polygons leave grass seams.** See `edits_tractor_settled.png` and `edits_tractor_during.png`. Tiling 3 × 2.6 m ploughed strips with 0.2 m overlap, as the vehicles fallback path does (`src/modules/vehicles/index.js` `fallbackPaint`), leaves a regular grid of green ticks at every strip boundary and vertical green stripes along the last lane's edge. A player reads these as missed ground.
   - The cause is probably the single `T.pedge[o]` op index per node. The most recent op's sub-cell outline wins even when the node is inside the previous same-type op.
   - Suggested fix: when a node in the new op's edge band already carries the same surface code (painted by an earlier op), do not record an edge for it, or keep the edge of whichever op the node is inside.
   - Re-test: 500 abutting strips should give a seamless field.
2. **A small shape that contains no integer node paints nothing.** `paintSurface({x: X+0.5, y: Y+0.5, r: 0.62}, 'soil')` returned 0 in 200 of 200 tries. This is exactly what characters' fork on ploughed ground sends (`src/modules/characters/tools.js`, `case 'fork'`), so that action silently changes nothing. The 1 m hoe square works because its jittered square covers 4 nodes.
   - Either paint the nearest node when a valid shape covers no node (and count it),
   - or state loudly in the README that cells are node-centred (cell i spans [i−0.5, i+0.5]), that shapes must contain an integer node, and what shapes of radius below 0.71 m do.
   - Also tell the characters builder about the mismatch: characters targets `floor(x)+0.5` corners, while terrain samples integer nodes.

## Should fix
- `checkShape` tests the bounding box, not the polygon's area, so a diagonal collinear polygon passes. It paints 3 cells and flattens. Use the signed shoelace area, |A| > ε.
- Edit bursts: per-frame edits add about 4 ms/frame (p95 11) while they run, plus about 150 frames of catch-up. That is fine at real gameplay rates. If a future system edits every frame, for example many workers or a sprayer, coalesce the `changed()` calls per frame so dirty rectangles are merged and marked once, and emit one merged `terrain:changed`.
- Around 2 s of cold-start catch-up (terrain msAvg about 5 ms at z6) inflates `tools/shot.js` numbers. Consider a lower catch-up multiplier once the overview fallback is on screen.
- `findDry` returns `null` for out-of-bounds points more than `radius` from the map, whereas the other queries clamp. Either clamp the start point or document the behaviour.
- `T.ops` is capped at 65,000 and then wiped, which also drops all sub-cell outlines. A long game of hoeing will hit this. Compact ops whose nodes have all been overwritten, instead of wiping everything.
- Cosmetic, brief:
  - The ploughed-field furrows read as a near-black flat rectangle under rain wetness (`edits_tractor_settled.png`).
  - Meadow patches are still somewhat blocky at 12 px/m (`lake_1230.png`, top right).
  - The pond still does not freeze in winter.
  - Stair-stepping remains on the hoe strip's river-side edge where water cells are skipped (`edits_hoe_settled.png`). This is expected, but it reads as a staircase.

## What works
- Water-view cost is down about 30–60× and is now well inside the budget at every tested zoom and time. The A/B switch makes this verifiable.
- Input validation is solid and uses warn-once. No bad input reached the error counter, and the module cannot be auto-disabled by a buggy caller.
- The water rule is honest: returned counts equal the dry nodes actually painted.
- `surfaceAt`/`isWater`/`waterDepthAt`/`findDry` are fully consistent.
- `generate` is idempotent, in-place `flatAreas` are bit-identical to a full regeneration, and dropped edits produce a warning.
- Heavy edit traffic neither leaks nor leaves tiles stale: after 500 edits the hoed and ploughed areas were fully repainted at full resolution.
- Contract, lint and determinism are clean, with zero errors in all showcase presets and full-game runs.
