# characters (wave 2)

Playable farmhands and ambient villagers. The player controls one farmhand at a time and switches with
**Tab** or the portrait bar. Farmhands walk and run with speed that depends on the surface, collide with
solids, wade in shallows and are stopped by deep water. They use hand tools (1–5, **E**), drive vehicles
(**F**) and do presence jobs. Characters you are not controlling run simple AI tasks and sleep at night.
Villagers walk the pavements by day and go home at night.

Namespaces: `characters`, `player`. Hard deps: none. Optional (all null-safe): `terrain`, `environment`,
`roads`, `simulation`, `ui`, `audio`, `effects`, `vehicles`, `crops`, `animals`, `buildings`.

Files:
- `index.js`: manifest, init, API, input, jobs, prompts, rendering hooks, save/load.
- `appearance.js`: seeded outfits, names and portrait data.
- `sprites.js`: painted body parts, tools, bedroll and the showcase props, cached at 96 px/m.
- `body.js`: the pose rig, walk cycle, tool animations, the live/cached draw paths and the lantern position.
- `motion.js`: surface speed, water blocking, collisions and the walk phase.
- `tools.js`: tool table, prompt text (`describe`) and strike effects (`apply`).
- `ai.js`: goto/work/idle/follow/patrol/sleep tasks and villager pavement walking.
- `showcase.js`: staged scenes.

## Controls (active character)
| key | action |
|---|---|
| WASD / arrows | walk at 1.4 m/s. **Shift** runs at 3.5 m/s and drains stamina. |
| Tab | cycle the active farmhand. The camera hands over smoothly: an eased blend over 0.45–1.6 s, scaled by distance. |
| 1–5 | hoe, watering can, seed bag, pitchfork, hands. These are also registered as the `ui` toolbar. |
| E | use the tool on the 1 m cell in front. It plays an animation, has a short cooldown and costs stamina. In a vehicle, E toggles the implement. |
| F | enter the nearest vehicle within 3 m, or leave the current one. Only when `vehicles` exists. |

## Movement
- Surface multipliers from `terrain.surfaceAt`:
  - grass 1, meadow 0.9, soil 0.84, ploughed 0.72, sand 0.72, mud 0.6, forest floor 0.88
  - gravel 0.97, rock 0.9, farmyard 1
  - roads (`roads.roadAt`): asphalt 1.04, lane 1.0, track 0.98
- Snow cover slows walking by up to 22 %.
- Water: in shallows (0.02–0.55 m deep) speed drops to at most `0.62 − depth/2`, with ripple and splash effects. Where `waterDepthAt > 0.5 m` a character cannot step. It slides along the shore instead.
- Collisions: `ctx.spatial` items with `solid:true` (AABB or circle) push the 0.28 m body out, 2 iterations. Characters also separate softly from each other.
- Each character sits in `ctx.spatial` as a non-solid item `{kind:'character'}`, updated at 5 Hz, so other modules can pick them.
- Walk phase advances with the true distance travelled: 1.3 m per cycle walking, 2.1 m running. That gives two footfalls per cycle, which drive:
  - `audio.play('footstep-grass|gravel|asphalt|mud|snow')`
  - `effects.decal('footprint')` once per cycle on soil, ploughed ground, mud, sand or snow
  - ripples or splashes in shallows
  - snow puffs and running dust

## Hand tools (`tools.js`)
| tool | effect without `crops` | with `crops` |
|---|---|---|
| hoe | `terrain.paintSurface(1 m cell, 'soil')` on grass, meadow, forest floor or farmyard; breaks ploughed clods. Emits clods and dust, plays `plough-clod`. | `crops.work('cultivate', x, y, 1, rot)` |
| watering can | marks the plot watered, adds a dark wet `spill` decal, a painted water stream and splashes. In shallows it refills. | `crops.work('water', …)` |
| seed bag | sows tilled cells (a local `plots` map, drawn as seed rows); scatters seeds as golden `chaff`. | `crops.work('seed:wheat', …)` |
| pitchfork | loosens ploughed ground to soil; tosses straw (`chaff`) on grass. | `crops.work('rake', …)` |
| hands | feed the nearest pen (`animals.feed(penId, 5)`), open the market at a sell point, or open the jobs board at a job site. | |

