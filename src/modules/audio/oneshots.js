// One-shot sounds. Each builder: (ac, out, t, R, o) → duration seconds.
// o = { rng, p (pitch multiplier), dist (thunder 0..1) }.
import {
  gain, filt, chain, noise, bufSrc, osc, perc, env, glide, shaper, mallet, bell, voice,
  grainBuffer, walkCurve, pulseWave, wave, clamp,
} from './synth.js';

function thump(ac, out, t, f0, f1, peak, dec) {
  const o = osc(ac, 'sine', f0, t, dec + 0.05), g = gain(ac, 0);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec);
  chain(o, g, out); perc(g.gain, t, peak, 0.004, dec);
}
function nburst(ac, out, R, rng, t, kind, type, f, Q, peak, a, dec) {
  const n = noise(ac, R, kind, t, a + dec + 0.05, rng), fl = filt(ac, type, f, Q), g = gain(ac, 0);
  chain(n, fl, g, out); perc(g.gain, t, peak, a, dec);
  return fl;
}
function grains(ac, out, t, rng, dur, opts, filters, peak) {
  const b = grainBuffer(ac, dur, rng, opts);
  const s = bufSrc(ac, b, t, dur);
  const g = gain(ac, peak);
  chain(s, ...filters, g, out);
}
const hump = (a, b, c) => (u) => (u < a ? 0 : u < b ? (u - a) / (b - a) : u < c ? 1 - (u - b) / (c - b) * 0.9 : 0.1 * Math.max(0, 1 - (u - c) * 4));
const two = (f1, f2, w = 0.6) => (u) => Math.max(f1(u), f2(u) * w);

