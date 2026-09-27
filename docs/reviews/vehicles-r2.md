# vehicles — review round 2
Score: 7/10   Pass: yes

Weighted toward mechanics in the FULL GAME. Crops is now registered, so implements work real crops fields.

Each r1 must-fix was re-verified with my own probes (scratch `r2a`–`r2f`), not with the builder's tests. The builder tests pass too:
- `drive.test.cjs`: ALL PASS
- `characters.test.cjs`: ALL PASS, 12 checks

Screenshots examined (all opened):
- shots/review/vehicles-r2/drive_camera.png, plough_field.png
- shots/review/characters-r2/enclosed_exit.png
- The rest of shots/vehicles/review-r2 (10 presets × times) were read from JSON only: 0 errors, ok=true.

Perf:
- Full game, live: frameMsAvg 5.8–6.6, p95 12.2–12.5.
- drawCalls are 61–74 while driving and ploughing a crops field, with rare terrain-streaming spikes of about 1,000.
- vehicles msAvg:
  - full game: 0.26–1.35, settling at about 0.35
  - showcases: working 0.90, convoy 1.26
- In budget.

Errors: 0 console and 0 page errors.
Contract: 0 issues. `addFuelPoint` is declared and implemented, all nine events are declared and emitted, and `listens: []` is correct.
Lint: OK.

## Verdict
Every round-1 must-fix holds up under my own probes:
- **Pause:** a paused t2 held on W moves 0 m and burns 0 L.
- **Exit refusals:** `exit()` above 1 m/s returns `null`, keeps the driver and toasts "Stop to get out". A boxed-in rig returns `null` with "No room to get out here".
- **E and H:** E with a trailer attached no longer uncouples it; H uncouples and re-couples.
- **Harvest by crop kind:**
  - a combine in ripe potatoes takes 0 kg
  - a combine in wheat takes 74.5 kg
  - a root harvester in potatoes takes 94.2 kg
- **Engine off:** an unattended driven tractor switches off after 5 s, with 0 L burnt over the next 10 s.
- **Fuel points:** G in open grass gives 0 L plus a "drive to a fuel point" toast. After `addFuelPoint` it gives 240 L for €275.51.
- **Real crops field:** ploughing works it at 7.8 km/h.

Runs are identical across fresh pages. The driving core from r1 (speeds, water, hitching, lights) is intact.

It passes. Two caveats remain:
- The "exact save/load replay" claim is not true in the full game.
- The exit-refusal contract, although correct and documented, is misread by its only consumer (characters). That produces a ghost driver in the game. The bug lives in characters (must-fix 1 there), but vehicles' own integration test should have caught it.

## Must fix
None blocking in this module. See Should fix 1 for the shared exit seam.

## Should fix
1. **Make exit refusals unmistakable, and test the seam.**
   - `exit()` returns `null` both for "not driving" and for "refused", and characters currently treats `null` as success. That leaves the ghost driver: the tractor keeps `driverId` for ever and nobody can enter it again.
   - Keep `null` if you like, but add the refusal cases to `tests/characters.test.cjs`:
     - F at 27 km/h
     - F with the rig boxed in
     - then assert that `driverOf(v)` and the character's `vehicleId` agree (both set or both cleared), and that re-entry works
   - That test would have caught the break. Optionally also expose `exitBlockedReason(id)`, or emit nothing but return `{refused:'speed'|'blocked'}`, so callers can tell the cases apart.
2. **Save/load is still not bit-exact in the full game.**
   - `ctlStep` is in `SAVE_SKIP`. Vehicles updates before characters, so the first step after `load()` sees stale controls: brake = 1, and the engine age check fails.
   - A 860-step replay then diverges from the uninterrupted run:
     - about 1–2 cm in my mixed-page run
     - 3e-7 m and 5e-5 L in a vehicles-only reload
   - The drive test passes only because it steps by hand with fresh controls. Fix: persist `ctlStep` relative to `stepCount` (or `ctlHold` for one step after load), and save `stepCount`.
3. The HUD card sits over the vehicle when the characters camera leads north (drive_camera.png). Coordinate with characters/ui: a compact HUD or a left slot, and hide the hand-tool bar while driving.
4. **A new player can't refuel anywhere yet.** The farmyard only refuels from farm diesel stock, and the current full game has no fuel point and no farmyard surface. Until demo places a pump, G works nowhere. Note it for demo, or seed a default pump near the start farm.
5. The walker collision with the new oriented `polys` was not independently verified here. Characters' `collide()` still pushes out along the AABB (`it.x0…`) after `queryCircle` matches the poly. At a diagonal tractor, the walker can snap to the AABB edge. Make sure the push-out uses the polygon.
6. Cosmetic:
   - The plough's bottoms still float in a line with a thin red beam and no frame (plough_field.png).
   - The type label "combine l" comes from characters' `vehicleLabel`; `types()` could expose a short display name.

## What works
- Pause gating on `world.time.paused`: no drive, fuel, wear or work while paused. Showcases still animate.
- Exit safety: no exit above 1 m/s and no exit without a free spot. The driver is kept, and a toast explains why.
- Controls:
  - E only lowers or couples; H uncouples and couples the nearest free implement to a free hitch
  - stale controls apply a parking brake, never a reverse
  - the engine switches off after 5 s unattended
- Crops integration:
  - harvest is gated by crop kind (combine: cereal/oilseed/maize; root harvester: root crops)
  - a plough on a crops field ploughs cells at 7.8 km/h
  - yield fills the tank or bunker
- Fuel logistics:
  - `addFuelPoint` is saved
  - G works only at a pump (stock first, then purchase) or on the farmyard (stock only), with a clear toast otherwise
- Deep-water probes now check both corners and the centre, and the rear of the rig when reversing.
- `list()` returns copies and `get()` is live, and both are documented.
- Deterministic across fresh pages, with 0 errors across about 12 full-game runs.
