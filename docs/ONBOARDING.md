# Onboarding — how work happens on Harvest Valley

Read this first if you are an agent (or a human) joining without prior context. It explains the
roles, the loop, the rules that were learned the hard way, and where the current state lives.
Then read, in this order: `ARCHITECTURE.md` → your role guide (`docs/BUILDER_GUIDE.md` or
`docs/CRITIC_GUIDE.md`) → your module's brief `docs/briefs/<id>.md` (including any **Revision**
sections at the end — they override the original text) → the latest review `docs/reviews/<id>-r<N>.md`.

---

## 1. What we are building

A 2D top-down farming game (vanilla ES modules + Canvas2D, no build step, no runtime deps). The player
controls several farmhands (Tab), grows a farm from a rented field to an estate, drives machines,
takes paid contract jobs, rents/buys land, in a valley with a village, roads and a day/night/weather
cycle. One folder per subsystem under `src/modules/<id>/`; core engine in `src/core/`.

**Current user directives (these win over older docs):**
1. **Mechanics and gameplay first.** Visual polish is deferred to a later art pass. Art must be
   acceptable painted style, not programmer rectangles — but don't spend effort polishing.
2. **Max 3 concurrent agents** (token spend). Keep runs lean: READMEs before code, targeted probes.
3. **Traffic and animals are deferred.** Focus: crops and the core gameplay loop (farm work, jobs,
   economy, progression). Props is low priority.

Live record of all of this: `docs/STATUS.json` → `priority`, `resume`, `log`.

## 2. Roles

| role | writes | does |
|---|---|---|
| **Orchestrator** (the main session) | `docs/STATUS.json`, briefs' *Revision* sections, `docs/ONBOARDING.md` | plans waves, spawns/resumes agents (≤3), reads reports, **makes design decisions** when modules disagree, commits & pushes |
| **Integrator** (orchestrator wearing another hat) | `src/core/`, `tools/`, `src/modules/registry.js`, `index.html`, `ARCHITECTURE.md` | applies `docs/core-requests/<id>.md`, registers modules in the full game, fixes seams between modules (tiny seam fixes inside a module are allowed only when they remove a now-duplicate workaround, and are logged in STATUS) |
| **Builder** (one per module) | only `src/modules/<id>/` (+ appending to `docs/core-requests/<id>.md`) | implements the brief, verifies with scripted tests + screenshots, writes README, reports honestly |
| **Critic** (separate agent) | only `docs/reviews/<id>-r<N>.md` and screenshots under `shots/` | takes its own measurements, tries to break the module, scores 0–10. Writes **no code** |

Builders never edit another module's folder and never import from it — they call other modules
through `ctx.modules.get('x')` (may be `null`; every call may return `undefined`).
If a builder needs something from another module, it files a request naming the owner; the
orchestrator routes it.

## 3. The loop

```
brief ──► builder round N ──► critic round N ──► pass? ──yes──► follow-ups (should-fixes), next module
                ▲                                    │
                └──────── must-fix list ◄────────no──┘
```

- **Pass rule:** score ≥ 7 AND 0 console/page errors AND 0 contract issues AND within perf budget.
  Any console error caps the score at 6. Never inflate; report real numbers and failed rounds.
- After every report the orchestrator: commits the module's work, updates `docs/STATUS.json`
  (status, score, rounds[], openIssues, note), and pushes.
- **Cross-module problems** (two modules disagree, an exploit spans the economy and gameplay, a
  target is unreachable) are settled by the orchestrator as a numbered **"Revision rN (director …)"**
  appended to the relevant brief, stating the decision, the owner of each part, and the reasoning.
  Examples: `docs/briefs/simulation.md` r3–r6 (time model, hired hands, CAP, insolvency, year-1 target),
  `docs/briefs/demo.md` r2 (first-hour fixes). Builders treat revisions as binding.
- Builders and critics are **resumed** (same agent, keeps context) for follow-up rounds where possible;
  a fresh agent is spawned only when the old one cannot be resumed — then it is told where the WIP is.

## 4. Environment & tools (Linux cloud container)

- Dev server: `npm run serve` → http://localhost:5173 (static, no-cache). It is **shared** by all
  agents. Agents must **not** start or kill servers — only the orchestrator does. It dies when the
  container restarts; the orchestrator restarts it detached:
  `setsid nohup node tools/serve.js > <scratchpad>/serve.log 2>&1 < /dev/null &`
- `npm install` once (puppeteer-core). Chromium: `/opt/pw-browsers/...`; `tools/shot.js` finds it and
  adds `--no-sandbox` on Linux. Puppeteer scripts should reuse
  `const { findChrome, chromeArgs } = require('<repo>/tools/shot.js')`.
- Screenshot + log: `node tools/shot.js [--showcase <id> --preset <p>] --time HH:MM [--day N]
  [--weather rain] [--cam x,y,zoom] [--keys "KeyD:1500,Tab,KeyE"] [--extra "only=a,b"] --out shots/...`
  → `.png` + `.json` (consoleErrors, pageErrors, contracts, health[].msAvg, frameMsAvg/p95, drawCalls).
- All presets × 4 times: `node tools/shots.js <id> --tag <tag>`. Lint: `node tools/lint.js [id]`.
- Full game = plain URL (demo composes the valley). `?only=a,b,c` loads a subset (for modules not yet
  in `src/modules/registry.js`). `?showcase=<id>&preset=<p>` stages one module.
- In the page: `window.__GAME__` → `ready, world, modules (Map of guarded APIs), engine, clock,
  camera, health(), contracts(), stats(), waitFrames(n), game` (whole-game `save()/load()`,
  `saveToStorage(slot)/loadFromStorage(slot)` gzip localStorage, `slots()`).
