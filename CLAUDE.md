# Harvest Valley — agent entry point

Before doing anything, read `docs/ONBOARDING.md` (roles, the build→critic loop, hard rules, tools,
design decisions already made). Then `ARCHITECTURE.md` and your role guide (`docs/BUILDER_GUIDE.md` /
`docs/CRITIC_GUIDE.md`). Current scores, priorities and resume steps: `docs/STATUS.json`.

Non-negotiables: write only in your own module folder; never run `git stash/checkout/reset/restore/clean`;
keep the app loadable at every edit; no `Math.random`/`Date.now`/`performance.now` in modules; scratch
files go in the session scratchpad, never in the repo; don't start/kill the shared dev server (:5173).
