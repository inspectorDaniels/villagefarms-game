# demo — the playable game (wave 3)

Composes Harvest Valley from the other modules' public APIs only. `boot` calls `startGame()` when there is no
`?showcase`. Deps: terrain, environment, roads, simulation, ui. Optional (null-safe, skipped when absent):
audio, effects, crops, buildings, vehicles, characters, props, animals, traffic, buildtools.

Files: `layout.js` (pure, deterministic valley plan: road plan, sites, field blocks), `index.js` (startGame, scenes,
pois, save/load, showcase), `office.js` (tutorial toasts, "Getting started" objectives HUD, Farm office panel K).

## startGame() steps (each guarded; `layout().stats` reports per-step result)
1. **terrain** — `flatten()` pads for farm (r 44), village (r 62), 3 neighbour farms, depot; flatten + paint the yard `farmyard`.
2. **roads** — `generateNetwork(plan)`: regional road W→E with a bridge, 6 village streets, lanes to the farm, neighbours,
   depot, a farm track along the rented field, and field tracks along the lattice (≈38 nodes / 37 edges).
3. **parcels** — yard "Hoeve Ter Linde" 0.60 ha **owned** (not tradeable); "Lindeveldje" **0.25 ha rented** (r3 addendum: a 24 × 104 m
   rectangle straight below the yard's drive-out; 8 passes of the 3 m plough; rent scales with area in simulation);
   "Lindekouter" 1.04 ha **forRent** just east of the farm track (the "second field"); "Smalle Strook" 0.43 ha NPC wheat
   west of it; up to 34 NPC
   parcels (0.5–2.5 ha, ≈50 ha) owned by the 3 neighbour clients (+ other clients); the 2 nearest 1–3.2 ha parcels
   are `forRent`, one 1.5–4.5 ha `forSale`. Client farms via `defineClientFarm`.
4. **buildings** — player: farmhouse, barn, machine shed, chicken coop (`grant:true`, booked as ~40-year-old grants per
   simulation r7: book €91k, upkeep €38/day instead of €101; see core request #10); village: grain co-op, dealer,
   church, shop, dairy, café, sugar/potato depot (re-registered as a beet/potato sell point), 22 houses facing streets;
   3 neighbour farms (farmhouse, cow shed, barn, silo). The player's farmhouse door faces the yard. Village houses ≤ 20.
5. **crops** — player field as stubble; every NPC parcel `createField(poly, {parcelId, crop, stage:'auto'})`.
6. **vehicles** — old, cheap starting kit (r2.3): `simulation.grantAsset(item, {boughtDay: today − 16 years})` → book value at
   the 20 % floor (tractor €5.2k, plough & drill €1.8k, trailer €2.2k: €9.2k resale vs €17.7k cash), spawned worn
   (tractor 0.55, implements 0.45–0.5, trailer 0.4). The tractor stands in view of the farmhouse door facing the field
   with the plough hitched; the seed drill is loaded with an in-season crop (`crops.calendar()`; oats in March); the
   grain trailer stands east of the implements, out of their exit lane. The pickup is the family car (no asset: not
   sellable, no upkeep);
   NPC tractors/trailers/combine/plough parked at neighbours.
7. **characters** — `setAutoSpawn(false)`; farmer "Jan" at the farmhouse door (active); a hand only if
   `simulation.workers()` already has one (linked by `workerId`); 8 villagers in the village box.
8. **props / animals / traffic** — composed when those modules exist (hedges, poplars, fence, forests, orchard;
   chickens, cows/sheep; traffic density 1).
9. **economy** — 12 t of last year's wheat in the store (the first sale of the tutorial).

## API (`ctx.modules.get('demo')`)
- `startGame()` → stats (idempotent).
- `scene(name)` → bool. `farm, village, overview, night, rain, autumn, winter, play, field, bridge`. Sets camera
  (and time/weather for the showcase vantage points; `play` follows the active character, weather back to auto).
- `pois()` → `[{id, name, x, y, kind, zoom}]` (farm, field, village, bridge, farmhouse, shed, co-op, dealer, dairy, shop,
  church, depot, neighbour farms).
- `layout()` → `{nodes, edges, blocks, spare, sites, ids, parcels, fields, stats}`.
- `objectives()` → `[{id, title, done, progress}]` (tractor, strip, ploughed, job, sell, hire, sow).
- `sellFromStore(item, qty?, sellPointId?)` → € net (buyer collects, 8 % haulage fee).
- `hireHand()` → character id via `characters.hire`.

## Game flow (office.js)
Opening (r2.4): camera ~22 px/m (`characters.setFollowZoom(22)`, null-safe) framing the farmer at the farmhouse door and
the tractor; the first morning is forced clear (released to the seasonal plan at 13:00 or the next day); a world-ui label
"Your tractor · F to get in" sits on the tractor until it is first entered.
Tutorial toasts (welcome, walking, machines, buildings, panels). Objectives HUD top-left (r2.2 / r3):
1. Get into your tractor (`vehicles:entered`).
2. Plough your first strip (0.06 ha) — the player's own `crops:worked` plough area on Lindeveldje (≈ 2 passes).
3. Get Lindeveldje ploughed — any means: ≥ 80 % of cells (8 clean passes leave the headlands ≈ 15 %; the hint says to include the field ends; also completes the first-strip step) ploughed/cultivated/sown (you, any of your people, or a
   contractor booked in K → Fields; verified r2: a contractor booking completes it in 2 game days).
4. Sow Lindeveldje (≥ 80 % sown; the drill sows straight into ploughed ground, or a contractor).
5. Accept a contract job (hint: field jobs need your kit; haul jobs are crew-only → delegate to a hand).
6. Sell last year's wheat — K → Store & seed → Sell all. 7. Hire a farmhand.
8. Rent a second field — Lindekouter, B → Land tool → Sign (or the Land panel M once it offers Rent); done when any further parcel is rented or owned.
Seed & inputs are charged by simulation when sowing.

## Events
Emits `demo:started {stats}`, `demo:objective {id, info}`. Listens `crops:worked`, `vehicles:entered`, `jobs:accepted`,
`economy:transaction`.

## Save / load
`save()` → `{v:1, started, sites, pois, ids, parcels, fields, npcParcels, objectives, tutorial, progress, clearMorning}` (~4 KB). The world itself
is saved by the owning modules. Verified round trip with all modules' save/load (see playthrough below).

## Showcase presets
`default`(=farm), `farm` 09:30, `village` 11:00, `overview` 12:30 (3 px/m, the camera minimum), `night` 22:30,
`rain` 15:00, `autumn` (day 28), `winter` (day 1), `play` 08:00 following the farmer.

## Verified (scripted puppeteer playthroughs, full game, r3)
Boot 3.2–4.9 s. Opening: 22 px/m, clear first morning, farmer at the farmhouse door with the labelled tractor in view.
Starting kit resale €9.2k (tractor €5.2k, plough & drill €1.8k, trailer €2.2k) vs €17.7k cash; drill loaded with oats.
Lindeveldje 0.25 ha (624 cells, 24 × 104 m), timed at 1× with the scripted driver (8 passes offset by the 3 m
working width, implement raised ~8 m past the headland because it trails the tractor; bot turns ≈ 25 s each):
walk to tractor 20 s; **plough 652 s (10.9 min) → 95.2 %**; **sow 620 s (10.3 min) → 93.9 % of the field (98.7 % of the
ploughed cells)**; total from boot 21.7 min. A human with ~12 s turns: ≈ 8–9 min each, ≈ 17 min plough + sow. The
plough → drill swap was done by API in the script (hitching needs reversing, which the bot can't do); a player needs ≈ 1 min.
Strip objective (0.06 ha) done after 2 passes (~2.5 min). Contractor plough booking completes "Get Lindeveldje ploughed"
in 2 game days (r2). Jobs (J) accept, K sell 12 t wheat (+€2.1k), hire, rent Lindekouter (1.04 ha, €534/ha/yr; the
first field €542/ha/yr) → "Rent a second field" done. Save/load round trip restores money, objectives, field cells,
workers, vehicles. 0 console errors.
Perf (frameMsAvg, headless): play 6.2, farm 5.9, field 6.5, night 6.3, village 38.5, overview 34.6 (buildings JS 30 ms).

## Known limitations
- Village / overview views are slow (village 38 ms, overview 35 ms; buildings JS 30–47 ms when the grain co-op is on screen). See core requests #4, #6.
- No whole-game save entry point in core yet (core request #2).
- The road plan is designed for the 1024 m map; other sizes scale the design but are untested.
- NPC fields grow but nobody works them (no NPC farming AI); neighbours' machinery is parked only.
- Rented field has no hedge/fence until props exists.
