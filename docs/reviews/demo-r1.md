# demo — review round 1
Score: 6/10   Pass: no
Screenshots examined: shots/review/demo-r1/01_start.png, 02_tutorial20s.png, 03_ploughing.png, 06_jobs.png,
07_crew.png, 10_land_confirm.png, perf_village.png (also taken: 04_office, 05_sowing, 08_after_load, 09_build_panel,
11_built, perf_play, perf_farm, perf_overview)
Perf (headless, shared machine with other agents' Chrome running, so p95 is noisy; two runs):
play (default follow camera) avg 11.3–12.4 ms, p95 31–57; farm 4.6–7.4 / 10–14; **village 23.6–35.3 / 73–103**
(buildings module 6.6–10.3 ms); **overview 47.7–72.3 / 77–117** (terrain module **18.5–24 ms of JS**, roads 1.3–5.7).
Draw calls 99–379. Boot 3.6–4.7 s (≤ 6 s OK).
Errors: 0 console / page errors in all six sessions.   Contract: `__GAME__.contracts()` = [] .   Lint: `node tools/lint.js demo` → OK.
Determinism: two fresh loads → identical md5 over road graph, parcels, buildings, vehicles, field cell counts,
job offers, terrain sample and money (`0051528b…`, twice).
Save/load: `game.save()` 4.80 MB raw; `saveToStorage('critic')` 1.18 MB gzip in 634 ms; after a reload,
`loadFromStorage` took 411 ms and restored money, store, worker plus linked character, delegated job, field cells,
objectives, tractor pose and hitched implement. The before/after snapshot is byte-identical.

## Verdict
The composed game boots cleanly, is deterministic, and its save/load is solid. The core verbs all work through
real keys: walk, F into the tractor, E to plough, H to swap implements, G to refuel at the shed pump, J to accept a
job, K to sell the stored wheat, hire a hand and delegate a job, and B for build/land mode, where renting a parcel
and placing a coop worked. The problem is the first hour. Two of the six "Getting started" objectives are badly
paced or point the player at paths that do not exist. "Plough Lindeveldje" needs about an hour of real-time
straight-line driving, and 10× speed does not shorten it. The sell hint offers a trailer delivery that is impossible
at the start. A whole class of offered jobs (transport, deliver) cannot be progressed by the player at all. The
opening frame shows a farmhouse roof in the rain, with the tractor off-screen and the farmer hard to find. The
economy has an easy money hole: the granted pickup sells for €24.8k, 140 % of starting cash. Mechanically sound,
but not yet a good first hour.

## Must fix
1. **Transport and deliver jobs can't be completed by the player.** Nothing in the codebase calls
   `simulation.reportProgress` for `transport` or `deliver`. Only `crops` calls it, for area jobs, and `characters`
   only calls `tickPresence`, for presence jobs. These jobs make up a large share of the board: "Haul 13 t of winter
   wheat" at start, then "Haul 32 t straw €340", "Haul 70 t wheat €615" and "Deliver 2 loads fertiliser €345".
   Accepting one personally is a trap, because it just expires (06_jobs.png). Either wire them up (vehicles/buildings:
   trailer cargo picked up at the client farm and delivered with R at the target counts as progress) or have demo/sim
   stop offering them for personal work until that exists. The same applies to "Lift 0.82 ha potatoes": the player
   has no harvester. Mark these as "hand/contract only", or filter them.
2. **The plough objective takes about an hour of real time and 10× doesn't help.** Measured: 1.2 ha/real-h on pass 1
   (including start-up) and 1.94 ha/real-h on pass 2. Two 160 m passes made 4.8 % of the 1.8 ha field. Reaching the
   95 % threshold is about 55–75 real minutes with headland turns. Driving physics runs in real time, so 10× only
   burns game time: one pass at 10× cost 790 game-minutes, about 13 h of upkeep and rent. For objective #2 of a
   tutorial, use a small marked strip or headland (e.g. 15 %). Otherwise, tell the player in the hint that a hand
   (K → Hands) or a contractor (K → Fields, plough €198, 2 days) can finish it. Make sure those count toward the
   objective. Contractor completion → objective was not verified in this round.
3. **The sell hint offers a trailer delivery that can't be done at the start.** The hint reads "…or deliver a
   trailer at the co-op (R)". The grain trailer starts empty, and there is no way to load store grain into it:
   `buildings.deliver` only unloads into stores or sell points. The player owns no combine, and the first harvest is
   months away. Either let R at the barn load the trailer from the farm store, which would make the "avoid the 8 %
   pickup fee" advice real, or remove the trailer half of the hint for year 1.
4. **The granted kit sells for nearly full value.** `vehicles.sell('vehicles:5')` (the starting pickup) paid
   **+€24,811** on minute one. Starting cash is €17,664, and the pickup has no farm function. The tractor (€23.4k)
   and trailer (€9.9k) are equally liquid. Granted starting assets need a low resale (e.g. ≤ 50 % in year 1) or a
   lock, otherwise "money is tight" in the welcome toast is false.
5. **The opening frame doesn't show the player what to do** (01_start.png, 02_tutorial20s.png). The camera opens at
   about 40 px/m on the farmhouse roof, in rain at 07:02. The farmer reads as a small reticle above the ridge, and
   the tractor named in objective #1 is off-screen. Start at the planned 24 px/m (core request #5) or frame the
   farmer and the tractor together. Add a world label or arrow on the tractor until objective #1 is done.

## Should fix
- **Year-1 cash flow is not demonstrated in the live game.** With no actions, fixed costs are about €217 per game day:
  farmhouse upkeep €75/day, barn €27, shed €23, machines €32, insurance €32, rent €81 per 3-day month. That is about
  €7.8k per 36-day year against €17.7k starting cash. A 3-day fast-forward with one delegated €160 job went from
  €19,644 to €18,906. At 1× a game day is 24 real minutes, and a player-driven 0.57 ha plough job (€160) takes about
  20–30 real minutes, so personal contracting alone barely covers overheads. Add a scripted live check (year 1, at
  least 1 hand, jobs delegated) that shows the €35–60k year-end target from the simulation brief r2 is reachable.
  8 of the first offers expired unattended in 10 days.
- **Default seed is out of season.** The seed drill starts loaded with `barley`, but K offers only oats, sugar beet
  and grass in March. Default to an in-season crop.
- **Parking blocks the yard exit.** After hitching the seeder, driving straight on hits the grain trailer parked
  18 m behind it (`blocked:'solid'` at y 623.9). Park the trailer beside the implements, not in their exit lane.
- **Seed charging spams the ledger.** Charging is now done by simulation, once: an oats strip produced seed,
  fertiliser and spray rows totalling about €0.40 for 10 cells, and re-driving sown cells charged nothing. But it
  writes **3 ledger rows per coalesced event with "0.00 ha"**. A full 1.8 ha sowing would bury the Finances ledger.
  Aggregate per field per session or day (owner: simulation).
- **The buy dialog lets you buy land with nothing left.** "Buy Heiveld" with a mortgage leaves €25–80 cash (the
  dialog warns, good). A tutorial nudge toward renting (M / land mode) would help new players.
- **Perf.** The default play camera sits at the 12 ms budget. Village (24–35 ms, buildings 6.6–10 ms/frame) and
  overview (48–72 ms) are over it. In overview, **terrain spends 18–24 ms of JS per frame**, which contradicts the
  README's "< 1 ms in any module's JS" claim, so this is not just raster fill (owner: terrain; cache low-zoom
  chunks). It does not affect normal play at the follow camera but makes map-scale browsing choppy.
