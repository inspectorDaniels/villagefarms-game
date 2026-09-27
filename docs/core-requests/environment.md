# Core requests from environment

## 1. Optional separate strength for cloud shadows (low priority) — APPLIED (integrator, iteration 2)
**Applied as:** `F.shadow.cloud(fn(sg, sun, view))` + `sun.cloudShadowStrength`. Environment should switch its cloud collector from `custom` to `cloud` and set `sun.shadowStrength` without the cloudCover factor.

**What:** let `F.shadow.custom` casters (or a new `F.shadow.cloud(fn)`) be composited with their own alpha, e.g. `sun.cloudShadowStrength`, instead of the single `sun.shadowStrength`.
**Why:** on partly cloudy days the brief's formula `0.45·(1−0.85·cloudCover)` softens every object shadow, even in sunlit gaps between clouds. In reality object shadows in sunny patches stay crisp, and only the cloud-covered areas lose them. Cloud shadows would read much better (more contrast between sunlit and shaded patches).
**Proposed:** in `_shadowPass`, draw customs flagged `cloud` into a second half-res buffer. Composite `max(objectShadow, cloudShadow)` by drawing the cloud buffer first with `cloudShadowStrength`, then the object buffer with `destination-out` of the cloud mask… or, more simply, accept the current union behaviour but use `sun.shadowStrength` computed without the cloudCover factor while cloud shadows carry their own density. The environment module will fill `sun.cloudShadowStrength` whenever it exists.
**Workaround now:** follow the brief's formula. Cloud shadows are visible but subtle.

## 2. Nothing blocking
The module works fully with the current core.
