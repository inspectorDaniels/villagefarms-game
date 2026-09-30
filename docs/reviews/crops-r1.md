# crops — review round 1
Score: 6/10   Pass: no
Screenshots examined: shots/review/crops-r1/shot-plough.png (tractor + plough_s on an owned-parcel field, 24 px/m),
shots/review/crops-r1/shot-patchwork.png (18-field patchwork, 7 px/m), shots/review/crops-r1/shot-z30.png (30 px/m close-up)
Perf: all measured headless in the full game at 1600×900 on the 18-field pan.cjs layout. The A/B is the same page with and without fields.
- Static at 6–12 px/m: frameMsAvg 1.8–6.9 ms (5.2–5.6 without fields), crops msAvg 0.25–0.33 ✓.
- Panning at 8 px/frame: crops msAvg 2.5 / 4.2 / 3.3 ms (z6/z12/z30) ✗ against the 1.5 ms budget. The A/B puts the real frame cost at +4.3 ms avg / +12 ms p95 (z6) and +5.5 ms avg / +15–27 ms p95 (z12). With fields, z12 p95 is 27–40 ms, over the 20 ms budget.
- **Close zoom (24 px/m) with a static camera:** frameMsAvg 50–55 ms with fields vs 5 ms without. Crops msAvg still reads 0.18–0.24 ms. When `drawGround`/`drawSway`/`collect` are stubbed one by one, frameMsAvg drops 55 → 32 (sway) → 29 (collector) → 11 (ground). That is about 40 ms of raster cost that the module's own timer does not see. drawCalls 73–149 ✓.
- Day tick on 60 ha (20 fields, 150k cells, headless model): 20–37 ms/day in 38 steps of 4000 cells. Typical step 0.9 ms, worst 7.5 ms ✓.
Errors: none in normal play. `createField(null|[])` **throws** through the guarded API. It logs `[module crops] api createField failed` as a console error and counts toward the 25-error auto-disable.   Contract: 0 issues (manifest api/emits/listens match README and implementation; no cross-module imports; optional deps null-checked)   Lint: OK

## Verdict
Mechanically this is the most complete module in the game so far. The state machine, yields, jobs, contractors and CAP bookkeeping all check out in the full game. The yields track simulation's table: 1.04× at soil 0.6 for every crop, which follows the documented formula. Hoe → water → seed from a real character changes the cell stubble → cultivated → moisture +0.30 → sown/wheat. A real tractor with plough_s ploughs exactly the swept strip, and `capShare` rises by the same m². A half-parcel contractor plough booking lands as 2400/4800 m² ploughed with `capShare` 0.50, so there is no double count. Save/load round-trips byte-identically, and the builder's season, game and pan tests all pass. Three things block a pass:
- Performance: at walking zoom the fields cost the frame about 40 ms that the module timer does not report, and panning is 2–3× over the per-module budget.
- The CAP payload can be farmed by re-working the same strip.
- `createField` throws on bad input.

The art is acceptable, painted rather than programmer rectangles, but it is flat at overview zoom.

## Must fix (ordered, concrete, actionable)
1. **Real frame cost at close zoom and while panning.**
   - At 24 px/m with a static camera and 18 fields in view, frameMsAvg is 50–55 ms (5 ms without fields). The sway layer accounts for about 20 ms, the ground composite about 20 ms and the collector's shadows about 3 ms. None of this appears in crops `msAvg`, because canvas raster work is deferred.
   - Find out why a "one blit per frame" static camera costs this much at 24 px/m. Is the composite rebuilt every frame (paintV/key churn), are 1024 px LOD-32 chunks downscaled, or does sway draw full-screen gradients each frame? Fix it so that the A/B delta (fields vs none, same camera) is ≤ 1.5 ms avg static and ≤ 3 ms while following a moving vehicle.
   - Panning (pan.cjs) must also get under the 1.5 ms module budget, or the budget must be argued from an A/B frame delta, not only from `msAvg`.
   - Add the A/B (fields/no fields, and z6/z12/z24 static plus panning) to `tests/pan.cjs` and report the frame delta in the README.
2. **CAP area can be farmed by repeated passes over the same strip.**
   - `crops:worked.areaM2` counts every changed cell on every pass. `plough` changes cultivated → ploughed and `cultivate` changes ploughed → cultivated, so a tool can alternate on the same cells indefinitely.
   - Headless: plough+cultivate on a ~24 m² strip, 24 times, emitted 576 m² of `plough` on a 4800 m² field (12 % CAP share from 0.5 % of the land). Repeated `fertilise` (until fert ≥ 0.9) and `water` passes accumulate the same way.
   - Fix in crops: keep a per-cell "worked in CAP year Y" stamp (1 byte, or a bitset per tool class). Put only first-time cells this CAP year in the payload (`areaM2`), or add `newAreaM2` and have simulation switch to it. Document it in the README and coordinate the field name with simulation.
