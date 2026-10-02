# buildtools → integrator

## 1. Register the module (wave 2)
Add `{ id: 'buildtools', wave: 2 }` to `src/modules/registry.js` after `characters`.
Deps: simulation, ui (hard); buildings, crops, roads, terrain, props, animals (optional).

Verified with `?only=terrain,environment,roads,simulation,ui,audio,effects,crops,buildings,vehicles,characters,buildtools`: 34/34 checks pass, 0 console errors, 0 contract issues.

## 2. Key B
B is not bound anywhere else. buildtools handles it in an `input.on('key')` handler and refuses while driving.
If the ui ever adds a panel hotkey B, this would conflict. Note that the Build panel deliberately has no `hotkey`.


**Integrator: registry APPLIED.**

## 3. simulation: `quoteParcel(id, {mortgage})` (request to the simulation builder)
buildtools shows the mortgage deal before the player confirms. Simulation has no quote API, so `buildtools/index.js`
`mortgagePlan()` copies `buyParcel`'s formula and constants: `landFees` 0.04, `mortgageLTV` 0.75, the
loan rounded up to €100, the 15-year term, and overheads of €85 + €5/ha a month. It will drift if `data.js` changes, and the critic saw it a few cents off.

Proposed, in `simulation/land.js`, sharing its code path with `buyParcel`:
```js
/** what buyParcel(id, opts) would do now, without doing it */
quoteParcel(id, opts = {}) {
  const p = find(id);
  if (!p || p.state !== 'forSale') return null;
  const fees = p.price * CONST.landFees, total = p.price + fees, cash = sim.world.economy.money;
  const loan = opts.mortgage ? Math.ceil(Math.min(p.price * CONST.mortgageLTV, Math.max(0, total - Math.max(0, cash))) / 100) * 100 : 0;
  const ok = !sim.blocked() && cash + loan >= total;
  return { ok, price: p.price, fees, total, loan, months: CONST.mortgageMonths, cashUsed: total - loan, cashLeft: cash - (total - loan),
           monthlyOverheads: /* same formula as daily processing */ null };
}
```
Then `buyParcel` can call `quoteParcel` itself. buildtools will switch to it automatically: `mortgagePlan()` will prefer `S.quoteParcel` when it exists. Until then it keeps the copied formula.
