// Procedural synthesis shared by the realtime AudioContext and OfflineAudioContext (sound board).
// Every builder takes a BaseAudioContext `ac`, so the sound board shows exactly what the game plays.
// No samples: noise buffers, grains and plucked strings are generated from seeded rng streams.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- resources (per context)
const RES = new WeakMap();

/** noise buffers, wave tables and generated textures for one context. mk(name) → Rng */
export function resources(ac, mk) {
  let R = RES.get(ac);
  if (R) return R;
  R = { ac, mk, waves: new Map(), bufs: new Map(), noise: {} };
  const sr = ac.sampleRate;
  const len = Math.floor(sr * 3);
  const rng = mk('noise');
  const white = ac.createBuffer(1, len, sr), pink = ac.createBuffer(1, len, sr), brown = ac.createBuffer(1, len, sr);
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0, pmax = 0, bmax = 0;
  for (let i = 0; i < len; i++) {
    const x = rng.float() * 2 - 1;
    w[i] = x * 0.9;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02;
    b[i] = br;
    pmax = Math.max(pmax, Math.abs(p[i])); bmax = Math.max(bmax, Math.abs(br));
  }
  // crossfade the ends so the loop point is seamless
  const xf = Math.floor(sr * 0.05);
  for (const d of [w, p, b]) for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
  for (let i = 0; i < len; i++) { p[i] *= 0.9 / pmax; b[i] *= 0.9 / bmax; }
  R.noise = { white, pink, brown };
  return R;
}

/** cached generated buffer */
export function cachedBuffer(R, key, dur, gen, sr) {
  let b = R.bufs.get(key);
  if (b) return b;
  const rate = sr || R.ac.sampleRate;
  b = R.ac.createBuffer(1, Math.max(2, Math.floor(dur * rate)), rate);
  gen(b.getChannelData(0), rate, R.mk('buf:' + key));
  R.bufs.set(key, b);
  return b;
}

export function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return d;
}

/** smooth random control signal 0..1 (gusts, flow) at 8 kHz, loopable */
export function gustBuffer(R, key, dur, scales) {
  return cachedBuffer(R, 'gust:' + key, dur, (d, sr, rng) => {
    const n = d.length;
    for (const [period, amp] of scales) {
      const pts = Math.max(2, Math.round(dur / period));
      const v = []; for (let i = 0; i < pts; i++) v.push(rng.float());
      for (let i = 0; i < n; i++) {
        const f = (i / n) * pts, k = Math.floor(f), t = f - k;
        const a = v[k % pts], c = v[(k + 1) % pts];
        const s = (1 - Math.cos(t * Math.PI)) / 2;
        d[i] += (a + (c - a) * s) * amp;
      }
    }
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    for (let i = 0; i < n; i++) d[i] = Math.pow((d[i] - lo) / (hi - lo || 1), 1.6);
  }, 8000);
}

