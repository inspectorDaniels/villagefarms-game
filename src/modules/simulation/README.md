# simulation — economy, land, jobs (wave 1)

A small Belgian farm economy: money and a ledger, a market with seasonal prices, loans, a
machinery catalog, hired hands, land parcels you can buy or rent, and paid contract jobs from
NPC neighbours. The logic has no DOM and no ctx (`sim.js` + `economy.js`, `market.js`, `land.js`,
`jobs.js`), so it can be fast-forwarded headlessly. `index.js` connects it to ctx.

Files: `data.js` (reference tables), `sim.js` (assembly, daily processing, fast-forward),
`economy.js`, `market.js`, `land.js`, `jobs.js`, `farmer.js` (scripted farmer and the showcase
valley), `paint.js`/`icons.js`/`board.js`/`showcase.js` (the painted office board).

## Time and units
1 game year = 36 days (12 months × 3 days). Annual figures are divided by 36 per day.
Money is in € (2 decimals); tonnes, litres, eggs (`ea`), kg; area in m² (`area`) and ha in labels.
Days are absolute day indices (`api.today()`); the day of year is `day mod 36`.
Daily processing runs once per new game day (on `clock:day`, with a catch-up in `update`, max 72
days at a time). Each catch-up day's entries are stamped with that day's date.

## API (all via `ctx.modules.get('simulation')`)
**Money**
- `money()` → €. `canAfford(x)` → bool.
- `charge(amount, category, memo, opts?)` → bool. Returns false and charges nothing if you can't afford it, unless `opts.force`.
- `credit(amount, category, memo)` → true.
- `ledger(n=20)` → the newest n entries first, each `{t, day, amount (signed), category, memo, balance}`.
- `summary(periodDays=36)` → `{income, expenses, net, operatingIncome, operatingExpenses, operatingNet, byCategory, days}`. "Operating" leaves out the capital/financing categories `loan, loanRepay, land, landSale, machinery, assetSale`.

**Market**
- `price(item, sellPointId?)` → € per unit. Includes the sell point's bias, its daily jitter and saturation. Without a sell point you get the anonymous spot price (−3 %).
- `priceHistory(item)` → `[[day, refPrice], …]`, up to 144 days. At init it is pre-filled with 36 days.
- `sell(item, qty, sellPointId?, {fromInventory=true})` → € received. Returns 0 if the point doesn't accept the item or there is nothing to sell. Use `fromInventory:false` for trailer loads that are not stored in farm inventory. Big lots are priced over the saturation curve.
- `buy(item, qty)` → € spent (0 if you can't afford it or there's no room). Diesel and fertiliser are bought at the quoted price. Other items carry a +12 % retail markup.
- `defineSellPoint(id, {name, x, y, accepts:[items], bias:{item: mult}})`. Without a bias, each point gets a deterministic ±3.5 % per item.
- `sellPoints()`.
- `yieldTable()` → per crop `{name, product, yield t/ha, straw t/ha, seed, fertiliser, spray (€/ha), dieselL (l/ha), sowMonths, harvestMonths}`.
- `inputCost(crop)` → current €/ha. The fertiliser cost follows the fertiliser price.
- `buyInputs(crop, ha, parts?)` → € charged, split into the seed/fertiliser/spray categories.

Items: wheat 210, barley 185, oats 200, rapeseed 430, maize 195, potatoes 160, sugarBeet 42 (€/t);
hay 120 (`grass` is an alias), straw 70 (€/t); milk 0.46 €/l, eggs 0.22 €/ea, wool 1.8 €/kg;
diesel 1.25 €/l, fertiliser (CAN) 420 €/t.

**Inventory**
- `inventory()`.
- `addInventory(item, qty)` → amount stored (limited by capacity).
- `removeInventory(item, qty)` → amount removed.
- `setCapacity(item, qty|null)`. Capacity is unlimited until set.
- `storageRoom(item)`.

**Catalog / assets**
- `registerCatalogItem({id, category, name, price, leasePerDay?, upkeepPerDay?, meta?})`. Default upkeep is 2 % of the price per year.
- `catalog(category?)`.
- `purchase(id)` → bool. `lease(id)` → bool; the first day is paid immediately.
- `assets()` → owned or leased items, with the resale `value`.
- `releaseAsset(assetId)` sells an owned item for 55 % minus 8 % per year of ownership, or hands back a leased one.

**Loans**
- `takeLoan(amount, {months=60, rate=0.045})` → id or null. The credit limit is €50k + 60 % of owned land value − current debt.
- `repayLoan(id, amount?)` → amount repaid.
- `loans()`, `creditLimit()`.
- Interest is charged daily (balance × rate / 36). Instalments come due monthly.

**Land** (`world.land.parcels`)
- `defineParcel({poly, name, state, soil (0..1 or {quality}), price?, rentPerDay?, owner?, id?})` → id.
- States: `owned | rented | forSale | forRent | npc`. `forRent` is an extra state beyond the architecture list.
- Price = ha × (€38k … €65k by soil). Rent = ha × (€350 … €650 by soil) / 36 per day.
- `parcels()`, `parcel(id)`, `parcelAt(x, y)`.
- `buyParcel(id)` works on forSale or rented parcels and adds 11.5 % registration duty + notary.
- `rentParcel(id)` works on forSale or forRent parcels and needs a month's rent in cash.
- `endLease(id)`.
- `sellParcel(id)` → 95 % of the price.
- `canUse(x, y)` → true on owned or rented land.
- A CAP payment of €235/ha of farmed land is paid on 1 October.

