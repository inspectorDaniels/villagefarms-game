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
- Prices (€/ha): plough 110, cultivate 65, sow 75, spray 28 (per pass), mow 60, harvest 180, lift 430, bale 55 (minimum charge €80). Contractors bring tier-3 kit and work at the AI rate.

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
1. **Market.** The price walk runs and gluts recover (×0.7 per day).
2. **Delegated jobs.** Hands work the jobs assigned to them with the hours they did not log yesterday. Each needs a free owned tractor and implement.
3. **Land.** Rent that is due is charged (monthly, in advance). CAP days accrue. On 1 October, CAP is paid pro rata on parcels worked since the last CAP day. Each month the land index moves and listings come and go.
4. **Contractors.** Bookings start, and when they finish they emit `economy:contractor-done`.
5. **Wages.** Yesterday's hours settle into wages:
   - ≥ 5 h worked → the full day rate;
   - less than 5 h → half the day rate;
   - no hours → the €35 retainer.
6. **Upkeep and leases** are charged.
7. **Loans.** Interest is charged every day; instalments are due monthly.
8. **Overheads** are charged monthly (€85 + €5/ha).
9. **Overdraft and insolvency.**
   - Overdraft interest is 12 %/yr.
   - Days over the limit are counted: at 30 purchases are blocked, and from 60 the bank sells an asset every 3 days.
   - `economy:bankrupt-warning` is emitted with `stage`, one of `overdraft | warning | blocked | seizure`.
10. **Jobs.** Expiry and failures are processed, then new offers. There are 2–4 new offers a day, plus about 1.2 per hand. At most 8 + 2 × hands are open at once.

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
- `economy:contractor-done {booking}`: a contractor finished an operation. **crops applies it to the fields.**
- `economy:asset-seized {kind:'machine'|'land', id, name, amount}`.
- `land:parcel-changed {id, state, from, parcel}`.
- `jobs:offered | jobs:accepted | jobs:completed | jobs:failed`: a copy of the job.
- Listens to `clock:day`.

## Balance — reproducible, headless (r3)
```
node src/modules/simulation/tests/progression.mjs            # defaults: 10 years × 8 seeds, AI_WORK_FACTOR 0.25, ≈ 15 s
node src/modules/simulation/tests/progression.mjs 10 8 --ai=0.5   # sensitivity: hands/contractors half as fast
node src/modules/simulation/tests/progression.mjs 10 8 --ai=2     # … twice as fast
node src/modules/simulation/tests/exploits.mjs               # defaults: 8 seeds
```
Every number below comes from those exact commands. Both harnesses import the real `sim.js`, `economy.js`, `market.js`, `land.js`, `jobs.js` and `contractors.js`, and play through the **public API only**:
- `hireContractor` / `contractorBookings`;
- `recordFieldWork` / `logWork`;
- `hireWorker`, `assignJob`, `acceptJob`, `reportProgress`, `tickPresence`;
- `purchase({finance})`, `buyParcel({mortgage})`, `rentParcel`, `buy` / `sell` / `addInventory`.

The harness supplies only what the crops module will do in the live game: turning a finished harvest into tonnes. Its yield model is the yield table × soil factor (0.82–1.18) × timeliness (−7 % when sowing or harvest is late) × weather noise (0.86–1.12).

**The world fits the map.** `defineValley` is 81 ha in 37 parcels inside the 1024 m map: fields, a village, two woods, 6 buyers. The player starts with:
- a 0.6 ha yard (owned) and 1.2 ha rented;
- €18k;
- a used 95 hp tractor, a 3 m plough and drill, and a 14 t trailer.

**Time model in the harness:**
- The player has 14 game hours a day, which is 14 real minutes at 1×. He does jobs at `workRates().player`, so a 0.4 ha plough job takes about 12 real minutes.
- Hands work 10 game hours a day at `workRates().ai`. A t1 plough covers 0.48 ha per game hour.
- Farm tasks go first to hands that have the kit. The player takes a task only if his hours are worth less than the contractor's price at €15/h. Everything else is booked with `hireContractor` early enough for its lead time.
- Crew-sized jobs go to hands with `assignJob`, and the sim works them overnight.

**Strategies:**
- **jobs**: the player alone. He never hires or invests; contractors farm the starter plot.
- **contractor**: contract work only. Hires hands and takes crew jobs, no land.
- **smallfarm**: rents up to 12 ha, contractors do everything, no hands.
- **renter**: rents what it can finance, and hires hands and machines when the contractor bill or the missed crew jobs would pay for them.
- **builder**: the renter's rules, plus it buys land on a 75 % mortgage when it can pay the deposit, and buys bigger kit.

