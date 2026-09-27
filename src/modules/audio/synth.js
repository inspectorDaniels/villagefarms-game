// Procedural synthesis shared by the realtime AudioContext and OfflineAudioContext (sound board).
// Every builder takes a BaseAudioContext `ac`, so the sound board shows exactly what the game plays.
// No samples: noise buffers, grains and plucked strings are generated from seeded rng streams.
//
// Performance model: anything that loops over samples in JS is a *recipe* (a generator that yields
// work units). In the realtime context recipes are baked a few thousand samples per frame by bake()
// (called from frame()); play()/loop() only ever create nodes and read ready buffers. Offline
// contexts (the sound board) run in sync mode and bake on demand.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- recipes & baking
const RES = new WeakMap();
const RECIPES = new Map();

/** register a buffer recipe. gen(data, sampleRate, rng) is a generator yielding work units (≈ samples) */
export function recipe(key, dur, gen, sr) { if (!RECIPES.has(key)) RECIPES.set(key, { dur, gen, sr }); return key; }
export function recipeKeys(prefix = '') { return [...RECIPES.keys()].filter((k) => k.startsWith(prefix)); }

/** per-context resources. mk(name) → Rng. opts.sync = bake on demand (offline rendering) */
export function resources(ac, mk, opts = {}) {
  let R = RES.get(ac);
  if (R) return R;
  if (opts.share) { // offline "print" context: reuse the realtime context's baked buffers (AudioBuffers are shareable)
    R = { ac, mk, waves: new Map(), bufs: opts.share.bufs, jobs: [], pending: new Map(), sync: false, white: opts.share.white };
    RES.set(ac, R);
    return R;
  }
  R = { ac, mk, waves: new Map(), bufs: new Map(), jobs: [], pending: new Map(), sync: !!opts.sync, white: null };
  // white noise is needed by nearly everything and cheap (one rng call per sample) → synchronous, 1 s
  const sr = ac.sampleRate, len = Math.floor(sr), rng = mk('noise:white');
  const white = ac.createBuffer(1, len, sr), w = white.getChannelData(0);
  for (let i = 0; i < len; i++) w[i] = (rng.float() * 2 - 1) * 0.9;
  const xf = Math.floor(sr * 0.03);
  for (let i = 0; i < xf; i++) { const k = i / xf; w[i] = w[i] * k + w[len - xf + i] * (1 - k); }
  R.white = white;
  RES.set(ac, R);
  return R;
}
function startJob(R, key) {
  const p = R.pending.get(key);
  if (p) return p;
  const rc = RECIPES.get(key);
  if (!rc) throw new Error('no recipe ' + key);
  const job = { key, rc, buf: null, it: null }; // allocated lazily when baking starts
  R.pending.set(key, job); R.jobs.push(job);
  return job;
}
function begin(R, job) {
  const rate = job.rc.sr || R.ac.sampleRate;
  job.buf = R.ac.createBuffer(1, Math.max(2, Math.floor(job.rc.dur * rate)), rate);
  job.it = job.rc.gen(job.buf.getChannelData(0), rate, R.mk('buf:' + job.key));
}
function finish(R, job) {
  R.pending.delete(job.key);
  const i = R.jobs.indexOf(job); if (i >= 0) R.jobs.splice(i, 1);
  R.bufs.set(job.key, job.buf);
}
/** baked buffer, or null (queued for baking). Sync contexts bake immediately. */
export function ready(R, key) {
  const b = R.bufs.get(key);
  if (b) return b;
  if (R.sync) return buffer(R, key);
  if (RECIPES.has(key)) startJob(R, key);
  return null;
}
/** queue without returning */
export function want(R, keys) { for (const k of keys) if (!R.bufs.has(k) && RECIPES.has(k)) startJob(R, k); }
export function allReady(R, keys) { let ok = true; for (const k of keys) if (!ready(R, k)) ok = false; return ok; }
/** buffer, baking synchronously if needed (offline only) */
export function buffer(R, key) {
  const b = R.bufs.get(key);
  if (b) return b;
  const job = startJob(R, key);
  if (!job.it) begin(R, job);
  while (!job.it.next().done) { /* bake */ }
  finish(R, job);
  return job.buf;
}
/** run queued jobs until `budget` work units are spent. Returns number of jobs left. */
export function bake(R, budget) {
  let used = 0;
  while (R.jobs.length && used < budget) {
    const job = R.jobs[0];
    if (!job.it) { begin(R, job); used += 2048; continue; }
    const r = job.it.next();
    if (r.done) finish(R, job); else used += r.value || 2048;
  }
  return R.jobs.length;
}

