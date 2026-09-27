# Core requests from `crops`

## 1. Registry: add `crops` (wave 2)
**What:** add `{ id: 'crops', wave: 2 }` to `src/modules/registry.js`.
**Why:** the full game does not load crops yet. Crops depends on `simulation`, and optionally on `terrain` and `environment`.
Until then, test the full game with `?only=terrain,environment,roads,simulation,ui,audio,effects,crops`.

## 2. (info, for the simulation builder / demo via the orchestrator) job progress wiring
No simulation API change is needed. Crops calls `simulation.jobs({status:'accepted', parcelId, type})` and
`simulation.reportProgress(id, delta)` when `work()` changes cells on a field with that `parcelId`:
- plough/cultivate count toward `plough` jobs,
- seed toward `sow` jobs (the crop must match),
- harvest toward `harvest` jobs,
- mow toward `mow` jobs.

At ≥ 97 % of the parcel's cells done, crops tops the job up to 1, so simulation auto-completes it.
This only works if a crops field exists on the job's parcel. **demo** should call
`crops.createField(parcel.poly, { parcelId: parcel.id, crop, stage: 'auto' })` for every NPC parcel,
and buildtools should do the same for player fields.

Please keep these simulation APIs and shapes stable: `yieldTable()` (`yield`, `straw`, `product`),
`parcel(id).soil`, `parcelAt`, `jobs(filter)` (object filter incl. `parcelId`) and `reportProgress`.
Harvest results are returned in **kg**. Simulation items are in **t**, so callers must pass `kg/1000` to
`addInventory`/`sell`.


**Integrator (iteration 2): registry entry APPLIED.**

## 3. (info, r4) CAP via `crops:worked`, contractors
- Crops no longer calls `recordFieldWork`. Every `crops:worked` carries `{fieldId, parcelId, tool, cells, areaM2}`, coalesced with `areaM2` summed.
- Contractor-applied work emits `crops:worked` with `contractor: true`. Simulation should ignore those for CAP if it already credits the booked area.
- `economy:contractor-done`: crops accepts `{parcelId|fieldId, operation, areaM2, crop?}` and the r3 `{booking}` shape. It delivers harvest/bale output with `addInventory`.
- Two requests for simulation:
  - Include `crop` in sow bookings, e.g. `hireContractor(id, 'sow', {crop})`.
  - Accept `hireContractor` on player fields, not only on parcels.
