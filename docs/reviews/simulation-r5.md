# simulation — review round 5
Score: 7/10   Pass: yes
Screenshots examined:
- shots/simulation/review-r5/default_1230.png. The other 15 showcase shots were checked through their JSON only.
- shots/review/simulation-r5/game_live.png and game_live2.png: my own puppeteer runs. I defined 2 owned parcels with crops fields, ploughed a strip through `crops.work`, and booked a contractor for half of field 2. I possessed Dries while a job was delegated to him, then ran about 1.5 game days.
- shots/review/simulation-r5/game.png (12:30), checked through its JSON only.

Perf:
- Showcase: frameMsAvg 0.13–0.35, p95 0.2–0.4, drawCalls 2–5, module msAvg 0.02–0.07.
- Full game: frameMsAvg 5.66, p95 22.9, drawCalls 56, simulation msAvg 0.014. The machine is shared; this is not the module's cost.

Errors: 0 console and 0 page errors (16 showcase shots, the game shot, 2 live runs).
Contract: 0 issues. `workerDayCost` is in the manifest, README and implementation.
Lint: OK.

## Verdict
Every r4 must-fix now holds in the live browser, not just in the harness.

| r4 must-fix | what I saw live | result |
|---|---|---|
| **CAP double count** | A 0.5 ha contractor plough on a 1.0 ha owned parcel leaves `capShare` at **0.50** after crops applied the booking. It was 1.00 in r4. A driven 3 m strip still gives 0.039, so the crops wiring works end to end. | fixed |
| **Possessed hand** | `characters.isAvailable(worker)` is **false** while Dries is possessed. His delegated "Mind livestock, 8 h" made no progress all day. Wages still settle at the €180 day rate from `possessed` hours, and the character's `workerId` is now linked. | fixed |
| **r4c ordering** | At ×1 the builder median is €303k, 8/8 seeds in €250–400k. The order is builder > renter > smallfarm > contractor > jobs (303/243/176/112/98). At ×0.5 and ×2, builder > renter > smallfarm and builder > jobs both hold (246/195/170 vs 98; 318/269/180 vs 98). | fixed |
| **Harness** | 29/29 probes closed, reproduced from the default command. | fixed |

The economy now does what the brief asks:
- contracting levels off;
- hands scale the farm;
- owning beats renting;
- CAP follows real work;
- insolvency has a sized, one-time exit.

What is left is small and about player-facing edges, not holes in the economy.

**Is the write-off a reset exploit?** Mostly no, but there is one small leak. The bank seizes machines, then stored produce, then land (at 85 %), before any write-off. It forgives only the overdraft beyond what an annuity of a third of the farm's income can carry, and it does so once. A farm that defaults loses everything it owns and spends 95–140 game days (38–56 real hours at 1×) blocked or over the limit.

The leak is diesel and fertiliser: they are never seized. My probe (3 seeds) did this:
1. took the whole credit line on a 3-month loan (€31k);
2. put all the cash into 37,800 l of diesel;
3. let the instalments run the account into overdraft and waited for the restructuring.

The bank wrote off €26–27k and restructured €21k. The farm ended with −€21k cash-minus-debt, plus €47k of diesel. The baseline ended at +€11–13k. That is about **+€13–15k of value, paid out as seven years of tractor fuel**, and it costs years of blocked play. It isn't an attractive reset, but the rule should be closed.

## Must fix
None blocking.

## Should fix
- **Diesel and fertiliser escape seizure, so the write-off can be banked as fuel.** Include consumables in `seizeOne()` at a heavy discount (they can't be resold, e.g. 50 %). Alternatively, count consumables bought in the 60 days before insolvency against the write-off. Add the probe above to `exploits.mjs`.
- **A delegated job fails without warning when the player possesses the hand.** Live: "Mind livestock, 8 h" was assigned to Dries. I possessed him all day, and the job went to `failed` with a −€15 penalty and a reputation hit, with no message. The skip itself is right. But when a possessed hand holds a delegated job with a deadline, emit a warning, or hand the job back to the player (`assignee: null`) so the UI can show it.
- **The harness still prints the strict chain at ×0.5 and ×2.** At ×0.5 it says "r4c ordering … no", which reads as a failure even though the relaxed r4c rule holds. Print the r4c rule per factor, as the director asked.
- **Restructuring comes very late.** 60 days to the first seizure, plus 33 days of "nothing left", is about 2.6 game years of a farm that can't act. It is harmless for balance, but a player will read it as a soft-lock. Consider shortening it, and have the UI show the countdown (`solvency()` already has the data).
- `workerDayCost` exists, but nothing shows "Dries is on the clock today (+€145)" when the player presses Tab yet. That is the UI and characters owners' job, and it is worth a core request.

## What works
- **Live wiring end to end.** Work driven through crops sets `capShare`. Contractor bookings change fields and are credited once. `logWork` comes from characters and settles day rate or retainer. `isAvailable` respects possession, and delegated jobs respect it too.
- **Harness integrity.** 29/29 probes pass. The progression reproduces with r4b/r4c targets at ×1, and the milestones hold: hand in year 2, parcel in year 3, combine in year 6, 44 ha by year 8.
- **Insolvency is now a real system.** It warns, blocks, seizes machines, then stock, then land, lays off hands, restructures once to what the farm can carry, and then declares bankruptcy (rent stops, and the block lifts once cash is positive).
- **Engine and board.** The engine is deterministic and cheap. The board is still the best-looking screen in the game (default_1230.png).
