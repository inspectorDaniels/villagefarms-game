# simulation — review round 1
Score: 6/10   Pass: no
Screenshots examined: shots/review/simulation-r1/default_1230.png, default_2330.png, market_1230.png, jobs_1930.png, land_1230.png, game.png (full game, 11:00). The other 0700/1930/2330 variants were checked through their JSON logs.
Perf: showcase frameMsAvg=0.39–1.25, p95=1.6–4.1, drawCalls=2–5, module msAvg=0.18–0.71 (the board is cached, and each frame only adds the light overlay). Full game: frameMsAvg=6.73, p95=13.7, drawCalls=110, simulation msAvg=0.006. Well within budget.
Errors: 0 console, 0 page errors (all 16 showcase shots + game)   Contract: 0 issues reported; manifest api == README == implementation; all 8 events declared and emitted; no cross-module imports; environment optional-dep null-checked   Lint: OK

## Verdict
The board is the best thing here. It is a real painted cork board with a Kasboek ledger, graph-paper price sheets, a gouache valley map and pinned job cards. There is a warm desk-lamp pool at night, and it reads as part of the game rather than a debug dump. The engine underneath is also solid: it is deterministic, save/load round-trips exactly, and there are no errors. The economy is what fails the round.

I reproduced the builder's balance claims headlessly (independent script, 12 seeds). The claim that 5 ha of rented wheat roughly breaks even holds: mean +€263 to +€777 and median +€600 per year. The claim that contract jobs add ≈+€6.7k is conservative: I got +€8.4k to +€9.6k. So the numbers are honest.

But they show that the game's premise does not work. ARCHITECTURE says the player "grows a farm from one rented field to a large estate", and nothing in this economy rewards growing:
- Farming earns about €150/ha/yr.
- Owning land is always a losing trade.
- Contract jobs are worth 10× the farm.
- There is a confirmed free-money exploit in rent and CAP.

A player who min-maxes this never farms and never buys land. They rent everything for one day in October and run contracts.

## Must fix
1. **CAP / short-lease exploit (confirmed).** In the showcase valley I rented every `forRent`/`forSale` parcel (15.1 ha) on the day before CAP day (doy 27) and ended every lease the next morning. That paid €229 of rent and received €3,548 of CAP for those hectares, a net **+€3,828 for one day**, repeatable every year.

   The root causes are three:
   - `rentParcel` charges nothing up front.
   - `endLease` works at any moment with no notice or minimum term.
   - CAP pays on `farmedHa()` measured on a single day (`land.js` `landDay`).

   The same hole lets a player rent a field only for the day they mow or harvest it. The fix:
   - Pay CAP pro rata for the days each parcel was held in the last 36 days, or only on parcels held since before sowing season.
   - Give leases a minimum term (e.g. 1 game year, or until after the next harvest).
   - Make `endLease` early cost the rest of the term or a notice penalty.
   - Charge rent monthly in advance.
2. **Progression curve: growing the farm does not pay, and buying land never does.** My measured figures, all per game year:
   - **Land.** The rent/price ratio is about 1% (e.g. Lindeveld is €57.4k/ha to buy and €566/ha/yr to rent). Buying adds 11.5% duty, never appreciates and resells at 95%. With loans at 4.5%, a mortgaged parcel loses money every year compared with renting it. Owning land exists only to raise the credit limit.
   - **Area.** Contractor-farmed rented wheat makes about €150/ha. With unlimited cash and storage, 20 ha gives mean +€2.9k and 50 ha gives +€1.0k. At 50 ha the per-lot saturation (wheat depth 80 t per point) takes most of the margin, and yearly swings reach −€40k/+€52k.
   - **Jobs.** A greedy player who accepts every offer earns **€23.2k/yr** from 84 jobs. Farming 5 ha earns under €1k.
   - **Time to buy.** One game year is 14.4 real hours. The cheapest parcel for sale (Bergske, €131k + duty ≈ €146k) takes about 6–15 game years of typical cash flow, which is 90–220 real hours. The compact combine (€145k) pays back through €165/ha harvest jobs in 20+ years.

   What to do. Several of these fixes change brief values (land €/ha, rent), so raise a brief amendment with the director:
   - Set a target progression, e.g. "first owned parcel by year 3–4, second tractor by year 2, combine by year 5".
   - Tune to that target, for example:
     - land appreciation of 2–3%/yr plus an owner-only premium (CAP entitlements, or rent from sub-letting);
     - rent-to-price closer to 3–4%, or land price cut by 2–3×;
     - scarce rentals (landlords reclaim parcels, limited `forRent` supply) so ownership is the only way to scale;
     - a saturation depth that scales with the number of sell points, or a forward contract so a 20–50 ha farm can sell its harvest.
   - Add a committed headless **10-year progression test** (a sensible player strategy, with cash, land and machinery over time) to the README next to the 5 ha table.
