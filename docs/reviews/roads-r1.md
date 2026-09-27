# roads — review round 1
Score: 5/10   Pass: no
Screenshots examined:
- shots/roads/review-r1/default_1230.png, junction_1230.png, tjunction_1230.png, bridge_1230.png, night_2330.png, farm_1230.png, winter_1230.png. I also read the JSON for all 28 preset×time shots.
- shots/review/roads-r1/game_village_z6_1230.png, game_village_z12_1230.png, game_bridge_z24_1230.png and game_village_night_z12_2230.png. These are full-game shots taken after calling `roads.generateNetwork()`, because no module generates a network in the full game yet.

Perf (headless on a 4-core box shared with other agents, load avg ~2.5; absolute ms are inflated but the on/off deltas are solid):
- **Full game, idle camera, network in view: roads costs 22–38 ms/frame.** I measured this by removing the roads layers and collectors at runtime and comparing `frameMsAvg`:

  | camera | zoom | frame with roads | frame without roads | delta |
  |---|---|---|---|---|
  | village crossroads 772,481 | 6 | 40.0 (p95 66) | 1.9 | **38.1** |
  | village crossroads | 12 | 37.8 (p95 65) | 3.7 | **34.1** |
  | village crossroads | 24 | 25.2 | 1.4 | **23.8** |
  | bridge 551,511 | 6 / 12 / 24 | 38.0 / 37.3 / 24.5 | 1.9 / 4.8 / 1.6 | **36 / 32 / 23** |
  | lamp street 680,513 | 6 / 12 / 24 | 28.0 / 37.9 / 24.3 | 1.3 / 2.2 / 1.6 | **27 / 36 / 23** |

  Here roads' own `msAvg` (22–32 ms) does report the cost honestly. Separately, the regional T at 159,616 @24 costs only 0.8 ms, because fewer chunks overlap the view.
- **Root cause:** almost all of the cost is the `ground-overlay` layer (28 ms of 28.2). The layer does no rebuilds (`cache.stats().builds` stays constant). Each frame it does 9 full `drawImage`s of **1024×1024 chunk canvases** at about 2.8 ms each. Most of those chunks are almost entirely off screen: at @12 the destination rects are like `(752,-714,768,768)` (54 px visible) and `(1520,54,768,768)` (80 px visible). Copying the canvases into fresh ones did not help, so canvas acceleration state is not the cause.
- **Panning** (camera moving 2.5 m/frame @12) triggers chunk builds. The roads layer then measured avg 32.8 ms, p95 87 ms and **max 162 ms**; the frame p95 was 187 ms. At @24 the layer p95 was 38 ms and the max 59 ms.
- **Night:** at village @12 22:30, roads msAvg was 62 ms and the frame 75 ms.
- **Showcase** (28 shots): frameMsAvg 11.8–26.5, p95 up to 59.6, roads msAvg **10–24 ms**. The builder's claim of 2.0–2.8 ms does not reproduce.
- drawCalls 35–290, heap ≤ 20 MB, boot 1.5–3.0 s, `generateNetwork()` 197 ms. These are all fine.

Errors: 0 console/page errors in all 28 preset shots and in the full game with a generated network. The API probe produced **6 console errors** from bad inputs (see Must fix 2) and **3 main-thread hangs** (Must fix 1).
Contract: 0 issues. The manifest `api` matches both the README and the implementation. Only `roads:changed` is emitted, and it is declared. The module imports only from its own folder, writes only to `world.roads`, and null-checks `terrain`/`environment`.
Lint: `lint OK`.
Determinism: `generateNetwork()` run twice gave the same signature (edges, points, lights). `ctx.rng` streams are recreated on each call. A save → other plan → load round trip gives an identical network, and the id counter continues correctly after load.

