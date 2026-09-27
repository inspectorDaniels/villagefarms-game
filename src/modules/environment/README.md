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
| `sun` | `{ azimuth, elevation, dirX, dirY, shadowLen, shadowStrength, color:[r,g,b], source }`. `azimuth`/`elevation` are always the **sun** (radians; azimuth from north, clockwise). `dirX,dirY,shadowLen,shadowStrength,color` describe the light that currently casts shadows: `source` is `'sun'`, or `'moon'` on clear moonlit nights (faint moon shadows). `shadowLen = min(8, 1/tan(elev))`. `shadowStrength = 0.45 · fade(elev −1°…5.5°) · (1−0.7·fog) · (1−0.6·precip) · overcastFade` where `overcastFade` is 1 up to cloudCover 0.72 and 0 at 0.96: direct sun through cloud gaps is as hard as on a clear day, so object shadows stay crisp on partly cloudy days (core composites cloud shadows separately). `cloudShadowStrength = 0.5 · fade(elev) · (1−0.7·fog) · (1−0.6·precip)` (0 for moon/lightning light). |
| `moon` | `{ azimuth, elevation, phase (0 new, 0.5 full), illumination 0..1 }` |
| `ambient` | `[r,g,b]` multiply colour. Clear noon ≈ `[255,255,250]`; golden hour amber; mauve/blue hour; night ≈ `[48..66, 60..84, 112..146]` depending on the moon (keys in `sky.js AMB_KEYS`; golden-hour keys keep G ≥ 0.85·R so greens stay green). Overcast is greyer and cooler, fog is milky, and snow cover brightens it. There is a gameplay floor of `[44,55,104]` (`NIGHT_FLOOR`) that also holds after the screen grade: night and blue-hour grading only ever lifts (`screen`), the night vignette is capped at 0.35, so a rainy new-moon night keeps grass at a mean luminance of about 40. Lightning flashes spike it for about 0.2 s. |
| `daylight` | 0..1, smoothstep of solar elevation −9°…5°. |
| `darkness` | 0..1, smoothstep of solar elevation −4°…−13°: 0 through civil twilight, 1 at astronomical night. The screen grade uses it for the night tint, desaturation and vignette. The blue-hour amount is `1 − daylight − darkness`. |
| `sky` | `[r,g,b]` sky tint for reflections (water, puddles, glass). |
| `golden` | 0..1 golden-hour factor (low sun, clear sky). |
| `weather` | `{ kind, intensity, cloudCover, wetness, snowCover, fog, rain, snow, storm, precipitation, wind:{x,y,speed}, temperature, forced }`. `kind` is one of `clear, cloudy, overcast, rain, storm, fog, snow`. Derived fields: `wetnessLevel` and `snowLevel` are `wetness`/`snowCover` rounded to 0.05 steps (0..1), for chunk-cached ground art that should repaint only on a step change. `rainRate` is the rain rate in mm/h, `rain·(6 + 20·storm)`: 0..26, about 0.5 for drizzle, 5–6 for steady rain and up to 26 in a heavy storm. `snowRate` is the snowfall in mm/h water equivalent, `snow·3`: 0..3. `forced` is true while `setWeather` overrides the plan. Rain intensity 0 is a drizzle (`rain` 0.08), and intensity 0.2 and up gives `0.25 + 0.75·i`. All continuous values are 0..1 except wind (m/s; the vector points where the wind blows **to**, with x east and y south) and temperature (°C). |
| `forecast` | `[{ day, kind, tempMin, tempMax, rainMm }]` for the next 5 days, refreshed on `clock:day`. |

Weather params blend toward the plan with a 25-game-minute time constant. Wetness rises in rain and dries with sun, warmth and wind. Snow cover builds below about 1.8 °C and melts into wetness. When the clock jumps (time/day set, or a load), the state is rebuilt by replaying the last 12 game hours, so the ground is plausibly wet or snowy at once.

