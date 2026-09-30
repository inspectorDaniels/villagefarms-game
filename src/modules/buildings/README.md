# buildings (wave 2)

Farm and village architecture seen from above. Each building has a precise collider. A building can be a home, a store, a workshop or a sell point. Buying one goes through `simulation`, and upkeep comes from simulation's daily asset upkeep. Roofs are painted in the gouache style and cached. Buildings cast shadows from their walls, ridges, chimneys, silos and the church tower. Windows and porch lamps light up at night on a seeded schedule. Chimneys smoke when it is cold.

Hard dep: `simulation`. Optional deps (all null-safe): `terrain`, `environment`, `effects`, `audio`, `ui`, `roads`, `crops`, `vehicles`.
`characters` calls this module (see *Homes*). Buildings reads `world.characters`/`world.player` only to show service prompts. It does not list characters as a dependency, because that would create a cycle.

Files:
- `types.js`: type table.
- `geom.js`: polygons, SAT and hashing.
- `paint.js`: roof, silo, tower and apron sprites.
- `index.js`: logic, rendering, API and save/load.
- `showcase.js`: the showcase scenes.
- `tests/game.test.cjs`: the full-game mechanics test.

## Types (`types()` lists every type × variant)
In the tables below, the variant number is its index; `v0` is the default.

**Farm**

| type | variants | function | catalog id / price |
|---|---|---|---|
| `farmhouse` | 0 terracotta 14×9 · 1 slate 16×8.5 + wing | home (4 beds), chimneys, porch lamp | `bld_farmhouse` €180k |
| `barn` | 0 slate 22×13 · 1 open hay barn (metal) | storage (straw 250 t, informational) | `bld_barn` €65k |
| `machine_shed` | 0 18×12 · 1 24×14 (metal) | **repair (−30 % rebate) + fuel point** | `bld_machine_shed` €55k |
| `grain_silo` | 0 Ø7.2 m × 12 m · 1 twin Ø8.4 m × 15 m | **+400 t / +1000 t bulk grain** | simulation's `grain_store` / `grain_store_l` |
| `potato_store` | 0 insulated panels 18×12 | **+600 t potato capacity** | `bld_potato_store` €45k |
| `cow_shed` | 0 26×14 · 1 18×12 (ridge vent) | livestock cows 40 / 24 | `bld_cow_shed` €70k |
| `sheep_shelter` | 0 12×6 open | livestock sheep 25 | `bld_sheep_shelter` €9k |
| `chicken_coop` | 0 5×3.2 · 1 8×4 | livestock chickens 30 / 60 | `bld_chicken_coop` €3.5k |

**Village**

| type | variants | function | catalog id / price |
|---|---|---|---|
| `village_house` | 0 detached · 1 row house · 2 thatched cottage | home (3 beds) | `bld_house` €150k |
| `shop` | — | sell point: eggs, potatoes, wool, milk | — |
| `grain_coop` | hall + 3 silos | sell point: wheat, barley, oats, rapeseed, maize | — |
| `dairy` | hall + milk tank | sell point: milk, eggs | — |
| `dealer` | hall with roof lights | sell point: hay, straw; repair (full price) + fuel point | — |
| `church` | nave + tower with spire | evening lights | — |

Local frame: x points right and y points down. The **front and main door is on the −y side**, so at rot 0 a building faces north. Rotation turns clockwise, as elsewhere in the engine.

## API (`ctx.modules.get('buildings')`)
Units are metres and radians.

**Placement**
- `canPlace(type, x, y, rot=0, {variant, owner='player', pay, anyLand, ignore})` → `{ok, reason, cost, by?}`. The checks run in this order:
  1. inside the map;
  2. not on a road (`roads.roadAt`);
  3. not on a crops field;
  4. no overlap with a solid spatial item, with 0.5 m clearance. The test is exact (SAT against `poly`/`polys`, AABB or circle). A character on foot inside the footprint also blocks (`someone is standing there`);
  5. no water (`terrain.waterDepthAt > 2 cm` at any 1.5 m sample);
  6. not too steep: the pad would need more than 3 m of cut or fill;
  7. land rights for the player (`simulation.canUse` at every sample; `npc` owners skip this);
  8. money, when `pay` is set.

  Reasons: `bad position`, `outside the map`, `road`, `field`, `another building`, `blocked (<kind>)`, `someone is standing there`, `water`, `too steep`, `not your land`, `not enough money`, `not for sale`.

  `opts` may be `null` or omitted.
