# demo — review round 2
Score: 6/10   Pass: no
Screenshots examined: shots/review/demo-r2/01_start.png, 03_ploughed.png, p3_05_jobs.png, p3_06_office.png
(also taken, not judged separately: 02_tutorial, p3_01_start, p3_02_tutorial, p3_04_sown, perf_play, perf_farm, perf_village, perf_overview)

Perf: measured headless with no other Chrome running, after `startGame`, each scene at 150 frames.

| scene | frameMsAvg | p95 | drawCalls | module JS |
|---|---|---|---|---|
| play (default follow camera, 24 px/m) | 9.9 | 36.8 | 105 | nothing ≥ 0.5 ms |
| farm | 5.9 | 12.0 | 132 | nothing ≥ 0.5 ms |
| village | **13.1** | 18.6 | 374 | buildings 0.5 ms (r1: 24–35 ms avg, buildings 6.6–10 ms) |
| overview | **26.9** | 70.3 | 306 | **terrain 14.2 ms, roads 6.5 ms**, buildings 2.5 ms |

Boot took 3.5–5.2 s (≤ 6 s).

Errors: 0 console or page errors in all 7 sessions.   Contract: `contracts()` = [].   Lint: `node tools/lint.js demo` → OK.

Determinism: two fresh loads gave an identical world hash (`13d615e7…`).

Save/load: the save is now 0.86–0.92 MB raw and 0.26–0.27 MB gzip (r1: 4.8 / 1.18 MB).
- In a controlled probe (hand + delegated drill job), save → reload → `loadFromStorage` → 30 frames came back identical: money, clock, jobs and ledger.
- In the long playthrough, the snapshot taken 10 frames after load showed **+€137**. That is the payment for the hand's delegated drill job (€137 is what that job paid in the fast-forward). I could not reproduce it.
- Time keeps running for 10 frames after load, so a job finishing in that window would explain it. Treat it as unconfirmed, not a defect.

## Verdict
This is a much better first hour, and all five r1 must-fixes are addressed.
- **Opening:** clear weather, 22 px/m, and the tractor is on screen with "Your tractor · F to get in" (01_start.png).
- **First field:** Lindeveldje is a 24 × 104 m strip that one sitting can plough and sow.
- **Contractor:** the plough completes "Get Lindeveldje ploughed" in 2 game days for €80.
- **Jobs board:** shows the pay breakdown (€/ha + call-out) and marks haul jobs as crew-only.
- **Starting kit:** sells for a believable €9.2k in total, so it is no longer an exploit.
- **Mechanics:** the delegated job loop pays out.

Two objective-flow defects keep it below a pass.
- **Objective 2 can get stuck.** "Plough your first strip" can never complete once the field is ploughed some other way. The game then keeps telling you to plough over the crop you just sowed (p3_06_office.png).
- **Objective 8's hint is a dead end.** The Land panel (M) cannot rent a for-rent parcel.

Both are small, but a new player following the HUD hits them.

## Player journey (first hour, new player)
Times are in engine minutes, which equal real minutes at full frame rate. Headless wall-clock was 1.2–2.4× longer.

| objective | how (real keys unless noted) | time |
|---|---|---|
| 1 Get into your tractor | walk about 30 m to the labelled tractor, F | 0.5–1.2 min |
| 2 Plough your first strip (0.06 ha) | E, then 2 passes of about 100 m | about 3 min after entering (99 % after 2 passes) |
| 3 Get Lindeveldje ploughed (≥ 90 %) | 8 serpentine passes: **84 %**, still short (north headland and west edge left) | 13.2 min for 8 passes; about 15 min with 1–2 headland passes |
| 3 (alternative) | K → Fields → "Contractor: plough €80 (1d)" | about 1 min of UI, then 2 game days |
| 4 Sow Lindeveldje (≥ 90 %) | H unhitch, hitch the drill, 8 passes (oats is now the in-season default) | 12.9 min → 91 % ✓. Seed and inputs cost about €46 (€190/ha × 0.23 ha); grouped ledger rows not inspected |
| 5 Accept a contract job | J → Accept | < 1 min |
| 6 Sell last year's wheat | K → Sell all | < 1 min, +€2,072 |
| 7 Hire a farmhand | K → Hands → Hire, then "Give to Emma" | < 1 min. The delegated 0.38 ha drill job completed and paid €137 |
| 8 Rent a second field | **not possible via M as the hint says** (see must-fix 2). Land mode (B → Land → click → Sign) works, verified in r1 | about 2 min if the player finds B |

