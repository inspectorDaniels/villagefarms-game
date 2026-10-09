# demo — review round 3
Score: 7/10   Pass: yes
Screenshots examined: shots/review/demo-r3/04_hitch_prompt.png, h_04b_prompt.png, c_land_dialog.png
(also taken: 01_start, 02_tutorial, 03_ploughed, 05_jobs, 06_office, 07_finances, perf_*)

Perf (headless, no other Chrome running, 150 frames per scene):

| scene | frameMsAvg | p95 | draw calls | notes |
|---|---|---|---|---|
| play (default follow camera, 24 px/m) | 9.3 | 23.5 | 107 | |
| farm | 5.7 | 10.8 | 108 | |
| village | 13.3 | 21.4 | 387 | |
| overview | 26.7 | 67.3 | 300 | terrain 13.9 ms + roads 6.8 ms of module JS |

Boot 3.6–3.9 s.
Errors: 0 console/page errors in 6 sessions.   Contract: [] .   Lint: `node tools/lint.js demo` → OK.
Determinism: two fresh loads hash identically (`13d615e7…`).

## Verdict
Both r2 must-fixes are fixed, and the first hour now plays end to end with real keys.
- **Ploughing:** 8 driven passes complete "Get Lindeveldje ploughed" at the 80 % threshold (88 % reached).
- **Drill swap:** H unhitches the plough. Reversing onto the drill shows the "H · Hitch seed drill" prompt at about 4 m, and H couples it.
- **Sowing:** 8 passes complete "Sow".
- **Strip objective:** "Plough your first strip" now ticks off when a contractor ploughs the field.
- **Land panel (M):** lists the to-let parcels with the real lease terms, and Rent there completes "Rent a second field".

What's left: overview perf, which belongs to terrain/roads, and some rough edges in the hitching and kit-sale UX. It's a good first session.

## Player journey (first hour)
Times are engine minutes, which equal real minutes at full frame rate. All steps use real keys or UI clicks.

| # | objective | how | time |
|---|---|---|---|
| 1 | Get into tractor | walk to the labelled tractor, F | 0.5 min |
| 2 | Plough first strip | E plus 2 passes | ✓ by 3.3 min |
| 3 | Get Lindeveldje ploughed | 8 passes; 88 % ploughed (72 stubble cells at the field ends) | 12.1 min ✓ |
| 3 alt | Contractor | K → Fields → plough, €80, 2 game days; it also ticks objective 2 | — |
| — | Plough → drill swap | H drops the plough at the field edge; drive round to face south in front of the drill, reverse straight, the prompt appears at 4.1 m, H at 2.85 m couples | 1.4–1.5 min |
| 4 | Sow Lindeveldje | 8 passes, oats is the default; 82 % sown → ✓ | 13.2 min |
| 5–7 | Accept job, sell wheat, hire hand | J, K panels; wheat +€2,136 | about 1 min total |
| 8 | Rent a second field | M → Lindekouter "To let · €555/yr" → Rent → "Sign lease" | under 1 min; first month €46 charged |

**Total:** about 29 real minutes for all 8 objectives when the player drives everything personally; "Getting started — complete" then shows.

**Seed costs:** charged once, as one grouped ledger row per field per day. Example: "Seed & inputs — 328 m² spring oats, Lindeveldje" −€6.70 (seed 1.64 / fertiliser 3.75 / spray 1.31), about €204/ha.

**What can still trip a new player:**
- **Hitching geometry.** The tractor must face away from the drill, within 60°. My first two scripted approaches arrived at 57° and 5.8 m and got no prompt; a straight reverse from about 30 m south worked. The hint "reverse onto the seed drill" is right, but nothing on screen shows which way to face.
- **Unworked field ends.** These are left untouched; objectives pass at 80 %.

## Must fix
None for demo this round.

## Should fix
1. **Kit sale UX (ui/simulation).**
   - O → Machines lists the tractor (€5,200), the plough (€1,800) and the trailer (€2,200). The seed drill is not listed at all.
   - The plough's dialog says "attached kit of the same purchase goes with it", but doesn't name the drill. Selling the plough silently sells the drill too.
   - Fix: name the drill in the dialog ("plough + 3 m seed drill, €1,800 together"), and list the drill as part of that kit.
2. **Overview perf (terrain/roads).** Still 27 ms average and 67 ms p95 at 3 px/m, driven by terrain at about 14 ms and roads at about 7 ms of module JS per frame. Village at 13.3 ms average is close to the 12 ms budget. Play is fine.
3. **Hitch aid (vehicles).**
   - While an implement is within about 8 m behind you, show a ghost line or arrow toward its hitch point, or show the prompt with "turn around" when you face the wrong way.
   - The 60° window is fine once you know the trick, but the first attempt is opaque.
4. **Field ends.** The 80 % threshold hides the unworked ends. A one-line toast on completion would teach the habit for job fields, which may need more: "Tip: drive across the ends to finish the field (headlands)".
5. **Job deadlines.** Small jobs still arrive with "1 day left" (5 of 6 cards). A personal 0.57 ha job takes about 25 min of driving, which is fine at 1×, but the deadline is easy to miss if the player saves the job for later.

## What works
- **r2 must-fixes, both verified:**
  - The strip objective ticks via the contractor.
  - The Land panel shows "To let" parcels with Rent / End lease and correct terms: "€534/ha a year … paid monthly in advance … minimum term one year, ending earlier costs the rest of that year's rent, at most three months" (c_land_dialog.png).
- **Driven first hour:** about 29 min, objectives in sensible order, HUD and "Next:" toasts accurate.
- **Hitching:** a forgiving window with a clear in-world "H · Hitch seed drill" prompt (h_04b_prompt.png). The tractor starts at 30 % wear, repair €937.
- **Economy:** starting kit resale is €9.2k (no exploit); seed charged once and grouped; job cards show €/ha + call-out with crew-only labels.
- **Health:** zero errors, clean contract, deterministic, boot under 4 s, play camera within budget.