Functional API probe (full game, default network: 20 nodes, 20 edges, 14 lights, 6 junctions, 1 bridge):
- `pathfind`: I checked 60 random pairs against an independent Dijkstra (travel time, same virtual endpoints). The worst ratio was **1.000**, with 0 spurious nulls, a maximum point gap of 0.87 m, and endpoints exactly on the `nearest()` projections. It took 0.2 ms on average and 0.46 ms coast to coast. A disconnected component returns `null`. With `classes:['regional']` the path is restricted correctly.
- `roadAt`: 3054 samples at −0.45w, 0 and +0.45w across every edge gave **0 misses**. All 6 junction centres return the right class, and it returns `null` 30 m off the road. Cost is 18 µs per call.
- `laneCurve`: 2-lane classes are offset to the correct right-hand side in y-down coordinates (regional 1.75 m, village 1.5 m). 1-lane classes stay on the centre line.
- Generator: 0 un-bridged water samples, and 10 centreline samples on the bridge. **89 of 1541 centreline samples lie on slope > 0.25, with a maximum of 0.90.**
- `nearest()` costs 76 µs per call. On an **empty network it costs 2.5 ms per call** because it scans 71 rings of the grid.

## Verdict
The graph core is the best part of this module. Pathfinding is provably optimal on the test set, deterministic, and returns clean polylines. `roadAt` matches the painted carriageway exactly, and the data model is complete enough for characters and vehicles today. The painting is also good: filleted kerbs, a zebra with tactile paving, give-way teeth, a bridge with railings and wing walls, and lamps that light the village at night. It reads as a believable European village and is clearly not programmer art. The module still fails, for two reasons. First, one bad float freezes the whole game: `roadAt(Infinity, …)` spins forever, and no health guard can catch that. Second, the renderer costs 22–38 ms every frame, idle, whenever a street is on screen. That is 15–25× the 1.5 ms budget, and it is exactly what the characters builder reported. Traffic is next in line to depend on this API, and it will also need junction topology and a correct lane offset, and neither exists yet.

## Must fix (ordered, concrete, actionable)
1. **Infinite loop on non-finite coordinates (freezes the game).** `roadAt(Infinity,0)`, `nearest(-Infinity,5)` and `pathfind([Infinity,0],[100,600])` each hung the page for more than 15 s; I killed them. The cause is in `nearestOnNetwork` (`network.js:336`): when `cx = ±Infinity`, `for (gx = cx - ring; gx <= cx + ring; gx++)` never terminates. `NaN` happens to escape only because its comparisons are false. One `dt=0` division in a caller would be enough to lock up the game. The fix: at the top of `nearest/roadAt/pathfind/edgesInRect/nearestOnNetwork`, return `null` or `[]` unless `Number.isFinite(x) && Number.isFinite(y)`, and clamp the ring search to the world bounds.
2. **Bad inputs must return null/false, not throw.** Each of these adds a `console.error` and a health error; 25 errors disables roads, and with it every road query the other modules make:
   - `pathfind(null, …)` and `pathfind()` fail with `TypeError` in `P()`.
   - `addEdge('x','y')` and `addEdge(n,n)` throw by design. Return `null` and `ctx.warn` instead.
   - `drawMinimap(null)` throws `TypeError`.
   - `generateNetwork({nodes:[[0,0]], edges:[[0,5,'lane']]})` throws, **after `clear()` has already wiped the live network**. The world was left with 1 node and 0 edges. Validate the whole plan first; if it is invalid, keep the old network and return `null`.
   - `addNode(NaN,'q')` is accepted and poisons the graph. Reject non-finite coordinates.
   - `classes:'lane'` (a string) silently becomes `Set('l','a','n','e')`. Accept a string or an array.
3. **`ground-overlay` cost of 22–38 ms/frame down to ≤ 1.5 ms**, with an idle camera at @6/12/24 in the full game (village 772,481 and bridge 551,511, see the table above). The measured cost is 9 full-chunk blits of 1024² canvases, most only a few percent visible:
   - Clip each blit to the view. Use the 9-argument `drawImage` with the source sub-rect that intersects `view`, instead of drawing the whole 768 px destination.
   - Use smaller chunks (256–512 px) and/or store a content bbox per chunk. Road chunks are mostly transparent, so blit only the painted part.
   - Consider picking `res` so the blit scale is close to 1. `pickRes` currently always downsamples, to about 0.75.
   - Re-measure with the on/off method, not with `msAvg`.
