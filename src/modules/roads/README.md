# roads (wave 1)

The road network: a graph (nodes/edges) with four classes, painted gouache rendering cached in LOD
chunks, filleted junction geometry, markings, bridges, street lights, and A* pathfinding.
Europe: drive on the **right**.

## Files
- `index.js` — manifest, init, API, render layers/collectors, showcase
- `network.js` — graph → chains (same-class runs through degree-2 nodes, smoothed once), junctions
  (arms, filleted corners, setbacks, polygons), trimmed ribbons, zebra/light placement, spatial grid
- `paint.js` — decals (patches, cracks, wear, ruts, potholes) + chunk painter (shoulders, pavements,
  kerbs, carriageways, markings, give-way teeth, zebra, bridge decks/wing walls, snow)
- `textures.js` — seamless painted tiles (asphalt ×3, gravel, dirt, concrete, grass per season)
- `chunks.js` — LOD chunk cache (levels 2…64 px/m, 1024 px canvases, LRU, budgeted builds, coarse fallback, pixel-snapped draws)
- `generate.js` — default network plan for a world (terrain optional)
- `backdrop.js` — showcase-only ground (grass, fields, river) so the showcase works without terrain

## Classes (`api.classes()`)
| class | width | lanes | speed m/s | look |
|---|---|---|---|---|
| `regional` | 7 | 2 | 22.2 | asphalt, white edge lines + dashed centre (solid over bridges), wheel-path wear, oil strip, patches, sealed cracks, crumbling edges |
| `village` | 6 | 2 | 13.9 | older asphalt, granite kerbs, 1.9 m slab footways, gullies, manholes, street lights, zebra near the centre |
| `lane` | 3.5 | 1 | 11 | gravel, compacted wheel tracks, old asphalt remnants, potholes/puddles, sparse centre grass |
| `track` | 3 | 1 | 6 | two dirt ruts, grass centre strip, trampled verge, muddy puddles |

## World data (`world.roads`)
`{ nodes:[{id,x,y}], edges:[{id,a,b,class,width,lanes,speed,bridge,via:[[x,y]],points:[[x,y]] (smoothed centreline a→b),length}], lights:[{x,y,hx,hy,height}], version }`
Ids are `roads:<n>`. `points`/`lights` are derived (rebuilt on change).

## API (metres, radians)
- `addNode(x, y)` → id
- `addEdge(a, b, { class, via:[[x,y]..], bridge? })` → id (throws on unknown node)
- `removeEdge(id)` → bool
- `generateNetwork(plan?)` → `{nodes, edges, version}`. No plan: default network for `world.bounds`,
  using `terrain.isWater/slopeAt` if present, then splits edges crossing water into bridges.
  `plan = { nodes:[[x,y]..], edges:[[i, j, class, via?, {bridge?}]..] }` builds exactly that.
- `nearest(x, y)` → `{ edgeId, x, y, t (0..1 along a→b), dist }` or null
- `roadAt(x, y)` → class of the carriageway (incl. junction areas) or null
- `pathfind(from, to, { classes?, lane? })` → `[{x,y}..]` (A* on travel time, follows the smoothed
  polylines; `from/to` as `{x,y}` or `[x,y]`; `lane:true` offsets 1.6 m to the right) or null
- `laneCurve(edgeId, forward)` → `[[x,y]..]` right-hand lane centreline (offset width/4; 1-lane classes: centre)
- `edges()`, `nodes()`, `edgesInRect(x0,y0,x1,y1)`, `junctions()` (node ids, degree ≥ 3)
- `drawMinimap(g, scale)` — strokes the network into a minimap context (px per metre = scale)
- `classes()` — the class table; `lights()` — street light list

Events: `roads:changed` `{version, nodes, edges}` (emitted once per rebuild; mutations are batched
and rebuilt lazily on the next query/update).

## Rendering
- `ground-overlay`: chunk cache (static). `ground-detail`: wet sheen + puddle reflections when
  `environment.weather.wetness` > 0.04. Objects: lamp posts/arms/heads, bridge railings.
  Shadows: `F.shadow.pole/poly/box` for lamps; one `F.shadow.custom` per bridge (deck slab, railings,
  wing walls; the deck footprint is erased so the deck isn't shadowed by itself).
- Lights: `F.light` warm sodium (radius 15 m, glow) when `environment.daylight` < ~0.4 (staggered switch-on),
  lens glow in `glow` layer, wet-road reflections of lamps.
- Seasons: tufts/verges follow `clock.season`; snow banks when `weather.snowCover` > 0 or in winter (min 0.4).
- Objects are skipped below 5–6 px/m (sub-pixel).

## Showcase presets
`default` (overview 3.8 px/m), `junction` (village crossroads + zebra 28 px/m), `tjunction`
(regional/village T with give-way 26 px/m), `bridge` (24 px/m), `night` (22:30, 13 px/m), `farm`
(gravel lane / dirt track 24 px/m), `winter` (day 34, 9 px/m). deps: `environment`. The showcase paints
its own ground (`backdrop.js`); if `environment` is absent it installs a local fallback night pass.

## Known limitations
- Junction markings are simple: through centre line only for regional; no turn arrows/stop lines.
- Degree-2 class transitions (village→lane) end kerbs/footways abruptly.
- Bridges are a flat deck; approach roads don't ramp, deck shadow can fall on the banks.
- Chunk builds on first view cost ~10–40 ms each (budgeted to 1/frame, coarse fallback meanwhile).
- Default generator is heuristic (village site = driest candidate); roads may still cross steep ground.
