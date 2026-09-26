// Input: keyboard actions + mouse in screen and world coordinates.
// Modules query down()/pressed() in update(), or subscribe with on().

export const ACTIONS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  vehicle: ['KeyF'],
  switchChar: ['Tab'],
  cancel: ['Escape'],
  confirm: ['Enter'],
  rotate: ['KeyR'],
  build: ['KeyB'],
  map: ['KeyM'],
  jobs: ['KeyJ'],
  pause: ['Space'],
  speedUp: ['Equal', 'NumpadAdd'],
  speedDown: ['Minus', 'NumpadSubtract'],
  lights: ['KeyL'],
  tool1: ['Digit1'], tool2: ['Digit2'], tool3: ['Digit3'], tool4: ['Digit4'], tool5: ['Digit5'],
  tool6: ['Digit6'], tool7: ['Digit7'], tool8: ['Digit8'], tool9: ['Digit9'],
};

export class Input {
  constructor(canvas, camera, health) {
    this.canvas = canvas;
    this.camera = camera;
    this.health = health;
    this.keys = new Set();
    this.pressedKeys = new Set();   // pressed since last update step consumed them
    this.mouse = { sx: 0, sy: 0, x: 0, y: 0, buttons: 0, over: false };
    this.handlers = { click: [], wheel: [], key: [], mousedown: [], mouseup: [], mousemove: [] };
    this._drag = null;
    this.uiCapturing = false; // set by UI when pointer is over a panel
    this._bind();
  }
  _bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this._dispatch('key', { code: e.code, key: e.key, down: true });
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._dispatch('key', { code: e.code, key: e.key, down: false });
    });
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousemove', (e) => {
      this._setMouse(e);
      if (this._drag) {
        this.camera.x = this._drag.cx - (e.clientX - this._drag.sx) / this.camera.zoom;
        this.camera.y = this._drag.cy - (e.clientY - this._drag.sy) / this.camera.zoom;
        this._drag.moved = true;
      }
      this._dispatch('mousemove', this._ev(e));
    });
    c.addEventListener('mousedown', (e) => {
      this._setMouse(e);
      this.mouse.buttons = e.buttons;
      if (e.button === 1 || e.button === 2) {
        this._drag = { sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y, moved: false };
        if (this.camera.following) this.camera.follow(null);
      }
      this._dispatch('mousedown', this._ev(e));
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons = e.buttons;
      const wasDrag = this._drag && this._drag.moved;
      this._drag = null;
      if (e.target === c) {
        this._setMouse(e);
        this._dispatch('mouseup', this._ev(e));
        if (!wasDrag) this._dispatch('click', this._ev(e));
      }
    });
    c.addEventListener('mouseenter', () => { this.mouse.over = true; });
    c.addEventListener('mouseleave', () => { this.mouse.over = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._setMouse(e);
      const ev = { ...this._ev(e), deltaY: e.deltaY, handled: false };
      this._dispatch('wheel', ev);
      if (!ev.handled) this.camera.zoomAt(this.mouse.sx, this.mouse.sy, Math.pow(1.0015, -e.deltaY));
    }, { passive: false });
  }
  _setMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.sx = e.clientX - r.left;
    this.mouse.sy = e.clientY - r.top;
    const w = this.camera.screenToWorld(this.mouse.sx, this.mouse.sy);
    this.mouse.x = w.x; this.mouse.y = w.y;
  }
  _ev(e) {
    return { sx: this.mouse.sx, sy: this.mouse.sy, x: this.mouse.x, y: this.mouse.y, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey };
  }
  _dispatch(type, ev) {
    for (const h of this.handlers[type].slice()) {
      this.health.guard(h.owner, `input ${type}`, h.fn, null, [ev]);
      if (ev.stop) break;
    }
  }
  /** refresh world mouse position (camera may have moved) */
  refresh() {
    const w = this.camera.screenToWorld(this.mouse.sx, this.mouse.sy);
    this.mouse.x = w.x; this.mouse.y = w.y;
  }
  down(action) {
    const codes = ACTIONS[action] || [action];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }
  pressed(action) {
    const codes = ACTIONS[action] || [action];
    for (const c of codes) if (this.pressedKeys.has(c)) return true;
    return false;
  }
  endStep() { this.pressedKeys.clear(); }
  /** synthetic input for automated tests: press(code) / release(code) */
  press(code) { if (!this.keys.has(code)) this.pressedKeys.add(code); this.keys.add(code); }
  release(code) { this.keys.delete(code); }
  on(type, fn, owner = 'core') {
    if (!this.handlers[type]) throw new Error('unknown input event ' + type);
    const h = { fn, owner };
    this.handlers[type].push(h);
    return () => { const i = this.handlers[type].indexOf(h); if (i >= 0) this.handlers[type].splice(i, 1); };
  }
  scoped(owner) {
    const self = this;
    return {
      down: (a) => self.down(a), pressed: (a) => self.pressed(a),
      get mouse() { return self.mouse; },
      on: (type, fn) => self.on(type, fn, owner),
      get uiCapturing() { return self.uiCapturing; },
      set uiCapturing(v) { self.uiCapturing = v; },
      ACTIONS,
    };
  }
}
