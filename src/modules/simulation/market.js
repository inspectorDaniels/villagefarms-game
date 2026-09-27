// Market: seasonal price curves × mean-reverting random walk × per-sell-point bias × saturation.
// Pure logic operating on world.economy; installed onto the shared `sim` object.
import { hashString } from './util.js';
import { ITEMS, ITEM_ALIASES, CROPS, CONST, YEAR_DAYS, CONSUMABLES, WORK } from './data.js';

export const resolveItem = (item) => ITEM_ALIASES[item] || item;
const mod = (a, n) => ((a % n) + n) % n;
const h01 = (s) => hashString(s) / 4294967296;

/** seasonal multiplier for an item at a (possibly fractional) day of year */
export function seasonal(item, doy) {
  const it = ITEMS[item];
  if (!it || !it.amp) return 1;
  if (it.kind === 'wave') return 1 + it.amp * Math.cos((2 * Math.PI * (doy - it.peakDoy)) / YEAR_DAYS);
  // 'carry': lowest just after harvest, climbing as stores empty, easing back as the new crop nears
  const g = (d) => {
    const p = mod(d - it.harvestDoy, YEAR_DAYS) / YEAR_DAYS;
    return p < 0.8 ? p / 0.8 : 1 - (p - 0.8) / 0.2;
  };
  const v = (g(doy - 1.5) + 2 * g(doy) + g(doy + 1.5)) / 4; // soften the corners
  return 1 + it.amp * (2 * v - 1);
}

