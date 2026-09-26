# Brief: traffic (wave 2)

Light, believable NPC traffic on the road graph. Deps: `roads`. Optional: environment, effects, audio, vehicles (for player-vehicle avoidance), characters.

## Behaviour
- Vehicles: hatchbacks, estates, vans, a post van, a bus on the regional road (stops in the village),
  a neighbour's tractor with trailer on lanes (slow), a cyclist or two.
- Spawn at map-edge entries of the regional road + village homes; destinations weighted by time of
  day (morning commute out, evening in; almost none at 2–5 am). Density: light (≈ 4–12 cars on the map).
- Follow `roads.laneCurve` (drive on the right), speed by road class, slow for curves,
  car-following (IDM), yield at junctions (right-of-way priority rules), stop behind tractors and
  overtake only on the regional road when clear; brake for the player's vehicle/characters on road.
- Headlights (cones) + tail/brake lights at night and in rain/fog, indicators at junctions.
- Parked cars in the village by day/night.

## Data & API
`world.traffic.cars = [{ id, kind, x, y, rot, speed, route, colour }]`
- `setDensity(0..2)` · `spawnCar(kind, from, to)` · `list()` · `clear()` · `nearestCar(x,y)`
Events: `traffic:spawned`, `traffic:despawned`.

## Rendering
Painted top-down cars (roof panel, windscreen/back glass with sky reflection gradient, wing mirrors,
roof rails), varied colours from palette.paint, shadows `F.shadow.box`, lights at night.

## Showcase presets
`default` (junction with cars ~20 px/m, stage a small road network via roads API), `night`, `rain`.
