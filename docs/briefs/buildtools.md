# Brief: buildtools (wave 2)

The construction / placement mode (key **B**). Deps: `simulation`, `ui`. Optional: buildings, props,
crops, terrain, roads (paths), animals (pens).

## Features
- Build menu (ui panel) with categories: Buildings (from `buildings.types()`), Fields (draw a field
  polygon inside owned/rented land → `crops.createField`), Fences/hedges (poly-line → `props.fence`),
  Pens (`animals.createPen`), Paths (gravel/dirt farm tracks → `roads.addEdge` class `track`),
  Trees (`props.place`), Demolish.
- Ghost preview following the mouse, snapped to 0.5 m grid, R rotates, green/red validity tint with
  the reason (`canPlace` + land ownership via `simulation.canUse` + money via `canAfford`), cost
  label, area in hectares for fields, length for fences. Click to place → charge via simulation.
- Esc cancels. Undo last placement within 10 s (refund).
- Land mode: shows parcel outlines and states (owned/rented/for sale) with price labels; click to
  buy/rent via confirm dialog.

## API
`enter(mode?)`, `exit()`, `isActive()`, `select(tool, itemId)`, `preview(x, y)` (for tests),
`placeAt(x, y)` (for tests/demo). Events: `buildtools:placed`, `buildtools:demolished`.

## Showcase presets
`default` (placing a barn: valid ghost), `invalid` (red ghost over water/other's land), `field`
(drawing a field polygon), `land` (land-mode parcel map). Use `showcase.deps` for backdrop modules.
