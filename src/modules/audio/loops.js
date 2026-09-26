// Continuous sounds. Builder: (ac, out, R, o) → { set(name, v, t), tick?(t0, t1), stop(t) }
// o = { rng, t0, params }. tick() is used by schedulers (birds/owl/music) to place events in [t0, t1).
import {
  gain, filt, chain, noise, bufSrc, osc, perc, env, glide, shaper, wave, pulseWave, cachedBuffer, gustBuffer,
  normalize, clamp, TAU, voice, pluckBuffer,
} from './synth.js';

function stopAll(nodes, t) { for (const n of nodes) { try { n.stop(t); } catch (e) { /* already stopped */ } } }
const tgt = (param, v, t, tau = 0.08) => param.setTargetAtTime(v, t, tau);

// ============================================================== engines
// Harmonic model: one PeriodicWave whose fundamental is the 4-stroke CYCLE frequency (rpm/120).
// Harmonics that are multiples of the cylinder count are the firing orders (strong), half orders are
// crank-rotation orders (medium), the rest come from cylinder-to-cylinder irregularity (weak, seeded).
export const ENGINES = {
  tractor: {
    cyl: 4, idle: 850, max: 2300, inertia: 0.28, irregular: 0.3, soft: 2.3, hard: 1.25, drive: 2.2,
    res: [[95, 6, 2.2], [235, 4, 2], [540, 3, 1.4], [1250, 2, 1.2]], lp: [520, 1300, 2600],
    clatter: 0.5, clatterF: 2300, intake: 0.18, turbo: 0.9, gain: 0.5, whine: 9.3,
  },
  car: {
    cyl: 4, idle: 800, max: 6200, inertia: 0.12, irregular: 0.09, soft: 2.6, hard: 1.6, drive: 1.4,
    res: [[115, 5, 1.6], [380, 3, 2.2], [1400, -3, 1]], lp: [700, 2600, 1800],
    clatter: 0.05, clatterF: 3500, intake: 0.22, turbo: 0, gain: 0.42, tyre: 0.2,
  },
  combine: {
    cyl: 6, idle: 900, max: 2200, inertia: 0.35, irregular: 0.2, soft: 2.1, hard: 1.2, drive: 2,
    res: [[80, 6, 2], [200, 4, 1.8], [470, 3, 1.4], [1100, 2, 1.2]], lp: [480, 1100, 2300],
    clatter: 0.4, clatterF: 2000, intake: 0.2, turbo: 0.8, gain: 0.34, combine: true,
  },
};

function engineWaves(ac, R, kind, C, rng) {
  const N = kind === 'car' ? 110 : 150;
  const w = [], ph = [];
  for (let n = 1; n <= N; n++) {
    let a;
    if (n % C.cyl === 0) a = 1;
    else if (n % (C.cyl / 2) === 0) a = 0.32;
    else a = C.irregular * (0.35 + 0.65 * rng.float());
    w[n] = a; ph[n] = rng.float() * TAU;
  }
  const mk = (roll) => wave(ac, R, `eng:${kind}:${roll}`, N, (re, im) => {
    for (let n = 1; n <= N; n++) {
      const e = 1 / (1 + Math.pow(n / (C.cyl * 1.5), roll));
      re[n] = w[n] * e * Math.cos(ph[n]); im[n] = w[n] * e * Math.sin(ph[n]);
    }
  });
  return [mk(C.soft), mk(C.hard)];
}