## API (`ctx.modules.get('environment')`)
- `getSun()` → `world.environment.sun`
- `getMoon()` → `world.environment.moon`
- `getWeather()` → `world.environment.weather`
- `setWeather(kind, intensity = 0.7, { instant, warm } = {})` forces the weather (use `'auto'` to release it back to the seasonal plan; `weather` is republished at once, with `forced: false`, and the weather snaps when paused or `instant`). It snaps immediately when `instant` or when the clock is paused/frozen, and it also warms up the ground state for 3 h of that weather. `?weather=<kind>&intensity=<0..1>` is applied at init.
- `forecast(days = 5)` → array like `world.environment.forecast` (max 14).
- `windAt(x, y)` (non-finite inputs are treated as 0) → `{ x, y, speed, gust 0..1, base }`: gusty, noise-based local wind that advects with the mean wind (for foliage sway and particles).
- `isNight()` → `daylight < 0.3`
- `lightLevel()` → 0..1 (daylight dimmed by cloud and fog)

## Events
`env:weather-changed {kind, intensity, prev}`, `env:dawn {day,time}`, `env:dusk {day,time}`,
`env:lightning {x, y (screen fractions), distance (km, for thunder delay)}`. It listens to `clock:day`.

## Rendering
- Collector: `F.shadow.cloud` draws drifting, soft cloud shadows into core's separate cloud-shadow buffer (composited with `sun.cloudShadowStrength`, masked where object shadows are, so they never double-darken). Falls back to `F.shadow.custom` on an older core. Cover > 0.8 fades them out because the light is already flat.
- `weather` layer: rain/snow haze, fog (a thin milky veil plus three decorrelated bank scales — 900 m valley density, 240 m banks, 96 m wisps — each rotated differently with ≤1.25 stretch and wide soft edges; total opacity capped so objects keep about half their contrast), snow (4 parallax flake-sheet layers that sway with the wind), and rain (world-anchored streaks in 3 depth layers — far haze ticks, mid, long near drops — with per-drop length/angle jitter and wind-advected gust-sheet density clumps, batched into 6 strokes; `weather.rainRate` mm/h is published for splash/audio sync).
- `screen` layer: golden hour = a warm `screen` gradient from the sun's side + low-alpha warm `overlay` + a little extra saturation (lifts, never muddies; no overcast desaturation while golden > 0); blue hour and night = cool `screen` lifts only (never darkening); desaturation for overcast/fog/night/blue hour; a vignette capped at 0.35; and a lightning flash (during a strike the sun data also points away from the strike with hard, cool shadows). `?flash=1` holds a flash during storms (a screenshot aid).

## Showcase presets
`default` (April 10:30, cloudy: cloud shadows), `noon` (June 13:00 clear), `golden` (July 19:55),
`night` (August 23:30, full moon), `rain` (October 15:00), `fog` (November 08:40), `snow` (January 11:30),
`storm` (July 17:30), `closeup` (July 21:40, lamp and shed in the blue hour, sun ≈ −7.5°, zoom 44). The scene shows a shed with a chimney, oaks (bare in winter, with lace-like branch shadows), pines, a poplar row (tall slim shadows), a windsock and tall grass that follow `windAt`, a lamp post and a door light (`F.light`, on at dusk, in fog and in storms), bales, crates, a fence, a dry-stone wall, and puddles that appear with `wetness` and reflect `sky`.

## Known limitations
- The clock is treated as zone time for Brussels (≈4.4°E, CET): solar noon ≈ 12:43 on the clock (`CLOCK_TO_SOLAR_H`), no DST. Summer sunset is about 21:00 with civil twilight lasting until about 21:45.
- The moon is approximate: one lunation per game month, with simplified declination.
- Rain and snow drift is in real time (it keeps animating while the clock is frozen, which is intended).
- The showcase ground, puddles and snow overlay belong to the showcase. In the game, terrain should read `weather.wetness`, `weather.snowCover` and `sky`.
