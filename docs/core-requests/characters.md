# Core requests — characters

## 1. Register the module (registry.js)
**What:** add `{ id: 'characters', wave: 2 }` to `MODULES` in `src/modules/registry.js`.
**Why:** the full game only loads registry modules. Until then, characters (auto-spawned farmer + hired hand,
Tab switching, hand tools) can only be tested with `?only=terrain,environment,roads,simulation,ui,audio,effects,characters`.
**Proposed code:**
```js
  { id: 'characters', wave: 2 },
```


**Integrator: registry entry APPLIED (iteration 2).**