**Jobs** (`world.jobs.list`)
- Each job has `{id, type, client, clientFarm, title, pay, deadlineDay, expiresDay, parcelId, from, to, crop, amount, unit, requiresMachine, progress, status}`.
- Types: `plough sow harvest mow transport deliver animalCare shopHelp villageWork snowClear`. How often each type appears depends on the month. Snow clearing becomes 4× more likely when the environment weather is `snow`.
- `jobs(filter)` takes a status string, an object of field matches, or a predicate.
- `acceptJob(id)` allows up to 5 active jobs.
- `reportProgress(id, delta)` completes the job automatically at 1.
- `tickPresence(id, gameSeconds)` is for the presence jobs.
- `completeJob(id)` → € paid. It needs ≥ 90 % progress and pays pro-rata, with a +5 % bonus if the job is done before the deadline day.
- `failJob(id)` charges a 10 % penalty and lowers reputation. Jobs past their deadline fail automatically.
- `reputation()` → `{overall, clients}`. Reputation raises the pay offered (×0.9…1.1) and adds one extra offer per day above 0.7.

**Workers**
- `hireWorker(name?)` → `{id, name, wage €110–160/day, skill}`.
- `fireWorker(id)` pays one final day.
- `workers()`.

`today()` → the economy's absolute day index.

## Daily processing (order)
1. Market walk and saturation recovery.
2. Rent.
3. CAP payment (on day 27 of the year).
4. Wages, upkeep and leases.
5. Loan interest and instalments.
6. Monthly fixed costs (€85 + €5/ha).
7. Overdraft interest at 12 %/yr, plus `economy:bankrupt-warning` while money < 0.
8. Job expiry and failures, then 0–3 new offers (at most 9 open).

## Price model
Reference price = base × seasonal(dayOfYear) × exp(own walk + weight × shared grain factor).
- **Seasonal curve.** Storable crops follow a "carry" curve: lowest just after harvest, rising about 2 × amp until just before the next one. Milk, eggs, wool, diesel and fertiliser follow a smooth cosine. Sugar beet is on a flat contract price.
- **Random walk.** A daily log-space Ornstein–Uhlenbeck process (θ ≈ 0.07/day, σ 0.4–6 %/day). Grains share a common factor.
- **Sell points.** Each point applies its own bias and a ±0.9 % daily jitter.
- **Saturation.** Every lot adds `qty/depth` to a per-point, per-item level. This lowers the price by up to −25 %, integrated over the lot, and recovers at ×0.7 per day.

## Events
`economy:transaction` (each entry, plus `item/qty/unit/sellPointId` on sales)
`economy:price-changed {day, prices}` (daily)
`economy:bankrupt-warning {money, daysNegative, creditLimit}`
`land:parcel-changed {id, state, from, parcel}`
`jobs:offered | jobs:accepted | jobs:completed | jobs:failed` (a job copy)
Listens to `clock:day`.

## Balance check (headless, `farmer.js` scripted farmer)
The setup is 5 ha of rented winter wheat (soil 0.7, €566/ha/yr) with no other land. The farmer:
- sells half the grain off the combine,
- stores the rest until the carry pays ≥ 8 %,
- sells the straw,
- collects the CAP payment.

Figures are mean operating net per game year over 24 seed-years (12 seeds × 2 years).
| scenario | mean | median | min | max |
|---|---|---|---|---|
| contractor does all fieldwork, no contract jobs | **+€411** | +€811 | −€3.9k | +€6.3k |
| own used tractor + plough/drill (€26k loan), no jobs | +€42 | +€370 | −€4.4k | +€6.1k |
| own machinery + contract jobs (the showcase run) | **+€6.7k** | +€7.3k | +€1.4k | +€13.7k |

A typical wheat-only year:
- **Revenue:** sales ≈ €9.2k (≈42 t wheat at ~€205 plus ≈17 t straw) and CAP €1.2k.
- **Costs:** rent €2.7k, fertiliser €1.7k, spray €950, seed €525, contractors €2.4k, fixed €1.3k.

So 5 ha of wheat alone roughly breaks even, which is realistic for that size. Contract work
(≈€8–10k/yr) is what makes a starting farm profitable. Price ranges over 4 simulated years:
- wheat €193–258/t
- rapeseed €376–533/t
- potatoes €119–238/t
- milk €0.42–0.52/l
- diesel €1.14–1.41/l

## Showcase
The showcase has no deps. `stage` resets the economy and defines a valley:
- 13 parcels on a jittered grid with shared bowed borders,
- 6 sell points,
- lanes, a brook, a wood and the village.

It then fast-forwards two game years with the scripted farmer. The history is shown as years
1–3 via `sim.tOffset`. The result is painted on the `screen` layer as a cork office board, cached
into one canvas and rebuilt only when the economy version, the day or the size changes. Each
frame adds only a dusk tint and a night darkening with a warm desk-lamp pool.

Presets (all day 25 = mid September):
- `default`: ledger book, price sheet, valley map, 3 job cards, season P&L.
- `market`: 6 large commodity charts with seasonal norm, high/low, harvest marks; sell-point quotes with glut markers; stored-grain valuation.
- `jobs`: 9 job cards (offered/accepted/paid/missed) with a contract book (client stars and monthly contract income) and a farm card.
- `land`: large valley map with legend and scale, plus the land register.

## Known limitations
- Wages follow the brief (€110–160 per game day), which makes a year's wages very cheap (≈€4.9k).
- Nothing models machinery depreciation. Purchases are capital, and resale value falls 8 %/yr.
- Presence and progress for jobs must be reported by other modules. The module does not check where the player actually is.
- The jobs RNG is per-day and deterministic. Loading a save mid-day does not replay offers.
- There is no labour-time limit on how many jobs the player can do, beyond 5 active jobs.
- Board fonts: the handwritten notes use `Segoe Print` with a Georgia fallback.