// ---------------------------------------------------------------- node helpers
export function gain(ac, v = 1) { const g = ac.createGain(); g.gain.value = v; return g; }
export function filt(ac, type, f, Q = 0.707, db = 0) {
  const n = ac.createBiquadFilter();
  n.type = type; n.frequency.value = Math.min(f, ac.sampleRate * 0.49); n.Q.value = Q; n.gain.value = db;
  return n;
}
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
export function noise(ac, R, kind, t, dur, rng, rate = 1) {
  const s = ac.createBufferSource();
  s.buffer = R.noise[kind]; s.loop = true; s.playbackRate.value = rate;
  s.start(t, rng.float() * (s.buffer.duration - 0.2));
  if (dur != null) s.stop(t + dur);
  return s;
}
export function bufSrc(ac, buf, t, dur, { loop = false, rate = 1, offset = 0 } = {}) {
  const s = ac.createBufferSource();
  s.buffer = buf; s.loop = loop; s.playbackRate.value = rate;
  s.start(t, Math.min(offset, buf.duration - 0.01));
  if (dur != null) s.stop(t + dur);
  return s;
}
export function osc(ac, type, f, t, dur) {
  const o = ac.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.value = f;
  o.start(t);
  if (dur != null) o.stop(t + dur);
  return o;
}
/** attack then exponential decay (d = time to about -40 dB) */
export function perc(param, t, peak, a, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, d / 4.6);
}
/** piecewise-linear envelope; pts = [[dt, value], ...] relative to t */
export function env(param, t, pts, scale = 1) {
  param.setValueAtTime(pts[0][1] * scale, t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * scale, t + pts[i][0]);
}
/** piecewise-exponential glide for frequencies */
export function glide(param, t, pts, scale = 1) {
  param.setValueAtTime(pts[0][1] * scale, t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(Math.max(1, pts[i][1] * scale), t + pts[i][0]);
}
export function shaperCurve(drive = 1.5, n = 1024) {
  const c = new Float32Array(n), k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  return c;
}
export function shaper(ac, drive) { const s = ac.createWaveShaper(); s.curve = shaperCurve(drive); s.oversample = '2x'; return s; }

/** cached PeriodicWave; fn(real, imag) fills harmonics */
export function wave(ac, R, key, n, fn) {
  let w = R.waves.get(key);
  if (w) return w;
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  fn(re, im);
  w = ac.createPeriodicWave(re, im);
  R.waves.set(key, w);
  return w;
}
/** narrow pulse train (for modulating noise with firing pulses) */
export function pulseWave(ac, R, width = 0.15, n = 32) {
  return wave(ac, R, 'pulse:' + width + ':' + n, n, (re) => { for (let k = 1; k <= n; k++) re[k] = Math.sin(Math.PI * k * width) / (Math.PI * k); });
}
/** glottal-ish source: harmonic amplitudes 1/n^tilt */
export function glottalWave(ac, R, tilt = 1.2, n = 48) {
  return wave(ac, R, 'glot:' + tilt, n, (re, im) => { for (let k = 1; k <= n; k++) im[k] = 1 / Math.pow(k, tilt); });
}

/** granular noise texture: Poisson grains of decaying noise. envf(u 0..1) shapes density+amplitude */
export function grainBuffer(ac, dur, rng, { rate = 300, decay = 0.002, spread = 0.8, envf = () => 1, tone = 0, toneF = 2000 } = {}) {
  const sr = ac.sampleRate, n = Math.max(2, Math.floor(dur * sr));
  const b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
  let t = 0;
  while (t < dur) {
    const u = t / dur, e = envf(u);
    t += -Math.log(1 - rng.float() * 0.999) / (rate * Math.max(0.05, e));
    if (t >= dur) break;
    const amp = e * (1 - spread + spread * Math.pow(rng.float(), 2));
    const tau = decay * (0.5 + rng.float());
    const i0 = Math.floor(t * sr), L = Math.min(n - i0, Math.floor(tau * 6 * sr));
    const f = toneF * (0.7 + rng.float() * 0.6), sgn = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < L; i++) {
      const tt = i / sr, a = amp * Math.exp(-tt / tau);
      d[i0 + i] += a * ((1 - tone) * (rng.float() * 2 - 1) + tone * sgn * Math.sin(TAU * f * tt));
    }
  }
  normalize(d, 0.9);
  return b;
}

/** random-walk curve for setValueCurveAtTime */
export function walkCurve(rng, n, lo, hi, step = 0.25) {
  const c = new Float32Array(n);
  let v = rng.float();
  for (let i = 0; i < n; i++) { v = clamp(v + (rng.float() - 0.5) * step, 0, 1); c[i] = lo + (hi - lo) * v; }
  return c;
}

