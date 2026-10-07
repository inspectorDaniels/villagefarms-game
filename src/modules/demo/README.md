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
3. **parcels** — yard "Hoeve Ter Linde" 0.60 ha **owned** (not tradeable); "Lindeveldje" 1.80 ha **rented**; up to 34 NPC
   parcels (0.5–2.5 ha, ≈50 ha) owned by the 3 neighbour clients (+ other clients); the 2 nearest 1–3.2 ha parcels
   are `forRent`, one 1.5–4.5 ha `forSale`. Client farms via `defineClientFarm`.
4. **buildings** — player: farmhouse, barn, machine shed, chicken coop (`grant:true`); village: grain co-op, dealer,
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
Tutorial toasts (welcome, walking, machines, buildings, panels). Objectives HUD top-left (r2.2):
1. Get into your tractor (`vehicles:entered`).
2. Plough a first strip (0.15 ha) — the player's own `crops:worked` plough area on Lindeveldje (≈ 4 runs, a few minutes).
3. Get Lindeveldje ploughed — any means: ≥ 95 % of cells ploughed/cultivated/sown (you, a hand you switch to, or a
   contractor booked in K → Fields; verified: contractor booking completes it in 2 game days).
4. Accept a contract job (`jobs:accepted`). 5. Sell last year's wheat — hint points to K → Sell all.
6. Hire a farmhand. 7. Sow Lindeveldje (≥ 95 % sown; you or a contractor). Farm office panel (K): sell store items,
pick the seed drill's crop, hire/let go hands, delegate accepted jobs, book contractors for own fields.
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

## Verified (scripted puppeteer playthrough, full game)
Boot 3.3–4.5 s; farmer spawns 6.5 m from the farmhouse; walks to the tractor, F enters, drives 48 m south to
Lindeveldje, E lowers the plough, 145 m run → 72 cells ploughed, `crops:worked {tool:'plough', parcelId:'simulation:parcel:2'}`;
F exits; jobs board (J) Accept; Farm office (K) sells 12 t wheat at the co-op (+€2,038); hire → worker + character
linked; save/load round trip restores money, objectives, field cells, workers, tractor position. 0 console errors.

## Known limitations
- Village / overview views are slow in headless software raster (35–55 ms); farm/field/play 6–7 ms. See core request #4.
- No whole-game save entry point in core yet (core request #2).
- The road plan is designed for the 1024 m map; other sizes scale the design but are untested.
- NPC fields grow but nobody works them (no NPC farming AI); neighbours' machinery is parked only.
- Rented field has no hedge/fence until props exists.
