// Module isolation: every call into a module goes through guard().
// Errors are caught, logged once per unique message, counted; after MAX_ERRORS the
// module is disabled and its hooks are skipped.

const MAX_ERRORS = 25;

export class Health {
  constructor() {
    this.modules = new Map(); // id -> record
    this.onDisable = null;
    this._seen = new Set();
    this.frameTimes = new Map(); // id -> ms accumulated this frame
  }
  register(id, extra = {}) {
    if (!this.modules.has(id)) {
      this.modules.set(id, {
        id, status: 'loading', errors: 0, messages: [], warnings: [],
        ms: 0, msAvg: 0, calls: 0, ...extra,
      });
    }
    return this.modules.get(id);
  }
  get(id) { return this.modules.get(id); }
  isActive(id) {
    const r = this.modules.get(id);
    return !r || r.status === 'ok' || r.status === 'loading' || r.status === 'core';
  }
  setStatus(id, status, reason) {
    const r = this.register(id);
    r.status = status;
    if (reason) r.reason = String(reason);
  }
  warn(id, msg) {
    const r = this.register(id);
    if (r.warnings.length < 50 && !r.warnings.includes(msg)) {
      r.warnings.push(msg);
      console.warn(`[${id}] ${msg}`);
    }
  }
  error(id, err, label = '') {
    const r = this.register(id);
    r.errors++;
    const msg = (err && err.stack) ? String(err.stack).split('\n').slice(0, 3).join(' | ') : String(err);
    const key = id + '|' + label + '|' + msg;
    if (!this._seen.has(key)) {
      this._seen.add(key);
      if (r.messages.length < 20) r.messages.push(`${label}: ${msg}`);
      console.error(`[module ${id}] ${label} failed: ${msg}`);
    }
    if (r.errors >= MAX_ERRORS && r.status === 'ok') {
      r.status = 'disabled';
      r.reason = `disabled after ${r.errors} errors`;
      console.error(`[module ${id}] disabled after ${r.errors} errors`);
      if (this.onDisable) { try { this.onDisable(id); } catch (e) { /* ignore */ } }
    }
  }
  /** run fn guarded; returns fn's value or undefined on error / inactive module */
  guard(id, label, fn, thisArg, args) {
    const r = this.modules.get(id);
    if (r && (r.status === 'disabled' || r.status === 'failed' || r.status === 'skipped')) return undefined;
    const t0 = performance.now();
    try {
      return args ? fn.apply(thisArg, args) : fn.call(thisArg);
    } catch (e) {
      this.error(id, e, label);
      return undefined;
    } finally {
      const dt = performance.now() - t0;
      this.frameTimes.set(id, (this.frameTimes.get(id) || 0) + dt);
    }
  }
  /** called once per frame by the engine to roll timing averages */
  endFrame() {
    for (const [id, ms] of this.frameTimes) {
      const r = this.register(id);
      r.ms = ms;
      r.msAvg = r.msAvg ? r.msAvg * 0.95 + ms * 0.05 : ms;
    }
    this.frameTimes.clear();
  }
  report() {
    const out = [];
    for (const r of this.modules.values()) {
      out.push({
        id: r.id, status: r.status, reason: r.reason || null, errors: r.errors,
        msAvg: +r.msAvg.toFixed(3), messages: r.messages.slice(), warnings: r.warnings.slice(),
      });
    }
    return out;
  }
}
