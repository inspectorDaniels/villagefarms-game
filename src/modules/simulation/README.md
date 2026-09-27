# simulation — economy, land, jobs (wave 1)

A small Belgian farm economy: money and a ledger, a market with seasonal prices, loans, a
machinery catalog with dealer finance, hired hands, a land market where parcels come up to let or
for sale, and paid contract jobs from NPC neighbours. The logic has no DOM and no ctx (`sim.js` +
`economy.js`, `market.js`, `land.js`, `jobs.js`), so it can be fast-forwarded headlessly.
`index.js` connects it to ctx.

Files:
- `data.js`: all reference tables and tuning constants.
- `sim.js`: assembly, daily processing and fast-forward.
- `economy.js`, `market.js`, `land.js`, `jobs.js`: the logic.
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
- `netWorth()` → `{cash, land, machinery, stock, debt, total}`.

**Market**
- `price(item, sellPointId?)` → € per unit, or `undefined` when that buyer doesn't take the item.
- `priceHistory(item)`.
- `sell(item, qty, sellPointId?)` → € received. **(r3)** It always sells from farm inventory. The old `fromInventory:false` option is ignored, because that path created money from goods the farm didn't have. Producers such as animals and crops call `addInventory` first, then `sell`.
- `buy(item, qty)`.
- `defineSellPoint(id, {name, x, y, accepts, bias})`, `sellPoints()`.
- `yieldTable()`, `inputCost(crop)`, `buyInputs(crop, ha, parts?)`.

**Inventory / storage**
- `inventory()`, `addInventory(item, qty)` → stored qty, `removeInventory`, `setCapacity(item, qty|null)`, `storageRoom(item)`.
- **(r3)** Bulk crops (wheat, barley, oats, rapeseed, maize) share one farm store. The old barn holds 80 t. Buying the catalog items `grain_store` (+400 t) or `grain_store_l` (+1000 t) raises it. `bulkRoom()` → t free.

**Catalog / assets**
- `registerCatalogItem`, `catalog(category?)`, `lease(id)`, `grantAsset(id)`, `assets()`.
- `purchase(id, {finance?})` → bool. Finance means 25 % down and a 5-year loan secured on the machine.
- `releaseAsset(assetId)` → € net. **(r3)** A financed machine's loan is repaid from the sale proceeds first.
- **(r3)** New catalog entries:
  - `root_harvester` (category `harvester`, beet/potato lifter, €68k);
  - `baler` (category `baler`, €30k);
  - `cultivator` (category `cultivator`, €12k);
  - `grain_store` and `grain_store_l` (category `storage`, `meta.capacity` in t).

**Contractors (r3)**
- `contractorQuote(parcelId, op)` → `{parcelId, op, ha, price, leadDays, days}`, or null when the op or parcel is unknown.
- `hireContractor(parcelId, op)` → booking `{id, parcelId, op, ha, price, bookedDay, startDay, doneDay, status:'booked'}`, or null if you can't pay or the purchase is blocked.
  - The booking is paid when made.
  - The work starts after the lead time, which is longer in peak months, and takes `ha / (ai rate × hoursPerDay)` days.
  - When it is done it emits `economy:contractor-done {booking}`. **The crops module should apply the operation to the parcel's fields on that event.**
  - Completion also counts as field work for CAP.
- `contractorBookings(status?)`, `cancelContractor(id)`. Cancelling refunds in full before `startDay`; after that it is refused.
- Prices (€/ha): plough 110, cultivate 65, sow 75, spray 28 (per pass), mow 60, harvest 170, lift 430, bale 55.

**Field work & CAP (r3)**
- `recordFieldWork(parcelId, op, {workerId?, hours?})`. Call it whenever a field operation is done on a parcel, by the player, a hand or anything else. It marks the parcel as worked this CAP year. With `workerId` + `hours`, it also logs the hand's paid hours.
- **CAP pays only on parcels worked at least once since the last CAP day.** It is paid pro rata by days held, on 1 October, at €450/ha-year.

**Workers / hands (r3 wage model)**
- `hireWorker(name?)` → `{id, name, dayRate, retainer, wage (=dayRate), skill}`. `dayRate` is €150–220 per game day worked; the retainer is €35 per idle day.
- `logWork(workerId, gameHours)` records hours a hand worked today. The characters/vehicles AI and the harness call it.
- Settlement happens at the start of the next day:
  - ≥ 5 h worked → full `dayRate`;
  - some work → half the `dayRate`;
  - none → the retainer.
