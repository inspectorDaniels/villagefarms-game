// Showcase "sound board": renders every synthesized sound with an OfflineAudioContext, analyses it
// (peak, RMS, centroid, autocorrelation f0, STFT) and paints waveform + log-frequency spectrogram cards
// in the game's paper-and-ink style. A live mixer panel shows director levels and real bus meters.
import { resources, gain, clamp } from './synth.js';
import { ONESHOTS } from './oneshots.js';
import { LOOPS } from './loops.js';
import { ambienceLevels } from './director.js';

const SR = 24000;

// ------------------------------------------------------------------ rendering
async function render(mk, dur, build) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oac = new OAC(1, Math.ceil(dur * SR), SR);
  const R = resources(oac, mk);
  const out = gain(oac, 1); out.connect(oac.destination);
  build(oac, out, R);
  const buf = await oac.startRendering();
  return buf.getChannelData(0).slice();
}
function renderShot(mk, id, opts = {}) {
  return render(mk, opts.dur || 1.2, (ac, out, R) => {
    const o = { rng: mk('board:' + id), p: opts.p || 1, dist: opts.dist };
    ONESHOTS[id](ac, out, 0.02, R, o);
  });
}
function renderLoop(mk, id, dur, params = {}, script = null) {
  return render(mk, dur, (ac, out, R) => {
    const v = LOOPS[id](ac, out, R, { rng: mk('board:' + id), t0: 0, params });
    for (const k of Object.keys(params)) v.set(k, params[k], 0);
    if (script) script(v);
    if (v.tick) v.tick(0, dur);
  });
}

// ------------------------------------------------------------------ analysis
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
/** STFT → log-frequency image rows×cols of 0..1 (dB -80..0 re max) + mean spectrum */
function spectrogram(x, cols, rows, { n = 1024, fmin = 60, fmax = 11500, t0 = 0, t1 = null } = {}) {
  const s0 = Math.floor(t0 * SR), s1 = Math.min(x.length, Math.floor((t1 == null ? x.length / SR : t1) * SR));
  const re = new Float64Array(n), im = new Float64Array(n), win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  const binHz = SR / n, nb = n / 2;
  const rowLo = new Float64Array(rows), rowHi = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const f = (k) => fmax * Math.pow(fmin / fmax, k / (rows - 1));
    rowLo[r] = f(r + 0.5) / binHz; rowHi[r] = f(r - 0.5) / binHz;
  }
  const M = new Float32Array(rows * cols), mean = new Float64Array(nb);
  let ref = 1e-9;
  for (let c = 0; c < cols; c++) {
    const center = s0 + ((c + 0.5) / cols) * (s1 - s0);
    const st = Math.floor(center - n / 2);
    for (let i = 0; i < n; i++) { const j = st + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float64Array(nb);
    for (let k = 0; k < nb; k++) { mag[k] = Math.hypot(re[k], im[k]); mean[k] += mag[k]; }
    for (let r = 0; r < rows; r++) {
      const lo = rowLo[r], hi = rowHi[r];
      let v;
      if (hi - lo < 1) { const k = Math.min(nb - 2, Math.floor((lo + hi) / 2)), t = (lo + hi) / 2 - k; v = mag[k] * (1 - t) + mag[k + 1] * t; }
      else { v = 0; for (let k = Math.floor(lo); k <= Math.min(nb - 1, Math.ceil(hi)); k++) v = Math.max(v, mag[k]); }
      M[r * cols + c] = v;
      if (v > ref) ref = v;
    }
  }
  for (let i = 0; i < M.length; i++) M[i] = clamp((20 * Math.log10(M[i] / ref + 1e-12) + 80) / 80, 0, 1);
  let num = 0, den = 0;
  for (let k = 1; k < nb; k++) { num += k * binHz * mean[k]; den += mean[k]; }
  return { M, cols, rows, fmin, fmax, centroid: den > 0 ? num / den : 0 };
}
function levels(x) {
  let pk = 0, s = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; s += x[i] * x[i]; }
  // RMS over the active part (above -50 dB of peak) so short sounds aren't diluted by silence
  let s2 = 0, n2 = 0; const th = pk * 0.003;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) { s2 += x[i] * x[i]; n2++; }
  return { peak: pk, peakDb: 20 * Math.log10(pk + 1e-9), rmsDb: 20 * Math.log10(Math.sqrt(s2 / Math.max(1, n2)) + 1e-9) };
}
/** autocorrelation pitch over [t0,t1] (or the loudest window) */
function pitch(x, fmin, fmax, t0 = null, t1 = null) {
  let a, N;
  if (t0 != null) { a = Math.floor(t0 * SR); N = Math.floor((t1 - t0) * SR); }
  else {
    N = 2048; let best = -1; a = 0;
    for (let s = 0; s + N < x.length; s += 512) { let e = 0; for (let i = 0; i < N; i += 4) e += x[s + i] * x[s + i]; if (e > best) { best = e; a = s; } }
  }
  const lmin = Math.floor(SR / fmax), lmax = Math.min(Math.floor(SR / fmin), Math.floor(N / 2));
  const ac = new Float64Array(lmax + 1);
  let e0 = 0; for (let i = 0; i < N - lmax; i++) e0 += x[a + i] * x[a + i];
  if (e0 <= 0) return null;
  let top = 0;
  for (let l = lmin; l <= lmax; l++) {
    let s = 0, e1 = 0;
    for (let i = 0; i < N - lmax; i++) { s += x[a + i] * x[a + i + l]; e1 += x[a + i + l] * x[a + i + l]; }
    ac[l] = s / Math.sqrt(e0 * e1 + 1e-12);
    if (ac[l] > top) top = ac[l];
  }
  // first local peak within 90 % of the best (avoids octave errors)
  for (let l = lmin + 1; l < lmax; l++) {
    if (ac[l] >= top * 0.9 && ac[l] >= ac[l - 1] && ac[l] >= ac[l + 1]) {
      const y0 = ac[l - 1], y1 = ac[l], y2 = ac[l + 1], d = clamp((y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1), -0.5, 0.5);
      return { f: SR / (l + d), clarity: y1 };
    }
  }
  return null;
}

