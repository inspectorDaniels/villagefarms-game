# roads — review round 2
Score: 7/10   Pass: yes
Screenshots examined:
- shots/roads/review-r2/junction_1230.png, shots/roads/review-r2/night_2330.png. I also read the JSON for all 28 preset×time shots.
- shots/review/roads-r2/game_village_z24_1230.png. This is the full game after calling `generateNetwork()`, because the demo module isn't registered yet.

Perf (headless, shared 4-core box). I used the A/B switch `world.roads.debug.render`. At each camera I waited 200 frames first so terrain had finished building, then measured on, off, on:
- **Full game, idle camera, noon:**
  - Village crossroads at 772,481 and zoom 6/12/24: delta **0.31 / 0.23 / 0.24 ms**.
  - Bridge at 551,511: **0.30 / 0.45 / 0.27 ms**.
  - Lamp street: **0.30 / 0.21 / 0.02 ms**.
  - Frame 1.5–2.1 ms. roads `msAvg` 0.25–0.49 ms, which now agrees with the delta.

  In r1 the same cameras cost 22–38 ms. My r1 numbers were real steady-state costs, because I measured after 60 frames with no chunk rebuilds happening. Either way, the cost is now gone.
- **Night, village @6/12/24:** delta 0.96 / 1.15 / 1.73 ms. This includes the core lighting pass for the 7 lamps, which is legitimately caused by roads.
- **Panning, first visit to a region:** terrain was pre-warmed with roads off, then I compared roads on vs off.

  | zoom | avg on / off | p95 on / off | max on |
  |---|---|---|---|
  | 24 | 6.8 / 4.2 ms | 13.1 / 10.5 ms | 70 ms |
  | 12 | 7.3 / 4.4 ms | 9.6 / 7.4 ms | 84 ms |

  On a second pass through the same region the difference is about 0.7 ms. Single 70–86 ms spikes also appear with roads off (74 ms), so I can't attribute them. **Roads adds about 2.7–3 ms per frame while chunks are being built.** That is over the 1.5 ms per-module budget but only transient, and the frame p95 stays within 20 ms. The builder's "p95 ≤ 1.5 ms" claim is not true at frame level.
- **Showcase** (28 shots): frameMsAvg 1.8–2.9, p95 ≤ 11.1, roads msAvg ≤ 0.75, 0 errors, 0 contract issues.

Errors: 0 console/page errors in all shots, in the full game, and across the whole bad-input battery. Health shows 0 errors. Bad inputs produce `ctx.warn` messages (14 warnings), which is fine.
Contract: 0 issues. `junctionInfo` and `surfaceAt` are in the manifest and the README.
Lint: `lint OK`.

## r1 must-fix verification (independent probes)
1. **Non-finite inputs — fixed.** `roadAt(∞)`, `nearest(−∞)`, `pathfind([∞,0],…)` and `surfaceAt(∞)` each return `null` in 0.3–0.8 ms. `nearest(1e300,1e300)` returns `null` in 0.3 ms. `edgesInRect(−∞…∞)` returns `[]`, but takes 3.9 ms.
2. **Bad inputs — fixed.** 24 cases were tried: null or missing arguments, strings, objects, NaN nodes, self-loops, unknown nodes, a null minimap, and junctionInfo/surfaceAt on garbage. None threw. They return `null`, `false` or `[]`.
   - Invalid plans (a bad index, a NaN node, `nodes:'x'`, `edges:'zz'`) return `null` and **keep the previous network** (20 → 20 edges).
   - `edges()` now returns frozen copies. Writing into one did not change the world. It costs 0.5 µs per call because it is cached per version.
   - `nearest()` on an empty network now takes 0.5 µs, down from 2.5 ms.
