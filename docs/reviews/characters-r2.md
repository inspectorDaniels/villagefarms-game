# characters — review round 2
Score: 6/10   Pass: no

Weighted toward mechanics in the FULL GAME (the registry now has crops, vehicles and characters).

Every claim was re-verified with my own puppeteer probes (stepped runs plus real `page.keyboard` runs). The scratch scripts are `r2a`–`r2f`. They ran against commit 343fc5b (characters r2) plus fe12a0d (vehicles r2).

Screenshots examined (all opened):
- shots/review/vehicles-r2/drive_camera.png: full game, 27 km/h heading north. The tractor sits under the prompt and the HUD card.
- shots/review/characters-r2/enclosed_exit.png: F in an enclosed tractor. The toast says "No room", but the farmer is outside anyway.
- shots/review/characters-r2/delegated_site.png: the delegated hand miming at the job site, with the portrait showing the jobs icon.
- shots/review/vehicles-r2/plough_field.png
- shots/characters/review-r2/default_1230.png
- ghost_exit.png was written by the probe but not opened. The rest of shots/characters/review-r2 (10 shots) were read from JSON only: 0 errors, ok=true.

Perf:
- Full game, live: frameMsAvg 5.8–6.6, p95 12.2–12.5.
- drawCalls are 44–74, with occasional terrain tile streaming spikes of about 1,000 while driving.
- characters msAvg: 0.10–0.82 while walking or driving in the full game, 1.01 in the default showcase, 1.17 in the crowd showcase.
- In budget.

Errors: 0 console and 0 page errors in every run.
Contract: 0 contract-check issues, and `isAvailable` is declared and implemented. **But see Must fix 2: `positionOf` no longer honours its documented meaning.**
Lint: OK.

## Verdict
Most of round 1 is genuinely fixed, and I verified each one:
- **Pause:** with `world.time.paused`, walking moves 0 m, the hand moves 0 m, and E, F and Tab are inert.
- **Delegation:** a hand with `assignJob` gets a delegated `work` task, runs to the site, and mimes there. The portrait shows the jobs icon. `failJob` releases him, and at night he sleeps, then resumes in the morning.
- **Free vehicles:** F picks the free tractor beside an occupied one.
- **Tools:** tool keys are buffered.
- **Night:** a hand left in a tractor gets out and goes to bed at 21:45.
- **Tasks:** `assignTask` rejects unknown kinds.
- **Driving camera:** it eases from 46 to 30 px/m at 27 km/h, and the zoom comes back on exit.

The exit seam with vehicles is now broken worse than in round 1. When vehicles refuses an exit (moving faster than 1 m/s, or nowhere to stand), it returns `null` and keeps the driver. This module reads `null` as "exited" and teleports the farmer 2.2 m behind the machine. The result is a **ghost driver**: the character walks free while the tractor still lists them as `driverId`. Nobody can ever enter that tractor again.

Part of this is my fault. In r1 I told vehicles to "return null and keep the driver" and told characters to check `blocked`. The two fixes followed my inconsistent advice and don't meet.

Add to that a `positionOf` that now returns a point up to 14 m ahead of the vehicle, and a look-ahead that parks the tractor under the HUD when you drive north. The player-facing experience is not yet at a pass.

## Must fix
1. **Ghost exit (game-breaking).**
   - Repro 1, speed:
     - full game, real keyboard: drive a t2 to 27 km/h and press F
     - the farmer is out and walking; the tractor has `driverId: 'characters:1'` and rolls 7.6 m
     - there is then no "F — Enter" prompt, and F next to it does nothing, for ever (shots: ghost_exit, not opened)
   - Repro 2, enclosed:
     - enter a tractor boxed in by combines; `exitPosition` returns `null`
     - F shows vehicles' toast "No room to get out here"
     - the farmer is still placed at (190, 182.2), inside a combine's collider, and the tractor keeps the driver (enclosed_exit.png)
   - Fix in `toggleVehicle`:
     - treat a falsy `exit()` result as **refused**: stay seated and return false
     - afterwards, confirm the result with `veh.driverOf(vid) === c.id`
     - delete the rear-fallback teleport, or use it only when vehicles reports the driver really cleared
   - The same path is used by the hand's night and idle auto-exit, so a blocked hand becomes a ghost too.
   - Also make `vehicles:exited` the single source of truth: only clear `vehicleId` there.
2. **`positionOf()` contract bug.**
   - The brief defines `positionOf(id)` as the character's position. The r1 README said "Returns the vehicle position while driving".
   - It now returns `camTarget()`, the camera look-ahead point:
     - 8.1 m ahead of the tractor at 26.6 km/h (measured)
     - up to 14 m by the code
     - the builder's "2.3 m" claim is wrong too
   - `get(id)` still returns the true seat position, so any consumer of `positionOf` (AI followers, audio, jobs, the demo) gets a phantom point in front of the machine.
   - The vehicles builder had to change its own integration test from `positionOf` to `get` to keep it green. That is the tell.
   - Fix: `positionOf` returns the vehicle or character position. Keep the look-ahead private to the camera.
3. **The look-ahead hides the vehicle under the HUD.**
   - Driving north at 27 km/h, the camera leads 7.4 m at 29 px/m. That pushes the tractor about 215 px below centre, exactly under the "F — Get out" prompt, the vehicles HUD card and the toolbar (drive_camera.png: only the bonnet is visible).
   - Fix, either or both:
     - bias the look-ahead so the vehicle stays in the upper 60 % of the screen (clamp the southward component of the camera offset, or offset the whole view up by the HUD height)
     - hide the hand-tool toolbar while driving

## Should fix
- **Delegated hands walk the whole map in real time.** A hand 432 m from a job was still 114 m short after 90 real seconds (1.5 game hours, running). At 10× he never gets there before the day ends. The walk home already jumps when both ends are off-screen; do the same for the trip to the job site.
- **After `jobs:failed`/`jobs:completed`, the hand idles at the job site.** `dropSite` sets `{kind:'idle'}`, which pre-empts `syncDelegation`'s "run home" branch. Send him home, or back to his pre-job task.
- **Save/load is not bit-exact.** `characters.save()` does not persist anything that lets vehicles re-arm `ctlStep`. After a mid-drive load, the first step is "stale", and the replay diverges by about 1–2 cm. See the vehicles review; this is a shared fix.
- `vehicleLabel` produces "Enter combine l" and "combine s". Map the types to names (`vehicles.types()[t].name`, or a short label).
- The hand-tool toolbar still shows while driving, and the vehicles HUD card overlaps it.
- `isAvailable()` uses a hard-coded 21:45–06:00 night instead of the AI's sleep state alone. That's fine for now, but document that it returns false for a hand pinned to night work.

## What works
- Pause gating on `world.time.paused` (the showcase `frozen` flag still animates).
- Delegated jobs:
  - the hand goes to the site and mimes the job tool without touching the world
  - presence is not double-ticked (progress came only from simulation's abstract work)
  - the portrait shows the jobs icon
  - the job pauses overnight and the hand resumes it in the morning
  - `failJob` releases the hand
- The free-vehicle `nearest` fixes r1's blocked-entry case: the prompt reads "F — Enter tractor" for the free one.
- Buffered tool keys: a tool picked during a swing applies when the swing ends.
- Night and unattended exit from vehicles.
- `logWork` links wages to real activity, and `hire`/`fire` stay in sync.
- The driving zoom eases smoothly to about 30 px/m with speed and restores on exit.
- Showcases are unchanged: default_1230 is clean, and all 10 shots report 0 errors.
