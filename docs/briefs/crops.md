# Brief: crops (wave 2)

Fields and everything that grows in them. Deps: `simulation` (yields, prices, parcels, jobs).
Optional: terrain, environment, effects, audio.

## Data (`world.crops`)
`fields: [{ id, poly, parcelId, cells (grid of 1×1 m or 2×2 m cells), crop, stage, growth 0..1, soil:{moisture, fertility, weeds}, sownDay, lastWorked }]`
Cell states: `grass`/`stubble` → `cultivated` → `ploughed` → `sown` → growth stages (≥ 4 visual
stages) → `ripe` → `harvested` (stubble) → `withered` (if left too long). Plus `mown`, `windrow`, `bales`.

## Crops (≥ 6, each visually distinct at every stage, seasonal calendar)
wheat, barley, rapeseed (yellow bloom stage!), maize (tall — casts shadows), potatoes (ridged rows),
sugarBeet, grass/hay. Growth driven by game days, soil moisture (rain from environment), fertiliser, weeds.

## Required API
- `createField(poly, { parcelId?, crop?, state? })` → id · `removeField(id)` · `fields()` · `fieldAt(x, y)`
- `work(tool, x, y, width, rot)` — called by vehicles/characters with implements: `plough`, `cultivate`,
  `seed:<crop>`, `fertilise`, `spray`, `harvest`, `mow`, `rake`, `bale`, `water` — operates on the swept
  cells, returns `{ cellsChanged, yieldKg?, item? }`; reports progress to simulation jobs if a job targets that field.
- `stats(fieldId)` → `{ area, crop, stage, readiness, expectedYieldKg, weeds, moisture }`
- `forceStage(fieldId, stage)` (showcase/demo), `plantAll(fieldId, crop, stage)`.
Events: `crops:worked`, `crops:sown`, `crops:ripe`, `crops:harvested`, `crops:withered`.

## Rendering
Soil in rows following field direction (furrows with light/dark ridges, wet darkening), crop rows as
painted sprites per stage (not flat fills), wind sway at close zoom (via environment.windAt), tall crops
cast shadows (`F.shadow.poly` with crop height), stubble lines after harvest, tram-lines, headlands,
field edges with a grass margin. Cached per field chunk; redraw only dirty cells.

## Showcase presets
`default` (patchwork of fields at different stages ~8 px/m), `closeup` (~40 px/m rows),
`bloom` (rapeseed yellow in May), `harvest` (half-harvested wheat, stubble), `winter`.