- `fireWorker(id)`, `workers()` → each also carries `hoursToday` and `assignedJobs`.

**Jobs (r3)**
- Every job has world coordinates `x, y` (and `to.x/to.y`). The site is resolved in this order:
  1. a parcel;
  2. the client's farm (`defineClientFarm`, or the centroid of a parcel the client owns);
  3. a deterministic point inside `world.bounds`.
- **Player-sized offers** take about 5–20 **real** minutes for the player. The area comes from `workRates().physical` and the player's best machine for that job. Presence jobs last 4–12 game hours. Transport is one trailer load.
- **Crew-sized offers** (`crew: true`) take about 1–2 hand-days at the AI rate. They are meant for delegation.
- Each job also carries:
  - `estPlayerMin`: real minutes if the player does it;
  - `estAiHours`: game hours for a hand;
  - pay: machine rate × area, plus a call-out fee.
- `assignJob(jobId, assigneeId|null)` → bool. Pass a hired-hand id from `workers()` to delegate. **The simulation itself then works the job at the AI rate**, each game day, with the hand's hours not already logged that day and a free owned machine of the required category. `null` hands the job back to the player. Any other id (e.g. a character id) only records the assignee; the caller then reports progress.
- `activeJobCap()` → 2 + hired hands. `acceptJob` refuses beyond it.
- `defineClientFarm(name, {x, y})` places a client's farm.
- `jobs(filter)`, `acceptJob`, `reportProgress`, `tickPresence`, `completeJob`, `failJob`, `reputation()` work as in r2.

**Loans & insolvency (r3)**
- `takeLoan(amount, {months, rate})`, `repayLoan`, `loans()`.
- `creditLimit()`: an overdraft (negative cash) counts as debt. No new loans can be taken while over the limit.
- `solvency()` → `{overLimit, daysOverLimit, blocked, overdraft, creditLimit}`. When `money < 0` and the overdraft exceeds the headroom:
  - **30 days over the limit:** purchases, land deals, rentals, hires and contractor bookings are blocked (they return false/null), and `economy:bankrupt-warning {stage:'blocked'}` is emitted.
  - **60 days over the limit:** the bank sells the least valuable asset (machines first, then land) at 85 % of value, repaying its secured loan first. It repeats every 3 days while still over the limit, and emits `economy:asset-seized`.
- Selling a mortgaged parcel (`sellParcel`) repays its mortgage from the proceeds first.

**Land**
- `defineParcel`, `parcels()`, `parcel(id)`, `parcelAt`, `canUse`, `landMarket()`.
- `buyParcel(id, {mortgage})`, `rentParcel`, `leaseExitCost`, `endLease`, `sellParcel`. These are as in r2, plus the loan settlement above.

`today()` → the economy's absolute day index.

## Daily processing (order)
1. The market walk runs and gluts recover (×0.7 per day).
2. Rent that is due is charged (monthly, in advance). CAP ha-days accrue, and CAP is paid on 1 October. Monthly, the land index moves and listings come and go.
3. Wages, upkeep and leases are charged.
4. Loan interest is charged, and instalments monthly.
5. Monthly overheads are charged (€85 + €5/ha).
6. On a negative balance: overdraft interest at 12 %/yr and `economy:bankrupt-warning`.
7. Job expiry and failures, then new offers.

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
- `economy:bankrupt-warning {money, daysNegative, creditLimit}`.
- `land:parcel-changed {id, state, from, parcel}`.
- `jobs:offered | jobs:accepted | jobs:completed | jobs:failed`: a copy of the job.
- Listens to `clock:day`.

## Balance — reproducible, headless
```
node src/modules/simulation/tests/progression.mjs [years=10] [seeds=8]   # strategies × seeds, ≈ 4 s
node src/modules/simulation/tests/exploits.mjs [seeds=8]                 # min-max probes
```
Both run the real module code (`sim.js` and the rest) through its public API, on the standard valley (`defineValley`):
- 157 ha in 49 parcels;
- the player starts with a 0.6 ha yard (owned) and 1.8 ha rented;
- €18k and a used 95 hp tractor, a plough and drill, and a trailer.

The farm manager (`strategy.js`) models:
- crew hours (12 h per person per game day);
- work windows;
- machine work rates by tractor tier;
- contractors (with a −4 %/−7 % timeliness loss) when the crew is short;
- a 5-crop rotation;
- selling spread over buyers and days.

Contract jobs compete with farm work for the same hours.