Stamina runs 0..1. Costs are hoe 0.035, fork 0.03, water 0.012, seed 0.01 and hands 0.004. Running costs 0.035/s.
Stamina recovers at 0.05/s standing, 0.018/s walking and 0.02/s asleep. A stamina arc is drawn next to the
active ring once stamina is spent.

The prompt goes through `ui.setPrompt`: "E — Hoe the grass/verge/yard", "E — Water the soil", "E — Sow wheat",
"F — Enter tractor", "F — Get out", "On the job: …". When nothing can be done it shows a hint with no key,
for example "Tilled: ready for seed". The target cell is marked with painted corner brackets (world-ui).

## Jobs (presence)
Accepted `simulation` jobs of type `shopHelp`, `villageWork` or `animalCare` get a site, cached in
`world.characters.jobSites`. The site is chosen in this order:
1. the job's own x/y (or `to.x`/`to.y`)
2. a sell point named like a shop
3. a village road junction
4. the first animal pen trough
5. a deterministic spot near the farm (`terrain.findDry`)

Every 0.5 s, farmhands within 7 m of a site call `simulation.tickPresence(jobId, gameSeconds)`. The call is
×1.6 when there are several hands. Simulation pays out on completion. A `ui.worldLabel` shows
"Help at the shop — 35% · working" and is removed when the job ends.

## AI (`ai.js`)
Characters you are not controlling run their `task`:
- `{kind:'goto', x, y, run?, then?}`
- `{kind:'idle', x?, y?, r?}`: wander around home with pauses and glances.
- `{kind:'follow', targetId?, dist?}`: default target is the active character.
- `{kind:'work', x, y, r?, tool?, rot?, jobId?}`: walk to the site and strike a grid of cells there, with stamina rests.
- `{kind:'patrol', points:[[x,y]…], run?}`
- `{kind:'sleep'}`
- `{kind:'hold', rot, phase?, walk?, running?, action?:{tool,u}}`: a frozen pose (showcase, cut-scenes).

Stuck detection adds a sidestep. At night (21:45–06:00), idle and working hands go home and sleep until
morning. With `buildings`, they go to the farmhouse door (`nearest`/`doorOf`) and disappear inside.
Otherwise they sleep on a painted bedroll next to a small lantern light. Followers keep following, and
`pinned:true` tasks ignore the night.

Villagers follow the road graph along village and lane pavements, offset `width/2 + 0.95 m`. They pause
now and then and go home (and disappear) from 20:30 to 06:30. Without `roads` they wander inside their area.
They carry umbrellas in rain.

## Rendering
- A top-down painted rig in `body.js`, facing −y (rot 0 = north, clockwise):
  - boots, then hips or skirt, then the swinging arms (sleeve + hand), then the torso, then the head
  - carried items and the tool
  - an AO contact shadow sprite underneath
- Characters are drawn 1.28× life size (`K`) for readability. Collisions use true size.
- Walk cycle: stride, counter-rotating shoulders, arm swing opposite to the legs, body bob. Running has its own amplitudes.
- Tool animations are timed curves:
  - hoe: raise over the head, strike, drag
  - pitchfork: thrust and toss
  - watering can: reach and pour, with a water stream
  - seed bag: dip and broadcast
  - hands: reach and grab
- Idle characters look around.
- Two draw paths:
  - **live rig** from the 96 px/m part sprites when `zoom·dpr·K ≥ 88`, while a tool action plays, and for sleepers
  - **cached frames** at 72 px/m otherwise: 8 walk + 8 run + 1 idle per appearance/carry/lantern, one `drawImage` plus the shoulder tool