4. **Pan spikes: up to 162 ms per frame** (@12 while panning). Chunk builds of 10–40 ms each land on the frame. Options: build smaller chunks, split a build across frames (paint by class or pass, or use an `OffscreenCanvas` worker), and prefetch the ring around the view ahead of the camera direction. The coarse fallback already exists, so a budget of 0 builds on frames already over 12 ms is acceptable.
5. **`pathfind(…, {lane:true})` drives off tracks.** It offsets the whole path by a fixed 1.6 m, but a track is only 3 m wide, so it lands outside the road. On a track, **71/71** lane points had `roadAt === null`. It is also inconsistent with `laneCurve`, which uses width/4 for 2-lane classes and the centre line for 1-lane classes. Use the same per-edge offset as `laneCurve`, and offset each edge's part separately, so the offset changes at junctions and class transitions instead of applying one global offset.
6. **Junction data for traffic.** `junctions()` returns only node ids. Traffic yielding needs `junctionInfo(nodeId)` → `{ x, y, arms:[{ edgeId, dir:[dx,dy], class, priority:'major'|'minor', stopLine:{x,y}, entry/exit lane points }] }`. The data is already computed internally (`J.arms[].minor`, `J.through`, the give-way teeth position). Also expose `edgeAtNode(edgeId, nodeId)` or add `from/to` node ids per pathfind segment, so traffic can tell which junction it is approaching.

## Should fix
- `nearest()` on an empty or far network scans 71 rings, 2.5 ms per call. Return early when `roads.edges.length === 0`, and cap the radius at the world diagonal.
- The generator lays roads across steep ground: 89/1541 samples have slope > 0.25, with a maximum of 0.9. Penalise slope along the via segments, not only at control points.
- There is no pavement or kerb query. `roadAt` returns `null` on the village footway. A `surfaceAt(x,y)` → `{class, part:'carriageway'|'pavement'|'verge', bridge}` would serve characters (walking on pavements) and vehicles (kerb bump).
- `edges()` and `nodes()` return the live `world.roads` arrays, so a careless caller can corrupt the graph. Document them as read-only, or return frozen views.
- The README says `laneCurve` and `pathfind` lanes are "1.6 m". Keep the README in sync after fix 5.
- Cosmetic:
  - The village→lane transition ends the kerbs in a blunt dark wedge (game_village_z6_1230.png around 1280,470; winter_1230.png right edge).
  - At the regional T, the minor road's junction apron shows a darker rectangular patch below the far edge line (tjunction_1230.png, 620–1040 px, y≈690).
  - Utility-trench decals read as heavy dark stripes across village streets at @12 (game_village_z12_1230.png, x≈490 and x≈1170).
- The chunk cache cap is 180 MB of canvas. Together with terrain's cache, that is a lot of GPU memory on a mid laptop. Consider 96 MB.

## What works
- A* pathfinding was optimal on 60/60 random pairs, handles disconnected components and class filters, and is fast (≤ 0.5 ms).
- `roadAt` covers the painted carriageway and junction polygons exactly (0/3054 misses).
- Right-hand `laneCurve` is correct. Edges carry `width/lanes/speed/length/points/bbox`.
- The network, decals and lights are fully deterministic. Save/load round-trips exactly, including the id counter. `roads:changed` fires once per rebuild.
- Rendering quality is good:
  - Filleted kerbs with slab footways, a zebra with tactile paving, give-way teeth, a bridge deck with railings, wing walls and custom shadows, gravel lanes with puddles, and dirt tracks with a grass centre strip.
  - At night, 7 warm lamps submit `F.light` with glow in the village view and read well (night_2330.png, game_village_night_z12_2230.png).
  - Winter snow edges and long pole shadows show.
- The contract is clean, lint is OK, and the module shows 0 errors under normal use.