The strategies:
- **jobs**: a greedy contractor that takes every contract it can do and never invests.
- **contractor**: picks the best-paying contracts and never grows the farm.
- **smallfarm**: rents up to about 12 ha with the starter tractor.
- **renter**: rents whatever the crew can work, never buys land, and buys machinery on dealer finance.
- **builder**: the intended path. Year 1 is contract work only. After that it rents, buys land on a 75 % mortgage when it can pay the deposit, and buys machinery on finance.

Results, median over 8 seeds (net worth = cash + land + machinery + stock − debt):

| game year | jobs | contractor | smallfarm | renter | builder |
|---|---|---|---|---|---|
| 1 | €64k | €64k | €64k (11 ha) | €58k (14 ha) | €63k (2.4 ha) |
| 2 | €82k | €82k | €86k | €75k (33 ha) | €79k (20 ha, 3.2 owned) |
| 4 | €119k | €119k | €140k | €128k (45 ha) | €136k (37 ha, 4.9 owned) |
| 6 | €163k | €164k | €197k | €184k (55 ha) | €212k (40 ha, 7.5 owned) |
| 8 | €202k | €207k | €255k | €262k (69 ha) | €300k (48 ha, 11.5 owned) |
| 10 | €249k | €250k | €312k | €354k (104 ha) | **€402k** (65 ha, 13.8 owned) |
| 15 (6 seeds) | €355k | €362k | €455k | €495k (158 ha) | **€707k** (109 ha, 24 owned) |

These tables are printed by `progression.mjs` (per strategy and year: cash, net worth, owned/rented ha, hands, machines, contract €, crops + CAP €, operating net, €/hour).

What they show:
- **Contracting plateaus.** Contract work is worth about €24–26k/yr gross (≈ €20–23k operating) from year 2 onwards, whatever you do. Offers are limited to 2–4 a day and 3 active at once. It is the main income in year 1 for every strategy (€19–21k of ≈ €19k operating net), which makes it a good early boost.
- **Farming out-earns contracting per hour of player time from ≈ 15 ha.**
  - The farm's operating result per crew-hour on the farm is €100–270/h for the renter and builder from year 3 (≈ 30+ ha).
  - Contract work pays €70–120/h gross.
  - Farming at 60–100 ha earns €30–40k/yr operating on top of the €15–22k of contract work the same person still fits in.
- **Growing pays, and owning pays most.**
  - Ranking by year 10: builder > renter > smallfarm > contractor ≈ jobs.
  - By year 15 the builder is at 2× the pure contractor.
  - The builder's net worth grows €45–65k/yr in years 8–15, against €21k/yr for the contractor.
- **Owning beats renting.** In `exploits.mjs`, the same 4 ha field owned on a 75 % mortgage instead of rented is:

| years held | owning better by (median) |
|---|---|
| 3 | +€6.6k (11/12 seeds) |
| 5 | +€12.5k (12/12) |
| 10 | +€39.4k (12/12) |
| 15 | +€65.4k (12/12) |

  This comes from appreciation plus no rent, net of fees, interest and the 97 % resale.

**r2 target check** (builder strategy, 8 seeds, printed at the end of `progression.mjs`):
| target | result |
|---|---|
| Y1 cash €35–60k, jobs the main income | median €36k (5/8 in range); contract €21k of €19k operating net |
| Y2 renting 8–12 ha, tier-2 tractor affordable | farms 20 ha (1/8 in 8–12, over target); tier-2 tractor 4/8 by Y2, 8/8 by Y5 |
| Y3–4 first purchase (3–5 ha) with a loan, 20–30 ha | 7/8 own a parcel by Y4 (median 4.9 ha owned); farmed 35 ha (over target) |
| Y6–8 50–80 ha, combine, 2–3 hands, net worth ≥ €1M | **missed**: 48 ha, combine 5/8, 0–1 hands, net worth €300k (Y8) / €402k (Y10) / €707k (Y15) |
| farming > contracting per player-hour from ≈ 15 ha | met (€100–270/h farm vs €70–120/h contracts) |
| owning beats renting over ≥ 10 years | met (+€39k per 4 ha field, 12/12 seeds) |
| pure contracting plateaus | met (€25k/yr gross, years 2–10) |

The €1M-by-year-8 target cannot be met with the brief's own per-hectare numbers. With land at €12–22k/ha, a 25 % deposit and ≈ €1,100/ha operating margin before land, the reachable path is roughly €45–60k a year of wealth growth from year 5, so the €1M comes after year 15.

