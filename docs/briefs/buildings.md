# Brief: buildings (wave 2)

Farm and village architecture, top-down roofs. Deps: `simulation` (catalog prices, storage capacity).
Optional: terrain (flatten/paintSurface farmyard), environment, effects (chimney smoke), audio.

## Types (each with 2+ size/style variants, Flemish rural vernacular)
Farm: farmhouse (brick, terracotta or slate roof, chimney), barn/hay barn (open side), cow shed,
chicken coop, sheep shelter, grain silo (round, cylinder shadow), machine shed (metal roof), workshop/
garage (repair, vehicle shop), greenhouse (glass, reflections), storage (potato store), bunker silo,
manure heap, water trough. Village: houses (row + detached), church with tower, café, shop,
agricultural dealer (vehicle sales), grain co-op/mill (sell point), dairy (sell point), town hall.

## Data & API
`world.buildings.list = [{ id, type, x, y, rot, w, h, owner:'player'|'npc', doors:[{x,y}], state }]`
- `types()` → catalog entries (size, cost, function, capacity) — also `registerCatalogItem` to simulation
- `place(type, x, y, rot, { owner, variant })` → id · `remove(id)` · `at(x, y)` · `list(filter)`
- `canPlace(type, x, y, rot)` → `{ ok, reason }` (spatial collisions, water via terrain, land via simulation.canUse)
- `footprint(type, rot)` → polygon · `doorOf(id)` · `nearest(type, x, y)`
- Colliders into `ctx.spatial` (solid). Sell-point buildings call `simulation.defineSellPoint`.
Events: `buildings:placed`, `buildings:removed`.

## Rendering
Roofs painted per material (tile rows, slate courses, corrugated metal, glass panes, thatch), ridge
lines, chimneys, dormers, gutters; eaves overhang; walls visible only as slim edges (pure top-down).
Shadows via `F.shadow.poly(footprint, eaveHeight)` + ridge height (shadow shape reflects roof).
Night: lit windows (skylights/dormers glow) + porch lamps via `F.light`, varying per building,
switched on/off at plausible times (seeded). Chimney smoke via effects when it's cold.
Weathering: moss on north-facing roof side, rust on metal, snow on roofs in winter.

## Showcase presets
`farm` (farmyard cluster ~20 px/m), `village` (~12 px/m), `closeup` (~48 px/m roof detail), `night`, `winter`.
