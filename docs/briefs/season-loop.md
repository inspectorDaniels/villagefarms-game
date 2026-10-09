# Brief: the season loop (cross-module, director, 2026-10-09)

Source: `docs/reviews/season-loop-r1.md` (live playtest of a full year from the demo start). The first hour works;
the loop runs dry after one harvest and every simple strategy loses money. Decisions and owners below. Each owner
implements only its part; parts are null-safe so they can land in any order.

## Batch 1
**S1. Machine shop (gap 1).** Owner: **ui** (panel), using existing APIs of **vehicles** (`purchase`, `lease`, `types`,
`sell`) and **simulation** (prices, dealer finance `purchase(id,{finance:true})`, `quoteParcel`-style honest quotes).
A "Dealer" panel (and the dealer building's R prompt opens it): catalog by category with price, lease/day, upkeep,
hp/width/work rate; Buy (cash or dealer finance with real terms), Lease, delivery to the farmyard. Kit items list
their members. Refusal reasons shown.

**S2. Hands work your own fields (gap 2).** Owner: **simulation** (core), **crops** (applies work — reuse the
`economy:contractor-done` path with `source:'hand'`), later **characters** (visual), **ui** (button).
`simulation.assignFieldWork(workerId, fieldId|parcelId, operation, {crop?})` → validates kit (a free machine of the
right category, reserved per day), works at the AI rate (`workRates()`, `AI_WORK_FACTOR`) during the hand's working
hours, logs hours (day rate paid), emits progress and a done event with the area; no contractor fee, only wages +
fuel + inputs. Out-of-season sowing refused (S4). This is the farm's scaling mechanic — it must be cheaper than a
contractor on your own land once you have a hand.

**S3. Crop calendar and yield in the live game (gap 4).** Owner: **crops**. Oats sown in season ripened ~2 months
late at 53 % of table yield. Find why in the live environment (rain plan, moisture, the 0.25 ha field's soil,
day processing), fix so a reasonably managed crop ripens in its calendar month (±1 month in a dry year) at
85–105 % of table yield. Also emit a clear `crops:ripe` per field with parcelId (ui will toast it).

**S4. Season sanity (gap 5) + job deadlines.** Owner: **simulation**. Contractor/hand sowing refuses out-of-window
crops with a reason and suggests the in-season crops; `seedingWindow(crop)` helper. Player-sized job offers get 2–4
day deadlines (most now arrive with 1 day left).

**S5. Neighbour farms are alive (gap 6).** Owner: **crops** (NPC field lifecycle): npc fields are harvested within
~1 game week of ripening, stubble → worked → re-sown in the next window (abstract, no vehicles needed), so the
valley never fills with withered fields. Optional later: visible NPC machines (traffic/vehicles).

## Batch 2 (after batch 1 lands)
**S6. Notices & guidance (gap 7).** Owners: **ui** (toasts for `crops:ripe`, withering warnings, season calendar in
the office), **demo** (season tips in objectives).
**S7. Trailer → co-op (gap 8).** Owners: **buildings** (load point at farm stores: R loads the hitched trailer from
the store), **vehicles** (trailer cargo already exists).
**S8. Goals after the tutorial (gap 9).** Owner: **demo**: a milestone chain (first harvest sold, hire a hand,
first owned parcel, a second tractor, a combine, 10 ha, …) with rewards/unlock hints, matching simulation targets.
**S9. Economy re-check with player-replay (gap 3).** Owner: **simulation**: the harness replays the same actions a
player takes through the live APIs (S1/S2 included) from the demo start; re-tune only after S1–S5 land. Targets r6/r7.
**S10. Hands visible doing field work.** Owner: **characters** (+vehicles AI driving is out of scope for now: the hand
walks to the field and works abstractly, like delegated jobs).
