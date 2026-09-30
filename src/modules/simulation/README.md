# simulation — economy, land, jobs (wave 1)

A small Belgian farm economy: money and a ledger, a market with seasonal prices, loans, a
machinery catalog with dealer finance, hired hands, a land market where parcels come up to let or
for sale, and paid contract jobs from NPC neighbours. The logic has no DOM and no ctx (`sim.js` +
`economy.js`, `market.js`, `land.js`, `jobs.js`), so it can be fast-forwarded headlessly.
`index.js` connects it to ctx.

Files:
- `data.js`: all reference tables and tuning constants.
- `sim.js`: assembly, daily processing and fast-forward.
- `economy.js`, `market.js`, `land.js`, `jobs.js`, `contractors.js`: the logic.
- `work.js`: the r3 time model. It is the single source of field-work rates (`workRates()`).
- `strategy.js`: the standard valley and a scripted farm manager. It is used by the tests and by the showcase.
- `paint.js`, `icons.js`, `board.js`, `showcase.js`: the painted office board.
- `util.js`: a Node-side copy of the core RNG.
- `tests/progression.mjs` and `tests/exploits.mjs`: headless balance harnesses. They run under plain Node.

## Time and units
- 1 game year is 36 days (12 months × 3 days). Annual figures are divided by 36 per day.
- Money is in € with 2 decimals. Other units are tonnes, litres, eggs (`ea`) and kg. Area is in m² (`area`); labels show ha.
- Days are absolute day indices (`api.today()`), and the day of year is `day mod 36`.
- Daily processing runs once per new game day. It is triggered by `clock:day`, with a catch-up in `update`.
- The catch-up processes at most 72 days at once. Any days beyond that are skipped with a `ctx.warn`.

## r3 time model — READ THIS FIRST (vehicles, crops, characters)
- The clock runs at 60× (1 real second = 1 game minute).
- **The player's own driving is real-time physics.** A 3 m plough at 8 km/h × 0.8 field efficiency covers 1.92 ha per **real** hour, which is 0.032 ha per game hour.
- **Hired hands and contractors work abstractly.** Their rate is the physical rate per **game** hour × `AI_WORK_FACTOR` (0.25). A t1 plough is then 0.48 ha per game hour, about 4.8 ha per 10-hour game day.
- The player can only work small areas. **Hands are how the farm scales.**
- `workRates()` is the single source for all of these numbers. Jobs, the harness, and the vehicles/characters AI should all read it.

`workRates()` returns:
```
{ clockScale: 60, aiWorkFactor: 0.25, hoursPerDay: 10,            // hands/contractors work 10 game-h per game day
  fieldEff: 0.8,
  kit:  { plough:{widthM:[3,4.2,6], kmh:[8,8,8]}, cultivate:{widthM:[3,4,6],kmh:[10,10,10]},
          sow:{widthM:[3,4,6],kmh:[10,10,10]}, spray:{widthM:18,kmh:10,eff:0.6}, mow:{widthM:3,kmh:12},
          harvest:{combine_s:{widthM:4.5,kmh:5}, combine_l:{widthM:7.5,kmh:6}}, lift:{widthM:1.5,kmh:5,eff:0.7},
          bale:{widthM:3,kmh:12,eff:0.8}, haul:{trailerT:14, kmh:25, loadH:0.05} },
  physical: { op: ha per REAL hour, [t1,t2,t3] for plough/cultivate/sow (tier = tractor tier), number for others },
  ai:       { op: ha per GAME hour for a hand/contractor  (= physical × aiWorkFactor) },
  player:   { op: ha per GAME hour for the player driving (= physical / clockScale) },
  contractor: { op: { perHa €, leadDays:[min,max], peakLeadDays:[min,max], peakMonths:[...] } },
  plough: [...], sow: [...], mow: [...],   // legacy: AI game-hours per ha by tier
}
```
Ops: `plough cultivate sow spray mow harvest lift bale`. `harvest` means cereals/rapeseed/maize with a combine. `lift` means sugar beet/potatoes with the root harvester.