// ---------------------------------------------------------------- instruments
/** mallet / marimba-ish note */
export function mallet(ac, out, t, f, peak = 0.3, dec = 0.35) {
  for (const [m, a, dd] of [[1, 1, 1], [3.93, 0.28, 0.3], [9.2, 0.07, 0.12]]) {
    const o = osc(ac, 'sine', f * m, t, dec * dd + 0.05), g = gain(ac, 0);
    chain(o, g, out); perc(g.gain, t, peak * a, 0.003, dec * dd);
  }
}
/** FM bell (coins, chimes) */
export function bell(ac, out, t, f, peak = 0.3, dec = 0.7, ratio = 3.5, index = 3) {
  const c = osc(ac, 'sine', f, t, dec + 0.1), m = osc(ac, 'sine', f * ratio, t, dec + 0.1);
  const mi = gain(ac, 0), g = gain(ac, 0);
  m.connect(mi); mi.connect(c.frequency);
  mi.gain.setValueAtTime(f * ratio * index, t);
  mi.gain.setTargetAtTime(f * ratio * 0.15, t, dec * 0.12);
  chain(c, g, out); perc(g.gain, t, peak, 0.002, dec);
  const h = osc(ac, 'sine', f * 2.01, t, dec * 0.5 + 0.05), hg = gain(ac, 0);
  chain(h, hg, out); perc(hg.gain, t, peak * 0.25, 0.002, dec * 0.4);
}

/**
 * Formant voice (animals). spec:
 *  dur, f0: [[dt,f]...], formants: [{ f: [[dt,f]...] | number, q, g }], vib: [rateHz, depthFrac],
 *  trem: [rateHz, depth], breath (noise mix), tilt (source darkness), env: [[dt,v]...], lp: [[dt,f]...]
 */
export function voice(ac, out, t, R, rng, s, p = 1, amp = 1) {
  const dur = s.dur;
  const src = osc(ac, glottalWave(ac, R, s.tilt || 1.1), s.f0[0][1] * p, t, dur + 0.05);
  glide(src.frequency, t, s.f0, p);
  if (s.vib) {
    const l = osc(ac, 'sine', s.vib[0], t, dur + 0.05), lg = gain(ac, s.f0[0][1] * p * s.vib[1]);
    chain(l, lg, src.frequency);
  }
  if (s.jit) { // slow irregular pitch wander
    const j = osc(ac, 'sine', 3.1 + rng.float() * 2, t, dur + 0.05), jg = gain(ac, s.f0[0][1] * p * s.jit);
    chain(j, jg, src.frequency);
  }
  const bus = gain(ac, 1);
  src.connect(bus);
  if (s.breath) {
    const nz = noise(ac, R, 'white', t, dur + 0.05, rng), ng = gain(ac, s.breath);
    chain(nz, ng, bus);
  }
  const sum = gain(ac, 1);
  for (const F of s.formants) {
    const bp = filt(ac, 'bandpass', typeof F.f === 'number' ? F.f : F.f[0][1], F.q);
    if (typeof F.f !== 'number') glide(bp.frequency, t, F.f);
    const g = gain(ac, F.g);
    chain(bus, bp, g, sum);
  }
  let last = sum;
  if (s.lp) { const lp = filt(ac, 'lowpass', s.lp[0][1], 0.8); glide(lp.frequency, t, s.lp); last = chain(sum, lp); }
  const e = gain(ac, 0);
  env(e.gain, t, s.env, amp);
  if (s.trem) {
    const tr = osc(ac, 'sine', s.trem[0], t, dur + 0.05), tg = gain(ac, s.trem[1] * amp);
    chain(tr, tg, e.gain);
  }
  chain(last, e, out);
}

/** Karplus-Strong plucked string buffer */
export function pluckBuffer(R, f) {
  const key = 'ks:' + Math.round(f * 10);
  return cachedBuffer(R, key, 2.6, (d, sr, rng) => {
    const P = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(P);
    for (let i = 0; i < P; i++) line[i] = (rng.float() * 2 - 1) * (1 - i / P * 0.5);
    // soften the excitation (finger, not pick)
    for (let k = 0; k < 2; k++) for (let i = 1; i < P; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
    let idx = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      const cur = line[idx];
      const nxt = 0.4985 * (cur + prev) + 0.0; // slight damping
      prev = cur;
      line[idx] = nxt;
      d[i] = cur;
      idx = (idx + 1) % P;
    }
    // gentle body: fade tail
    for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, (d.length - i) / (sr * 0.3));
    normalize(d, 0.8);
  });
}