// ------------------------------------------------------------------ painting
function makeLUT(art, pal) {
  const stops = [[0, pal.paper], [0.32, '#e6d6ae'], [0.5, pal.gold], [0.66, pal.accent2], [0.82, art.mix(pal.accent2, pal.ink, 0.55)], [1, pal.ink]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ca] = stops[k], [b, cb] = stops[k + 1];
    const c = art.hexToRgb(art.mix(ca, cb, clamp((v - a) / (b - a), 0, 1)));
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}
function specCanvas(S, lut, rng) {
  const c = document.createElement('canvas'); c.width = S.cols; c.height = S.rows;
  const g = c.getContext('2d'), img = g.createImageData(S.cols, S.rows), d = img.data;
  for (let i = 0; i < S.M.length; i++) {
    // slight gamma so quiet detail reads, plus paper grain
    const v = Math.pow(S.M[i], 1.35), k = Math.min(255, Math.max(0, Math.round(v * 255 + (rng.float() - 0.5) * 10)));
    d[i * 4] = lut[k * 3]; d[i * 4 + 1] = lut[k * 3 + 1]; d[i * 4 + 2] = lut[k * 3 + 2]; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function wobblyRect(g, art, rng, x, y, w, h, amp = 1.2) {
  art.wobblyPath(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], rng, amp);
}
function paintPaper(g, art, pal, w, h, rng) {
  g.fillStyle = pal.paper; g.fillRect(0, 0, w, h);
  const tw = Math.ceil(w / 4), th = Math.ceil(h / 4);
  const t = document.createElement('canvas'); t.width = tw; t.height = th;
  art.noiseFill(t.getContext('2d'), 0, 0, tw, th, [pal.paper, '#efe3c8', pal.paper, '#f6efdf', pal.paperDark], { scale: 0.035, grain: 0.04, seed: 'audio-paper', px: 1 });
  g.globalAlpha = 0.9; g.drawImage(t, 0, 0, w, h); g.globalAlpha = 1;
  art.grain(g, w, h, rng, 0.05, 0.012);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(120,90,50,0)'); vg.addColorStop(1, 'rgba(120,90,50,0.22)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
}
function cardBg(g, art, pal, rng, x, y, w, h) {
  g.save();
  g.fillStyle = 'rgba(60,44,28,0.10)';
  wobblyRect(g, art, rng, x + 3, y + 3, w, h, 1.5); g.fill();
  g.fillStyle = art.mix(pal.paper, '#fffaf0', 0.45);
  wobblyRect(g, art, rng, x, y, w, h, 1.3); g.fill();
  g.strokeStyle = art.rgba(pal.ink, 0.55); g.lineWidth = 1.3; g.stroke();
  g.restore();
}
function drawWave(g, art, pal, x, y, w, h, data, t0 = 0, t1 = null) {
  const s0 = Math.floor(t0 * SR), s1 = t1 == null ? data.length : Math.min(data.length, Math.floor(t1 * SR));
  let pk = 1e-6; for (let i = s0; i < s1; i++) pk = Math.max(pk, Math.abs(data[i]));
  const sc = Math.min(1, 0.95 / pk) * (h / 2); // auto-gain, but never exaggerate beyond full scale
  const mid = y + h / 2, per = (s1 - s0) / w;
  g.strokeStyle = art.rgba(pal.inkSoft, 0.35); g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(x, mid); g.lineTo(x + w, mid); g.stroke();
  g.beginPath();
  const lo = [];
  for (let c = 0; c < w; c++) {
    let mn = 0, mx = 0;
    const a = Math.floor(s0 + c * per), b = Math.max(a + 1, Math.floor(s0 + (c + 1) * per));
    for (let i = a; i < b && i < s1; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (c === 0) g.moveTo(x + c, mid - mx * sc); else g.lineTo(x + c, mid - mx * sc);
    lo.push(mid - mn * sc);
  }
  for (let c = w - 1; c >= 0; c--) g.lineTo(x + c, lo[c]);
  g.closePath();
  g.fillStyle = art.rgba(pal.ink, 0.8); g.fill();
}
function drawSpec(g, art, pal, rng, x, y, w, h, can, S, labels = true) {
  g.imageSmoothingEnabled = true;
  g.drawImage(can, x, y, w, h);
  g.strokeStyle = art.rgba(pal.ink, 0.5); g.lineWidth = 1;
  wobblyRect(g, art, rng, x, y, w, h, 0.6); g.stroke();
  if (!labels) return;
  g.font = '9px "Segoe UI", system-ui, sans-serif'; g.fillStyle = art.rgba(pal.ink, 0.7);
  for (const [f, l] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    if (f < S.fmin || f > S.fmax) continue;
    const yy = y + h * (Math.log(S.fmax / f) / Math.log(S.fmax / S.fmin));
    g.fillRect(x, yy, 4, 1);
    g.fillText(l, x + 6, yy + 3);
  }
}
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz');

// ------------------------------------------------------------------ catalogue
const CAT = {
  ui: '#3f6b3a', step: '#8a6a48', animal: '#b5653a', farm: '#c99a2e', weather: '#3f7a8c', engine: '#b8352b', amb: '#5f8f38', music: '#6b4d7a',
};
const SHOTS = [
  ['ui-click', 'ui', 0.3], ['ui-open', 'ui', 0.8], ['coin', 'ui', 1.2], ['error', 'ui', 0.6],
  ['footstep-grass', 'step', 0.4], ['footstep-gravel', 'step', 0.4], ['footstep-asphalt', 'step', 0.35], ['footstep-mud', 'step', 0.45], ['footstep-snow', 'step', 0.45],
  ['door', 'farm', 1.2], ['plough-clod', 'farm', 0.6], ['harvest-thresh', 'farm', 1.7], ['horn', 'farm', 0.7],
  ['moo', 'animal', 1.8], ['baa', 'animal', 1.1], ['cluck', 'animal', 1.2], ['bark', 'animal', 0.7],
  ['splash', 'weather', 0.9], ['thunder', 'weather', 6.5],
];
const LOOPS_SHOWN = [
  ['engine-tractor', 'engine', 2.5, { rpm: 0.35, load: 0.5 }], ['engine-car', 'engine', 2.5, { rpm: 0.3, load: 0.3 }],
  ['engine-combine', 'engine', 2.5, { rpm: 0.7, load: 0.8 }],
  ['river', 'amb', 3, { flow: 0.7 }], ['wind', 'amb', 4, { speed: 0.6 }], ['rain', 'amb', 3, { intensity: 0.7 }],
  ['crickets', 'amb', 3, { intensity: 0.9 }], ['birds', 'amb', 5, { density: 1, season: 'spring' }],
  ['owl', 'amb', 5, { density: 1 }], ['music', 'music', 7, {}],
];
const PITCH_RANGE = { moo: [60, 400], baa: [150, 600], cluck: [300, 600], bark: [250, 1200], horn: [300, 700], error: [150, 400], 'engine-tractor': [3, 60], 'engine-car': [3, 60], 'engine-combine': [3, 60] };

// ------------------------------------------------------------------ build
export async function buildBoard({ ctx, preset, mk, busLevel, weather, state }) {
  const art = ctx.art, pal = ctx.palette.ui, rng = ctx.rng('board-paint');
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  const lut = makeLUT(art, pal);
  const analysis = (ctx.world.audio.analysis = {});
  const items = [];
  const errors = [];
  async function add(item, job) {
    try {
      item.data = await job();
      const lv = levels(item.data);
      item.lv = lv;
      const pr = PITCH_RANGE[item.id];
      item.f0 = pr ? pitch(item.data, pr[0], pr[1]) : null;
      analysis[item.key || item.id] = { peakDb: +lv.peakDb.toFixed(1), rmsDb: +lv.rmsDb.toFixed(1), f0: item.f0 ? +item.f0.f.toFixed(1) : null, clarity: item.f0 ? +item.f0.clarity.toFixed(2) : null, dur: +(item.data.length / SR).toFixed(2) };
      items.push(item);
    } catch (e) { errors.push(item.id + ': ' + (e && e.message)); }
  }
  const t0 = ctx.clock.timeOfDay;
  if (OAC) {
    if (preset === 'engines') {
      for (const id of ['engine-tractor', 'engine-car', 'engine-combine']) {
        const curve = (t) => {
          if (t < 1) return [0, 0];
          if (t < 2.5) return [(t - 1) / 1.5, 0.3];
          if (t < 3) return [1, 0.3];
          if (t < 4.5) return [1, 1];
          if (t < 5.3) return [1 - (t - 4.5) / 0.8, 0];
          return [0, 0];
        };
        await add({ id, cat: 'engine', curve, sweep: true }, () => renderLoop(mk, id, 6.2, { rpm: 0, load: 0 }, (v) => {
          for (let t = 0; t < 6.2; t += 0.05) { const [r, l] = curve(t); v.set('rpm', r, t); v.set('load', l, t); }
        }));
        const it = items[items.length - 1];
        if (it && it.id === id) {
          it.idle = pitch(it.data, 3, 60, 0.35, 0.95);
          it.full = pitch(it.data, 3, 60, 3.6, 4.4);
          analysis[id].idleCycleHz = it.idle ? +it.idle.f.toFixed(2) : null;
          analysis[id].fullCycleHz = it.full ? +it.full.f.toFixed(2) : null;
        }
      }
    } else if (preset === 'ambience-day' || preset === 'ambience-night') {
      const W = weather();
      const lv = ambienceLevels(t0, ctx.clock.season, ctx.clock.yearFrac, W, 0);
      const mixDur = 8;
      await add({ id: 'mix', key: 'mix', cat: 'amb', title: 'What you hear now', lv0: lv, wide: true }, () => render(mk, mixDur, (ac, out, R) => {
        const mkL = (id, vol, params) => {
          if (vol <= 0.012) return;
          const g = gain(ac, 0); g.connect(out);
          g.gain.setTargetAtTime(vol, 0, 0.3);
          const v = LOOPS[id](ac, g, R, { rng: mk('mix:' + id), t0: 0, params });
          for (const k of Object.keys(params)) v.set(k, params[k], 0);
          if (v.tick) v.tick(0, mixDur);
        };
        const amb = 0.7;
        mkL('birds', amb * (0.55 + 0.45 * lv.birds), { density: lv.birds, season: ctx.clock.season });
        mkL('owl', amb * (0.55 + 0.45 * lv.owl), { density: lv.owl });
        mkL('crickets', amb * (0.35 + 0.65 * lv.crickets) * (lv.crickets > 0.012 ? 1 : 0), { intensity: lv.crickets });
        mkL('wind', amb * lv.wind, { speed: clamp(W.windSpeed / 15, 0, 1) });
        mkL('rain', amb * (lv.rain > 0.012 ? 0.5 + 0.5 * lv.rain : 0), { intensity: lv.rain });
        mkL('music', 0.35 * lv.music, {});
        if (W.storm) { const g = gain(ac, 0.9 * amb); g.connect(out); ONESHOTS.thunder(ac, g, 2.2, R, { rng: mk('mix:thunder'), p: 1, dist: 0.45 }); }
      }));
      const night = preset === 'ambience-night';
      const list = [
        ['birds', 'amb', 6, { density: night ? 0.5 : 1, season: ctx.clock.season }],
        ['crickets', 'amb', 4, { intensity: 0.9 }], ['owl', 'amb', 6, { density: 1 }],
        ['wind', 'amb', 5, { speed: 0.7 }], ['rain', 'amb', 4, { intensity: 0.8 }], ['river', 'amb', 4, { flow: 0.8 }],
        ['music', 'music', 8, {}],
      ];
      for (const [id, cat, dur, params] of list) await add({ id, cat }, () => renderLoop(mk, id, dur, params));
      await add({ id: 'thunder', cat: 'weather' }, () => renderShot(mk, 'thunder', { dur: 6.5, dist: 0.3 }));
    } else {
      for (const [id, cat, dur] of SHOTS) await add({ id, cat }, () => renderShot(mk, id, { dur }));
      for (const [id, cat, dur, params] of LOOPS_SHOWN) await add({ id, cat, loop: true }, () => renderLoop(mk, id, dur, params));
    }
  }

  // ---------------- static layer
  const W = ctx.camera.w || 1600, H = ctx.camera.h || 900, dpr = Math.min(2, window.devicePixelRatio || 1);
  const can = document.createElement('canvas'); can.width = Math.round(W * dpr); can.height = Math.round(H * dpr);
  const g = can.getContext('2d'); g.scale(dpr, dpr);
  paintPaper(g, art, pal, W, H, rng);
  const SIDE = 300, M = 16, gx = M, gy = 74, gw = W - SIDE - M * 3, gh = H - gy - M;
  // header
  const titles = {
    default: ['Sound board', 'every sound is synthesised live in WebAudio — rendered here offline at 24 kHz: waveform (ink) + log-frequency spectrogram 60 Hz–11.5 kHz'],
    engines: ['Engines', 'firing-order harmonics + gated combustion noise, rpm sweep idle → full → full load → idle (ink line = rpm, rust line = load)'],
    'ambience-day': ['Ambience — dawn', 'the director mixes birds, wind, river, rain, crickets, owl and music from time, season and weather'],
    'ambience-night': ['Ambience — night', 'the director mixes birds, wind, river, rain, crickets, owl and music from time, season and weather'],
  }[preset] || ['Sound board', ''];
  g.fillStyle = pal.ink; g.font = 'bold 28px Georgia, serif';
  g.fillText('Harvest Valley · ' + titles[0], M + 4, 38);
  g.font = 'italic 13px Georgia, serif'; g.fillStyle = pal.inkSoft;
  g.fillText(titles[1], M + 4, 60);
  g.strokeStyle = art.rgba(pal.ink, 0.4); g.lineWidth = 1.2;
  art.wobblyPath(g, [[M, 68], [W - M, 68]], rng, 0.8, false); g.stroke();

  const card = (it, x, y, w, h, opts = {}) => {
    cardBg(g, art, pal, rng, x, y, w, h);
    const color = CAT[it.cat] || pal.accent;
    g.fillStyle = art.rgba(color, 0.85);
    art.blobPath(g, x + 13, y + 14, 5, rng, 0.2, 5); g.fill();
    g.fillStyle = pal.ink; g.font = `bold ${opts.big ? 16 : 13}px Georgia, serif`;
    g.fillText(it.title || it.id, x + 23, y + 18);
    g.font = '10px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.inkSoft;
    const dur = (it.data.length / SR).toFixed(1) + ' s' + (it.loop ? ' loop' : '');
    g.textAlign = 'right'; g.fillText(dur, x + w - 8, y + 17); g.textAlign = 'left';
    const pad = 8, waveH = opts.waveH || 24, footH = 14;
    drawWave(g, art, pal, x + pad, y + 24, w - pad * 2, waveH, it.data);
    const sy = y + 26 + waveH, sh = h - (sy - y) - footH - 4;
    const S = spectrogram(it.data, Math.max(32, Math.round((w - pad * 2) / (opts.big ? 1 : 1.5))), Math.max(24, Math.round(sh / 1.2)), opts.spec || {});
    it.centroid = S.centroid;
    drawSpec(g, art, pal, rng, x + pad, sy, w - pad * 2, sh, specCanvas(S, lut, rng), S);
    g.font = '10px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.inkSoft;
    let foot = `pk ${it.lv.peakDb.toFixed(1)} · rms ${it.lv.rmsDb.toFixed(0)} dB · c ${fmtHz(S.centroid)}`;
    if (it.f0 && !it.sweep) foot += ` · f0 ${Math.round(it.f0.f)}`;
    if (opts.foot) foot = opts.foot;
    g.fillText(foot, x + pad, y + h - 6);
    analysis[it.key || it.id].centroid = Math.round(S.centroid);
  };

  if (preset === 'engines') {
    const rh = (gh - 20) / 3;
    items.forEach((it, i) => {
      const x = gx, y = gy + i * (rh + 10), w = gw, h = rh;
      cardBg(g, art, pal, rng, x, y, w, h);
      g.fillStyle = art.rgba(CAT.engine, 0.85); art.blobPath(g, x + 14, y + 16, 6, rng, 0.2, 5); g.fill();
      g.fillStyle = pal.ink; g.font = 'bold 17px Georgia, serif'; g.fillText(it.id, x + 26, y + 21);
      const spx = x + 10, spy = y + 30, spw = Math.round(w * 0.64), sph = h - 42;
      const S = spectrogram(it.data, Math.round(spw / 1.25), Math.round(sph / 1.25), { n: 4096, fmin: 20, fmax: 6000 });
      drawSpec(g, art, pal, rng, spx, spy, spw, sph, specCanvas(S, lut, rng), S);
      // rpm & load curves
      const dur = it.data.length / SR;
      for (const [k, col, dash] of [[0, pal.ink, []], [1, pal.accent2, [5, 4]]]) {
        g.strokeStyle = art.rgba(col, 0.85); g.lineWidth = 2; g.setLineDash(dash);
        g.beginPath();
        for (let c = 0; c <= 120; c++) { const t = c / 120 * dur, v = it.curve(t)[k]; const px = spx + c / 120 * spw, py = spy + sph - 8 - v * (sph - 30); if (c) g.lineTo(px, py); else g.moveTo(px, py); }
        g.stroke();
      }
      g.setLineDash([]);
      g.font = '11px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.ink;
      g.fillText('rpm', spx + spw * 0.3, spy + 26); g.fillStyle = pal.accent2; g.fillText('load', spx + spw * 0.63, spy + 26);
      // waveform snippets
      const rx = spx + spw + 16, rw = x + w - rx - 12, wh = (sph - 40) / 2;
      const C = { 'engine-tractor': [850, 2300, 4], 'engine-car': [800, 6200, 4], 'engine-combine': [900, 2200, 6] }[it.id];
      const snip = [['idle, no load', 0.4, 0.7, it.idle, C[0]], ['full rpm, full load', 3.9, 4.2, it.full, C[1]]];
      snip.forEach(([lab, a, b, p, rpm], k) => {
        const yy = spy + k * (wh + 20);
        g.fillStyle = pal.inkSoft; g.font = 'italic 12px Georgia, serif';
        g.fillText(`${lab} — 300 ms`, rx, yy + 10);
        drawWave(g, art, pal, rx, yy + 14, rw, wh - 6, it.data, a, b);
        g.font = '11px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.ink;
        const cyc = rpm / 120, mult = p ? Math.max(1, Math.round(p.f / cyc)) : 1;
        const meas = p ? `periodicity ${p.f.toFixed(2)} Hz = ${mult}× cycle → ${Math.round(p.f / mult * 120)} rpm` : 'cycle not detected';
        g.fillText(`${meas}  (target ${rpm} rpm, firing ${(rpm / 120 * C[2]).toFixed(0)} Hz)`, rx, yy + wh + 16);
      });
      analysis[it.id].centroid = Math.round(S.centroid);
    });
  } else if (preset === 'ambience-day' || preset === 'ambience-night') {
    const mix = items.find((i) => i.id === 'mix');
    const rest = items.filter((i) => i.id !== 'mix');
    const topH = Math.round(gh * 0.36);
    if (mix) {
      const lv = mix.lv0;
      const parts = ['birds', 'crickets', 'owl', 'wind', 'rain', 'music'].filter((k) => lv[k] > 0.012).map((k) => `${k} ${(lv[k] * 100).toFixed(0)}%`);
      if (weather().storm) parts.push('+ thunder at 2.2 s');
      card(mix, gx, gy, gw, topH, { big: true, waveH: 36, foot: `director mix at ${ctx.clock.format()}, ${ctx.clock.season}: ${parts.join(' · ')}   (pk ${mix.lv.peakDb.toFixed(1)} dB, rms ${mix.lv.rmsDb.toFixed(0)} dB)` });
    }
    const cols = 4, rows = 2, cw = (gw - (cols - 1) * 10) / cols, ch = (gh - topH - 10 - (rows - 1) * 10) / rows;
    rest.forEach((it, i) => card(it, gx + (i % cols) * (cw + 10), gy + topH + 10 + Math.floor(i / cols) * (ch + 10), cw, ch));
  } else {
    const cols = 6, rows = Math.ceil(items.length / cols), cw = (gw - (cols - 1) * 8) / cols, ch = (gh - (rows - 1) * 8) / rows;
    items.forEach((it, i) => card(it, gx + (i % cols) * (cw + 8), gy + Math.floor(i / cols) * (ch + 8), cw, ch));
  }
  if (!OAC || errors.length) {
    g.fillStyle = pal.danger; g.font = '13px "Segoe UI", system-ui, sans-serif';
    g.fillText(!OAC ? 'OfflineAudioContext not available — cannot render the board' : 'render errors: ' + errors.join('; ').slice(0, 160), gx, H - 8);
  }

  // sidebar background (static)
  const sx = W - SIDE - M, sy = gy, sw = SIDE, sh = gh;
  cardBg(g, art, pal, rng, sx, sy, sw, sh);

  // 24-hour level chart (static part)
  const W0 = weather();
  const chart = { x: sx + 14, y: sy + 330, w: sw - 28, h: 150 };
  const LAYERS = [['birds', CAT.amb], ['crickets', '#8a8a3a'], ['owl', '#6b5a45'], ['wind', CAT.weather], ['rain', '#2f5d74'], ['music', CAT.music]];
  g.fillStyle = pal.ink; g.font = 'bold 14px Georgia, serif';
  g.fillText('Levels over 24 h', chart.x, chart.y - 10);
  g.strokeStyle = art.rgba(pal.ink, 0.35); g.lineWidth = 1;
  g.strokeRect(chart.x, chart.y, chart.w, chart.h);
  g.font = '9px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.inkSoft;
  for (let hh = 0; hh <= 24; hh += 6) { const px = chart.x + hh / 24 * chart.w; g.fillRect(px, chart.y + chart.h, 1, 4); g.fillText(String(hh).padStart(2, '0'), px - 5, chart.y + chart.h + 13); }
  const sun = ambienceLevels(12, ctx.clock.season, ctx.clock.yearFrac, W0, 0);
  g.fillStyle = 'rgba(46,42,36,0.07)';
  g.fillRect(chart.x, chart.y, sun.sunrise / 24 * chart.w, chart.h);
  g.fillRect(chart.x + sun.sunset / 24 * chart.w, chart.y, (24 - sun.sunset) / 24 * chart.w, chart.h);
  for (const [k, col] of LAYERS) {
    g.strokeStyle = art.rgba(col, 0.9); g.lineWidth = 1.8; g.beginPath();
    for (let i = 0; i <= 96; i++) {
      const hh = i / 4, v = ambienceLevels(hh, ctx.clock.season, ctx.clock.yearFrac, W0, 0)[k];
      const px = chart.x + i / 96 * chart.w, py = chart.y + chart.h - 3 - v * (chart.h - 8);
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  }
  g.font = '10px "Segoe UI", system-ui, sans-serif';
  LAYERS.forEach(([k, col], i) => { const lx = chart.x + (i % 3) * 90, ly = chart.y + chart.h + 28 + Math.floor(i / 3) * 14; g.fillStyle = col; g.fillRect(lx, ly - 7, 12, 3); g.fillStyle = pal.inkSoft; g.fillText(k, lx + 16, ly - 3); });
  g.fillText(`${ctx.clock.season}, sunrise ${hm(sun.sunrise)} · sunset ${hm(sun.sunset)}`, chart.x, chart.y + chart.h + 62);

  // legend of analysis at bottom of sidebar
      let yy = chart.y + chart.h + 86;
      g.fillStyle = pal.ink; g.font = 'bold 13px Georgia, serif'; g.fillText('How to read', sx + 14, yy); yy += 16;
      g.font = '11px "Segoe UI", system-ui, sans-serif'; g.fillStyle = pal.inkSoft;
      for (const line of ['ink = waveform (auto-scaled, never above 0 dBFS)', 'wash = spectrogram, dark = loud (−80…0 dB)', 'pk/rms = peak & active RMS in dBFS', 'f0 = autocorrelation pitch (voices, engines)']) { g.fillText(line, sx + 14, yy); yy += 14; }
      // colour scale
      for (let i = 0; i < 100; i++) { const k = Math.round(i / 99 * 255); g.fillStyle = `rgb(${lut[k * 3]},${lut[k * 3 + 1]},${lut[k * 3 + 2]})`; g.fillRect(sx + 14 + i * 2.6, yy, 2.7, 8); }

  const comp = document.createElement('canvas'); comp.width = can.width; comp.height = can.height;
  const cg = comp.getContext('2d');
  let nFrame = 0;
  const frameRng = ctx.rng('board-frame');
  const barJ = []; for (let i = 0; i < 16; i++) barJ.push(frameRng.range(-1, 1));

  // ---------------- per-frame
  return {
    items,
    draw(gOut, view) {
      nFrame++;
      if (nFrame % 8 !== 1) { gOut.drawImage(comp, 0, 0, W, H); return; }
      const g2 = cg;
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.drawImage(can, 0, 0, W, H);
      const A = ctx.world.audio;
      let y = sy + 26;
      g2.fillStyle = pal.ink; g2.font = 'bold 16px Georgia, serif';
      g2.fillText('Ambience mixer', sx + 14, y);
      g2.font = '11px "Segoe UI", system-ui, sans-serif'; g2.fillStyle = pal.inkSoft;
      const Wn = weather();
      y += 17;
      g2.fillText(`${ctx.clock.format()} · ${ctx.clock.season} · ${Wn.kind}${Wn.rain ? ' ' + Math.round(Wn.rain * 100) + '%' : ''} · wind ${Wn.windSpeed.toFixed(0)} m/s`, sx + 14, y);
      y += 16;
      const rowsL = ['birds', 'crickets', 'owl', 'wind', 'rain', 'river', 'music'];
      rowsL.forEach((k, i) => {
        const v = A.mixer[k] || 0, bx = sx + 78, bw = sw - 130;
        g2.fillStyle = pal.ink; g2.font = '12px Georgia, serif'; g2.fillText(k, sx + 14, y + 11);
        g2.fillStyle = 'rgba(46,42,36,0.08)'; g2.fillRect(bx, y + 2, bw, 11);
        const col = (LAYERS.find((l) => l[0] === k) || [0, CAT.weather])[1];
        g2.fillStyle = art.rgba(col, 0.75); g2.fillRect(bx, y + 2 + barJ[i] * 0.5, Math.max(1, v * bw), 11);
        g2.fillStyle = pal.inkSoft; g2.font = '10px "Segoe UI", system-ui, sans-serif';
        g2.fillText((v * 100).toFixed(0) + '%', bx + bw + 6, y + 11);
        y += 19;
      });
      y += 24;
      g2.fillStyle = pal.ink; g2.font = 'bold 14px Georgia, serif'; g2.fillText('Live buses (real AudioContext)', sx + 14, y); y += 8;
      for (const b of ['sfx', 'ambience', 'music']) {
        const db = busLevel(b), bx = sx + 78, bw = sw - 130;
        y += 17;
        g2.fillStyle = pal.ink; g2.font = '12px Georgia, serif'; g2.fillText(b, sx + 14, y);
        g2.fillStyle = 'rgba(46,42,36,0.08)'; g2.fillRect(bx, y - 9, bw, 10);
        const f = db == null ? 0 : clamp((db + 72) / 72, 0, 1);
        g2.fillStyle = art.rgba(pal.accent, 0.8); g2.fillRect(bx, y - 9, f * bw, 10);
        g2.fillStyle = pal.inkSoft; g2.font = '10px "Segoe UI", system-ui, sans-serif';
        g2.fillText(db == null ? '—' : (db < -119 ? '-inf' : db.toFixed(0)) + ' dB', bx + bw + 6, y);
      }
      y += 20;
      const st = state();
      g2.fillStyle = pal.inkSoft; g2.font = '11px "Segoe UI", system-ui, sans-serif';
      g2.fillText(`context: ${st.ctxState} · loop voices: ${st.voices}`, sx + 14, y);
      // 24h cursor
      const px = chart.x + ctx.clock.timeOfDay / 24 * chart.w;
      g2.strokeStyle = art.rgba(pal.danger, 0.8); g2.lineWidth = 1.5;
      g2.beginPath(); g2.moveTo(px, chart.y - 2); g2.lineTo(px, chart.y + chart.h + 2); g2.stroke();
      gOut.drawImage(comp, 0, 0, W, H);
    },
  };
}
const hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
