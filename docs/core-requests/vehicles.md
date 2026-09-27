# Core requests from `vehicles`

## 1. Object shadows come out lighter than the ground under cloud shadow
**What:** `renderer._shadowPass` cuts object shadows out of the cloud buffer (`destination-out`) and
composites the object buffer with `sun.shadowStrength`. When `sun.cloudShadowStrength` is larger
than `shadowStrength` (the environment currently sends 0.5 vs 0.26 at 11:30 under cloud), every
object shadow inside a cloud shadow is *lighter* than the ground around it — vehicles, trees and
houses show pale "halo" shadows.
**Why:** visible in `shots/vehicles/wip/default_1000.png` and `closeup.png` (pale patches up-left of each machine).
**Proposed code:** composite the object buffer with `max(shadowStrength, cloudShadowStrength)` where
it overlaps the cloud buffer, or simpler: `g.globalAlpha = Math.max(strength, cloudStrengthIfAnyCloud)`;
alternatively cut with a partial alpha: `cg.globalAlpha = Math.min(1, strength / cs)` before the
`destination-out` draw, so the union is never lighter than either.

## 2. (nice to have) Oriented colliders in `spatial`
**What:** support `item.poly` (convex polygon) in `queryCircle`'s precise test, falling back to the AABB.
**Why:** vehicles insert an AABB (with `data.polys` holding the true oriented boxes). Characters'
`motion.js` only sees the AABB, so a diagonal combine blocks walking in its AABB corners.
Vehicles themselves already test the polygons (SAT).
**Proposed code:** in `Spatial.queryCircle`, `if (it.poly) return polyCircleOverlap(it.poly, x, y, r) && (!filter || filter(it));`

## 3. Register `vehicles` in `src/modules/registry.js` (wave 2, after simulation/crops, before characters)
