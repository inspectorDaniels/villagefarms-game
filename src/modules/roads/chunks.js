// LOD chunk cache for static painted content.
// - small chunks (CPX px square) at a zoom level close to 1:1 with the screen (LEVELS px/m),
// - per-chunk content bbox (from `bounds(rect)`): empty chunks cost nothing, blits copy only the
//   painted part that intersects the viewport (9-arg drawImage with a source sub-rect),
// - time-sliced builds: `steps(g, rect, res)` is a generator; each frame the cache advances pending
//   builds by a small step budget (adapted from the real frame interval `view.dt`), so no single frame
//   pays for a whole chunk; missing chunks fall back to a coarser cached level meanwhile,
// - prefetch: a ring around the view, stretched ahead of the camera motion, is built when idle.
const LEVELS = [1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const CPX = 256;
const BYTES = CPX * CPX * 4;

export class ChunkCache {
  /**
   * @param paint  paint(g, rect, res) — full paint (used when `steps` is absent)
   * @param opts   { maxBytes, bounds(rect)→{x0,y0,x1,y1}|null (content bbox, metres), steps(g,rect,res) generator,
   *                 stepBudget:[min,max] steps per frame }
   */
  constructor(paint, { maxBytes = 96 * 1048576, bounds = null, isEmpty = null, steps = null, stepBudget = [3, 40] } = {}) {
    this.paint = paint;
    this.bounds = bounds;
    this.isEmpty = isEmpty;
    this.steps = steps;
    this.maxBytes = maxBytes;
    this.map = new Map();       // key → entry {state:'empty'|'ready'|'pending', canvas, used, bx0..by1 (chunk px)}
    this.jobs = new Map();      // key → {entry, gen, res, cx, cy}
    this.bytes = 0;
    this.frame = 0;
    this.builds = 0;
    this.stepsRun = 0;
    this.pool = [];
    this.budgetMin = stepBudget[0]; this.budgetMax = stepBudget[1];
    this.budget = stepBudget[0] * 2;
    this.vel = [0, 0]; this.lastC = null;
    this.lastDrawn = 0; this.lastBlitPx = 0;
  }
  clear() {
    for (const c of this.map.values()) this._free(c);
    this.map.clear(); this.jobs.clear(); this.bytes = 0;
  }
  _free(e) {
    if (e.canvas) { if (e.state !== 'raster') this._release(e.canvas); e.canvas = null; }
    if (e.bmp) { try { e.bmp.close(); } catch (err) { /* already closed */ } e.bmp = null; }
    e.dead = true;
  }
  _release(canvas) { if (this.pool.length < 48) this.pool.push(canvas); }
  pickRes(pxPerM) {
    if (!(pxPerM > 0) || !Number.isFinite(pxPerM)) return LEVELS[0];
    for (const r of LEVELS) if (r >= pxPerM * 0.9) return r;
    return LEVELS[LEVELS.length - 1];
  }
  size(res) { return CPX / res; }
  _rect(res, cx, cy) {
    const size = CPX / res;
    return { x0: cx * size, y0: cy * size, x1: (cx + 1) * size, y1: (cy + 1) * size, size };
  }
  /** create the entry (bbox test) and, if it has content, a pending job */
  _start(res, cx, cy, key) {
    const rect = this._rect(res, cx, cy);
    let bb = null;
    if (this.bounds) bb = this.bounds(rect);
    else if (!(this.isEmpty && this.isEmpty(rect))) bb = rect;
    if (!bb) { const e = { state: 'empty', used: this.frame }; this.map.set(key, e); return e; }
    // content bbox in chunk pixels (clamped, integer)
    const bx0 = Math.max(0, Math.floor((bb.x0 - rect.x0) * res)), by0 = Math.max(0, Math.floor((bb.y0 - rect.y0) * res));
    const bx1 = Math.min(CPX, Math.ceil((bb.x1 - rect.x0) * res)), by1 = Math.min(CPX, Math.ceil((bb.y1 - rect.y0) * res));
    if (bx1 - bx0 < 1 || by1 - by0 < 1) { const e = { state: 'empty', used: this.frame }; this.map.set(key, e); return e; }
    let canvas = this.pool.pop();
    if (!canvas) { canvas = document.createElement('canvas'); canvas.width = CPX; canvas.height = CPX; }
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, CPX, CPX);
    g.setTransform(res, 0, 0, res, -rect.x0 * res, -rect.y0 * res);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const entry = { state: 'pending', canvas, used: this.frame, res, bx0, by0, bx1, by1 };
    this.map.set(key, entry);
    this.bytes += BYTES;
    const gen = this.steps ? this.steps(g, rect, res) : null;
    this.jobs.set(key, { entry, gen, g, rect, res });
    return entry;
  }
  /** advance one job by one step; returns true when finished */
  _step(key, job) {
    this.stepsRun++;
    let done = true;
    if (job.gen) { const r = job.gen.next(); done = !!r.done; } else this.paint(job.g, job.rect, job.res);
    if (done) {
      job.g.setTransform(1, 0, 0, 1, 0, 0);
      this.jobs.delete(key);
      this.builds++;
      this._rasterize(job.entry);
    }
    return done;
  }
  /**
   * Freeze a finished chunk into an ImageBitmap. Chrome may otherwise keep a 2D canvas as a recorded
   * display list and *replay every vector op* each time it is used as a drawImage source (measured:
   * ~3 ms per detailed chunk per frame). The bitmap is rasterized once; the canvas goes back to the pool.
   */
  _rasterize(entry) {
    const cv = entry.canvas;
    if (typeof createImageBitmap !== 'function') { entry.state = 'ready'; return; }
    entry.state = 'raster';
    let p;
    try { p = createImageBitmap(cv, entry.bx0, entry.by0, entry.bx1 - entry.bx0, entry.by1 - entry.by0); } catch (err) { entry.state = 'ready'; return; }
    p.then((bmp) => {
      if (entry.dead) { bmp.close(); return; }
      entry.bmp = bmp;
      entry.state = 'ready';
      if (entry.canvas) { this._release(entry.canvas); entry.canvas = null; }
    }, () => { if (!entry.dead) entry.state = 'ready'; });
  }
  _finish(key) { const job = this.jobs.get(key); if (!job) return; for (let k = 0; k < 100000 && !this._step(key, job); k++); }
  _drop(key) {
    const e = this.map.get(key);
    if (e && e.state !== 'empty') { this._free(e); this.bytes -= BYTES; }
    this.map.delete(key); this.jobs.delete(key);
  }
  _evict() {
    if (this.bytes <= this.maxBytes) return;
    const items = [...this.map.entries()].filter(([, v]) => v.state === 'ready' && v.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [k] of items) {
      if (this.bytes <= this.maxBytes * 0.8) break;
      this._drop(k);
    }
    // forget old empty markers too (cheap, but unbounded otherwise)
    if (this.map.size > 6000) for (const [k, v] of this.map) if (v.state === 'empty' && v.used < this.frame - 600) this.map.delete(k);
  }
  _range(res, x0, y0, x1, y1) {
    const size = CPX / res;
    return [Math.floor(x0 / size), Math.floor(y0 / size), Math.floor(x1 / size), Math.floor(y1 / size)];
  }
  /** build everything needed for a view now (no budget) — showcase/screenshots only */
  prewarm(view, pxPerM) {
    const res = this.pickRes(pxPerM);
    const [cx0, cy0, cx1, cy1] = this._range(res, view.x0, view.y0, view.x1, view.y1);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4000) return;
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const key = res + ':' + cx + ':' + cy;
      if (!this.map.has(key)) this._start(res, cx, cy, key);
      this._finish(key);
    }
  }
  /** draw into g which currently has the world transform. opts: {maxSteps} */
  draw(g, view, opts = {}) {
    this.frame++;
    const m = g.getTransform();
    const pxPerM = m.a;
    if (!(pxPerM > 0) || !Number.isFinite(view.x0 + view.x1 + view.y0 + view.y1)) return 0;
    const res = this.pickRes(pxPerM);
    const size = CPX / res;
    const [cx0, cy0, cx1, cy1] = this._range(res, view.x0, view.y0, view.x1, view.y1);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1200) return 0;   // absurd zoom-out: nothing sensible to draw
    // ---- step budget: additive increase while frames are fast, multiplicative decrease when slow
    const dt = view.dt || 0;
    if (dt > 0.03) this.budget = Math.max(this.budgetMin, this.budget * 0.6);
    else if (dt > 0 && dt < 0.021) this.budget = Math.min(this.budgetMax, this.budget + 2);
    let steps = Math.max(1, Math.floor(opts.maxSteps != null ? opts.maxSteps : this.budget));
    // ---- camera velocity (for prefetch)
    const ccx = (view.x0 + view.x1) / 2, ccy = (view.y0 + view.y1) / 2;
    if (this.lastC && this.lastC.res === res) {
      const vx = ccx - this.lastC.x, vy = ccy - this.lastC.y;
      if (Math.hypot(vx, vy) < size * 2) { this.vel[0] = this.vel[0] * 0.7 + vx * 0.3; this.vel[1] = this.vel[1] * 0.7 + vy * 0.3; }
    } else { this.vel[0] = 0; this.vel[1] = 0; }
    this.lastC = { x: ccx, y: ccy, res };
    // ---- visible chunks, centre first
    const order = [];
    const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) order.push([cx, cy, (cx - mx) * (cx - mx) + (cy - my) * (cy - my)]);
    order.sort((a, b) => a[2] - b[2]);
    const wanted = new Set();
    const need = [];
    for (const [cx, cy] of order) {
      const key = res + ':' + cx + ':' + cy;
      wanted.add(key);
      let e = this.map.get(key);
      if (!e) e = this._start(res, cx, cy, key);
      e.used = this.frame;
      if (e.state === 'pending') need.push(key);
    }
    // visible builds first (whole-frame budget); a chunk with no fallback gets a bigger share
    for (const key of need) {
      const job = this.jobs.get(key);
      while (job && steps > 0) { steps--; if (this._step(key, job)) break; }
      if (steps <= 0) break;
    }
    // ---- prefetch ring (ahead of motion) when the visible set is complete
    const lead = 24;   // frames of motion to look ahead
    const px0 = view.x0 - size * 0.5 + Math.min(0, this.vel[0] * lead), px1 = view.x1 + size * 0.5 + Math.max(0, this.vel[0] * lead);
    const py0 = view.y0 - size * 0.5 + Math.min(0, this.vel[1] * lead), py1 = view.y1 + size * 0.5 + Math.max(0, this.vel[1] * lead);
    const [qx0, qy0, qx1, qy1] = this._range(res, px0, py0, px1, py1);
    const pre = [];
    for (let cx = qx0; cx <= qx1; cx++) for (let cy = qy0; cy <= qy1; cy++) {
      if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) continue;
      const key = res + ':' + cx + ':' + cy;
      wanted.add(key);
      const e = this.map.get(key);
      if (e) { e.used = this.frame; if (e.state === 'pending') pre.push([key, 0]); continue; }
      // distance ahead along motion → earlier
      const dx = (cx + 0.5) * size - ccx, dy = (cy + 0.5) * size - ccy;
      pre.push([key, Math.hypot(dx, dy) - (dx * this.vel[0] + dy * this.vel[1]) * 4, cx, cy]);
    }
    if (steps > 0 && !need.length) {
      pre.sort((a, b) => a[1] - b[1]);
      let started = 0;
      for (const p of pre) {
        if (steps <= 0) break;
        let job = this.jobs.get(p[0]);
        if (!job && p.length > 2) {
          if (started >= 2) continue;
          const e = this._start(res, p[2], p[3], p[0]); e.used = this.frame; started++;
          job = this.jobs.get(p[0]);
        }
        while (job && steps > 0) { steps--; if (this._step(p[0], job)) break; }
      }
    }
    // abandon pending builds nobody wants any more (e.g. after a zoom change or a jump)
    for (const key of [...this.jobs.keys()]) if (!wanted.has(key)) this._drop(key);
    this._evict();
    // ---- blit
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    const W = g.canvas.width, H = g.canvas.height;
    const X = (x) => Math.round(m.a * x + m.e), Y = (y) => Math.round(m.d * y + m.f);
    let drawn = 0, px = 0;
    for (const [cx, cy] of order) {
      const key = res + ':' + cx + ':' + cy;
      const e = this.map.get(key);
      const r = this._rect(res, cx, cy);
      const dx0 = X(r.x0), dy0 = Y(r.y0), dx1 = X(r.x1), dy1 = Y(r.y1);
      if (e.state === 'empty') continue;
      if (e.state === 'ready') {
        px += this._draw(g, e, 0, 0, CPX, e.bx0, e.by0, e.bx1, e.by1, dx0, dy0, dx1, dy1, W, H);
        drawn++;
        continue;
      }
      // fallback: a coarser ready level covering this chunk
      for (let li = LEVELS.indexOf(res) - 1; li >= 0; li--) {
        const lr = LEVELS[li], ls = CPX / lr;
        const pcx = Math.floor(r.x0 / ls), pcy = Math.floor(r.y0 / ls);
        const pe = this.map.get(lr + ':' + pcx + ':' + pcy);
        if (!pe || pe.state === 'pending' || pe.state === 'raster') continue;
        pe.used = this.frame;
        if (pe.state === 'empty') break;
        const sx = (r.x0 - pcx * ls) * lr, sy = (r.y0 - pcy * ls) * lr, sw = size * lr;
        // sub-rect of the parent chunk, intersected with its content bbox
        px += this._draw(g, pe, sx, sy, sw, Math.max(sx, pe.bx0), Math.max(sy, pe.by0), Math.min(sx + sw, pe.bx1), Math.min(sy + sw, pe.by1), dx0, dy0, dx1, dy1, W, H);
        break;
      }
    }
    g.setTransform(m);
    this.lastDrawn = drawn; this.lastBlitPx = px;
    return drawn;
  }
  /** draw from an entry's bitmap (which holds only the content bbox) or its canvas */
  _draw(g, e, sx, sy, sw, bx0, by0, bx1, by1, dx0, dy0, dx1, dy1, W, H) {
    if (e.bmp) return this._blit(g, e.bmp, sx, sy, sw, bx0, by0, bx1, by1, dx0, dy0, dx1, dy1, W, H, e.bx0, e.by0);
    if (e.canvas) return this._blit(g, e.canvas, sx, sy, sw, bx0, by0, bx1, by1, dx0, dy0, dx1, dy1, W, H, 0, 0);
    return 0;
  }
  /** blit source square (sx,sy,sw) → dest rect, restricted to the content bbox (b*) and the screen */
  _blit(g, canvas, sx, sy, sw, bx0, by0, bx1, by1, dx0, dy0, dx1, dy1, W, H, ox, oy) {
    const kx = (dx1 - dx0) / sw, ky = (dy1 - dy0) / sw;
    if (!(kx > 0) || !(ky > 0)) return 0;
    let s0 = Math.max(bx0, sx + (0 - dx0) / kx), s1 = Math.min(bx1, sx + (W - dx0) / kx);
    let t0 = Math.max(by0, sy + (0 - dy0) / ky), t1 = Math.min(by1, sy + (H - dy0) / ky);
    s0 = Math.max(sx, Math.floor(s0)); t0 = Math.max(sy, Math.floor(t0));
    s1 = Math.min(sx + sw, Math.ceil(s1)); t1 = Math.min(sy + sw, Math.ceil(t1));
    if (s1 - s0 < 0.5 || t1 - t0 < 0.5) return 0;
    const ex0 = dx0 + (s0 - sx) * kx, ey0 = dy0 + (t0 - sy) * ky;
    const ew = (s1 - s0) * kx, eh = (t1 - t0) * ky;
    g.drawImage(canvas, s0 - ox, t0 - oy, s1 - s0, t1 - t0, ex0, ey0, ew, eh);
    return ew * eh;
  }
  stats() {
    let ready = 0, empty = 0;
    for (const v of this.map.values()) { if (v.state === 'ready') ready++; else if (v.state === 'empty') empty++; }
    return { chunks: this.map.size, ready, empty, pending: this.jobs.size, mb: +(this.bytes / 1048576).toFixed(1), builds: this.builds,
      steps: this.stepsRun, budget: +this.budget.toFixed(1), drawn: this.lastDrawn, blitMpx: +(this.lastBlitPx / 1e6).toFixed(3) };
  }
}
