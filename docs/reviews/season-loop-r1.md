# season-loop — gameplay playtest r1 (critic, no code)

I played from the live demo start (`http://localhost:5173/`, day 6 = 1 March, €17,858, Lindeveldje 0.25 ha).

**How I played:** every action was a player action through keys or the UI:
- K → Fields → contractor buttons;
- K → Hands → Hire / "Give to …";
- J → Accept;
- K → Store → Sell.

Idle time was skipped with `clock.scale` (7200 = 2 game hours per real second).

**Runs:**
1. Contractor-farmed field, solo: day 6 → 35.
2. The same plus one hired hand and one job accepted and delegated per day. It continued into year 2, but my fast-forward loop missed the day-35 → 0 wrap, so the tail of that run is unreliable.
3. Hand plus one delegated job per day, no field: one full year, day 6 → day 4 of year 2.
4. Hand idle across year-end, as a control.

**Errors:** 0 console errors, 0 contract issues in all runs.

**Time scale:** 1 game day = 24 real min at 1×, 2.4 min at 10×. A year (36 days) = 14.4 h at 1×, 1.44 h at 10×. Driving times are from demo-r3, where I drove with real keys.

Screenshots: shots/review/season-loop-r1/01_ripe.png (opened).

## The loop, step by step

| step | result | owner | real time |
|---|---|---|---|
| Plough + sow Lindeveldje | **Works.** Driving it yourself took 12 + 13 min in demo-r3. A contractor costs €80 per operation (flat minimum for 0.25 ha) and finishes in 1–2 game days. Seed is charged once: 0.25 ha oats ≈ €48. | crops / simulation / demo | 26 min driving, or about 1 min of UI plus 2–5 game days |
| Crop grows | **Works.** Stages go drilled D11 → emerged D12 → tillering D14 → stem extension D18 → panicles D23 → ripe D29, with rain and overcast days in between. **But oats ripened on 3 October (D29) while its calendar says August** (`harvestMonths: [7]`, 0-based), so it was about 2 months late. Yield was **0.80 t from 0.25 ha = 3.2 t/ha**, against 6.0 t/ha in the table. | crops | sow → ripe = 19 game days = 7.6 h at 1×, 46 min at 10× |
| Ripe notice | No toast or alert that the field is ripe that I could see. The player has to watch the field or the K → Fields text. | demo / ui | — |
| **Harvest**: contractor | **Works.** K → "Contractor: harvest €80 (1d)" harvested the field the next game day. | simulation / crops | about 1 min of UI plus 1 game day |
| Harvest: crew job | **Not possible for your own field.** Crew and contract jobs are only for neighbours. K → Hands can only delegate accepted jobs. | simulation / demo | — |
| Harvest: buy or lease a combine | **Not possible in game.** There is no buy or lease UI anywhere: P = Market only lists crop prices, O lists machines to *sell*, and the dealer building has no interaction. `vehicles.purchase` and the simulation catalogue exist with no front end. | ui / vehicles / buildings | — |
| Harvest: drive it yourself | Not possible: there is no combine. | — | — |
| Where the grain goes | Straight into the **farm store** (`inventory.oats` = 0.80 t). No trailer is involved. | crops → simulation | instant |
| Sell: office K | **Works.** "Sell all (−8% pickup)": 0.8 t oats at €177/t → +€131. | demo | < 1 min |
| Sell: trailer → co-op (R) | **Can't be done.** Contractor harvest delivers to the store, and the trailer cannot be loaded from the store, so there is never cargo to deliver. The R / `buildings.deliver` path is unreachable in this loop. | vehicles / buildings / demo | — |
| Stubble → plough | **Works**, by contractor (€80) or driving. | — | as above |
| Sow the next crop in season | **Broken path.** The late oats harvest on D31 (1 Nov), plus 2 days to plough, pushes past the winter-cereal window (wheat Oct–Nov, barley Sep–Oct). K → Store & seed showed **no seed buttons** on D31 (I could not tell whether that was a script or game issue). I then booked "Contractor: sow €80": **it was accepted and sowed the drill's current crop (spring oats) in November, and the field was fully withered in year 2.** Nothing warned me. | simulation (`hireContractor` should refuse out-of-window crops), demo (office: show which crop the contractor will sow and whether it is in season) | — |
| CAP payment | Arrives on day of year 27 (1 Oct): **€112** ("0.2 ha-years worked (0.6 idle not eligible)"). It is correct per the rules but negligible at 0.25 ha. The farmyard's 0.6 ha counts as idle. | simulation | — |
| Year-end money | See below. | — | — |

