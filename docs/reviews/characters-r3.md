# characters — review round 3
Score: 7/10   Pass: yes

Weighted toward mechanics in the FULL GAME: terrain, environment, roads, simulation, ui, audio, effects, crops, vehicles and characters.

Verified at commit 5a13498 with my own probes (scratch `r3a.js`, `r3b.js`):
- `r3a.js` drives the game with the real `page.keyboard` on a live engine.
- `r3b.js` uses stepped `engine.step` with synthetic keys.

Screenshots examined (all opened):
- shots/review/characters-r3/drive_north.png: t2 at 27 km/h heading north. The tractor is fully visible, and the hand-tool bar is gone while driving.
- shots/review/characters-r3/enclosed_exit.png: F while boxed in by combines. "No room to get out here", and the farmer stays seated.
- drive_turn.png was written but not opened.
- shots/characters/review-r3/*_1230 (5 presets) were checked from JSON only: 0 errors, ok=true, 0 contract issues.

Perf:
- Full game, live: frameMsAvg 5.1, p95 9.5, drawCalls 148 with 9 vehicles on screen.
- characters msAvg: 0.14 in the full game, 0.49 in the default showcase, 0.68 in the crowd showcase.
- In budget.

Errors: 0 console and 0 page errors in every run, including 600 steps of mixed F/W/Tab/E/D/S key spam.
Contract: 0 issues. `positionOf` again honours the brief.
Lint: OK.

## Verdict
Every round-2 must-fix is fixed, and I verified each one with the real keyboard:
- **Ghost exit gone:**
  - F at 27.1 km/h, pressed twice, leaves the farmer seated. The tractor keeps `driverId`, and characters keeps `vehicleId`.
  - Braking to a stop and pressing F gets out cleanly, and F again re-enters.
  - Boxed in by eight combines, F shows vehicles' toast and the farmer stays in the seat, with no rear teleport.
  - A hired hand boxed in at night stays seated. Once the combines are removed he gets out and goes to sleep.
- **`positionOf`** returns the vehicle's exact position while seated (for example (150, 134.81) with the tractor at (150, 134.81)) and the character's position on foot.
- **The camera** leads about 2 m at 27 km/h with the zoom easing to about 29 px/m. The tractor sits 59 px below centre, clear of the prompt and the HUD card (drive_north.png). The hand-tool bar hides while driving and returns on exit.

The consistency sweep is clean:
- after key spam, and after save → load, every `character.vehicleId` agrees with `vehicles.driverOf`
- pause still freezes movement (0 m)
- delegated hands jump the 386 m to a far job when both ends are off-screen, and run home after `failJob`

This is now a dependable controller for the multi-character loop.

## Must fix
None.

## Should fix
- **The prompt still reads "F — Get out" at 27 km/h**, where F is refused (vehicles only toasts "Stop to get out"). Show "Stop to get out" (no key) while `|speed| > 1 m/s`, so the prompt never lies.
- **A hand who can't get out retries every step.** The night/idle auto-exit calls `vehicles.exit()` → `exitPosition()` (spatial queries) on every 60 Hz step while he is boxed in. It's cheap (the whole sim step measured 0.15 ms), but throttle it to about 1 Hz.
- The job-site jump is binary: more than 120 m away and off-screen means an instant arrival. A hand the player happens to watch walks the whole way. That's acceptable, but consider a fast-travel "cart" or a run-and-fade after about 40 m on screen.
- Save/load replay drift (1–2 cm after a mid-drive load) is still the vehicles `ctlStep` issue, so not scored here.
- Carried from r1 (cosmetic): the farmers are small and low-contrast at 46 px/m in rain, and villagers at 24 px/m are specks.

## What works
- Possession, Tab hand-over, walking and running with stamina, surface speeds, water blocking, and the hoe/seed/water loop. Tool keys are buffered mid-swing.
- The vehicle seam:
  - free-vehicle entry, with prompt names from `types()` ("Enter 180 hp tractor", "Enter Large combine")
  - refused exits are respected, and `vehicles:exited` is the single path that clears the seat
  - the speed-scaled zoom and look-ahead are capped away from the HUD band
  - a hand left alone gets out after 30 min or at night
- Hands and jobs:
  - delegated jobs are shown (the hand travels and mimes, the portrait shows "On a job"), with no double presence ticks
  - after a job the hand returns to his previous task or goes home
  - wages come from real activity via `logWork`
  - `isAvailable` works
- Pause on `world.time.paused`, and save/load round trips with consistent seat state.
