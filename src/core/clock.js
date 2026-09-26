// Game clock. world.time.t = game seconds since day 0 00:00 of year 1.
import { DAY_SECONDS, MONTH_DAYS, YEAR_DAYS } from './world.js';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer',
  'autumn', 'autumn', 'autumn', 'winter'];

export class Clock {
  constructor(world, events) {
    this.world = world;
    this.events = events;
    this._last = this._snapshot();
  }
  get t() { return this.world.time.t; }
  get scale() { return this.world.time.scale; }
  set scale(v) { this.world.time.scale = v; }
  get paused() { return this.world.time.paused || this.world.time.frozen; }
  set paused(v) { this.world.time.paused = !!v; }
  get day() { return Math.floor(this.t / DAY_SECONDS); }              // absolute day index
  get secondsOfDay() { return this.t - this.day * DAY_SECONDS; }
  get timeOfDay() { return this.secondsOfDay / 3600; }                  // 0..24 float
  get hour() { return Math.floor(this.timeOfDay); }
  get minute() { return Math.floor((this.secondsOfDay % 3600) / 60); }
  get year() { return Math.floor(this.day / YEAR_DAYS) + 1; }
  get dayOfYear() { return this.day % YEAR_DAYS; }                      // 0..35
  get month() { return Math.floor(this.dayOfYear / MONTH_DAYS); }       // 0..11
  get monthName() { return MONTH_NAMES[this.month]; }
  get dayOfMonth() { return (this.dayOfYear % MONTH_DAYS) + 1; }
  get season() { return SEASONS[this.month]; }
  /** fraction of the astronomical year (0 = 1 Jan), continuous */
  get yearFrac() { return ((this.t / DAY_SECONDS) % YEAR_DAYS) / YEAR_DAYS; }
  /** game seconds that elapse per real second */
  get rate() { return this.paused ? 0 : this.scale; }

  /** set time of day, 'HH:MM' or hours float; keeps the current day */
  set(time) {
    let h = typeof time === 'number' ? time : 0;
    if (typeof time === 'string') {
      const [hh, mm] = time.split(':').map(Number);
      h = (hh || 0) + (mm || 0) / 60;
    }
    this.world.time.t = this.day * DAY_SECONDS + h * 3600;
    this._last = this._snapshot();
  }
  setDayOfYear(d) {
    const tod = this.secondsOfDay;
    const year = this.year - 1;
    this.world.time.t = (year * YEAR_DAYS + (d % YEAR_DAYS)) * DAY_SECONDS + tod;
    this._last = this._snapshot();
  }
  format() {
    const hh = String(this.hour).padStart(2, '0');
    const mm = String(this.minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  _snapshot() { return { hour: this.hour, day: this.day, season: this.season }; }

  /** advance by real dt seconds; emits clock:hour / clock:day / clock:season */
  advance(dt) {
    if (this.paused) return;
    this.world.time.t += dt * this.scale;
    const s = this._snapshot();
    const l = this._last;
    if (s.hour !== l.hour) this.events.emit('clock:hour', { hour: s.hour, day: s.day });
    if (s.day !== l.day) this.events.emit('clock:day', { day: s.day, dayOfYear: this.dayOfYear });
    if (s.season !== l.season) this.events.emit('clock:season', { season: s.season });
    this._last = s;
  }
  /** read-only view handed to modules */
  view() {
    const c = this;
    return {
      get t() { return c.t; }, get scale() { return c.scale; }, set scale(v) { c.scale = v; },
      get paused() { return c.paused; }, set paused(v) { c.paused = v; },
      get day() { return c.day; }, get timeOfDay() { return c.timeOfDay; },
      get hour() { return c.hour; }, get minute() { return c.minute; },
      get year() { return c.year; }, get dayOfYear() { return c.dayOfYear; },
      get month() { return c.month; }, get monthName() { return c.monthName; },
      get dayOfMonth() { return c.dayOfMonth; }, get season() { return c.season; },
      get yearFrac() { return c.yearFrac; }, get rate() { return c.rate; },
      set: (t) => c.set(t), setDayOfYear: (d) => c.setDayOfYear(d), format: () => c.format(),
    };
  }
}
