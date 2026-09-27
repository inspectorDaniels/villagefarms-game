# crops — fields and everything that grows in them (wave 2)

Fields are polygons with a cell grid aligned to the row direction. Every cell runs the soil/crop state
machine. Crops grow once per game day, driven by the month, soil moisture from rain, fertiliser
and weeds. `work()` is the only entry point for machines and hand tools. Harvests return kg of the
**simulation item ids**, so the result can go straight into `simulation.addInventory/sell`. Divide
by 1000 first, because simulation counts grain, roots, hay and straw in tonnes.

Deps: `simulation` (hard). It supplies yields and straw from `yieldTable()`, parcels and soil quality,
and job progress. Optional deps: `terrain` (soil moisture at creation, soil paint under the field)
and `environment` (rain, wind, snow, sun for shadows).

Files:
- `data.js`: states, crop table, growth units and calendar helpers. Pure.
- `model.js`: fields, grid, state machine, `work`, day ticks, events, jobs, save/load. Pure, no DOM.
- `tiles.js`: painted 2 m cell tiles.
- `render.js`: chunk cache, shadows, sway, snow, bales.
- `showcase.js`, `index.js`.
- `tests/season.mjs`: a headless season test. Run it with `node src/modules/crops/tests/season.mjs`.
- `tests/game.cjs`: an in-browser integration test against the real simulation. Run it with `node src/modules/crops/tests/game.cjs`.

## Cell state machine
```
grass ─┬─ plough ─► ploughed ─ cultivate ─► cultivated ─ seed:<crop> ─► sown (stages 0..4 by growth)
stubble┘    ▲  (plough works on any state)   ▲ (grass/stubble/withered/mown too)         │ daily growth
            │                                                                             ▼
withered ◄── ripe for > witherDays ◄──────────────────────────────────────────────── ripe
   │ harvest → stubble (0 kg)                     harvest → stubble + straw swath (cereals/rape/maize)
                                                           → cultivated (potatoes, sugar beet)
grass crop: ripe/sown(≥0.35) ─ mow ─► mown (hay lying) ─ rake ─► windrow ─ bale ─► sown (regrowth 0.22)
stubble with straw ─ bale ─► stubble        mown/windrow left > 8 days → rots back to sward
frost-tender crops (maize, potatoes) wither in months with 0 growth units (Dec–Feb)
```
Tools: `plough`, `cultivate` (aliases `till`, `harrow`, `hoe`), `seed:<crop>`, `fertilise`
(alias `fertilize`), `spray` (herbicide, sets weeds to 0), `harvest` (does a mow on grass),
`mow`, `rake`, `bale`, `water` (+0.3 moisture).

Moving from one state to another is idempotent: ploughing a ploughed cell changes nothing and returns `cellsChanged: 0`.

## Crops (8)
wheat, barley, oats, rapeseed (yellow bloom stage, then a green-pod stage), maize (2.6 m, casts
shadows), potatoes (ridged rows, flowering), sugarBeet, grass (hay, about 3 cuts a year).

Yield, straw, product and months come from simulation's `CROPS`. The sowing and harvest months are
simulation's too. **Growth units per day** follow the month: cool crops 0.15 in winter up to 1.1 in
summer, warm crops 0 in Dec–Feb up to 1.3. Each crop needs `need` units. `need` is derived from the
calendar so that a crop sown mid sowing-month under good conditions ripens mid harvest-month.
For example, winter wheat sown on 30 Oct ripens around doy 23 (August).

Per game day and per cell:
- `moist = moist·(1−evap) + rainMm/30 + base·0.06`, where evap is 0.24 in winter and 0.47 in summer.
- `dg = units/need · (0.35+0.65·moistF) · (0.85+0.15·fertF)`
- Fertiliser is used up at `0.55·dg`.
- Weeds grow at `0.02·units`. The canopy shades them out.
- Health follows `moistF·fertF·(1−0.4·weeds)`.

At harvest, per cell:
**`kg = yieldT·1000·cellArea/1e4 · (0.9+0.25·soilQ) · health · patchiness(0.88..1.12, edges −7 %)`**.
Straw is `strawT·(0.8+0.2·health)` and lies in the stubble until it is baled or ploughed in. Bales are
250 kg (hay) and 210 kg (straw).

Rain is taken from the larger of two sources:
- environment's plan for the day (`forecast()[..].rainMm`, recorded the day before),
- 0.3 × the measured `weather.rainRate` integral, so a forced `setWeather('rain')` also waters the crops.

If neither is available, a deterministic monthly climate is used.

