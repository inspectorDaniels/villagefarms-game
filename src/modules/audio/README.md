# audio

Procedural WebAudio for Harvest Valley: no samples. It covers one-shots (UI, footsteps, farm, animals and weather), continuous loops (engines and ambience beds), an automatic ambience director, positional mixing, and a showcase "sound board" that renders every sound offline so you can inspect it visually.

## Files
- `synth.js`: per-context resources (seeded white, pink and brown noise, cached PeriodicWaves, generated buffers), node helpers, envelopes, and instruments (mallet, FM bell, formant `voice`, Karplus-Strong pluck, granular noise).
- `oneshots.js`: `ONESHOTS[id](ac, out, t, R, o)` returns the duration.
- `loops.js`: `LOOPS[id](ac, out, R, o)` returns `{ set(name, v, t), tick?(t0, t1), stop(t) }`. It contains the engine model, the ambience beds and the bird, owl and music schedulers.
- `director.js`: pure functions that turn time, season and weather into layer levels. Includes the sunrise and sunset times for 51°N.
- `board.js`: showcase only. Renders sounds with OfflineAudioContext, runs the STFT, pitch and level analysis, and paints the board.

Every builder takes a `BaseAudioContext`, so the board renders exactly the code the game plays.

## API (`ctx.modules.get('audio')`)
| call | notes |
|---|---|
| `play(id, { x?, y?, volume?=1, pitch?=1, dist?, bus? })` → `bool` | Returns `false` if the sound is locked, unknown, culled (inaudible) or the voice cap (32) is reached. `x,y` in metres makes it positional. `dist` 0..1 applies to `thunder` only. |
| `loop(id, { x?, y?, volume?, rpm?, load?, speed?, intensity?, flow?, density?, params? })` → handle | Handle: `setPosition(x,y)`, `setParam(name, v)`, `setVolume(v)`, `stop(fade?)`, `playing`. Handles never throw. They are "virtual" until the context exists, and they materialize on unlock. |
| `setListener(x, y, zoom)` | Pins the listener to a position. `setListener()` with no args returns to following the camera (the default, updated each frame). |
| `setVolume(bus, v)` | Buses are `master`, `sfx`, `ambience`, `music`; v is 0..1. |
| `mute(bool)`, `isUnlocked()`, `unlock()` | `unlock()` can be called from a UI gesture handler. |
| `levels()` | Director levels `{birds, crickets, owl, wind, rain, river, music, state, voices}`. |
| `sounds()` | `{ oneshots:[ids], loops:[ids] }`. |

**One-shots:** `ui-click ui-open coin error footstep-grass|gravel|asphalt|mud|snow door moo cluck baa bark plough-clod harvest-thresh horn splash thunder`

**Loops and params:**
- `engine-tractor`, `engine-car`, `engine-combine`: `rpm` 0..1 and `load` 0..1.
- `river`: `flow`.
- `wind`: `speed` 0..1.
- `rain`: `intensity`.
- `crickets`: `intensity`.
- `birds`: `density`, `season`.
- `owl`: `density`.
- `music`.

**Positional model.** The listener has a "camera height" H = 0.55 × half the view width (clamped 5–160 m).
- Gain is (9 m / √(d² + H²))^1.15, so zooming out makes the world quieter.
- Pan follows the screen-x offset.
- An air-absorption lowpass falls off with distance.

## Synthesis notes
- **Engines.** One PeriodicWave per engine at the 4-stroke *cycle* frequency (rpm/120):
  - Harmonics at multiples of the cylinder count are the firing orders (strong), half orders are medium, and the rest are seeded cylinder irregularity.
  - Soft and hard spectra crossfade with `load`, followed by a tanh drive, exhaust resonances (peaking filters) and a load/rpm lowpass.
  - Combustion clatter is band-passed noise gated by a firing-rate pulse train. The model adds intake noise and a turbo whistle.
  - Per engine: tractor transmission whine, car tyre roar, and for the combine a threshing drum, grain rush, straw-walker rattle and fan.
  - A single ConstantSource drives every oscillator frequency, so all parts stay phase-locked to rpm.
  - Inertia is modelled with `setTargetAtTime`.
- **Animals.** A glottal source (1/n^tilt) with pitch contour, vibrato and jitter feeds parallel band-pass formants with moving F1/F2, then a mouth lowpass, and amplitude or roughness tremolo.
  - The sheep bleat uses 22 Hz FM+AM.
  - The moo uses an "mm→OOO" formant opening.
- **Birds.** Scheduled calls from seasonal species weights: blackbird, chaffinch, great tit, sparrow, wood pigeon, cuckoo, crow and tawny owl. Each call gets its own pan and distance filter.
- **Ambience beds.**
  - Wind uses gust envelopes from a seeded smooth-noise control buffer. It drives the rush band, a whistle resonance, low buffeting and leaf rustle.
  - Rain uses a generated drop buffer (ticks + pings) over hiss and rumble.
  - The river uses modulated noise bands plus Minnaert bubbles.
  - Crickets use a generated chirp buffer with a bush-cricket trill.

## Director (automatic, every 0.25 s)
- **Birds:** a dawn-chorus peak at sunrise + 0.45 h, a daytime plateau and a dusk bump. Scaled by season, and reduced by rain, strong wind and snow.
- **Crickets:** at night, mainly in summer. Scaled by temperature (if `weather.temperature` exists) and suppressed strongly by rain.
- **Owl:** night only, strongest in autumn and winter.
- **Wind:** proportional to `weather.wind.speed`.
- **Rain:** follows `intensity` for rain and storm weather.
- **Thunder:** random claps every 7–29 s in storms.
- **River:** a positional loop placed at the nearest point of `terrain.riverPaths()` (or `world.terrain.rivers`, or an `isWater` ring probe).
- **Music:** a quiet pluck + pad around 07:30 and 19:30.
- **Fog and snow:** muffle the ambience bus.

Weather comes from `world.environment.weather`, then `environment.getWeather()`, then `?weather=`, then clear. Everything tolerates absent modules.

## World data (`world.audio`)
`{ unlocked, state, muted, volumes, mixer:{...levels}, listener:{x,y,zoom,manual}, voices, oneshots, thunderCount, analysis }`

`analysis` is filled by the showcase with per-sound peak, RMS, f0 and centroid.

## Events
- Emits `audio:unlocked` once, when the context starts running.

## Showcase presets
- `default`: the sound board with all 29 sounds.
- `engines`: rpm/load sweeps with measured rpm.
- `ambience-day`: May, 05:10 dawn chorus.
- `ambience-night`: July, 23:30.

`?weather=storm` etc. overrides the weather. The sidebar shows director levels, live bus meters from real AnalyserNodes, and a 24 h level chart.

## Known limitations
- The AudioContext is created only on the first gesture (or in the showcase). No sound plays before that, and `play()` returns false.
- There is no HRTF or occlusion; panning is stereo only.
- Loops keep running at zero gain while inaudible. The director stops its layers after 5 s of silence, but game-created loops must be `stop()`ed by their owner.
- The sound design was validated visually (spectrograms, pitch and level analysis), not by listening.
