# Brief: characters (wave 2)

The playable farmhands and villagers. Namespaces `characters`, `player`. Deps: none hard.
Optional: vehicles (enter/exit/control), crops (hand tools), simulation (jobs, wages), ui
(portrait bar via `setCharacters`, prompts), effects (footprints), audio (footsteps), buildings, animals.

## Player control
- The player owns 1 character at start ("you"), can hire more via `simulation.hireWorker` → new
  farmhand character. **Tab** cycles the active character (camera follows the active one, smoothly);
  portrait bar click via ui. Non-active characters keep working on assigned tasks (simple AI:
  walk to point / follow job / idle at home / sleep at night) or wait.
- WASD/arrows walk (Shift run), collide with `ctx.spatial` solids, walk speed 1.4 m/s, run 3.5 m/s.
- **F** near a vehicle (≤ 3 m) enters it (becomes driver; WASD then calls `vehicles.control`), F again exits.
- **E** interact: hand tools (hoe, watering can, seed bag, pitchfork) via `crops.work`, feed animals,
  open shop/job boards when near buildings (via ui panels), pick up items.
- Tool selection 1–5.

## Data & API
`world.characters.list = [{ id, name, role:'player'|'hired'|'villager', x, y, rot, state, vehicleId, task, appearance }]`,
`world.player = { activeCharacterId }`
- `spawn({ name, role, x, y, appearance? })` → id · `list()` · `get(id)` · `active()` · `setActive(id)` · `cycle()`
- `assignTask(id, task)` task: `{ kind:'goto'|'work'|'idle'|'follow', ... }` · `positionOf(id)`
- `villagers(count, area)` spawns ambient villagers who walk pavements (roads API optional) by day, go home at night.
Events: `characters:switched`, `characters:spawned`, `characters:interact`.

## Rendering
Top-down painted people (~0.5 m shoulders): head/hair from above, shoulders, arms swinging, legs
stepping (4–8 frame walk cycle as cached sprites), clothing colours per character (overalls, flat
cap, wellies), held tool. Active character gets a subtle ground ring (world-ui). Shadow:
`F.shadow.circle(x, y, 0.3, 0, 1.75)`. At night hired hands carry a lantern (`F.light`).

## Showcase presets
`default` (3 farmhands in a yard, one walking ~48 px/m), `crowd` (villagers on a street ~24 px/m), `night`.

---
## Addendum (director, built ahead of wave 2)
Vehicles/crops/animals/buildings don't exist yet — all optional, must be null-safe, and the code paths
for them must be ready (call their brief APIs when `ctx.modules.get()` returns them).
Must work NOW with wave-1 modules:
- **Full game auto-spawn**: until a `demo` module exists, when not in showcase mode (`!ctx.params.showcase`)
  spawn the player farmer and one hired hand at a dry, flat spot near the map centre
  (`terrain.findDry`), set the player active and camera-follow it. Expose `setAutoSpawn(false)` so demo can take over.
- Movement: WASD/arrows, Shift run, speed modulated by surface (`terrain.surfaceAt`: slower in mud/sand,
  blocked by deep water via `terrain.waterDepthAt` > 0.5 m, wading in shallows), collide with `ctx.spatial` solids.
- Tab/portrait bar switching via `ui.setCharacters`; smooth camera hand-over.
- Hand tools (1–5, E to use at the tile in front): hoe tills grass → `terrain.paintSurface({x,y,r}, 'soil')`
  (or `crops.work('cultivate', …)` when crops exists), watering can, seed bag, pitchfork, hand.
  Tool use has an animation, a short cooldown, costs a little stamina, emits effects (clods/dust) and audio.
- Contextual prompts via `ui.setPrompt` ("E — Hoe the verge", "F — Enter tractor" when vehicles exists).
- Jobs: presence-based jobs from `simulation` (e.g. `shopHelp`/`villageWork`) — standing at the job location
  calls `simulation.tickPresence(jobId, gameSeconds)`; show progress as a world label.
- Non-active characters: simple AI tasks (goto/work/idle/follow the player), sleep at night.
- Footsteps via `audio.play('footstep-<surface>')`, footprints/trails via effects (in mud and snow), lantern light at night.
- Save/load of characters.
Showcase presets: `default` (farmhands at a yard ~48 px/m), `walk` (walk cycle close-up), `night`, `crowd`.
Verification: besides screenshots, a scripted puppeteer run (scratchpad) pressing keys in the FULL GAME
(`--keys` in tools/shot.js supports `KeyD:1500,Tab,KeyE`) must show the character moving, switching, and tilling soil.
