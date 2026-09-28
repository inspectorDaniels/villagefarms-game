# buildings: core and seam requests

No `src/core` changes are needed. Five seams need the integrator or the owners of other modules.

1. **registry.js: add `{ id: 'buildings', wave: 2 }`.** The full game only loads buildings today when `?only=` lists it.
2. **vehicles: `removeFuelPoint(x, y)`.** When a machine shed or dealer is demolished, its pump stays because nothing removes it. Proposed code for `vehicles/index.js`:
   ```js
   function removeFuelPoint(x, y) {
     const n = W.fuelPoints.length;
     W.fuelPoints = W.fuelPoints.filter((p) => Math.hypot(p.x - x, p.y - y) > 0.5);
     return n - W.fuelPoints.length;
   }
   ```
   buildings will call it when it is present.
3. **simulation: `removeSellPoint(id)`.** Today buildings closes the point instead: it redefines it with `accepts: []`. A real remove call would keep `sellPoints()` clean.
4. **characters: use the exact polygon in `motion.js` `collide()`.** It currently pushes characters out of the item's AABB. Buildings rotated off 90° have larger AABBs, so characters stop short of their walls near the corners. The spatial item carries `poly`/`polys`; a closest-point-on-polygon push would fix it (vehicles already does this).
5. **demo: compose the world.** It should:
   - place the start farm with `buildings.place(type, x, y, rot, { owner: 'player' })`. Without `pay`, catalog assets are granted, so a starting grain silo still counts toward capacity.
   - place the village and sell points with `{ owner: 'npc' }`.
   - place the farmhouse within 60 m of the farmhands' `home`, so they sleep at its door.


**Integrator (iteration 2): #1 registry APPLIED. #2-#4 forwarded to vehicles/simulation/characters builders; #5 goes into the demo brief.**
