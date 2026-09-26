// Weather visuals: drifting cloud shadows (into the core shadow pass), rain, snow, fog banks,
// and the screen grade (vignette, golden-hour warmth, overcast desaturation, lightning).
// Everything expensive is baked once into small canvases; per frame we only blit / stroke.

import { clamp, smooth } from './sky.js';

const FIELD_N = 160;          // cloud / fog noise field resolution (tileable)
const CLOUD_PERIOD = 720;     // metres per cloud tile
const FOG_PERIOD_A = 150;     // metres per fog bank tile (large banks)
const FOG_PERIOD_B = 64;      // smaller wisps

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** tileable fbm field in [0,1] via 4-corner blending */
function tileableField(noise, n, freq, octaves) {
  const f = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const sx = u * freq, sy = v * freq;
      const a = noise.fbm(sx, sy, octaves), b = noise.fbm(sx - freq, sy, octaves);
      const c = noise.fbm(sx, sy - freq, octaves), d = noise.fbm(sx - freq, sy - freq, octaves);
      const val = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
      f[y * n + x] = val;
      if (val < min) min = val; if (val > max) max = val;
    }
  }
  const r = max - min || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - min) / r;
  return f;
}

export function createFx(ctx) {
  const { palette } = ctx;
  const shadowRgb = ctx.art.hexToRgb(palette.shadow);
  let cloudField = null, sortedSample = null, detailField = null;
  let cloudCanvas = null, cloudLevel = -1;
  let fogCanvasA = null, fogCanvasB = null;
  let vignette = null, vignetteKey = '';

  function ensureFields() {
    if (cloudField) return;
    cloudField = tileableField(ctx.noise('clouds'), FIELD_N, 3, 5);
    detailField = tileableField(ctx.noise('clouds-detail'), FIELD_N, 9, 3);
    // mix in a little high-frequency detail for torn, painterly edges
    for (let i = 0; i < cloudField.length; i++) cloudField[i] = cloudField[i] * 0.82 + detailField[i] * 0.18;
    const s = [];
    for (let i = 0; i < cloudField.length; i += 5) s.push(cloudField[i]);
    sortedSample = s.sort((a, b) => a - b);
  }

  /** cloud-shadow canvas for a quantised cover level; alpha = shadow density */
  function cloudTexture(cover) {
    ensureFields();
    const level = Math.round(cover * 40);
    if (cloudCanvas && level === cloudLevel) return cloudCanvas;
    cloudLevel = level;
    if (cloudCanvas) cloudCanvas._ver = (cloudCanvas._ver || 0) + 1;
    const cov = level / 40;
    const th = sortedSample[clamp(Math.floor((1 - cov) * sortedSample.length), 0, sortedSample.length - 1)];
    if (!cloudCanvas) cloudCanvas = makeCanvas(FIELD_N, FIELD_N);
    const g = cloudCanvas.getContext('2d');
    const img = g.createImageData(FIELD_N, FIELD_N);
    const d = img.data;
    for (let i = 0; i < cloudField.length; i++) {
      const v = cloudField[i];
      // soft rim, denser core, slight internal variation (thin vs thick cloud)
      const a = smooth(th - 0.05, th + 0.09, v) * (0.72 + 0.28 * smooth(th, th + 0.25, v)) * (0.9 + 0.1 * detailField[i]);
      const o = i * 4;
      d[o] = shadowRgb[0]; d[o + 1] = shadowRgb[1]; d[o + 2] = shadowRgb[2];
      d[o + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    g.putImageData(img, 0, 0);
    return cloudCanvas;
  }

  function fogTextures() {
    if (fogCanvasA) return;
    ensureFields();
    const build = (field, lo, hi, seedShift) => {
      const c = makeCanvas(FIELD_N, FIELD_N);
      const g = c.getContext('2d');
      const img = g.createImageData(FIELD_N, FIELD_N);
      const d = img.data;
      for (let y = 0; y < FIELD_N; y++) for (let x = 0; x < FIELD_N; x++) {
        const i = y * FIELD_N + x;
        const j = ((y + seedShift) % FIELD_N) * FIELD_N + ((x + seedShift * 2) % FIELD_N);
        const v = field[i] * 0.75 + detailField[j] * 0.25;
        const a = smooth(lo, hi, v);
        const o = i * 4;
        // slightly warmer where thick, cooler where thin: painterly variation instead of flat grey
        d[o] = 222 + a * 12; d[o + 1] = 226 + a * 10; d[o + 2] = 230 + a * 4;
        d[o + 3] = Math.round(a * 255);
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    fogCanvasA = build(cloudField, 0.28, 0.78, 0);
    fogCanvasB = build(detailField, 0.35, 0.85, 57);
  }

  /** fill the view with `img` repeated every `period` metres, offset (ox, oy) metres — seamless pattern */
  const patCache = new WeakMap();
  function tile(g, img, period, ox, oy, view, key, ang = 0, stretch = 1) {
    let m = patCache.get(g);
    if (!m) { m = new Map(); patCache.set(g, m); }
    let p = m.get(key);
    if (!p || p.img !== img || p.ver !== (img._ver || 0)) {
      p = { pat: g.createPattern(img, 'repeat'), img, ver: img._ver || 0 };
      m.set(key, p);
    }
    const s = period / img.width;
    if (ang || stretch !== 1) {
      // anisotropic: stretched along 'ang' (fog banks elongate downwind)
      const c = Math.cos(ang), si = Math.sin(ang), a = s * stretch;
      p.pat.setTransform(new DOMMatrix([c * a, si * a, -si * s, c * s, ox, oy]));
    } else p.pat.setTransform(new DOMMatrix([s, 0, 0, s, ox, oy]));
    g.fillStyle = p.pat;
    g.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  }

  // ---------- precipitation tables (deterministic) ----------
  const prng = ctx.rng('precip');
  const DROPS = [];
  for (let i = 0; i < 160; i++) DROPS.push({ rx: prng.float(), ry: prng.float(), ph: prng.float(), sp: prng.range(0.8, 1.25), len: prng.range(0.7, 1.3), near: prng.chance(0.35) });
  const cellHash = (ix, iy) => {
    let h = (ix * 374761393 + iy * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };

  function drawRain(g, view, w, t) {
    const amt = w.rain;
    if (amt < 0.02) return;
    const z = view.zoom;
    const C = 250 / z;                                  // cell size: ~250 px on screen
    const K = Math.round(8 + amt * 30);                // drops per cell
    const wind = w.wind;
    // screen-space streak direction: mostly "down" (falling toward the viewer's feet) + wind drift
    let dx = 0.22 + wind.x * 0.07, dy = 1 + wind.y * 0.03;
    const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
    const travel = 150 / z;                             // metres travelled over a drop's life
    const streak = (16 + 16 * amt) / z;
    const rate = 2.6;
    const ix0 = Math.floor(view.x0 / C) - 1, iy0 = Math.floor((view.y0 - travel) / C) - 1;
    const ix1 = Math.floor(view.x1 / C), iy1 = Math.floor(view.y1 / C);
    const paths = [[], [], [], []];                     // far-edge, far-core, near-edge, near-core
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const h = cellHash(ix, iy);
      for (let k = 0; k < K; k++) {
        const d = DROPS[(h + k * 7) % DROPS.length];
        const life = (t * rate * d.sp + d.ph + (h & 255) / 255) % 1;
        const x = ix * C + d.rx * C + dx * travel * life;
        const y = iy * C + d.ry * C + dy * travel * life;
        const L = streak * d.len * (d.near ? 1.5 : 1);
        if (x < view.x0 - L || x > view.x1 + L || y < view.y0 - L || y > view.y1 + L) continue;
        const edge = life < 0.18 || life > 0.82;
        paths[(d.near ? 2 : 0) + (edge ? 0 : 1)].push(x, y, x - dx * L, y - dy * L);
      }
    }
    const styles = [
      [`rgba(196,210,226,${0.12 + 0.08 * amt})`, 0.9], [`rgba(206,218,232,${0.26 + 0.14 * amt})`, 1.0],
      [`rgba(214,226,238,${0.16 + 0.1 * amt})`, 1.5], [`rgba(226,236,246,${0.36 + 0.16 * amt})`, 1.7],
    ];
    g.lineCap = 'butt';
    for (let p = 0; p < 4; p++) {
      const arr = paths[p];
      if (!arr.length) continue;
      g.strokeStyle = styles[p][0];
      g.lineWidth = styles[p][1] / z;
      g.beginPath();
      for (let i = 0; i < arr.length; i += 4) { g.moveTo(arr[i], arr[i + 1]); g.lineTo(arr[i + 2], arr[i + 3]); }
      g.stroke();
    }
  }

  // soft flake sheets (tileable), painted once; drawn as drifting pattern layers
  let flakeSheets = null;
  function getFlakeSheets() {
    if (flakeSheets) return flakeSheets;
    const r = ctx.rng('flakes');
    const make = (n, rMin, rMax) => {
      const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
      for (let i = 0; i < n; i++) {
        const x = r.float() * S, y = r.float() * S, rad = r.range(rMin, rMax);
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {   // wrap edges
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          gr.addColorStop(0, 'rgba(252,253,255,0.95)');
          gr.addColorStop(0.45, 'rgba(244,248,255,0.7)');
          gr.addColorStop(1, 'rgba(236,242,252,0)');
          g.fillStyle = gr;
          g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 6.2832); g.fill();
        }
      }
      return c;
    };
    flakeSheets = { far: make(70, 1.2, 2.2), mid: make(34, 2, 3.4), near: make(12, 3.4, 5.5) };
    return flakeSheets;
  }

  function drawSnow(g, view, w, t) {
    const amt = w.snow;
    if (amt < 0.02) return;
    const z = view.zoom;
    const sh = getFlakeSheets();
    const wind = w.wind;
    // layers: [sheet, screen px per tile, fall speed px/s, wind response, sway px, alpha]
    const layers = [
      [sh.far, 256, 16, 4, 5, 0.55 + 0.4 * amt],
      [sh.far, 330, 22, 5, 7, amt > 0.35 ? 0.5 + 0.4 * amt : 0],
      [sh.mid, 300, 32, 7, 10, 0.5 + 0.45 * amt],
      [sh.near, 380, 54, 10, 16, 0.35 + 0.55 * amt],
    ];
    for (let i = 0; i < layers.length; i++) {
      const [img, px, fall, wr, sway, a] = layers[i];
      if (a <= 0.01) continue;
      const ox = ((wind.x * wr + 5) * t + Math.sin(t * (0.7 + i * 0.23) + i) * sway) / z;
      const oy = ((fall + wind.y * wr * 0.5) * t + Math.cos(t * (0.5 + i * 0.17)) * sway * 0.4) / z;
      g.globalAlpha = clamp(a, 0, 1);
      tile(g, img, px / z, ox + i * 37 / z, oy + i * 91 / z, view, 'snow' + i);
    }
    g.globalAlpha = 1;
  }

  function drawFog(g, view, w, t, drift) {
    const f = w.fog;
    if (f < 0.02) return;
    w.windAng = Math.atan2(w.wind.y, w.wind.x);
    fogTextures();
    // even milky veil (fog is everywhere) …
    g.fillStyle = `rgba(214,219,222,${0.2 * f + 0.12 * f * f})`;
    g.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    // … plus drifting banks at two scales for depth
    g.globalAlpha = clamp(0.62 * f, 0, 0.62);
    tile(g, fogCanvasA, FOG_PERIOD_A, drift.x * 0.35 % FOG_PERIOD_A, drift.y * 0.35 % FOG_PERIOD_A, view, 'fogA', w.windAng, 2.2);
    g.globalAlpha = clamp(0.4 * f, 0, 0.4);
    tile(g, fogCanvasB, FOG_PERIOD_B, (drift.x * 0.6 + 17) % FOG_PERIOD_B, (drift.y * 0.6 + 31) % FOG_PERIOD_B, view, 'fogB', w.windAng, 1.6);
    g.globalAlpha = 1;
  }

  function drawHaze(g, view, w) {
    // rain / storm air: a thin blue-grey veil that softens distant contrast
    const a = 0.1 * w.rain + 0.08 * w.storm + 0.1 * w.snow;
    if (a < 0.01) return;
    g.fillStyle = w.snow > w.rain ? `rgba(226,232,240,${a})` : `rgba(150,162,178,${a})`;
    g.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  }

  function getVignette(W, H) {
    const key = W + 'x' + H;
    if (vignette && vignetteKey === key) return vignette;
    vignetteKey = key;
    const s = 0.5;                                        // half resolution is plenty for a smooth gradient
    vignette = makeCanvas(Math.ceil(W * s), Math.ceil(H * s));
    const g = vignette.getContext('2d');
    const cx = vignette.width / 2, cy = vignette.height / 2, R = Math.hypot(cx, cy);
    const gr = g.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
    gr.addColorStop(0, 'rgba(22,20,34,0)');
    gr.addColorStop(0.55, 'rgba(22,20,34,0.35)');
    gr.addColorStop(1, 'rgba(22,20,34,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, vignette.width, vignette.height);
    return vignette;
  }

  /** screen layer: identity transform in CSS px */
  function drawScreen(g, view, st) {
    const W = view.w, H = view.h;
    const w = st.weather;
    // golden-hour grade: warm light washing in from the sun's side of the screen
    const golden = st.golden;
    if (golden > 0.01) {
      const ax = -st.shadowDir.x, ay = -st.shadowDir.y;       // toward the sun
      const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
      const gr = g.createLinearGradient(cx + ax * R, cy + ay * R, cx - ax * R, cy - ay * R);
      gr.addColorStop(0, `rgba(255,170,92,${0.5 * golden})`);
      gr.addColorStop(0.5, `rgba(255,190,120,${0.22 * golden})`);
      gr.addColorStop(1, `rgba(150,120,170,${0.16 * golden})`);
      g.globalCompositeOperation = 'soft-light';
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // night: moonlight blue wash (scotopic vision is blue-shifted and colour-poor)
    const night = st.night;
    if (night > 0.02) {
      g.globalCompositeOperation = 'soft-light';
      g.fillStyle = `rgba(70,96,170,${0.55 * night})`;
      g.fillRect(0, 0, W, H);
    }
    // grey days lose saturation (gouache greys), fog most of all
    const desat = clamp(0.2 * w.cloudCover + 0.12 * w.rain + 0.25 * w.fog + 0.1 * w.storm + 0.28 * night, 0, 0.6);
    if (desat > 0.02) {
      g.globalCompositeOperation = 'saturation';
      g.globalAlpha = desat;
      g.fillStyle = '#808080';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
    // vignette: subtle by day, deeper at night and in storms
    const vig = clamp(0.2 + 0.28 * st.night + 0.18 * w.storm + 0.08 * w.rain, 0, 0.62);
    g.globalAlpha = vig;
    g.drawImage(getVignette(W, H), 0, 0, W, H);
    g.globalAlpha = 1;
    // lightning: the whole sky lights up, strongest around the (off-screen) strike
    if (st.flash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      const fx = st.flashAt.x * W, fy = st.flashAt.y * H;
      const gr = g.createRadialGradient(fx, fy, 0, fx, fy, Math.hypot(W, H) * 0.9);
      gr.addColorStop(0, `rgba(210,220,255,${0.5 * st.flash})`);
      gr.addColorStop(1, `rgba(170,185,235,${0.14 * st.flash})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
  }

  function drawCloudShadows(sg, view, cover, drift) {
    if (cover < 0.04) return;
    const tex = cloudTexture(cover);
    // fully overcast skies have no distinct cloud shadows (the light is already flat)
    const a = cover > 0.8 ? clamp(1 - (cover - 0.8) / 0.18, 0, 1) : 1;
    if (a <= 0.01) return;
    sg.globalAlpha = a;
    sg.imageSmoothingEnabled = true;
    tile(sg, tex, CLOUD_PERIOD, ((drift.x % CLOUD_PERIOD) + CLOUD_PERIOD) % CLOUD_PERIOD, ((drift.y % CLOUD_PERIOD) + CLOUD_PERIOD) % CLOUD_PERIOD, view, 'cloud');
    sg.globalAlpha = 1;
  }

  return { drawRain, drawSnow, drawFog, drawHaze, drawScreen, drawCloudShadows, ensureFields };
}
