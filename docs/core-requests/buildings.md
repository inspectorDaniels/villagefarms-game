# buildings: core and seam requests

No `src/core` changes are needed. Five seams need the integrator or the owners of other modules.

1. **registry.js: add `{ id: 'buildings', wave: 2 }`.** The full game only loads buildings today when `?only=` lists it.
2. **vehicles: `removeFuelPoint`.** Done; buildings uses it on demolition.
3. **simulation:** Done. `removeSellPoint`, the `buildings` ledger category and `releaseAsset({writeOff})` are all used.
4. **characters: use the exact polygon in `motion.js` `collide()`.** It currently pushes characters out of the item's AABB. Buildings rotated off 90° have larger AABBs, so characters stop short of their walls near the corners. The spatial item carries `poly`/`polys`; a closest-point-on-polygon push would fix it (vehicles already does this).
5. **demo: compose the world.** It should:
   - place the start farm with `buildings.place(type, x, y, rot, { owner: 'player', grant: true })`. Since r2 granting is opt-in: `grant: true` gives capacity and upkeep but no resale value.
   - place the village and sell points with `{ owner: 'npc' }`.
   - place the farmhouse within 60 m of the farmhands' `home`, so they sleep at its door.


**Integrator (iteration 2): #1 registry APPLIED. #2-#4 forwarded to vehicles/simulation/characters builders; #5 goes into the demo brief.**