## Money over a year (start €17,858)

| strategy (UI actions only) | result | r6/r7 target |
|---|---|---|
| Solo, no jobs, contractor farms Lindeveldje | D35: **€15,445–15,787 (−€2.1k to −€2.4k)** | solo ≥ start + €2k: **missed** |
| Hand + one delegated job per day (crew and player jobs), no field | one year: **€16,978 (−€880)** | hand ≥ start + €10k: **missed** |
| Hand + jobs + contractor field | D35: **€15,445 (−€2.4k)** | missed |

The field is a money loser with contractors:
- Costs: plough + sow + harvest at €80 each, seed €48 and rent €135, about €420 in total.
- Income: €131 of oats plus about €110 of CAP.

The hand costs €205 on every day she touches a job, about €7.4k a year. Delegated jobs paid €150–770 each: 21 completed in the one-year run, about €8.4k. That is roughly break-even with a naive one-per-day policy, and it does nothing to the farm itself.

A better player (2–3 jobs a day, up to the cap of 3, and driving their own field instead of hiring contractors) would do better. The simulation harness claims solo +€2k and hand +€10k. **The live UI loop does not show that a new player gets there.**

I did not test personal contracting by driving for a whole year (about 25 real min per job).

## Other questions
- **A hand working your own fields: no.** The only way is to possess the hand (Tab) and drive yourself.
  - K → Hands delegates accepted *contract* jobs only.
  - K → Fields offers contractors only.
  - No task such as "plough Lindeveldje" exists for a hand. The "hands are the scaling mechanism" design (simulation brief r3 §1) has no front end for your own land.
  - Owner: characters/vehicles (field-work AI), simulation (`assignJob` for own-field work), demo/ui (UI).
- **NPC neighbour fields are never worked.** All 36 NPC fields only grow:
  - ripe from D13;
  - **withering from D27**, with 22 of 36 fields withered by D35;
  - still withered in year 2, never ploughed or re-sown.

  By the second year the valley is a brown, dead landscape. Owner: simulation/crops (NPC farm calendar, even an abstract "neighbour harvests on day X"), demo.
- **Reason to keep playing after year 1: thin.** When the 8 objectives are done, one toast says "The farm is yours to grow". There are no further goals, milestones or unlocks.
  - The things that would carry progression are unreachable: buying or leasing machines has no UI, and hands can't farm your land.
  - What remains is renting or buying land, placing buildings (no gameplay effect seen for the coop or barn) and contract jobs.

## Gaps that hurt the season loop most (ranked)
1. **No way to buy or lease machines** (ui + vehicles/simulation catalogue). Without a combine or bigger kit the player can never harvest themselves, never use the trailer, and never grow. Add a dealer panel (catalogue, buy/lease, finance) reachable from the dealer building or a panel.
2. **Hands can't work your own fields** (characters/vehicles AI + simulation + demo UI). The designed scaling mechanic only exists for contract jobs. A minimal step: K → Fields → "Give to Emma: plough/sow/harvest" (abstract work at `workRates()` × AI factor, using your kit).
3. **Year-1 money falls under every simple strategy tried in the UI** (simulation/demo). The 0.25 ha field loses money with €80 contractor minimums; the hand roughly breaks even.
   - Re-tune for the live start: a smaller contractor minimum for tiny fields; jobs the hand completes faster or more of them; the first field's crop margin.
   - Better: make the harness drive the same UI actions.
4. **The crop calendar slips.** Oats ripened 2 months late at 53 % of table yield, which breaks the "harvest → stubble → winter crop" rotation (crops).
5. **Contractor sowing accepts an out-of-season crop** and silently kills the next crop (simulation `hireContractor` validation; demo office should show the crop and whether it is in season).
6. **NPC fields wither forever** (simulation/crops: neighbour harvest and re-sow, abstract).
7. **No ripe-crop notification**, and no in-game prompt for what to do next season, such as a seasonal planner or a "your oats are ripe — harvest within N days" toast (demo/ui).
8. **The trailer → co-op (R) sale path is unreachable:** there is no way to load the trailer from the store, and contractor harvests deliver to the store (vehicles/buildings).
9. **No goals after the tutorial** (demo): year-2 objectives such as "farm 3 ha", "buy your first parcel" or "own a combine".
