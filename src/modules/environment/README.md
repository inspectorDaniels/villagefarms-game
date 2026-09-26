# environment

Sun and moon, ambient light, sky tint, seasonal weather, wind, cloud shadows, precipitation and fog
rendering, and the screen grade. It drives the core shadow and lighting passes through `world.environment`.

Files:
- `sky.js`: pure maths. Solar position (NOAA declination and equation of time, hour angle, 51°N, refraction near the horizon), a compact moon model (one lunation per game month) and the colour model for ambient, sunlight and sky.
- `weather.js`: the deterministic seasonal climate (Belgium-like monthly min/max temperatures, wetness, storm and fog propensity). A slow "pressure" noise sets the regime. Each day has 4 × 6-hour segments.
- `fx.js`: baked tileable cloud/fog noise field, cloud-shadow texture, flake sheets, rain streaks, fog banks, and the screen grade (vignette, golden-hour warmth, overcast/night desaturation, moonlight wash, lightning).
- `showcase.js`: the painted showcase scene, which is showcase-only.

## World data (`world.environment`)
| field | meaning |
|---|---|
| `sun` | `{ azimuth, elevation, dirX, dirY, shadowLen, shadowStrength, color:[r,g,b], source }`. `azimuth`/`elevation` are always the **sun** (radians; azimuth from north, clockwise). `dirX,dirY,shadowLen,shadowStrength,color` describe the light that currently casts shadows: `source` is `'sun'`, or `'moon'` on clear moonlit nights (faint moon shadows). `shadowLen = min(8, 1/tan(elev))`. `shadowStrength = 0.45 · fade(elev −1°…5.5°) · (1−0.85·cloudCover) · (1−0.7·fog) · (1−0.6·precip)`. |
| `moon` | `{ azimuth, elevation, phase (0 new, 0.5 full), illumination 0..1 }` |
| `ambient` | `[r,g,b]` multiply colour. Clear noon ≈ `[255,255,250]`; golden hour amber; mauve/blue hour; night ≈ `[34..51, 44..66, 88..118]` depending on the moon. Overcast is greyer and cooler, fog is milky, and snow cover brightens it. There is a gameplay floor of `[32,40,76]`. Lightning flashes spike it for about 0.2 s. |
| `daylight` | 0..1, smoothstep of solar elevation −9°…5°. |
| `sky` | `[r,g,b]` sky tint for reflections (water, puddles, glass). |
| `golden` | 0..1 golden-hour factor (low sun, clear sky). |
| `weather` | `{ kind, intensity, cloudCover, wetness, snowCover, fog, rain, snow, storm, precipitation, wind:{x,y,speed}, temperature, forced }`. `kind` is one of `clear, cloudy, overcast, rain, storm, fog, snow`. All continuous values are 0..1 except wind (m/s; the vector points where the wind blows **to**, with x east and y south) and temperature (°C). |
| `forecast` | `[{ day, kind, tempMin, tempMax, rainMm }]` for the next 5 days, refreshed on `clock:day`. |

Weather params blend toward the plan with a 25-game-minute time constant. Wetness rises in rain and dries with sun, warmth and wind. Snow cover builds below about 1.8 °C and melts into wetness. When the clock jumps (time/day set, or a load), the state is rebuilt by replaying the last 12 game hours, so the ground is plausibly wet or snowy at once.

## API (`ctx.modules.get('environment')`)
- `getSun()` → `world.environment.sun`
- `getMoon()` → `world.environment.moon`
- `getWeather()` → `world.environment.weather`
- `setWeather(kind, intensity = 0.7, { instant, warm } = {})` forces the weather (use `'auto'` to release it back to the seasonal plan). It snaps immediately when `instant` or when the clock is paused/frozen, and it also warms up the ground state for 3 h of that weather. `?weather=<kind>&intensity=<0..1>` is applied at init.
- `forecast(days = 5)` → array like `world.environment.forecast` (max 14).
- `windAt(x, y)` → `{ x, y, speed, gust 0..1, base }`: gusty, noise-based local wind that advects with the mean wind (for foliage sway and particles).
- `isNight()` → `daylight < 0.3`
- `lightLevel()` → 0..1 (daylight dimmed by cloud and fog)

## Events
`env:weather-changed {kind, intensity, prev}`, `env:dawn {day,time}`, `env:dusk {day,time}`,
`env:lightning {x, y (screen fractions), distance (km, for thunder delay)}`. It listens to `clock:day`.

## Rendering
- Collector: `F.shadow.custom` draws drifting, soft cloud shadows into the core shadow buffer, so they union with object shadows and never double-darken. Cover > 0.8 fades them out because the light is already flat.
- `weather` layer: rain/snow haze, fog (a milky veil plus two scales of wind-stretched banks as seamless patterns), snow (4 parallax flake-sheet layers that sway with the wind), and rain (world-anchored angled streaks with a short life each, batched into 4 strokes).
- `screen` layer: golden-hour soft-light wash from the sun's side, a moonlight blue wash at night, desaturation for overcast/fog/night, vignette, and a lightning flash. `?flash=1` holds a flash during storms (a screenshot aid).

## Showcase presets
`default` (April 10:30, cloudy: cloud shadows), `noon` (June 13:00 clear), `golden` (July 19:10),
`night` (August 23:30, full moon), `rain` (October 15:00), `fog` (November 08:40), `snow` (January 11:30),
`storm` (July 17:30), `closeup` (lamp and shed at dusk, zoom 44). The scene shows a shed with a chimney, oaks (bare in winter, with lace-like branch shadows), pines, a poplar row (tall slim shadows), a windsock and tall grass that follow `windAt`, a lamp post and a door light (`F.light`, on at dusk, in fog and in storms), bales, crates, a fence, a dry-stone wall, and puddles that appear with `wetness` and reflect `sky`.

## Known limitations
- Clock time is treated as local mean solar time (12:00 ≈ solar noon), so there is no time zone or DST. Summer sunrise is about 03:50 and sunset about 20:15.
- The moon is approximate: one lunation per game month, with simplified declination.
- Cloud-shadow darkness is tied to `sun.shadowStrength` (the core composites every shadow with one alpha), so partly cloudy days also get softer object shadows, as the brief's formula specifies.
- Rain and snow drift is in real time (it keeps animating while the clock is frozen, which is intended).
- The showcase ground, puddles and snow overlay belong to the showcase. In the game, terrain should read `weather.wetness`, `weather.snowCover` and `sky`.
