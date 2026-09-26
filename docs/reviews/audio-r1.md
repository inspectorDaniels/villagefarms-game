# audio — review round 1
Score: 6/10   Pass: no
Screenshots examined:
- shots/review/audio-r1/default_1230.png, default_2330.png (sound board)
- shots/review/audio-r1/engines_1230.png
- shots/review/audio-r1/ambience-day_0700.png, amb-day-storm.png (ambience-day, 14:00, `--weather storm`)
- shots/review/audio-r1/ambience-night_2330.png, amb-night-snow.png (ambience-night, 02:00, `--weather snow`)
- shots/review/audio-r1/game.png/.json (full game, 11:00)
- All 16 preset×time JSONs from `node tools/shots.js audio --tag review-r1` (moved into shots/review/audio-r1/)

Perf: showcase frameMsAvg=0.93–2.18 (storm 4.49), p95 ≤6.1, drawCalls 2–48, audio msAvg=0.18–0.69.
Full game @11:00: frameMsAvg=13.74, p95=40.6, drawCalls=115 (over budget, but that is not audio), **audio msAvg=0.019, status ok**.
That game number means nothing, though: headless has no gesture, so the AudioContext never exists in the game and no sound was ever played live.
**I measured main-thread cost per call in Chrome on the dev server** by importing the module's own `synth.js`, `oneshots.js` and `loops.js` into an OfflineAudioContext and timing each builder:
- One-shots: `footstep-grass` 4.9 ms, `footstep-gravel` 3.8 ms, `plough-clod` 4.4 ms, `thunder` 11.0 ms, `footstep-snow` **14.1 ms**, `harvest-thresh` **58.4 ms**. By comparison `moo` is 0.8 ms and `ui-click` 0.4 ms.
- First creation of each loop: `rain` **157 ms**, `river` **99 ms**, `crickets` 52 ms, `wind` 47 ms. `resources()` takes 46 ms on the first gesture. Engine loops cost 2.2–2.8 ms per instance.

Errors: 0 console / 0 page errors in all 19 shots.   Contract: [] everywhere. Manifest `api` matches `api` keys, `emits` matches the one emit, and there are no cross-module imports or foreign namespace writes.   Lint: `lint OK`.

## Verdict
On paper this is the most sophisticated module in wave 1.
- The engines are a real firing-order model. The board measures the rpm back from the waveform to within 1% of target: tractor 849/2297 rpm vs 850/2300.
- Each bird species has a recognisably different spectrogram: the chaffinch's descending trill, the tit's two-note "tea-cher", the cuckoo's minor third, the tawny owl's "hoo … hu-hoooo" with wavering tail.
- Rain, river, crickets and thunder are built from sensible physical ingredients (drop ticks and pings, Minnaert bubbles, pulsed chirps, a clap-envelope rumble), not beeps.
- The sound board is a beautiful piece of paper-and-ink infographic that sits well in the gouache world.

But the synthesis runs in the wrong place. Every footstep, clod, thunder clap and threshing burst bakes a fresh granular AudioBuffer in JavaScript on the main thread, per call. That costs 4–58 ms each, which is a visible stutter on the single most frequent sound in the game (footsteps). The first rain, first night or first river approach freezes the game for 50–160 ms while buffers are generated.

None of this shows up in `msAvg`, because the showcase only renders offline and the game never unlocks audio headlessly. That is exactly why it has to be called out now, before wave 2 wires footsteps and combines into it. The director also reads the weather's discrete `kind` instead of the eased values environment publishes, and the ambience boards show a mix that is stale relative to the clock they print beside it.

## Must fix
1. **Main-thread synthesis per one-shot (perf budget).** `grainBuffer()` (synth.js) is called inside `grains()` on every `play()`:
   - footstep-* costs 3.8–14 ms per step, thunder 11 ms and harvest-thresh 58 ms (measured in Chrome).
   - One walking character at about 2 steps/s already burns about 10 ms/s. A combine harvesting would stall a frame on every call.
   - Fix: pre-bake N (e.g. 4–6) seeded variants per grain recipe with `cachedBuffer()` and pick one per call, varying playbackRate, offset and filter. Do this lazily on first use of each id, or amortised in idle slices after unlock.
   - Target: every `play()` under 0.5 ms main-thread time.
2. **Loop first-creation hitches.** The first `rain` takes 157 ms, `river` 99 ms, `crickets` 52 ms and `wind` 47 ms. Together with `resources()` (46 ms) this lands in one frame, either on the first gesture (the director immediately creates wind and birds) or when weather or night first arrives.
   - Generate these buffers in time-sliced chunks after unlock (a few ms per frame) and only start a layer once its buffer is ready.
   - Or at least generate them before the director needs them, not synchronously inside `director()`.
