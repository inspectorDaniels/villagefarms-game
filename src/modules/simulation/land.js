// Land parcels: buy / rent / lease end / sell, rent and CAP payments.
import { CONST, YEAR_DAYS } from './data.js';

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const lerp = (a, b, t) => a + (b - a) * t;
const STATES = ['owned', 'rented', 'forSale', 'forRent', 'npc'];

export function installLand(sim) {
  const L = sim.world.land;
  const api = sim.api;

  function initLand() { L.parcels = []; L.nextId = 1; }

  const find = (id) => L.parcels.find((p) => p.id === id);
  const changed = (p, from) => { sim.world.economy.version++; sim.emit('land:parcel-changed', { id: p.id, state: p.state, from, parcel: { ...p } }); };

  sim.landValue = () => L.parcels.reduce((a, p) => a + (p.state === 'owned' ? p.price : 0), 0);
  sim.farmedHa = () => L.parcels.reduce((a, p) => a + (p.state === 'owned' || p.state === 'rented' ? p.area / 1e4 : 0), 0);

  Object.assign(api, {
    /** poly in metres; soil = quality 0..1 (or {quality}). Returns parcel id. */
    defineParcel(def = {}) {
      const poly = (def.poly || []).map((p) => [+p[0], +p[1]]);
      if (poly.length < 3) throw new Error('defineParcel: poly needs ≥ 3 points');
      const soilQ = Math.max(0, Math.min(1, typeof def.soil === 'object' && def.soil ? +def.soil.quality : def.soil != null ? +def.soil : 0.6));
      const area = polyArea(poly);
      const ha = area / 1e4;
      const rentPerHaYear = lerp(CONST.rentPerHaYear[0], CONST.rentPerHaYear[1], soilQ);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const id = def.id || `simulation:parcel:${L.nextId++}`;
      const p = {
        id, name: def.name || `Parcel ${L.parcels.length + 1}`, poly, area: Math.round(area),
        state: STATES.includes(def.state) ? def.state : 'npc',
        soil: +soilQ.toFixed(2),
        price: def.price != null ? +def.price : Math.round((ha * lerp(CONST.landPerHa[0], CONST.landPerHa[1], soilQ)) / 100) * 100,
        rentPerDay: def.rentPerDay != null ? +def.rentPerDay : Math.round((ha * rentPerHaYear / YEAR_DAYS) * 100) / 100,
        rentPerHaYear: Math.round(rentPerHaYear),
        owner: def.owner || null, crop: def.crop || null,
        center: centroid(poly), bbox: [x0, y0, x1, y1], since: sim.today(),
      };
      const old = L.parcels.findIndex((q) => q.id === id);
      if (old >= 0) L.parcels[old] = p; else L.parcels.push(p);
      changed(p, null);
      return id;
    },
    parcels() { return L.parcels.slice(); },
    parcel(id) { return find(id) || null; },
    parcelAt(x, y) {
      for (const p of L.parcels) {
        const b = p.bbox;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (inside(p.poly, x, y)) return p;
      }
      return null;
    },
    /** buy (for sale or currently rented). Price + transfer tax/notary. */
    buyParcel(id) {
      const p = find(id);
      if (!p || !(p.state === 'forSale' || p.state === 'rented')) return false;
      const fees = p.price * CONST.landTransferTax;
      if (!api.canAfford(p.price + fees)) return false;
      api.charge(p.price, 'land', `Bought ${p.name} (${(p.area / 1e4).toFixed(2)} ha)`);
      api.charge(fees, 'land', `Registration duty & notary — ${p.name}`);
      const from = p.state; p.state = 'owned'; p.since = sim.today(); changed(p, from);
      return true;
    },
    /** rent a parcel that is forSale or forRent; rent is charged daily. */
    rentParcel(id) {
      const p = find(id);
      if (!p || !(p.state === 'forSale' || p.state === 'forRent')) return false;
      if (!api.canAfford(p.rentPerDay * 3)) return false; // one month's deposit-worth of cash required
      const from = p.state; p.state = 'rented'; p.leaseFrom = from; p.since = sim.today(); changed(p, from);
      return true;
    },
    endLease(id) {
      const p = find(id);
      if (!p || p.state !== 'rented') return false;
      p.state = p.leaseFrom || 'forRent'; p.since = sim.today(); changed(p, 'rented');
      return true;
    },
    sellParcel(id) {
      const p = find(id);
      if (!p || p.state !== 'owned') return 0;
      const v = p.price * CONST.landResale;
      api.credit(v, 'landSale', `Sold ${p.name}`);
      p.state = 'forSale'; p.since = sim.today(); changed(p, 'owned');
      return v;
    },
    /** true when the point lies on land the player owns or rents */
    canUse(x, y) { const p = api.parcelAt(x, y); return !!p && (p.state === 'owned' || p.state === 'rented'); },
  });

  function landDay(day) {
    const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
    for (const p of L.parcels) if (p.state === 'rented') api.charge(p.rentPerDay, 'rent', `Rent — ${p.name}`, { force: true });
    if (doy === CONST.capPaymentDayOfYear) {
      const ha = sim.farmedHa();
      if (ha > 0) api.credit(ha * CONST.capPaymentPerHa, 'subsidy', `CAP basic payment & eco-scheme, ${ha.toFixed(1)} ha`);
    }
  }

  sim.land = { initLand, landDay };
}
