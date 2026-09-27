# characters — review round 1
Score: 6/10   Pass: no

Weighted toward mechanics in the FULL GAME, per the current priority. Cosmetic points are under Should fix.
Everything below was checked in the registered full game (`registry.js` wave 2), using scripted puppeteer runs
with `engine.step` and synthetic `input.press`, plus real `page.keyboard` runs. Scratch scripts only.

Screenshots examined (all opened):
- shots/review/characters-r1/game_walk.png, game_tools.png, game_tab.png, night_sleep.png, keys_run.png (`tools/shot.js --keys "KeyD:1500,KeyS:1000,Tab,KeyE,Tab,Digit3,KeyE"`)
- shots/characters/review-r1/default_1230.png, walk_1230.png, crowd_1230.png
- shots/review/vehicles-r1/lake_edge.png and night_drive.png, for the exit and enter hand-over
- The other 17 files in shots/characters/review-r1 were read from JSON only: 0 errors, ok=true on all.

Perf:
- Full game, 2 characters: frameMsAvg 7.7–8.4, p95 20.8–27.8, drawCalls 52–72.
- Module msAvg:
  - 0.93 at steady state with 2 characters
  - 0.38 while driving
  - 1.82 with 22 characters (20 villagers)
- Update cost measured directly: 0.04 ms/step with 2 characters, 0.14 ms/step with 22.
- Showcase msAvg: default 0.97, crowd 1.25.
- Headless ran at 6–11 fps, so each frame includes 4 sim steps. msAvg is therefore inflated.
- Result: in budget.

Errors: 0 console and 0 page errors, across about 10 full-game runs and 20 showcase shots, including 400 steps of key spam (F/Tab/E/W/H/G/L/U).
Contract: 0 issues. Emits `switched/spawned/interact/despawned`, and every one of them is emitted. The listens are all used. There is no cross-module write and no cross-folder import. Every optional dep is null-checked, and bad ids return false/null.
Lint: OK.

## Verdict
This is a solid, thoughtful controller. Walking, running on stamina, surface speeds, deep-water blocking, the hoe → `soil` → seed → water loop, Tab with a smooth eased camera hand-over, F into and out of a tractor, presence jobs (4 % after 20 real seconds on site, label shown), hiring and firing synced with simulation, sleeping near home with a lantern, and save/load mid-drive and mid-switch all work in the full game. The 400-step key spam left vehicle and character state consistent.

But three things break the game for a player. The world keeps running when the game is paused. The hired hand, the core of the r3 design, does nothing visible when you delegate a job to him. And F refuses a free tractor when an occupied one is nearer. The animation, portraits and prompts read well. The people are small and low-contrast in rain at the default 46 px/m.

## Must fix
1. **Pause is ignored.**
   - With `clock.paused = true`, the active farmer walks 2.7 m in 2 s, the hired hand wanders 1.9 m, and tools still paint soil.
   - Every AI and villager keeps moving while game time is frozen. That is free labour on pause.
   - Fix: skip the sim part of `update()` (movement, AI, tools, stamina, presence) when `world.time.paused` is set by the user.
   - Do not gate on `clock.paused`, which also includes `frozen`, or the showcases will freeze.
   - Keep the cosmetic `frame()`.
2. **Delegated jobs are invisible.**
   - Steps: `simulation.assignJob('simulation:job:1', 'simulation:worker:1')`, then run 30 s.
   - Result: Dries (workerId `simulation:worker:1`) stays `idle` at home, 385 m from the job at (376, 862).
   - Hired hands are the r3 scaling mechanism, so the player must see them go and work.
   - Fix:
     - Poll `sim.jobs()` for `assignee === c.workerId`.
     - Give the hand a `goto` → `work` task at the job's coordinates, and show "On a job" in the portrait bar.
     - Send him back when the job completes or fails.
     - Do not also call `tickPresence` for a presence job that simulation is already working abstractly for that worker. That would count the work twice.
3. **F picks an occupied vehicle and blocks a free one next to it.**
   - Setup: a hand drives tractor A, and the player stands 0.8 m from A and 2.2 m from a free tractor B.
   - Result: `nearVehicle()` gets A from `vehicles.nearest(x, y, 3)`, rejects it for `driverId`, and returns null. There is no prompt, and F does nothing.
   - Fix: call `nearest(x, y, 3, { free: true })`. Use it for both the prompt and F.
