# buildings — review round 2
Score: 7/10   Pass: yes
Screenshots examined: shots/review/buildings-r2/night.png (new; art unchanged since r1), plus shots/review/buildings-r1/farm.png and closeup.png as the day-art reference
Perf: showcase night frameMsAvg=6.95, p95=9.5, drawCalls=191, module msAvg=0.344. The builder test's dense night village gives msAvg 0.117 and frameMsAvg 6.96. The r1 steady-state figure of 0.38–0.42 ms with 55 lit buildings still stands.
Errors: 0. This covers the builder test, the showcase shot, and my r2 probe, which deliberately feeds bad input.   Contract: 0 issues.   Lint: OK
Builder test: ALL PASS, 0 console errors. It prints **41** PASS lines, not the 42 that were claimed (I counted twice). No check fails.

## Verdict
All five round-1 must-fixes hold up under my own probes in the full game.
- **Selling with a full store.** With the bulk store full (room 0, plus 30 t of barley), an 8 t wheat trailer now sells at the co-op for €1,492. The farm's own wheat and barley come out exactly as they went in. A 6 t potato load at the shop also sells with the potato store full, and the capacity is restored afterwards. A 0 kg result now carries a reason ("Grain co-op does not buy potatoes", "no cargo"), and the R handler toasts it.
- **Sell points.** Demolished buyers are now deleted, and nothing "(closed)" is left in `sellPoints()`.
- **Bad input.** `null`, a string as options, non-finite or string coordinates, `Infinity` rotation, and a garbage `load()` are all rejected cleanly. None of them throws.
- **Money.** A paid building refunds 90 %, including after a save/load. A building placed without `pay` or `grant` carries no asset and no refund. A granted building nets €0.
- **Should-fixes.** The owner guard (`not yours`) and the "someone is standing there" placement check both work.

What remains are edge-case inconsistencies, none of which blocks gameplay. The art is still flat but acceptable. On balance this is a pass at 7.

## Must fix
None blocking.

## Should fix
1. **An ungranted player silo gets no bulk room from simulation, but `capacity('grain')` reports 400.** Probe: `place('grain_silo', …)` with neither `pay` nor `grant` left `bulkDelta` at 0 while `capacity('grain')` returned 400. The demolish guard (`bulkRoom() < 400` → `store not empty`) can then refuse to remove that silo while other grain is stored. Pick one fix:
   - `capacity()` counts only buildings that have an `assetId`, and the store guard is skipped when there is no asset;
   - or a player storage building without `pay` defaults to `grant`.
2. **Granted write-off makes ledger noise.** Removing a granted farmhouse books "Sold used Farmhouse +162,000" and then "Write-off −162,000". The net is correct, but the ledger or UI shows a phantom sale. Ask simulation for `releaseAsset(id, {noResale:true})`, or document it.
3. **Legacy saves.** Buildings saved before r2 have no `purchased` flag, so a paid building from an old save now refunds €0. In `load`, infer `purchased = !!assetId` when the field is missing.
4. **Fix the test count.** It prints 41 PASS lines; either the README or the claim says 42.
5. **Carried over (cross-module, not counted against buildings):**
   - `vehicles.removeFuelPoint` does not exist yet, so a demolished shed's pump lingers. The call in buildings is null-safe and ready.
   - simulation ignores the `buildings` ledger category.
6. **Cosmetic (unchanged from r1):**
   - hard-edged octagonal farmyard aprons and hard shadows;
   - roofs read flat, with weak ridge and slope shading on sheds;
   - at night the roofs go a uniform navy (night.png);
   - moss is always on the front slope;
   - the sprite warm-up spike when many buildings first enter the view.

## What works
- **Placement.** The chain from r1 (road, field, water, slope, edge, vehicle, land, money, rotated SAT) is intact, and it now includes characters. `force` still refuses NaN, `Infinity`, strings and off-map positions ("bad position" / "outside the map").
- **Economy.** A player can't earn money by placing a building without paying and then demolishing it. The purchase price is charged, simulation charges upkeep daily, and the 90 % refund survives save/load.
- **Delivery.**
  - Grain can be sold at the co-op even when the farm store is full, and the farm stock is left untouched.
  - Potatoes likewise at the shop.
  - Every no-sale case gives a clear reason, which the R key shows as a toast.
- **Services.** Sell points are removed properly on demolition. The owner guard protects village buildings unless the caller passes `force` or the owner.
- **Robustness.** Loading skips garbage entries, and a non-finite rotation falls back to 0.
- **Contract, perf, determinism.** The contract is clean, 0 errors, perf is well within budget, and determinism and save/load pass in the builder test.
