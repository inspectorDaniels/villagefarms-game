# simulation — review round 2
Score: 6/10   Pass: no
Screenshots examined:
- Showcase: shots/simulation/review-r2/default_1230.png, jobs_1930.png, market_1230.png, land_2330.png. The other 12 showcase shots were checked through their JSON.
- Full game: shots/review/simulation-r2/game.png (12:30) and shots/review/simulation-r2/game_jobs_panel.png (my own puppeteer run at ?speed=3600: I accepted a job, reported progress through the API and opened the Jobs board with J).

Perf:
- Showcase: frameMsAvg 0.26–0.31, p95 0.3–0.6, drawCalls 2–5, module msAvg 0.06–0.16.
- Full game: frameMsAvg 12.97, p95 31.7, drawCalls 102, simulation msAvg 0.01. The machine is shared with other agents; 8 fps is not caused by this module.

Errors: 0 console and 0 page errors in all 16 showcase shots, the game shot and my live run.
Contract: 0 issues.
- manifest `api` == implementation == README: checked by script, no gaps in either direction.
- All 8 declared events are emitted, and `clock:day` is the only listener.
- There are no cross-module imports and no writes outside `economy/land/jobs`.
- `world.environment` is read with a null check.

Lint: OK.

## Verdict
The engine is clean and the r1 exploits are closed. These checks passed:
- **Determinism.** Two runs of the builder over 4 years with the same seed gave a byte-identical 162 kB world.
- **Save/load.** A JSON snapshot restored into a fresh sim at year 3, day 10, then continued for 60 days with job and sale actions, was byte-identical to the uninterrupted run.
- **CAP flip.** The loss of −€2,960 is real: rent is charged in advance, early exit costs min(rest of term, 3 months) and CAP accrues pro rata.
- **r1 should-fix items.** The loan rate is clamped, the dairy quotes `undefined`, `buyParcel` on land that is only to let is refused, reputation has diminishing returns, and `catchUp` warns.
- **Board.** Still the best-looking thing in the repo.

But I was asked whether the progression is fun and believable in the game, and it is not. The progression is proven in a harness whose two load-bearing assumptions are not in the game:
- the harness farmer can ask a contractor service to do field work, and that service exists only in `strategy.js`;
- the work rates (0.35–1.6 game-h/ha) cannot be reached by a driven tractor at 1 game hour per real minute.

With work only 3× slower, contract income falls from €22k to €4k/yr and the whole curve halves.

Hired hands are the other half of the "control several farmhands" premise, and they are dead content:
- the scripted builder has 0–1 by year 10;
- the showcase's own year-5 farm card says "Farmhands: none hired" (jobs_1930.png);
- a hand doing the only jobs a hand can do without a machine earns €175–230/day against a wage of €830–1,060/day.

After year 4 the ladder of goals thins out. Cash stays flat at €22–59k for ten years. The only new step up is a combine. Hands and the large combine never arrive. Farming 11 ha with no investment ends year 10 only 22 % behind the full builder path (€312k vs €402k).