function engineLoop(kind) {
  return (ac, out, R, o) => {
    const C = ENGINES[kind], rng = o.rng, t0 = o.t0, nodes = [];
    const master = gain(ac, 0); master.connect(out);
    tgt(master.gain, 1, t0, 0.15);
    const level = gain(ac, C.gain * 0.5); level.connect(master);
    const cyc0 = C.idle / 120;
    const rpmSrc = ac.createConstantSource(); rpmSrc.offset.value = cyc0; rpmSrc.start(t0); nodes.push(rpmSrc);
    const hunt = osc(ac, 'sine', 0.8 + rng.float() * 0.4, t0), huntG = gain(ac, cyc0 * 0.012); nodes.push(hunt);
    chain(hunt, huntG, rpmSrc.offset);

    const [softW, hardW] = engineWaves(ac, R, kind, C, rng);
    const oS = osc(ac, softW, 0, t0), oH = osc(ac, hardW, 0, t0); nodes.push(oS, oH);
    rpmSrc.connect(oS.frequency); rpmSrc.connect(oH.frequency);
    const gS = gain(ac, 1), gH = gain(ac, 0), drive = gain(ac, 1), pre = gain(ac, 1);
    oS.connect(gS); oH.connect(gH); gS.connect(pre); gH.connect(pre);
    // crank rotation sub-harmonic (rumble)
    const crank = osc(ac, 'sine', 0, t0), cg = gain(ac, 0.18), cmul = gain(ac, 2); nodes.push(crank);
    chain(rpmSrc, cmul, crank.frequency); chain(crank, cg, pre);
    let node = chain(pre, drive, shaper(ac, 1.6));
    for (const [f, db, q] of C.res) node = chain(node, filt(ac, 'peaking', f, q, db));
    const lp = filt(ac, 'lowpass', C.lp[0], 0.9);
    chain(node, lp, level);

    // combustion clatter: noise gated by a firing-rate pulse train
    const pulse = osc(ac, pulseWave(ac, R, 0.14, 28), 0, t0), pmul = gain(ac, C.cyl); nodes.push(pulse);
    chain(rpmSrc, pmul, pulse.frequency);
    const cn = noise(ac, R, 'white', t0, null, rng); nodes.push(cn);
    const clat = gain(ac, 0), pdepth = gain(ac, 0);
    chain(pulse, pdepth, clat.gain);
    chain(cn, filt(ac, 'bandpass', C.clatterF, 0.8), filt(ac, 'highpass', 800), clat, level);
    // intake / air
    const inN = noise(ac, R, 'pink', t0, null, rng); nodes.push(inN);
    const inG = gain(ac, 0); chain(inN, filt(ac, 'bandpass', 300, 0.8), inG, level);
    // turbo whistle
    let turbo = null, turboG = null;
    if (C.turbo) {
      turbo = osc(ac, 'sine', 2000, t0); nodes.push(turbo);
      turboG = gain(ac, 0); chain(turbo, turboG, level);
    }
    // transmission whine (tractor)
    let whine = null, whineG = null;
    if (C.whine) {
      whine = osc(ac, 'sine', 0, t0); nodes.push(whine);
      const wm = gain(ac, C.whine * 2); chain(rpmSrc, wm, whine.frequency);
      whineG = gain(ac, 0); chain(whine, whineG, level);
    }
    // tyre / road roar (car)
    let tyreG = null;
    if (C.tyre) {
      const tn = noise(ac, R, 'brown', t0, null, rng); nodes.push(tn);
      tyreG = gain(ac, 0); chain(tn, filt(ac, 'lowpass', 380), tyreG, level);
    }
    // combine: threshing drum, grain rush, straw-walker rattle, cleaning fan
    let X = null;
    if (C.combine) {
      X = {};
      const drumW = wave(ac, R, 'combine-drum', 64, (re, im) => { for (let k = 1; k <= 64; k++) im[k] = (k % 8 === 0 ? 1 : 0.1) / Math.pow(k, 0.8); });
      X.drum = osc(ac, drumW, 15, t0); X.drumG = gain(ac, 0);
      chain(X.drum, filt(ac, 'lowpass', 1500), X.drumG, master);
      const gr = noise(ac, R, 'pink', t0, null, rng); X.rushG = gain(ac, 0);
      chain(gr, filt(ac, 'bandpass', 3000, 0.7), X.rushG, master);
      const wk = noise(ac, R, 'white', t0, null, rng); X.walkG = gain(ac, 0);
      X.walkLfo = osc(ac, pulseWave(ac, R, 0.25, 16), 3.3, t0); X.walkD = gain(ac, 0);
      chain(X.walkLfo, X.walkD, X.walkG.gain);
      chain(wk, filt(ac, 'highpass', 1500), filt(ac, 'lowpass', 6000), X.walkG, master);
      X.fan = osc(ac, 'triangle', 900, t0); X.fanG = gain(ac, 0);
      chain(X.fan, filt(ac, 'lowpass', 2500), X.fanG, master);
      nodes.push(X.drum, gr, wk, X.walkLfo, X.fan);
    }

    const P = { rpm: 0, load: 0 };
    const apply = (t) => {
      const r = clamp(P.rpm, 0, 1), L = clamp(P.load, 0, 1);
      const cyc = (C.idle + (C.max - C.idle) * r) / 120;
      tgt(rpmSrc.offset, cyc, t, C.inertia);
      tgt(huntG.gain, cyc * 0.012 * (1 - r), t, 0.3);
      tgt(gS.gain, 1 - L * 0.9, t, 0.12); tgt(gH.gain, L * 0.95, t, 0.12);
      tgt(drive.gain, 1 + L * C.drive, t, 0.12);
      tgt(lp.frequency, C.lp[0] + C.lp[1] * r + C.lp[2] * L, t, 0.12);
      const cl = C.clatter * (0.6 + 0.4 * L) * (0.55 + 0.45 * r);
      tgt(clat.gain, cl * 0.25, t, 0.1); tgt(pdepth.gain, cl * 0.75, t, 0.1);
      tgt(inG.gain, C.intake * (0.2 + r) * (0.4 + 0.6 * L), t, 0.15);
      if (turbo) { tgt(turbo.frequency, 1600 + 6500 * r * (0.5 + 0.5 * L), t, 0.6); tgt(turboG.gain, C.turbo * 0.02 * r * L, t, 0.6); }
      if (whineG) tgt(whineG.gain, 0.012 * r, t, 0.2);
      if (tyreG) tgt(tyreG.gain, C.tyre * r, t, 0.3);
      tgt(level.gain, C.gain * (0.45 + 0.35 * r + 0.25 * L), t, 0.12);
      if (X) {
        tgt(X.drum.frequency, 15 * (0.7 + 0.3 * r), t, 0.4);
        tgt(X.drumG.gain, 0.2 * L, t, 0.5); tgt(X.rushG.gain, 0.14 * L, t, 0.5);
        tgt(X.walkG.gain, 0.03 * L, t, 0.5); tgt(X.walkD.gain, 0.06 * L, t, 0.5);
        tgt(X.fan.frequency, 900 * (0.6 + 0.4 * r), t, 0.4); tgt(X.fanG.gain, 0.012 * (0.3 + r), t, 0.4);
      }
    };
    apply(t0);
    return {
      set(name, v, t) { if (name in P) { P[name] = v; apply(t); } },
      stop(t) {
        tgt(rpmSrc.offset, cyc0 * 0.6, t, 0.25);
        tgt(master.gain, 0, t, 0.18);
        stopAll(nodes, t + 1.2);
      },
    };
  };
}

