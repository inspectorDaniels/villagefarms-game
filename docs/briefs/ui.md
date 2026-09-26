# Brief: ui (wave 1)

The DOM HUD and panels living in `#ui` (`ctx.uiRoot`). Look: warm paper cards, ink text, thin
wood/brass borders, Georgia headings, system sans body, hand-drawn inline SVG icons (no emoji,
no external fonts/images). Readable over bright meadows and at night. Subtle, not a dashboard.

## Required API (other modules register into the UI; never the other way round)
- `registerHud(id, { slot: 'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right', order?, render(el), update?(el) })`
- `addPanel(id, { title, icon?, hotkey?, render(el) , onOpen?, onClose? })`, `openPanel(id)`, `closePanel(id?)`, `togglePanel(id)`
- `toast(text, { kind: 'info'|'money'|'warn'|'error'|'success', icon?, ms? })`
- `setToolbar(items)` items `[{ id, label, icon, hotkey, active?, onSelect }]`
- `confirm({ title, text, okLabel, cancelLabel })` → Promise<boolean>
- `setPrompt(text | null)` — contextual hint ("F — enter tractor")
- `worldLabel(id, { x, y, text, kind })` / `removeWorldLabel(id)` — labels anchored to world positions
- `setCharacters(list, activeId, onSelect)` — portrait bar for the multi-character switcher
- `icon(name)` → SVG string (shared icon set: coin, wheat, tractor, clock, sun, moon, cloud, rain, snow, fog, map, jobs, build, person, cow, chicken, barn, settings, pause, play, fast)
Set `ctx.input.uiCapturing = true` while the pointer is over UI so clicks don't hit the world.

## Built-in HUD & panels (read data via `ctx.modules.get('simulation')`, `ctx.clock`, `world.environment`; all optional)
- HUD: money with animated delta, date "Tue 2 March, Year 1", time, season, weather icon + °C, game
  speed controls (pause/1×/3×/10×, keys Space/+/−), minimap (top-right) using `terrain.minimap()` +
  `roads.drawMinimap()` + parcel outlines from `simulation.parcels()` + player marker if present.
- Panels: Finances (balance, 30-day chart, ledger), Market (prices + sparkline trends, sell points),
  Jobs board (J) with accept buttons, Land (M) parcel list/map with buy/rent + cost, Help/keys.
- Toast stack, confirm dialog, prompt hint.

## Showcase
Backdrop: a painted neutral ground (your own, or `showcase.deps: ['terrain','simulation','environment']`).
Presets: `default` (HUD only), `finances`, `jobs`, `land`, `market` (each opens that panel), `night`
(HUD at 23:00 over a dark scene — contrast check).
