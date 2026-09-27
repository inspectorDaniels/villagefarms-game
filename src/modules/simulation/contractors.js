// r3: a real contractor service. Book an operation on a parcel (or a field of known size): paid when
// booked, started after a lead time (longer in peak months), worked at the AI rate with a contractor's
// big kit, then `economy:contractor-done` — the crops module applies the operation to the fields.
import { CONTRACTOR, OPS, haPerGameHour } from './work.js';
import { YEAR_DAYS, MONTH_DAYS, CONST } from './data.js';

export function installContractors(sim) {
  const E = sim.world.economy;
  const api = sim.api;
  const monthOf = (d) => Math.floor((((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / MONTH_DAYS);

  function initContractors() { E.contractors = []; }

  /** internal quote; opts.ha / opts.name for a field that is not a parcel */
  function quote(id, op, opts = {}, rng) {
    const C = CONTRACTOR[op];
    if (!C) return null;
    const p = api.parcel(id);
    // r4: only on land the player farms; a partial booking is limited to the parcel
    if (!p || (p.state !== 'owned' && p.state !== 'rented')) return null;
    const ha = Math.min(p.area / 1e4, opts.ha > 0 ? +opts.ha : opts.areaM2 > 0 ? opts.areaM2 / 1e4 : p.area / 1e4);
    if (!(ha > 0)) return null;
    const today = sim.today();
    const peak = C.peakMonths.includes(monthOf(today));
    const [a, b] = peak ? C.peakLeadDays : C.leadDays;
    const leadDays = rng ? rng.int(a, b) : Math.round((a + b) / 2);
    const rate = haPerGameHour(sim.rates, op, 'ai', 3, 'combine_l'); // contractors bring big kit
    const days = Math.max(1, Math.ceil(ha / (rate * CONST.hoursPerDayHand)));
    const price = Math.round(Math.max(80, C.perHa * ha)); // minimum charge €80
    return { parcelId: p.id, fieldId: opts.fieldId || null, crop: opts.crop || null, name: p.name, op, ha: +ha.toFixed(4), areaM2: Math.round(ha * 1e4), price, leadDays, leadRange: [a, b], days, peak };
  }

  Object.assign(api, {
    /** price, lead time and duration for having `op` done on a parcel (no booking) */
    /** opts: {ha | areaM2, fieldId?, crop?} — the parcel must be owned or rented by the player */
    contractorQuote(id, op, opts = {}) { return quote(id, op, opts, null); },
    /** book (and pay for) a contractor; returns the booking or null */
    hireContractor(id, op, opts = {}) {
      if (!OPS.includes(op) || sim.blocked()) return null;
      const n = (E.contractorSeq = (E.contractorSeq || 0) + 1);
      const q = quote(id, op, opts, sim.rngFor('contractor:' + n));
      if (!q) return null;
      if (!api.charge(q.price, 'contractor', `Contractor: ${op} ${q.ha.toFixed(1)} ha — ${q.name}`)) return null;
      const today = sim.today();
      const b = { id: `simulation:contract:${n}`, ...q, bookedDay: today, startDay: today + q.leadDays, doneDay: today + q.leadDays + q.days, status: 'booked' };
      delete b.leadRange;
      E.contractors.push(b);
      E.version++;
      return { ...b };
    },
    contractorBookings(status) { return (E.contractors || []).filter((b) => !status || b.status === status).map((b) => ({ ...b })); },
    /** cancel before the contractor starts: full refund. Returns € refunded or 0. */
    cancelContractor(bookingId) {
      const b = (E.contractors || []).find((x) => x.id === bookingId);
      if (!b || b.status !== 'booked' || sim.today() >= b.startDay) return 0;
      b.status = 'cancelled';
      api.credit(b.price, 'contractor', `Contractor booking cancelled — ${b.name}`);
      return b.price;
    },
  });

  function contractorDay(day) {
    const list = E.contractors || [];
    for (const b of list) {
      if (b.status === 'booked' && day >= b.startDay) b.status = 'working';
      if (b.status === 'working' && day >= b.doneDay) {
        b.status = 'done';
        sim.creditWork(b.parcelId, b.op, b.areaM2); // CAP: only the booked area counts
        // crops listens and applies the operation to that area
        sim.emit('economy:contractor-done', { parcelId: b.parcelId, fieldId: b.fieldId, operation: b.op, areaM2: b.areaM2, crop: b.crop, bookingId: b.id, booking: { ...b } });
      }
    }
    // keep a short history
    if (list.length > 80) E.contractors = list.filter((b, i) => b.status === 'booked' || b.status === 'working' || i >= list.length - 60);
  }

  sim.contractors = { initContractors, contractorDay };
}
