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