4. **Exit trusts the returned position blindly.**
   - `toggleVehicle` applies `veh.exit()`'s `{x, y}` even when it carries `blocked: true` (no free spot).
   - The fallback, when `exit` returns nothing, puts the farmer at `v.x - cos(rot)·1.8, v.y - sin(rot)·1.8`. With rot 0 = north that is the vehicle's west side, not its rear.
   - Fix: if the result is `blocked`, stay in the vehicle and show "No room to get out" (needs the matching vehicles fix). Fix the fallback to `(x - sin·d, y + cos·d)`, or drop it.

## Should fix
- **Driving camera.** The camera stays at 46 px/m, so a tractor at 40 km/h sees about 10 m ahead (1 s). Zoom out smoothly with speed (for example to about 20 px/m at road speed) and add a small look-ahead, then restore the zoom on exit (shots: drive_grass, night_drive). Entering currently snaps the camera up to 3 m with no hand-over blend.
- **Tool keys pressed during an animation are dropped.** `setTool` returns false while `c.action` is playing, so pressing `2` during the seed dip silently does nothing. Buffer the choice and apply it when the action ends.
- **A hand left in a vehicle stays in it forever.** After Tab, he keeps state `driving` all night (tested at 22:30), and vehicles keeps the engine on and burns fuel. At night, or after N minutes unattended, the AI should get out and go to bed.
- **The night walk home is real-time.** Home is the spawn point, reached at 1.4 m/s. From 500 m away the hand walks about 6 game-hours at 1×, and at 10× he never arrives before dawn. Run when far, or send him "home" abstractly beyond about 80 m.
- **The job-site prompt is hidden by the tool prompt.** At the site the prompt reads "E — Hoe the grass" instead of "On the job: Mind livestock (4 %)". Give the job line priority when standing on a site with nothing sensible to hoe.
- `assignTask` accepts unknown kinds (`{kind:'bogus'}` returns true). Validate against the task list.
- README "Known limitations" still says `registry.js` does not list characters. It does.
- Cosmetic:
  - At 46 px/m in rain the farmers are dark blobs about 25 px across (keys_run.png, game_tools.png). Add a slightly stronger rim or ring contrast on the active character in low light.
  - Hand-tilled cells read as flat black squares (game_tools.png).
  - Villagers at 24 px/m are specks and cut across the junction asphalt (crowd_1230.png).
- The crowd cost of 1.8 ms at 4 steps/frame is close to the per-module budget. Cull AI to about 5 Hz for villagers out of view.

## What works
- Movement:
  - speeds match the brief (1.4 / 3.5 m/s)
  - acceleration feels snappy
  - deep water > 0.5 m blocks walkers, who slide along the shore; wading works (lake_edge.png)
  - parked vehicles block walkers
- Switching:
  - Tab eases the camera over about 0.5–1.6 s
  - the portrait bar updates
  - a hand you leave keeps idling near where you left him
  - Tab onto a sleeper wakes him
- Tools give a correct, contextual prompt ("E — Hoe the grass/verge/yard", "Seed needs tilled soil (hoe first)", "Too tired"). The hoe really paints `soil`, and the seed and water plots persist in save data.
- Vehicle integration:
  - F enters, and WASD/E/L route to `vehicles.control`
  - a Tab while driving leaves the tractor braking safely (15 → 1 km/h in 2 s), and you can Tab back and drive on
  - a hand cannot steal an occupied tractor
- AI:
  - `goto` arrives within 0.24 m
  - `work` hoed 6 cells in 25 s
  - hands sleep on a bedroll with a lantern near home and wake at 06:00 (night_sleep.png)
- Presence jobs tick at game rate via `tickPresence` and show a world label.
- Hire and fire:
  - `hire()` charges through simulation
  - firing via `simulation.fireWorker` despawns the character within 2 s
- Save/load round-trips mid-drive, mid-switch and against an empty vehicle list: a dangling `vehicleId` is cleared, with no crash.