3. **Director must use environment's eased weather, not the discrete `kind`.** `world.environment.weather` publishes smoothly ramped `rain`, `storm`, `snow`, `fog` and `precipitation` (0..1). `readWeather()` instead derives `rain` from `kind==='rain'|'storm'` and `intensity`, with three consequences:
   - Rain audio snaps on and off at the kind boundary while the visuals crossfade.
   - `intensity || 0.6` turns a legitimate 0 intensity into 0.6.
   - `snow` and the storm thunder are boolean, so the muffle jumps from 18 kHz to 2.8 kHz in one step, and thunder is gated on `kind==='storm'` instead of `weather.storm > x`.

   Fix: use `w.rain`, `w.snow`, `w.storm` and `w.fog` when they are finite, and fall back to `kind` only when they are absent. The `overcast` kind is also unhandled (harmless, but check it).
4. **The ambience boards contradict themselves.** In ambience-day_0700.png the sidebar says "07:00" but the big "What you hear now" panel says "director mix at 05:10". Likewise, the ambience-night 07:00 and 12:30 shots still show the 23:30 owl/cricket mix. The board is rendered once at stage time and never follows the clock.
   - Either re-render the mix when the clock or weather changes by more than a threshold, or label it explicitly as the preset snapshot.
   - The offline mix also omits the fog/snow muffle: amb-night-snow.png shows full energy up to 10 kHz in snow, which misrepresents what the game plays. Route the offline mix through `muffleCutoff(W)`.

## Should fix
- **Wind has a permanent floor.** `wind = 0.18 + speed/14` means a broadband noise bed runs at about 40% at a 3 m/s breeze, 24 h a day, in every shot. It is the flat line across the 24 h chart. At calm it should drop to near silence, and it could carry a mild diurnal swing.
  - The wind cell's spectrogram is dark evenly from 100 Hz to 10 kHz (centroid 2.7 kHz), and the whistle resonance is invisible. It reads as filtered hiss rather than air moving round objects.
  - Bias the energy lower and make gusts and whistle more legible.
- **Unlock only works once.** `removeUnlock()` drops the gesture listeners after the first `running` state. If the context later becomes `suspended` or `interrupted` (Safari/iOS, device change), nothing resumes it. Keep a lightweight resume on gesture whenever the state is not `running`.
- **No loop virtualisation.** Every loop keeps running at zero or near-zero gain wherever it is on the map (the README admits this). Each engine is roughly 20 nodes plus a 150-harmonic PeriodicWave. Wave-2 traffic with 15–20 cars will pay audio-thread cost for inaudible engines. Suspend or re-materialise loops whose spatial gain stays below about −50 dB.
- `handle.setPosition()` is silently ignored for loops created without x/y. Either make them positional on first `setPosition` or `ctx.warn`.
- Bird-call and pad nodes created by the scheduler (`pan`, `g`, `lp`) are never disconnected. Scheduler `stop()` fades `master` but never disconnects it. This is minor, but it accumulates over a long session.
- **Moo and baa** show very clean, rigid harmonic stacks (default board: moo f0 120 Hz with 1.8% vibrato). They are plausible formant designs, but likely to sound "vocoder"-synthetic. Add subharmonics or period-doubling roughness and a stronger pitch fall for the moo.
- Default board: two empty grid slots at the bottom right. The 24 h chart's `wind` and `rain` lines are two similar blues and hard to tell apart at chart size.

## What works
- The API matches the brief exactly: `play/loop/setListener/setVolume/mute/isUnlocked`, all 19 one-shot ids and 8 loop ids, and handles with `setPosition/setParam/setVolume/stop`.
  - It is also defensive: every entry point is wrapped, handles are virtual until a context exists, `play()` returns `false` while locked, and no AudioContext is created before a gesture, so there is no autoplay warning in the game.
  - Optional deps (`environment`, `terrain.riverPaths/isWater`) are null-checked with sensible fallbacks.
- The engine model is excellent: phase-locked to one ConstantSource, load crossfade plus drive, turbo, and a transmission whine. The engines board (engines_1230.png) proves rpm tracking and inertia.
- The ambience director logic is sound:
  - Sunrise/sunset are computed for 51°N.
  - The dawn chorus peaks 27 min after sunrise, visible as the green spike in the 24 h chart.
  - Crickets are summer and night, gated by temperature. The owl is strongest in autumn. Rain suppresses birds.
  - Thunder claps land at random 7–29 s intervals, the river is placed at the nearest river point, and quiet music plays only around 07:30 and 19:30.
- The storm mix (amb-day-storm.png) is dense and convincing on the spectrogram: wind 100%, rain 60%, birds cut to 30%, and a thunder crack at 2.2 s.
- The sound board is genuinely in style: torn-paper cards, serif titles, ink waveforms and an ochre spectrogram wash, with honest analysis numbers (peak, RMS, centroid, f0). It draws in 2 calls from a cached canvas.
- Headless showcase perf is trivial (≤0.7 ms), and the error, contract and lint results are clean.
