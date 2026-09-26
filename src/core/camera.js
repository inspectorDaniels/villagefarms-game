// Camera in world metres. zoom = screen pixels per metre.

export class Camera {
  constructor(world) {
    this.world = world;
    this.x = world.bounds.w / 2;
    this.y = world.bounds.h / 2;
    this.zoom = 24;
    this.minZoom = 3;
    this.maxZoom = 96;
    this.w = 1280; // css px viewport
    this.h = 720;
    this._follow = null;
    this.presets = new Map();
  }
  resize(w, h) { this.w = w; this.h = h; }
  set(x, y, zoom) {
    if (x != null) this.x = x;
    if (y != null) this.y = y;
    if (zoom != null) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }
  /** fn returns {x,y} or null; camera eases toward it each frame */
  follow(fn) { this._follow = fn || null; }
  get following() { return !!this._follow; }
  addPreset(name, p) { this.presets.set(name, p); }
  setPreset(name) {
    const p = this.presets.get(name);
    if (p) this.set(p.x, p.y, p.zoom);
    return !!p;
  }
  worldToScreen(x, y) {
    return { sx: (x - this.x) * this.zoom + this.w / 2, sy: (y - this.y) * this.zoom + this.h / 2 };
  }
  screenToWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.zoom + this.x, y: (sy - this.h / 2) / this.zoom + this.y };
  }
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }
  update(dt, health) {
    if (this._follow) {
      const target = health ? health.guard('camera-follow', 'follow', this._follow) : this._follow();
      if (target) {
        const k = 1 - Math.exp(-dt * 6);
        this.x += (target.x - this.x) * k;
        this.y += (target.y - this.y) * k;
      }
    }
    // keep inside world
    const hw = this.w / 2 / this.zoom, hh = this.h / 2 / this.zoom;
    const W = this.world.bounds.w, H = this.world.bounds.h;
    this.x = hw * 2 >= W ? W / 2 : Math.max(hw, Math.min(W - hw, this.x));
    this.y = hh * 2 >= H ? H / 2 : Math.max(hh, Math.min(H - hh, this.y));
  }
  view() {
    const hw = this.w / 2 / this.zoom, hh = this.h / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh, zoom: this.zoom, w: this.w, h: this.h };
  }
  /** module-facing facade */
  facade() {
    const c = this;
    return {
      get x() { return c.x; }, get y() { return c.y; }, get zoom() { return c.zoom; },
      get w() { return c.w; }, get h() { return c.h; },
      set: (x, y, z) => c.set(x, y, z), follow: (fn) => c.follow(fn),
      get following() { return c.following; },
      worldToScreen: (x, y) => c.worldToScreen(x, y), screenToWorld: (x, y) => c.screenToWorld(x, y),
      view: () => c.view(), setPreset: (n) => c.setPreset(n), addPreset: (n, p) => c.addPreset(n, p),
    };
  }
}
