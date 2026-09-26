// LOD chunk cache: static painted content rendered into fixed-pixel canvases per zoom level,
// drawn snapped to device pixels (no seams). Builds are budgeted per frame; missing chunks
// fall back to a coarser cached level.
const LEVELS = [2, 4, 8, 16, 32, 64];
const CPX = 1024;

export class ChunkCache {
  constructor(paint, { maxBytes = 160 * 1048576, isEmpty = null } = {}) {
    this.paint = paint;         // paint(g, rect{x0,y0,x1,y1}, res)
    this.isEmpty = isEmpty;     // isEmpty(rect) → true to skip
    this.maxBytes = maxBytes;
    this.map = new Map();
    this.bytes = 0;
    this.frame = 0;
    this.builds = 0;
    this.pool = [];
  }
  clear() {
    for (const c of this.map.values()) if (c && c.canvas) this.pool.push(c.canvas);
    this.map.clear(); this.bytes = 0;
    if (this.pool.length > 12) this.pool.length = 12;
  }
  pickRes(pxPerM) {
    for (const r of LEVELS) if (r >= pxPerM * 0.85) return r;
    return LEVELS[LEVELS.length - 1];
  }
  _rect(res, cx, cy) {
    const size = CPX / res;
    return { x0: cx * size, y0: cy * size, x1: (cx + 1) * size, y1: (cy + 1) * size, size };
  }
  _build(res, cx, cy) {
    const key = res + ':' + cx + ':' + cy;
    const rect = this._rect(res, cx, cy);
    if (this.isEmpty && this.isEmpty(rect)) { this.map.set(key, { empty: true, used: this.frame }); return this.map.get(key); }
    let canvas = this.pool.pop();
    if (!canvas) { canvas = document.createElement('canvas'); canvas.width = CPX; canvas.height = CPX; }
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, CPX, CPX);
    g.setTransform(res, 0, 0, res, -rect.x0 * res, -rect.y0 * res);
    g.lineJoin = 'round'; g.lineCap = 'round';
    this.paint(g, rect, res);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const entry = { canvas, used: this.frame, res };
    this.map.set(key, entry);
    this.bytes += CPX * CPX * 4;
    this.builds++;
    this._evict();
    return entry;
  }
  _evict() {
    if (this.bytes <= this.maxBytes) return;
    const items = [...this.map.entries()].filter(([, v]) => v.canvas).sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of items) {
      if (this.bytes <= this.maxBytes * 0.8) break;
      if (v.used >= this.frame) continue;
      this.map.delete(k); this.bytes -= CPX * CPX * 4;
      if (this.pool.length < 8) this.pool.push(v.canvas);
    }
  }
  /** build everything needed for a view now (no budget) */
  prewarm(view, pxPerM) {
    const res = this.pickRes(pxPerM);
    const size = CPX / res;
    for (let cx = Math.floor(view.x0 / size); cx <= Math.floor(view.x1 / size); cx++)
      for (let cy = Math.floor(view.y0 / size); cy <= Math.floor(view.y1 / size); cy++)
        if (!this.map.has(res + ':' + cx + ':' + cy)) this._build(res, cx, cy);
  }
  /** draw into g which currently has the world transform */
  draw(g, view, maxBuilds = 2) {
    this.frame++;
    const m = g.getTransform();
    const pxPerM = m.a;
    const res = this.pickRes(pxPerM);
    const size = CPX / res;
    let budget = maxBuilds;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    const X = (x) => Math.round(m.a * x + m.e), Y = (y) => Math.round(m.d * y + m.f);
    const cx0 = Math.floor(view.x0 / size), cx1 = Math.floor(view.x1 / size);
    const cy0 = Math.floor(view.y0 / size), cy1 = Math.floor(view.y1 / size);
    // centre-first build order
    const order = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) order.push([cx, cy]);
    const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
    order.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
    let drawn = 0;
    for (const [cx, cy] of order) {
      const key = res + ':' + cx + ':' + cy;
      let e = this.map.get(key);
      if (!e && budget > 0) { e = this._build(res, cx, cy); budget--; }
      const r = this._rect(res, cx, cy);
      if (e) {
        e.used = this.frame;
        if (e.empty) continue;
        g.drawImage(e.canvas, X(r.x0), Y(r.y0), X(r.x1) - X(r.x0), Y(r.y1) - Y(r.y0));
        drawn++;
        continue;
      }
      // fallback: any coarser cached level covering this chunk
      for (let li = LEVELS.indexOf(res) - 1; li >= 0; li--) {
        const lr = LEVELS[li], ls = CPX / lr;
        const pcx = Math.floor(r.x0 / ls), pcy = Math.floor(r.y0 / ls);
        const pe = this.map.get(lr + ':' + pcx + ':' + pcy);
        if (!pe) continue;
        pe.used = this.frame;
        if (pe.empty) break;
        const sx = (r.x0 - pcx * ls) * lr, sy = (r.y0 - pcy * ls) * lr, sw = size * lr;
        g.drawImage(pe.canvas, sx, sy, sw, sw, X(r.x0), Y(r.y0), X(r.x1) - X(r.x0), Y(r.y1) - Y(r.y0));
        break;
      }
    }
    g.setTransform(m);
    return drawn;
  }
  stats() { return { chunks: this.map.size, mb: +(this.bytes / 1048576).toFixed(1), builds: this.builds }; }
}
