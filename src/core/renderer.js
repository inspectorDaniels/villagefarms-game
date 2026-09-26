// Layered renderer. All world drawing is in metre coordinates.
// Pipeline: collect → ground layers → SHADOW PASS → objects (y-sorted) → overhead → weather
//           → LIGHTING PASS → glow → world-ui → screen.
import { palette } from './palette.js';

export const LAYERS = ['ground', 'ground-overlay', 'ground-detail', 'objects', 'overhead', 'weather', 'glow', 'world-ui', 'screen'];
const DEFAULT_SUN = { azimuth: Math.PI, elevation: 0.9, dirX: 0, dirY: -1, shadowLen: 0.8, shadowStrength: 0.38 };
const DRAW_METHODS = ['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText', 'putImageData'];

let drawCounter = 0;
let patched = false;
function patchDrawCounting() {
  if (patched) return;
  patched = true;
  const P = CanvasRenderingContext2D.prototype;
  for (const m of DRAW_METHODS) {
    const orig = P[m];
    P[m] = function (...a) { drawCounter++; return orig.apply(this, a); };
  }
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function addPoly(g, pts) {
  // enforce positive orientation so a single nonzero fill gives the union
  const rev = signedArea(pts) < 0;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[rev ? n - 1 - k : k];
    if (k === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
  }
  g.closePath();
}

export class Renderer {
  constructor(canvas, camera, health, world) {
    patchDrawCounting();
    this.canvas = canvas;
    this.camera = camera;
    this.health = health;
    this.world = world;
    this.g = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.layers = new Map(LAYERS.map((l) => [l, []]));
    this.collectors = [];
    this.shadowCanvas = document.createElement('canvas');
    this.sg = this.shadowCanvas.getContext('2d');
    this.lightCanvas = document.createElement('canvas');
    this.lg = this.lightCanvas.getContext('2d');
    this.lightSprites = new Map();
    this.objects = [];
    this.shadows = [];
    this.lights = [];
    this.frameApis = new Map();
    this.stats = { drawCalls: 0, objects: 0, shadows: 0, lights: 0 };
    this.overlay = null; // core debug overlay fn(g, w, h)
    this.background = '#3b4a2c';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.shadowCanvas.width = Math.ceil(this.canvas.width / 2);
    this.shadowCanvas.height = Math.ceil(this.canvas.height / 2);
    this.lightCanvas.width = Math.ceil(this.canvas.width / 2);
    this.lightCanvas.height = Math.ceil(this.canvas.height / 2);
    this.camera.resize(w, h);
  }

  addLayer(layer, fn, owner = 'core', order = 0) {
    if (!this.layers.has(layer)) throw new Error(`unknown layer "${layer}" (valid: ${LAYERS.join(', ')})`);
    const list = this.layers.get(layer);
    const entry = { fn, owner, order };
    list.push(entry);
    list.sort((a, b) => a.order - b.order);
    return () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); };
  }
  addCollector(fn, owner = 'core') {
    const entry = { fn, owner };
    this.collectors.push(entry);
    return () => { const i = this.collectors.indexOf(entry); if (i >= 0) this.collectors.splice(i, 1); };
  }
  removeOwner(owner) {
    for (const list of this.layers.values()) for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) list.splice(i, 1);
    this.collectors = this.collectors.filter((c) => c.owner !== owner);
  }
  scoped(owner) {
    return {
      addLayer: (layer, fn, order) => this.addLayer(layer, fn, owner, order),
      addCollector: (fn) => this.addCollector(fn, owner),
      LAYERS,
      get stats() { return this.stats; },
    };
  }

  _frameApi(owner) {
    let F = this.frameApis.get(owner);
    if (F) return F;
    const R = this;
    F = {
      object(o) { o.owner = owner; R.objects.push(o); },
      light(l) { R.lights.push(l); },
      shadow: {
        box(cx, cy, w, h, rot = 0, height = 1, z0 = 0) { R.shadows.push({ t: 'box', cx, cy, w, h, rot, height, z0 }); },
        poly(points, height = 1, z0 = 0) { R.shadows.push({ t: 'poly', points, height, z0 }); },
        circle(x, y, r, z0 = 0, z1 = 1, trunk = 0) { R.shadows.push({ t: 'circle', x, y, r, z0, z1, trunk }); },
        cylinder(x, y, r, height) { R.shadows.push({ t: 'cyl', x, y, r, height }); },
        pole(x, y, height, width = 0.15) { R.shadows.push({ t: 'pole', x, y, height, width }); },
        wall(x0, y0, x1, y1, height, thickness = 0.2) { R.shadows.push({ t: 'wall', x0, y0, x1, y1, height, thickness }); },
        custom(fn) { R.shadows.push({ t: 'custom', fn, owner }); },
      },
    };
    this.frameApis.set(owner, F);
    return F;
  }

  _worldTransform(g, scale) {
    const cam = this.camera;
    const z = cam.zoom * scale;
    g.setTransform(z, 0, 0, z, (cam.w / 2 - cam.x * cam.zoom) * scale, (cam.h / 2 - cam.y * cam.zoom) * scale);
  }

  _drawLayer(name, view) {
    const g = this.g;
    for (const e of this.layers.get(name)) {
      g.save();
      this.health.guard(e.owner, `layer ${name}`, e.fn, null, [g, view]);
      g.restore();
    }
  }

  _sun() {
    const env = this.world.environment;
    return (env && env.sun && Number.isFinite(env.sun.shadowLen)) ? env.sun : DEFAULT_SUN;
  }

  _shadowPass(view) {
    const sun = this._sun();
    const strength = sun.shadowStrength == null ? 0.38 : sun.shadowStrength;
    if (strength <= 0.005 || !this.shadows.length) return;
    const sg = this.sg;
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
    this._worldTransform(sg, this.dpr / 2);
    sg.fillStyle = palette.shadow;
    sg.strokeStyle = palette.shadow;
    const L = Math.min(8, Math.max(0, sun.shadowLen));
    const dx = sun.dirX * L, dy = sun.dirY * L;
    const px = -sun.dirY, py = sun.dirX; // perpendicular
    sg.beginPath();
    const customs = [];
    for (const s of this.shadows) {
      switch (s.t) {
        case 'box': {
          const c = Math.cos(s.rot), si = Math.sin(s.rot);
          const hw = s.w / 2, hh = s.h / 2;
          const base = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [s.cx + x * c - y * si, s.cy + x * si + y * c]);
          this._prism(sg, base, s.z0 * dx, s.z0 * dy, s.height * dx, s.height * dy);
          break;
        }
        case 'poly':
          this._prism(sg, s.points, s.z0 * dx, s.z0 * dy, s.height * dx, s.height * dy);
          break;
        case 'circle': {
          const zc = (s.z0 + s.z1) / 2, c = (s.z1 - s.z0) / 2;
          const major = Math.sqrt(s.r * s.r + (c * L) * (c * L));
          const ang = Math.atan2(sun.dirY, sun.dirX);
          sg.moveTo(s.x + dx * zc + Math.cos(ang) * major, s.y + dy * zc + Math.sin(ang) * major);
          sg.ellipse(s.x + dx * zc, s.y + dy * zc, major, s.r, ang, 0, Math.PI * 2);
          if (s.trunk > 0 && s.z0 > 0) {
            const tw = s.trunk / 2;
            addPoly(sg, [[s.x + px * tw, s.y + py * tw], [s.x - px * tw, s.y - py * tw],
              [s.x - px * tw + dx * zc, s.y - py * tw + dy * zc], [s.x + px * tw + dx * zc, s.y + py * tw + dy * zc]]);
          }
          break;
        }
        case 'cyl': {
          const ex = s.x + dx * s.height, ey = s.y + dy * s.height;
          sg.moveTo(s.x + s.r, s.y); sg.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          sg.moveTo(ex + s.r, ey); sg.arc(ex, ey, s.r, 0, Math.PI * 2);
          addPoly(sg, [[s.x + px * s.r, s.y + py * s.r], [s.x - px * s.r, s.y - py * s.r], [ex - px * s.r, ey - py * s.r], [ex + px * s.r, ey + py * s.r]]);
          break;
        }
        case 'pole': {
          const w = s.width / 2, ex = s.x + dx * s.height, ey = s.y + dy * s.height;
          addPoly(sg, [[s.x + px * w, s.y + py * w], [s.x - px * w, s.y - py * w], [ex - px * w, ey - py * w], [ex + px * w, ey + py * w]]);
          break;
        }
        case 'wall': {
          const ang = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
          const nx = -Math.sin(ang) * s.thickness / 2, ny = Math.cos(ang) * s.thickness / 2;
          const base = [[s.x0 + nx, s.y0 + ny], [s.x1 + nx, s.y1 + ny], [s.x1 - nx, s.y1 - ny], [s.x0 - nx, s.y0 - ny]];
          this._prism(sg, base, 0, 0, s.height * dx, s.height * dy);
          break;
        }
        case 'custom': customs.push(s); break;
        default: break;
      }
    }
    sg.fill('nonzero');
    for (const s of customs) {
      sg.save();
      this.health.guard(s.owner, 'shadow custom', s.fn, null, [sg, sun, view]);
      sg.restore();
      this._worldTransform(sg, this.dpr / 2);
      sg.fillStyle = palette.shadow;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = strength;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.shadowCanvas, 0, 0, this.canvas.width, this.canvas.height);
    g.globalAlpha = 1;
  }

  /** add a prism (base polygon extruded from z0 to z1 along sun) to the current path */
  _prism(sg, base, ox0, oy0, ox1, oy1) {
    const b = ox0 || oy0 ? base.map(([x, y]) => [x + ox0, y + oy0]) : base;
    const t = base.map(([x, y]) => [x + ox1, y + oy1]);
    addPoly(sg, b);
    addPoly(sg, t);
    for (let i = 0, n = base.length; i < n; i++) {
      const j = (i + 1) % n;
      addPoly(sg, [b[i], b[j], t[j], t[i]]);
    }
  }

  _lightSprite(color) {
    const key = color.join(',');
    let s = this.lightSprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 128;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    const [r, gg, b] = color;
    gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    gr.addColorStop(0.25, `rgba(${r},${gg},${b},0.6)`);
    gr.addColorStop(0.6, `rgba(${r},${gg},${b},0.18)`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.lightSprites.set(key, s);
    return s;
  }

  _lightingPass(view) {
    const env = this.world.environment || {};
    const amb = Array.isArray(env.ambient) ? env.ambient : [255, 255, 255];
    const bright = amb[0] >= 250 && amb[1] >= 250 && amb[2] >= 250;
    const lights = this.lights.filter((l) => l.x + l.radius > view.x0 && l.x - l.radius < view.x1 && l.y + l.radius > view.y0 && l.y - l.radius < view.y1);
    this._visibleLights = lights;
    if (bright && !lights.length) return;
    const lg = this.lg;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = `rgb(${amb[0] | 0},${amb[1] | 0},${amb[2] | 0})`;
    lg.fillRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);
    if (!bright) {
      this._worldTransform(lg, this.dpr / 2);
      lg.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        lg.globalAlpha = Math.max(0, Math.min(1, l.intensity == null ? 1 : l.intensity));
        const r = l.radius;
        if (l.cone) {
          // directional cone (headlights): clip a wedge
          lg.save();
          lg.beginPath();
          lg.moveTo(l.x, l.y);
          lg.arc(l.x, l.y, r, l.cone.angle - l.cone.spread, l.cone.angle + l.cone.spread);
          lg.closePath();
          lg.clip();
          lg.drawImage(this._lightSprite(l.color || [255, 220, 170]), l.x - r, l.y - r, r * 2, r * 2);
          lg.restore();
        } else {
          lg.drawImage(this._lightSprite(l.color || [255, 220, 170]), l.x - r, l.y - r, r * 2, r * 2);
        }
      }
      lg.globalAlpha = 1;
      lg.globalCompositeOperation = 'source-over';
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.lightCanvas, 0, 0, this.canvas.width, this.canvas.height);
    g.globalCompositeOperation = 'source-over';
  }

  _glowPass() {
    const env = this.world.environment || {};
    const night = 1 - (env.daylight == null ? 1 : env.daylight);
    const lights = this._visibleLights || [];
    if (night < 0.05 || !lights.length) return;
    const g = this.g;
    g.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.glow) continue;
      const r = (l.glowRadius || l.radius * 0.3);
      g.globalAlpha = Math.min(1, l.glow * night * (l.intensity == null ? 1 : l.intensity));
      g.drawImage(this._lightSprite(l.color || [255, 220, 170]), l.x - r, l.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  render(dt, timeSec) {
    const startCount = drawCounter;
    const g = this.g;
    const view = this.camera.view();
    view.dt = dt; view.time = timeSec; view.dpr = this.dpr;
    this.objects.length = 0; this.shadows.length = 0; this.lights.length = 0;

    for (const c of this.collectors) this.health.guard(c.owner, 'collect', c.fn, null, [view, this._frameApi(c.owner)]);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = this.background;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._worldTransform(g, this.dpr);
    this._drawLayer('ground', view);
    this._drawLayer('ground-overlay', view);
    this._drawLayer('ground-detail', view);

    this._shadowPass(view);

    this._worldTransform(g, this.dpr);
    this.objects.sort((a, b) => a.y - b.y);
    for (const o of this.objects) {
      g.save();
      this.health.guard(o.owner, 'object draw', o.draw, o, [g, view]);
      g.restore();
    }
    this._drawLayer('overhead', view);
    this._drawLayer('weather', view);

    this._lightingPass(view);

    this._worldTransform(g, this.dpr);
    this._glowPass();
    this._drawLayer('glow', view);
    this._drawLayer('world-ui', view);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._drawLayer('screen', view);
    if (this.overlay) { g.save(); try { this.overlay(g, this.camera.w, this.camera.h); } catch (e) { /* ignore */ } g.restore(); }

    this.stats.drawCalls = drawCounter - startCount;
    this.stats.objects = this.objects.length;
    this.stats.shadows = this.shadows.length;
    this.stats.lights = this.lights.length;
  }
}