// ============================================================== ambience beds
function wind(ac, out, R, o) {
  const rng = o.rng, t0 = o.t0, nodes = [];
  const gust = gustBuffer(R, 'wind', 24, [[6, 1], [2, 0.5], [0.7, 0.25]]);
  const g1 = bufSrc(ac, gust, t0, null, { loop: true, offset: rng.float() * 20 });
  const g2 = bufSrc(ac, gust, t0, null, { loop: true, rate: 0.73, offset: rng.float() * 20 });
  nodes.push(g1, g2);
  const master = gain(ac, 0); master.connect(out); tgt(master.gain, 1, t0, 0.5);
  // broadband rush with gust-swept band
  const pn = noise(ac, R, 'pink', t0, null, rng), rbp = filt(ac, 'bandpass', 450, 0.55), rushG = gain(ac, 0);
  nodes.push(pn);
  const mRush = gain(ac, 0), mRushF = gain(ac, 0);
  chain(g1, mRush, rushG.gain); chain(g1, mRushF, rbp.frequency);
  chain(pn, rbp, rushG, master);
  // whistle (narrow resonance, e.g. round a fence post)
  const wn = noise(ac, R, 'white', t0, null, rng), wbp = filt(ac, 'bandpass', 1000, 16), whG = gain(ac, 0);
  nodes.push(wn);
  const mWh = gain(ac, 0), mWhF = gain(ac, 500);
  chain(g2, mWh, whG.gain); chain(g2, mWhF, wbp.frequency);
  chain(wn, wbp, whG, master);
  // low buffeting
  const bn = noise(ac, R, 'brown', t0, null, rng), rumG = gain(ac, 0); nodes.push(bn);
  const mRum = gain(ac, 0); chain(g1, mRum, rumG.gain);
  chain(bn, filt(ac, 'lowpass', 130), rumG, master);
  // leaves / grass rustle riding on the gusts
  const ln = noise(ac, R, 'white', t0, null, rng, 0.97), leafG = gain(ac, 0); nodes.push(ln);
  const mLeaf = gain(ac, 0); chain(g1, mLeaf, leafG.gain);
  chain(ln, filt(ac, 'highpass', 3200), filt(ac, 'lowpass', 9000), leafG, master);
  const apply = (v, t) => {
    v = clamp(v, 0, 1);
    tgt(rushG.gain, 0.18 * v, t, 0.5); tgt(mRush.gain, 0.7 * v, t, 0.5);
    tgt(rbp.frequency, 280 + 260 * v, t, 0.5); tgt(mRushF.gain, 250 + 700 * v, t, 0.5);
    tgt(wbp.frequency, 800 + 600 * v, t, 0.5); tgt(mWh.gain, 0.22 * v * v, t, 0.5);
    tgt(rumG.gain, 0.05 * v, t, 0.5); tgt(mRum.gain, 0.4 * v * v, t, 0.5);
    tgt(leafG.gain, 0.01 * v, t, 0.5); tgt(mLeaf.gain, 0.09 * v, t, 0.5);
  };
  apply(o.params.speed == null ? 0.5 : o.params.speed, t0);
  return {
    set(n, v, t) { if (n === 'speed' || n === 'intensity') apply(v, t); },
    stop(t) { tgt(master.gain, 0, t, 0.4); stopAll(nodes, t + 2.5); },
  };
}

