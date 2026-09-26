# Core requests from `ui`

## 1. `tools/shots.js`: forward `--extra` (and `--w/--h` already work) to `shot()`
**What:** in `tools/shots.js` main loop, pass `extra: opts.extra` into the `shot({...})` call.
**Why:** the ui showcase supports `&uisolo=1` (load the ui without its showcase deps) so the HUD
can be verified while terrain/roads/simulation are mid-build and throwing errors / costing 100+ ms
per frame. `shot.js` supports `--extra`, but `shots.js` drops it.
**Proposed code:** `const log = await shot({ ..., extra: opts.extra });`

## 2. (minor) core "demo module not built yet" overlay text overlaps the money card
`boot.js` draws the placeholder text at (24, 40) on the canvas, which sits under the top-left HUD.
Suggest moving it to bottom-centre or into `#boot-msg`. Goes away once `demo` exists.