## API (all via `ctx.modules.get('simulation')`)
Everything from r2 still works. New in r3 are marked **(r3)**.

**Money**
- `money()`, `canAfford(x)`.
- `charge(amount, category, memo, opts?)` → bool. It refuses when money is short, unless `opts.force`.
- `credit(amount, category, memo)`.
- `ledger(n)`, `summary(periodDays)` → `{income, expenses, net, operating*, byCategory}`.
- `netWorth()` → `{cash, land, machinery, buildings, stock, debt, total}`. **(r6)** `buildings` is the value of owned assets in the buildings book; `machinery` no longer includes them.
- **Ledger categories (r6).** Capital and financing categories are excluded from the operating P&L (`summary().operating*`) and so from the income part of the credit limit: `loan`, `loanRepay`, `land`, `landSale`, `machinery`, `buildings`, `assetSale`, `writeOff` (exported as `CAPITAL_CATEGORIES`). Everything else (`sales`, `jobs`, `subsidy`, `rent`, `wages`, `interest`, `upkeep`, `lease`, `insurance`, `fuel`, `seed`, `fertiliser`, `spray`, `contractor`, `penalty`, `misc` …) is operating.

**Market**
- `price(item, sellPointId?)` → € per unit, or `undefined` when that buyer doesn't take the item.
- `priceHistory(item)`.
- `sell(item, qty, sellPointId?)` → € received. **(r3)** It always sells from farm inventory. The old `fromInventory:false` option is ignored, because that path created money from goods the farm didn't have. Producers such as animals and crops call `addInventory` first, then `sell`.
- `buy(item, qty)`.
- `defineSellPoint(id, {name, x, y, accepts, bias})`, `sellPoints()`.
- **(r5)** `removeSellPoint(id)` → bool. A demolished shop, co-op or dairy stops buying; buildings calls it.
- `yieldTable()`, `inputCost(crop)`, `buyInputs(crop, ha, parts?)`.

**Inventory / storage**
- `inventory()`, `addInventory(item, qty)` → stored qty, `removeInventory`, `setCapacity(item, qty|null)`, `storageRoom(item)`.
- **(r3)** Bulk crops (wheat, barley, oats, rapeseed, maize) share one farm store. The old barn holds 80 t. Buying the catalog items `grain_store` (+400 t) or `grain_store_l` (+1000 t) raises it. `bulkRoom()` → t free.

**Catalog / assets**
- `registerCatalogItem`, `catalog(category?)`, `lease(id)`, `grantAsset(id, {boughtDay?, category?})`, `assets()`.
- `purchase(id, {finance?, category?})` → bool. Finance means 25 % down and a 5-year loan secured on the machine.
- `releaseAsset(assetId, {writeOff?})` → € net. **(r3)** A financed machine's loan is repaid from the sale proceeds first.
- **(r6) Two capital books.** Every owned asset carries `book: 'machinery' | 'buildings'` (see `assets()`).
  - An asset is in the **buildings** book when bought/granted with `{category: 'buildings'}`, or when its catalog entry has `meta.building` (every item the buildings module registers). Everything else stays **machinery** (unchanged).
  - Buildings: the purchase is booked under ledger category `buildings` (capital — it does not lower the operating P&L or the income part of the credit limit). Value = 80 % of cost once built, −2 % of cost per year, floor 30 % (machinery: 90 %, −5 %/yr, floor 20 %). Shown as `netWorth().buildings`.
  - **Collateral:** the credit limit counts 60 % of land, 50 % of machinery and **40 % of building value** (a building is harder to sell on than land or a machine). Dealer finance on a building uses the 40 % rate too.
  - A sale books `assetSale` ("Sold <name>"); upkeep stays the catalog default (1.5 % of cost per year, `upkeep`).
