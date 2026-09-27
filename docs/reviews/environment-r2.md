# environment — review round 2
Score: 7/10   Pass: yes

This round is weighted toward function, per the user's iteration-2 directive (mechanics and gameplay first, visual polish deferred). Cosmetic issues are listed under Should fix.

Screenshots examined (all opened):
- shots/review/environment-r2/preset_default.png, preset_golden.png, preset_night.png, preset_closeup.png, preset_fog.png, preset_snow.png, preset_rain.png, preset_storm.png
- shots/review/environment-r2/newmoon_rain_2330.png (day 32, 23:30, rain), storm_flash.png (`--extra flash=1`), game_night_rain.png (full game, 23:00, rain)
- The following were measured from their JSON only and not visually judged: the full batch shots/environment/review-r2/* (9 presets × 07:00/12:30/19:30/23:30, all ok) and the remaining extras in shots/review/environment-r2/ (day20/day32/oct, fog_far, cloudy_far, rain_close, storm_night, game_dusk*, game_noon_cloudy, game_fog, rerun_*).

Perf:
- Full game: frameMsAvg 12.9–24.7 and p95 31–126. Those numbers are from a loaded shared machine and come from the whole game, not this module.
- drawCalls 42–140.
- **environment msAvg in the game: 0.21 (cloudy noon), 0.30 (fog), 0.43–0.51 (dusk), 0.46 (rain night).**
- Showcase msAvg: 0.4–1.6 under parallel load, with outliers of 2.47 (fog 07:00) and 2.36 (rain 07:00). Rerun singly, those were 0.67 and 0.84 (frameMsAvg 1.9/1.5), so it is within the 1.5 ms budget. Note that the showcase figure includes the showcase scene's own painting.

Errors: 0 console and 0 page errors across all 60+ runs.   Contract: 0 issues.
- The manifest `api`, the README and the implementation match.
- All 4 declared events are emitted.
- It writes only `world.environment`, has no cross-module imports, and needs no optional deps.

Lint: `lint OK`.

Functional probes I ran in a headless page:
- **Deterministic:** two independent loads with the same params produce byte-identical `world.environment`.
- **No spurious dawn/dusk events:** clock jumps via `setTime` fire none. Running at speed 600 through sunset fires exactly one `env:dusk`.
- **API edge cases:** `setWeather('rain', 0)` now gives intensity 0. `setWeather('hail')` warns without throwing. `forecast()` clamps to the range 1..14.
- **Night at 23:00:** `isNight()` is true, `lightLevel()` is 0, and ambient sits on the floor `[44,55,104]`.
- **Lightning:** it is scheduled in the fixed-step `update()`, so it no longer depends on frame rate.

## Verdict
The simulation side is solid, and the r1 must-fixes that affect gameplay are resolved:
- **Night readability, the one that mattered:** I measured it myself. A rainy new-moon showcase night has grass luma 40.1 and a frame mean of 42 (newmoon_rain_2330.png). The full game at 23:00 in rain has a play-area luma of 41.5 (game_night_rain.png). The full-moon night is at 48.7. Paths, trees, the shed and the river edge all stay legible.
- **Fog:** the column streaks are gone (preset_fog.png).
- **Cloud shadows:** they now read clearly as a sun/shade patchwork through the core cloud buffer (preset_default.png).
- **Closeup:** it has moved to the blue hour.
- **Lightning:** it now throws hard directional shadows (storm_flash.png).

Golden hour is still not right. It has swapped khaki for acid chartreuse, which is cosmetic under the current directive. The published state is deterministic, well-shaped and cheap, and the API is safe to call.

## Must fix (ordered)
1. **The `keepGround` latch can stick.** `load()` sets `keepGround = true` and also sets `lastT = clock.t`. If the loaded clock is already in place when `load()` runs, which is the normal case when core restores `world.time` first, no jump is detected and the flag is never consumed. The *next* real clock jump, for example sleeping to morning or a day skip, then skips the 12 h ground replay and keeps stale wetness and snow cover. Fix: clear `keepGround` on the first `update()` after `load()`, whether or not a jump was detected.
2. **`world.environment` has undocumented public fields.** `darkness`, `weather.wetnessLevel`, `weather.snowLevel` and `weather.snowRate` are published and meant for terrain, effects and audio, but they are missing from the README's World data table (`rainRate` is mentioned only under Rendering). Other modules will consume these, so document their units and ranges.

## Should fix
- **Rain at intensity 0 still rains.** `setWeather('rain', 0)` publishes `rain: 0.25`, because `targetsFor` floors rain at 0.25 + 0.75·i. Either document that intensity 0 means light rain, or map 0 to drizzle.
- **Ground wetting is very fast.** Light rain (0.25) takes the ground from dry to fully wet (1.0) in about 50 game-minutes, and 3 h of forced warm-up always saturates it. If crops or vehicles key mud or soil moisture off `wetness`, that is abrupt. Consider slowing it, or publishing a slower `soilMoisture` separately.
- **`setWeather('auto')` returns a stale object** (`forced: true`) until the next `update()`, and it doesn't snap while paused. Republish immediately.
- **`windAt` doesn't guard its inputs:** `windAt(NaN)` returns null or NaN components. It is cheap to guard.
- **The README overstates the golden-hour colour keys.** It says the keys keep G ≥ 0.85·R, but the 0° and 3° keys are 0.78 and 0.84.
- **Golden hour is cosmetic but still off** (preset_golden.png):
  - Sunlit grass is `[141,148,45]` at hue ≈64°, versus the noon grass hue ≈88°. That is chartreuse, not glowing green.
  - Blue is crushed to about 44 across the whole frame.
  - The wall and tree shadows are `[120,114,45]`: olive and warm, not cool.
  - The saturation push toward `#d8661c` plus the overlay is the cause. Let the shadows keep some blue.
- **The closeup blue hour is still grey-green** (preset_closeup.png): grass is `[70,82,70]`, not the blue-violet you'd expect. The lamp pools are yellow-green (`[129,130,93]`).
- **Showcase-only details:**
  - The snow ground shows faint linear streaks (preset_snow.png: diagonals at the top left and right, and horizontals near the fence).
  - Bales under snow read as hollow rings.
  - Puddles are still hard, saturated blue blobs at night (preset_night.png, newmoon_rain_2330.png).
- **Game night grass leans slate-blue:** B > G (`[34,43,53]`). It is readable, so this is a taste call.

## What works
- **Solar and lunar geometry:** still correct. Shadows fade correctly for overcast, fog and precipitation, and moon shadows appear on clear nights.
- **The night floor holds after the screen grade:** the night and blue-hour grade only lifts, and the vignette is capped at 0.35. I verified this numerically.
- **Weather is deterministic and seasonal.** It has a 12 h ground replay on clock jumps, a sensible 5-day forecast, and a stepped `wetnessLevel`/`snowLevel` for chunk-cached ground art. `rainRate` is published for splash and audio sync.
- **Lightning:** it is a fixed-step, seeded schedule with `env:lightning {x, y, distance}` for thunder delay, and the strike acts as a real, hard directional light.
- **Cloud shadows:** they use `F.shadow.cloud` with a fallback to `F.shadow.custom`, and they are masked against object shadows, so there is no double-darkening.
- **Fog:** three decorrelated scales with no streaks.
- **Rain:** clumped, depth-layered rain that reads as weather.
- **Cost:** 0.2–0.5 ms in the game.
