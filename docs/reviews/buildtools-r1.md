# buildtools — review round 1
Score: 6/10   Pass: no
Screenshots examined: shots/review/buildtools-r1/s1_yard_valid.png, s2_yard_moved.png, s3_field_on_rented.png, s4_land.png, 1_valid.png
(the probe scripts and raw JSON are in the critic scratchpad `buildtools-critic-r1/`: probe.cjs, probe2.cjs, drive.cjs, shots.cjs, probe.json)
Perf: full game, build mode at 5 px/m: frameMsAvg=7.95, p95=15.2, drawCalls=64, module msAvg=0.13. Land mode with 41 parcels at 1.2 px/m: frameMsAvg=13.1, p95=21.9, drawCalls=134, module msAvg=0.31. Real farm, land mode at 1.6 px/m: module msAvg=0.22. The frame was 30 ms there, but buildtools accounts for only 0.2 ms of it. The machine was shared with other agents.
Errors: 0 console and page errors across 4 full-game sessions.   Contract: `contracts()` is empty. The manifest api, README and implementation match, and the 3 declared events are all emitted. There are no foreign-namespace writes and no cross-module imports.   Lint: OK
Builder test: 34/34 pass when I rerun it (`game.test.cjs`).

## Verdict
The skeleton is solid. B toggles cleanly and is correctly refused while you drive: I checked this with a real F-key entry into the tractor. Building validity, refusals that cost nothing, rotation overlaps, the 10 s undo with an exact refund, the demolish book-value refund and land buy/rent all work in the full game, and nothing throws. Breaking it as a player, though, turns up rules holes that hit your money and your neighbour's land:
- the farm-track tool charges you again for a track that lies exactly on top of one you already built;
- the track tool lets you lay gravel 4.5 m into a neighbour's parcel;
- the mortgage dialog says you pay "25 % down + fees in cash", but the deal actually takes all your cash;
- one bad `rotate()` call locks building until you reload.

The visuals are acceptable but thin: the ghost is a flat green box with a tag. On the real starting farm, the field tool happily says "click to add a corner" in the middle of a parcel that is already 100 % field. These are the reasons the score is below the bar, not the lack of polish.

## Must fix (ordered)
1. **Duplicate tracks are charged again (money sink / double charge).**
   - Repro: path tool, A→B (€420), cancel, then A→B again, and also B→A. Each one is accepted.
   - Result: 3 overlapping `track` edges between the same two nodes, and €1,260 charged (`probe.json → undo.dup`, `dupEdges: 3`, `netDup: -1260`). A spam-clicking player pays repeatedly for nothing.
   - Fix: refuse a segment whose two end nodes already share an edge, or whose samples run along an existing track edge (within its width / 2), with the reason "already a track".
2. **Tracks trespass up to 4.5 m into neighbour land.**
   - In `checkSegment`, a sample off your land is excused when it is within `NODE_SNAP_M + 1` of *either* end and *either* end is near a node.
   - So if the start snaps to a road node, the *far* end may go 4.5 m into a neighbour's parcel. Repro: node on owned land at (X−30, Y−30), track to (X−30, Y+44.5), which is 4.5 m inside the npc parcel. The result is `ok:true` and it is charged €1,043 (`probe2 → trespass`). The control case without the node is refused with "not your land".
   - Fix: excuse an off-land sample only near the end that is itself snapped to a node (or lies on a road), never near the other end.
3. **The mortgage dialog misstates the deal.**
   - The text says "with a mortgage (25 % down + fees in cash)". But `simulation.buyParcel({mortgage})` borrows only the shortfall and spends **all** your cash.
   - Repro: with €20,000 cash, buying a €60,000 parcel left the player at **€0.00** with one €42,400 loan (`probe.json → land.afterMort`). The next overhead charge then drives the farm into overdraft.
   - Fix: compute and show the real figures in the dialog (cash used, loan amount, cash left afterwards), and warn when cash left would be below about a month of overheads. Same for the land-mode hover reason, which only says "mortgage offered".
4. **`rotate()` with a non-finite step poisons state.**
   - `rotate('x')`, `rotate(NaN)` and `rotate(Infinity)` set `W.rot = NaN`. The R key cannot fix it, since NaN + π/2 is still NaN.
   - From then on every building preview and every `placeAt` returns "bad position" until the page is reloaded, and `save()` writes `rot: null` (`probe.json → badApi`).
   - Fix: ignore any step for which `!Number.isFinite(step)`, and also guard `W.rot` in `select`.
