# Brief: vehicles (wave 2)

Drivable farm machines and cars. Deps: `simulation` (catalog, fuel costs, upkeep).
Optional: roads, terrain, crops (implements call `crops.work`), effects (dust/exhaust/tracks), audio (engines), ui.

## Fleet (catalog registered to simulation, with price, lease/day, upkeep)
Tractors: tier 1 old small tractor (60 hp, €9k used), tier 2 (120 hp), tier 3 (250 hp, 4WD).
Combine harvester (header width 6 m / 9 m), pickup truck, flatbed trailer, grain trailer (tipping),
implements: plough (3/5 furrow), cultivator, seed drill, sprayer (booms fold), fertiliser spreader,
mower, rake/tedder, baler, front loader. Upgrades: engine, tyres (twin), GPS row guidance (auto-steer).

## Data & API
`world.vehicles.list = [{ id, type, x, y, rot, speed, steer, fuel, wear, driverId, attached:[implIds], lights, owned|leased }]`
- `spawn(type, x, y, rot, { owner })` → id · `despawn(id)` · `list()` · `get(id)` · `nearest(x, y, r)`
- `enter(vehicleId, characterId)` / `exit(vehicleId)` → exit position · `driverOf(id)`
- `control(id, { throttle, brake, steer, implementDown, lights, horn })` — called by characters for the active driver
- `attach(vehicleId, implementId)` / `detach` · `refuel(id)` · `repair(id)` · `upgrade(id, upgradeId)`
Events: `vehicles:entered`, `vehicles:exited`, `vehicles:purchased`, `vehicles:worked`.

## Behaviour
Kinematic bicycle model (wheelbase, max steer, accel/brake, top speed by type and surface — roads
fast, fields slower, mud slower, water blocked), collisions against `ctx.spatial` solids, trailers
follow via hitch articulation, implements lowered work the ground via `crops.work(tool, x, y, width, rot)`
each step, fuel burn ∝ load. Emits dust on dirt/fields, exhaust puffs under load, tyre trails.
Headlights (cone `F.light` with `cone:{angle,spread}`) + tail lights at night, beacon on tractors.

## Rendering
Top-down painted machines: body panels with paint colour + highlight/shade (form, not sun), cab
glass, big lug tyres (tread visible, wheels steer visually), exhaust stack, mirrors; implements with
tines/discs; combine header with reel. Shadows via `F.shadow.box` per part with realistic heights.

## Showcase presets
`default` (yard lineup ~24 px/m), `working` (tractor+plough mid-field with tracks and dust),
`convoy` (tractor + trailer on a road), `night` (headlights), `closeup` (~56 px/m).