## Must fix
1. **The harness does not match the game. The progression depends on two things the game doesn't have.**

   (a) **Contractor service.** `strategy.js` calls `api.charge(…,'contractor')` for:
   - lifting sugar beet and potatoes (always);
   - combining before a combine is owned;
   - baling;
   - any overflow of field work.

   That comes to €5–20k/yr in my runs (builder and renter, years 2–10). There is no contractor API. In the live game a player cannot harvest a single cereal hectare before buying a €118k combine. Sugar beet (1/5 of the rotation) and potatoes can never be lifted, because no catalog machine has category `harvester`. Either:
   - add a real API (e.g. `hireContractor(parcelId, op)`, billed at `WORK.contractor` rates, done after a delay, with the timeliness penalty reported to crops) and add a lifter to `MACHINES`; or
   - remove the service from the harness and re-tune.

   (b) **Work rates.** `WORK` assumes, at scale 60 (1 game h = 1 real min):
   - t1 plough at 1.6 h/ha = 96 real s/ha. With a 3 m plough that means driving about 35 m/s (125 km/h).
   - compact combine at 0.7 h/ha = 42 real s/ha. With a 6 m header that is about 40 m/s.

   The vehicles brief describes a kinematic model with real top speeds. At realistic speeds a "Plough 6 ha, 2–4 days" offer takes more than 2 game days of non-stop driving.

   My sensitivity run (`probes4`, 8 seeds, the same manager with every `WORK` hour × k):

   | work × | contractor Y1 → Y10 net worth | builder Y1 / Y4 / Y10 | contract €/yr |
   |---|---|---|---|
   | ×1 | €64k → €250k | €64k / €137k / €412k (64 ha) | €19–26k |
   | ×3 | €48k → €67k | €49k / €69k / €177k (34 ha) | €3–6k |
   | ×6 | — | €47k / €56k / €128k | €1k |

   The Y1 target (cash €35–60k with jobs as the main income) survives only at ×1. To fix:
   - publish the time budget (real seconds per ha by operation and tier) in README;
   - file a core request or brief amendment so that vehicles, crops and demo size fields and implements to it;
   - derive job `amount` and `deadlineDay` from `workRates()` instead of fixed ranges;
   - add a work-rate multiplier to `progression.mjs`, and show the curve at ×1, ×3 and ×6 so the director can see how robust it is.
2. **Hired hands never pay. They must become a mid-game goal, not dead content.** The root cause is the "annual ÷ 36" rule:
   - A game year gives one person 36 × 12 = 432 working hours, against about 1,800 in real life.
   - Every job still pays real per-ha or per-hour rates.
   - So a hand costs €70–88 per worked game-hour against a real €20/h, which is about 4× too much for the work you get.
   - Odd jobs pay €14.5–19/h, so a hand on presence jobs loses about €700 a day.
   - The active-job cap of 3 is shared, so a hand adds no contract capacity.

   Lowering the wage alone does not fix it. With the wage patched to €240–320/day, the builder still keeps about 1 hand (Y10 €432k vs €412k), because the harness contractor is the cheaper substitute. Escalate the wage to the director with a proposal, for example:
   - a daily rate for days actually worked (≈ €18–24/h × hours worked, ≈ €220–300 per game day), or a day-labourer hire;
   - an active-job cap that scales with crew (e.g. 3 + 2 per hand);
   - a harness target of "first hand by Y3–4, 2 by Y6".

   Then show it in `progression.mjs` with the contractor service from #1 in place.
3. **The bank lends to an insolvent farm, and bankruptcy has no consequence.**
   - `creditLimit()` subtracts loans but ignores a negative cash balance. At −€377k (5 hands kept 2 years, `probes.mjs` §5), `takeLoan(1000)` still succeeded.
   - Wages keep being force-charged forever. Nothing happens beyond `economy:bankrupt-warning` and 12 % overdraft interest.

   To fix:
   - count `max(0, −money)` as debt in `creditLimit()`;
   - define what happens after N negative days (hands leave unpaid, the bank calls in unsecured loans, or a forced sale of machinery), and document it.
4. **README claims don't reproduce with the documented commands.**
   - README says farming beats contracting per player-hour "from ≈ 15 ha". Its own table (builder farm €/h vs jobs €/h) says otherwise:
     - Y2 (20 ha): €73 vs €79/h.
     - Y3 (26 ha): €66 vs €91/h.
     - The crossover is about 30 ha, and farm €/h counts CAP (non-labour income) as earnings per hour.
   - The exploit table quotes a 12-seed run. The documented default `node …/exploits.mjs` (8 seeds) prints "Land flip: buy, hold 1 year unfarmed, sell | +€1,275 | EXPLOITABLE ✘ … 13/14 probes closed".

   Report the default run honestly, or make the probe robust (more seeds, mean with CI), and fix the ha threshold.