function rainDrops(R) {
  return cachedBuffer(R, 'rain-drops', 3, (d, sr, rng) => {
    const n = d.length, count = 3 * 520;
    for (let k = 0; k < count; k++) {
      const i0 = Math.floor(rng.float() * n), amp = 0.04 + 0.96 * Math.pow(rng.float(), 3);
      if (rng.chance(0.62)) { // tick on leaves/soil
        const tau = 0.0004 + rng.float() * 0.0016, L = Math.floor(tau * 6 * sr);
        for (let i = 0; i < L; i++) d[(i0 + i) % n] += amp * Math.exp(-i / (tau * sr)) * (rng.float() * 2 - 1);
      } else { // ping on a puddle / hard surface
        const f = 1400 + rng.float() * 3800, tau = 0.004 + rng.float() * 0.012, L = Math.floor(tau * 6 * sr);
        for (let i = 0; i < L; i++) { const tt = i / sr; d[(i0 + i) % n] += amp * 0.6 * Math.exp(-tt / tau) * Math.sin(TAU * f * tt * (1 + tt * 8)); }
      }
    }
    normalize(d, 0.9);
  });
}
function rain(ac, out, R, o) {
  const rng = o.rng, t0 = o.t0, nodes = [];
  const master = gain(ac, 0); master.connect(out); tgt(master.gain, 1, t0, 0.6);
  const hn = noise(ac, R, 'white', t0, null, rng), hissG = gain(ac, 0); nodes.push(hn);
  chain(hn, filt(ac, 'highpass', 1100), filt(ac, 'lowpass', 8500), hissG, master);
  const mn = noise(ac, R, 'pink', t0, null, rng), midG = gain(ac, 0); nodes.push(mn);
  chain(mn, filt(ac, 'bandpass', 1000, 0.5), midG, master);
  const ln = noise(ac, R, 'brown', t0, null, rng), lowG = gain(ac, 0); nodes.push(ln);
  chain(ln, filt(ac, 'lowpass', 420), lowG, master);
  const drops = rainDrops(R);
  const d1 = bufSrc(ac, drops, t0, null, { loop: true, offset: rng.float() * 2.5 });
  const d2 = bufSrc(ac, drops, t0, null, { loop: true, rate: 0.83, offset: rng.float() * 2.5 });
  nodes.push(d1, d2);
  const dG1 = gain(ac, 0), dG2 = gain(ac, 0);
  chain(d1, filt(ac, 'lowpass', 9000), dG1, master); chain(d2, filt(ac, 'lowpass', 6000), dG2, master);
  const apply = (v, t) => {
    v = clamp(v, 0, 1);
    tgt(hissG.gain, 0.16 * Math.pow(v, 0.8), t, 0.6); tgt(midG.gain, 0.12 * v, t, 0.6);
    tgt(lowG.gain, 0.3 * Math.pow(v, 1.4), t, 0.6);
    tgt(dG1.gain, 0.4 * Math.min(1, 0.3 + v * 1.5), t, 0.6); tgt(dG2.gain, 0.4 * v * v, t, 0.6);
  };
  apply(o.params.intensity == null ? 0.6 : o.params.intensity, t0);
  return {
    set(n, v, t) { if (n === 'intensity') apply(v, t); },
    stop(t) { tgt(master.gain, 0, t, 0.5); stopAll(nodes, t + 3); },
  };
}

