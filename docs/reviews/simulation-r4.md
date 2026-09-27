# simulation — review round 4
Score: 6/10   Pass: no
Screenshots examined:
- shots/simulation/review-r4/jobs_1930.png. The other 15 showcase shots were checked through their JSON only.
- shots/review/simulation-r4/game_live.png: my own puppeteer run. I defined 2 owned parcels with crops fields, worked field 1 through `crops.work`, and booked a contractor for half of field 2. I possessed Dries and delegated a job to him at the same time, then ran about 1.5 game days.
- shots/review/simulation-r4/game.png (12:30), checked through its JSON only.

Perf:
- Showcase: frameMsAvg 0.14–0.24, p95 0.2–0.9, drawCalls 2–5, module msAvg 0.04–0.08.
- Full game: frameMsAvg 4.02, p95 10.3, drawCalls 52, simulation msAvg 0.008.

Errors: 0 console and 0 page errors (16 showcase shots, the game shot, my live runs).
Contract: 0 issues. The new API is `logWork`, `reserveMachine`, `machinesFree`, `capShare`; the module listens to `crops:worked` and `clock:hour`.
Lint: OK.

## Verdict
This is the first round where the economy holds up as a game. I checked the r3 must-fixes myself:

| r3 must-fix | what I measured | result |
|---|---|---|
| **Contracting plateaus** | My own contracting company, full kit per hand: year-3 operating result €3k / €2k / −€8k for 3 / 6 / 12 hands. Accepting offers late to dodge the crew-pay decay only lowers income (€41k vs €51k at 12 hands). | fixed |
| **Machine reservation** | One combine with 3 delegated combine jobs finishes them on 3 separate days. | fixed |
| **Live CAP wiring** | End to end: a single 3 m plough strip, driven twice over the same cells, gives a CAP share of 0.039. Re-working the same cells does not inflate it. | fixed |
| **Live wages** | Possessing Dries logs `possessed` hours; his days settle at the €180 day rate. | fixed |
| **Validation** | `recordFieldWork` on a neighbour's parcel or with op `'dance'` is refused, `hireContractor` rejects unknown ids, and a €80 micro-booking now earns €5 of CAP. | fixed |

Both harnesses reproduce the README: 25/25 probes closed, and the builder median is €303k at year 10.

Three holes remain, all at the seams the new wiring created:
- Contractor work is credited for CAP twice, so a half-field booking pays full CAP (live).
- A hand the player is possessing still completes his delegated job somewhere else (live).
- The director's r4b ordering fails at the bottom of the sensitivity range.

None of these is large, but the first two are exactly the min-maxer moves the last three rounds closed.

## Must fix
1. **CAP double-counts contractor work. Confirmed live.**
   - `contractorDay` credits the booked area (`sim.creditWork(b.parcelId, b.op, b.areaM2)`).
   - Crops then applies the booking and emits `crops:worked {…, contractor: true}`, and `onCropsWorked` credits the same area again under the same tool key.
   - Live: a 0.5 ha `plough` booking on a 1.0 ha owned parcel (the €80 minimum) made `capShare` 1.00. Headless, the same booking gives 0.50 after the booking and 1.00 after the event.
   - So any contractor booking earns twice its area for CAP, and booking half of each field gets full CAP.

   Fix: ignore `crops:worked` when `e.contractor` is true, or stop crediting in `contractorDay` now that crops reports it. Pick one owner. Add both paths as a probe in `exploits.mjs`.
2. **A possessed hand still works his delegated job.** Confirmed live.
   - `workDelegated({hours:1})` only asks `characters.isAvailable(workerId)`, which means "awake".
   - Possessed Dries (`kinds: {possessed: 16.9}`) stood at the start point all day (game_live.png) while "Mind livestock, 8 h" was worked abstractly and paid (€152).
   - So each hand does a full day of player-controlled work plus up to 10 h of delegated work for one day rate. For machine jobs this also reserves a tractor the player may be driving.

   Fix: skip a worker for the hour when he has `possessed` hours logged that hour (you already have `w.kinds`). Also ask characters (core request) for `isAvailable` to return false while possessed or driving.