export const ONESHOTS = {
  // ------------------------------------------------------------ UI
  'ui-click'(ac, out, t, R, o) {
    const p = o.p;
    nburst(ac, out, R, o.rng, t, 'white', 'bandpass', 3600 * p, 2.2, 0.5, 0.0008, 0.018);
    const s = osc(ac, 'sine', 1500 * p, t, 0.09), g = gain(ac, 0);
    s.frequency.setTargetAtTime(880 * p, t, 0.012);
    chain(s, g, out); perc(g.gain, t, 0.28, 0.0015, 0.05);
    const b = osc(ac, 'triangle', 540 * p, t, 0.08), bg = gain(ac, 0);
    chain(b, filt(ac, 'lowpass', 1600), bg, out); perc(bg.gain, t, 0.22, 0.002, 0.04);
    return 0.12;
  },
  'ui-open'(ac, out, t, R, o) {
    const p = o.p;
    // paper slide whoosh
    const n = noise(ac, R, 'pink', t, 0.35, o.rng), bp = filt(ac, 'bandpass', 700, 1.4), g = gain(ac, 0);
    glide(bp.frequency, t, [[0, 700], [0.2, 3200], [0.3, 2400]]);
    chain(n, bp, g, out); env(g.gain, t, [[0, 0], [0.12, 0.35], [0.3, 0]]);
    mallet(ac, out, t + 0.06, 880 * p, 0.2, 0.35);
    mallet(ac, out, t + 0.14, 1318.5 * p, 0.22, 0.5);
    return 0.7;
  },
  coin(ac, out, t, R, o) {
    const p = o.p;
    bell(ac, out, t, 987.8 * p, 0.22, 0.45, 3.5, 2.5);
    bell(ac, out, t + 0.075, 1318.5 * p, 0.26, 0.9, 3.5, 2.2);
    nburst(ac, out, R, o.rng, t, 'white', 'highpass', 7000, 0.7, 0.12, 0.001, 0.03);
    return 1.1;
  },
  error(ac, out, t, R, o) {
    const p = o.p;
    [[0, 233, 247], [0.16, 196, 208]].forEach(([dt, f, f2]) => {
      const a = osc(ac, 'triangle', f * p, t + dt, 0.3), b = osc(ac, 'square', f2 * p, t + dt, 0.3);
      const bg = gain(ac, 0.18), lp = filt(ac, 'lowpass', 900, 2), g = gain(ac, 0);
      a.connect(lp); chain(b, bg, lp); chain(lp, g, out);
      perc(g.gain, t + dt, 0.32, 0.006, 0.22);
    });
    nburst(ac, out, R, o.rng, t, 'pink', 'bandpass', 500, 1.2, 0.12, 0.002, 0.05);
    return 0.45;
  },

  // ------------------------------------------------------------ footsteps
  'footstep-grass'(ac, out, t, R, o) {
    thump(ac, out, t, 95 * o.p, 55, 0.3, 0.07);
    grains(ac, out, t, o.rng, 0.26, { rate: 1400, decay: 0.0012, envf: two(hump(0, 0.08, 0.45), hump(0.3, 0.42, 0.9)) },
      [filt(ac, 'bandpass', 3200 * o.p, 0.6), filt(ac, 'highpass', 900)], 0.55);
    return 0.3;
  },
  'footstep-gravel'(ac, out, t, R, o) {
    thump(ac, out, t, 85 * o.p, 50, 0.3, 0.06);
    grains(ac, out, t, o.rng, 0.26, { rate: 420, decay: 0.0032, spread: 0.95, envf: two(hump(0, 0.05, 0.4), hump(0.38, 0.45, 0.85), 0.8) },
      [filt(ac, 'bandpass', 2300 * o.p, 0.55), filt(ac, 'lowpass', 7000)], 0.75);
    return 0.3;
  },
  'footstep-asphalt'(ac, out, t, R, o) {
    thump(ac, out, t, 130 * o.p, 70, 0.32, 0.045);
    nburst(ac, out, R, o.rng, t, 'white', 'bandpass', 2300 * o.p, 1.6, 0.45, 0.0006, 0.02);
    nburst(ac, out, R, o.rng, t, 'pink', 'bandpass', 650 * o.p, 1.2, 0.25, 0.001, 0.04);
    grains(ac, out, t + 0.1, o.rng, 0.07, { rate: 2500, decay: 0.0005, envf: hump(0, 0.2, 1) }, [filt(ac, 'highpass', 2600)], 0.15);
    return 0.22;
  },
  'footstep-mud'(ac, out, t, R, o) {
    thump(ac, out, t, 80 * o.p, 45, 0.35, 0.09);
    nburst(ac, out, R, o.rng, t, 'brown', 'lowpass', 320, 0.8, 0.35, 0.004, 0.08);
    // squelch: resonant sweep on noise
    const n = noise(ac, R, 'pink', t, 0.35, o.rng), bp = filt(ac, 'bandpass', 380, 7), g = gain(ac, 0);
    glide(bp.frequency, t, [[0, 380], [0.05, 420], [0.14, 1350], [0.26, 480]], o.p);
    chain(n, bp, g, out); env(g.gain, t, [[0, 0], [0.04, 0.2], [0.14, 0.75], [0.26, 0]]);
    // suction pop
    const s = osc(ac, 'sine', 620 * o.p, t + 0.2, 0.08), sg = gain(ac, 0);
    s.frequency.setValueAtTime(620 * o.p, t + 0.2); s.frequency.exponentialRampToValueAtTime(260 * o.p, t + 0.25);
    chain(s, sg, out); perc(sg.gain, t + 0.2, 0.18, 0.003, 0.04);
    return 0.34;
  },
  'footstep-snow'(ac, out, t, R, o) {
    nburst(ac, out, R, o.rng, t, 'brown', 'lowpass', 220, 0.7, 0.3, 0.02, 0.12);
    grains(ac, out, t, o.rng, 0.3, { rate: 2600, decay: 0.0007, spread: 0.7, envf: (u) => (u < 0.18 ? u / 0.18 : u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.4)) },
      [filt(ac, 'bandpass', 1900 * o.p, 0.5), filt(ac, 'lowpass', 6500)], 0.6);
    return 0.32;
  },

  // ------------------------------------------------------------ farm & world
  door(ac, out, t, R, o) {
    const p = o.p, rng = o.rng;
    // stick-slip creak: slow irregular pulse train through wooden resonances
    const src = osc(ac, 'sawtooth', 60, t, 0.72);
    src.frequency.setValueCurveAtTime(walkCurve(rng, 48, 38 * p, 105 * p, 0.35), t, 0.66);
    const sum = gain(ac, 1);
    for (const [f, q, g] of [[640, 9, 1], [1480, 11, 0.7], [2950, 9, 0.35], [320, 5, 0.4]]) chain(src, filt(ac, 'bandpass', f * p, q), gain(ac, g), sum);
    const e = gain(ac, 0);
    env(e.gain, t, [[0, 0], [0.06, 0.9], [0.3, 0.7], [0.5, 1], [0.66, 0]]);
    chain(sum, e, out);
    // latch + thud
    nburst(ac, out, R, rng, t + 0.72, 'white', 'bandpass', 3100, 2, 0.35, 0.0005, 0.02);
    mallet(ac, out, t + 0.72, 1750 * p, 0.05, 0.08);
    thump(ac, out, t + 0.74, 78, 48, 0.55, 0.22);
    nburst(ac, out, R, rng, t + 0.74, 'brown', 'lowpass', 260, 0.8, 0.5, 0.003, 0.15);
    return 1.05;
  },
  moo(ac, out, t, R, o) {
    const d = 1.6;
    voice(ac, out, t, R, o.rng, {
      dur: d, tilt: 1.35, vib: [5.2, 0.018], jit: 0.02, breath: 0.12,
      f0: [[0, 86], [0.25, 116], [0.8, 124], [1.3, 106], [d, 80]],
      formants: [
        { f: 230, q: 2.2, g: 0.7 },                                              // nasal murmur (the "mm")
        { f: [[0, 280], [0.32, 540], [1.2, 580], [d, 340]], q: 3, g: 1.0 },       // F1 opens "mm-OOO"
        { f: [[0, 760], [0.32, 920], [d, 740]], q: 5, g: 0.45 },
        { f: 2350, q: 8, g: 0.1 },
      ],
      lp: [[0, 480], [0.35, 2600], [1.25, 1900], [d, 450]],
      env: [[0, 0], [0.12, 0.55], [0.35, 1], [1.25, 0.85], [d, 0]],
      trem: [31, 0.12], // rough, creaky bovine phonation
    }, o.p, 0.75);
    return d + 0.1;
  },
  baa(ac, out, t, R, o) {
    const d = 0.95;
    voice(ac, out, t, R, o.rng, {
      dur: d, tilt: 1.0, vib: [22, 0.055], breath: 0.1,
      f0: [[0, 245], [0.08, 300], [0.6, 285], [d, 238]],
      formants: [
        { f: [[0, 340], [0.07, 790], [0.8, 740], [d, 480]], q: 4, g: 1.0 },
        { f: [[0, 1100], [0.07, 1760], [d, 1580]], q: 7, g: 0.6 },
        { f: 2700, q: 9, g: 0.3 },
        { f: 3650, q: 10, g: 0.12 },
      ],
      env: [[0, 0], [0.04, 0.85], [0.12, 1], [0.75, 0.7], [d, 0]],
      trem: [22, 0.42], // the bleat
    }, o.p, 0.7);
    return d + 0.1;
  },
  cluck(ac, out, t, R, o) {
    const rng = o.rng, n = rng.int(3, 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = (400 + rng.float() * 60) * o.p;
      voice(ac, out, tt, R, rng, {
        dur: 0.075, tilt: 0.8, breath: 0.35,
        f0: [[0, f], [0.075, f * 0.78]],
        formants: [{ f: 950, q: 5, g: 1 }, { f: 2000, q: 6, g: 0.55 }, { f: 3150, q: 8, g: 0.2 }],
        env: [[0, 0], [0.006, 1], [0.03, 0.6], [0.075, 0]],
      }, 1, 0.6);
      tt += 0.15 + rng.float() * 0.07;
    }
    if (rng.chance(0.4)) { // "ba-GAWK"
      voice(ac, out, tt + 0.05, R, rng, {
        dur: 0.3, tilt: 0.7, breath: 0.3, trem: [58, 0.35],
        f0: [[0, 640], [0.05, 790], [0.3, 610]],
        formants: [{ f: 1150, q: 4, g: 1 }, { f: 2300, q: 6, g: 0.6 }, { f: 3350, q: 8, g: 0.25 }],
        env: [[0, 0], [0.02, 1], [0.2, 0.8], [0.3, 0]],
      }, o.p, 0.55);
      tt += 0.4;
    }
    return tt - t + 0.1;
  },
  bark(ac, out, t, R, o) {
    const rng = o.rng;
    [[0, 1], [0.29, 0.94]].forEach(([dt, k]) => {
      const p = o.p * k;
      voice(ac, out, t + dt, R, rng, {
        dur: 0.18, tilt: 0.85, breath: 0.55,
        f0: [[0, 540], [0.03, 610], [0.18, 370]],
        formants: [
          { f: [[0, 500], [0.03, 820], [0.18, 580]], q: 3, g: 1 },
          { f: 1500, q: 5, g: 0.6 }, { f: 2750, q: 6, g: 0.3 },
        ],
        env: [[0, 0], [0.012, 1], [0.06, 0.75], [0.18, 0]],
      }, p, 0.85);
      thump(ac, out, t + dt, 150 * p, 85, 0.3, 0.06);
    });
    return 0.55;
  },
  'plough-clod'(ac, out, t, R, o) {
    nburst(ac, out, R, o.rng, t, 'brown', 'lowpass', 230, 0.9, 0.7, 0.004, 0.14);
    thump(ac, out, t, 60 * o.p, 38, 0.5, 0.16);
    grains(ac, out, t + 0.02, o.rng, 0.4, { rate: 70, decay: 0.004, spread: 0.9, envf: (u) => Math.max(0.05, 1 - u) },
      [filt(ac, 'bandpass', 1500 * o.p, 0.8)], 0.45);
    nburst(ac, out, R, o.rng, t + 0.13, 'brown', 'lowpass', 300, 0.9, 0.3, 0.004, 0.08);
    return 0.5;
  },
  'harvest-thresh'(ac, out, t, R, o) {
    const d = 1.5, p = o.p;
    const drum = wave(ac, R, 'thresh-drum', 64, (re, im) => { for (let k = 1; k <= 64; k++) im[k] = (k % 8 === 0 ? 1 : 0.12) / Math.pow(k, 0.9); });
    const hum = osc(ac, drum, 14 * p, t, d), hl = filt(ac, 'lowpass', 1400), hg = gain(ac, 0);
    chain(hum, hl, hg, out); env(hg.gain, t, [[0, 0], [0.15, 0.35], [d - 0.3, 0.35], [d, 0]]);
    // beater swish, amplitude-modulated at bar rate
    const n = noise(ac, R, 'pink', t, d, o.rng), bp = filt(ac, 'bandpass', 1900, 0.9), am = gain(ac, 0);
    const lfo = osc(ac, pulseWave(ac, R, 0.3, 16), 7 * p, t, d), lg = gain(ac, 0.35);
    chain(lfo, lg, am.gain);
    env(am.gain, t, [[0, 0], [0.15, 0.3], [d - 0.3, 0.3], [d, 0]]);
    chain(n, bp, am, out);
    grains(ac, out, t, o.rng, d, { rate: 500, decay: 0.002, envf: (u) => (u < 0.1 ? u * 10 : u > 0.8 ? (1 - u) * 5 : 1) },
      [filt(ac, 'highpass', 2600)], 0.3);
    return d + 0.05;
  },
  horn(ac, out, t, R, o) {
    const d = 0.55, p = o.p, sum = gain(ac, 0.5);
    for (const f of [392, 494]) {
      const s = osc(ac, 'sawtooth', f * p * 0.94, t, d + 0.05);
      s.frequency.setTargetAtTime(f * p, t, 0.015);
      s.connect(sum);
    }
    const g = gain(ac, 0);
    chain(sum, shaper(ac, 2.5), filt(ac, 'peaking', 2600, 1.5, 8), filt(ac, 'lowpass', 5200), g, out);
    env(g.gain, t, [[0, 0], [0.02, 0.32], [d - 0.08, 0.3], [d, 0]]);
    return d + 0.05;
  },
  splash(ac, out, t, R, o) {
    const rng = o.rng, p = o.p;
    const bp = nburst(ac, out, R, rng, t, 'white', 'bandpass', 1400 * p, 1, 0.75, 0.002, 0.12);
    bp.frequency.setTargetAtTime(480 * p, t, 0.05);
    nburst(ac, out, R, rng, t + 0.01, 'white', 'highpass', 3000, 0.7, 0.3, 0.01, 0.45);
    thump(ac, out, t, 230 * p, 110, 0.35, 0.12);
    for (let i = 0; i < 9; i++) {
      const bt = t + 0.04 + rng.float() * 0.55, f = (380 + rng.float() * 1100) * p, dd = 0.03 + rng.float() * 0.05;
      const b = osc(ac, 'sine', f, bt, dd * 2 + 0.02), bg = gain(ac, 0);
      b.frequency.setValueAtTime(f, bt); b.frequency.exponentialRampToValueAtTime(f * 1.35, bt + dd * 1.5);
      chain(b, bg, out); perc(bg.gain, bt, 0.1 + rng.float() * 0.08, 0.002, dd * 1.5);
    }
    return 0.75;
  },
  thunder(ac, out, t, R, o) {
    const rng = o.rng, dist = clamp(o.dist == null ? 0.35 : o.dist, 0, 1), d = 6.5;
    const t0 = t + dist * 0.5;
    if (dist < 0.75) {
      const k = 1 - dist;
      nburst(ac, out, R, rng, t0, 'white', 'highpass', 1400, 0.7, 0.9 * k, 0.002, 0.3);
      grains(ac, out, t0, rng, 0.9, { rate: 110, decay: 0.006, spread: 0.9, envf: (u) => Math.max(0.05, 1 - u) },
        [filt(ac, 'bandpass', 2200, 0.7)], 0.55 * k);
    }
    // rolling rumble: an envelope made of several decaying claps
    const N = 256, curve = new Float32Array(N), humps = rng.int(4, 7);
    for (let h = 0; h < humps; h++) {
      const c = (h === 0 ? 0 : rng.float() * 0.6) * N, a = h === 0 ? 1 : 0.35 + rng.float() * 0.6, w = (0.04 + rng.float() * 0.12) * N;
      for (let i = 0; i < N; i++) if (i >= c) curve[i] += a * Math.exp(-(i - c) / w) * Math.min(1, (i - c) / 3 + 0.2);
    }
    let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, curve[i]);
    for (let i = 0; i < N; i++) curve[i] = (curve[i] / m) * (i === N - 1 ? 0 : 1);
    const rb = noise(ac, R, 'brown', t0, d, rng), rl = filt(ac, 'lowpass', 320 - 180 * dist, 0.9), rg = gain(ac, 0);
    chain(rb, rl, rg, out);
    rg.gain.setValueCurveAtTime(curve.map((v) => v * 0.95), t0 + 0.02, d - 0.1);
    const mb = noise(ac, R, 'pink', t0, d, rng), ml = filt(ac, 'lowpass', 900 - 500 * dist), mg = gain(ac, 0);
    chain(mb, ml, mg, out);
    mg.gain.setValueCurveAtTime(curve.map((v) => v * 0.35 * (1 - dist * 0.8)), t0 + 0.02, d - 0.1);
    return d + dist * 0.5;
  },
};

export const ONESHOT_IDS = Object.keys(ONESHOTS);