function bubbles(R) {
  return cachedBuffer(R, 'river-bubbles', 4, (d, sr, rng) => {
    const n = d.length, count = 4 * 22;
    for (let k = 0; k < count; k++) {
      const i0 = Math.floor(rng.float() * n), f0 = 280 + 1500 * Math.pow(rng.float(), 2);
      const tau = 0.008 + rng.float() * 0.03, amp = 0.15 + Math.pow(rng.float(), 2), L = Math.floor(tau * 6 * sr);
      let ph = 0;
      for (let i = 0; i < L; i++) {
        const tt = i / sr, f = f0 * (1 + 6 * tt); // Minnaert bubble: rising pitch as it nears the surface
        ph += TAU * f / sr;
        d[(i0 + i) % n] += amp * Math.exp(-tt / tau) * Math.sin(ph) * Math.min(1, i / 20);
      }
    }
    normalize(d, 0.9);
  });
}
function river(ac, out, R, o) {
  const rng = o.rng, t0 = o.t0, nodes = [];
  const master = gain(ac, 0); master.connect(out); tgt(master.gain, 1, t0, 0.6);
  const flowC = gustBuffer(R, 'river', 20, [[3, 1], [0.8, 0.7], [0.25, 0.4]]);
  const bands = [[260, 1.1, 0.35], [720, 1.4, 0.25], [1900, 1.3, 0.14], [4200, 1, 0.05]];
  const G = [];
  bands.forEach(([f, q, a], i) => {
    const n = noise(ac, R, i % 2 ? 'white' : 'pink', t0, null, rng); nodes.push(n);
    const c = bufSrc(ac, flowC, t0, null, { loop: true, rate: 0.7 + i * 0.37, offset: rng.float() * 18 }); nodes.push(c);
    const g = gain(ac, a * 0.4), m = gain(ac, a * 0.6);
    chain(c, m, g.gain);
    chain(n, filt(ac, 'bandpass', f, q), g, master);
    G.push([g, m, a]);
  });
  const bb = bubbles(R);
  const b1 = bufSrc(ac, bb, t0, null, { loop: true, offset: rng.float() * 3 });
  const b2 = bufSrc(ac, bb, t0, null, { loop: true, rate: 1.21, offset: rng.float() * 3 });
  nodes.push(b1, b2);
  const bG = gain(ac, 0.2);
  b1.connect(bG); b2.connect(bG); chain(bG, filt(ac, 'lowpass', 4000), master);
  const apply = (v, t) => {
    v = clamp(v, 0, 1);
    for (const [g, m, a] of G) { tgt(g.gain, a * 0.4 * (0.4 + v), t, 0.5); tgt(m.gain, a * 0.6 * (0.4 + v), t, 0.5); }
    tgt(bG.gain, 0.12 + 0.18 * v, t, 0.5);
  };
  apply(o.params.flow == null ? 0.6 : o.params.flow, t0);
  return {
    set(n, v, t) { if (n === 'flow' || n === 'intensity') apply(v, t); },
    stop(t) { tgt(master.gain, 0, t, 0.5); stopAll(nodes, t + 3); },
  };
}

