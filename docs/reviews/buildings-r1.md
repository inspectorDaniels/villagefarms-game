# buildings — review round 1
Score: 6/10   Pass: no
Screenshots examined: shots/review/buildings-r1/farm.png, closeup.png, night.png, night_village_16pxm.png (in-game, 55 scripted buildings), day_farm_20pxm.png (in-game; camera missed the cluster, only used for error/HUD check)
Perf: showcase farm frameMsAvg=8.71 p95=12.1 draws=100 msAvg=0.26 · night 6.54/10.8/194/0.30 · winter 10.72/15.7/61/0.37 · in-game night, 55 buildings on screen at 6 px/m, 89 lights: frameMsAvg 2.97–4.34, p95 4.2–4.4, draws ~365, module msAvg 0.375–0.418 (steady state). The first 150 frames after 55 buildings appear average 1.66 ms: the sprites are painted on first view.
Errors: 0 in normal play (builder test, 4 showcase shots, 3 probe runs). 1 console error from my bad-input probe: `api canPlace: TypeError: Cannot read properties of null (reading 'variant')`.   Contract: 0 issues (manifest api = README = impl; events declared = emitted; no cross-module imports; the only foreign read is `world.vehicles.fuelPoints`).   Lint: OK
Builder test: `node src/modules/buildings/tests/game.test.cjs` → 32/32 PASS, 0 console errors (msAvg 0.161, frameMsAvg 7.55).

## Verdict
This module is solid underneath. Precise rotated colliders and `at()` work, and all six rotations are rejected on overlap. The canPlace rule chain works in the full game: road, field (including the edge), vehicle, water, slope ("too steep"), map edge, land rights and money. Purchase goes through simulation, and I watched the daily upkeep line land at the day rollover ("Upkeep — Barn −27.08"). Resale gives 90 %. Grain and potato capacity sync, the demolish guard refuses a full store, and the workshop repair and rebate work. Save/load is byte-identical and determinism holds. The problems are in the sell loop and in round-tripping state. A trailer full of wheat cannot be sold at the co-op when the farm's own bulk store is full, which is exactly when a farmer drives there, and it fails silently. Demolished buyers are left behind as "(closed)" sell points, although `simulation.removeSellPoint` now exists. The API also still has sharp edges: a `null` opts argument throws, and `force` accepts NaN coordinates. Art is acceptable: the roof tile courses, chimney smoke and night lights read fine. It is still flat, though, with hard-edged octagonal farmyard aprons.

## Must fix
1. **`deliver()` cannot sell when the farm store is full.** In the full game, set `S.addInventory('wheat', S.bulkRoom())` so bulk room is 0, then stop an 8 t wheat trailer at the co-op door. `deliver` returns `{kg:0, euros:0, at:'buildings:2', reason:null}` and the cargo stays on the trailer. The cause is that the sale is routed through `V.unload(u.id,'farm')`, and that returns 0 when the store is full. The R-key handler then shows no toast at all, because there is no euros, kg, cost or reason. A delivery sale must not depend on free room in the farm store. Sell straight from the cargo; if simulation lacks a path for that, ask simulation for `sell(item, t, sp, {fromCargo})` or reserve room temporarily. Return a non-null `reason` on any 0 kg result, and toast it.
2. **Use `simulation.removeSellPoint` in `unregisterFunctions`.** At present a removed co-op or shop stays in `S.sellPoints()` as `"Grain co-op (closed)"` with `accepts: []`. My probe confirmed this. It leaks into several places:
   - `ui/minimap.js:123` still draws a gold marker for it;
   - `characters/tools.js:45 nearestSellPoint` can pick it;
   - `characters/index.js:236` shopHelp matches `/shop/` on the name `"Shop (closed)"`, so a worker gets sent to a demolished shop.

   Update the README too: its "Simulation has no remove call" line is stale.
3. **API must not throw on bad input.**
   - `canPlace('barn', 300, 300, 0, null)` throws. The same applies to `place(..., null)` and `remove(id, null)`, which goes through the `opts.force` path. Use `opts = opts || {}`.
   - `load({list:[null, …]})` throws on `s.type`. Skip non-object entries, and entries without finite x/y.
