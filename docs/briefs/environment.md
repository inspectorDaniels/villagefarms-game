# Brief: environment (wave 1)

Sun, sky light, seasons' light, weather and wind. This module drives the core shadow and lighting
passes through `world.environment` — get it right and every other module looks good.

## Data (`world.environment`) — shapes are fixed by ARCHITECTURE §3
- `sun = { azimuth, elevation, dirX, dirY, shadowLen, shadowStrength, color:[r,g,b] }`
  Real solar geometry at latitude 51°N using `ctx.clock.yearFrac` + `timeOfDay`
  (declination, hour angle). `dirX,dirY` = unit vector shadows point along (x east, y south).
  `shadowLen = min(8, 1/tan(elev))`. `shadowStrength` ≈ 0.45 clear midday, fades to 0 as sun sets,
  × (1 − 0.85·cloudCover).
- `ambient = [r,g,b]` multiply colour: warm white noon, golden hour amber, blue hour, deep blue
  night (≈[38,48,92]), slightly brighter on full-moon nights. Overcast = cooler/greyer, fog = milky.
  `daylight` 0..1.
- `weather = { kind: 'clear'|'cloudy'|'overcast'|'rain'|'storm'|'fog'|'snow', intensity 0..1,
  cloudCover 0..1, wetness 0..1 (rises in rain, dries in sun), snowCover 0..1, fog 0..1,
  wind: { x, y, speed m/s }, temperature °C }` — seasonal climate (Belgium-like).
- `forecast = [{ day, kind, tempMin, tempMax, rainMm }]` next 5 days.

## Required API
`getSun()`, `getWeather()`, `setWeather(kind, intensity?)` (forces; used by `?weather=` too),
`forecast(days)`, `windAt(x, y)` (gusty, noise-based, for foliage sway/particles),
`isNight()`, `lightLevel()` (0..1).
Events: `env:weather-changed`, `env:dawn`, `env:dusk`.
Read `ctx.params.weather` (e.g. `?weather=rain`) at init to force weather for screenshots.

## Visuals (layers)
- Cloud shadows: `F.shadow.custom` drawing soft noisy cloud blobs drifting with wind (density ∝ cloudCover).
- Rain: angled streaks by wind in `weather` layer, world-space, culled; splashes are effects' job.
- Snow: drifting flakes. Fog: layered noise banks in `weather` or `screen` layer, not a flat grey.
- Storm: occasional lightning flash (brief ambient spike) — seeded.
- Screen grading: subtle vignette + dusk warm grade on `screen` layer. Never obscure gameplay.
- Everything deterministic from rng streams; smooth transitions between weather states.

## Showcase
Its own small painted backdrop (grass patch, a few simple painted posts/boxes/tree blobs from your
own folder, a lamp) to demonstrate shadow direction/length through the day, lights at night,
cloud shadows, rain/snow/fog. `showcase.deps` may include `terrain`.
Presets ≥ 5: `noon`, `golden`, `night`, `rain`, `fog`, `snow`, `storm` (each sets time/day/weather).
