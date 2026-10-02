# buildtools — construction / placement mode (wave 2)

Key **B** toggles build mode. It is refused while the active character drives, and build mode closes if the character gets into a vehicle.
The Build panel (ui panel `buildtools`, a launcher with the build icon) lists the tools. A status card (top centre) shows the tool, cost or area, and the validity reason.
The ghost follows the mouse, snapped to **0.5 m**. It is green when valid and red when not, and a label next to the cursor gives the cost and the reason.

Hard deps: `simulation`, `ui`. Optional deps (all null-safe): `buildings`, `crops`, `roads`, `terrain`, `props`, `animals`.

Files:
- `index.js`: logic, input, rendering, API.
- `geom.js`: polygon helpers.
- `showcase.js`: the showcase.

## Controls (build mode)
| input | action |
|---|---|
| left click | place / add corner / start or extend a track / demolish (confirm dialog) / buy or rent a parcel (confirm dialog) |
| right click, **Esc** | step back: clear the polygon or track chain → drop the tool (land → build) → exit. If a ui panel is open, ui's Esc closes it first. |
| **R** / Shift+R | rotate 90° / 15° |
| **Enter** | finish the field polygon (≥ 3 corners), or end a track chain |
| Backspace | remove the last corner |
| **Z** (or Ctrl+Z) | undo the last placement within 10 s, with a full refund |
| **B** | exit |

## Tools
- **Buildings** come from `buildings.types()` where `buildable` is set. Duplicate names get their size added (e.g. `Farmhouse 16×9`).
  - Validity is `buildings.canPlace(type, x, y, rot, {variant, pay:true})`. It covers the map, roads, fields, colliders, water, slope, land rights (`simulation.canUse`) and money.
  - Placing calls `buildings.place(..., {pay:true})`. This is `simulation.purchase` in ledger category `buildings`. The charged amount is measured from the money delta.
- **Field.** Click corners; click the first corner or press Enter to close. The area is shown in ha. The checks are:
  - corners within 1 m of an owned/rented parcel boundary snap onto it, 5 cm inside. On shared boundaries this prefers the first corner's parcel, then the one with more free area;
  - the preview turns red early with `already a field` (a corner or draft edge inside a field) or `no free area left in this parcel`;
  - every edge sample lies in the same owned/rented parcel (`leaves your land` / `crosses a parcel boundary` / `not your land`);
  - no self-intersection (`edges cross`);
  - at least 200 m²;
  - no overlap with a crops field (`overlaps Field n`), a building, water or a road.

  It then calls `crops.createField(poly, {parcelId, name})`. **Fields are free**, since the land is already paid or rented.
- **Farm track.** The first click starts; each further click lays one segment, which is `roads.addEdge(a, b, {class:'track'})` at **€14/m** (category `buildings`).
  - Ends within 3.5 m of a road node join that node.
  - An off-land sample is excused only on a **public** (non-`track`) road, or in the contiguous off-land run (at most 4.5 m) starting at an end that sits on a public road node or surface. The player's own track nodes never count as anchors.
  - Refused:
    - **already a track**: both end nodes are already joined, or ≥ 40 % of the inner samples lie within half a track width of one existing track. Crossing a track is fine;
    - water, buildings, crossing a field, neighbour land, more than 300 m, not enough money.
- **Fences/hedges, Trees, Animal pen** are disabled with a reason until `props.fence` / `props.place` / `animals.createPen` exist. Their call signatures are guesses (see Known limitations).
- **Demolish.** The hovered target is a player building, a field on your land, or a `track` edge on your land. Each goes through a confirm dialog:
  - building: `buildings.remove`. Its refund rules apply: a bought building returns its book value (80 % when new); a granted one returns €0;
  - field: `crops.removeField`;
  - track: `roads.removeEdge`, with no refund.
- **Land mode** (`enter('land')` or the panel button):
  - Every parcel is outlined and filled by state: owned green, rented blue, for sale gold, to let teal, neighbour grey.
  - Each parcel has a label with its name, state, ha and price (sale price, or rent per month).
  - Clicking a parcel opens a confirm dialog, then `simulation.buyParcel` (price + 4 % fees) or `rentParcel` (first month in advance).
  - When cash is short, a mortgage is offered. The figures come from `simulation.quoteParcel` once it exists (core request 3); until then a copy of `buyParcel`'s formula is used. The hover reason and the dialog show the same figures `buyParcel({mortgage})` produces: the loan, the cash spent (all of it) and the cash left.
  - Below max(€1,000, 3 months of overheads) left, they carry a low-cash warning.

