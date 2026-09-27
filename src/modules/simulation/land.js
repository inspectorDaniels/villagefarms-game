// Land: parcels, a small land market (scarce listings that come and go), leases with monthly
// rent in advance and a one-year minimum term, purchases, appreciation via a regional land
// index, and the CAP payment pro rata by days held.
import { CONST, YEAR_DAYS, MONTH_DAYS } from './data.js';

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
const doyOf = (d) => ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;

export function installLand(sim) {
  const L = sim.world.land;
  const api = sim.api;

  function initLand() { L.parcels = []; L.nextId = 1; L.index = 1; L.capHaDays = 0; L.indexHistory = []; }

  const find = (id) => L.parcels.find((p) => p.id === id);
  const changed = (p, from) => { sim.world.economy.version++; sim.emit('land:parcel-changed', { id: p.id, state: p.state, from, parcel: { ...p } }); };
  const ha = (p) => p.area / 1e4;
  const monthRent = (p) => (p.lease ? p.lease.rentPerHaYear : p.rentPerHaYear) * ha(p) / 12;

  function reprice(p) {
    p.price = Math.round((ha(p) * p.valuePerHa * L.index) / 100) * 100;
    // current asking rent (a running lease keeps the rate it was signed at, in p.lease)
    p.rentPerHaYear = Math.round(p.rentBasePerHa * L.index);
    p.rentPerDay = Math.round((ha(p) * p.rentPerHaYear / YEAR_DAYS) * 100) / 100;
  }

  sim.landValue = () => L.parcels.reduce((a, p) => a + (p.state === 'owned' ? p.price : 0), 0);
  sim.farmedHa = () => L.parcels.reduce((a, p) => a + (p.state === 'owned' || p.state === 'rented' ? ha(p) : 0), 0);

  function exitCost(p) {
    if (!p || p.state !== 'rented' || !p.lease) return 0;
    const today = sim.today();
    if (today >= p.lease.minEnd) return 0;
    const unpaidDays = Math.max(0, p.lease.minEnd - Math.max(today, p.lease.paidUntil));
    const annual = p.lease.rentPerHaYear * ha(p);
    return Math.round(Math.min((unpaidDays / YEAR_DAYS) * annual, (CONST.leaseEarlyExitMonths / 12) * annual) * 100) / 100;
  }

  Object.assign(api, {
    /** poly in metres; soil = quality 0..1 (or {quality}). Returns parcel id.
     *  opts: state, name, owner, price (market value now), rentPerHaYear, tradeable (default true: may be listed by the land market) */
    defineParcel(def = {}) {
      const poly = (def.poly || []).map((p) => [+p[0], +p[1]]);
      if (poly.length < 3) throw new Error('defineParcel: poly needs ≥ 3 points');
      const soilQ = Math.max(0, Math.min(1, typeof def.soil === 'object' && def.soil ? +def.soil.quality : def.soil != null ? +def.soil : 0.6));
      const area = polyArea(poly);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const id = def.id || `simulation:parcel:${L.nextId++}`;
      const hectares = area / 1e4;
      const p = {
        id, name: def.name || `Parcel ${L.parcels.length + 1}`, poly, area: Math.round(area),
        state: STATES.includes(def.state) ? def.state : 'npc',
        soil: +soilQ.toFixed(2),
        valuePerHa: def.price != null ? def.price / Math.max(1e-6, hectares) / L.index : lerp(CONST.landPerHa[0], CONST.landPerHa[1], soilQ),
        rentBasePerHa: def.rentPerHaYear != null ? def.rentPerHaYear / L.index : lerp(CONST.rentPerHaYear[0], CONST.rentPerHaYear[1], soilQ),
        owner: def.owner || null, crop: def.crop || null, tradeable: def.tradeable !== false,
        center: centroid(poly), bbox: [x0, y0, x1, y1], since: sim.today(), listedUntil: null, lease: null,
      };
      reprice(p);
      if (p.state === 'rented') p.lease = { start: sim.today(), minEnd: sim.today(), paidUntil: sim.today(), rentPerHaYear: p.rentPerHaYear };
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
    /** buy a parcel listed for sale: market value + 4 % fees.
     *  opts.mortgage: borrow up to 60 % of the price over 15 years, secured on the parcel; you bring the
     *  other 40 % + fees in cash (the bank will not lend the deposit). */
    buyParcel(id, opts = {}) {
      const p = find(id);
      if (!p || p.state !== 'forSale') return false;
      const fees = p.price * CONST.landFees;
      if (opts.mortgage) {
        const loan = Math.ceil(Math.min(p.price * CONST.mortgageLTV, Math.max(0, p.price + fees - Math.max(0, sim.world.economy.money))) / 100) * 100;
        if (sim.world.economy.money + loan < p.price + fees) return false;
        if (loan > 0) sim.economy.securedLoan(loan, CONST.mortgageMonths, `Mortgage on ${p.name}`);
      }
      if (!api.canAfford(p.price + fees)) return false;
      api.charge(p.price, 'land', `Bought ${p.name} (${ha(p).toFixed(2)} ha)`);
      api.charge(fees, 'land', `Notary & fees — ${p.name}`);
      const from = p.state; p.state = 'owned'; p.since = sim.today(); p.listedUntil = null; p.owner = null; changed(p, from);
      return true;
    },
    /** rent a parcel offered to let. The first month's rent is paid now (in advance); minimum term one year. */
    rentParcel(id) {
      const p = find(id);
      if (!p || p.state !== 'forRent') return false;
      const first = monthRent(p);
      if (!api.charge(first, 'rent', `Rent in advance — ${p.name}`)) return false;
      const today = sim.today();
      p.lease = { start: today, minEnd: today + CONST.leaseMinDays, paidUntil: today + MONTH_DAYS, rentPerHaYear: p.rentPerHaYear };
      const from = p.state; p.state = 'rented'; p.since = today; p.listedUntil = null; changed(p, from);
      return true;
    },
    /** € it would cost to end this lease today (0 once the minimum term is served) */
    leaseExitCost(id) { return exitCost(find(id)); },
    /** hand a rented parcel back; before the minimum term ends this costs min(rest of term, 3 months' rent) */
    endLease(id) {
      const p = find(id);
      if (!p || p.state !== 'rented') return false;
      const fee = exitCost(p);
      if (fee > 0) api.charge(fee, 'rent', `Early lease termination — ${p.name}`, { force: true });
      p.state = 'npc'; p.lease = null; p.since = sim.today(); reprice(p); changed(p, 'rented');
      return true;
    },
    /** sell owned land for 97 % of market value */
    sellParcel(id) {
      const p = find(id);
      if (!p || p.state !== 'owned') return 0;
      const v = p.price * CONST.landResale;
      api.credit(v, 'landSale', `Sold ${p.name}`);
      p.state = 'npc'; p.owner = 'a neighbour'; p.since = sim.today(); changed(p, 'owned');
      return v;
    },
    /** true when the point lies on land the player owns or rents */
    canUse(x, y) { const p = api.parcelAt(x, y); return !!p && (p.state === 'owned' || p.state === 'rented'); },
    /** regional land market state */
    landMarket() {
      return {
        index: L.index, indexHistory: L.indexHistory.slice(),
        forRent: L.parcels.filter((p) => p.state === 'forRent').map((p) => p.id),
        forSale: L.parcels.filter((p) => p.state === 'forSale').map((p) => p.id),
        capAccruedHa: L.capHaDays / YEAR_DAYS,
      };
    },
  });

  function landDay(day) {
    const doy = doyOf(day);
    // rent: monthly, in advance
    for (const p of L.parcels) {
      if (p.state !== 'rented' || !p.lease) continue;
      while (p.lease.paidUntil <= day) {
        api.charge(monthRent(p), 'rent', `Rent — ${p.name}`, { force: true });
        p.lease.paidUntil += MONTH_DAYS;
      }
    }
    // CAP accrues per hectare-day held; paid once a year, pro rata
    L.capHaDays += sim.farmedHa();
    if (doy === CONST.capPaymentDayOfYear) {
      const haYears = L.capHaDays / YEAR_DAYS;
      if (haYears > 0.01) api.credit(haYears * CONST.capPaymentPerHa, 'subsidy', `CAP payment, ${haYears.toFixed(1)} ha-years held`);
      L.capHaDays = 0;
    }
    if (doy % MONTH_DAYS === 0) monthly(day);
  }

  function monthly(day) {
    const rng = sim.rngFor('land:' + day);
    const g = Math.log(1 + CONST.landGrowthYear) / 12;
    L.index *= Math.exp(g + rng.gauss(0, CONST.landGrowthSd));
    L.indexHistory.push([day, +L.index.toFixed(4)]);
    if (L.indexHistory.length > 120) L.indexHistory.shift();
    for (const p of L.parcels) reprice(p);
    // listings come and go
    for (const p of L.parcels) {
      if ((p.state === 'forRent' || p.state === 'forSale') && p.listedUntil != null && day > p.listedUntil) {
        const from = p.state; p.state = 'npc'; p.listedUntil = null; changed(p, from);
      }
    }
    const pool = L.parcels.filter((p) => p.state === 'npc' && p.tradeable);
    const nRent = L.parcels.filter((p) => p.state === 'forRent').length;
    const nSale = L.parcels.filter((p) => p.state === 'forSale').length;
    const list = (state) => {
      const cands = pool.filter((p) => p.state === 'npc');
      if (!cands.length) return;
      const p = rng.pick(cands);
      p.state = state;
      p.listedUntil = day + MONTH_DAYS * rng.int(CONST.listingMonths[0], CONST.listingMonths[1]);
      changed(p, 'npc');
    };
    if (nRent < CONST.maxRentListings && rng.chance(0.5)) list('forRent');
    if (nSale < CONST.maxSaleListings && rng.chance(0.3)) list('forSale');
  }

  sim.land = { initLand, landDay };
}