**Total:** a player who ploughs and sows personally can finish all 8 objectives in about 35–40 real minutes. That fits the r3 brief: a first sitting of 12–15 min per operation.

**Things a new player can't do, or will struggle with:**
- If they book the contractor first (as objective 3's hint suggests), objective 2 can never complete and its "Next:" toast keeps returning.
- Objective 8 can't be done from the Land panel.
- They may stop at 84 % after the obvious passes, because the HUD % shows it but nothing points at headlands.
- I could not hitch the drill by reversing with my scripted keys (2 attempts). This is a limitation of my controller, not a verdict on the game, but reversing onto a 2.6 m hitch window with WASD will be fiddly for humans too.

**Year-1 feel:** the idle burn with old kit and one idle hand is about €165 per game day (€17,984 → €17,737 over 1.5 days). That is about €6k over a 36-day year.
- Small player jobs pay €105–190 each, and a hand finishes a 0.35 ha drill job within about 1.3 game hours.
- So 1–2 delegated jobs a day turn the year positive, which matches the r7 harness claim (solo +€2k, with a hand +€10k). I did not verify a full live year.
- Jobs expire fast: 9 offers lapsed in 4 game days. This is fine for pressure, but jobs offered at "1 day left" are hard to reach in time personally.

## Must fix
1. **The "strip" objective gets stuck** (owner: demo, `office.js` `crops:worked` handler). It only counts the player's own plough area on Lindeveldje. After a contractor (or a hand) ploughs the field, nothing is left to plough. After sowing, the only way is to destroy the crop.
   - In p3_06_office.png the HUD keeps "Plough your first strip 0 %" with a "Next:" toast telling the player to plough the field they just sowed.
   - Fix: complete or retire it when "ploughed" completes, or count the player's ploughing on any owned or rented parcel.
2. **The "Rent a second field" hint points at a panel that can't do it** (owner: ui `panels.js` Land; demo hint). In the Land panel, `STATE_LABEL` has no `forRent`, so Lindekouter, Broekweide and Leemputten show as "Farmed by a neighbour" with no button. Only `forSale` rows get "Rent".
   - The Rent dialog text there ("per day, charged each morning … end the lease at any time") also contradicts the simulation lease (monthly in advance, minimum term 1 year).
   - Fix: give `forRent` parcels a Rent action and correct the text. Until then, demo's hint should say "B → Land, click Lindekouter".

## Should fix
- **Plough objective threshold.** 8 clean passes leave 84 %, because the plough lifts at the headlands. Either count the headland as worked for objective purposes, or make the HUD hint say "finish the headlands (drive across the ends)".
- **Overview perf.** Overview is still 27 ms avg / 70 ms p95, with terrain at 14 ms and roads at 6.5 ms of JS per frame (owners: terrain/roads, low-zoom caching). Village is fixed at 13 ms; play is fine at 9.9 ms.
- **Hitching.** The drill's hitch window is 2.6 m. Consider a larger snap radius when reversing slowly, or a HUD arrow when an implement is within 5 m (owner: vehicles).
- **Wear.** The old tractor shows "Wear 56 % · Repair €1,739" in the HUD on day 1, which is 10 % of starting cash. If wear has no effect yet, hide the repair price or make the starting wear lower. If it does have an effect, tell the player.
- **Crew-only labelling.** "Plough 0.82 ha" is marked crew-only although the starting kit can plough it. Confirm the size cut-off is intended (simulation), and show the reason.
- **Kit sale.** `vehicles.sell` on the seed drill returns `false` with no reason (the pickup is correctly not an asset). Expose the reason in the UI.
- **Farmer visibility.** At 22 px/m the farmer still reads as a small ring at the farmhouse door (01_start.png). A name tag on the active character for the first minute would help.

## What works
- **All r1 must-fixes are resolved:**
  - personal haul jobs are now crew-only and labelled;
  - a small first field and an early plough milestone;
  - the sell hint points to K;
  - the granted kit resells for €5.2k (tractor) + €1.8k (plough) + €2.2k (trailer) = €9.2k, with the pickup not tradeable;
  - the opening frame shows the tractor with a label in clear weather.
- **Jobs board:** €/ha + call-out breakdown, a guaranteed small plough job near the farm (Plough 0.17 ha, €105), crew jobs labelled "delegate it to a hand" (p3_05_jobs.png).
- **Contractor booking:** €80 minimum, 2 game days, completes "ploughed". Objectives 3–7 tick in any order and the HUD strikes them through.
- **Health and persistence:** zero errors, clean contract, deterministic world, small and exact saves, boot ≤ 5.2 s, village perf fixed.
