# Brief: demo (wave 3) — the whole game

Composes the playable game from the other modules' public APIs only. Deps: terrain, environment,
roads, simulation, ui. Optional: everything else (the game must still start if any optional module failed).

## `startGame()` (called by boot when no `?showcase`)
1. `terrain.generate()` with flat areas for the farm and the village.
2. `roads.generateNetwork(plan)`: regional road through the valley with a bridge over the river,
   village streets, gravel lane to the farm, tracks to fields.
3. Parcels (`simulation.defineParcel`): ~20 fields of 1–6 ha along the valley, hedgerow-bounded;
   the player OWNS the small farmyard (0.6 ha) and RENTS one 1.8 ha field; others for sale / NPC.
4. Buildings: player farmhouse, small barn, old machine shed; village (church, café, shop,
   agricultural dealer, grain co-op = sell point, dairy = sell point, ~20 houses); 3 neighbour farms.
5. Props: hedgerows along parcel edges, poplar rows along the road, orchards, forest on the hills,
   willows by the river, fences, hay bales, power line along the road.
6. Crops: NPC fields at mixed stages for the current month; player field as stubble.
7. Animals: neighbour cows/sheep; player 6 chickens.
8. Vehicles: player old tractor + plough + small trailer + pickup; NPC machinery parked at neighbours.
9. Characters: player farmer at the farmhouse (active), 6–10 villagers; traffic on.
10. Starting jobs offered; HUD; camera follows the farmer; short tutorial toasts (keys).

Everything seeded. Also provide `showcase` presets for the final gate: `farm` (starting farm),
`village`, `overview` (valley ~3 px/m), `night`, `rain`, `autumn`, `winter`, `play` (camera following the farmer).
API: `startGame()`, `scene(name)` (stage named vantage points), `pois()` (list of points of interest).

---
## Revision r2 (director, after critic r1) — ownership of the first-hour fixes
1. **Jobs the player cannot complete are not offered as player jobs.** Owner: simulation. Offers are filtered by
   the kit the player owns/leases (no potato lifting without a root harvester, no combining without a combine).
   `transport`/`deliver` jobs have no hauling gameplay yet → they are offered only as crew jobs (delegable to a hand,
   worked abstractly) and labelled so, until a haul loop exists (future: vehicles cargo + buildings.deliver).
2. **First objectives are achievable in minutes.** Owner: demo. "Plough Lindeveldje" → a small first target
   (e.g. plough 0.25 ha yourself) plus "Get Lindeveldje ploughed" completed by any means (you, a hand, a contractor),
   with a hint naming those options. Sell objective points to the Farm office (K) sale, not trailer delivery.
3. **Starting kit is old and cheap.** Owner: demo (grants), vehicles (resale by wear/age). The free starting
   pickup/tractor/trailer resell for a realistic used value (total well below starting cash), not €24.8k.
4. **Opening frame shows what to do.** Owners: characters (`setFollowZoom(z)` / respect an external zoom — demo
   request #5) and demo (start at ~20–24 px/m, clear weather on the first morning, a world-ui marker/label on the
   tractor until it is first entered).
5. Small: seed drill defaults to an in-season crop (vehicles/demo); grain trailer not parked in the seeder's exit
   (demo); simulation coalesces seed charges into one ledger row per field per day; ui expense chip clipping.
