# Brief: simulation (wave 1) — economy, land, jobs

A believable small-farm economy (EU/Belgium flavour, €). Namespaces: `economy`, `land`, `jobs`.
Time: 1 game year = 36 days (12 months × 3). Scale annual figures accordingly (÷36 per day).

## Economy (`world.economy`)
`{ money, ledger:[{t, amount, category, memo}], prices:{item: €/unit}, priceHistory:{item:[...]}, inventory:{item: qty}, capacity:{item: qty}, loans:[...], catalog:{id:{...}} }`
- Start money €18 000, plus optional starter loan up to €50 000 at ~4.5 %/yr.
- Items & base prices: wheat €210/t, barley €185/t, oats €200/t, rapeseed €430/t, maize €195/t,
  potatoes €160/t, sugarBeet €42/t, grass/hay €120/t, straw €70/t, milk €0.46/l, eggs €0.22/ea,
  wool €1.8/kg, diesel €1.25/l (farm diesel), seed & fertiliser per ha by crop.
- Prices: seasonal curve (grain cheap at harvest, dearer in spring) + seeded mean-reverting random
  walk + temporary saturation when the player sells a lot at one sell point (recovers over days).
  Different sell points pay slightly different prices.
- Costs: land rent €350–650/ha/yr, land buy €38–65k/ha by soil quality; wages €110–160/day per hired
  hand; vehicle upkeep; insurance/fixed costs monthly; loan interest daily.
- Yields reference table (t/ha): wheat 8.5, barley 7.5, oats 6, rapeseed 4, maize 11, potatoes 45,
  sugarBeet 75, grass 9 (hay). Crops module will use `yieldTable()`.

## Required API
Money: `money()`, `canAfford(x)`, `charge(amount, category, memo)` → bool, `credit(amount, category, memo)`,
`ledger(n)`, `summary(periodDays)` → {income, expenses, byCategory}.
Market: `price(item, sellPointId?)`, `priceHistory(item)`, `sell(item, qty, sellPointId)` → € received,
`buy(item, qty)`, `defineSellPoint(id, {name, x, y, accepts:[items]})`, `sellPoints()`.
Inventory: `inventory()`, `addInventory(item, qty)` (respects capacity), `removeInventory(item, qty)`,
`setCapacity(item, qty)`.
Catalog: `registerCatalogItem({id, category, name, price, leasePerDay?, upkeepPerDay?, meta?})`, `catalog(category?)`,
`purchase(id)` → bool, `lease(id)`.
Loans: `takeLoan(amount)`, `repayLoan(id, amount)`, `loans()`.
Land (`world.land.parcels`): `defineParcel({poly, name, state, soil})` → id (price/rent derived from area×soil
unless given), `parcels()`, `parcelAt(x, y)`, `buyParcel(id)`, `rentParcel(id)`, `endLease(id)`,
`canUse(x, y)` (owned or rented by player).
Jobs (`world.jobs`): contract generator with seeded NPC neighbours (Flemish/Walloon names), types:
`plough`, `sow`, `harvest`, `mow`, `transport` (N t from A to B), `deliver`, `animalCare`,
`shopHelp`/`villageWork` (presence-based, for characters without machines), `snowClear` in winter.
Each: `{id, type, client, title, pay, deadlineDay, parcelId?|from?/to?, amount, progress 0..1, status}`.
`jobs(filter)`, `acceptJob(id)`, `reportProgress(id, delta)`, `completeJob(id)`, `failJob(id)`, `tickPresence(id, gameSeconds)`.
Workers: `hireWorker(name)`, `fireWorker(id)`, `workers()` (daily wages).
Events: `economy:transaction`, `economy:price-changed` (daily), `land:parcel-changed`, `jobs:offered`,
`jobs:accepted`, `jobs:completed`, `jobs:failed`, `economy:bankrupt-warning`.
Daily processing on `clock:day`: rent, wages, interest, upkeep, price walk, new job offers, expiry.

## Showcase (non-visual module → make its state visible)
Stage a painted "farm office" board on the `screen` layer: a paper ledger with the last entries,
price charts for 6 commodities over a simulated 2 years (fast-forwarded headlessly in `stage`),
the jobs board with offers, and a land-parcel map sketch. Must look like part of the game's art
(paper, ink, gouache), not a debug dump. Presets: `default` (office board), `market` (price charts),
`jobs`. Also self-check balance: a simulated typical season of a 5 ha wheat farm should net a
plausible profit (report the number in README).

---
## Revision r2 (director decision after critic review simulation-r1) — supersedes numbers above