export function* normalizeGen(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; if ((i & 16383) === 16383) yield 4096; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) { d[i] *= k; if ((i & 16383) === 16383) yield 4096; } }
}

// pink & brown noise, 3 s loops
function* colouredNoise(d, sr, rng, kind) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  const len = d.length;
  for (let i = 0; i < len; i++) {
    const x = rng.float() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    } else { br = (br + 0.02 * x) / 1.02; d[i] = br; }
    if ((i & 2047) === 2047) yield 2048;
  }
  if (kind === 'brown') { let m = 0; for (let i = 0; i < len; i++) m += d[i]; m /= len; for (let i = 0; i < len; i++) d[i] -= m; yield 8192; }
  const xf = Math.floor(sr * 0.05);
  for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
  yield* normalizeGen(d, 0.9);
}
recipe('noise:pink', 3, function* (d, sr, rng) { yield* colouredNoise(d, sr, rng, 'pink'); });
recipe('noise:brown', 3, function* (d, sr, rng) { yield* colouredNoise(d, sr, rng, 'brown'); });
/** noise buffer by kind; pink/brown fall back to white until baked */
export function noiseBuf(R, kind) { return kind === 'white' ? R.white : (ready(R, 'noise:' + kind) || R.white); }

/** smooth random control signal 0..1 (gusts, flow) at 8 kHz, loopable. Returns the recipe key. */
export function gustRecipe(name, dur, scales) {
  return recipe('gust:' + name, dur, function* (d, sr, rng) {
    const n = d.length;
    for (const [period, amp] of scales) {
      const pts = Math.max(2, Math.round(dur / period));
      const v = []; for (let i = 0; i < pts; i++) v.push(rng.float());
      for (let i = 0; i < n; i++) {
        const f = (i / n) * pts, k = Math.floor(f), t = f - k;
        const a = v[k % pts], c = v[(k + 1) % pts];
        d[i] += (a + (c - a) * (1 - Math.cos(t * Math.PI)) / 2) * amp;
        if ((i & 4095) === 4095) yield 1024; // cheap per-sample work → weighted low
      }
    }
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    for (let i = 0; i < n; i++) { d[i] = Math.pow((d[i] - lo) / (hi - lo || 1), 1.6); if ((i & 4095) === 4095) yield 1024; }
  }, 8000);
}

/**
 * granular noise texture recipe: Poisson grains of decaying noise; envf(u 0..1) shapes density+amplitude.
 * Baked at 32 kHz with a multiplicative decay and a noise table (fast). Returns the recipe key.
 */
const NT = (() => { const t = new Float32Array(65536); let s = 0x9e3779b9 >>> 0; for (let i = 0; i < t.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; t[i] = (s / 4294967296) * 2 - 1; } return t; })();
export function grainRecipe(key, dur, { rate = 300, decay = 0.002, spread = 0.8, envf = () => 1 } = {}) {
  return recipe(key, dur, function* (d, sr, rng) {
    const n = d.length;
    let t = 0, work = 0, np = Math.floor(rng.float() * 65536);
    while (t < dur) {
      const e = envf(t / dur);
      t += -Math.log(1 - rng.float() * 0.999) / (rate * Math.max(0.05, e));
      if (t >= dur) break;
      let a = e * (1 - spread + spread * Math.pow(rng.float(), 2));
      const tau = decay * (0.5 + rng.float());
      const i0 = Math.floor(t * sr), L = Math.min(n - i0, Math.floor(tau * 6 * sr)), k = Math.exp(-1 / (tau * sr));
      for (let i = 0; i < L; i++) { d[i0 + i] += a * NT[(np + i) & 65535]; a *= k; }
      np = (np + L * 7 + 101) & 65535;
      work += L;
      if (work > 4096) { yield work; work = 0; }
    }
    yield* normalizeGen(d, 0.9);
  }, 32000);
}

