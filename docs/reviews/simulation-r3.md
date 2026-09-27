# simulation — review round 3
Score: 6/10   Pass: no
Screenshots examined:
- shots/simulation/review-r3/jobs_1230.png
- shots/simulation/review-r3/default_1930.png
- The other 14 showcase shots: JSON only.
- shots/review/simulation-r3/game.png (full game, 12:30)
- shots/review/simulation-r3/game_after.png (my own puppeteer run: I delegated a job to the starting hand, booked a contractor, and ran about 1 game day at scale 3000)

Perf:
- Showcase: frameMsAvg 0.24–0.29, p95 0.3–1.5, drawCalls 2–5, module msAvg 0.09–0.17.
- Full game (11 modules now, including crops, vehicles and characters): frameMsAvg 8.49, p95 32.2, drawCalls 54, simulation msAvg 0.017. The machine is shared, which explains 6 fps; it is not this module.

Errors: 0 console and 0 page errors (16 showcase shots, the game shot, my live run).

Contract: 0 issues.
- 10 events are declared, including the new `economy:contractor-done` and `economy:asset-seized`.
- There are no cross-module imports.
- vehicles already reads `workRates().kit`.

Lint: OK.

## Verdict
r3 is a real step forward, and every r2 must-fix is addressed in code:
- There is a contractor API, and a root harvester in the catalog.
- `workRates()` is the single source; the physical rate is width × km/h × efficiency.
- Player jobs take 7–18 real minutes. I saw `estPlayerMin` 7–18 and coordinates on every live offer.
- Hands cost €150–220 per day worked.
- Insolvency now blocks and seizes. The bank refuses loans to an overdrawn farm, and I watched a financed tractor get seized with its loan settled.
- Both harnesses reproduce the README from the documented default commands: 21/21 probes, builder €405k at year 10, and the `--ai=0.5` row at €237k.

The problem is the new mechanic. Hands earn €50–220 per game hour on crew jobs, but cost €15–22 per hour. Each hand also brings about 1.2 more offers a day and one more active-job slot. So contracting does not plateau: it grows linearly with the number of hands.
- 24 hands with their own kit reach €256k/yr of contract income and €121k operating by **year 3**. That is twice the builder's year-10 operating result, without farming a hectare.
- It gets cheaper still because implements are not reserved: one combine or one trailer serves every hand at the same time.

The README's "pure contracting plateaus at €37–39k" is only an artefact of the scripted contractor stopping at 3 hands.

The CAP gate can be bought for €80, and in the live game nothing wires up CAP or wages:
- no module calls `recordFieldWork`, so CAP pays nothing for fields the player works himself;
- no module calls `logWork`, so the starting hand works for the €35 retainer;
- nothing handles `economy:contractor-done`, so contractors are paid and change no field.

The mechanics are much closer, but a min-maxer would play a trucking company, not a farm.

## Must fix
1. **Contracting scales without limit with the number of hands. The farm premise breaks again.**

   My probe (`r3d`, 4 seeds, public API only) gave each hand a t1 tractor, a plough/drill and a trailer (≈ €46k per hand). A greedy loop assigned every machine or presence offer to a free hand, and the land was never farmed:

   | hands | Y3 contract income | Y3 wages | Y3 operating net |
   |---|---|---|---|
   | 3 | €35k | €14k | €18k |
   | 6 | €66k | €29k | €32k |
   | 12 | €123k | €59k | €56k |
   | 24 | €256k | €114k | €121k |

   Why it scales:
   - Offers per day are 2–4 + ⌊1.2·hands⌋.
   - Open offers are capped at 8 + 2·hands, and the active cap is 2 + hands, so supply grows 1:1 with the crew.
   - A crew plough job in the live game paid €935 for about 18 hand-hours ("Plough 8.65 ha") against 2 × €180 in wages.

   The brief (r2) says "Pure contracting must plateau (limited offers)". Fix it by doing all of these:
   - Make offer supply saturate: a valley-wide cap on crew work per month, or +1.2 offers per hand only up to about 3 hands.
   - Let pay per hand-day on crew work drop as the farm floods the market, the way crop saturation works.
   - Re-run the contractor strategy uncapped (e.g. up to 12 hands) in `progression.mjs` and show it plateaus below the builder.
2. **Implements and self-propelled machines are not reserved in `workDelegated`.**
   - Only tractors are counted. For a job that needs a combine, harvester, trailer, tillage set, mower and so on, the check is `owned(needs).length ≥ 1`.
   - With **one combine**, 3 hands on 3 combine jobs all completed them in the same night.
   - With **one trailer** and 3 tractors, 3 haul jobs completed the same night (`r3b` P3).

   Count machines by category, including `harvest` (the combine) and `lift` (the harvester), and book one machine per job per day.
