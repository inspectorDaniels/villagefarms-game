// crops — neighbour (NPC) farm calendar. Abstract: no vehicles, whole-field operations through
// model.workField, at most one operation per field per game day, deterministic from (field id, day).
//   ripe → harvested within 1–5 days (grass: mown, baled the next day)  → straw baled or left
//   stubble / bare → ploughed or cultivated a few days before the next crop's sowing window
//   window open → sown + fertilised; sprayed and top-dressed once while growing
//   withered (should not happen, e.g. after a long pause) → cleared like a harvest
// Rotation follows a common Belgian arable sequence; grass fields stay grass (permanent meadow).
import { S, CROPS, YEAR_DAYS, MONTH_DAYS, monthOfDoy, inSowWindow } from './data.js';

const ROTATION = {
  rapeseed: ['wheat', 'barley'],
  wheat: ['barley', 'sugarBeet', 'potatoes', 'maize', 'oats'],
  barley: ['rapeseed', 'sugarBeet', 'maize', 'wheat'],
  oats: ['wheat', 'rapeseed', 'barley'],
  maize: ['wheat', 'barley', 'oats'],
  potatoes: ['wheat', 'barley'],
  sugarBeet: ['wheat', 'barley', 'oats'],
  none: ['wheat', 'barley', 'rapeseed', 'oats', 'maize', 'sugarBeet', 'potatoes'],
};

function h01(str, day) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= day * 2654435761;
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** days from doy until the crop's next sowing window opens (0 = open today) */
function daysToWindow(crop, doy) {
  for (let d = 0; d < YEAR_DAYS; d++) if (inSowWindow(crop, doy + d)) return d;
  return YEAR_DAYS;
}

export function createNpc(model) {
  const { W } = model;

  /** choose the next crop: the first rotation candidate whose window opens within 9 days, else the soonest */
  function nextCrop(prev, doy, f) {
    const list = ROTATION[prev] || ROTATION.none;
    // each neighbour picks its own candidate (deterministic per field and year); a spring crop after a summer
    // harvest simply means winter stubble/fallow, as on real farms. Fall back to the soonest window.
    const pick = list[Math.floor(h01(f.id, Math.floor(doy / YEAR_DAYS) * 7 + list.length + (W.fields.indexOf(f) % 5)) * list.length)];
    if (pick && daysToWindow(pick, doy) <= 30) return pick;
    let best = list[0], bd = 99;
    for (const c of list) { const d = daysToWindow(c, doy); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /** one decision for one field on `day`; returns the operation done (or null) */
  function step(f, day) {
    const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    const N = f.npc || (f.npc = { ripeSince: null, next: null, last: null, sprayed: false, topped: false });
    const C = f.counts, n = f.nCells || 1;
    const crop = f.crop;
    const grass = crop === 'grass' || (N.next === 'grass');
    const r = h01(f.id, day);
    const op = (tool) => { model.workField(f.id, tool, { report: false, quiet: true }); N.last = day; return tool; };

    // ---- harvest
    if (C[S.RIPE] >= n * 0.5) {
      if (N.ripeSince == null) N.ripeSince = day;
      const wait = 1 + Math.floor(h01(f.id, N.ripeSince) * 5);       // 1–5 days after ripening
      if (day - N.ripeSince >= wait) { N.ripeSince = null; N.prev = crop; N.sprayed = false; N.topped = false; return op(crop === 'grass' ? 'mow' : 'harvest'); }
      return null;
    }
    N.ripeSince = null;
    if (C[S.WITHERED] >= n * 0.3) { N.prev = N.prev || crop || null; return op('harvest'); }
    // grass: bale the cut swath, otherwise let it grow
    if (C[S.MOWN] + C[S.WINDROW] >= n * 0.3) return op('bale');
    // ---- growing crop: one spray, one top dressing
    if (C[S.SOWN] >= n * 0.5) {
      if (crop === 'grass') return null;
      if (!N.sprayed && f.growth > 0.1) { N.sprayed = true; return op('spray'); }
      if (!N.topped && f.growth > 0.35) { N.topped = true; return op('fertilise'); }
      return null;
    }
    // ---- bare ground (stubble / cultivated / ploughed / grass sward): prepare and re-sow
    if (grass || C[S.GRASS] >= n * 0.5) { if (C[S.GRASS] >= n * 0.5 && monthOfDoy(doy) >= 4 && monthOfDoy(doy) <= 7 && r < 0.15) return op('mow'); return null; }
    if (!N.next) N.next = nextCrop(N.prev || 'none', doy, f);
    const wait = daysToWindow(N.next, doy);
    if (wait > 12) return null;                                       // fallow until a few days before the window
    if (C[S.STUBBLE] >= n * 0.3) return op(r < 0.6 ? 'plough' : 'cultivate');
    if (C[S.PLOUGHED] >= n * 0.3 && wait > 0 && wait <= 2) return op('cultivate');
    if (wait === 0 && (C[S.CULTIVATED] + C[S.PLOUGHED]) >= n * 0.5) {
      const crop2 = N.next;
      N.next = null; N.sprayed = false; N.topped = false;
      model.workField(f.id, 'seed:' + crop2, { report: false, quiet: true });
      model.workField(f.id, 'fertilise', { report: false, quiet: true });
      N.last = day;
      return 'seed:' + crop2;
    }
    return null;
  }
  return { step, nextCrop, daysToWindow };
}