/** Karplus-Strong plucked string recipe key for frequency f */
export function pluckRecipe(f) {
  const key = 'ks:' + Math.round(f * 10);
  return recipe(key, 2.6, function* (d, sr, rng) {
    const P = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(P);
    for (let i = 0; i < P; i++) line[i] = (rng.float() * 2 - 1) * (1 - i / P * 0.5);
    for (let k = 0; k < 2; k++) for (let i = 1; i < P; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
    let idx = 0, prev = 0;
    const n = d.length, tail = sr * 0.3;
    for (let i = 0; i < n; i++) {
      const cur = line[idx];
      line[idx] = 0.4985 * (cur + prev);
      prev = cur;
      d[i] = cur * Math.min(1, (n - i) / tail);
      if (++idx === P) idx = 0;
      if ((i & 2047) === 2047) yield 2048;
    }
    yield* normalizeGen(d, 0.8);
  }, 24000);
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
  s.buffer = noiseBuf(R, kind); s.loop = true; s.playbackRate.value = rate;
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
  o.frequency.value = Math.min(f, ac.sampleRate * 0.45);
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
const SHAPERS = new Map();
export function shaperCurve(drive = 1.5, n = 1024) {
  const key = drive + ':' + n;
  if (SHAPERS.has(key)) return SHAPERS.get(key);
  const c = new Float32Array(n), k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  SHAPERS.set(key, c);
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
export function pulseWave(ac, R, width = 0.15, n = 32) {
  return wave(ac, R, 'pulse:' + width + ':' + n, n, (re) => { for (let k = 1; k <= n; k++) re[k] = Math.sin(Math.PI * k * width) / (Math.PI * k); });
}
export function glottalWave(ac, R, tilt = 1.2, n = 48) {
  return wave(ac, R, 'glot:' + tilt, n, (re, im) => { for (let k = 1; k <= n; k++) im[k] = 1 / Math.pow(k, tilt); });
}

/** random-walk curve for setValueCurveAtTime */
export function walkCurve(rng, n, lo, hi, step = 0.25) {
  const c = new Float32Array(n);
  let v = rng.float();
  for (let i = 0; i < n; i++) { v = clamp(v + (rng.float() - 0.5) * step, 0, 1); c[i] = lo + (hi - lo) * v; }
  return c;
}

// ---------------------------------------------------------------- instruments
export function mallet(ac, out, t, f, peak = 0.3, dec = 0.35) {
  for (const [m, a, dd] of [[1, 1, 1], [3.93, 0.28, 0.3], [9.2, 0.07, 0.12]]) {
    const o = osc(ac, 'sine', f * m, t, dec * dd + 0.05), g = gain(ac, 0);
    chain(o, g, out); perc(g.gain, t, peak * a, 0.003, dec * dd);
  }
}
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
 *  jit: cents of random-walk pitch jitter, sub: period-doubling subharmonic level (roughness),
 *  trem: [rateHz, depth], breath (noise mix), tilt (source darkness), env: [[dt,v]...], lp: [[dt,f]...]
 */
export function voice(ac, out, t, R, rng, s, p = 1, amp = 1) {
  const dur = s.dur;
  const bus = gain(ac, 1);
  const glot = glottalWave(ac, R, s.tilt || 1.1);
  const srcs = [[1, 1]];
  if (s.sub) srcs.push([0.5, s.sub]);
  const jc = s.jit ? walkCurve(rng, 24, -s.jit, s.jit, 0.45) : null;
  for (const [mul, lvl] of srcs) {
    const src = osc(ac, glot, s.f0[0][1] * p * mul, t, dur + 0.05);
    glide(src.frequency, t, s.f0, p * mul);
    if (jc) src.detune.setValueCurveAtTime(jc, t, dur);
    if (s.vib) {
      const l = osc(ac, 'sine', s.vib[0], t, dur + 0.05), lg = gain(ac, s.f0[0][1] * p * mul * s.vib[1]);
      chain(l, lg, src.frequency);
    }
    if (lvl === 1) src.connect(bus); else chain(src, gain(ac, lvl), bus);
  }
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

/** move the jobs for these keys to the front of the bake queue (a loop is waiting for them) */
export function prioritize(R, keys) {
  want(R, keys);
  const front = [], rest = [];
  for (const j of R.jobs) (keys.includes(j.key) ? front : rest).push(j);
  if (front.length) R.jobs = front.concat(rest);
}