3. **The r4b requirement is not met at AI ×0.5.** r4b requires builder > renter > smallfarm > contractor > jobs at AI_WORK_FACTOR ×0.5 to ×2.

   | AI factor | jobs | contractor | smallfarm | renter | builder |
   |---|---|---|---|---|---|
   | ×0.5 (`--ai=0.5`) | €98k | **€78k** | €170k | €195k | €246k (below the €250k floor) |
   | ×1 | €98k | €112k | €176k | €243k | €303k |
   | ×2 | €98k | €123k | €180k | €269k | €318k |

   At ×0.5 the contractor strategy falls below jobs-only, and the builder falls below €250k. `progression.mjs` still prints the stale "target 400–600k … in range 0/8". Update the targets to r4b, print the ordering check for all three factors, and tune (e.g. a cheaper retainer, or crew pay floored slightly higher) so the ordering holds. If this should be allowed, argue it to the director instead.

## Should fix
- **`recordFieldWork` is still a full-CAP backdoor.** `recordFieldWork(ownedParcel, 'plough', {areaM2: 1e12})` → true, and `capShare` becomes 1. It checks ownership and the op name, but not the area against real work. Now that `crops:worked` exists, refuse it on parcels that have crops fields, or cap it per call (e.g. to what one machine-hour covers). At minimum, document it as trusted and meant only for land without crops fields.
- **Insolvency end state (`r4a` D, 250k shock, 1 rented parcel, 60 t in store).**
  - The timeline goes: blocked at d30, machines seized by d60, hands laid off at d90, restructured at d93 with €2k cash, blocked again at d125, and bankrupt at d185.
  - The restructuring loan (the whole overdraft over 10 years at 6 %, about €3.6k a month) against a farm with no machines and no hands guarantees a second default. It is a 90-day delay, not a second chance. Size it to the farm's income, or restructure with a grace period.
  - Leases keep charging rent after bankruptcy.
  - Stored grain is never seized, even though it is the easiest asset to liquidate.
  - `bankrupt` is permanent and blocks everything forever, even if cash turns positive. Define what the UI does with `stage:'bankrupt'`.
- **Possessing a hand for one real minute (1 game hour) costs his full day rate.** This follows the r4 rule, but a player who Tabs to Dries to look around pays €150–220. Show the cost in the UI ("Dries is on the clock today"), or let the threshold count only work-type activity.
- **Live `characters.list()` shows `workerId: null` for Dries**, although wages settle correctly. Either the list hides the field or the link is kept somewhere else. The characters owner should check.
- **The live game still has no parcels.** No demo exists yet, so CAP, contractors and land exist only when another module defines parcels. This is not held against simulation.

## What works
- **Contract market saturation.** Offers per day are capped at 7, hands beyond 3 add no offers, and crew pay falls 6 % per held crew job down to −30 %. You can't game the decay by accepting late.
- **Machine reservation** is per category, per holder and per day, and my one-combine probe confirms it.
- **CAP from crops events, live.** The crops wiring (`crops:worked` with `parcelId`/`areaM2`) and `economy:contractor-done` → crops both landed, and I verified them live: the booking was done and the field changed.
- **Wages from real activity, live.** Days settle at the day rate after ≥ 1 h logged; idle days cost the €35 retainer.
- **Delegated jobs respect sleep.** They are worked only in daylight (07–17) and only while the hand is awake.
- **Harnesses** reproduce from the default commands, 25/25 probes.
- **Board.** The farm card now fits: "2 (Kobe, Camille) · €185–€205 a day worked" (jobs_1930.png). The engine is deterministic and costs 0.008 ms per frame in the full game.
