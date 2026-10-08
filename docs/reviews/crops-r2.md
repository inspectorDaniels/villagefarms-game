# crops — review round 2
Score: 7/10   Pass: yes
Screenshots examined: shots/review/crops-r2/closeup-z32.png (own test fields: rapeseed in bloom and a ploughed strip, 32 px/m, after the half-resolution field layer), plus a demo-farm view at 24 px/m (session scratchpad; it showed only meadow, so it is not used for judging)
Perf (headless, 1600×900):
- **tests/pan.cjs A/B** (18 fields, each render part toggled off/on 3× in alternation). Δ frame avg / p95, then crops msAvg:

  | scenario | Δavg | Δp95 | crops msAvg |
  |---|---|---|---|
  | static z6 | +1.0 | +0.76 | 0.28 |
  | static z12 | +0.98 | +1.46 | 0.18 |
  | static z24 | +0.52 | +0.6 | 0.14 |
  | pan z12 at 8 px/frame | +1.52 | +2.27 | 1.45 |
  | follow z24 at 3 m/s | +0.94 | +0.7 | 0.80 |

- **My own A/B on the real demo farm** (plain URL; `?cropsoff=ground,sway,collect` vs on; 2 page loads each, alternated). All frame averages are 5.5–10.9 ms, with p95 ≤ 18.2 ms:

  | view | frame avg off → on (ms) | Δ | crops msAvg |
  |---|---|---|---|
  | player view | 6.6 → 6.3–6.8 | noise | 0.09 |
  | z8 static | 6.3–6.4 → 6.4–6.6 | ≈ +0.2 | 0.15 |
  | z8 pan | 9.6–10.1 → 10.7–10.9 | +0.8 to +1.3 | 0.27 |
  | z24 static | 5.6–5.8 → 5.5 | 0 | 0.08 |
  | z24 pan | 7.7–7.9 → 7.6–8.1 | 0 | 0.14 |

- In r1, z24 static was 50–55 ms vs 5 ms without fields. It is fixed.

Errors: none; 0 console errors in all runs. Bad polys now give 3 distinct `[crops] createField` warnings and return null.   Contract: 0 issues   Lint: OK. `season.mjs` ALL PASSED.

## Verdict
All three round-1 blockers are fixed, and I verified them in the full game with my own probes rather than the builder's numbers.
- **Perf:** the half-resolution field layer moved the close-zoom cost from about +45 ms to under 1 ms. The worst case, a fast pan, now sits at the per-module budget (1.45 ms msAvg, about +1.5 ms of frame time). On the real demo farm the crops cost is mostly lost in noise.
- **CAP:** the per-cell, per-operation stamps stop the CAP farming in every variant I tried: alternating tools, mixed tools, after a save/load, and after a parcel change.
- **Save/load:** the core save/load (`G.game.saveToStorage`/`loadFromStorage`) round-trips crops byte-identically.

What is left is small edge leaks and cosmetics, so this passes, at the bottom of "good". The close-up tiling and plain overview art keep it at 7.

## Must fix
None blocking.

## Should fix
1. **The CAP-year rollover leaks the last batched event into the new year.**
   - I ploughed about 32 m² at doy 26 23:58. The batched `crops:worked` was emitted after midnight, after simulation had paid CAP and reset `worked`. So it was credited to the new CAP year (`worked: {plough: 32}` straight after the rollover).
   - Crops had stamped those cells in the old year, and the stamps cleared at rollover. The same cells were credited again when re-worked in the new year.
   - The leak is bounded by 60 game-s of work. Fix: force `model.flush(t, true)` when the day changes, before simulation's `clock:day` CAP payment, or at least when `capYearOf` changes.
2. `removeField` + `createField` over the same poly resets the stamps. I re-ploughed the same 48 m² and `worked.plough` went 48 → 96. This is API-only today (demo creates fields only at setup), but stamps could be keyed by parcel, or carried over when a new field overlaps a removed one on the same parcel, before any player-facing "redraw field" tool exists.
3. **Close-up tiling.** At 32 px/m (closeup-z32.png) rapeseed in bloom shows an obvious repeating square pattern on the 2 m cell grid. Add more tile variants, or randomise rotation/offset per cell.
4. **Save size.** Crops is 5.04 MB of the 5.15 MB raw demo save. It gzips to 846 KB and saves fine through `saveToStorage`, and the README (~100 KB/ha) is now accurate. Quantising the float arrays to Uint8 would still cut it about 3×.
5. **Spray value.** The weed seed bank works. On a fresh field over one season, unsprayed wheat gives 8.13 vs 8.59 t/ha, about €97/ha against a €95 input, so spraying breaks even in year 1 and pays more as the seed bank grows. That is fine; just keep the builder's multi-year +€134/ha claim reproducible from a test.

## What works
- **CAP stamps** (demo farm, rented 1.8 ha parcel):
  - Alternating plough/cultivate 20× on a 48 m² strip gives `worked {plough:48, cultivate:48}`, capShare 0.0027.
  - Eleven further passes with fertilise/spray/water/seed/harvest/mow/rake/bale/plough leave the share unchanged.
  - Save → load → 5 more alternating passes leave it unchanged.
  - Stamps also reset on `land:parcel-changed`.
- **Batched events:** with the clock paused, `crops:worked` is emitted at once (1 event, credited 40 m²). `G.game.save()` flushes the pending batch: cultivate credit appeared right at save.
- **Bad input:** `createField(null | [] | NaN point | collinear)` returns null with a warning, without throwing or counting as a module error.
- **Core save/load:** `saveToStorage` → `forceStage` → `loadFromStorage` restores crops state exactly (digest equal, field back to stubble).
- **Round-1 behaviour still holds:** the state machine, yields vs `yieldTable`, jobs, contractors (`contractor:true`, so no double count), vehicle and character `work()`, and determinism. `season.mjs` passes, and growth still responds to rain and fertiliser: dry 7.48 vs 8.59 t/ha, unfertilised 6.57.
