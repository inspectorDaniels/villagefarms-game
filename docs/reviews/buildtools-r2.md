# buildtools — review round 2
Score: 7/10   Pass: yes
Screenshots examined: shots/review/buildtools-r2/r2_mortgage_dialog.png (the round-1 shots in shots/review/buildtools-r1/ still apply to the ghost and land-mode visuals)
Perf: full game with demo, land mode at 3 px/m: frameMsAvg=35.4, p95=61.4, drawCalls=195, buildtools msAvg=0.39 (status ok).

The frame total comes from the whole game, with demo loaded and other agents running on the same box. buildtools' share is under 0.4 ms.

Errors: 0 console or page errors.   Contract: `contracts()` is empty.   Lint: OK.   Builder test: 48/48 in my rerun.

Probe: `scratchpad/buildtools-critic-r1/r2.cjs`, plain `http://localhost:5173/` with demo registered. The map is now fully parcelled, so the probe:
- defines its own test parcels at (740, 700);
- moves them to the front of the parcel list;
- clears the crops fields in that area.

## Round-1 must-fixes: verified
| # | issue | r2 result |
|---|---|---|
| 1 | duplicate tracks charged again | **Fixed.** A→B again, B→A, and a 1 m parallel are all refused with "already a track". A 6 m parallel and a crossing track are still allowed. Money charged was exactly the 3 legitimate tracks (€1,134). |
| 2 | track 4.5 m into neighbour land | **Partly fixed.** The original repro (start on a road node, end 4.5 m into npc land) is now refused with "not your land". A variant still gets through; see Must fix 1. |
| 3 | mortgage dialog misstated | **Fixed.** The hover reason and the dialog give the real figures: "loan €42,400, cash spent €20,000, cash left €0.00", plus a low-cash/overdraft warning. Cancel leaves money and parcel state unchanged. The confirmed buy matches the quote. |
| 4 | `rotate(NaN/'x'/∞)` poisoned state | **Fixed.** Rotation stays at 0, R still rotates, and a building places normally afterwards. |
| 5 | undo history survived `load()` | **Fixed.** After `load()`: undo list 0, corners 0, chain null, and Z gives "nothing to undo". |

Round-1 should-fixes I checked are also done:
- **Undo after the asset was released** no longer double-refunds. Refund is 0, and the net result is −€700, which is just the book-value loss.
- **First field corner inside an existing field** is refused at once with "no free area left in this parcel".
- **Corners on the parcel boundary** snap slightly inside the parcel and are accepted.
- **`select('building', 'nope:9')`** returns false.
- **Junk API input** (select(null), placeAt('a'), preview(NaN), enter({}), load('x'), cancel, undo) never throws.

## Verdict
This round fixes the money bugs. I can no longer double-pay for tracks, undo can't be farmed, the mortgage tells the truth before it empties the farm account, and bad API input can't brick the tool. The flows I broke in round 1 now hold up when played in the full demo-loaded game, with zero errors and a clean contract.

One rules hole is left in the track tool. Your own track counts as an anchor for the "joining the road network" excuse, so you can still lay a few metres of gravel onto a neighbour's field. It has no money value, but it breaks the land-rights rule and should close next round.

The visuals are still basic (flat-rectangle ghost, land labels under the toasts), but they read clearly enough for play.

## Must fix
1. **Your own track nodes still excuse off-land segments, so short trespass is possible.**
   - `anchored(e)` accepts any node, including a node of the player's own `track`. Samples within `NODE_SNAP_M + 1` of an anchored end are excused.
   - Repro:
     1. Lay a track ending 1 m inside your boundary, at (X+10, Y+39).
     2. From that node, lay a segment to (X+12, Y+42.5), which is 2.5 m into the npc parcel. It is accepted and charged.
     3. Continue the chain one more step. It is accepted again: the end sits at Y+46.5, **6.5 m deep** in neighbour land.
   - Steps after that are refused. Probe keys: `tres2`, `chain`.
   - Fix: count only nodes or edges of non-`track` (public) roads as anchors, and excuse only the off-land stretch between that anchor and your land.

## Should fix
- **The mortgage quote copies simulation's constants** (0.75 LTV, 4 % fees, overheads 85 + 5/ha, 15 years) instead of reading them. If simulation retunes, the dialog will lie again. Read them from simulation if it exposes them, or ask simulation for a quote API.
- **Small quote mismatch in the screenshot.** The quote says "cash spent €20,000.00" while the balance shows €20,000.74. The preview cache key rounds money to €1, so the figures can be cents stale. Recompute when the dialog opens.
- **Land-mode labels still sit under the toast stack** (r2_mortgage_dialog.png: "…for sale · 1.00", "mortgage: €42,400…" clipped behind the toasts on the right). Clamp the labels to the free screen area.
- **The ghost is still a flat tinted rectangle** with no door or orientation cue (round-1 note).

## What works
- **Track rules:** duplicate and parallel tracks are refused, while legitimate parallel and crossing tracks are still allowed. Charges were exact in every case.
- **Land-mode buy flow:** the dialog is honest about the loan and gives a clear low-cash warning. Cancel and Esc are safe.
- **Undo is robust:** it is cleared on load, can't double-refund after an asset is released, and stuck entries are dropped.
- **Field drawing:** it goes red early inside occupied parcels, and boundary corners snap inside.
- **Zero errors, clean contract, lint OK, 48/48 builder test**, and the module costs under 0.4 ms per frame.
