# vehicles — drivable farm machines (wave 2)

Tractors (3 tiers), combines (2 sizes), a pickup, trailers and implements. They drive with a kinematic
bicycle model, collide with `ctx.spatial` solids, stop at deep water, and tow articulated trailers.
Lowered implements work the ground through `crops.work()`. Fuel is bought as diesel through
`simulation`, wear costs money to repair, and headlights/beacons light the night.

Files: `types.js` (type table, kits, upgrades), `drive.js` (physics, hitch, collisions),
`index.js` (API, work, economy, save/load), `render.js` (drawing, lights, effects, engine audio),
`paint.js` (sprites), `hud.js` (driving card), `showcase.js`, `tests/*.cjs` (puppeteer tests).

Deps: `simulation` (hard). Optional: `terrain`, `roads`, `crops`, `effects`, `audio`, `ui`, `environment`.
Every optional call is null-checked; without crops the implements paint `ploughed`/`soil` into the terrain.

## Types (`api.types()`)
| type | kind | notes |
|---|---|---|
| `tractor_t1` / `t2` / `t3` | tractor | 95 / 180 / 300 hp, 30 / 40 / 50 km/h, 110 / 260 / 520 L tank; t2, t3 4WD |
| `combine_s` / `combine_l` | combine | header 4.5 / 7.5 m at 5 / 6 km/h, grain tank 7 / 11 t, rear-wheel steer |
| `pickup` | car | 90 km/h on roads, poor off-road |
| `plough_s` / `plough_l` | rear-mounted | 3.0 / 4.2 m at 8 km/h (`plough`) |
| `cultivator` | rear | 3 m at 10 km/h (`cultivate`) |
| `seeder_s` / `seeder_l` | rear | 3 / 4 m at 10 km/h (`seed:<crop>`, crop from `setSeed`) |
| `sprayer`, `spreader` | rear | 18 m booms at 10 km/h (`spray`, `fertilise`); booms fold when raised |
| `mower`, `rake` | rear | 3 m / 3.4 m (`mow`, `rake`) |
| `baler`, `root_harvester` | trailed | `bale` 3 m; `harvest` 1.5 m at 5 km/h with a 6 t bunker (beet/potatoes) |
| `trailer_grain`, `trailer_flat` | trailed | 14 t tipping / 10 t flatbed |
| `loader` | front | front loader (visual; no bucket mechanics yet) |

**Widths and speeds come from `simulation.workRates().kit`** at init (the r3 single source), so
physics and the economy use the same numbers. The values above are the current kit; `types.js`
holds fall-backs. `api.workRate(typeOrVehicleId, tractorType?)` → `{ type, tool, width, speed (m/s), kmh,
haPerHour, hoursPerHa, fieldEfficiency, needHp, source }`. For a live rig the speed is limited by the
tractor's power (`hp / needHp`), exactly as in the driving physics. `haPerHour` is per **real** hour of
driving (0.8 field efficiency; sprayer uses the kit's 0.6).

## Catalog and kits
Vehicles reuse the simulation catalog. Buying a catalog item spawns its kit:
`tractor_t1..3`, `combine_s/l`, `tillage_s` → plough_s + seeder_s, `tillage_l` → plough_l + seeder_l,
`sprayer` → sprayer + spreader, `trailer` → trailer_grain, `mower`, `baler`, `cultivator`, `root_harvester`.
Items simulation lacks are registered at init: `pickup` (€28k), `rake` (€6k), `trailer_flat` (€6.5k), `front_loader` (€8k).
Upkeep and leases are charged daily by simulation (asset records); this module charges fuel, repairs and upgrades.

## API (`ctx.modules.get('vehicles')`) — metres, radians (0 = north, clockwise), m/s
- `spawn(type, x, y, rot, { owner, assetId, fuel, wear, paint, seed, name })` → id · `despawn(id)` (removes its collider at once and always evicts the driver, emitting `vehicles:exited` with `despawned:true`)
- `list(filter?)` (object match or predicate) → **copies** · `get(id)` → **live** record (treat as read-only) · `nearest(x, y, r=3, {any, free, kind})`
  → nearest drivable vehicle by distance to its body box (implements only with `any`; `free:true` skips occupied/hitched)
- `enter(id, characterId)` → bool (lights auto-on after dark) · `exit(id)` → `{x, y}` exit spot: dry, free
  of solids and outside the rig's bounding box (the driver's door first). Returns **`null` and keeps the driver**
  (no event) when moving faster than 1 m/s ("Stop to get out") or when there is no free spot ·
  `driverOf(id)` · `exitPosition(id)` → spot or null