- `place(type, x, y, rot=0, {variant, owner, pay, grant, force, anyLand, name, sellPointId, terrain})` → id or `null`. `lastError()` gives the reason for a `null`.
  - `force` skips the gameplay rules only. Non-finite type/x/y/rot (`bad position`) and footprints off the map are always refused.
  - `pay: true`: `simulation.purchase(catalogId, {category:'buildings'})`. The building is marked `purchased`, the purchase is booked in simulation's `buildings` ledger category (capital), and upkeep is charged daily by simulation.
  - **Granting is opt-in (anti money-printing).** Without `pay`, no simulation asset is created: no capacity, no upkeep, no resale.
    - `grant: true` (starting kit, e.g. the demo's first grain silo) grants the catalog asset, which gives capacity and upkeep.
    - A granted building **refunds €0** on removal: `simulation.releaseAsset(assetId, {writeOff: true})` books one `writeOff` entry and moves no cash.
  - Farm buildings level the pad (`terrain.flatten`) and paint a `farmyard` apron (`terrain.paintSurface`). `terrain: false` turns this off.
  - The farmyard is re-applied after a `terrain:generated` that wiped it.
- `remove(id, {force, owner})` → `{ok, refund, reason}`.
  - Non-player (`npc`) buildings need `force` or a matching `owner:'npc'`; otherwise the result is `not yours`.
  - It refuses a full grain or potato store (`store not empty`), unless `force`.
  - Only a **purchased** building refunds: `simulation.releaseAsset` at the buildings book value (80 % of cost, −2 % per year, floor 30 %).
  - It deletes the sell point with `simulation.removeSellPoint`.
  - It removes the fuel point with `vehicles.removeFuelPoint` when vehicles provides it.
- `footprint(type, rot, x=0, y=0, variant)` → convex hull polygon. `footprintParts(...)` → one polygon per part.

**Queries**
- `at(x, y)` → the building whose exact polygon contains the point.
- `get(id)`.
- `list(filter)`: filter by type, `'home'|'sell'|'storage'|'livestock'|'repair'|'fuel'`, an object `{owner:'player', type:…}`, or a function.
- `nearest(filter, x, y, {owner})` → building + `dist`.
- `doorOf(id)` → `{x, y, rot, main}`. The door is 0.8 m outside the wall, so a character can reach it.
- `homes(owner?)`.
- `capacity(kind)` sums the player's buildings: `'grain' | 'potatoes' | 'cows' | 'chickens' | 'sheep' | 'beds' | 'storage'`. `potatoes` includes the 80 t base.
  - **A store only counts when a simulation asset backs it** (bought with `pay`, or granted with `grant:true`). Simulation's bulk room counts assets, and potatoes follow the same rule. An unpaid, ungranted silo reports 0, adds 0 room and never blocks its own demolition.

**Services**
- `serviceAt(x, y, 'repair'|'fuel'|'sell'|'storage')` → the building whose door is within about 14 m (more for wide buildings).
- `repairAt(vehicleId)` → `{cost, rebate, at}` or `false`.
  - It calls `vehicles.repair`.
  - At the player's own machine shed, 30 % comes back as a `repairs` credit.
  - At the dealer there is no rebate.
- `deliver(vehicleId)` → `{kg, euros, at, reason}`. It handles the cargo of the vehicle and its attached trailers:
  - At a sell point that accepts the item, **the cargo itself is sold, even when the farm store is full.**
    - Simulation only sells stock the farm holds, so for the instant of the sale buildings lends room out of the store (same crop first, then other bulk grain; potatoes by a temporary capacity).
    - It then runs `vehicles.unload` → `simulation.sell(item, t, sellPointId)` and puts the lent stock back.
    - Farm stock is unchanged afterwards (tested).
  - At a player store, the cargo is unloaded into farm inventory.
  - Every 0 kg result carries a `reason` (`no cargo`, `<buyer> does not buy <item>`, `the farm store is full`, `no buyer or store here`, …). The R key shows it as a warning toast.

**Lights**
- `lightsOn(id, hour?)` → `{windows: share lit 0..1, porch}`. This is the seeded schedule described under *Night*.

**In game:** stop a vehicle at a service building and a world label appears, for example `R — Sell 8.0 t wheat to …` or `R — Repair …`. **R** performs the action and shows a toast. On foot near a sell point, the label lists what that buyer takes.

## Homes (used by characters)
`characters/ai.js` handles sleep with `nearest('farmhouse', home.x, home.y)` and `doorOf(b.id)`. If that door is within 60 m of the character's home, the character walks there and turns `inside`. This is verified in the test: the hand went `inside` 0.38 m from the door.

## Simulation integration
- **Catalog.** Buildable types are registered with `registerCatalogItem` at init. Categories:
  - `building`;
  - `storage_potato` for the potato store;
  - grain silos reuse simulation's `grain_store` and `grain_store_l`, whose `category: 'storage'` feeds `bulkRoom()`.
- **Potato capacity.** It is `simulation.setCapacity('potatoes', 80 + 600 × player potato stores)`. It is re-synced on place, remove and load.
- **Sell points.** `defineSellPoint('bld_<type>_<n>', {name, x, y at the door, accepts})`. The name is seeded from the world seed, for example "Dijle Grain co-op". Demolition calls `removeSellPoint`. With an older simulation that lacks it, the point is redefined with `accepts: []` instead.
- **Fuel.** `vehicles.addFuelPoint(door, 12 m)` for `machine_shed` and `dealer`. It is de-duplicated against `world.vehicles.fuelPoints`. Demolition removes the pump with `vehicles.removeFuelPoint(x, y)` (null-safe; tested).
- **Load.** A building saved before r2 without a `purchased` flag counts as purchased when it has an `assetId`. `load()` skips `null`/non-object entries, unknown types and entries without finite x/y.

## Events
- `buildings:placed {id, type, variant, x, y, rot, owner, door}`
- `buildings:removed {id, type, x, y, owner, refund}`

Listens to `terrain:generated`.

## World data
`world.buildings = { list:[{id, type, variant, x, y, rot, w, h (AABB m), owner, doors:[{x,y,rot,main}], state, name, assetId, sellPointId, yard}], counter, version }`.

Spatial items: `{id, kind:'building', x0..y1, solid:true, poly | polys, data:{buildingId, type, poly|polys}}`.

## Rendering
- **Roof sprites** are painted once per (type part, material, snow) in the art cache at 32 px/m, then drawn rotated. Materials:
  - terracotta and slate tile courses with staggered joints and odd tiles;
  - corrugated metal and fibre-cement with laps and rust or lichen streaks;
  - insulated panels with standing seams;
  - felt with battens;
  - thatch straw strokes.
- **Roof details:** ridge caps, ridge vents, roof-light strips, skylights, chimneys, gutters and verges, moss on the front slope, and a soft contact shadow. There is no baked sun, only symmetric slope shading.
- **Snow:** when `weather.snowCover > 0.3`, a snow variant of each sprite is used.
- **Shadows:** `F.shadow.poly(wall footprint + overhang, eave)`, `F.shadow.poly(ridge strip, ridge)`, a box for each chimney, cylinders for silos and boxes for the tower and spire.
- **Door aprons:** concrete aprons and steps are drawn in `ground-detail`, before the shadow pass.
- **Night lights** use the seeded schedule from `lightsOn`:
  - Homes: lit from dusk to 21:36–23:48, and from 05:48–06:48 until dawn.
  - Shops: until 18:48–20:18.
  - Barns, sheds and livestock buildings: milking and working hours.
  - The church: evenings on some days.
  - Each window is on or off per day by hash.
  - Porch lamps burn from dusk to dawn.
  - Window lights sit 0.9 m outside the walls, radius 4.2 m. Skylights glow on the roof.
- **Chimney smoke:** `effects.emitter('chimney')` at chimney height, only near the view and only when the temperature is below 13 °C (below 17 °C with lights on). Emitters are checked every 20 frames.

## Showcase presets
| preset | shows | zoom | time / day |
|---|---|---|---|
| `farm` | the farmyard cluster | 20 px/m | |
| `default` | the whole farm | 10 px/m | |
| `village` | the village | 12 px/m | |
| `closeup` | the farmhouse | 48 px/m | |
| `night` | the village | 16 px/m | 22:15 |
| `winter` | the farm in snow | | day 1 |

Sites come from a deterministic dry, flat scan of the terrain.

## Tests
`node src/modules/buildings/tests/game.test.cjs` runs 45 checks in the full game: placement rules, precise rotated colliders, pay and upkeep, grain and potato capacity, demolition rules, workshop repair and fuel, co-op delivery, shop and closure, the hand sleeping at the door, the tractor blocked by a wall, lights, events, save/load, determinism across two page loads, and perf.

r2 added checks for:
- a co-op sale with a full store, with 0 kg reasons;
- `removeSellPoint`;
- the npc owner guard;
- null opts, NaN or off-map positions with `force`, and malformed load entries;
- no refund for free or granted buildings;
- a character blocking placement;
- dealer fuel point removal;
- the hand's walk time;
- the tractor stopping at the wall line.

r3 added checks for:
- the purchase being booked in the `buildings` category;
- a granted building written off as a single entry;
- an unbacked silo's capacity and its demolition;
- an old save loading as purchased.

## Known limitations
- **Characters push against AABBs.** Their collision uses the spatial item's box, so a building rotated off 90° pushes characters out of its AABB corners. Vehicles and `canPlace` use the exact polygon.
- **Terrain edits after load.** `load()` does not repaint the farmyard or re-flatten; terrain persists its own edits.
- **No interiors, no animated doors.** The open hay barn is still fully solid.
- **Livestock capacity is informational** until an `animals` module reads `capacity('cows'|…)`.
- **Moss is always on the local front slope,** not the true north slope.
