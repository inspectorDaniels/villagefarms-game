# Brief: animals (wave 2)

Livestock and wildlife. Deps: `simulation` (produce sale, feed costs, catalog). Optional: props
(fenced pens), buildings (sheds), environment (night/sleep, rain shelter), effects, audio.

## Species
Cows (Holstein black/white + Belgian Blue), sheep (+ lambs in spring), chickens (+ rooster), a farm
dog that follows the active character, ducks on the pond; wildlife: hares in fields, deer at forest
edge at dusk, herons by the river.

## Data & API
`world.animals.list = [{ id, species, x, y, rot, state:'graze'|'walk'|'sleep'|'eat'|'flee', penId, hunger, health, produce }]`,
`world.animals.pens = [{ id, poly, species, trough:{x,y,food,water} }]`
- `createPen(poly, species, { trough })` → id · `addAnimal(species, penId|null, x, y)` → id · `list(filter)`
- `feed(penId, kg)`, `water(penId, l)`, `collect(penId)` → `{ item, qty }` (eggs/milk/wool) sold via simulation
- `stats(penId)` · `buyAnimal(species, penId)` via simulation catalog
Events: `animals:produced`, `animals:hungry`, `animals:born`.

## Behaviour
Steering (wander within pen polygon, flocking for sheep, cows herd slowly, chickens peck in bursts),
avoid each other, flee from vehicles/wildlife startle, sleep at night (clustered), shelter in rain.
Daily produce ∝ feed/health. All deterministic.

## Rendering
Painted top-down animals with idle animations (head bob grazing, tail swish), cached frames,
shadows `F.shadow.circle`. Readable at 12 px/m, charming at 48 px/m.

## Showcase presets
`default` (pasture with cows + sheep ~20 px/m), `coop` (chickens ~48 px/m), `pond` (ducks, heron), `night` (sleeping herd).