- `control(id, { throttle 0..1, brake 0..1, steer -1..1, implementDown: bool|'toggle', lights: bool|'toggle', hitch, horn })`
  Must be called every step by the driver (the characters module does). Only throttle/brake/steer keep the controls
  fresh; after 3 stale steps the parking brake holds (never reverses), and after 5 s the engine switches off (no fuel burn).
  Brake at a standstill = reverse. `implementDown:'toggle'` with nothing attached couples the nearest implement;
  it **never uncouples** (that is H / `hitchNearest`).
- `attach(id, implId)` (snaps behind; one rear + one front) · `detach(id, implId?)` · `hitchNearest(id)` (couple a free implement within 2.6 m of a free hitch, else uncouple the rear one)
- `setImplement(id, down|'toggle')` · `setLights(id, on|'toggle')` · `setSeed(id, crop)`
- `refuel(id, litres?, {anywhere})` → litres. **Where:** within 12 m of a fuel point (`addFuelPoint(x, y, r?)`, saved):
  the farm's diesel stock first, then `simulation.buy('diesel')` as money allows. On the **farmyard** surface: only from
  the farm's diesel stock (buy diesel into the farm tank first). Anywhere else: 0 (G shows why). `anywhere:true` for scripts.
  `removeFuelPoint(x, y, r = 3)` → number removed (buildings calls it on demolition; saved).
- `repair(id)` → € (12 % of list price × wear, category `repairs`) or false · `upgrade(id, 'engine'|'tyres'|'gps')` → € or false
- `purchase(itemOrType, x, y, rot, { finance, lease, grant })` → [ids] via `simulation.purchase/lease/grantAsset`
- `sell(id)` → € (releases the asset; despawns the whole kit) · `catalog()` · `types()` · `workRate(...)`
- `unload(id, 'farm' | targetVehicleId)` → kg moved (farm → `simulation.addInventory` in t)
- `rigOf(id)` → [id, ...attached] · `surfaceUnder(id)`

Player keys handled here while the active character drives: **H** hitch/unhitch, **G** refuel (stopped),
**U** combine unloading auger (fills a trailer alongside the left side). W/S/A/D, E (lower/raise), L, F come through characters.

## Driving model
- Kinematic bicycle: yaw rate = v·tan(steer)/wheelbase; steering rate-limited (1.9 rad/s), less lock at speed.
  Sub-steps of ≤ 0.35 m, so fast vehicles do not tunnel.
- Top speed = type road speed × surface factor × wear (−20 % at wear 1) × power; heavy trailers reduce acceleration and top speed.
  Surface from `roads.roadAt` (road/lane/track) else `terrain.surfaceAt`. Soft ground loses more for 2WD;
  4WD and flotation tyres claw back up to 55 %; wetness (`environment.weather.wetness`) slows soil, mud, tracks.
  Measured (t2): grass 27 km/h, regional road 40 km/h, ploughing 7.8 km/h; pickup 90 km/h on road.
- Lowered implements cap speed at their working speed, scaled by `hp / needHp`.
- Collisions: each rig's oriented boxes (body, combine header, implements) tested by SAT against every
  `solid` spatial item (AABB, circle or `data.poly(s)`). Blocked moves stop the rig (`v.blocked = 'solid'|'water'|'bounds'`);
  hits above 1.5 m/s add wear. Deep water: both corners and the centre of the leading edge (the rear of the whole rig when reversing) may not enter water deeper than the type's wading depth
  (0.6 m tractors/combines, 0.35 m pickup); roads (bridges) always pass.
