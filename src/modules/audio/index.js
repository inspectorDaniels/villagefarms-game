// audio — procedural WebAudio: ambience director, engines, UI/farm/animal one-shots, positional mixing.
// Nothing here may throw into the game: the AudioContext is created lazily (first user gesture, or the
// showcase), every audio call is wrapped, and loop handles are "virtual" until a context exists.
// Main-thread budget: play()/loop() only create nodes; all sample generation is baked in small
// work-bounded slices from frame() (see synth.bake), and loops start once their buffers are baked.
import { resources, gain, filt, clamp, bake, want, allReady, recipeKeys, prioritize } from './synth.js';
import { ONESHOTS, ONESHOT_IDS, GRAIN_KEYS, PRINTS, THUNDER_DIST } from './oneshots.js';
import { LOOPS, LOOP_IDS, LOOP_NEEDS, LOOP_PRINTS, prewarm } from './loops.js';
import { ambienceLevels, readWeather, muffleCutoff } from './director.js';
import { buildBoard } from './board.js';

export const manifest = {
  id: 'audio',
  wave: 1,
  deps: [],
  optionalDeps: ['environment', 'terrain'],
  namespaces: ['audio'],
  api: ['play', 'loop', 'setListener', 'setVolume', 'mute', 'isUnlocked', 'unlock', 'levels', 'sounds'],
  emits: ['audio:unlocked'],
  listens: ['env:lightning'],
};

const BUS_OF = (id) => (id === 'thunder' ? 'ambience' : 'sfx');
const LOOP_BUS = { river: 'ambience', wind: 'ambience', rain: 'ambience', crickets: 'ambience', birds: 'ambience', owl: 'ambience', music: 'music' };
const MAX_ONESHOTS = 32;
const BAKE_BUDGET = 16000;     // work units (≈ samples) per frame — see README for measured ms
const PRINT_SR = 32000;        // one-shot prints are rendered offline at 32 kHz (resampled on playback)
const CULL_GAIN = 0.003;       // ≈ -50 dB: positional loops quieter than this for CULL_S are virtualised
const CULL_S = 2;
const NOOP_HANDLE = Object.freeze({ setPosition() {}, setParam() {}, setVolume() {}, stop() {}, playing: false });

