# Brief: roads (wave 1)

Believable rural road network: a regional asphalt road crossing the valley, a village with
kerbed streets and junctions, gravel farm lanes, dirt field tracks. Europe: drive on the RIGHT.

## Data (`world.roads`)
`{ nodes: [{id, x, y}], edges: [{id, a, b, points:[[x,y]...] (smoothed centreline), class, width, lanes, speed (m/s), bridge?:bool}], lights: [{x,y}], version }`
Classes: `regional` (7 m, 2 lanes, centre + edge lines), `village` (6 m, kerbs, pavements),
`lane` (3.5 m gravel/patched asphalt, 1 lane), `track` (3 m dirt with grass centre strip).

## Required API
- `addNode(x, y)` → id · `addEdge(a, b, { class, via:[[x,y]...] })` → id · `removeEdge(id)`
- `generateNetwork(plan?)` — with no plan builds a plausible default network for the current world
  bounds (uses `terrain` API if available to avoid water/steep slopes and to place bridges over
  `riverPaths()`); `plan = { nodes:[[x,y]..], edges:[[i,j,class, via?]..] }` builds exactly that.
- `nearest(x, y)` → `{ edgeId, x, y, t, dist }` · `roadAt(x, y)` → class or null (for surface checks)
- `pathfind(fromXY, toXY, { classes? })` → `[{x,y}...]` via A* over the graph (vehicles/traffic)
- `laneCurve(edgeId, forward:boolean)` → polyline offset to the right-hand lane
- `edges()` / `nodes()` · `edgesInRect(x0,y0,x1,y1)` · `junctions()` → node ids with degree ≥ 3
- `drawMinimap(g, scale)` draw the network into a minimap context.
Events: `roads:changed`.

## Rendering
- Cached chunk canvases (roads are static). Proper junction geometry (filleted corners, no
  overlapping-stroke artefacts, markings stop at junctions, stop lines/give-way triangles).
- Asphalt texture with patches, cracks, worn wheel paths, darker oil strip; edge crumble into grass;
  gravel lanes with loose stones and puddle-prone dips; dirt tracks with two wheel ruts + grass strip.
- Kerbs and pavements in the village; drainage grates; zebra crossing near the village centre.
- Bridges over water: deck + railings that cast shadows (`F.shadow.wall`), abutments.
- Street lights along village roads: posts cast pole shadows by day and submit `F.light` + glow at
  night (warm sodium/LED). Optional deps: terrain, environment (tolerate absence).
- Seasons/weather: wet asphalt sheen when `world.environment.weather.wetness` high, snow edges in winter.

## Showcase presets (≥ 3)
`default` (network overview ~4 px/m), `junction` (village junction ~28 px/m), `bridge` (~24 px/m),
`night` (village street at 22:30 with lights).