4. **`place(..., {force:true})` accepts non-finite and off-map coordinates.** `place('barn', NaN, NaN, 0, {force:true})` created `buildings:1` with `x:null, y:null, w:null`, a null door and a NaN spatial item. It also triggered terrain warnings: "flatten: polygon has a non-finite point". `place('chicken_coop', -50, -50, …, {force:true})` was accepted too. `force` may skip gameplay rules, but it must still reject non-finite type/x/y/rot and out-of-bounds positions.
5. **Free grant + resale is a money printer.**
   - `place('farmhouse', …)` for a player without `pay` grants a simulation asset, and `remove()` then refunds €162,000. My probe measured a charge of 0 and a gain of 162,000.
   - Starting assets may be granted, but the default for a player placement should not mint sellable value. Choose one:
     - make `grant` opt-in;
     - mark granted assets with a zero or depreciated resale value;
     - refund only when the asset was purchased.
   - Document the choice. A future buildtools module that forgets `pay: true` would otherwise ship an exploit.

## Should fix
- **Characters are not placement blockers.** `canPlace('chicken_coop', player.x, player.y, 0, {anyLand:true})` returns `ok`, so a building can be dropped on top of the player. Either reject when a character stands in the footprint (query `world.characters` read-only, or ask characters for a solid spatial item), or push the character to the door on placement.
- **Fuel points outlive a demolished shed or dealer.** After `remove(shed)`, `refuel` still gave 105 L at the empty site. This needs `vehicles.removeFuelPoint`. Request it from vehicles and call it; it is listed as a known limitation.
- **`remove()` has no owner guard.** Any caller can demolish the NPC church or co-op without `force`, with refund 0. Require `force` or `owner:'npc'` for non-player buildings.
- **Warm-up hitch:** module msAvg averages 1.66 ms over the first 150 frames when many buildings first enter the view, because roof sprites are painted lazily. Pre-warm the sprites per type at `place`/`load`, or spread the painting over frames.
- **Ledger category:** buying a barn is booked as `"machinery"` (`Bought Barn`). Buildings should book under a building/property category. Coordinate this with simulation.
- Test nit: the hired-hand check reports `secs: 0` from a hard-coded value. The tractor-wall check passes on `!B.at(tv.x, tv.y)` alone, so it would pass for a tractor that half-clips the wall. Assert on `blocked` and on the hull distance.
- **Cosmetic:**
  - farmyard aprons are hard-edged octagons (farm.png, closeup.png);
  - roofs read as flat slabs, with little slope and ridge shading on the farmhouse and none visible on the grey sheds (farm.png, lower half);
  - hard-edged rectangular shadows;
  - moss is always on the local front slope.

  At night the roofs go uniform navy, and the buildings read only through their lamps (night.png).

## What works
- The placement chain works in the full game:
  - rejects: road (`reason:'road'`, no edge leaks over a 0.25 m sweep), field (correct at the field boundary), water, `too steep` (slope 0.41), map edge within 2 m, vehicle (`blocked (vehicle)`), neighbour land, `not enough money` (place returns null and `lastError` is set);
  - rotated overlaps are rejected at every angle tried;
  - `NaN`, string coordinates and unknown types return clean `{ok:false}`.
- Simulation integration: the catalog price is charged, and upkeep is charged by simulation at the day rollover. Resale is 90 % and credited. Silo capacity goes 80 → 480, potato capacity 80 → 680, and both return on removal. A full grain or potato store refuses demolition.
- Workshop: repair with a 30 % rebate, no repair away from a workshop, and the fuel point is de-duplicated on rebuild.
- The sell point sits at the door. Wrong-item delivery gives the reason "no buyer or store here". The shop sell point is closed on removal (see must-fix 2 for how).
- Save/load: `save()` output is identical after a load. Colliders, sell points and potato capacity are restored.
- The builder's two-page-load determinism check passes.
- The hired hand walks to the farmhouse door and goes inside (builder test). The tractor is stopped by the wall.
- Perf is well within budget at steady state: 0.38–0.42 ms with 55 lit buildings and 89 lights, frame p95 about 4.4 ms.
- The contract is clean, and lint passes.