function cricketBuffer(R) {
  return cachedBuffer(R, 'crickets', 4, (d, sr, rng) => {
    const n = d.length, dur = n / sr;
    const cr = [];
    for (let k = 0; k < 4; k++) cr.push({ f: 4150 + rng.float() * 900, per: 0.34 + rng.float() * 0.25, pulses: rng.int(3, 4), amp: 0.3 + rng.float() * 0.5, ph: rng.float() });
    for (const c of cr) {
      // choose chirp period so the loop is seamless
      const per = dur / Math.round(dur / c.per);
      for (let t = c.ph * per; t < dur; t += per) {
        for (let p = 0; p < c.pulses; p++) {
          const ts = t + p * 0.034 + (rng.float() - 0.5) * 0.002, L = Math.floor(0.016 * sr), i0 = Math.floor(ts * sr);
          const a = c.amp * (p === 0 ? 0.7 : 1);
          for (let i = 0; i < L; i++) {
            const tt = i / sr, e = Math.sin(Math.PI * i / L);
            d[(i0 + i) % n] += a * e * e * Math.sin(TAU * c.f * (tt + ts) + 0.4 * Math.sin(TAU * 60 * tt));
          }
        }
      }
    }
    // distant bush-cricket: continuous high trill
    for (let i = 0; i < n; i++) {
      const tt = i / sr, am = Math.max(0, Math.sin(TAU * 40 * tt));
      d[i] += 0.07 * am * am * Math.sin(TAU * 6900 * tt);
    }
    normalize(d, 0.85);
  });
}
function crickets(ac, out, R, o) {
  const rng = o.rng, t0 = o.t0, b = cricketBuffer(R);
  const s1 = bufSrc(ac, b, t0, null, { loop: true, offset: rng.float() * 3.5 });
  const s2 = bufSrc(ac, b, t0, null, { loop: true, rate: 0.955, offset: rng.float() * 3.5 });
  const master = gain(ac, 0); master.connect(out); tgt(master.gain, 1, t0, 0.8);
  const g1 = gain(ac, 0.35), g2 = gain(ac, 0);
  chain(s1, g1, master); chain(s2, filt(ac, 'lowpass', 5200), g2, master);
  const apply = (v, t) => { tgt(g1.gain, 0.3 * clamp(v * 1.6, 0, 1), t, 0.8); tgt(g2.gain, 0.25 * v * v, t, 0.8); };
  apply(o.params.intensity == null ? 0.8 : o.params.intensity, t0);
  return {
    set(n, v, t) { if (n === 'intensity' || n === 'density') apply(v, t); },
    stop(t) { tgt(master.gain, 0, t, 0.6); stopAll([s1, s2], t + 3); },
  };
}

