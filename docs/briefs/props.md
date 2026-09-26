# Brief: props (wave 2)

Vegetation and small objects that make the valley lived-in. Optional deps: terrain, environment, effects.

## Types
Trees: oak, beech, willow (by water), poplar rows (Flemish landscape staple), birch, fruit trees
(apple orchard with blossom in spring, fruit in autumn), spruce/pine; hedgerows, bushes, reeds,
wildflower patches, tall grass; fences (wooden post-and-rail, barbed wire, electric tape, picket),
gates, stone walls, hay bales (round/square, wrapped), crates, barrels, pallets, mailbox, benches,
signposts, field shrine/wayside cross, well, woodpile, compost heap, scarecrow, beehives, power poles
with sagging wires (wires in `overhead`, cast thin shadows), puddles are effects'.

## Data & API
`world.props.items` — stored in spatial chunks (thousands of items; must stay fast).
- `place(type, x, y, { rot, scale, variant })` → id · `remove(id)` · `removeInArea(shape)`
- `scatter(type|[types], shape, { density, minDist, avoid:fn })` — natural placement (poisson disk)
- `fence(points, type, { gateAt? })` → id · `hedge(points)` · `row(type, points, spacing)` (poplar rows, orchards)
- `forest(poly, { mix, density })` · `at(x, y)` · `types()` · `canPlace(...)`
- Solid props (trees trunks, walls, fences) insert colliders into `ctx.spatial`.
Events: `props:changed`.

## Rendering
Trees: layered painted crowns (dabbed foliage clusters, volume shading, see-through gaps at the rim),
seasonal colours (autumn orange, winter bare branches with visible branch structure, spring blossom),
gentle wind sway at close zoom (`environment.windAt`), shadows via `F.shadow.circle(x,y,r,z0,z1,trunk)`.
Crowns partially drawn in `overhead` so characters can walk under. Sprite variants cached per
type×season×variant (≥ 4 variants each). Must render 5000+ trees at ≤ 2 ms via culling + caching.

## Showcase presets
`default` (orchard + hedgerows + poplar row ~10 px/m), `closeup` (~48 px/m), `autumn`, `winter`, `night`.