3. **The showcase run does not match what the README says.** The README table says "5 ha rented wheat … with no other land". But the showcase farmer is created with `ha: 5` on Lindeveld, which is **5.8 ha**, and the valley gives the player an owned 2.9 ha home parcel that is never farmed.

   So the board's "This season +€8,350" includes:
   - CAP on 8.7 ha (€2,035, of which ≈€870 is on unfarmed land);
   - fixed costs on 8.7 ha;
   - rent on 0.8 ha that produces nothing.

   To fix:
   - Farm the parcel's real area.
   - Have `farmer.js` crop the home parcel too, or say on the board that it is fallow.
   - Generate the README table from a script committed with the module so the numbers can be reproduced.

## Should fix
- **Worker wage and time compression (escalate).** A hired hand costs €110–160 per game day, which is ≈€4.7k per game year. The brief sets this rate, but it clashes with its own "annual ÷36" rule, because it is 8× cheaper than a real salary spread over a year. Once hands can run contract jobs, which pay €300–930 each, every hire prints money. This needs a design decision before workers get behaviour.
- **Loan rate is not validated.** `takeLoan(amount, {rate})` uses `opts.rate || 0.045`, and I took a loan with `rate:-0.5`, which was accepted. A negative rate makes interest a no-op (charge of a negative amount is rejected), so the loan is interest-free. Clamp the rate to a sane range, or drop the option from the public API.
- **Spot market and quotes.** `sell(item, qty)` with no sell point accepts anything, including diesel and fertiliser: you can buy at the seasonal low and dump at the high, with no saturation because depth is ∞. `price(item, spId)` returns a price for items the point does not accept (wheat at the dairy returned €188.9). It should return null/undefined.
- **`buyParcel` on land that was never for sale.** It succeeds on any `rented` parcel, including ones that were only `forRent`. Use `leaseFrom === 'forSale'` or document it as a feature.
- **Reputation saturates.** +0.02 per job means ★★★★★ within about one game year, even with 9 missed jobs on the showcase farm card (jobs_1930.png). After that the +1 offer/day bonus is permanent and there is nothing left to earn. Add diminishing returns and decay.
- **Area jobs without a location.** About 15% of plough/sow/harvest/mow offers have no `parcelId`. The "Drill 5.7 ha of winter barley" card (default_1230.png, jobs_1930.png) shows only a client, with no place to drive to. Always attach a parcel or place.
- **Year-to-year P&L noise.** On 5 ha the yearly operating result swings from −€4.4k to +€6.4k, mostly depending on which year the stored-grain sale lands in. The player will read this as random. Consider showing "harvest-year" P&L on the board.
- **Board text (default preset).**
  - Map labels are cut off: "2,3 ha · €131.1…", "2,7 ha · €148…", "2,4 ha · €560…", "1,9 ha · €47…" (default_1230.png). Drop the price on small parcels or wrap the label.
  - Several ledger memos are truncated mid-word ("Help at the sho…", "Insurance, accountant & utilities (…").
  - The price sheet says "last three seasons" but shows three *years*. Say "three harvests".
- `catchUp` caps at 72 days and silently skips the costs of any older days. This is harmless now but worth a warning log.

## What works
- **Art.** Cork board, deckled paper, ruled ledger with a red margin, handwritten notes, pinned and taped sheets, "PAID"/"ACCEPTED" stamps, painted job icons and a gouache valley map with hatched for-sale and to-let parcels, a legend and a scale bar (land_1230.png). The market sheet has seasonal-norm dashes, high/low markers and harvest glyphs (market_1230.png). The night lamp pool looks lovely (default_2330.png). This is genuine indie quality, about 8/10 for the board alone.
- **Determinism and save/load.** The same seed gives a byte-identical world (109 kB JSON). A different seed diverges. Restoring from a JSON save mid-run and continuing 36 days is byte-identical to the uninterrupted run.
- **Clean data model.** Every money change goes through one `record()`. The P&L separates operating from capital and financing. The price model is sensible: carry curve, OU walk with a shared grain factor, per-point bias and jitter, saturation integrated over the lot. Belgian flavour (CAP, registration duty, Flemish/Walloon clients) is right. Unit consistency checks out: interest is balance × rate / 36 (verified €19.50/day on €15.6k), rent is €/ha/yr ÷ 36, and fixed costs are (85 + 5/ha) monthly.
- **Performance.** The module costs next to nothing in the live game (0.006 ms), and the board is cached.