- Shadows: `F.shadow.circle(x, y, 0.3·K, 0, 1.75)`. An umbrella adds one at 1.85–1.95 m, and a sleeper adds a low box.
- At night (`daylight < 0.32`) farmhands carry a lantern, which submits `F.light` (7.5 m, warm, flickering, with glow).
- world-ui: the active ring, the stamina arc and the target cell.
- ground-detail: the sown plots, drawn only when `crops` is absent.

## API (`ctx.modules.get('characters')`)
| call | notes |
|---|---|
| `spawn({ name?, role:'player'\|'hired'\|'villager', x, y, rot?, appearance?, tool?, task?, home?, sex?, age? })` → id | Emits `characters:spawned`. The first `player` becomes active. |
| `despawn(id)` → bool | |
| `list(filter?)` | Filter by role string or predicate. Returns public copies. |
| `get(id)`, `active()` | |
| `setActive(id)`, `cycle()` | Emits `characters:switched {id, prev}`. |
| `assignTask(id, task)` → bool | See the task kinds above. |
| `positionOf(id)` → `{x, y, rot, vehicleId}` | Returns the vehicle position while driving. |
| `villagers(count, area?)` → ids | `area` is `{x0,y0,x1,y1}` or `{x,y,r}`. |
| `setAutoSpawn(bool)` | The full game auto-spawns the player and one hired hand at a dry, flat spot near the map centre. Demo calls `setAutoSpawn(false)` to take over. |
| `hire(opts?)` → id | Calls `simulation.hireWorker` (wages), then spawns the hand. Workers hired elsewhere are synced every 2 s, and fired workers leave. |
| `setTool(id, toolId)`, `useTool(id)`, `tools()` | |

Events emitted:
- `characters:spawned`
- `characters:despawned`
- `characters:switched`
- `characters:interact {id, tool, x, y, surface}`

Events listened to: `jobs:completed`, `jobs:failed`, `vehicles:exited`.

Hooks for modules that do not exist yet (every call is guarded, and undefined results are tolerated):
- `vehicles`: `nearest(x, y, 3)` (an id or an object), `get(id)`, `enter(vid, cid)`, `exit(vid)` (returns `{x,y}`), and `control(vid, {throttle, brake, steer, lights:'toggle', implementDown:'toggle'})`.
- `crops`: `fieldAt(x, y)` and `work(tool, x, y, width, rot)`.
- `animals`: `world.animals.pens[].trough` and `feed(penId, kg)`.
- `buildings`: `nearest('farmhouse', x, y)` and `doorOf(id)`.

## Round 2 (r4.5)
- **Pause:** while `world.time.paused` is set, `update()` skips movement, AI, tools, stamina and jobs. The prompt and portrait bar still refresh, and `frame()` cosmetics still run. The showcase `frozen` flag keeps animating.
- **Delegated jobs:** every 1 s the module looks for accepted jobs whose `assignee` is a hand's `workerId` (or the character id).
  - The hand gets a `work` task at the job site. It runs there when the site is far, plays the tool animation without changing the world, and shows "On a job" in the portrait bar.
  - When the job ends it goes back to its previous task, or runs home.
  - Presence is not ticked for jobs assigned to a simulation worker, because simulation works those itself.
  - At night the job waits and the hand sleeps.