### Results (default run, median of 8 seeds)

Net worth by strategy (farmed ha in brackets):

| year | jobs | contractor | smallfarm | renter | builder |
|---|---|---|---|---|---|
| 1 | €51k | €51k | €51k | €51k | €51k (1.8 ha) |
| 2 | €54k | €59k (2 hands) | €59k (11 ha) | €54k (19 ha) | €55k (19 ha, 2 hands) |
| 4 | €61k | €90k | €82k | €99k (32 ha) | €106k (30 ha, 3.4 owned) |
| 6 | €75k | €136k | €114k | €170k (42 ha) | €180k (41 ha, 5.9 owned, combine) |
| 8 | €87k | €183k | €148k | €240k (54 ha) | €273k (49 ha, 10.6 owned, 3 hands) |
| 10 | €98k | €232k | €179k | €309k (54 ha) | **€405k** (59 ha, 16.2 owned) |

The builder, year by year:

| builder | Y1 | Y2 | Y3 | Y4 | Y6 | Y8 | Y10 |
|---|---|---|---|---|---|---|---|
| contract jobs € | 6k | 19k | 29k | 29k | 34k | 36k | 39k |
| crops + CAP € | 4k | 18k | 42k | 58k | 78k | 108k | 111k |
| contractors € | 1k | 3k | 5k | 6k | 8k | 11k | 13k |
| operating net € | 6k | 17k | 27k | 37k | 45k | 60k | 60k |

### What the results show
- **The player alone earns about €6k a year.** Player-sized jobs pay €110–200 for 8–18 real minutes of driving or walking.
- **Hands are the scaling mechanism.** A hand costs €150–220 a day worked (€35 idle). The same hand earns €50–220 per game hour on crew jobs (e.g. "Haul 42 t" €420, "Deliver 4 loads" €610), and does 4–5 ha of ploughing a day on the farm.
  - Pure contracting with 3 hands plateaus at about €37–39k a year of jobs (≈ €27k operating), because offers are limited to 2–4 a day plus about 1.2 per hand, and the job cap is 2 + hands.
- **Farming on top of contracting doubles the operating result.** At Y8–10 the builder makes €60k operating against €27k for pure contracting, and €405k net worth against €232k.
- **Owning beats renting:**
  - builder €405k vs renter €309k at the same crew size;
  - the same 4 ha field owned on a mortgage instead of rented comes out +€11k after 3 years, +€43k after 10 and +€70k after 15, on 8/8 seeds (`exploits.mjs`).
- **The contractor service is a real choice.** It costs the builder €3–13k a year. It is used for sugar-beet lifting, baling, and overflow, and before the combine arrives. Late work costs 7 % of yield.

### r3 targets (builder, printed at the end of the default run)
| target | result |
|---|---|
| first hand year 2–3 | median year 2 (2 hands by Y2–3, 3 hands by Y8; 2+ by Y8 in 8/8 seeds) |
| first owned parcel year 3–4 | median year 3 |
| combine year 4–6 | median year 5 |
| 40–60 ha by year 8 | median 50.4 ha, 8/8 in range |
| net worth €400–600k by year 10 | median €405k; 4/8 in range, range €319–457k |

**Sensitivity to `AI_WORK_FACTOR`.** Same command with `--ai=`:

| factor | builder Y10 net worth | ha at Y8 | combine year | contractor strategy Y10 | renter Y10 |
|---|---|---|---|---|---|
| ×0.5 (0.125) | €237k | 41.3 | 7 | €154k | €229k |
| ×1 (0.25) | €405k | 50.4 | 5 | €232k | €309k |
| ×2 (0.5) | €443k | 50.4 | 5 | €210k | €357k |

The ranking builder > renter > contractor > smallfarm > jobs holds at all three. At ×0.5 hands do half the work per wage, so the curve roughly halves after year 4.

### Pace in real hours
One game year is 14.4 real hours at 1×, 4.8 h at 3× and 1.44 h at 10×.

| builder median | game time | real hours at 1× | at 3× |
|---|---|---|---|
| first hand | year 2 | ≈ 15–29 h | 5–10 h |
| first owned parcel | year 3 | ≈ 29–43 h | 10–14 h |
| combine | year 5 | ≈ 58–72 h | 19–24 h |
| 50 ha and 3 hands | year 8 | ≈ 100–115 h | 34–38 h |
| €400k | year 10 | ≈ 144 h | 48 h |

Fast-forwarding does not skip the economy. Rent, wages, interest and upkeep are charged per game day at any speed. CAP needs worked land. Hands work per game day, so 10× only compresses real time.

