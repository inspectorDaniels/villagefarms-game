# buildtools → integrator

## 1. Register the module (wave 2)
Add `{ id: 'buildtools', wave: 2 }` to `src/modules/registry.js` after `characters`.
Deps: simulation, ui (hard); buildings, crops, roads, terrain, props, animals (optional).

Verified with `?only=terrain,environment,roads,simulation,ui,audio,effects,crops,buildings,vehicles,characters,buildtools`: 34/34 checks pass, 0 console errors, 0 contract issues.

## 2. Key B
B is not bound anywhere else. buildtools handles it in an `input.on('key')` handler and refuses while driving.
If the ui ever adds a panel hotkey B, this would conflict. Note that the Build panel deliberately has no `hotkey`.


**Integrator: registry APPLIED.**