export function installMarket(sim) {
  const E = sim.world.economy;
  const api = sim.api;

  function initMarket() {
    E.prices = {};
    E.priceHistory = {};
    E.market = { walk: {}, common: 0, sat: {} };
    for (const id of Object.keys(ITEMS)) { E.market.walk[id] = 0; E.priceHistory[id] = []; }
    E.sellPoints = {};
  }

  /** reference (quoted) price: base × season × walk — no sell-point bias, no saturation */
  function refPrice(item, day) {
    const it = ITEMS[item];
    if (!it) return 0;
    const m = E.market;
    const x = (m.walk[item] || 0) + it.common * m.common;
    return it.base * seasonal(item, mod(day, YEAR_DAYS)) * Math.exp(x);
  }

  function pointMult(spId, item, day) {
    if (!spId) return 0.97; // anonymous spot sale
    const sp = E.sellPoints[spId];
    if (!sp) return 0.97;
    const bias = sp.bias && sp.bias[item] != null ? sp.bias[item] : 1 + (h01(spId + ':' + item) - 0.5) * 0.07;
    const jitter = 1 + (h01(spId + ':' + item + ':' + day) - 0.5) * 0.018;
    return bias * jitter;
  }
  /** does this buyer take the item? The anonymous spot market takes produce but no consumables. */
  function accepts(spId, item) {
    if (CONSUMABLES.includes(item)) return false;
    if (!spId) return true;
    const sp = E.sellPoints[spId];
    return !!sp && (!sp.accepts || sp.accepts.includes(item));
  }
  function satMult(s) { return 1 - CONST.saturationMaxDrop * (1 - Math.exp(-s)); }
  function satOf(spId, item) { const t = E.market.sat[spId || '_spot']; return (t && t[item]) || 0; }

  function stepMarket(day) {
    const rng = sim.rngFor('market:' + day);
    const m = E.market;
    m.common = m.common * (1 - 0.07) + rng.gauss(0, 0.017);
    for (const [id, it] of Object.entries(ITEMS)) {
      const own = it.sigma * Math.sqrt(1 - Math.min(0.8, it.common * 0.6));
      m.walk[id] = (m.walk[id] || 0) * (1 - it.theta) + rng.gauss(0, own);
    }
    // saturation recovers
    for (const t of Object.values(m.sat)) for (const k of Object.keys(t)) { t[k] *= CONST.saturationDecay; if (t[k] < 1e-3) delete t[k]; }
    recordPrices(day);
  }

  function recordPrices(day) {
    for (const id of Object.keys(ITEMS)) {
      const p = refPrice(id, day);
      E.prices[id] = +p.toFixed(ITEMS[id].base < 5 ? 3 : 2);
      const h = E.priceHistory[id] || (E.priceHistory[id] = []);
      if (h.length && h[h.length - 1][0] === day) h[h.length - 1][1] = E.prices[id];
      else h.push([day, E.prices[id]]);
      if (h.length > CONST.historyDays) h.splice(0, h.length - CONST.historyDays);
    }
    E.prices.grass = E.prices.hay;
  }

  /** run the walk for `days` days ending the day before `endDay` (used to pre-fill history) */
  function warmUp(endDay, days) {
    for (let d = endDay - days; d < endDay; d++) stepMarket(d);
  }

  Object.assign(api, {
    price(item, sellPointId) {
      item = resolveItem(item);
      if (!ITEMS[item]) return undefined;
      const day = sim.today();
      if (CONSUMABLES.includes(item)) return refPrice(item, day); // buy price (diesel, fertiliser)
      if (!accepts(sellPointId, item)) return undefined;          // this buyer doesn't take it
      return refPrice(item, day) * pointMult(sellPointId, item, day) * satMult(satOf(sellPointId, item));
    },
    priceHistory(item) { return (E.priceHistory[resolveItem(item)] || []).slice(); },
    defineSellPoint(id, def = {}) {
      if (!id) throw new Error('defineSellPoint: id required');
      E.sellPoints[id] = {
        id, name: def.name || id, x: def.x || 0, y: def.y || 0,
        accepts: Array.isArray(def.accepts) ? def.accepts.map(resolveItem) : null,
        bias: def.bias || null,
      };
      return id;
    },
    sellPoints() { return Object.values(E.sellPoints).map((s) => ({ ...s, accepts: s.accepts && s.accepts.slice() })); },
    /** sell qty units. opts.fromInventory (default true) takes the goods out of farm inventory. Returns € received. */
    sell(item, qty, sellPointId, opts = {}) {
      item = resolveItem(item);
      const it = ITEMS[item];
      if (!it || !(qty > 0)) return 0;
      const sp = sellPointId ? E.sellPoints[sellPointId] : null;
      if (sellPointId && !sp) return 0;
      if (!accepts(sellPointId, item)) return 0;
      if (opts.fromInventory !== false) qty = api.removeInventory(item, qty);
      if (!(qty > 0)) return 0;
      const day = sim.today();
      const key = sellPointId || '_spot';
      const s0 = satOf(sellPointId, item);
      const ds = Number.isFinite(it.depth) ? qty / it.depth : 0;
      const avgSat = ds > 1e-9
        ? 1 - CONST.saturationMaxDrop * (1 - (Math.exp(-s0) - Math.exp(-(s0 + ds))) / ds)
        : satMult(s0);
      const unit = refPrice(item, day) * pointMult(sellPointId, item, day) * avgSat;
      const total = unit * qty;
      if (ds > 0) { const t = E.market.sat[key] || (E.market.sat[key] = {}); t[item] = s0 + ds; }
      const where = sp ? sp.name : 'spot market';
      sim.record(total, 'sales', `Sold ${fmtQty(qty, it.unit)} ${it.name.toLowerCase()} @ €${unit.toFixed(unit < 5 ? 3 : 2)} — ${where}`, { item, qty, unit, sellPointId: sellPointId || null });
      return total;
    },
    /** buy qty units into farm inventory. Returns € spent (0 if unaffordable / no room). */
    buy(item, qty) {
      item = resolveItem(item);
      const it = ITEMS[item];
      if (!it || !(qty > 0)) return 0;
      const room = api.storageRoom(item);
      qty = Math.min(qty, room);
      if (!(qty > 0)) return 0;
      const consumable = item === 'diesel' || item === 'fertiliser';
      const unit = refPrice(item, sim.today()) * (consumable ? 1 : CONST.retailMarkup);
      const cost = unit * qty;
      const cat = item === 'diesel' ? 'fuel' : item === 'fertiliser' ? 'fertiliser' : 'purchase';
      if (!api.charge(cost, cat, `Bought ${fmtQty(qty, it.unit)} ${it.name.toLowerCase()} @ €${unit.toFixed(unit < 5 ? 3 : 2)}`)) return 0;
      api.addInventory(item, qty);
      return cost;
    },
    /** machine hours per ha by operation/tier, contractor rates, hours per working day */
    workRates() { return JSON.parse(JSON.stringify(WORK)); },
    yieldTable() {
      const out = {};
      for (const [id, c] of Object.entries(CROPS)) out[id] = { ...c, sowMonths: c.sowMonths.slice(), harvestMonths: c.harvestMonths.slice() };
      return out;
    },
    /** current input cost per hectare for a crop (fertiliser follows the fertiliser price) */
    inputCost(crop) {
      const c = CROPS[crop];
      if (!c) return undefined;
      const fIdx = (E.prices.fertiliser || ITEMS.fertiliser.base) / ITEMS.fertiliser.base;
      const r = { seed: c.seed, fertiliser: c.fertiliser * fIdx, spray: c.spray, dieselL: c.dieselL };
      r.total = r.seed + r.fertiliser + r.spray;
      return r;
    },
    /** pay for seed/fertiliser/spray for `ha` hectares of `crop`. parts: subset of ['seed','fertiliser','spray'] */
    buyInputs(crop, ha, parts) {
      const c = api.inputCost(crop);
      if (!c || !(ha > 0)) return 0;
      const which = parts || ['seed', 'fertiliser', 'spray'];
      const total = which.reduce((a, k) => a + (c[k] || 0) * ha, 0);
      if (E.money < total) return 0;
      for (const k of which) api.charge(c[k] * ha, k, `${k[0].toUpperCase() + k.slice(1)} for ${ha.toFixed(1)} ha ${CROPS[crop].name.toLowerCase()}`);
      return total;
    },
  });

  sim.market = { initMarket, stepMarket, warmUp, refPrice, recordPrices };
}

export function fmtQty(q, unit) {
  if (unit === 't') return q.toFixed(1) + ' t';
  if (unit === 'l') return Math.round(q).toLocaleString('en-GB') + ' l';
  if (unit === 'kg') return Math.round(q) + ' kg';
  return Math.round(q) + (unit === 'ea' ? '' : ' ' + unit);
}
