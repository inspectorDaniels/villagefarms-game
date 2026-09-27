# vehicles — review round 1
Score: 6/10   Pass: no

Weighted toward mechanics in the FULL GAME, per the current priority. Cosmetic points are under Should fix.

The full game spawns **no vehicle**: `vehicles.list()` is empty after boot, and there is no road network either. Every test spawned rigs through `vehicles.spawn/attach` (and one regional road through `roads.addNode/addEdge`) from `page.evaluate`. Spawning belongs to `demo`, so that gap is noted, not scored.

Builder tests: `drive.test.cjs` ALL PASS (24 checks) and `characters.test.cjs` ALL PASS (12 checks). My own scripted runs are in the scratchpad.

Screenshots examined (all opened):
- shots/review/vehicles-r1/drive_grass.png, plough_open.png, lake_edge.png, night_drive.png
- shots/vehicles/review-r1/default_1230.png, working_1230.png, night_2330.png, closeup_0700.png
- shots/review/characters-r1/keys_run.png
- Not visually judged (JSON only, or not opened): live_plough, ploughing, road, river_edge, and the remaining presets/times in shots/vehicles/review-r1. The JSON shows 0 errors and ok=true.

Perf:
- Full game, t2 tractor + 3 m plough ploughing (live): frameMsAvg 7.5–15, p95 15.6.
- Module msAvg: 0.62 while ploughing in the full game, 0.33 with 8 idle rigs.
- Update cost measured directly: 0.15 ms/step with 8 vehicles and one ploughing. `drive.test` reports 0.28 ms per step for 8 rigs.
- Showcase msAvg: 1.04–1.06.
- drawCalls average 50–80, **but spike to 1096–3161 while ploughing without crops** (terrain chunk repaints triggered by `fallbackPaint` every 2.4 m). The spikes breach the 2500 budget; see Should fix.
- Headless ran at 6–11 fps, so the numbers are inflated by 4 sim steps per frame.

Errors: 0 console and 0 page errors across every run, including 400 steps of key spam and bad-id API calls.
Contract: 0 issues.
- All nine declared events are emitted (seen live: `entered/exited/attached/detached/worked`).
- `listens: []` is correct.
- Optional deps are null-checked.
- There is no foreign-namespace write and no cross-folder import.

Lint: OK.

## Verdict
The driving core is good. Measured on a t2:
- 26 km/h on wet grass, 39 km/h on a regional road
- ploughing capped at 7.8 km/h, 44 km/h for the pickup on grass
- the rig stops cleanly at the lake shore and at the river (`blocked: 'water'`)
- the trailer articulates, the E-lowered plough really paints ploughed strips
- fuel burns about 24 L per machine-hour ploughing (48 L per real hour at 2× machine time) against about 5 L/h idling
- running out of fuel kills the engine, and G refuel charges diesel through simulation
- lights come on after dark

It is bit-identical across fresh runs for the same input, and save/load mid-drive keeps the driver, the lowered implement and the speed. The HUD card is clear, and the painted machines are readable (default_1230, night_2330).

What holds it back is a handful of player-facing holes:
- driving and ploughing continue while the game is paused
- you can bail out at 26 km/h and let the tractor roll over your own exit spot
- the exit API ejects the driver even when it has found no free spot
- E silently uncouples a trailer

## Must fix
1. **Pause is ignored.**
   - With `clock.paused = true` a player-driven t2 moved 18.5 m in 5 s and burnt fuel.
   - A lowered implement keeps calling `crops.work` / `terrain.paintSurface`, so a whole field can be ploughed in zero game time.
   - Fix: skip `driver.step` while `world.time.paused` is set by the user. Do not gate on `clock.paused`, which also includes the showcase `frozen`.
2. **Exit at speed.**
   - `exit()` works at any speed. At 26 km/h the driver is placed at the door and the driverless rig rolls on about 4 m. The walker ended 1.3 m from the tractor's centre, inside its footprint.
   - Fix: refuse exit above about 1 m/s (the HUD should say "Stop to get out"), or brake to a stop first and compute `exitPosition` after the rig is stopped.
3. **`exit()` ejects the driver even with no free spot.**
   - When `exitPosition` falls through, it returns `{x, y, blocked: true}` next to the door, which can be water or a solid.
   - `exit()` still clears `driverId` and emits `vehicles:exited` with that spot.
   - Fix: return `null` (or `false`) and keep the driver when the position is blocked. Characters will then show a message.
4. **E uncouples a trailer.**
   - `control({implementDown: 'toggle'})` falls through to `hitchNearest()` when nothing can be lowered. With a grain trailer attached that **detaches** it (verified: `attached ['vehicles:2']` → `[]` after one E).
   - The HUD says "E lower/raise · H hitch", so E must only couple (or do nothing). Uncoupling belongs to H.

## Should fix
- **Occupied but unattended vehicles idle forever.** A driver who is not the active character (after Tab, or a hand at night) keeps `engine = true` and burns about 10 L per real hour indefinitely. Switch the engine off when the controls have been stale for more than a few seconds.
- **Refuel anywhere.** G refuels to full in the middle of a field (250 L for €287). Tie refuelling to the farm yard or a fuel point (for example within X m of a `simulation.sellPoints` fuel station or a farm tank) so fuel matters as a logistics constraint.
- **Fallback painting is too frequent.** It calls `terrain.paintSurface` every 2.4 m and causes drawCall spikes up to about 3100. Batch strips (for example every 8–10 m, or per 0.5 s), or coordinate with terrain's repaint throttling. This vanishes once `crops` is registered, but the fallback is live in the current full game.
- **Save/load is not bit-exact.** Replaying the same 860 steps after `load()` diverges by about 0.1 mm, because runtime caches (`_sx/_sy` surface sampling, the driver `stepN % 12` phase) are dropped. Either resample deterministically after load or persist the phase.
- The deep-water probe checks only the leading-edge centre. The bonnet visibly sits over open water at the shore (lake_edge.png), and a reversing implement is never probed. Probe both front corners and the rear of the rig when reversing.
- `list()` returns the live records (`W.list.slice()`), so any caller can mutate physics state. Return copies, or document it as read-only as `get()` is.
- `nearest()` includes occupied vehicles by default. This is fine as an API, but see characters must-fix 3.
- Cosmetic:
  - The plough's bottoms float in a line with a thin red beam and no frame or shadow (closeup_0700, plough_open). Give it a frame bar and per-bottom AO.
  - The fallback ploughed strip renders near-black with stepped segment seams (plough_open.png).
  - The HUD card sits over the hand-tool toolbar, which is irrelevant while driving. Ask ui to hide the tool bar while the driving card is shown.

## What works
- Kinematic bicycle driving:
  - steering is rate-limited, with less lock at speed
  - S brakes, then reverses
  - sub-stepped collisions stop the rig at solids and at map bounds
  - water blocking works at the lake and the river
- Tuned speeds line up with `simulation.workRates().kit` (single source, r3): plough 3 m at 8 km/h. `workRate()` exposes the same numbers for AI and economy use.
- Fuel, wear and repair costs flow through simulation. Out of fuel stops the engine.
- Hitch and attach:
  - a trailer's articulation is clamped (63° max in the test), and the tongue length is exact
  - rigs are solid for walkers
- Night: two headlight cones, tail lights, auto-lights on entering after dark (night_drive.png).
- Robustness:
  - save/load round-trips in either load order
  - loading an empty list with a character mid-drive is handled
  - bad ids and NaN input return null/false without errors