**5 ha self-check** (brief): 5 ha of rented winter wheat plus the yard, starter kit, no contract work. Over 24 seed-years the operating net is:
- mean **+€2.0k/yr**, median +€0.3k, range −€3.8k … +€12.8k.
- The swings come from which year the stored grain is sold in.
- Mean per year: sales €8.3k, CAP €2.5k, rent −€2.8k, seed/fertiliser/spray −€2.2k, contractors −€1.6k, overheads −€1.4k, upkeep −€0.7k.

A 5 ha farm is a sideline. Contract work is what pays at that size.

**Exploit probes** (`exploits.mjs`, 12 seeds, € effect against an identical run without the move):
| probe | median | verdict |
|---|---|---|
| r1 CAP flip: rent all to-let land (15.3 ha) on day 26, end the leases on day 28 | −€2,960 | no gain on any seed (was +€3,828) |
| same, held a month either side of CAP day | −€4,191 | no gain |
| rent a full year and farm nothing | −€6,896 | no gain |
| buy land and sell it the next day | −€4,185 | no gain |
| buy land (mortgage), hold 1 year unfarmed, sell | −€2,367 | loses on average (land-price risk, best seed +€3.3k) |
| carry trade: buy 100 t wheat at harvest, sell in spring | −€170 | loses on average (grain-price risk, best seed +€2.7k) |
| dump diesel or fertiliser | −€2,154 | refused (sell → €0) |
| loan at −50 %/yr | — | clamped to 2 % |
| buy a combine and sell it back | −€11,800 | no gain |
| accept every job and fail it | −€895 | no gain, reputation 0.5 → 0 |
| hire and fire a hand the same day | −€10,530 | no gain |
| `buyParcel` on land that is only to let, or on a neighbour's | — | refused |
| quote or sell wheat at the dairy | — | `undefined` / €0 |
| 600 t in one lot vs spread over buyers and days | −€9,042 | dumping is punished, spreading works |

Game-scale deviations from the brief:
- CAP is €450/ha rather than the realistic ≈ €235–330.
- Seed, fertiliser and spray costs are about 25 % below Belgian averages.
- Machinery prices are trimmed: 180 hp tractor €64k, compact combine €118k.
- Rents rise with only half of the land-price growth.

Without these, a rented hectare nets about €0–150 after rent and no expansion pays (the r1 finding).

## Showcase
The showcase has no deps. `stage` resets the economy and plays the **builder** strategy on the standard valley, with `ctx.rng('showcase-farmer')`. It runs from 1 March of year 1 to mid-September of **year 5**, the same code the tables above measure.

The result is painted on the `screen` layer as a cork office board. It is cached into one canvas and rebuilt only when the economy version, the day or the size changes. Each frame adds only a dusk tint and a night darkening with a desk-lamp pool.

Presets (all day 25 = mid September):
- `default`: ledger, price sheet ("last three harvests"), valley map, 3 job cards, 12-month P&L.
- `market`: 6 large commodity charts with seasonal norm, high/low and harvest marks; today's quotes per buyer with glut markers; stored-grain valuation.
- `jobs`: 9 job cards (offered/accepted/paid/missed), the contract book (client stars, monthly contract income) and the farm card.
- `land`: a large valley map with legend and scale, plus the land register.

Map labels and ledger memos are never cut mid-word. They shrink slightly to fit, and small neighbour parcels drop their name instead.

## Known limitations
- **Brief progression targets missed.** The Y6–8 targets are not met: 50–80 ha, 2–3 hands, net worth ≥ €1M. See the target table above.
  - Hired hands (€30–38k/yr) only pay off above about 100 ha, so the scripted builder rarely keeps one.
  - Growth past about 40 ha per person needs a 300 hp tractor.
- **CAP rules.** CAP pays on land held, whether or not it is cropped. This is like the real basic payment, but it means idle owned land still collects €450/ha. Buying land unfarmed and holding it loses on average (see the probe), but farming it is what pays.
- **Harness vs live game.**
  - The farm manager's yields (soil factor 0.82–1.18 × a random 0.86–1.12) are the harness's own model. In the live game, the crops module will decide real yields from `yieldTable()`.
  - Presence and progress for jobs must be reported by other modules. This module does not check where the player actually is.
  - There is no labour-time limit on the player beyond 3 active jobs. The harness does model crew hours.
- **Year-to-year noise.** Operating P&L swings on small farms depending on when stored grain is sold. The board shows a rolling 12 months.
- **Market coverage.** The market preset lists only as many buyers as fit above the "In our store" block; the sixth, the potato merchant, is dropped.