## API (`ctx.modules.get('crops')`)
Units: metres, radians (0 = north, clockwise), kg, m².
- `createField(poly, { parcelId?, crop?, stage?, state?, angle?, cell?=2, soil?, name?, paintTerrain?=true })` → id.
  - Rows run along the longest edge unless `angle` is given.
  - `state` is `grass` (the default), `stubble`, `ploughed` or `cultivated`.
  - `crop` + `stage` (`'auto'`, the default) plants the crop at the growth it would have today on its calendar. Out of season, you get stubble, cultivated ground or grass.
  - `parcelId` defaults to `simulation.parcelAt(centroid)`. Soil quality comes from the parcel, or 0.6.
- `removeField(id)`, `fields()` → summaries, `field(id)`, `fieldAt(x, y)` → summary or null.
- `cellAt(x, y)` → `{ fieldId, state, crop, stage, growth, moisture, fertility, weeds, health, lyingKg }`.
- `work(tool, x, y, width, rot, len?=1.2)` → `{ cellsChanged, yieldKg, item, fieldId, strawKg?, mownKg?, bales?:[{id,x,y,rot,item,kg}] }`.
  - It sweeps a width × len rectangle and always includes the cell under (x, y), so a 1 m hand tool still works on 2 m cells.
  - Call it every step while the implement is lowered.
  - `yieldKg`/`item` are set for `harvest` (grain or roots, in simulation item ids) and for `bale` (hay or straw that went into bales).
- `stats(id)` → `{ area, ha, crop, cropName, state, stage, stageIndex, growth, readiness, expectedYieldKg, expectedItem, expectedYieldPerHa, weeds, moisture, fertility, soilQuality, counts{state:n}, sownDay, lastWorked, daysToRipe, lyingKg, cells, cellSize }`.
- `forceStage(id, stage, crop?)` accepts:
  - a stage index 0–5,
  - a crop stage name,
  - `ripe`, `withered`, `pods`,
  - `grass`, `stubble`, `harvested` (stubble + straw), `ploughed`, `cultivated`, `mown`, `windrow`.

  `plantAll(id, crop, stage='sown'|'auto'|0..5|name)`.
- `crops()` → the crop table. `calendar(doy?)` → `{crop: {canSow, growthIfOnSchedule, units}}`.
- `bales()` → the list of bales. `collectBale(id)` → `{item, kg}` and removes the bale (for loaders and trailers).
- `simulateDays(n, {rainMm?: number|fn(day)})`: a time-lapse for demos and tests. It advances crop growth only, and the offset is kept in `world.crops.dayOffset`.

### Simulation jobs
When `work()` changes cells of a field whose `parcelId` has an **accepted** job, crops reports
progress through `simulation.reportProgress`:
- `plough`/`cultivate` count toward `plough` jobs,
- `seed:<crop>` counts toward `sow` jobs (the crop must match),
- `harvest` counts toward `harvest` jobs,
- `mow` counts toward `mow` jobs.

Progress is the fraction of that parcel's field cells in the target state. At 97 % the job is topped
up to 1, so simulation auto-completes it. The demo/buildtools must create fields on the job parcels
(`createField(parcel.poly, {parcelId})`).

### CAP and contractors (simulation r4)
- Crops does **not** call `recordFieldWork`. Simulation listens to `crops:worked` for CAP. Every `crops:worked` carries `{ fieldId, parcelId, tool, cells, areaM2 }`.
  - `areaM2` is the area actually changed.
  - Events are coalesced per field and tool, at most one per 60 game-seconds, and `areaM2`/`cells` are summed across the merged calls.
  - Contractor work emits the event with `contractor: true`, so simulation can skip it and avoid counting the booked area twice.