**Progression target** (active play, default seed; verify with a committed script
`src/modules/simulation/tests/progression.mjs`, runnable `node src/modules/simulation/tests/progression.mjs`,
printing year-by-year cash/net worth/ha for 10 game years for 3 strategies × 8 seeds):
- Year 1: starting farm (own 0.6 ha yard + rent 1.8 ha); contract jobs are the main income; end-of-year cash ≈ €35–60k.
- Year 2: renting ≈ 8–12 ha; upgrade to a tier-2 tractor is affordable.
- Year 3–4: first land purchase (a 3–5 ha parcel) is affordable with a loan; 20–30 ha farmed.
- Year 6–8: 50–80 ha estate, combine owned, 2–3 hired hands; net worth ≥ €1M.
- From ≈ 15 ha upwards, farming own/rented land with own machinery must out-earn pure contracting
  per unit of player time; owning land must beat renting over a ≥ 10-year horizon (appreciation + no rent),
  but require a loan to get there. Pure contracting must plateau (limited offers).

**Numbers (game scale, replaces the realistic-€ land/wage figures):**
- Land price €12–22k/ha by soil; appreciates ≈ 2–3 %/game-year with noise; purchase fees 4 %; resale 97 % of market value.
- Rent €450–750/ha/yr (≈ 3.5 % of price), charged **monthly in advance**; lease **minimum term 1 game year**;
  ending early costs the remaining minimum-term rent (or 3 months, whichever is less). Rentals are scarce (a few offers at a time).
- CAP subsidy paid **pro rata by days held** over the year.
- Wages from annual salaries ÷ 36: hired hand €30–38k/yr ⇒ ≈ €830–1060 per game day; must be worth it only when a worker operates machinery on a large farm.
- Contract jobs pay realistic machine-rate style pay (e.g. ploughing €80–110/ha, harvesting €130–170/ha, transport €/t·km), limited to ≈ 2–4 new offers per game day and max 3 active.
- Crop margins: with own machinery a well-run hectare of cereals should net ≈ €500–900/ha/yr before land cost; roots/rapeseed higher risk/higher margin. Market saturation should punish dumping at one buyer but splitting sales across buyers/days must be viable.
- Fix all "should fix" items in docs/reviews/simulation-r1.md (negative loan rate, spot market accepting everything, buyParcel on non-sale land, reputation too fast, jobs without location, board clipping/labels).

---
## Revision r3 (director decisions after critic r2, 2026-09-27)
Assumptions stated by the director; builders tune numbers but keep the model.

1. **Time model for field work.** The clock runs 60× real time (1 real s = 1 game min). The player's own
   driving is real-time physics (vehicles module): a 3 m plough at 8 km/h does ≈1.9 ha per *real* hour.
   Hired hands and contractors work abstractly at the physical rate per *game* hour × `AI_WORK_FACTOR`
   (start 0.25: they are slower than ideal and still need travel/setup time). Consequence, by design: the
   player personally can only work small areas; **hired hands are the scaling mechanism** of the farm
   (this is the multi-character core of the game). `workRates()` must be the single source used by
   jobs, the harness and (later) the vehicles/characters AI.
2. **Job sizing.** Jobs done by the player personally must take ≈5–20 real minutes of driving/walking
   (derive area from `workRates()` and the offered machine). A job may be **delegated** to a hired hand
   (`assignJob(jobId, characterId)`), who executes it at the AI rate. Active job cap = 2 + hired hands.
   Every job has coordinates (a field/parcel polygon or point) in the live game, not only in the harness.
3. **Contractors.** Add a real API `hireContractor(fieldOrParcelId, operation)` → quote/booking with
   €/ha prices (plough, cultivate, sow, spray, harvest cereals, lift beet/potatoes, bale), a lead time
   and the AI work rate; the harness may only use operations that exist in the live API. Add a root-crop
   harvester (beet/potato lifter, category `harvester`) to the catalog.
4. **Wages.** Hands are paid a daily rate only for days they work (target ≈ €150–220/game day at
   game scale), plus a small retainer when idle. Target: first hand pays for itself by year 2–3 at
   ≈20–30 ha; 2–3 hands by year 6–8.
5. **Insolvency.** Negative cash counts as debt against the credit limit; no new loans while over the
   limit. 30 days over the limit → warnings + purchases blocked; 60 days → the bank sells the least
   valuable asset (machine, then land) at 85 % of value. Selling a mortgaged parcel or financed machine
   repays its loan from the proceeds first. Remove `sell({fromInventory:false})` for goods not held.
6. **CAP** pays only on cropped or maintained grassland (a field worked at least once that year).
7. **Targets** (restated, reachable): first hand year 2–3; first owned parcel year 3–4; combine year
   4–6; 40–60 ha by year 8; net worth ≈ €400–600k by year 10. State milestones in real hours too
   (1 game year = 14.4 real hours at 1×; players will use 3×/10×).
8. The harness world must fit the 1024 m map (≈68 ha farmable). README numbers must reproduce from
   the documented default commands.

