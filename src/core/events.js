// Event bus. Handlers are guarded per owning module.

export class EventBus {
  constructor(health) {
    this.health = health;
    this.handlers = new Map(); // type -> [{fn, owner}]
    this.declared = new Map(); // owner -> Set(emits)
    this.counts = new Map();   // type -> count
    this._warned = new Set();
  }
  declare(owner, emits) { this.declared.set(owner, new Set(emits || [])); }
  on(type, fn, owner = 'core') {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    const h = { fn, owner };
    this.handlers.get(type).push(h);
    return () => this.off(type, fn);
  }
  once(type, fn, owner = 'core') {
    const off = this.on(type, (p) => { off(); fn(p); }, owner);
    return off;
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.findIndex((h) => h.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload, owner = 'core') {
    if (owner !== 'core') {
      const d = this.declared.get(owner);
      if (d && !d.has(type) && !this._warned.has(owner + type)) {
        this._warned.add(owner + type);
        this.health.warn(owner, `emitted undeclared event "${type}"`);
      }
    }
    this.counts.set(type, (this.counts.get(type) || 0) + 1);
    const list = this.handlers.get(type);
    if (!list || !list.length) return;
    for (const h of list.slice()) {
      this.health.guard(h.owner, `event ${type}`, h.fn, null, [payload]);
    }
  }
  /** a view of the bus bound to one owner */
  scoped(owner) {
    return {
      on: (type, fn) => this.on(type, fn, owner),
      once: (type, fn) => this.once(type, fn, owner),
      off: (type, fn) => this.off(type, fn),
      emit: (type, payload) => this.emit(type, payload, owner),
    };
  }
}