5. **Undo history survives `load()`.**
   - `load()` restores `rot` and the counters but leaves `W.history` alone. After loading a save, `Z` still targets ids from the previous timeline (`probe.json → undo.historyAfterLoad` shows the entry intact with ttl 10).
   - If the loaded state has a different building under the same id, undo removes it and tops it up to the *other* item's full cost.
   - Fix: clear `W.history`, `verts` and `chain` in `load()`.

## Should fix
- **Undo tops up blindly.** `undo()` credits `cost − refund` whatever happened to the asset in between. If the building's asset was already released, for example sold through the simulation, `buildings.remove` refunds €0 and undo pays the full cost again. Repro: build barn, `releaseAsset` (+€52,000), undo (+€65,000). This is +€52k per cycle (`probe.json → undo.netAfterRelease`). Today only the API can do this, but guard it: top up only when `r.refund` matches the asset's expected book value, or record the assetId and check it still exists.
- **Undo can get stuck on the top entry.** If the top history item was removed by another module (for example `crops.removeField`), `undo()` fails and never pops it, so older entries that are still valid can't be undone. Drop entries whose target no longer exists.
- **Field first corner is accepted inside an existing field.** On the real farm, Lindeveldje (rented, 1.8 ha) is already 100 % covered by crops:1, yet the preview is green "click to add a corner" (s3_field_on_rented.png). It only fails at closing with "overlaps Field 1". Refuse the first corner, and the draft edges, early with "already a field".
- **A field can't follow the parcel edge.** Corners exactly on the parcel boundary are refused as "leaves your land" (`probe.json → fields.wholeParcel`), so a player tracing their own hedge line gets red. Snap corners to within 1 m of the parcel boundary, slightly inset.
- **`driving()` checks only `character.vehicleId`.** `vehicles.enter(id, charId)` called via API leaves `vehicleId` null while `driverOf` says the character is driving, and buildtools then allows B. The real F-key path is fine. Also check `vehicles.driverOf` if present.
- `select('building', 'nope:9')` silently selects the farmhouse and returns true. It should return false or keep the current item.
- `enter('foo')` returns true and goes into build mode. That is acceptable, but document it.
- **The ghost is a flat green or red rectangle** (s1/s2). A 5×3 coop and a 22×13 barn look the same except for size. Add at least a roof-tone fill, the door marker (`buildings.doorOf`) and a drop-shadow offset so the player can see orientation before pressing R.
- **Land-mode labels overlap the HUD toast stack** (s4: "Leemputt to let" is cut off under the welcome toast) and the bottom toolbar ("Lin… ren…"). Clamp the labels to the free screen area.
- Neighbour parcels in land mode are hard to read: the grey stroke is nearly invisible on grass (s4: Bergske and Meersen have no visible outline).

## What works
- **Driving.** B is refused while driving and build mode closes when you get in. I verified this with the real F key next to the tractor: B was blocked while driving, and pressing F while in build mode closed it.
- **Money.** With €0.01 short the placement is refused at no charge, and at the exact cost it places and leaves €0.00. Five synchronous `placeAt` calls on one spot give 1 building and 1 charge. A second undo correctly reports "nothing to undo".
- **Rotated overlap.** A barn at 15° against a barn at 105° is refused with "another building".
- **Undo and demolish refunds.** Build → demolish (80 % book value) → undo does not re-refund the demolished building. Its history entry is filtered, so undo moves to the previous valid entry. Two chained track undos come back to a net €0.
- **Field geometry.** Collinear, tiny and duplicate-vertex polygons, edges that cross, polygons across two parcels, a pond inside an 80 m field, and NaN corners through the API are all refused with clear reasons.
- **Bad API input never throws.** This covers select(null/{}), placeAt('a'), placeAt(NaN/∞), preview(NaN), preview(1e9), load(null/'x'/junk), and cancel or exit when inactive.
- **Land mode.** It is readable on the real 36-parcel map (s4). "You own this", "not on the market" and rent-when-broke refusals all work. The buy, rent and confirm flows from the builder test pass.
- Contract clean, lint OK, zero errors, and the module costs only 0.13–0.31 ms per frame.