// ============================================================== birds (scheduled calls)
function note(ac, out, t, f0, f1, dur, amp, { fm = 0, fmr = 40, h2 = 0.12, shape = 'exp' } = {}) {
  const a = Math.min(0.012, dur * 0.25);
  const mk = (mul, g0) => {
    const o = osc(ac, 'sine', f0 * mul, t, dur + 0.02), g = gain(ac, 0);
    if (shape === 'exp') { o.frequency.setValueAtTime(f0 * mul, t); o.frequency.exponentialRampToValueAtTime(f1 * mul, t + dur); }
    else { o.frequency.setValueAtTime(f0 * mul, t); o.frequency.linearRampToValueAtTime(f1 * mul, t + dur); }
    if (fm) { const m = osc(ac, 'sine', fmr, t, dur + 0.02), mg = gain(ac, f0 * mul * fm); chain(m, mg, o.frequency); }
    chain(o, g, out);
    env(g.gain, t, [[0, 0], [a, g0], [dur * 0.7, g0 * 0.8], [dur, 0]]);
  };
  const ny = ac.sampleRate * 0.45;
  if (Math.max(f0, f1) < ny) mk(1, amp);
  if (h2 && Math.max(f0, f1) * 2 < ny) mk(2, amp * h2);
}
export const BIRDS = {
  blackbird(ac, out, t, rng) { // fluty, melodic phrases with a twittery end
    const base = 1700 + rng.float() * 700, n = rng.int(4, 7);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = base * (0.8 + rng.float() * 0.7), d = 0.08 + rng.float() * 0.17, k = rng.pick([0.8, 1.25, 1.02, 0.92, 1.15]);
      note(ac, out, tt, f, f * k, d, 0.5, { fm: 0.015, fmr: 30 + rng.float() * 30, h2: 0.1 });
      tt += d + 0.03 + rng.float() * 0.06;
    }
    const tw = rng.int(2, 6);
    for (let i = 0; i < tw; i++) { const f = 4200 + rng.float() * 2500; note(ac, out, tt, f, f * 0.7, 0.03, 0.22, { h2: 0 }); tt += 0.045; }
    return tt - t;
  },
  chaffinch(ac, out, t, rng) { // accelerating descending trill + flourish
    const n = rng.int(9, 13); let tt = t;
    for (let i = 0; i < n; i++) {
      const u = i / n, f = 4300 - 1500 * u, d = 0.05 - 0.015 * u;
      note(ac, out, tt, f, f * 0.78, d, 0.35 + 0.15 * u, { h2: 0.08 });
      tt += d + 0.03 - 0.012 * u;
    }
    note(ac, out, tt + 0.02, 4600, 2100, 0.16, 0.45, { h2: 0.1 });
    return tt - t + 0.2;
  },
  tit(ac, out, t, rng) { // "tea-cher tea-cher"
    const n = rng.int(3, 5); let tt = t;
    const hi = 5000 + rng.float() * 600, lo = hi * 0.7;
    for (let i = 0; i < n; i++) {
      note(ac, out, tt, hi, hi * 0.95, 0.08, 0.35, { h2: 0.05 });
      note(ac, out, tt + 0.11, lo * 1.05, lo, 0.1, 0.32, { h2: 0.05 });
      tt += 0.3;
    }
    return tt - t;
  },
  sparrow(ac, out, t, rng) { // "cheep cheep"
    const n = rng.int(2, 5); let tt = t;
    for (let i = 0; i < n; i++) {
      const f = 4600 + rng.float() * 700;
      note(ac, out, tt, f, f * 0.7, 0.07, 0.3, { h2: 0.3 });
      tt += 0.13 + rng.float() * 0.1;
    }
    return tt - t;
  },
  woodpigeon(ac, out, t, rng) { // "coo-COOO-coo, coo-coo"
    const lp = filt(ac, 'lowpass', 1300); lp.connect(out);
    const f = 470 + rng.float() * 60, pat = [[0.3, 0.8], [0.45, 1], [0.3, 0.8], [0.25, 0.7], [0.25, 0.7]];
    let tt = t;
    pat.forEach(([d, a], i) => {
      note(ac, lp, tt, f * (i === 1 ? 1.06 : 1), f * 0.96, d, 0.4 * a, { h2: 0.3, shape: 'lin', fm: 0.01, fmr: 6 });
      tt += d + (i === 2 ? 0.35 : 0.1);
    });
    return tt - t;
  },
  cuckoo(ac, out, t, rng) {
    const lp = filt(ac, 'lowpass', 1800); lp.connect(out);
    let tt = t;
    for (let r = 0; r < 2; r++) {
      note(ac, lp, tt, 740, 725, 0.18, 0.4, { h2: 0.15, shape: 'lin' });
      note(ac, lp, tt + 0.3, 600, 575, 0.32, 0.38, { h2: 0.15, shape: 'lin' });
      tt += 0.95;
    }
    return tt - t;
  },
  crow(ac, out, t, rng, R) { // rook/crow "kaah"
    const n = rng.int(2, 3); let tt = t;
    for (let i = 0; i < n; i++) {
      voice(ac, out, tt, R, rng, {
        dur: 0.3, tilt: 0.7, breath: 0.7, trem: [70, 0.3],
        f0: [[0, 520], [0.05, 560], [0.3, 440]],
        formants: [{ f: 1150, q: 4, g: 1 }, { f: 1700, q: 5, g: 0.6 }, { f: 2900, q: 6, g: 0.2 }],
        env: [[0, 0], [0.03, 1], [0.2, 0.7], [0.3, 0]],
      }, 1, 0.35);
      tt += 0.45 + rng.float() * 0.15;
    }
    return tt - t;
  },
  owl(ac, out, t, rng, R) { // tawny owl: "hoo-oo ... hu, hu-hoooooo"
    const lp = filt(ac, 'lowpass', 1100); lp.connect(out);
    const f = 400 + rng.float() * 50;
    note(ac, lp, t, f * 1.05, f, 0.7, 0.45, { h2: 0.08, shape: 'lin', fm: 0.01, fmr: 5 });
    const t2 = t + 2.6;
    note(ac, lp, t2, f * 0.95, f * 0.93, 0.13, 0.3, { h2: 0.06, shape: 'lin' });
    note(ac, lp, t2 + 0.35, f, f * 1.02, 0.15, 0.35, { h2: 0.06, shape: 'lin' });
    note(ac, lp, t2 + 0.62, f * 1.02, f * 0.9, 1.3, 0.42, { h2: 0.08, shape: 'lin', fm: 0.035, fmr: 7.5 });
    const n = noise(ac, R, 'pink', t2 + 0.62, 1.3, rng), g = gain(ac, 0);
    chain(n, filt(ac, 'bandpass', f, 6), g, out); env(g.gain, t2 + 0.62, [[0, 0], [0.1, 0.25], [1.1, 0.15], [1.3, 0]]);
    return 4.6;
  },
};