- **Wages (r4.5):** each hired character carries the `workerId` returned by `hireWorker`/`workers()`. Game-hours spent active are logged to it with `simulation.logWork(workerId, hours, kind)` in 0.25 h batches. Kind is `possessed` when the player controls the hand, or `task` for goto/work/driving. Delegated-job hours are not logged here, because simulation logs them.
- `isAvailable(workerId)` (r4.7): true when the hand exists, is awake and it is not night (21:45–06:00). This includes hands pinned to night work.
- Delegated hands run to far job sites. Beyond 120 m, with both ends off-screen, they get there at once. After `jobs:completed` or `jobs:failed` they go back to their previous task, or run home.
- **Vehicles:**
  - F and the prompt use `vehicles.nearest(x, y, 3, {free:true})`.
  - A null (or `blocked`) result from `exit()` means the exit was refused, because the vehicle is moving above 1 m/s or there is no free spot. The character stays seated; vehicles shows the toast.
  - A successful exit is confirmed with `driverOf(vid)`. `vehicles:exited` also clears the seat, and there is no fallback teleport.
  - `positionOf(id)` returns the true position: the vehicle's while seated.
  - While driving, the camera zooms out with speed (down to 20 px/m) and looks up to 14 m ahead. The zoom is restored on exit.
  - The look-ahead is private to the camera and capped so the vehicle stays in the central band. A northward lead may shift it at most 10 % of the screen down, clear of the bottom HUD.
  - The hand-tool toolbar is hidden while driving.
  - Prompts use the vehicle's display name.
  - A hand left alone in a vehicle gets out after 30 game minutes, or at night.
- **Tools:** a tool key pressed during an animation is buffered and applied when the animation ends.
- **Walking home:** a hand walking home runs when more than 12 m away. Beyond 120 m, with both it and its home off-screen, it goes home at once.
- **Job prompt:** at a job site, the job line takes priority over the tool prompt.
- `assignTask` rejects unknown task kinds.

## World data
- `world.characters`:
  - `list: [{ id, name, role, x, y, rot, state, vehicleId, task, appearance, tool, stamina, home, workerId, villager, pace, umbrella, …runtime }]`
  - `nextId`
  - `plots: {"x,y": {sown, watered, crop, rot}}`
  - `jobSites: {jobId: {x, y}}`
- `world.player = { activeCharacterId }`
- `state` is one of `idle`, `walking`, `running`, `working`, `resting`, `sleeping`, `inside`, `driving`.
- `save()` returns the whitelisted fields plus plots, job sites and the active id. `load()` rebuilds runtime state, the spatial entries and the camera follow.

## Showcase presets
Deps: terrain, environment, roads, effects, audio, ui, simulation. The stage paints a small yard, a vegetable
bed and a ploughed strip on a flat, dry site, adds crates and bales (solid colliders), and in `crowd` a village
street network.
- `default` (56 px/m, 10:00): the player pouring water, a hand hoeing new ground live, a hand walking the yard with a pitchfork, a hand sowing.
- `walk` (80 px/m): a walk-cycle turnaround with 4 directions, 2 runners and a live walker.
- `tools` (64 px/m): every tool mid-animation.
- `night` (22:40): lanterns, a sleeper on a bedroll, a hand still hoeing, a walker.
- `crowd` (24 px/m): 18 villagers on the pavements, the player and a following hand on the lane.

## Verification
Mechanics were checked in the full game with a scripted Puppeteer run: 22 checks.
- movement speed and run stamina
- prompt, Tab switch and camera hand-over
- hoe → `soil`, water/seed plots, and F without vehicles
- deep-water block
- AI goto and follow
- night sleep and waking
- a presence job progressing through `tickPresence`
- save/load round trip

`node tools/shot.js --out … --keys "KeyD:1500,Tab,KeyE" --extra "only=…,characters"` shows moving, switching and a tilled cell.

## Known limitations
- Tilled soil on painted `farmyard` can show terrain's edge-band artefact next to the cell. That is a terrain issue, which happens when painted areas overlap.
- The AI steers directly with a sidestep. There is no pathfinding around large obstacles, and villagers cut across junction corners.
- Without `crops`, sowing and watering are cosmetic (the `plots` map). Nothing grows.
- The active character cannot be sent to bed; only characters you are not controlling sleep.
- The people are small at 24 px/m, even at 1.28× scale. The rig is readable from about 40 px/m up.