### 5 ha self-check (brief)
5 ha of rented winter wheat plus the yard, all field work by contractors, no contract jobs. Over 24 seed-years (years 2–4):
- operating net per year: mean **+€2,440**, median €2,988, range −€4.0k … +€13.4k;
- mean per year: sales €9.2k, CAP €2.3k, rent −€2.6k, seed/fertiliser/spray −€1.8k, contractors −€2.5k, overheads −€1.4k.

A 5 ha farm run by contractors is a sideline.

### Exploit probes (`exploits.mjs`, default 8 seeds: 21/21 closed)
The € effect is money − debt against an identical run without the move.

| probe | median | verdict |
|---|---|---|
| r1 CAP flip: rent 15.3 ha on day 26, end the leases on day 28 (even while reporting field work) | −€2,700 | no gain on any seed |
| CAP flip held a month either side / rent a year and farm nothing | −€4,376 / −€10,084 | no gain |
| **r2 land-banking**: buy land on a mortgage, never work it | CAP €0 | closed (CAP needs worked land) |
| **r2 credit bypass**: mortgage a parcel and sell it the same day | −€2,149, debt left €0 | closed (mortgage repaid from the sale) |
| **r2 credit bypass**: finance a 180 hp tractor and sell it back | −€6,400, debt left €0 | closed |
| **r2 money mint**: `sell('wheat', 50, …, {fromInventory:false})` with no stock | €0 | closed |
| **r2 insolvency**: an overdraft of −€150k asks for a loan; then 70 days over the limit | loan refused; blocked; 4/4 machines sold by the bank | closed |
| land flip next day / held a year unfarmed | −€2,149 / −€7 (best seed +€866) | no gain / a coin flip, loses on average |
| carry trade: buy 100 t at harvest, sell in spring | −€596 (best seed +€2.2k) | loses on average |
| contractor booked and cancelled 20× / hand hired and idle a month | €0 / −€1,085 | no gain |
| dump diesel, −50 % loan rate, combine buy-and-resell, accept-and-fail jobs, hire/fire, buying to-let land, wheat at the dairy | — | refused or no gain |
| 600 t in one lot vs spread over buyers and days | €156/t vs €166/t | dumping punished, spreading works |

## Showcase
The showcase has no deps. `stage` resets the economy and plays the **builder** strategy on the standard valley, with `ctx.rng('showcase-farmer')`. It runs from 1 March of year 1 to mid-September of **year 5**, using the same code as the tables above.

The result is painted on the `screen` layer as a cork office board. It is cached and rebuilt only when the economy version, the day or the size changes. Each frame adds only a dusk tint and a night darkening with a desk-lamp pool.

Presets (all day 25 = mid September):
- `default`: ledger, price sheet, valley map, 3 job cards, 12-month P&L.
- `market`: 6 commodity charts; quotes from all 6 buyers (two lines each); the store valuation.
- `jobs`: 9 job cards, including crew-sized ones worked by hands; the contract book; the farm card with hands and day rates.
- `land`: a large valley map and the land register.

## Known limitations
- **Net worth target only just met.** Year 10 net worth is a median of €405k (4/8 seeds in €400–600k). Outcomes are path-dependent (when land comes up for sale, when hands are hired): the 8-seed range is €319–457k.
- **The harness farm manager is a heuristic player.** Its hiring and buying rules are tuned to be sensible, not optimal.
- **Crew jobs out-earn farming per hand-hour.** Hands on crew jobs earn €50–220 per game hour. That is why pure contracting with 3 hands reaches €232k, and why a hand in year 2 is always right.
  - Farming still doubles the operating result on top of that.
  - Offers are capped at 2–4 a day plus about 1.2 per hand.
- **Game-scale economy.** These values deviate from realistic Belgian figures (the brief sets rent at €450–750; I use €450–650):
  - CAP €450/ha;
  - seed/fertiliser/spray about 40 % below Belgian averages;
  - rent €450–650/ha, rising with only half of the land index;
  - compact combine (used) €92k.
- **CAP relies on `recordFieldWork`.** Any module or script could call it, so it is trusted input from crops, vehicles and characters.
- **Delegated jobs are worked abstractly.** The sim works them from the hand's unlogged hours and checks only that a tractor and implement are owned and not over-booked. It does not know where the hand's character physically is. A characters/vehicles AI that drives the hand for real should call `reportProgress` and `logWork`, and leave `assignee` set to a non-worker id.
- **Harness vs live game.**
  - The harness supplies harvest tonnes itself. In the live game, crops must turn `economy:contractor-done` and its own field ops into `addInventory` + `recordFieldWork`.
  - Until the demo defines parcels, live jobs sit at deterministic points inside `world.bounds`, or at a client farm set with `defineClientFarm`.
