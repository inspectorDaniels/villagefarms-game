# Brief: effects (wave 1)

Pooled particles and ground decals that make the world feel alive. Budget ≤ 3000 live particles,
≤ 1 ms/frame. All randomness via `ctx.rng('fx')`. Painted, soft, never pixel-noise squares.

## Required API
- `emit(type, x, y, opts)` one burst — `{ count, dirX, dirY, speed, spread, color, size, z }`
- `emitter(type, opts)` → handle `{ setPosition(x,y), setRate(perSec), setDir(dx,dy), stop() }`
- `decal(type, x, y, rot, opts)` — `tyre`, `footprint`, `hoofprint`, `puddle`, `scorch`, `spill`
- `trail(id, x, y, rot, width, type)` — continuous tyre tracks / furrow trails (ribbons that fade over
  game time; darker in mud, visible in snow)
- `clear(type?)`, `count()`
Particle types: `dust` (billowing, soil-coloured; on dirt/gravel), `exhaust` (diesel puffs, grey-blue),
`chimney` (rising smoke bent by wind), `splash` (rain drops on ground/water rings), `ripple`,
`leaves` (autumn fall, tumbling), `petals`, `chaff` (harvest), `clods` (ploughing, arc + bounce),
`spray` (sprayer mist), `sparkle`, `fireflies` (summer nights — emit tiny `F.light` glows),
`butterflies`, `birds` (small flocks crossing the map, with ground shadows via `F.shadow.circle`
at height), `steam`, `snowpuff`.
Ambient director (automatic, optional deps environment/terrain): fireflies near water/meadows on
summer nights, butterflies on sunny days, leaves in autumn wind, bird flocks at dawn/dusk,
rain splashes when raining (only within view). Wind from `world.environment.weather.wind`.
Particles with height cast shadows when large (smoke plumes, birds). Draw lit particles on the
right layers (smoke in `overhead`, dust in `objects` via y-sort or `overhead`, fireflies `glow`).

## Showcase
Painted backdrop from your own folder or `showcase.deps: ['terrain','environment']`. Presets:
`default` (a mix: dust trail, exhaust, chimney smoke, tyre tracks), `harvest` (chaff/clods/dust),
`night` (fireflies + chimney at 22:30 in July: `day: 19`), `autumn` (leaves, `day: 29`), `rain`.
Since effects animate, stage emitters that are already running (pre-warm N seconds in `stage`).