- Trailed implements: the axle follows the hitch at a fixed tongue length (articulation clamped to ±78°).
- Every vehicle/implement is a solid spatial item (`kind:'vehicle'`, AABB + oriented `polys` on the item), so walkers collide with the true shape.
- **Pause:** while `world.time.paused` nothing drives, burns fuel or works.

## Fuel, wear, work
- Fuel (L) burns only while a driver is in: `(idle + (max − idle) × load) × (1 + 0.25 wear)` L per machine-hour,
  with 1 real second = 2 machine-seconds (`FUEL_TIME`). Load rises with throttle, soft ground, towing and implement draft.
  Measured (t2 + 3 m plough): 24 L/h working vs 5 L/h idling. Out of fuel → the engine stops.
- Wear grows with engine time × load (0.05 per real hour at full load), implement wear while working, and impacts.
- Work: every 0.5 m travelled a lowered implement calls `crops.work(tool, x, y, width + 0.2, rot, len)` on the strip it
  swept. Harvest checks the crop under the machine (`crops.cellAt` + crop `kind`): combines take cereal/oilseed/maize only, the root harvester only root crops (beet, potatoes); grass needs the mower. Yield (`yieldKg`) fills the combine tank / bunker. Without crops, the terrain fallback paints a strip every 9 m (batched: each paint repaints terrain chunks). `vehicles:worked` is emitted per ~40 m².

## Events
`vehicles:entered {vehicleId, characterId, type}` · `vehicles:exited {vehicleId, characterId, x, y}` ·
`vehicles:purchased {itemId, vehicleIds, mode, assetId}` · `vehicles:worked {vehicleId, implementId, tool, area, cells, x, y, rot, width}` ·
`vehicles:attached|detached {vehicleId, implementId}` · `vehicles:refuelled {vehicleId, litres}` · `vehicles:repaired {vehicleId, cost}` · `vehicles:sold`.

## World data
`world.vehicles = { list: [{ id, type, kind, name, x, y, rot, speed, steer, fuel, tank, wear, driverId, attached:[ids],
hitchedTo, lowered, lights, engine, owner:'owned'|'leased'|null, assetId, upgrades:{engine,tyres,gps}, hours, odo, fuelUsed,
workedArea, cargo:{item, kg}|null, seed, paint }], counter, version }`. Saved by `save()`/`load()` together with the control state (`ctl`, `ctlStep`) and the module step counter, so a replay after load is bit-exact.

## Rendering
Painted sprites (cached) per body, 4-phase lug tyres that roll with the odometer and steer (rear steer on combines),
animated combine reel, unfolded sprayer booms, grain heaps scaled by fill. Shadow casters per part (bonnet, cab, rear
tyres, header). Night: two headlight cones (`F.light` with `cone`), tail lights, rear work light while working, pulsing
orange beacon. Effects (optional): tyre ribbons on soft ground, dust on dry dirt, exhaust puffs by load, clods, chaff.
Engine loops (`engine-tractor|car|combine`) follow rpm/load. Driving HUD card (bottom-centre) while the player drives.

## Showcase presets
`default` yard lineup of the whole fleet (24 px/m) · `working` tractor + 3 m plough ploughing stubble and a combine
opening ripe wheat (real crops fields) · `convoy` tractor + loaded grain trailer and pickup on a lane · `night`
headlights/beacons · `closeup` plough at 56 px/m. The scene is placed on a dry, flat spot of the real terrain.

## Tests
```
node src/modules/vehicles/tests/drive.test.cjs        # 37 physics/economy/r2 checks, deterministic (engine.step by hand)
node src/modules/vehicles/tests/characters.test.cjs   # F/W/A/D/E/S/L through the characters module
```
`SIM_FROM_GIT=1` serves simulation from git HEAD when its builder is mid-edit.

## Known limitations
- No AI driving yet (hired hands work abstractly in simulation; `workRate()` gives them the same numbers).
- Front loader has no bucket mechanics; trailers do not tip (use `unload`); bales are crops' objects.
- Trailers cannot be chained; no slopes; collision response is a stop (no sliding along walls).
- Walkers collide with the axis-aligned box of a diagonal vehicle (see core request 2).
- Tier-3 tractors have no 6 m plough implement although simulation's kit lists one (widths are per implement here).