## Should fix
- **Credit-limit bypass (not profitable, but unrealistic).** Selling a mortgaged parcel or a dealer-financed machine leaves its secured loan with nothing behind it:
  - Buying a €158k parcel on a mortgage and selling it the same day gives +€96k cash and +€107k debt, when the credit limit was €55k.
  - A `tractor_t2` finance flip takes cash from €18k to €59.6k (+€48k debt), when the unsecured limit was €31k.

  Settle the secured loan from the sale proceeds.
- **`sell(item, qty, sp, {fromInventory:false})` is a public money mint.** It paid €9,585 for 50 t of wheat the farm never had. Make it an internal or producer-only path (e.g. a separate `sellDirect` documented for animals), or check the caller.
- **Root-lifting offers can never be done.** "Lift 8.3 ha of potatoes €1,950" (jobs_1930.png) needs a `harvester`, and no catalog entry has that category. These offers take slots from the 8 open offers. See #1.
- **Jobs in the live game have no coordinates.** With no demo parcels, every job's `to` is `{kind:'farm', name}` with `x: null`, and transport goes to a placeholder "Coöperatie depot" (live run). Give client farms a location. Parcels already carry `owner` (the client's name), so use the centroid of one of the client's parcels, or add `defineClientFarm(name, {x, y})`.
- **CAP pays on idle land, so land-banking is passive profit.** I ran the contractor strategy and bought every for-sale listing on a mortgage without ever farming it. That gave +€45k net worth by Y10 (€295k vs €250k) from 14.7 idle ha and zero hours of work. Tie CAP to cropped or maintained parcels (crops can report it), or cut it for fallow.
- **Pace in real hours.** One game year is 14.4 real hours at 1×. First land in Y2–4 means 29–58 real hours, and the combine in Y4–8 means 58–115 real hours. State the milestones in real hours as well, and check that the 3×/10× HUD speeds don't let the player skip the economy (e.g. fast-forward while rent and CAP keep flowing).
- **Mid-game (Y5–10) has no new goals.** Candidates:
  - a grain store (`setCapacity` exists but there is no storage catalog item, and the harness stores without limit);
  - forward contracts;
  - reputation-gated bigger contracts;
  - the large combine within reach;
  - livestock income hooks.
- **Harness valley vs world size.** The valley is 158 ha, but the 1024 m world holds about 68 ha of those cells. The brief's 50–80 ha estate is the whole map. Clipping the land market to the 1024² box kept Y10 at €414k and 54 ha, so the economy survives. Switch the harness to the demo's real parcels once they exist.
- The market preset still drops the sixth buyer (the potato merchant).

## What works
- **Architecture and correctness.** All money goes through one `record()`, and the operating vs capital split is right.
- **Determinism and save/load.** Both round-trip byte-exactly (verified independently, above).
- **Harness integrity.** The harnesses import the real `sim.js`/`economy.js`/`land.js`/`jobs.js`. `util.js` is the same algorithm as `core/rng.js`: I diffed them, and the differences are only comments and formatting.
- **Land rules are now sound.**
  - Rent is monthly in advance, the minimum term is 1 year, the exit cost is capped, and CAP is pro rata.
  - Listings are scarce, and appreciation runs through a regional index.
  - Owning beats renting: +€45k per 4 ha at 10 years, 8/8 seeds, verified.
  - Buying land and selling it the next day loses about €4k on every seed.
- **Market.** Saturation punishes dumping and lets you spread sales: €156/t dumped vs €166/t spread. Consumables can't be sold back, and a buyer that doesn't take an item quotes `undefined`.
- **Contracts are capped.** €24–26k/yr from Y2 whatever the player does. Accepting a job and failing it costs money and reputation, and hiring and firing a hand the same day saves nothing.
- **Live game.** A job accepted and completed through the API credits €446 (a €425 job + 5 % early bonus). The UI toasts it, and the Jobs board lists the offers with the right pay and deadlines (game_jobs_panel.png).
- **Board.** The ledger, price sheets with seasonal norm, high/low and harvest marks, valley map, job cards with stamps, and the night lamp pool are all good. Map labels no longer clip, and the price sheet now says "last three harvests" (default_1230.png, market_1230.png, land_2330.png).
