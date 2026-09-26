// Uniform-grid spatial hash for colliders and picking.
// item = { id, owner, kind, x, y, r?  | x0,y0,x1,y1 (aabb), solid?: bool, data? }

const CELL = 8;

export class Spatial {
  constructor() {
    this.cells = new Map();
    this.items = new Map();
  }
  _bounds(it) {
    if (it.x0 != null) return [it.x0, it.y0, it.x1, it.y1];
    const r = it.r || 0.5;
    return [it.x - r, it.y - r, it.x + r, it.y + r];
  }
  _keys(b) {
    const out = [];
    const cx0 = Math.floor(b[0] / CELL), cy0 = Math.floor(b[1] / CELL);
    const cx1 = Math.floor(b[2] / CELL), cy1 = Math.floor(b[3] / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) out.push(cx * 73856093 ^ cy * 19349663);
    return out;
  }
  insert(it) {
    if (this.items.has(it.id)) this.remove(it.id);
    const keys = this._keys(this._bounds(it));
    it._keys = keys;
    for (const k of keys) {
      let s = this.cells.get(k);
      if (!s) { s = new Set(); this.cells.set(k, s); }
      s.add(it);
    }
    this.items.set(it.id, it);
    return it;
  }
  update(it) { this.insert(it); }
  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    for (const k of it._keys) { const s = this.cells.get(k); if (s) s.delete(it); }
    this.items.delete(id);
  }
  get(id) { return this.items.get(id); }
  queryRect(x0, y0, x1, y1, filter) {
    const out = new Set();
    for (const k of this._keys([x0, y0, x1, y1])) {
      const s = this.cells.get(k);
      if (!s) continue;
      for (const it of s) {
        const b = this._bounds(it);
        if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
        if (!filter || filter(it)) out.add(it);
      }
    }
    return [...out];
  }
  queryCircle(x, y, r, filter) {
    return this.queryRect(x - r, y - r, x + r, y + r, (it) => {
      if (it.x0 != null) {
        const dx = Math.max(it.x0 - x, 0, x - it.x1), dy = Math.max(it.y0 - y, 0, y - it.y1);
        if (dx * dx + dy * dy > r * r) return false;
      } else {
        const d = Math.hypot(it.x - x, it.y - y);
        if (d > r + (it.r || 0.5)) return false;
      }
      return !filter || filter(it);
    });
  }
  queryPoint(x, y, filter) { return this.queryCircle(x, y, 0.01, filter); }
  scoped(owner) {
    const s = this;
    return {
      insert: (it) => s.insert({ owner, ...it }),
      update: (it) => s.update({ owner, ...it }),
      remove: (id) => s.remove(id),
      get: (id) => s.get(id),
      queryRect: (...a) => s.queryRect(...a),
      queryCircle: (...a) => s.queryCircle(...a),
      queryPoint: (...a) => s.queryPoint(...a),
    };
  }
}