export async function init(ctx) {
  const { world } = ctx;
  const A = world.audio;
  Object.assign(A, {
    unlocked: false, state: 'none', muted: false,
    volumes: { master: 0.8, sfx: 1, ambience: 0.7, music: 0.35 },
    mixer: { birds: 0, crickets: 0, owl: 0, wind: 0, rain: 0, river: 0, music: 0 },
    listener: { x: 0, y: 0, zoom: 24, manual: false },
    voices: 0, liveVoices: 0, oneshots: 0, thunderCount: 0, bakeJobs: 0,
  });

  const mk = (name) => ctx.rng('res:' + name);
  const sfxRng = ctx.rng('sfx');
  const ambRng = ctx.rng('ambience');
  let loopSeq = 0;

  // ------------------------------------------------------------------ context & buses
  const S = { ac: null, R: null, buses: null, analysers: null, failed: false, emitted: false, prewarmStep: 0,
    printQueue: [], printBusy: 0 };
  // print order: one-shots (UI + footsteps first), then scheduled birds/owl, then music phrases
  for (const id of ONESHOT_IDS) { const [dur, n] = PRINTS[id] || [1, 2]; for (let i = 0; i < n; i++) S.printQueue.push({ key: id, i, dur, build: (ac, out, t, R2, rng, dist) => ONESHOTS[id](ac, out, t, R2, { rng, p: 1, dist }) }); }
  for (const [key, [dur, n, fn]] of Object.entries(LOOP_PRINTS)) for (let i = 0; i < n; i++) S.printQueue.push({ key, i, dur, build: (ac, out, t, R2, rng) => fn(ac, out, t, R2, rng) });
  const voices = new Set();
  let oneshotEnds = [];

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

  function ensure() {
    if (S.ac || S.failed) return S.ac;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { S.failed = true; A.state = 'unsupported'; return null; }
    try {
      const ac = new AC({ latencyHint: 'interactive' });
      S.ac = ac;
      S.R = resources(ac, mk);
      S.R.prints = new Map();
      const master = gain(ac, A.muted ? 0 : A.volumes.master);
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ac.destination);
      const muffle = filt(ac, 'lowpass', 18000, 0.5);
      const buses = { master, sfx: gain(ac, A.volumes.sfx), ambience: gain(ac, A.volumes.ambience), music: gain(ac, A.volumes.music) };
      buses.sfx.connect(master); buses.ambience.connect(muffle); muffle.connect(master); buses.music.connect(master);
      S.muffle = muffle; S.buses = buses; S.analysers = {};
      for (const b of ['sfx', 'ambience', 'music']) { const an = ac.createAnalyser(); an.fftSize = 1024; buses[b].connect(an); S.analysers[b] = an; }
      ac.onstatechange = () => safe(onState);
      // queue everything that will be needed, most urgent first; baked in slices from frame()
      want(S.R, ['noise:pink', 'noise:brown', ...GRAIN_KEYS, ...LOOP_NEEDS.wind, ...LOOP_NEEDS.crickets,
        ...LOOP_NEEDS.rain, ...LOOP_NEEDS.river, ...LOOP_NEEDS.music, ...recipeKeys('')]);
      onState();
      return ac;
    } catch (e) {
      S.failed = true; A.state = 'error';
      ctx.warn('AudioContext unavailable: ' + (e && e.message));
      return null;
    }
  }
  function onState() {
    if (!S.ac) return;
    A.state = S.ac.state;
    A.unlocked = S.ac.state === 'running';
    if (A.unlocked && !S.emitted) { S.emitted = true; ctx.events.emit('audio:unlocked', {}); }
  }
  const running = () => !!(S.ac && S.ac.state === 'running');

  // (re)unlock on any gesture while the context is not running (autoplay policy, iOS interruptions,
  // device changes). The listener stays installed; it is a cheap no-op while running.
  const unlockEvents = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
  function unlock() {
    safe(() => {
      ensure();
      if (S.ac && S.ac.state !== 'running' && S.ac.state !== 'closed') {
        const p = S.ac.resume();
        if (p && p.catch) p.catch(() => {});
      }
    });
    return running();
  }
  const onGesture = () => { if (!running()) unlock(); };
  for (const e of unlockEvents) window.addEventListener(e, onGesture, true);
  const removeUnlock = () => { for (const e of unlockEvents) window.removeEventListener(e, onGesture, true); };
  if (ctx.params.audio === 'on') unlock();

  // ------------------------------------------------------------------ listener & spatialisation
  const L = A.listener;
  function syncListener() {
    if (L.manual) return;
    L.x = ctx.camera.x; L.y = ctx.camera.y; L.zoom = ctx.camera.zoom;
  }
  syncListener();
  /** gain / pan / air-absorption for a world position relative to the listener */
  function spatial(x, y) {
    const halfW = (ctx.camera.w || 1600) / 2 / Math.max(0.5, L.zoom || 24);
    const H = clamp(halfW * 0.55, 5, 160);              // "camera height": zooming out = hearing from higher up
    const dx = x - L.x, dy = y - L.y, flat = Math.hypot(dx, dy), d = Math.hypot(flat, H);
    const g = Math.pow(9 / Math.max(9, d), 1.15);
    const pan = clamp(dx / (halfW * 1.2), -1, 1) * 0.8;
    const lp = clamp(20000 * Math.exp(-flat / 260), 1500, 20000);
    return { g, pan, lp };
  }

  // ------------------------------------------------------------------ virtual loop voices
  // A voice is always "virtual" (id, position, params, volume). It is materialised into audio nodes
  // when a context exists, its buffers are baked, and (if positional) it is audible; otherwise it
  // costs nothing on the audio thread.
  function materialize(v) {
    if (!S.ac || v.live || v.stopped) return;
    const needs = LOOP_NEEDS[v.id] || [];
    if (needs.length && !allReady(S.R, needs)) { v.pending = true; prioritize(S.R, needs); return; }
    v.pending = false;
    if (v.x != null && spatial(v.x, v.y).g * v.volume < CULL_GAIN) { v.culled = true; return; }
    v.culled = false; v.quiet = 0;
    try {
      const ac = S.ac;
      const vol = gain(ac, 0), att = gain(ac, 1);
      let node = vol.connect(att);
      v.pan = v.lp = null;
      if (v.x != null) { v.pan = ac.createStereoPanner(); v.lp = filt(ac, 'lowpass', 20000, 0.5); node = att.connect(v.lp).connect(v.pan); }
      node.connect(S.buses[v.bus] || S.buses.sfx);
      v.vol = vol; v.att = att;
      const t = ac.currentTime + 0.02;
      v.live = LOOPS[v.id](ac, vol, S.R, { rng: v.rng, t0: t, params: Object.assign({}, v.params) });
      for (const k of Object.keys(v.params)) v.live.set(k, v.params[k], t);
      vol.gain.setTargetAtTime(v.volume, t, v.fade);
      v.sched = t; v.lastSp = null;
      applySpatial(v, true);
    } catch (e) {
      ctx.warn(`loop ${v.id} failed: ${e && e.message}`);
      v.live = null; v.stopped = true; voices.delete(v);
    }
  }
  /** tear the nodes down but keep the virtual voice */
  function release(v, fade = 0.15) {
    if (!v.live || !S.ac) return;
    const live = v.live, vol = v.vol, t = S.ac.currentTime;
    v.live = null; v.vol = v.att = v.pan = v.lp = null;
    safe(() => { live.stop(t); vol.gain.setTargetAtTime(0, t, fade); });
    setTimeout(() => safe(() => vol.disconnect()), 4000 + fade * 5000);
  }
  function applySpatial(v, force) {
    if (v.x == null || !v.att || !S.ac) return;
    const sp = spatial(v.x, v.y), t = S.ac.currentTime, o = v.lastSp;
    if (!force && o && Math.abs(o.g - sp.g) < 0.003 && Math.abs(o.pan - sp.pan) < 0.01 && Math.abs(o.lp - sp.lp) < 200) return sp;
    v.att.gain.setTargetAtTime(sp.g, t, 0.06);
    v.pan.pan.setTargetAtTime(sp.pan, t, 0.06);
    v.lp.frequency.setTargetAtTime(sp.lp, t, 0.1);
    v.lastSp = sp;
    return sp;
  }
  function createLoop(id, opts = {}) {
    if (!LOOPS[id]) { ctx.warn('unknown loop ' + id); return null; }
    const v = {
      id, bus: opts.bus || LOOP_BUS[id] || 'sfx',
      x: Number.isFinite(opts.x) ? opts.x : null, y: Number.isFinite(opts.y) ? opts.y : null,
      volume: Number.isFinite(opts.volume) ? clamp(opts.volume, 0, 2) : 1,
      fade: opts.fade || 0.25,
      params: Object.assign({}, opts.params || {}),
      rng: ctx.rng('loop:' + id + ':' + (loopSeq++)),
      live: null, stopped: false, pending: false, culled: false, quiet: 0,
    };
    for (const k of ['rpm', 'load', 'speed', 'intensity', 'flow', 'density', 'season']) if (opts[k] != null) v.params[k] = opts[k];
    voices.add(v);
    v.pending = true; // materialised by frame(), at most one per frame
    return v;
  }
  function stopLoop(v, fade) {
    if (!v || v.stopped) return;
    v.stopped = true;
    voices.delete(v);
    release(v, fade || 0.15);
  }
  function handleFor(v) {
    if (!v) return NOOP_HANDLE;
    return {
      setPosition(x, y) {
        safe(() => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const wasFlat = v.x == null;
          v.x = x; v.y = y;
          if (wasFlat && v.live) { release(v, 0.05); v.pending = true; } // becomes positional
        });
      },
      setParam(name, val) { safe(() => { v.params[name] = val; if (v.live && S.ac) v.live.set(name, val, S.ac.currentTime); }); },
      setVolume(val) {
        safe(() => {
          v.volume = clamp(Number(val) || 0, 0, 2);
          if (v.vol && S.ac) v.vol.gain.setTargetAtTime(v.volume, S.ac.currentTime, v.fade);
        });
      },
      stop(fade) { safe(() => stopLoop(v, fade)); },
      get playing() { return !v.stopped; },
    };
  }

  // ------------------------------------------------------------------ one-shots
  function play(id, opts = {}) {
    const b = ONESHOTS[id];
    if (!b) { ctx.warn('unknown sound ' + id); return false; }
    if (!running()) return false;
    const ac = S.ac, now = ac.currentTime;
    if (oneshotEnds.length > 8) oneshotEnds = oneshotEnds.filter((e) => e > now);
    if (oneshotEnds.length >= MAX_ONESHOTS) return false;
    const vol = Number.isFinite(opts.volume) ? clamp(opts.volume, 0, 2) : 1;
    const pitch = Number.isFinite(opts.pitch) ? clamp(opts.pitch, 0.25, 4) : 1;
    const delay = Number.isFinite(opts.delay) ? clamp(opts.delay, 0, 30) : 0;
    const pr = S.R.prints.get(id);
    if (pr && pr.length) return playPrint(id, pr, opts, vol, pitch, delay, now);
    const out = gain(ac, vol);
    let head = out;
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      const sp = spatial(opts.x, opts.y);
      if (sp.g * vol < 0.004) return false;
      const att = gain(ac, sp.g), pan = ac.createStereoPanner(), lp = filt(ac, 'lowpass', sp.lp, 0.5);
      pan.pan.value = sp.pan;
      out.connect(att).connect(lp).connect(pan);
      head = pan;
    }
    head.connect(S.buses[opts.bus] || S.buses[BUS_OF(id)]);
    const dur = b(ac, out, now + 0.005 + delay, S.R, { rng: sfxRng, p: pitch * (0.97 + sfxRng.float() * 0.06), dist: opts.dist });
    oneshotEnds.push(now + delay + dur);
    setTimeout(() => safe(() => out.disconnect()), (delay + dur + 1) * 1000);
    return true;
  }

  /** fast path: a pre-rendered variant → BufferSource → gain → (lowpass) → (pan) → bus (2–4 nodes) */
  function playPrint(id, pr, opts, vol, pitch, delay, now) {
    const ac = S.ac;
    let v;
    if (id === 'thunder' && Number.isFinite(opts.dist)) { v = pr[0]; for (const q of pr) if (Math.abs(q.dist - opts.dist) < Math.abs(v.dist - opts.dist)) v = q; }
    else v = pr[Math.floor(sfxRng.float() * pr.length)];
    let g = vol, pan = 0, lpF = 20000;
    const pos = Number.isFinite(opts.x) && Number.isFinite(opts.y);
    if (pos) { const sp = spatial(opts.x, opts.y); g *= sp.g; pan = sp.pan; lpF = sp.lp; if (g < 0.004) return false; }
    const src = ac.createBufferSource();
    src.buffer = v.buf;
    const rate = pitch * (0.96 + sfxRng.float() * 0.08);
    src.playbackRate.value = rate;
    const out = ac.createGain(); out.gain.value = g;
    src.connect(out);
    let head = out;
    if (lpF < 15000) { const lp = ac.createBiquadFilter(); lp.frequency.value = lpF; head.connect(lp); head = lp; }
    if (pos) { const p = ac.createStereoPanner(); p.pan.value = pan; head.connect(p); head = p; }
    head.connect(S.buses[opts.bus] || S.buses[BUS_OF(id)]);
    src.onended = () => { try { out.disconnect(); if (head !== out) head.disconnect(); } catch (e) { /* gone */ } };
    src.start(now + 0.005 + delay);
    oneshotEnds.push(now + delay + v.buf.duration / rate);
    return true;
  }
  /** render one one-shot variant offline (audio render thread); called from frame() one at a time */
  function printStep() {
    if (S.printBusy >= 2 || !S.printQueue.length) return;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) { S.printQueue.length = 0; return; }
    const job = S.printQueue[0];
    let cur = S.printCur;
    if (!cur || cur.key !== job.key) {
      // one offline context per sound id; its variants are laid out in time slots, one variant built per frame
      let n = 0; while (n < S.printQueue.length && S.printQueue[n].key === job.key) n++;
      const slot = job.dur + 0.05, oac = new OAC(1, Math.ceil(slot * n * PRINT_SR), PRINT_SR);
      cur = S.printCur = { key: job.key, n, slot, oac, R2: resources(oac, mk, { share: S.R }), out: gain(oac, 1), done: 0, dists: [] };
      cur.out.connect(oac.destination);
      return; // context creation is this frame's work
    }
    S.printQueue.shift();
    const id = job.key, i = job.i;
    const dist = id === 'thunder' ? THUNDER_DIST[i % THUNDER_DIST.length] : undefined;
    job.build(cur.oac, cur.out, 0.003 + cur.done * cur.slot, cur.R2, ctx.rng('print:' + id + ':' + i), dist);
    cur.dists.push(dist);
    if (++cur.done < cur.n) return;
    S.printCur = null;
    S.printBusy = (S.printBusy || 0) + 1;
    cur.oac.startRendering().then((buf) => {
      const d = buf.getChannelData(0), L = Math.floor(cur.slot * PRINT_SR), list = [];
      for (let k = 0; k < cur.n; k++) {
        const b = S.ac.createBuffer(1, L, PRINT_SR);
        b.copyToChannel(d.subarray(k * L, (k + 1) * L), 0);
        list.push({ buf: b, dist: cur.dists[k] });
      }
      S.R.prints.set(id, list);
      A.prints = (A.prints || 0) + list.length;
      S.printBusy--;
    }, () => { S.printBusy--; });
  }


  // ------------------------------------------------------------------ ambience director
  const D = { acc: 0, waterAcc: 9, water: 0, waterPos: null, layers: {}, thunderT: 10, lightningSeen: -1e9, realT: 0, weatherOverride: null, enabled: true, W: null };
  function currentWeather() {
    const envW = world.environment && world.environment.weather;
    if (envW && typeof envW === 'object' && envW.kind) return readWeather(envW);
    const env = ctx.modules.get('environment');
    const w = env && typeof env.getWeather === 'function' ? env.getWeather() : null;
    if (w && w.kind) return readWeather(w);
    return readWeather(D.weatherOverride || (ctx.params.weather ? { kind: ctx.params.weather } : null));
  }
  // environment's lightning → thunder after the sound's travel time (~3 s/km)
  ctx.events.on('env:lightning', (e) => {
    D.lightningSeen = D.realT;
    const km = e && Number.isFinite(e.distance) ? e.distance : 2;
    if (running()) { play('thunder', { dist: clamp(km / 6, 0, 1), delay: Math.min(12, km * 2.9), volume: 0.95, bus: 'ambience' }); A.thunderCount++; }
  });
  function nearestWater() {
    let best = null, bd = Infinity;
    const T = ctx.modules.get('terrain');
    let paths = T && typeof T.riverPaths === 'function' ? T.riverPaths() : null;
    if (!Array.isArray(paths)) paths = world.terrain && Array.isArray(world.terrain.rivers) ? world.terrain.rivers : null;
    const P = (p) => (Array.isArray(p) ? p : p && Number.isFinite(p.x) ? [p.x, p.y] : null);
    if (paths) {
      for (let path of paths) {
        if (path && !Array.isArray(path)) path = path.points || path.path || null;
        if (!Array.isArray(path)) continue;
        for (let i = 0; i + 1 < path.length; i++) {
          const a = P(path[i]), b = P(path[i + 1]);
          if (!a || !b) continue;
          const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
          const u = clamp(((L.x - a[0]) * ex + (L.y - a[1]) * ey) / l2, 0, 1);
          const px = a[0] + ex * u, py = a[1] + ey * u, d = Math.hypot(px - L.x, py - L.y);
          if (d < bd) { bd = d; best = [px, py]; }
        }
      }
    }
    if (T && typeof T.isWater === 'function' && bd > 25) { // ponds/lakes: coarse ring probe
      for (const r of [12, 30, 55]) {
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2, x = L.x + Math.cos(a) * r, y = L.y + Math.sin(a) * r;
          if (T.isWater(x, y) === true && r < bd) { bd = r; best = [x, y]; }
        }
        if (best && bd <= r) break;
      }
    }
    return best ? { pos: best, d: bd } : null;
  }
  const DIRECTOR_LAYERS = ['birds', 'crickets', 'owl', 'wind', 'rain', 'river', 'music'];
  function director(dt) {
    D.acc += dt; D.waterAcc += dt; D.realT += dt;
    D.thunderT -= dt;
    if (D.acc < 0.25) return;
    const step = D.acc; D.acc = 0;
    if (D.waterAcc > 1) {
      D.waterAcc = 0;
      const w = safe(nearestWater, null);
      D.water = w ? clamp(1 - (w.d - 8) / 110, 0, 1) : 0;
      D.waterPos = w ? w.pos : null;
    }
    const W = currentWeather();
    D.W = W;
    const lv = ambienceLevels(ctx.clock.timeOfDay, ctx.clock.season, ctx.clock.yearFrac, W, D.water);
    for (const k of DIRECTOR_LAYERS) A.mixer[k] = +lv[k].toFixed(3);
    if (S.muffle && S.ac) S.muffle.frequency.setTargetAtTime(muffleCutoff(W), S.ac.currentTime, 2);
    if (!D.enabled) return;
    for (const k of DIRECTOR_LAYERS) {
      const target = lv[k];
      let Ly = D.layers[k];
      if (target > 0.012) {
        if (!Ly || !Ly.v || Ly.v.stopped) {
          const opts = { fade: 2.5, volume: 0 };
          if (k === 'river' && D.waterPos) { opts.x = D.waterPos[0]; opts.y = D.waterPos[1]; }
          Ly = D.layers[k] = { v: createLoop(k, opts), low: 0 };
          if (!Ly.v) continue;
        }
        Ly.low = 0;
        const h = handleFor(Ly.v);
        if (k === 'birds' || k === 'owl') { h.setParam('density', target); h.setParam('season', ctx.clock.season); h.setVolume(0.55 + 0.45 * target); }
        else if (k === 'crickets') { h.setParam('intensity', target); h.setVolume(0.35 + 0.65 * target); }
        else if (k === 'wind') { h.setParam('speed', clamp(W.windSpeed / 15, 0, 1)); h.setVolume(target); }
        else if (k === 'rain') { h.setParam('intensity', target); h.setVolume(Math.min(1, target * 2.5)); } // continuous: fades in from 0
        else if (k === 'river') { h.setParam('flow', 0.4 + 0.6 * target); h.setVolume(1); if (D.waterPos) h.setPosition(D.waterPos[0], D.waterPos[1]); }
        else if (k === 'music') { h.setVolume(target); }
      } else if (Ly && Ly.v && !Ly.v.stopped) {
        handleFor(Ly.v).setVolume(0);
        Ly.low += step;
        if (Ly.low > 8) { stopLoop(Ly.v, 1.5); D.layers[k] = null; }
      }
    }
    // fallback thunder when no environment lightning events arrive: gated & paced by the storm value
    if (W.storm > 0.35 && D.thunderT <= 0 && D.realT - D.lightningSeen > 60) {
      D.thunderT = (6 + ambRng.float() * 20) / (0.4 + W.storm);
      if (running()) { play('thunder', { dist: ambRng.float(), volume: 0.5 + 0.5 * W.storm, bus: 'ambience' }); A.thunderCount++; }
    } else if (W.storm <= 0.35 && D.thunderT < 5) D.thunderT = 5;
  }

  // ------------------------------------------------------------------ board (showcase only)
  let board = null;
  const B = { buf: null };
  function busLevel(name) {
    const an = S.analysers && S.analysers[name];
    if (!an || !running()) return null;
    if (!B.buf || B.buf.length !== an.fftSize) B.buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(B.buf);
    let s = 0; for (let i = 0; i < B.buf.length; i++) s += B.buf[i] * B.buf[i];
    const rms = Math.sqrt(s / B.buf.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -120;
    const h = B.hold || (B.hold = {});
    h[name] = Math.max(db, (h[name] == null ? -120 : h[name]) - 1.5); // peak-hold meter, ~90 dB/s fall at 60 fps
    return h[name];
  }
  ctx.renderer.addLayer('screen', (g, view) => { if (board) board.draw(g, view); }, 50);

  const api = {
    play(id, opts) { return safe(() => play(id, opts || {}), false); },
    loop(id, opts) { return safe(() => handleFor(createLoop(id, opts || {})), NOOP_HANDLE); },
    setListener(x, y, zoom) {
      if (x == null || !Number.isFinite(x) || !Number.isFinite(y)) { L.manual = false; syncListener(); return; }
      L.manual = true; L.x = x; L.y = y; if (Number.isFinite(zoom) && zoom > 0) L.zoom = zoom;
    },
    setVolume(bus, v) {
      if (!(bus in A.volumes)) return false;
      A.volumes[bus] = clamp(Number(v) || 0, 0, 1);
      if (S.buses && S.ac) S.buses[bus].gain.setTargetAtTime(bus === 'master' && A.muted ? 0 : A.volumes[bus], S.ac.currentTime, 0.05);
      return true;
    },
    mute(on) {
      A.muted = !!on;
      if (S.buses && S.ac) S.buses.master.gain.setTargetAtTime(A.muted ? 0 : A.volumes.master, S.ac.currentTime, 0.05);
      return A.muted;
    },
    isUnlocked() { return running(); },
    unlock() { return unlock(); },
    levels() { return Object.assign({}, A.mixer, { state: A.state, voices: voices.size }); },
    sounds() { return { oneshots: ONESHOT_IDS.slice(), loops: LOOP_IDS.slice() }; },
  };

  let spatialAcc = 0;
  const inst = {
    api,
    update(dt) {
      director(dt);
      if (running()) {
        const now = S.ac.currentTime;
        for (const v of voices) if (v.live && v.live.tick && v.sched < now + 0.25) { v.live.tick(v.sched, now + 0.5); v.sched = now + 0.5; }
      }
    },
    frame(dt) {
      syncListener();
      if (!S.ac) return;
      // 1) bake generated buffers in small slices (never a long frame)
      let heavy = false;
      A.fw = '';
      S.fc = (S.fc || 0) + 1;
      let pendingLoops = false; // a pending loop whose buffers are baked gets every other frame
      for (const v of voices) if (v.pending && !v.live && (LOOP_NEEDS[v.id] || []).every((k) => S.R.bufs.has(k))) { pendingLoops = true; break; }
      if (pendingLoops && (S.fc & 1)) { /* even split: this frame is for building a loop */ } else if (S.R.jobs.length) { A.bakeJobs = bake(S.R, BAKE_BUDGET); heavy = true; A.fw = 'bake'; }
      else if (S.prewarmStep >= 0) { A.fw = 'prewarm'; if (!safe(() => prewarm(S.ac, S.R, mk, S.prewarmStep), false)) S.prewarmStep = -1; else S.prewarmStep++; A.bakeJobs = 0; heavy = true; }
      else if (S.printQueue.length && S.printBusy < 2) { A.fw = 'print:' + S.printQueue[0].key; safe(printStep); heavy = true; }
      // 2) spatial updates + virtualisation (positional loops below -50 dB for 2 s release their nodes)
      spatialAcc += dt || 0.016;
      const doCull = spatialAcc > 0.1; if (doCull) spatialAcc = 0;
      let live = 0, built = heavy ? 1 : 0; // at most one loop materialised per frame (≈ 1–4 ms each)
      for (const v of voices) {
        if (v.live) {
          live++;
          if (v.x != null) {
            const sp = applySpatial(v, false) || v.lastSp;
            if (doCull && sp) {
              if (sp.g * v.volume < CULL_GAIN) { v.quiet += 0.1; if (v.quiet > CULL_S) { release(v, 0.3); v.culled = true; } } else v.quiet = 0;
            }
          }
        } else if (built < 1 && (v.pending || (v.culled && doCull))) { materialize(v); if (v.live) { built++; A.fw = (A.fw || '') + ' build:' + v.id; } }
      }
      if (doCull) A.voiceStates = [...voices].map((v) => v.id + (v.live ? ':live' : v.pending ? ':pending' : v.culled ? ':culled' : ':idle'));
      A.voices = voices.size; A.liveVoices = live; A.printLeft = S.printQueue.length + (S.printBusy || S.printCur ? 1 : 0);
      A.oneshots = oneshotEnds.length;
    },
    save() { return { volumes: Object.assign({}, A.volumes), muted: A.muted }; },
    load(d) {
      if (!d) return;
      if (d.volumes) for (const k of Object.keys(A.volumes)) if (Number.isFinite(d.volumes[k])) api.setVolume(k, d.volumes[k]);
      if (d.muted != null) api.mute(d.muted);
    },
    dispose() {
      removeUnlock();
      for (const v of [...voices]) stopLoop(v);
      if (S.ac) safe(() => S.ac.close());
    },
  };

  inst._showcase = { ensure, unlock, D, S, mk, busLevel, createLoop, handleFor, setBoard(b) { board = b; } };
  SHOWCASE_HOOKS.set(ctx.world, inst._showcase);
  return inst;
}