---
## Revision r4 (director, after critic r3) — integration ownership
1. **Contract market saturates.** The valley has a finite amount of contract work: total offers/day
   capped (≈6–8 incl. crew jobs), and crew-job pay falls as the player's share of the regional market
   grows (e.g. −30 % at 5+ concurrent crew jobs). Pure contracting must plateau regardless of crew size;
   the harness re-tests with 3/6/12 hands.
2. **Machines are reserved per job per day by category** (tractor, combine, trailer, implement kit).
3. **CAP on the worked share.** Simulation **listens to `crops:worked`** (payload must carry
   `{ fieldId, parcelId, tool, areaM2 }`, owner: crops) and credits worked m² per parcel; CAP pays
   `min(1, workedArea/parcelArea)` × rate. `recordFieldWork` stays for non-crop land but validates the
   parcel (owned/rented by the player), the operation name and the area. `hireContractor` rejects
   unknown ids. Contractors credit only the booked area.
4. **Contractor bookings change fields.** Owner: crops listens to `economy:contractor-done`
   (`{ parcelId|fieldId, operation, areaM2, crop? }`) and applies the operation to that area.
5. **Wages from real activity.** Owner: characters links each hired character to its worker record
   (`workerId` from `hireWorker`/`workers()`) and calls `simulation.logWork(workerId, hours, kind)` for
   game-hours spent active (possessed by the player, or on a work/job/goto task). Simulation pays the
   day rate on any day with ≥1 h logged or a delegated job worked, otherwise the retainer.
6. Insolvent farm with nothing left to seize: hands are laid off after 30 more days (event), and the
   bank offers a restructuring loan once; no infinite blocked state.
7. Delegated odd jobs require the hand to be awake/available (not sleeping) — simulation checks
   `characters` availability via an optional API `characters.isAvailable(workerId)` if present.

---
## Revision r4b (director decision on margin, 2026-09-27)
With contracting capped, the builder path reaches ≈ €300k net worth at year 10 (all other milestones met:
hand y2, parcel y3, combine y6, 44 ha y8). The €400–600k figure in r3 was a director guess, not a design
requirement. **Decision:** keep prices/CAP believable (no CAP €750, no +15 % grain) and revise the year-10
target to **€250–400k** for the builder path, with the ordering builder > renter > smallfarm > contractor > jobs
required at AI_WORK_FACTOR ×0.5–×2. Any later margin boost must come from gameplay (animals, better
machines/upgrades, storage timing), not from price inflation.

---
## Revision r4c (director, after critic r4)
The r4b ordering is **required only at AI_WORK_FACTOR ×1** (the shipped value). At ×0.5 and ×2 the harness must
still show builder > renter > smallfarm and builder > jobs; contractor vs jobs may swap (slow hands make pure
contracting weak — plausible). The €250–400k band applies at ×1. Harness prints must use these targets.
Characters owns availability: `isAvailable(workerId)` returns false while the hand is possessed by the player or
driving; simulation additionally skips any hour in which possessed time was logged for that hand.

---
## Revision r6 (director, 2026-10-03) — year-1 target for the live demo start
The r3 "€35–60k cash end of year 1" target assumed the harness's own start. From the live demo start (€17.7k cash,
0.6 ha owned, 1.8 ha rented, old kit, no hand) the target is **growth**: end of year 1 cash ≥ start + €5k for a
solo player and ≥ start + €10k for a player who hires a hand and delegates crew jobs, with net worth measured
after demo's cheap starting kit (demo r2.3). Current harness (`--start=demo`): solo €23k, with a hand €31k → met.
Known weakness (not a game bug): the scripted builder strategy can over-finance in years 4–5 on some seeds
(harvest-3 → €124k); the year-10 band holds on 6/8 seeds. Acceptable; revisit with the strategy script, not prices.
Job offers show `payPerUnit` + `callout` separately; ui should display both.

---
## Revision r7 (director, 2026-10-08) — the demo start must work
From the r3 demo start (0.25 ha first field) year-1 cash misses the r6 targets, mainly because the granted starting
buildings are booked as new (€4.55k/yr upkeep, €243k phantom net worth). Decisions:
1. **Granted assets can be old:** `grantAsset(item, { ageYears })` values them like the old kit (depreciated to the
   floor) and **upkeep scales with current value**, not list price. Demo grants the starting farmhouse/barn/shed/coop
   as ~40-year-old buildings (and the machines at 16 years, as now). Owners: simulation (API), demo (calls it).
2. **A guaranteed first job:** on game days 1–2 at least one player-sized field job the starting kit can do (plough
   or drill, ≤1 ha, near the farm) is offered. Owner: simulation. It is a hook and teaches the job loop.
3. Targets (r6) stay; re-measure with `--start=demo` after both.