- **(r6) `releaseAsset(id, {writeOff: true})`** — demolish/scrap without a sale: the asset is removed, **no cash moves**, and one ledger line is booked: `{category: 'writeOff', amount: 0, bookValue, memo: 'Demolished <name> — €… book value written off'}` (an `economy:transaction` event with `writeOff` category, `assetId`, `book`). Returns 0. Loans secured on the asset are not settled (still owed). Use it for granted buildings (no resale) instead of sale + charge-back.
- **(r3)** New catalog entries:
  - `root_harvester` (category `harvester`, beet/potato lifter, €68k);
  - `baler` (category `baler`, €30k);
  - `cultivator` (category `cultivator`, €12k);
  - `grain_store` and `grain_store_l` (category `storage`, `meta.capacity` in t).

**Contractors (r3, validated in r4)**
- `contractorQuote(parcelId, op, {ha | areaM2, fieldId?, crop?})` → `{parcelId, fieldId, crop, op, ha, areaM2, price, leadDays, days}`. It returns null when the op is unknown, or the parcel is unknown or not owned/rented by the player.
- `hireContractor(parcelId, op, {ha | areaM2, fieldId?, crop?})` books the work and returns the booking, or null.
  - The area is capped at the parcel. The price has an €80 minimum.
  - The booking is paid when made.
  - Work starts after the lead time, which is longer in peak months, and takes `ha / (ai rate × hoursPerDay)` days.
  - When done it emits **`economy:contractor-done {parcelId, fieldId, operation, areaM2, crop, bookingId, booking}`**. crops applies `operation` to `areaM2` of that field or parcel.
  - CAP is credited for the **booked area only**.
- `contractorBookings(status?)`, `cancelContractor(id)`. Cancelling gives a full refund before `startDay`; after that it is refused.
- Prices (€/ha): plough 110, cultivate 65, sow 75, spray 28 (per pass), mow 60, harvest 180, lift 430, bale 55. Contractors bring tier-3 kit.

**Field work & CAP (r4: the worked share)**
- **The module listens to `crops:worked {fieldId, parcelId, tool, areaM2}`** and credits the worked m² to the parcel. This only counts when the player owns or rents the parcel.
  - **r4c:** events with `contractor: true` are ignored. The booking already credited its area when `economy:contractor-done` fired, so each area counts once.
- `recordFieldWork(parcelId, op, {areaM2, workerId?, hours?})` → bool. It is for land that is not a crops field. It returns false when:
  - the parcel is not owned/rented by the player;
  - `op` is not one of `plough cultivate sow seed spray fertilise spread mow harvest lift bale rake ted roll hoe weed mulch plant graze`;
  - `areaM2` is invalid;
  - **(r4c)** the parcel has crops fields (crops reports those through `crops:worked`, or `crops.fields()` lists one).

  The area credited per call is capped at the parcel. With `workerId` + `hours` it also calls `logWork(…, 'field')`. It is meant for trusted callers and only for land without crops fields.
