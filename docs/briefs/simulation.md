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
