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