- `economy:contractor-done` is handled for both payload shapes, `{ parcelId|fieldId, operation, areaM2?, crop? }` and r3 `{ booking:{ parcelId, op } }`.
  - The operation is applied along serpentine lanes to at most `areaM2`. A booking within 3 % of the fields' area covers them all, because simulation rounds ha to 0.01.
  - Mapping: `plough`, `cultivate`, `sow` (`crop`, else the field's `plannedCrop`, else the first in-season crop), `spray`, `fertilise`, `mow`, `rake`, `harvest`/`lift`, `bale`.
  - Harvested grain/roots and baled hay/straw go into farm inventory via `simulation.addInventory(item, t)`.
  - The API `applyContract(payload)` → `{cells, areaM2, delivered}` does the same on demand.
- Harvests done with `work()` by vehicles or characters are **returned**, not stored. The caller decides between trailer and store and calls `addInventory(item, kg/1000)`.

## Events
- `crops:worked {fieldId, parcelId, tool, cells, areaM2, x, y, contractor?}`: coalesced, at most one per field and tool per 60 game-s, with `areaM2` summed.
- `crops:sown {fieldId, crop, phase:'start'|'complete'}`
- `crops:ripe {fieldId, crop, day, expectedYieldKg}`: when ≥ 50 % of the crop is ripe.
- `crops:harvested {fieldId, crop, item, kg, cells, complete}`: coalesced like `crops:worked`. Bales emit `{item, kg, bales:[ids]}`.
- `crops:withered {fieldId, crop, day}`
- `crops:field-changed {id, change}`

## World data (`world.crops`)
- `fields: [{ id, poly, parcelId, angle, grid, cells:{size,nu,nv,state,crop,growth,health,fert,weeds,moist,mass,age (typed arrays)}, crop, stage, state, growth, readiness, soil:{moisture,fertility,weeds}, sownDay, lastWorked, counts, area }]`
- `bales`, `day` (last processed day), `dayOffset`, `rain`

Save and load use base64 typed arrays. A 1.2 ha field is about 40 KB of JSON.

## Rendering
Each field is split into world-aligned 32 m chunk canvases at LOD 4/8/16/32 px/m, cached in an LRU capped at 160 MB.
- A state change marks only the affected cells dirty. Those cells are repainted, clipped to their squares, under a per-frame cell budget.
- A chunk is fully rebuilt only when more than 40 % of it is dirty, for example on a day tick that changes stages.
- Each cell is one rotated, toroidal 2 m painted tile per state × crop × stage, with extra keys for weeds, swath, tramline, season and 3 variants.
- Field edges are feathered and ragged onto the terrain verge. The soil paint stops 1.3 m inside the field polygon.

The layers draw:
- `ground` (order 5), with a snow veil from `weather.snowLevel`,
- `ground-detail`: wind sheen gusts over cereals, rape and grass at zoom ≥ 10, from `environment.windAt`.

The collector submits:
- shadow walls on the sun-facing boundaries of tall crops (merged runs of equal height, staircase steps skipped),
- round bales as y-sorted objects with box shadows.

## Performance
The visible chunks are composited into one screen-sized layer. That layer is re-composited only when
the view or a chunk changes, so a static camera costs one blit per frame. Headless, each 256 px chunk
blit costs about 0.5 ms, which is why this matters.
- Measured in the showcase shot JSONs: crops takes 0.23–0.59 ms per frame.
- While panning, the composite is redone every frame. This is slower headless: about 10–40 ms for 60–70 chunks.
- Day processing is incremental (4000 cells per update step). A 60 ha farm takes about 25 ms per day in total, spread over about 40 steps.
- `work()` takes about 8–10 µs per call when ploughing a 3 m swath, and about 27 µs when harvesting.

`?cropsdebug=1` exposes `globalThis.__CROPS__` (model, renderer) for profiling.

Panning, measured with `tests/pan.cjs` in the full game (18 fields, 240 frames at 8 px/frame):
- The composite is double-buffered and shifted by the whole-pixel pan offset. Only the exposed strips and changed chunks are redrawn.
- Chunk painting drops to 450 cells per frame while the camera moves.
- Crops costs about 2–3 ms per frame while panning, and 0.15–0.3 ms static.
- A layer larger than the screen (to absorb pans without shifting) blits on a slow path, about 8 ms, so there is no margin.

## Showcase presets
Ten fields on a dry spot of the default seed:
- `default`: June patchwork at 6.6 px/m.
- `closeup`: 40 px/m.
- `bloom`: rapeseed in May.
- `harvest`: August. Wheat is half combined, with straw swaths and bales. Barley stubble is baled, rape stubble half cultivated, grass mown, raked and baled, and a barley field has withered.
- `winter`: January, snow.
- `maize`: late sun, long maize shadows.

Work in progress in the showcase is staged with real `work()` passes.

## Known limitations
- Tile art is acceptable but plain at overview zoom. Maize in the knee-high stage looks busy.
- There is no headland row direction and no lodging.
- Growth is monthly-table driven, not temperature driven. Frost kill is by month, not by the actual temperature.
- `simulateDays` shifts the crop calendar relative to the clock (a dev and demo tool).
- Shadows cover only field boundaries and cut edges. Tall crop does not shade the crop next to it.
- Bales are cosmetic until another module collects them with `collectBale`.
