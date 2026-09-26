# Brief: audio (wave 1)

Procedural WebAudio only (no sample files). Must never throw when the AudioContext is suspended
(headless / before the first user gesture); unlock on first pointerdown/keydown.

## Required API
- `play(id, { x?, y?, volume?, pitch? })` one-shots: `ui-click`, `ui-open`, `coin`, `error`,
  `footstep-grass|gravel|asphalt|mud|snow`, `door`, `moo`, `cluck`, `baa`, `bark`, `plough-clod`,
  `harvest-thresh`, `horn`, `splash`, `thunder`.
- `loop(id, { x, y, volume })` → handle `{ setPosition(x,y), setParam(name, v), setVolume(v), stop() }`;
  loops: `engine-tractor`, `engine-car`, `engine-combine` (params `rpm` 0..1, `load` 0..1), `river`,
  `wind`, `rain`, `crickets`, `birds`.
- `setListener(x, y, zoom)` (defaults to camera each frame) — positional panning + distance attenuation.
- `setVolume(bus, v)` buses `master|sfx|ambience|music`, `mute(bool)`, `isUnlocked()`.
Ambience director (automatic): birds by day (dawn chorus peak), crickets/owl at night in summer,
wind ∝ `environment.weather.wind.speed`, rain ∝ intensity, thunder in storms, river near water
(`terrain.riverPaths()` if present). Optional deps: environment, terrain — tolerate absence.
Gentle optional generative music (acoustic pluck/pad, very quiet, only mornings/evenings).

## Showcase (make sound visible)
Render each synthesized sound with an OfflineAudioContext and draw a painted "sound board" on the
`screen` layer: waveform + spectrogram per sound, labelled, in the game's paper/ink style, plus the
live ambience mixer levels for the current time/weather. Presets: `default` (sound board),
`ambience-day`, `ambience-night`, `engines`.
