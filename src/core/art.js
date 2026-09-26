// Sprite cache and painting helpers for the "painted gouache" style.
// Paint at art.PPM pixels per metre into cached canvases, draw scaled in metre space.
import { Rng, hashString } from './rng.js';
import { Noise2D } from './noise.js';

export const PPM = 32;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------- colour helpers ----------
export function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex.slice(0, 3);
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export function rgba(col, a = 1) {
  const [r, g, b] = hexToRgb(col);
  return `rgba(${r},${g},${b},${a})`;
}
/** mix two colours, t in [0,1] */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
/** amount > 0 lightens toward warm white, < 0 darkens toward a cool tinted dark (never pure black) */
export function shade(col, amount) {
  if (amount >= 0) return mix(col, '#fff8ea', Math.min(1, amount));
  const [r, g, b] = hexToRgb(col);
  const dark = rgbToHex([r * 0.35, g * 0.35 + 4, b * 0.4 + 12]);
  return mix(col, dark, Math.min(1, -amount));
}
/** outline colour for a fill: same hue, darker, slightly cool */
export function outline(col) { return shade(col, -0.55); }

// ---------- cache ----------
const cache = new Map();
let cacheBytes = 0;

export function createArt(worldSeed) {
  const noiseCache = new Map();
  const noiseFor = (name) => {
    if (!noiseCache.has(name)) noiseCache.set(name, new Noise2D(hashString(worldSeed + ':art:' + name)));
    return noiseCache.get(name);
  };

  const art = {
    PPM,
    canvas: makeCanvas,
    hexToRgb, rgbToHex, rgba, mix, shade, outline,
    noise: noiseFor,
    rng: (name) => new Rng(hashString(worldSeed + ':art:' + name)),

    /**
     * Cached sprite. paint(g, wPx, hPx, rng) is called once. Returns the canvas.
     * key must encode every parameter that changes the look (e.g. 'tree:oak:summer:3').
     */
    sprite(key, wPx, hPx, paint) {
      let c = cache.get(key);
      if (c) return c;
      c = makeCanvas(wPx, hPx);
      const g = c.getContext('2d');
      paint(g, c.width, c.height, new Rng(hashString(worldSeed + ':sprite:' + key)));
      cache.set(key, c);
      cacheBytes += c.width * c.height * 4;
      return c;
    },
    has(key) { return cache.has(key); },
    evict(prefix) {
      for (const k of [...cache.keys()]) if (k.startsWith(prefix)) { const c = cache.get(k); cacheBytes -= c.width * c.height * 4; cache.delete(k); }
    },
    stats() { return { sprites: cache.size, mb: +(cacheBytes / 1048576).toFixed(1) }; },

    /** draw a cached sprite centred at (x,y) metres with size w×h metres, rotated rot (radians, 0 = up) */
    draw(g, img, x, y, w, h, rot = 0, alpha = 1) {
      if (alpha !== 1) g.globalAlpha = alpha;
      if (rot) {
        g.translate(x, y); g.rotate(rot);
        g.drawImage(img, -w / 2, -h / 2, w, h);
        g.rotate(-rot); g.translate(-x, -y);
      } else {
        g.drawImage(img, x - w / 2, y - h / 2, w, h);
      }
      if (alpha !== 1) g.globalAlpha = 1;
    },

    // ---------- painting helpers (operate in pixel space of a sprite canvas) ----------

    /** fill rect area with noisy blend of colours: the base "gouache" texture */
    noiseFill(g, x, y, w, h, colors, { scale = 0.08, grain = 0.06, seed = 'fill', px = 2 } = {}) {
      const n = noiseFor(seed);
      const cols = colors.map(hexToRgb);
      const img = g.getImageData(x, y, w, h);
      const d = img.data;
      const rng = new Rng(hashString(seed + w + 'x' + h));
      for (let j = 0; j < h; j += px) {
        for (let i = 0; i < w; i += px) {
          const v = (n.fbm((x + i) * scale, (y + j) * scale, 3) + 1) / 2; // 0..1
          const f = Math.max(0, Math.min(0.9999, v)) * (cols.length - 1);
          const k = Math.floor(f), t = f - k;
          const a = cols[k], b = cols[Math.min(k + 1, cols.length - 1)];
          const gr = 1 + (rng.float() - 0.5) * grain * 2;
          const r = (a[0] + (b[0] - a[0]) * t) * gr, gg = (a[1] + (b[1] - a[1]) * t) * gr, bb = (a[2] + (b[2] - a[2]) * t) * gr;
          for (let jj = 0; jj < px && j + jj < h; jj++) for (let ii = 0; ii < px && i + ii < w; ii++) {
            const o = ((j + jj) * w + (i + ii)) * 4;
            d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
          }
        }
      }
      g.putImageData(img, x, y);
    },

    /** scatter soft brush dabs (for foliage, grass tufts, gravel) inside a clip already set */
    dabs(g, rng, count, x, y, w, h, colors, rMin, rMax, alpha = 0.6) {
      for (let i = 0; i < count; i++) {
        const px = x + rng.float() * w, py = y + rng.float() * h;
        const r = rng.range(rMin, rMax);
        g.globalAlpha = alpha * rng.range(0.6, 1);
        g.fillStyle = rng.pick(colors);
        g.beginPath();
        g.ellipse(px, py, r, r * rng.range(0.7, 1), rng.float() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },

    /** grain overlay: tiny light/dark specks for the painted-paper feel */
    grain(g, w, h, rng, amount = 0.05, density = 0.02) {
      const n = Math.floor(w * h * density);
      for (let i = 0; i < n; i++) {
        g.fillStyle = rng.chance(0.5) ? `rgba(255,248,230,${amount})` : `rgba(20,24,40,${amount})`;
        g.fillRect(rng.float() * w, rng.float() * h, 1 + rng.float() * 1.5, 1 + rng.float() * 1.5);
      }
    },

    /** wobbly organic polygon path (hand-drawn edge) */
    wobblyPath(g, points, rng, amp = 1.2, closed = true) {
      g.beginPath();
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % n];
        if (i === 0) g.moveTo(x0 + rng.range(-amp, amp) * 0.3, y0 + rng.range(-amp, amp) * 0.3);
        if (!closed && i === n - 1) break;
        const segs = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6));
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const jitter = s === segs ? 0.3 : 1;
          g.lineTo(x0 + (x1 - x0) * t + rng.range(-amp, amp) * jitter, y0 + (y1 - y0) * t + rng.range(-amp, amp) * jitter);
        }
      }
      if (closed) g.closePath();
    },

    /** organic blob path around (cx,cy) with radius r */
    blobPath(g, cx, cy, r, rng, irregularity = 0.18, lobes = 9) {
      g.beginPath();
      const phase = rng.float() * Math.PI * 2;
      const amps = [];
      for (let i = 0; i < 3; i++) amps.push([rng.range(0, irregularity), rng.int(2, lobes), rng.float() * 6.28]);
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2 + phase;
        let rr = r;
        for (const [amp, f, ph] of amps) rr += r * amp * Math.sin(a * f + ph);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    },

    /** radial volume shading for round things (crowns, bushes): lighter centre-top, darker rim */
    volume(g, cx, cy, r, strength = 0.35) {
      const gr = g.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.1, cx, cy, r);
      gr.addColorStop(0, `rgba(255,250,225,${strength * 0.6})`);
      gr.addColorStop(0.55, 'rgba(255,250,225,0)');
      gr.addColorStop(1, `rgba(16,24,34,${strength})`);
      g.fillStyle = gr;
      g.fill();
    },

    /** soft contact shadow ellipse (ambient occlusion) under an object, in pixel space */
    contactShadow(g, cx, cy, rx, ry, alpha = 0.35) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      gr.addColorStop(0, `rgba(20,24,36,${alpha})`);
      gr.addColorStop(1, 'rgba(20,24,36,0)');
      g.save();
      g.translate(cx, cy); g.scale(1, ry / rx); g.translate(-cx, -cy);
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, rx, 0, Math.PI * 2); g.fill();
      g.restore();
    },
  };
  return art;
}