**Undo.** The last placement can be undone within **10 s of real time**. The time is counted from `update(dt)` (fixed 60 Hz), not the wall clock, so it is deterministic.
- The undo removes the thing and refunds the full cost. A building's book-value refund is topped up with `credit(cost − refund, 'buildings', 'Undo — …')`.
- The top-up happens only while the building still carries the same simulation asset and that asset is still owned. Otherwise there is no top-up.
- Entries whose target was removed elsewhere are dropped, so older entries stay reachable.
- `load()` clears the undo history, the corners and the track chain.
- `rotate()` ignores non-finite steps.
- `select()` with an unknown tool or item returns false, keeps the current item and sets `status().lastError`.
- The driving check also asks `vehicles.driverOf` for every vehicle.
- `enter(anything other than 'land')` enters build mode.

## API (`ctx.modules.get('buildtools')`, metres/radians)
- `enter(mode='build'|'land')` → bool (false while driving). `exit()`. `isActive()`.
- `select(tool, itemId?)`. `tool` is one of `building | field | path | fence | tree | pen | demolish | land`. `itemId` for buildings is `'type:variant'` (e.g. `'machine_shed:0'`) or a type; for fences it is `fence | hedge`. Returns false if the tool is disabled.
- `preview(x, y)` → `{kind, x, y, ok, reason, cost?, area?, length?, polys?, verts?, closing?, parcel?}`. The ghost stays pinned there until the mouse moves (tests, showcase).
- `placeAt(x, y, {confirm?, mortgage?})` → `Promise<{ok, reason?, kind, id?, cost?, refund?, area?, parcelId?}>`. This is the primary click without dialogs.
- `undo()` → `{ok, kind, id, refund}` or `{ok:false, reason}`. `cancel()` steps back like Esc. `rotate(step=π/2)`.
- `tools()` → `[{id, label, enabled, reason, items?}]`. `status()` → `{active, mode, tool, item, rot, verts, chain, undo:[{kind,id,cost,ttl}], placed, demolished}`.

## Events
- `buildtools:placed {kind:'building'|'field'|'path'|'fence'|'tree'|'pen', id, cost, x?, y?, ...}`
- `buildtools:demolished {kind, id, refund, undo:bool}`
- `buildtools:mode {active, mode}`

## World data
`world.buildtools = {active, mode, tool, item, rot, verts, chain, history:[{kind,id,cost,name,ttl}], placed, demolished}`. `save()` keeps only `rot` and the counters; build mode is never restored on load.

## Showcase
`deps: terrain, environment, roads, crops, buildings`. Five parcels are laid out on the flattest dry site: owned yard, rented field, neighbour, for sale, to let.

| preset | shows |
|---|---|
| `default` | a valid green barn ghost with a cost label |
| `invalid` | a red barn ghost across the neighbour's boundary, "not your land" |
| `field` | a field polygon being drawn, with its area in ha |
| `land` | the land-mode parcel map with state and price labels |

## Tests
`scratchpad/buildtools/game.test.cjs` (builder scratchpad) has 50 checks in the full game (also passes with `demo` loaded: `ONLY=...,demo,buildtools`). They use the real keyboard, a real mouse click and a real confirm dialog. Perf is ≈ 0.16 ms/frame in build and land mode.

## Known limitations
- **Undo cannot revert terrain.** Undo/demolish of a building does not undo the `terrain.flatten` / farmyard paint done by buildings.
- **Orphan nodes.** Removing a track leaves its nodes, because roads has no `removeNode`.
- **Guessed props/animals calls.** These tools call `props.fence([a,b], {kind, owner})`, `props.place(kind, x, y, {owner})`, `props.remove(id)`, `animals.createPen(poly, {owner})` and `animals.removePen(id)`. They must be aligned once those modules exist.
- **Tracks only join existing nodes.** A track does not split an existing road edge when it touches one mid-span.
- **Simple ghost.** The building ghost is a tinted footprint, with no roof sprite.
