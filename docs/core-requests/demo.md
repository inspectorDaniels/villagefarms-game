# Requests from `demo` (wave 3)

## 1. Integrator: register `demo` in `src/modules/registry.js`
`demo` is not in the registry yet, so the full game (no `?showcase`) still shows "Demo module not built yet".
Please add `{ id: 'demo' }` (last, after characters). Until then the game runs with
`?only=terrain,environment,roads,simulation,ui,audio,effects,crops,buildings,vehicles,characters,demo`.
When props / animals / traffic / buildtools land, add them too; demo already calls them null-safely
(`composeProps`, `composeAnimals`, `traffic.setDensity`) and lists them in `optionalDeps`.

## 2. Core: a whole-game save/load entry point
Every module has `save()/load()` on its instance, but nothing in core calls them, and modules cannot reach other
modules' instances. The playthrough test does it by hand through `__GAME__.engine.instances` (round trip verified:
money, objectives, field cells, workers, vehicle positions all restored). Proposal (boot.js):
```js
G.saveGame = () => Object.fromEntries(instances.filter(i => i.inst.save).map(i => [i.id, health.guard(i.id, 'save', () => i.inst.save())]));
G.loadGame = (o) => { for (const { id, inst } of instances) if (inst.load && o[id] !== undefined) health.guard(id, 'load', () => inst.load(o[id])); };
```
plus `ctx.game = { save, load }` so `ui` can offer Save/Load buttons (localStorage). Note: the full save is ~4.8 MB
JSON, most of it from other modules' typed arrays — worth compressing before localStorage (5 MB quota).

## 3. simulation: charge seed & inputs when the player sows
Nothing charges seed when the player drills a field with the seeder. `demo/office.js` currently listens to
`crops:worked` with tool `seed:<crop>` on owned/rented parcels and calls `simulation.buyInputs(crop, ha)`
(falls back to `charge(..., {force:true})`). This belongs in simulation (it already listens to `crops:worked` for CAP);
demo will remove its handler once simulation does it.

## 4. Perf note (renderer / headless): village view ≈ 35–55 ms/frame
Steady state in the full game: farm 6.6 ms, field 7.1, play 6.2, night 6.7–27, **village 39–56, overview 24–50**.
A CPU profile of the village view shows 64 % of samples inside the first `setTransform` of `renderer.render`
(`_worldTransform`, renderer.js:134) — i.e. the canvas waiting on the previous frame's raster work — and < 1 ms in any
module's JS. So it is fill-rate in software raster (headless swiftshader): many large building/roof sprites + the
half-res shadow canvas composite. Suggest the renderer measure this on a real GPU and, if needed, cache the static
shadow layer per camera position/sun step. Demo can reduce village density (22 houses) if the director prefers.

## 5. characters: follow zoom
`scene('play')` sets zoom 24 after `camera.follow(...)`, but the view ends at ~40 px/m (characters' follow
zoom). A `characters.setFollowZoom(z)` or respecting the current zoom would let the game start at a wider view.


**Integrator (iteration 2): #1 registry APPLIED. #2 APPLIED as `ctx.game` / `__GAME__.game` (save, load, saveToStorage, loadFromStorage, slots; gzip). #3 forwarded to simulation, #5 to characters, #4 noted (needs real-GPU measurement).**

**#3 DONE in simulation (inputs charged on crops:worked seed:<crop>); integrator removed demo's workaround handler to avoid a double charge.**