const SPECIES = {
  spring: [['blackbird', 3], ['chaffinch', 3], ['tit', 2], ['sparrow', 2], ['woodpigeon', 1.2], ['crow', 0.6], ['cuckoo', 0.5]],
  summer: [['blackbird', 2.5], ['chaffinch', 2], ['tit', 1.2], ['sparrow', 3], ['woodpigeon', 1.5], ['crow', 0.8]],
  autumn: [['blackbird', 1], ['tit', 2], ['sparrow', 2], ['woodpigeon', 1], ['crow', 1.5]],
  winter: [['blackbird', 0.6], ['tit', 2], ['sparrow', 1.5], ['crow', 1.5], ['woodpigeon', 0.5]],
};

function scheduler(pickCall, meanGap, spatial = true) {
  return (ac, out, R, o) => {
    const rng = o.rng, P = Object.assign({ density: 0.6, season: 'spring' }, o.params);
    let next = o.t0 + 0.2 + rng.float() * 0.6, stopped = false;
    const master = gain(ac, 1); master.connect(out);
    return {
      set(n, v) { P[n] = v; },
      tick(t0, t1) {
        while (!stopped && next < t1) {
          if (next >= t0 - 0.05 && P.density > 0.02) {
            // each caller sits somewhere around: own pan + distance
            const pan = ac.createStereoPanner(), dist = spatial ? rng.float() : 0.2;
            pan.pan.value = spatial ? (rng.float() * 2 - 1) * 0.85 : 0;
            const g = gain(ac, 0.3 + 0.7 * (1 - dist)), lp = filt(ac, 'lowpass', 12000 - 8000 * dist);
            chain(g, lp, pan, master);
            pickCall(ac, g, next, rng, R, P);
          }
          const gap = meanGap(P);
          next += gap * (0.25 + -Math.log(1 - rng.float() * 0.95));
        }
      },
      stop(t) { stopped = true; tgt(master.gain, 0, t, 0.5); },
    };
  };
}
const birds = scheduler((ac, g, t, rng, R, P) => {
  const name = rng.weighted(SPECIES[P.season] || SPECIES.spring);
  BIRDS[name](ac, g, t, rng, R);
}, (P) => 3.2 / (0.12 + clamp(P.density, 0, 1) * 1.8));
const owl = scheduler((ac, g, t, rng, R) => { BIRDS.owl(ac, g, t, rng, R); }, (P) => 16 / (0.2 + clamp(P.density, 0, 1)));

// ============================================================== music (very quiet, generative)
const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88]; // D major pentatonic
const CHORDS = [[73.42, 146.83, 185.0, 220.0], [98.0, 146.83, 196.0, 246.94], [61.74, 123.47, 185.0, 246.94], [110.0, 164.81, 220.0, 277.18]];
function phrase(ac, out, t, rng, R) {
  const ch = rng.pick(CHORDS);
  // pad: detuned triangles, slow swell
  const pad = gain(ac, 0), lp = filt(ac, 'lowpass', 900, 0.5);
  chain(pad, lp, out);
  env(pad.gain, t, [[0, 0], [2.5, 0.05], [6, 0.045], [9, 0]]);
  for (const f of ch) for (const det of [-0.004, 0.004]) { const o = osc(ac, 'triangle', f * (1 + det), t, 9.1); o.connect(pad); }
  // plucked melody
  let tt = t + 0.8 + rng.float() * 0.6, idx = rng.int(3, 6);
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    idx = clamp(idx + rng.pick([-2, -1, -1, 1, 1, 2, 0]), 2, SCALE.length - 1);
    const s = bufSrc(ac, pluckBuffer(R, SCALE[idx] * 2), tt, 2.6), g = gain(ac, 0.14 * (0.7 + rng.float() * 0.3));
    chain(s, filt(ac, 'lowpass', 2800), g, out);
    tt += rng.pick([0.4, 0.6, 0.6, 0.8, 1.2]);
  }
  return Math.max(9, tt - t);
}
const music = scheduler((ac, g, t, rng, R) => phrase(ac, g, t, rng, R), () => 12, false);

export const LOOPS = {
  'engine-tractor': engineLoop('tractor'),
  'engine-car': engineLoop('car'),
  'engine-combine': engineLoop('combine'),
  river, wind, rain, crickets, birds, owl, music,
};
export const LOOP_IDS = Object.keys(LOOPS);