- **Starting job pay** is €280–340/ha for plough and sow work (Plough 0.57 ha €160, Drill 0.38 ha €130), well above
  the €80–110/ha in the simulation brief r2. This may be an intended game-scale choice, so confirm it with the
  director.
- **Cosmetic.** The expense chip under the balance is clipped (01_start.png). The village has no trees or props
  because props and animals are not registered. The E prompt "Hoe the yard" stays on screen while the camera is in
  the village (perf_village.png).

## What works
- Boot in 3.6–4.7 s, zero errors, contract clean, lint OK, deterministic world.
- The whole-game save/load round trip is exact, including hand↔worker links, delegated jobs and hitched implements.
  The gzip slot is 1.18 MB.
- Objectives complete from events: tractor on F, job on Accept, sell via K (12 t wheat, +€2,137 after the 8 % pickup
  fee), hire. The HUD strikes them through and the "Next:" toast follows (07_crew.png).
- Delegation works: the hand Camille (€185/day) finished the accepted 0.57 ha plough job within 3 game days and it
  paid €168 (on-time bonus).
- Refuel with G at the shed pump: 52 L for about €60, with a toast. Away from a pump, the refusal message is clear.
- Land mode (B → Land): clicking Broekweide → confirm "Rent" → rented, first month €55 charged in advance. Build:
  chicken coop placed for €3,500 by mouse click. Disabled tools show why (props/animals missing).
- The tutorial toast sequence (welcome → walking → machines → buildings → panels) is clear and the key glossary is
  complete.

## Player journey (first hour, new player, 1×)
**Can:** read the welcome and objectives; find the tractor once they look around; drive it (F, WASD); lower the
plough (E) and see the field turn brown; open the jobs board (J) and accept a plough or sow job close by; sell last
year's 12 t wheat from the office for about €2.1k; hire a hand and give them the accepted job, then get paid a few
game days later; refuel at the shed pump; rent a nearby parcel in land mode; put up a cheap building; book a
contractor for their own field; save and reload.
**Cannot / will struggle:** finish "Plough Lindeveldje" inside the hour by driving (about 5 % per 2 passes); use the
trailer to sell grain (nothing to load); complete any Haul/Deliver job they accept, which silently expires;
understand why 10× doesn't speed up their own work; see the tractor in the first frame. A savvy player can also sell
the free pickup for €24.8k and trivialise the money pressure the game opens with.
