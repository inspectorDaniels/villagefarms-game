# ui — DOM HUD, panels, toasts, toolbar, minimap, character bar

Everything lives in `ctx.uiRoot` (`#ui`) under one `.hv-ui` root; all CSS is injected as
`<style id="hv-ui-style">` and scoped under `.hv-ui`. Look: warm paper cards (procedural paper
texture painted to a data URL at init), ink text, thin wood/brass borders, Georgia headings,
hand-drawn inline SVG icons. No emoji, no external assets.

Files: `index.js` (manifest/init/API/HUD), `panels.js` (built-in panels + formatting),
`data.js` (data adapter + showcase sample data), `minimap.js`, `icons.js`, `portraits.js`,
`style.js`, `showcase.js`.

## API (`ctx.modules.get('ui')`)
| call | notes |
|---|---|
| `registerHud(id, { slot, order?, card?, className?, render(el), update?(el) })` | slot: `top-left|top-center|top-right|bottom-left|bottom-center|bottom-right`. `render` once, `update` at 10 Hz. `card:false` = no paper card. Returns id. |
| `removeHud(id)` | |
| `addPanel(id, { title, icon?, hotkey?, order?, subtitle?, launcher?, render(el), sig?(), update?(el), onOpen?, onClose? })` | hotkey `'KeyJ'` or `'J'`. Appears as a tab + round launcher button (bottom-right) unless `launcher:false`. `sig()` → any string; when it changes (checked at 2 Hz) the panel re-renders keeping scroll. |
| `removePanel(id)` · `openPanel(id)` · `closePanel(id?)` · `togglePanel(id)` · `isPanelOpen(id?)` · `refreshPanel(id?)` | one panel open at a time. `isPanelOpen()` → open id or null. |
| `toast(text, { kind, icon?, ms?, title?, html? })` → id | kind `info|money|warn|error|success`. Text is escaped unless `html:true`. Max 5 stacked, click to dismiss. |
| `setToolbar([{ id, label, icon, hotkey, active?, onSelect(item) }])` · `setActiveTool(id)` | UI handles the hotkeys and calls `onSelect` — owners should not also bind them. |
| `confirm({ title, text, okLabel, cancelLabel, icon?, danger? })` → `Promise<boolean>` | Enter = OK, Esc = cancel. |
| `setPrompt(text \| null)` | `"F — Enter tractor"` renders a key cap + text. |
| `worldLabel(id, { x, y, text, kind, icon? })` · `removeWorldLabel(id)` | metres; kind `info|field|sell|job|warn`. Culled off-screen. |
| `setCharacters(list, activeId, onSelect(id))` | list `[{ id, name, skin?, hair?, cloth?, style?, status?(icon), statusText? }]` — painted SVG portraits. |
| `icon(name)` → SVG string | coin wheat tractor clock sun moon cloud overcast rain snow storm fog wind thermo map jobs build person cow chicken sheep barn shop settings pause play fast fastest ledger market land help close check warn info up down flat hoe seed water axe truck calendar star potato beet milk egg wool hay rapeseed maize diesel compass pin hand loan |
| `formatMoney(v, { sign?, dec?, compact? })` | `€18,240.50`, `−€1,234.50`, `€12.4k` |
| `setSpeed(mult)` (0 = pause, 1/3/10) · `getSpeed()` | clock.scale = 60 × mult |

Keys (ignored while Ctrl/Alt/Meta is held; handled keys set `ev.stop`): Space pause, `+`/`−` speed, O Finances, P Market, J Jobs, M Land, H Help, Esc closes
panel/dialog, toolbar hotkeys. `ctx.input.uiCapturing` is true while the pointer is over any
interactive UI element (or a dialog is open); it is re-evaluated with `elementFromPoint` when a panel or dialog closes. Transparent gaps in the bottom-centre stack do not capture clicks.

## Events
Emits `ui:action` (`{id:'job-accepted'|'parcel-bought'|'parcel-rented'|'minimap-jump', ...}`),
`ui:panel-opened|closed {id}`, `ui:speed-changed {speed, paused}`, `ui:tool-selected {id}`,
`ui:character-selected {id}`. Listens to `jobs:offered` (batched toast), `jobs:completed|failed`,
`economy:transaction` (sales ≥ €50 toast), `economy:bankrupt-warning`, `env:weather-changed`,
`land:parcel-changed`, `terrain:*`/`roads:changed` (minimap rebuild), `clock:day`.

## World data
`world.ui = { speed, paused, openPanel, activeTool }` (save/load round-trips it).

## Data sources (all optional)
`simulation` (money, ledger, summary, price/priceHistory, sellPoints, inventory, jobs/acceptJob,
parcels/buyParcel/rentParcel, loans, canAfford), `world.environment.weather/daylight`,
`terrain.minimap(px)`, `roads.drawMinimap(g, pxPerMetre)`, player marker from
`world.player.activeCharacterId` looked up in `world.characters`/`world.vehicles`.
Any missing source degrades to a designed empty state (money card hides; panels show an ink
illustration + sentence; minimap shows a painted parchment wash).

## Showcase
Presets: `default` (HUD, toasts, money delta, labels, prompt), `finances`, `market`, `jobs`, `land`,
`confirm` (land + dialog), `help`, `empty` (no economy → empty states), `night` (23:00).
`showcase.deps = ['simulation','environment','terrain']` (manifest optionalDeps: simulation, environment, terrain, roads); add `&uisolo=1` to load the ui alone over
its own painted farm backdrop (useful while other modules are mid-build). When simulation is
absent/stub, the showcase uses a seeded sample dataset from `data.js` (only in the showcase).

## Known limitations
- Balance history is reconstructed backwards from the ledger (no API for historic balances).
- Minimap has no zoom; clicking jumps the camera and drops camera follow.
- Layout: panel width is clamped between the side HUD columns (360–700 px) and its height ends above whatever bottom HUD sits under it; toasts sit above panels and narrow to the space right of an open sheet. Below ~900 px wide toasts may overlap the sheet (still on top).
- World labels fade out when they would overlap a HUD card, a toast or an open panel.
- `empty` preset forces the no-economy path via `data.forceEmpty()` (showcase only).