3. **The CAP gate can be bought for a few euros and trusts anyone.**
   - (a) `hireContractor(parcelId, op, {ha: 0.01})` costs the €80 minimum. When done, it calls `recordFieldWork` for the **whole** parcel.
     - Land bought and never worked still collects full CAP.
     - Example: on seed 3, €400 of 0.01 ha "spray" bookings over 3 years bought €6k of CAP on 5.6 ha (`r3a` P1).
   - (b) `recordFieldWork` does not check that the parcel is owned or rented, or that the op is real. `recordFieldWork(neighbourParcel, 'dance')` returns true. The flag also survives a later `rentParcel` or `buyParcel`, because only `endLease` and sale reset it.
   - (c) `hireContractor` accepts unknown ids: `'no-such-parcel'` and `'nowhere'` were booked and charged, including live.
   - (d) **Live:** crops is loaded but never calls `recordFieldWork`, and simulation does not listen to `crops:worked`. So CAP pays €0 on land the player works himself.

   To fix:
   - Credit CAP only for the worked **area share**, or require a booking or worked area ≥ about 50 % of the parcel.
   - Validate ownership at the time of work, and validate `op`.
   - Refuse unknown parcel ids.
   - Subscribe to `crops:worked` / `crops:sown` / `crops:harvested` yourself (bus events need no dependency), so CAP no longer depends on a caller remembering to report.
4. **Wages depend on `logWork`, and no live module calls it.**
   - In the live game the characters module hires "Dries" at game start (sim worker `simulation:worker:1`, but his character's `workerId` is `null`).
   - Whatever Dries does as a possessed character or through `tickPresence`, he is paid the **€35 retainer**. Presence progress even gets a 1.6× boost when two characters stand together.
   - Only jobs the sim itself works through `assignJob` log hours.

   So in the live game the player's second character, the core of the game, is nearly free. To fix:
   - Log hours automatically from any progress attributed to a hand: `reportProgress`, `tickPresence`, `recordFieldWork` with a `workerId`, or the assignee's character id mapped to a worker.
   - Or pay the day rate by default on any day the hand was possessed or assigned.
   - Raise the `workerId` link with characters through a core request.

## Should fix
- **Insolvency has no end state without assets.** A farm with no seizable assets (the yard can't be traded) and 3 idle hands sat at −€125k after 200 days: blocked, the hands still employed and paid retainers into a 12 % overdraft (`r3c` S2). Let unpaid hands quit after N days over the limit, and define a final state such as bankruptcy or a restart offer.
- **Contractor bookings do nothing in the live game.** Nothing consumes `economy:contractor-done`, so the booking is paid and the field is unchanged. A partial booking (`ha` < parcel) also doesn't tell crops *which* part to work. File a core request with crops.
- **Delegated presence jobs are completed without the character being there.** In the live run, "Mind livestock, 8 h" was paid at 00:01 while Dries was asleep at home (game_after.png). If the character also walks there, `tickPresence` and `workDelegated` both add progress. Pick one owner per assignee type.
- **One hand with several machine jobs works only one of them a day.** `tractorsUsed` is incremented per job, not per hand (S6: 5 jobs assigned, 3.9 h worked). This is conservative, but it looks like a bug to a player.
- **The harness still has an off-API path.** `strategy.js` pays "Inputs on credit" with `charge(…, {force:true})` when `buyInputs` can't be afforded. The live game can't do that. Either add input credit to the API or drop it from the harness.
- **Net-worth target only just met.** It is 4/8 in range. With #1 fixed, the builder should also be re-checked with a crew beyond 3.
- **Board.** The farm card's hands line is truncated with an ellipsis ("3: Kobe, Camille, Julie · €160–€205/da…", jobs_1230.png).

## What works
- **r2 must-fixes, verified independently:**
  - Harness parity: the contractor API and root harvester exist, and the harness uses public calls only.
  - The time model: `workRates().player` vs `.ai`, player jobs of 7–18 real minutes live, and every live job has x/y.
  - Hands pay off from year 2, with 2–3 hands by year 8.
  - Insolvency: the loan is refused, the farm is blocked from day 30, and machines are seized with their loans settled (S3/S4).
  - README numbers reproduce from the default commands.
- **Credit-bypass and mint holes from r2 are closed.**
  - A mortgage or finance loan is settled on sale.
  - `sell` without stock returns €0.
  - Booking a contractor and cancelling it gives an exact refund and no gain.
  - Idle hands cost the retainer.
- **Sensitivity is visible and honest.** With `--ai=0.5` the builder ends at €237k, and the README shows it.
- **Engine.** Deterministic, cheap (0.017 ms in the full game) and error-free. The board is still excellent (default_1930.png, jobs_1230.png).