- **CAP** is €450/ha-year, paid on 1 October. For each parcel it pays: days held / 36 × ha × **min(1, best-covered operation's worked m² / parcel m²)**.
  - Several ops don't add up: one full ploughing = 100 %.
  - The share resets on rent, buy, lease end or sale, and every CAP day.
- `capShare(parcelId)` → 0..1, the share so far this CAP year.

**Workers / hands (r4 wage model)**
- `hireWorker(name?)` → `{id, name, dayRate, retainer, wage (=dayRate), skill}`. Day rates are €150–220; the retainer is €35.
- **`logWork(workerId, gameHours, kind?)`** → hours logged today. `kind` is e.g. `'possessed' | 'task' | 'job' | 'field'`.
  - characters calls it for game hours a hired character is active (possessed, or on a work/job/goto task).
  - Unknown ids are ignored.
- Settlement happens at the start of the next day:
  - **any day with ≥ 1 h logged, or a delegated job worked → the full day rate;**
  - otherwise → the retainer.
- **(r4c)** In any hour in which `logWork(…, 'possessed')` was logged for a hand, he does not work his delegated jobs.
  - characters also returns `isAvailable(workerId) === false` while the hand is possessed or driving.
  - Any `false` counts as unavailable.
- **(r4c)** `workerDayCost(workerId)` → `{dayRate, retainer, hoursToday, onTheClock, costToday, extraIfUsed}`.
  - It is meant for the UI: "Dries is on the clock today".
  - Possessing a hand for even 1 game hour puts him on the clock; `extraIfUsed` is what that costs on an idle day.
- `fireWorker(id)` releases the hand's delegated jobs back to the player.
- `workers()` → each also carries `hoursToday`, `daysWorked`, `kinds` (hours by kind today) and `assignedJobs`.

**Machines (r4)**
- Machines are **reserved per game day by category**: `tractor`, `combine`, `harvester`, `trailer`, `tillage`, `sprayer`, `mower`, `baler`, `cultivator`, ….
- `reserveMachine(category, holderId)` → true if a unit is free today and is now held by `holderId`. The same holder keeps it all day.
- `machinesFree(category)` → units still free today.
- Delegated jobs book their machines through the same ledger: one tractor per hand, plus the job's implement or the combine. With one combine, only one hand combines that day.

**Jobs (r3, r4 market)**
- Every job has world coordinates `x, y` (and `to.x/to.y`). The site is resolved in this order:
  1. a parcel;
  2. the client's farm (`defineClientFarm`, or a parcel the client owns);
  3. a deterministic point inside `world.bounds`.
- **Player-sized offers** take about 5–20 real minutes. **Crew-sized offers** (`crew: true`) take about 1–2 hand-days. Each carries `estPlayerMin` / `estAiHours`.
- **r4 — the contract market saturates:**
  - 2–4 offers a day, +1.2 per hand only **up to 3 hands**, at most **7 a day**;
  - at most 8 + 2 × min(hands, 3) open at once;
  - **crew-job pay drops 6 % for each crew job the farm already holds** (accepted, or finished in the last 2 days), down to −30 %.
- `assignJob(jobId, assigneeId|null)`:
  - **A hired-hand id → the simulation works the job itself at the AI rate.**
    - In the live game this happens hour by hour from 07:00 to 17:00, only while `characters.isAvailable(workerId)` is not false (the call is optional).
    - In the headless harness it happens once a day.
    - For such jobs, external `reportProgress`/`tickPresence` calls are ignored, so there is one owner per job.
    - **(r5)** If the hand is possessed that hour, or `isAvailable` is false, he skips the job.
      - On the job's deadline day it is **handed back to the player** (`assignee: null`) instead of silently failing.
      - The module emits `jobs:reassigned {job, jobId, workerId, reason: 'hand-possessed' | 'hand-unavailable'}`.
      - It shows a ui toast when ui is present, e.g. "Dries couldn't get to … — it's back on your list, due today".
  - Any other id only records the assignee, and the caller reports progress.
  - `null` gives the job back to the player.
- `activeJobCap()` → 2 + hired hands.
- `defineClientFarm(name, {x, y})`.
- `jobs(filter)`, `acceptJob`, `reportProgress`, `tickPresence`, `completeJob`, `failJob`, `reputation()`.

**Loans & insolvency (r3, end state r4)**
- `takeLoan`, `repayLoan`, `loans()`.
- `creditLimit()`: an overdraft counts as debt.
- `solvency()` → `{overLimit, daysOverLimit, blocked, overdraft, creditLimit, restructured, bankrupt}`.
- Stages while over the limit:
  - **30 days:** purchases, land deals, hires and contractor bookings are blocked.
  - **60 days, one settlement day (r5):**
    - The bank sells, least valuable first, until the farm is back under its limit: machines at 85 % (secured loans repaid), then stored produce at 85 % of the quote and **diesel and fertiliser at 50 %**, then land.
    - Each sale emits `economy:asset-seized`.
    - If that is not enough, the hands are laid off (`economy:hands-laid-off {names}`) and the overdraft is restructured the same day. In r4 this took up to about 93 days.
  - **Countdowns (r5):** `solvency()` also returns `daysToBlock`, `daysToSettlement` and `nextStage` (`'blocked' | 'settlement' | 'bankrupt'`, or null when not over the limit), for a UI countdown.
  - **Restructuring (once, r4c, sized to the farm):**
    - Instalments are at most ⅓ of last year's operating result, with a minimum of €150 a month.
    - The loan runs up to 20 years at 6 %, with 6 months' grace.
    - Whatever that annuity cannot carry is **written off**.
    - `bankrupt-warning {stage:'restructured', loan, months, writeOff}`.
  - **Over the limit again with nothing left:** `stage:'bankrupt'`.
    - All leases are handed back without the exit fee, so rent stops.
    - The farm stays blocked while cash is negative, and is unblocked once cash is positive again.
    - The UI should show this as the farm has gone bankrupt, with an offer to start again or to carry on with odd jobs.
- Selling a mortgaged parcel or a financed machine repays its loan from the proceeds first.

**Land**
- `defineParcel`, `parcels()`, `parcel(id)`, `parcelAt`, `canUse`, `landMarket()`.
- `buyParcel(id, {mortgage})`, `rentParcel`, `leaseExitCost`, `endLease`, `sellParcel`. These are as in r2, plus the loan settlement above.

`today()` → the economy's absolute day index.

## Daily processing (order)
1. **Market.** The price walk runs and gluts recover (×0.7 per day).
2. **Delegated jobs (harness only).** Hands work their assigned jobs with the hours they did not log yesterday. In the live game this happens hourly instead (see Jobs).
3. **Land.** Rent that is due is charged (monthly, in advance). CAP days accrue. On 1 October, CAP is paid on the worked share. Each month the land index moves and listings come and go.
4. **Contractors.** Bookings start; finished ones emit `economy:contractor-done`.
5. **Wages.** Yesterday settles into wages: ≥ 1 h logged, or a delegated job worked, pays the full day rate; otherwise the €35 retainer.
6. **Upkeep and leases** are charged.
7. **Loans.** Interest is charged every day; instalments are due monthly.
8. **Overheads** are charged monthly (€85 + €5/ha).
9. **Overdraft and insolvency.** Overdraft interest is 12 %/yr, and the insolvency stages run.
   - `economy:bankrupt-warning` is emitted with `stage`, one of `overdraft | warning | blocked | seizure | restructured | bankrupt`.
10. **Jobs.** Expiry and failures are processed, then new offers (the saturating market, see Jobs).

## Price model
The reference price is base × seasonal(day of year) × exp(own walk + weight × shared grain factor).
- **Seasonal curve.** Storable crops follow a carry curve: lowest just after harvest (−7 % for wheat), highest a few weeks before the next harvest (+7 %).
- **Random walk.** A daily log-space Ornstein–Uhlenbeck walk (θ ≈ 0.07/day).
- **Sell points.** Each has its own bias (±3.5 %) and ±0.9 % daily jitter.
- **Saturation.** It is per buyer and per item, and lowers the price by up to −25 %. The drop is integrated over the lot, and a glut recovers in about 2 days.

In the harness, dumping 600 t of wheat at one buyer fetched €156/t. Spreading it over 2 buyers and 3 days fetched €166/t.

## Events
- `economy:transaction`: each entry, plus `item/qty/unit/sellPointId` on sales.
- `economy:price-changed {day, prices}`: daily.
- `economy:bankrupt-warning {money, daysNegative, daysOverLimit, stage, creditLimit}`.
- `economy:contractor-done {parcelId, fieldId, operation, areaM2, crop, bookingId, booking}`: a contractor finished. **crops applies it to that area.**
- `economy:hands-laid-off {names, reason}`.
- `jobs:reassigned {job, jobId, workerId, reason}` (r5): a delegated job was handed back to the player.
- `economy:asset-seized {kind:'machine'|'land', id, name, amount}`.
- Listens to `clock:day`, `clock:hour` (delegated jobs in working hours) and `crops:worked` (CAP share).
- `land:parcel-changed {id, state, from, parcel}`.
- `jobs:offered | jobs:accepted | jobs:completed | jobs:failed`: a copy of the job.

## Balance — reproducible, headless (r4)
```
node src/modules/simulation/tests/progression.mjs                 # defaults: 10 years × 8 seeds, AI_WORK_FACTOR 0.25, max 3 hands
node src/modules/simulation/tests/progression.mjs 10 8 --ai=0.5   # sensitivity
node src/modules/simulation/tests/progression.mjs 10 8 --ai=2
node src/modules/simulation/tests/progression.mjs 10 8 --hands=12 # lift the hand cap
node src/modules/simulation/tests/exploits.mjs                    # defaults: 8 seeds (probes + contracting-company table)
```
Every number below comes from those commands. Both harnesses run the real module code through the **public API only**:
- `hireContractor`, `recordFieldWork({areaM2})`, `logWork`, `reserveMachine` / `machinesFree`;
- `hireWorker`, `assignJob`, `acceptJob`, `reportProgress`, `tickPresence`;
- `purchase({finance})`, `buyParcel({mortgage})`, `rentParcel`, `buyInputs`, `buy` / `sell` / `addInventory`, `takeLoan`.

The r3 off-API "inputs on credit" path is gone. Short of cash, the harness sells stock and draws on the credit line; otherwise the field stays fallow.

The harness itself supplies only what crops will do in the game: tonnes at harvest, from the yield table × the same soil factor as crops (0.9 + 0.25 × soil) × timeliness × noise.

**World and start.** The valley is 81 ha in 37 parcels inside the 1024 m map. The player starts with:
- a 0.6 ha yard and 1.2 ha rented;
- €18k;
- a t1 tractor, a plough/drill and a trailer.

**Time model.**
- The player has 14 game hours a day at `workRates().player`.
- Hands work 10 game hours a day at `.ai`. Each hand reserves one tractor plus the implement or combine for the day.

### r4.1 — contracting saturates (`exploits.mjs`)
A pure contracting company: every hand gets his own t1 tractor, plough/drill and trailer. A greedy loop accepts every offer it can and delegates it. Figures are year 3, median of 8 seeds:

| hands | contract income | wages | operating net |
|---|---|---|---|
| 3 | €37.1k | €21.6k | **€12.2k** |
| 6 | €48.8k | €37.5k | €5.6k |
| 12 | €49.9k | €48.0k | **−€9.0k** |

In r3 the same test gave €18k / €32k / €56k. It plateaus now because of three limits together:
- offers stop growing after 3 hands;
- at most 7 new offers a day;
- crew pay falls 6 % per crew job already held (floor −30 %).

With the scripted contractor strategy allowed up to 12 hands (`--hands=12`), it still hires only 3, because more don't pay: €112k net worth at Y10.

### Results (default run, median of 8 seeds)

Net worth:

| year | jobs | contractor | smallfarm | renter | builder |
|---|---|---|---|---|---|
| 1 | €51k | €51k | €51k | €51k | €51k |
| 2 | €54k | €55k | €60k | €52k | €53k (19 ha, 2 hands) |
| 4 | €61k | €63k | €81k | €84k | €96k (30 ha, 4.0 owned) |
| 6 | €75k | €79k | €112k | €134k | €152k (38 ha, 5.2 owned) |
| 8 | €86k | €95k | €147k | €180k | €214k (43 ha, 7.9 owned) |
| 10 | €98k | €112k | €176k | €243k | **€303k** (51 ha, 11.9 owned, 3 hands) |

The builder, year by year:

| builder | Y1 | Y2 | Y3 | Y4 | Y6 | Y8 | Y10 |
|---|---|---|---|---|---|---|---|
| contract jobs € | 6k | 16k | 20k | 20k | 20k | 19k | 22k |
| crops + CAP € | 4k | 19k | 43k | 55k | 84k | 90k | 115k |
| wages € | 0 | 7k | 10k | 10k | 11k | 11k | 12k |
| operating net € | 6k | 13k | 22k | 28k | 41k | 41k | 53k |

**Farming is now the growth engine.**
- Contract work settles at about €20k a year for any strategy with hands.
- The builder's farm adds €20–33k of operating result on top from year 4.
- Ranking: builder > renter > smallfarm > contractor > jobs.
- Owning beats renting: the same 4 ha field owned on a mortgage instead of rented is ahead by +€11k after 3 years, +€43k after 10 and +€70k after 15 (8/8 seeds).

### Targets (builder; r3 milestones, r4b/r4c band and ordering)
Printed at the end of each `progression.mjs` run.

| target | result at AI ×1 (default) |
|---|---|
| first hand year 2–3 | median year 2; 2+ hands by Y8 in 8/8 seeds |
| first owned parcel year 3–4 | median year 3 |
| combine year 4–6 | median year 6 |
| 40–60 ha by year 8 | median 43.6 ha, 8/8 in range |
| **net worth €250–400k at year 10** (r4b) | median €303k, **8/8 in range** ✔ |
| **builder > renter > smallfarm > contractor > jobs** (r4c, required at ×1) | €303k > €243k > €176k > €112k > €98k ✔ |

Each run prints the rule for its own factor. At ×1 the strict chain is required; at ×0.5 and ×2 it prints the relaxed rule with ✔ or ✘.

**Sensitivity** (`--ai=0.5` / `--ai=2`). At these factors r4c relaxes the rule: builder > renter > smallfarm and builder > jobs must still hold, but contractor vs jobs may swap.

| factor | jobs | contractor | smallfarm | renter | builder | full order | relaxed rule |
|---|---|---|---|---|---|---|---|
| ×0.5 | €98k | €78k | €170k | €195k | €246k | no (contractor < jobs) | ✔ |
| ×1 | €98k | €112k | €176k | €243k | €303k | ✔ | ✔ |
| ×2 | €98k | €123k | €180k | €269k | €318k | ✔ | ✔ |

No tuning was needed for r4c.

### Pace in real hours (1 game year = 14.4 h at 1×, 4.8 h at 3×)
| builder median | game time | real hours at 1× | at 3× |
|---|---|---|---|
| first hand | year 2 | ≈ 15–29 h | 5–10 h |
| first owned parcel | year 3 | ≈ 29–43 h | 10–14 h |
| combine | year 6 | ≈ 72–86 h | 24–29 h |
| €300k, 51 ha, 3 hands | year 10 | ≈ 144 h | 48 h |

Fast-forwarding does not skip the economy: costs are per game day, CAP needs worked area, and hands work per game day.

### 5 ha self-check
5 ha of rented wheat, contractors do all the work, no jobs. Over 24 seed-years the operating net is:
- mean **+€2,452/yr**, median €2,878;
- mean per year: sales €9.2k, CAP €2.3k, rent −€2.6k, inputs −€1.8k, contractors −€2.5k.

### Exploit probes (`exploits.mjs`, default 8 seeds: 31/31 closed)
| probe | median | verdict |
|---|---|---|
| **r5 credit line → diesel before insolvency** (42,355 l bought on the whole credit line, then a −€120k shock) | 0 l kept; diesel seized at 50 % in the settlement | closed |
| **r5 delegated job, hand possessed on the deadline day** | handed back (`assignee: null`), `jobs:reassigned {reason:'hand-possessed'}` | clear, not a silent failure |
| **r4 CAP double count**: book half a parcel, then crops echoes `crops:worked {contractor:true}` | share 0.50 → 0.50 | closed (one owner: the booking) |
| **r4 `recordFieldWork` backdoor**: area 10¹² on a parcel crops reports for | refused, share 0.009 | closed |
| **r4 possessed hand also works his delegated job** | 0 progress while possessed, 0.15 the next hour | closed |
| **r4 insolvency end state**: −€250k shock, 1 lease, 60 t in store, 4 years | stock seized → restructured at the day-60 settlement (€21k over 140 months, €256k written off); not bankrupt, unblocked | a serviceable second chance |
| **r3 CAP bought for €80** (0.01 ha spray bookings on never-farmed land) | CAP €5 for €160 of bookings | closed (CAP = worked share) |
| **r3 `recordFieldWork`** on a neighbour's parcel / op `'dance'`; `hireContractor` on `'no-such-parcel'` or a neighbour's parcel | all refused | closed |
| **r3 one combine, 3 hands, 3 combine jobs the same day** | 1 of 3 progressed | closed (per-day machine reservation) |
| **r3 insolvent with nothing to seize** (3 idle hands, −€125k, 150 days) | hands laid off, restructured once | closed (no endless block; a second time is `bankrupt`) |
| r1 CAP flip (15.3 ha for 2 days, even while reporting field work) | −€2,892 | no gain |
| land-banking / mortgage flip / finance flip / selling goods not held | €0 CAP / −€2.1k / −€6.4k / €0 | closed |
| insolvent farm asks for a loan | refused; blocked; machines seized | closed |
| carry trade / land held a year unfarmed | −€596 / −€7 | lose on average (market risk) |
| others (diesel dump, −50 % loan, combine resale, fail-spam, hire/fire, contractor cancel, idle hand) | — | no gain |

## Showcase
The showcase has no deps. `stage` resets the economy and plays the **builder** strategy on the standard valley, with `ctx.rng('showcase-farmer')`. It runs from 1 March of year 1 to mid-September of **year 5**, using the same code as the tables above.

The result is painted on the `screen` layer as a cork office board. It is cached and rebuilt only when the economy version, the day or the size changes. Each frame adds only a dusk tint and a night darkening with a desk-lamp pool.

Presets (all day 25 = mid September):
- `default`: ledger, price sheet, valley map, 3 job cards, 12-month P&L.
- `market`: 6 commodity charts; quotes from all 6 buyers (two lines each); the store valuation.
- `jobs`: 9 job cards, including crew-sized ones worked by hands; the contract book; the farm card with hands and day rates.
- `land`: a large valley map and the land register.

## Known limitations
- The net-worth band was revised to €250–400k (r4b). The builder's €303k meets it at ×1. At ×0.5, pure contracting (€78k) falls below jobs-only (€98k), which r4c allows.
- **Restructuring writes off everything a farm without income cannot carry** (e.g. €256k in the probe). Everything else is seized first: machines, stock (diesel and fertiliser at 50 %), land, and the hands are laid off. So it is a hard reset, not a shortcut.
- **The live game depends on other modules:**
  - `crops:worked` must carry `parcelId` + `areaM2` for CAP;
  - characters must call `logWork` for the hands' own activity;
  - crops must apply `economy:contractor-done`.

  The simulation side of all three is verified live: a 0.5 ha contractor booking gave `capShare` 0.26; a delegated "Mind livestock, 8 h" job was worked hourly and paid the €180 day rate; characters' `logWork(…, 'task')` paid a day.
- **`isAvailable` is optional.** Without a characters API, hands count as available.
- **The machine ledger only knows machines owned in the simulation catalog.** vehicles' own spawned machines are not reserved unless they share those catalog ids.
- **Game-scale economy:**
  - CAP €450/ha;
  - seed/fertiliser/spray about 45 % below Belgian averages;
  - rent €450–650/ha;
  - used compact combine €92k.
- **Delegated jobs are worked abstractly.** Nothing checks that the hand's character is on site beyond `isAvailable`.
- **The harness farm manager is heuristic.** Its hiring and land rules are sensible, not optimal.