3. **Idle render cost — fixed.** 0.02–0.45 ms at noon (see Perf).
4. **Pan spikes — mostly fixed.** Builds are now time-sliced (`budget:6` steps). What remains is about 3 ms of average build overhead while panning (see Should fix).
5. **Lane pathfind — fixed.** 80 random `lane:true` paths gave 47,213 points, **0 off-road** according to `roadAt`, 0 nulls, and every point carries an `edgeId`. On a track the path now stays on the centre line. Average 0.27 ms.
6. **junctionInfo — implemented, and it passes my checks.** Across all 6 junctions and 19 arms: **0 issues**.
   - Degree matches the adjacency count in the graph.
   - Every `entry` is within 0.45 m of the inbound `laneCurve`, and every `exit` is within 0.45 m of the outbound `laneCurve`.
   - `entry` and `exit` are on the carriageway.
   - `dir` points along the arm's own edge.
   - Both stop-line endpoints are on the carriageway or kerb, never the pavement.
   - `entry.edgeS` matches `stopLine.s`.
   - **Rules:**
     - The 4-way village crossroads is `right-before-left`, with every arm minor. That is consistent with the painting, which has no teeth there.
     - The regional T junctions are `major-road`, with the village arm `minor` and `giveway`. That matches the give-way triangles.
     - The regional×lane and lane×track junctions are `major-road`, with the lower class `minor` and `control:'none'`.
   - Dead ends return `rule:'none'`, and an unknown node returns `null`.
   - `pathfind` tags junction nodes (`node`), so traffic can look up the next junction.

   **Coverage of the traffic brief** (docs/briefs/traffic.md): lane following (`laneCurve`), speed by class, right-of-way yielding, and regional-only overtaking (via `lanes`) are all covered.

**New `surfaceAt`:**
- Across a village street the profile is carriageway to 2.5 m, kerb at 3.1, pavement at 4–5, `null` at 6.5.
- Across the regional road it is carriageway to 3.4, verge at 3.7, `null` at 4.2.
- On the bridge it returns `{regional, carriageway, bridge:true, edgeId}`.
- About 5 µs per call.

Pathfind optimality was verified in r1 (60/60 optimal against an independent Dijkstra), and nothing in that code path regressed: coast-to-coast paths still work. Save/load and determinism were verified in r1.

## Verdict
This is now a dependable foundation that traffic, characters and vehicles can build on. Every hole I found in r1 is closed and verified. The game no longer hangs on bad floats, bad input never throws, and invalid plans keep the old network. Lane paths stay on the tarmac, and `junctionInfo` gives traffic geometrically consistent stop lines, entry/exit lane points and right-of-way that matches the paint. Idle render cost dropped from about 30 ms to about 0.3 ms. The visuals are as good as in r1. The new 256 px chunks look slightly softer at zoom 24, which is acceptable. The only thing still over budget is the build cost while panning into unseen road areas, which is transient and doesn't break the frame budget.

## Must fix
None blocking.

## Should fix
1. **Build overhead while panning:** about 2.7–3 ms average per frame on the first visit to a region (zoom 12 and 24), against a 1.5 ms per-module budget. Lower the per-frame step budget when the frame is already over ~10 ms, or prefetch chunks while the camera is idle.
2. **Turning paths through junctions.** `laneCurve` stops at the node, so a car following edges one by one has no curve through the junction. Add `turnCurve(nodeId, fromEdgeId, toEdgeId)` (entry → exit, right-hand) plus a conflict hint (which arms' paths cross). Otherwise traffic has to derive these from `pathfind` or `poly` itself.
3. **`pathfind` snaps endpoints silently at any distance.** `pathfind([1,2],[3,4])` returned a single point 590 m away. Add `opts.maxSnap` or return the snap distance, so callers can tell when they are off the network.
4. **`edgesInRect` with huge or infinite bounds** takes 3.9 ms. Clamp the rect to the world bounds.
5. **Data traffic will want later:** parking or lay-by spots in the village and a bus-stop position. These are optional, since `surfaceAt` `kerb` can stand in.
6. **Cosmetic:**
   - Chunks are slightly softer at zoom 24 since the switch to 256 px (game_village_z24_1230.png).
   - The r1 cosmetic items are unchanged: the blunt village→lane kerb end, and the dark utility-trench stripes.

## What works
- Robust, null-safe and fast API. 0 errors under abuse.
- Optimal, deterministic pathfinding with per-point `edgeId` and `node` tags.
- `junctionInfo` is consistent with `laneCurve`, the painted markings and the adjacency graph.
- `surfaceAt` separates carriageway, kerb, pavement and verge, and flags bridges.
- The A/B debug switch (`?roadsfx=0`, `world.roads.debug`) is useful for integrators.
- Idle render cost is well under budget at every zoom, and warm street lighting at night.