- **Scratch files go in the session scratchpad directory** (outside the repo), in your own subfolder
  (`<scratchpad>/<module>-<role>/`) — other agents use the same scratchpad and overwrite generic names.
  Never create a `scratchpad/` folder inside the repo.

## 5. Hard rules (each one cost us a round to learn)

1. **Keep the app loadable at every edit.** A mid-edit import error in one module (e.g. using an
   export before adding it) broke every other agent's screenshots. Add exports before using them.
2. **Never run git commands that modify the shared working tree** (`stash`, `checkout`, `reset`,
   `restore`, `clean`). Other agents' uncommitted edits live there. For a baseline use
   `git show <rev>:<path>` or `git archive <rev>` into the scratchpad. Only the orchestrator commits.
3. **Determinism:** no `Math.random`, `Date.now`, `new Date`, `performance.now` in modules — use
   `ctx.rng(stream)`, `ctx.clock`, `update(dt)` time. Lint checks this.
4. **Never claim what you haven't measured or looked at.** Open every PNG you rely on with the Read
   tool; quote numbers from the JSON logs or your scripts.
5. **Bad input must never throw.** Every throw becomes a console error and counts toward the module's
   25-error auto-disable. Validate, warn once, return `null`/`false`/`0`. Also guard non-finite numbers
   (an `Infinity` once made a loop spin forever and froze the game).
6. **Pause:** simulation-affecting `update()` code must skip when `world.time.paused` (not
   `clock.paused`, which also covers showcase freezing).
7. **Exploits are bugs.** Every money path gets a probe: buy→sell loops, undo/refund, double events,
   re-working the same cells, save/load around boundaries.

## 6. Performance pitfalls (measured)

- **`health.msAvg` under-reports render cost** — Canvas work is flushed later inside core passes.
  Measure real cost as an **A/B of `frameMsAvg`** in the same page with your layers on vs off
  (modules expose switches: `?terrainfx=0`, `?roadsfx=0`, `?cropsoff=ground,sway,collect`).
- **Chrome's per-frame texture budget is shared** by all modules. Drawing many / large distinct
  canvases per frame (> ~1.5 MB extra once terrain uses 1024 px tiles) forces re-uploads every frame
  (+20–40 ms). Fixes that worked: view-clipped `drawImage` source rects, small (256 px) chunks,
  `ImageBitmap` chunks, half-resolution composites upscaled ×2, time-sliced chunk builds.
- Headless Chromium here renders in software and the machine is shared — timings are noisy; always
  A/B in one page, repeat, and don't trust wall-clock key holds (step the engine instead).
- Budgets: frame ≤ 12 ms avg / ≤ 20 ms p95, terrain ≤ 2 ms, other modules ≤ 1.5 ms, boot ≤ 6 s.

## 7. Game design decisions already made (don't relitigate)

- **Time:** clock runs 60× (1 real s = 1 game min; year = 36 days = 14.4 real h at 1×). The player's
  own driving is real-time physics, so personally you work small areas; **hired hands and contractors
  work abstractly in game time** (`simulation.workRates()`, `AI_WORK_FACTOR`) — hands are how the farm
  scales. Jobs can be delegated (`assignJob`); haul/deliver jobs are crew-only until a haul loop exists.
- **Economy:** CAP pays on the worked share of parcels (via `crops:worked`, contractor echoes
  ignored); hands paid a day rate on days worked (`logWork`); insolvency blocks at 30 days, settles
  at 60; buildings are a capital book (40 % collateral). Targets: first hand y2, parcel y3, combine y4–6,
  40–60 ha y8, €250–400k net worth y10 (builder strategy, AI ×1); from the live demo start, year-1
  cash must grow ≥ €5k solo / ≥ €10k with a hand. Harnesses: `src/modules/simulation/tests/`.
- **Starting farm (demo):** owned 0.6 ha yard + rented 1.8 ha field, old tractor/plough/trailer/pickup,
  no hand, ~€17.7k. Starting kit should be old & cheap (demo r2).

## 8. Where things are

| what | where |
|---|---|
| scores, open issues, priorities, resume steps, history | `docs/STATUS.json` (`node tools/status.js` prints the queue) |
| module specs + director decisions | `docs/briefs/<id>.md` (read the Revision sections!) |
| reviews | `docs/reviews/<id>-r<N>.md` |
| requests between modules / to core | `docs/core-requests/<id>.md` (integrator marks APPLIED) |
| module API, events, data, tests, limitations | `src/modules/<id>/README.md`, `src/modules/<id>/tests/` |
| how to run / controls | `README.md` |

## 9. State at the time of writing (2026-10-07) — check STATUS.json for newer

- Passing (7/10): terrain, environment, roads, simulation, ui, characters, vehicles, buildings, buildtools.
- In progress: **crops** r2 built (frame cost fixed, CAP stamps) → critic r2 was interrupted mid-run;
  **demo** r2 in progress (first-hour fixes per demo Revision r2) — WIP committed.
- Deferred: effects/audio critics (visual/sound), props (low), animals & traffic (user directive).
- Next after those pass: a crops/gameplay pass — sow/harvest by tractor end to end, trailer delivery
  to the co-op, hands doing field work, NPC farms working their fields; a Save/Load menu in ui.

## 10. Writing a good report (builders and critics)

Final message = what you did, **numbers** (tests, A/B ms, money), screenshots you actually opened,
lint result, errors/contract counts, honest list of what is weak or missing, requests filed. Say
when something was not tested. Don't commit.
