# Builder guide (read fully before writing code)

You are the builder of exactly ONE module: `src/modules/<id>/`. Read `ARCHITECTURE.md` first,
then skim `src/core/*.js` (read-only for you) — especially `boot.js` (ctx), `renderer.js`
(layers, collectors, shadow/light API), `art.js` (painting helpers), `palette.js`.

## Hard rules
1. Write ONLY inside `src/modules/<id>/`. Never edit core, tools, registry, index.html, or another
   module. If you need a core change, append a request to `docs/core-requests/<id>.md`
   (what, why, proposed code) and work around it meanwhile.
2. Never import from another module's folder. Use `ctx.modules.get('x')` (may be `null`, and any
   call may return `undefined` — always tolerate that). Wave-1 modules must not hard-depend on
   other wave-1 modules (use `optionalDeps`); `showcase.deps` may list anything.
3. Determinism: no `Math.random`, `Date.now`, `new Date`, `performance.now`. Use `ctx.rng(stream)`,
   `ctx.noise(stream)`, `ctx.clock`. Run `node tools/lint.js <id>` — must print `lint OK`.
4. Art: "painted gouache, top-down". No flat programmer rectangles/circles. Paint sprites once into
   `ctx.art.sprite(key, w, h, paint)` at `art.PPM` px/m, then draw scaled. Use palette tokens,
   noise texture, tinted outlines (`art.outline`), soft contact shadows, grain. Respect season.
   Things with height MUST submit shadow casters (`F.shadow.*`) — don't paint directional shadows
   into sprites. Anything that emits light at night submits `F.light(...)`.
5. Performance: cache everything static; cull to `view`; stay within the budget in ARCHITECTURE §6.
   Check `msAvg` for your module in the shot JSON (`health[]`).
6. The app must stay loadable: after every significant edit, run a screenshot. A syntax error
   in your module only fails your module, but don't leave it broken.
7. **Never claim a visual result you have not screenshotted and looked at** (open the PNG with the
   Read tool). Other agents are working concurrently — the dev server at http://localhost:5173 is
   shared; do not start or kill servers.

## Verification loop
```
node tools/shot.js --showcase <id> --preset default --time 10:00 --out shots/<id>/wip/default_1000
node tools/shots.js <id> --tag wip            # all presets × 07:00,12:30,19:30,23:30
node tools/shot.js --showcase <id> --weather rain --time 17:00 --out shots/<id>/wip/rain
node tools/shot.js --showcase <id> --debug ...   # adds on-screen perf/health overlay
node tools/lint.js <id>
```
The JSON next to each PNG has `consoleErrors`, `pageErrors`, `health` (status + msAvg per module),
`contracts` (API/manifest mismatches), `stats` (fps, frameMsAvg/p95, drawCalls). Target: zero errors,
zero contract issues. Headless fps is not meaningful; `frameMsAvg` (CPU) is.

## Showcase
Export `showcase = { deps, presets, stage(ctx, presetName) }`. The stage builds a small,
representative, *beautiful* scene of just your module (plus showcase deps as backdrop). Provide
at least 2 presets (e.g. `default` overview and `closeup`), each with a camera and time. The
critic judges your module from these screenshots, so the showcase must show every feature.

## Deliverables
- `src/modules/<id>/index.js` (+ any files in your folder)
- `src/modules/<id>/README.md`: purpose, API (signatures + units), events, world data shape,
  showcase presets, known limitations.
- Final report (your last message): what you built, the screenshot paths you looked at and what
  you saw, real perf numbers from the JSON, lint result, open issues, core requests filed.
  Be honest: list what is weak or missing.
