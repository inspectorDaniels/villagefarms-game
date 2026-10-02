# Harvest Valley

2D top-down farming game — vanilla ES modules + Canvas2D, no build step, no runtime dependencies.
Design and module contract: `ARCHITECTURE.md`. Progress, scores and open issues: `docs/STATUS.json`.

## Run it

Requires Node.js (14+) and a modern desktop browser (Chrome/Edge/Firefox).

```
npm run serve          # static dev server on http://localhost:5173 (or: node tools/serve.js 8080)
```

Open **http://localhost:5173** for the full game. No `npm install` is needed to play; it is only
needed for the screenshot tools (puppeteer-core).

Useful URL parameters (combine with `&`):

| parameter | effect |
|---|---|
| `?showcase=<module>&preset=<name>` | stage one module's showcase scene, e.g. `?showcase=vehicles&preset=working` |
| `?time=18:30` | start at a time of day |
| `?day=20` | day of year (36-day year: ~20 autumn, ~32 winter) |
| `?weather=rain` | force weather: clear, cloudy, rain, storm, fog, snow |
| `?seed=abc` | different world seed |
| `?cam=x,y,zoom` | camera position (metres) and zoom (px/m) |
| `?only=terrain,roads,...` | load only these modules |
| `?debug=1` | on-screen perf / module health overlay |

## Controls

| key | action |
|---|---|
| WASD / arrows | walk (Shift = run, drains stamina); drive when in a vehicle |
| Tab | switch to the next farmhand |
| 1–5 | hoe, watering can, seed bag, pitchfork, hands |
| E | use tool on the cell in front · in a vehicle: lower/raise implement |
| F | enter / leave the nearest vehicle (stop first) |
| H / G / U / L | hitch/unhitch · refuel (at a fuel point) · unload · lights |
| R | sell / repair at a building when prompted · in build mode: rotate |
| B | build mode: buildings, fields, farm tracks, demolish (Z undo within 10 s, Esc back) · Build panel has land mode to buy/rent parcels |
| O P J M H (HUD buttons) | panels: overview, finances, jobs, market/land, help |

## State of the game

Work in progress. The modules are built and reviewed one by one (see `docs/STATUS.json`); the
`demo` module that composes the full valley (farm, village, parcels, starting vehicles) is still
being built. Until it lands, the full game shows the terrain with a farmer and one hired hand;
the richest views are the showcases, e.g. `?showcase=vehicles&preset=working`,
`?showcase=crops&preset=harvest`, `?showcase=buildings&preset=farm`, `?showcase=simulation`.

## Developer tools

```
npm install                                   # puppeteer-core for screenshots
node tools/shot.js --showcase crops --preset closeup --time 10:00 --out shots/crops/x   # png + json log
node tools/shots.js roads                     # every preset × 4 times of day
node tools/lint.js [module]                   # determinism / contract lint
node tools/status.js                          # module queue from docs/STATUS.json
```
Set `CHROME_PATH` if Chrome/Chromium isn't found automatically.