3. **`createField` must not throw on bad input.** `createField(null)`, `createField([])` and 2-point polys throw `poly needs ≥ 3 points`, which is a console error and counts toward module disable. Return `null` and `ctx.warn` instead. Also reject NaN coordinates and zero-area polys: `createField([[NaN,0],[10,0],[10,10]])` and a collinear poly currently create empty fields.

## Should fix
- **Wheat ripens a month late in the live game.** In game.cjs, wheat sown on doy 29 was ripe on doy 26 (September). The README and calendar promise mid harvest-month (Aug, doy 21–23), and the headless season test gets 23. Environment's real rain plan (moisture dipping to 0.06) slows it. Either tune `need`/the moisture floor, or document that dry years ripen late.
- **Spraying doesn't pay.**
  - One season unsprayed: 8.22 vs 8.37 t/ha, which is ≈ €31/ha of wheat against a €95/ha spray input.
  - Unfertilised: 6.39 t/ha, so fertiliser is worth it.
  - Fix: make weeds carry over (seed bank) or raise the health penalty, so the spray decision matters.
- Drought mainly delays ripening rather than cutting yield. 20 dry days gave −28 % yield and a much later ripening. 40 mm/day of rain has no waterlogging penalty (8.13 vs 8.37 t/ha). Acceptable, but tune it together with the item above.
- **Save size:** measured 43 KB for a 0.48 ha field in game (≈ 90 KB/ha), and 5.3 MB for 60 ha headless. The README says "1.2 ha ≈ 40 KB". Quantise growth/health/fert/weeds/moist to Uint8, or RLE the state arrays, and fix the README number.
- `save()` does not flush coalesced `crops:worked`/`crops:harvested` events. Up to 60 game-s of CAP area is lost across save/load. Events are also held indefinitely while the clock is paused. Call `model.flush(t, true)` in `save()`.
- The full game boots with 0 parcels and 0 fields (`?seed=harvest-1`), so the loop cannot start without demo/buildtools. This is the demo builder's job, but crops' README should state which entry point creates the starting fields.
- Cosmetic:
  - At 7 px/m (shot-patchwork.png) the fields read as near-flat colour blocks with faint row texture.
  - At 30 px/m (shot-z30.png) wheat and barley are indistinguishable.
  - The margin grass strip between fields is a uniform band.

## What works
- State machine verified end to end:
  - plough/cultivate/seed/fertilise/spray/harvest to stubble and straw, then bale; withering; grass mow → rake → bale → regrowth 0.22.
  - Idempotent re-work returns 0 cells.
  - Frost kill runs by month.
- Yields vs `simulation.yieldTable()` for all 8 crops: wheat 8.86 / barley 7.82 / oats 6.25 / rape 4.17 / maize 11.47 / potatoes 46.9 / beet 78.2 t/ha at soil 0.6. This is the table × (0.9 + 0.25·0.6), as documented. The item ids are simulation's.
- `work()` is robust:
  - NaN coords, NaN/Infinity/−5/1e9 width, 1e9 len, string coords, unknown tool, `seed:unicorn` and a null tool all return a zero result without throwing.
  - `applyContract` with an unknown parcel or op, `forceStage`/`stats`/`collectBale`/`calendar` with garbage, and `simulateDays(NaN)` are all safe.
- Jobs: a real simulation harvest job on an NPC parcel was completed through `work()`, progress 1, and paid €137 (game.cjs).
- Contractors: a live `economy:contractor-done` ploughed exactly the booked 2400 m², and sow and harvest deliver to inventory. `contractor:true` means simulation does not count the area twice (capShare 0.50 for a half booking).
- Vehicle path: tractor_t2 + plough_s ploughed exactly the swept strip (8 cells over 7.3 m), and `crops:worked` carried parcelId/areaM2. My harness's tractor stopped after 7 m, which I think is a control-staleness issue in the harness, not crops.
- Characters: hoe/water/seed act on the crops grid through `work()`.
- Determinism: same seed gives the same digest. Model save/load is byte-identical in game.
- Day processing is incremental and cheap: 60 ha in about 38 steps of ≈ 1 ms.
