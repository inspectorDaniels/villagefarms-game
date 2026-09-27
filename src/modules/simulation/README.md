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

## API (all via `ctx.modules.get('simulation')`)
**Money**
- `money()` → €.
- `canAfford(x)` → bool.
- `charge(amount, category, memo, opts?)` → bool. It returns false and charges nothing if the money isn't there, unless `opts.force`.
- `credit(amount, category, memo)`.
- `ledger(n=20)` → newest first: `{t, day, amount (signed), category, memo, balance}`.
- `summary(periodDays=36)` → `{income, expenses, net, operatingIncome, operatingExpenses, operatingNet, byCategory, days}`. "Operating" leaves out the capital and financing categories `loan, loanRepay, land, landSale, machinery, assetSale`.
- `netWorth()` → `{cash, land, machinery, stock, debt, total}`. Land is at market value, machinery at resale value, and stock at 95 % of the quote.

**Market**
- `price(item, sellPointId?)` → €/unit, including the buyer's bias, daily jitter and glut.
  - It returns `undefined` when that buyer doesn't take the item (wheat at the dairy).
  - Without a sell point you get the anonymous spot market, which pays −3 % and takes produce but not diesel or fertiliser.
- `priceHistory(item)` → `[[day, refPrice], …]`, up to 144 days.
- `sell(item, qty, sellPointId?, {fromInventory=true})` → € received. It returns 0 if the buyer refuses the item.
  - Big lots are priced along the saturation curve.
  - Diesel and fertiliser can't be sold.
- `buy(item, qty)` → € spent. Diesel and fertiliser are bought at the quote. Produce costs +15 % retail.
- `defineSellPoint(id, {name, x, y, accepts:[items], bias:{item: mult}})`.
- `sellPoints()`.
- `yieldTable()` → per crop: `{name, product, yield t/ha, straw, seed, fertiliser, spray (€/ha), dieselL, sowMonths, harvestMonths}`.
- `inputCost(crop)`, `buyInputs(crop, ha, parts?)`.
- `workRates()` → machine hours per ha by tractor tier, contractor rates, and hours per working day.

Items (€): wheat 210/t, barley 185, oats 200, rapeseed 430, maize 195, potatoes 160, sugar beet 42,
hay 120 (`grass` is an alias), straw 70; milk 0.46 €/l; eggs 0.22 €/ea; wool 1.8 €/kg;
diesel 1.25 €/l; fertiliser (CAN) 420 €/t.

**Inventory**
- `inventory()`.
- `addInventory(item, qty)` → amount stored (limited by capacity).
- `removeInventory`.
- `setCapacity(item, qty|null)`.
- `storageRoom(item)`.

**Catalog / assets**
- `registerCatalogItem({id, category, name, price, leasePerDay?, upkeepPerDay?, meta?})`. Default upkeep is 1.5 % of the list price per year. The default lease is 20 % of the price per year.
- `catalog(category?)`.
- `purchase(id, {finance?})` → bool. With `finance:true` it is dealer finance:
  - you pay 25 % now;
  - the other 75 % becomes a 5-year loan secured on the machine;
  - it needs credit headroom, counting the new machine as collateral.
- `lease(id)`: the first day is paid now.
- `grantAsset(id, {boughtDay?})` gives a starter kit or gift.
- `assets()` → items with their resale `value`. Resale is 90 % of list − 5 % per year, with a floor of 20 %.
- `releaseAsset(assetId)` sells an owned item or hands back a leased one.

**Loans**
- `takeLoan(amount, {months=60, rate=0.045})` → id or null. The rate is clamped to 2–12 %/yr.
  - The unsecured credit limit is €25k, plus 60 % of the last 12 months' operating result, plus 60 % of owned land value, plus 50 % of machinery value, minus debt.
- `repayLoan(id, amount?)`.
- `loans()`.
- `creditLimit()`.
- Interest is charged daily (balance × rate / 36). Instalments are due monthly.

**Land** (`world.land.parcels`, plus a regional land index in `world.land.index`)
- `defineParcel({poly, name, state, soil (0..1 | {quality}), price?, rentPerHaYear?, owner?, id?, tradeable?})` → id.
  - States are `owned | rented | forSale | forRent | npc`.
  - Market value is ha × €12–22k by soil × land index.
  - The asking rent is €450–750/ha/yr by soil² × √index, about 3 % of value. Rents follow half the land-price growth (the Belgian Pachtwet caps rent rises).
- `parcels()`, `parcel(id)`, `parcelAt(x, y)`, `canUse(x, y)` (owned or rented).
- `landMarket()` → `{index, indexHistory, forRent:[ids], forSale:[ids], capAccruedHa}`.
  - Listings are scarce: at most 3 to let and 2 for sale at a time.
  - Each month there is a chance a neighbour's parcel is listed (to let 50 %, for sale 40 %).
  - Unanswered listings are withdrawn after 3–8 months.
  - The land index grows about 3 %/yr, with monthly noise.
- `buyParcel(id, {mortgage?})` works only on `forSale` parcels and costs the price + 4 % fees.
  - With `mortgage:true`, the bank lends up to 75 % of the price over 15 years.
  - You bring the rest and the fees in cash.
- `rentParcel(id)` works only on `forRent` parcels. Rent is charged **monthly in advance**, starting now, at the rate signed.
  - The **minimum term is one game year**.
- `leaseExitCost(id)` → € it costs to end the lease today.
- `endLease(id)` hands the parcel back.
  - Before the minimum term is up, this costs min(the unpaid rest of the term, 3 months' rent).
- `sellParcel(id)` → 97 % of market value.
- **CAP** is €450/ha-year (game scale; basic income support + eco-schemes + young-farmer top-up).
  - It accrues **per hectare-day held** (owned or rented), and the accrued amount is paid on 1 October.

**Jobs** (`world.jobs.list`)
- A job is `{id, type, client, clientFarm, title, pay, deadlineDay, expiresDay, parcelId, from, to, x, y, crop, amount, unit, km?, cargo?, requiresMachine, needs, progress, status}`.
- Every job has a destination (`to`), and area jobs point to a real parcel.
- Types: `plough sow harvest mow transport deliver animalCare shopHelp villageWork snowClear`.
- Pay follows machine rates:
  - plough €105/ha, drill €72/ha, combine €160/ha (lifting roots ×1.6), mow €58/ha;
  - haul €4.5/t + €1.2/t·km; deliver €110/load;
  - odd jobs €14.5–19/h; snow clearing €72/h (snow ×4 more likely in `snow` weather).
- Offers: 2–4 new per day, at most 8 open, and **at most 3 accepted at once**.
- `jobs(filter)` takes a status string, a match object or a predicate.
- `acceptJob`, `reportProgress(id, delta)` (completes at 1), `tickPresence(id, gameSeconds)`.
- `completeJob(id)` needs ≥ 90 % done. It pays pro-rata, +5 % if the job is finished before the deadline day.
- `failJob(id)` costs a 10 % penalty and reputation.
- `reputation()`:
  - success adds with diminishing returns: +3 % of the distance to 1;
  - a failure costs −0.08;
  - everything drifts back toward 0.5 by 4 % a month;
  - reputation scales pay ×0.92–1.08.

**Workers**
- `hireWorker(name?)` → `{id, name, wage €830–1060/day (≈ €30–38k/yr), skill}`.
- `fireWorker(id)` pays one final day.
- `workers()`.

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