const SHOWCASE_HOOKS = new WeakMap();

// ==================================================================== showcase
const PRESET_SETUP = {
  default: { weather: { kind: 'clear', wind: { speed: 3 } } },
  engines: { weather: { kind: 'clear', wind: { speed: 2 } } },
  'ambience-day': { weather: { kind: 'clear', wind: { speed: 4 } } },
  'ambience-night': { weather: { kind: 'clear', wind: { speed: 2 }, temperature: 19 } },
};
const WEATHER_PARAM = {
  rain: { kind: 'rain', intensity: 0.7, rain: 0.7, wind: { speed: 6 } },
  storm: { kind: 'storm', intensity: 0.9, rain: 0.8, storm: 0.9, wind: { speed: 14 } },
  snow: { kind: 'snow', intensity: 0.7, snow: 0.8, wind: { speed: 4 }, temperature: -2 },
  fog: { kind: 'fog', intensity: 0.8, fog: 0.8, wind: { speed: 1 } },
};

export const showcase = {
  deps: [],
  presets: {
    default: { camera: { x: 512, y: 512, zoom: 24 }, time: '10:00', day: 12 },
    engines: { camera: { x: 512, y: 512, zoom: 24 }, time: '14:00', day: 20 },
    'ambience-day': { camera: { x: 512, y: 512, zoom: 24 }, time: '05:10', day: 13 },
    'ambience-night': { camera: { x: 512, y: 512, zoom: 24 }, time: '23:30', day: 19 },
  },
  async stage(ctx, preset) {
    const H = SHOWCASE_HOOKS.get(ctx.world);
    if (!H) return;
    // boot applies ?day/?time only after stage(): apply them now so the board matches the clock it prints
    if (ctx.params.day != null && Number.isFinite(Number(ctx.params.day))) ctx.clock.setDayOfYear(Number(ctx.params.day));
    if (ctx.params.time) ctx.clock.set(ctx.params.time);
    const setup = PRESET_SETUP[preset] || PRESET_SETUP.default;
    const wp = ctx.params.weather;
    H.D.weatherOverride = wp ? (WEATHER_PARAM[wp] || { kind: wp }) : setup.weather;
    H.unlock(); // headless autoplay policy allows this; in a normal browser it waits for a click
    const api = ctx.modules.get('audio');
    if (preset === 'engines' && api) {
      const tr = api.loop('engine-tractor', { x: ctx.camera.x - 6, y: ctx.camera.y, volume: 0.8 });
      tr.setParam('rpm', 0.55); tr.setParam('load', 0.6);
    }
    const board = await buildBoard({
      ctx, preset, mk: H.mk, busLevel: H.busLevel,
      weather: () => H.D.W || readWeather(H.D.weatherOverride),
      state: () => ({ ctxState: ctx.world.audio.state, voices: ctx.world.audio.voices, live: ctx.world.audio.liveVoices, jobs: ctx.world.audio.bakeJobs }),
    });
    H.setBoard(board);
  },
};
