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
- `chunks.js` — LOD chunk cache: 256 px chunks, levels 1.5…64 px/m (picked for ~1.1–1.5× upscale), per-chunk content bbox
  (empty chunks cost nothing), time-sliced generator builds (step budget adapted from `view.dt`), prefetch ahead of
  camera motion, finished chunks frozen into cropped `ImageBitmap` quadrants, blits clipped to the viewport, coarse fallback
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
All functions validate input and never throw: bad input logs one `ctx.warn` per kind and returns `null` / `false` / `[]`.
Non-finite coordinates are rejected up front; every spatial search is bounded by the network's grid extents.
- `addNode(x, y)` → id, or `null` for non-finite coordinates
- `addEdge(a, b, { class, via:[[x,y]..], bridge? })` → id, or `null` (unknown node, self-loop). Unknown class → `'lane'` (warned); invalid via points dropped
- `removeEdge(id)` → bool
- `generateNetwork(plan?)` → `{nodes, edges, version}` or `null`. No plan (or an object without `nodes`): default network for
  `world.bounds`, using `terrain.isWater/slopeAt` if present, then splits edges crossing water into bridges.
  `plan = { nodes:[[x,y]..], edges:[[i, j, class, via?, {bridge?}]..] }` builds exactly that. The plan is validated
  **before** anything is cleared; an invalid plan (or a failure while building) keeps the previous network and returns `null`.
- `nearest(x, y)` → `{ edgeId, x, y, t (0..1 along a→b), dist }` or null (empty network / nothing within 4 km)
- `roadAt(x, y)` → class of the carriageway (incl. junction areas) or null
- `surfaceAt(x, y)` → `{ class, part:'carriageway'|'kerb'|'pavement'|'verge', bridge, edgeId|null, node|null }` or null.
  Village footways (incl. filleted corner footways) report `part:'pavement'`; rural shoulders (≤0.6 m) `verge`.
- `pathfind(from, to, { classes?, lane? })` → `[{x, y, edgeId, node?}..]` or null. A* on travel time along the smoothed
  polylines; `from/to` as `{x,y}` or `[x,y]`; `classes` = a class name or an array of names. Every point carries the
  `edgeId` it lies on; points on a graph node carry `node` (use with `junctionInfo`). `lane:true` offsets each edge's
  part separately by that edge's right-hand lane offset (the same as `laneCurve`: width/4 for 2-lane classes, centre
  line for 1-lane lanes/tracks), so lane paths stay on the carriageway.
- `laneCurve(edgeId, forward)` → `[[x,y]..]` right-hand lane centreline (offset width/4; 1-lane classes: centre)
- `junctionInfo(nodeId)` → data for traffic yielding, or null for an unknown node:
  ```
  { node, x, y, degree, rule:'major-road'|'right-before-left'|'none', through:[edgeId,edgeId]|null, poly:[[x,y]]|null,
    arms:[{ edgeId, end:'a'|'b',            // which end of that edge touches the node
            class, lanes, width, dir:[dx,dy] (unit, pointing AWAY from the junction), angle,
            priority:'major'|'minor',       // right-before-left junctions: every arm 'minor'
            control:'giveway'|'none',       // give-way teeth painted on this arm
            setback,                        // m from node to the arm's mouth (where the junction area starts)
            stopLine:{ x, y, a:[x,y], b:[x,y], s, edgeS },  // across the inbound lane(s); s = m from node, edgeS = m along edge.points a→b
            entry:{ x, y, edgeS },          // inbound right-hand lane point at the stop line (where an arriving car waits)
            exit:{ x, y, edgeS } }] }       // outbound right-hand lane point at the mouth
  ```
  Arms are sorted by screen angle (clockwise, y down). Entry/exit points lie on `laneCurve` of the arm edge (≤0.4 m, the
  polyline spacing). `rule:'major-road'` = the highest-rank road (≤2 arms) has priority and minor arms give way.
  Nodes that are not junctions (dead ends, degree-2) return their arms with `rule:'none'`.
- `edges()`, `nodes()` → **read-only snapshots**: deep-frozen copies (rebuilt once per network version; the array itself is a
  fresh copy, so sort/filter freely; to modify points use `points.slice()`). `edgesInRect(x0,y0,x1,y1)` (same snapshots), `junctions()` (node ids, degree ≥ 3)
- `drawMinimap(g, scale)` — strokes the network into a minimap context (px per metre = scale); `false` if `g` is not a 2D context
- `classes()` — the class table; `lights()` — street light list (copies)

Events: `roads:changed` `{version, nodes, edges}` (emitted once per rebuild; mutations are batched
and rebuilt lazily on the next query/update).

## Debug / A-B measurement
- `?roadsfx=0` disables all road rendering (chunk layer, wet layer, lamps/bridges collector, glow); the API keeps working.
- At runtime: `world.roads.debug` (non-enumerable) → `{ render, chunks, objects, lights, stats() }`; set `render=false`
  to remove all road drawing, `chunks=false` / `objects=false` for one part; `stats()` → chunk cache counters.

## Rendering
- `ground-overlay`: chunk cache (static). `ground-detail`: wet sheen + puddle reflections when
  `environment.weather.wetness` > 0.04. Objects: lamp posts/arms/heads, bridge railings.
  Shadows: `F.shadow.pole/poly/box` for lamps; one `F.shadow.custom` per bridge (deck slab, railings,
  wing walls; the deck footprint is erased so the deck isn't shadowed by itself).
- Lights: `F.light` warm sodium (radius 12 m, glow) when `environment.daylight` < ~0.4 (staggered switch-on),
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
- Chunk builds are time-sliced (≈0.2 ms per step, 6–40 steps/frame); on a cold view roads appear over ~0.5–2 s.
- Chunks are cached at ~0.66–0.9 of screen resolution (1.1–1.5× upscale, so slightly soft). This is deliberate: per-frame
  texture bytes shared with terrain are the measured bottleneck in Chrome (exceeding that budget made every frame re-upload).
- Night: lamp lights (radius 12 m) cost ~1–2.5 ms/frame in the core lighting pass at 24 px/m (the cost depends on light area).
- Default generator is heuristic (village site = driest candidate); roads may still cross steep ground.
