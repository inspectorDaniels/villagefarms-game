// Pooled particle system: struct-of-arrays, swap-remove, zero allocation per particle.
// Motion is 3D (x,y on the ground plane, z = height in metres); height is conveyed by
// shadows (core shadow pass via F.shadow.custom), a slight size gain and landing behaviour.

export const MAX_PARTICLES = 3000;

// layers
export const L_GROUND = 0, L_OVER = 1, L_GLOW = 2;

// draw kinds
const K_PUFF = 0, K_SPRITE = 1, K_LEAF = 2, K_RING = 3, K_GLOW = 4, K_BUTTERFLY = 5, K_BIRD = 6, K_SPARKLE = 7;

/**
 * Type table. Units: metres, seconds (real time), m/s.
 * life [min,max]; size [min,max] = diameter m; grow = size multiplier at end of life;
 * speed [min,max] along dir; spread = half-angle radians; vz [min,max]; z0 default height;
 * grav = downward accel; drag = 1/s; wind = fraction of wind velocity adopted;
 * alpha, fadeIn/fadeOut = fraction of life; land = rests on ground once z<=0; shadow = casts shadow.
 */
export const TYPES = {
  dust:      { kind: K_PUFF, layer: L_OVER, count: 6, life: [2.2, 3.6], size: [1.3, 2.0], grow: 2.3, speed: [0.5, 1.6], spread: Math.PI, vz: [0.2, 0.7], z0: 0.2, grav: 0, drag: 1.1, wind: 0.8, alpha: 0.75, fadeIn: 0.1, fadeOut: 0.55, color: '#a88b64', spin: 0.4 },
  exhaust:   { kind: K_PUFF, layer: L_OVER, count: 2, life: [1.4, 2.6], size: [0.4, 0.6], grow: 4.2, speed: [0.5, 1.2], spread: 0.5, vz: [1.0, 1.6], z0: 2.6, grav: 0, drag: 1.2, wind: 0.9, alpha: 0.62, fadeIn: 0.05, fadeOut: 0.75, color: '#555d69', spin: 0.6 },
  chimney:   { kind: K_PUFF, layer: L_OVER, count: 1, life: [4.5, 6.5], size: [0.9, 1.2], grow: 3.8, speed: [0.05, 0.25], spread: Math.PI, vz: [0.8, 1.2], z0: 7, grav: 0, drag: 0.35, wind: 1.0, alpha: 0.62, fadeIn: 0.06, fadeOut: 0.7, color: '#c4c2bc', spin: 0.25, shadow: 0.22 },
  steam:     { kind: K_PUFF, layer: L_OVER, count: 3, life: [1.4, 2.4], size: [0.35, 0.55], grow: 3.2, speed: [0.2, 0.6], spread: Math.PI, vz: [0.6, 1.0], z0: 1, grav: 0, drag: 0.8, wind: 0.8, alpha: 0.42, fadeIn: 0.1, fadeOut: 0.7, color: '#eef1ee', spin: 0.4 },
  snowpuff:  { kind: K_PUFF, layer: L_OVER, count: 6, life: [0.7, 1.3], size: [0.25, 0.45], grow: 2.6, speed: [0.8, 2.0], spread: Math.PI, vz: [0.5, 1.5], z0: 0.1, grav: 2.5, drag: 2.0, wind: 0.5, alpha: 0.8, fadeIn: 0.05, fadeOut: 0.6, color: '#f2f5f7', spin: 0.6 },
  spray:     { kind: K_PUFF, layer: L_OVER, count: 5, life: [0.8, 1.5], size: [0.5, 0.7], grow: 3.0, speed: [1.2, 2.4], spread: 0.45, vz: [-0.5, 0.2], z0: 1.2, grav: 0.4, drag: 1.6, wind: 1.1, alpha: 0.3, fadeIn: 0.05, fadeOut: 0.7, color: '#dbe7ec', spin: 0.3 },
  splash:    { kind: K_RING, layer: L_GROUND, count: 1, life: [0.25, 0.4], size: [0.3, 0.42], grow: 1.8, speed: [0, 0], spread: 0, vz: [0, 0], z0: 0, grav: 0, drag: 0, wind: 0, alpha: 0.85, fadeIn: 0, fadeOut: 0.7, crown: true },
  ripple:    { kind: K_RING, layer: L_GROUND, count: 1, life: [0.9, 1.5], size: [0.15, 0.25], grow: 5.0, speed: [0, 0], spread: 0, vz: [0, 0], z0: 0, grav: 0, drag: 0, wind: 0, alpha: 0.6, fadeIn: 0.05, fadeOut: 0.9 },
  leaves:    { kind: K_LEAF, layer: L_OVER, count: 4, life: [9, 16], size: [0.7, 0.9], grow: 1, speed: [0.2, 0.8], spread: Math.PI, vz: [-0.7, -0.4], z0: 5, grav: 0, drag: 1.2, wind: 0.9, alpha: 1, fadeIn: 0.03, fadeOut: 0.25, land: true, spin: 2.5 },
  petals:    { kind: K_LEAF, layer: L_OVER, count: 5, life: [6, 10], size: [0.22, 0.3], grow: 1, speed: [0.2, 0.8], spread: Math.PI, vz: [-0.5, -0.3], z0: 3, grav: 0, drag: 1.2, wind: 1.0, alpha: 1, fadeIn: 0.03, fadeOut: 0.3, land: true, spin: 3 },
  chaff:     { kind: K_SPRITE, layer: L_OVER, count: 8, life: [1.6, 3.0], size: [0.55, 0.75], grow: 1, speed: [1.0, 3.0], spread: 0.6, vz: [0.8, 2.2], z0: 1.5, grav: 1.6, drag: 1.1, wind: 1.0, alpha: 1, fadeIn: 0.03, fadeOut: 0.3, land: true, spin: 6 },
  clods:     { kind: K_SPRITE, layer: L_OVER, count: 5, life: [1.8, 3.2], size: [0.14, 0.26], grow: 1, speed: [0.8, 2.2], spread: 0.7, vz: [2.0, 3.8], z0: 0.3, grav: 9.8, drag: 0.2, wind: 0, alpha: 1, fadeIn: 0, fadeOut: 0.35, land: true, bounce: 0.28, spin: 5 },
  sparkle:   { kind: K_SPARKLE, layer: L_GLOW, count: 4, life: [0.5, 1.1], size: [0.3, 0.55], grow: 1, speed: [0, 0.2], spread: Math.PI, vz: [0, 0], z0: 0.3, grav: 0, drag: 1, wind: 0, alpha: 0.9, fadeIn: 0.3, fadeOut: 0.5 },
  fireflies: { kind: K_GLOW, layer: L_GLOW, count: 1, life: [8, 16], size: [0.9, 1.3], grow: 1, speed: [0.2, 0.5], spread: Math.PI, vz: [0, 0], z0: 0.8, grav: 0, drag: 0, wind: 0.15, alpha: 1, fadeIn: 0.15, fadeOut: 0.2, light: true },
  butterflies: { kind: K_BUTTERFLY, layer: L_OVER, count: 1, life: [18, 32], size: [0.62, 0.78], grow: 1, speed: [0.7, 1.3], spread: Math.PI, vz: [0, 0], z0: 1.0, grav: 0, drag: 0, wind: 0.2, alpha: 1, fadeIn: 0.05, fadeOut: 0.08, shadow: 1 },
  birds:     { kind: K_BIRD, layer: L_OVER, count: 7, life: [30, 40], size: [1.0, 1.25], grow: 1, speed: [9, 11], spread: 0, vz: [0, 0], z0: 24, grav: 0, drag: 0, wind: 0.1, alpha: 1, fadeIn: 0.03, fadeOut: 0.05, shadow: 1 },
};
export const TYPE_NAMES = Object.keys(TYPES);
const TYPE_LIST = TYPE_NAMES.map((n) => TYPES[n]);
export const TYPE_ID = Object.fromEntries(TYPE_NAMES.map((n, i) => [n, i]));

export function createParticles({ rng, sprites, season }) {
  const N = MAX_PARTICLES;
  const P = {
    n: 0,
    type: new Uint8Array(N), layer: new Uint8Array(N), flags: new Uint8Array(N),
    spr: new Uint16Array(N), spr2: new Uint16Array(N),
    x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
    vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
    age: new Float32Array(N), life: new Float32Array(N), size: new Float32Array(N),
    rot: new Float32Array(N), spin: new Float32Array(N), phase: new Float32Array(N),
    alpha: new Float32Array(N), grow: new Float32Array(N),
    tx: new Float32Array(N), ty: new Float32Array(N), // wander targets / flock heading
  };
  const FIELDS = ['type', 'layer', 'flags', 'spr', 'spr2', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 'size', 'rot', 'spin', 'phase', 'alpha', 'grow', 'tx', 'ty'];
  const ARR = FIELDS.map((f) => P[f]);
  const F_AMBIENT = 1, F_LANDED = 2, F_BOUNCED = 4;

  function kill(i) {
    const last = --P.n;
    if (i !== last) for (let k = 0; k < ARR.length; k++) ARR[k][i] = ARR[k][last];
  }

  function pickSprite(tname, t, color, v) {
    switch (tname) {
      case 'chaff': return sprites.chaff(v % 4);
      case 'clods': return sprites.clod(v % 3);
      case 'leaves': return sprites.leaf(season() === 'autumn' ? 'autumn' : season() === 'summer' ? 'summer' : season() === 'winter' ? 'autumn' : 'spring', v % 6);
      case 'petals': return sprites.petal(v % 4);
      case 'splash': return sprites.crown(v % 3);
      case 'ripple': return sprites.ring();
      case 'fireflies': return sprites.halo('#c8f06a');
      case 'sparkle': return color ? sprites.halo(color) : sprites.sparkle();
      case 'butterflies': return sprites.butterfly(v % sprites.BUTTERFLY_VARIANTS);
      case 'birds': return sprites.bird(0, false);
      default: return sprites.puff(color || t.color, v % 4);
    }
  }

  /**
   * Spawn count particles. o: { count, dirX, dirY, speed, spread, color, size, z, vz, life, ambient, variant, heading }
   * Returns number spawned.
   */
  function emit(tname, x, y, o) {
    const t = TYPES[tname];
    if (!t) return 0;
    o = o || {};
    const tid = TYPE_ID[tname];
    let count = o.count == null ? t.count : o.count | 0;
    count = Math.min(count, N - P.n);
    if (count <= 0) return 0;
    let dx = o.dirX, dy = o.dirY;
    const hasDir = dx != null || dy != null;
    dx = dx || 0; dy = dy || 0;
    const dl = Math.hypot(dx, dy);
    if (dl > 1e-6) { dx /= dl; dy /= dl; }
    const baseAng = Math.atan2(dy, dx);
    const spread = o.spread != null ? o.spread : (hasDir && dl > 1e-6 ? t.spread : Math.PI);
    const sizeMul = o.size != null ? o.size / ((t.size[0] + t.size[1]) / 2) : 1;
    for (let c = 0; c < count; c++) {
      const i = P.n++;
      const v = o.variant != null ? o.variant : rng.int(0, 11);
      P.type[i] = tid; P.layer[i] = t.layer;
      P.flags[i] = o.ambient ? F_AMBIENT : 0;
      P.spr[i] = pickSprite(tname, t, o.color, v);
      P.spr2[i] = v;
      const jitter = o.jitter != null ? o.jitter : (t.kind === K_PUFF ? 0.25 : 0.1);
      P.x[i] = x + rng.range(-jitter, jitter); P.y[i] = y + rng.range(-jitter, jitter);
      P.z[i] = (o.z != null ? o.z : t.z0) + rng.range(-0.1, 0.1) * (t.z0 > 0 ? 1 : 0);
      const sp = o.speed != null ? o.speed * rng.range(0.7, 1.3) : rng.range(t.speed[0], t.speed[1]);
      const a = (spread >= Math.PI ? rng.float() * Math.PI * 2 : baseAng + rng.range(-spread, spread));
      P.vx[i] = Math.cos(a) * sp; P.vy[i] = Math.sin(a) * sp;
      P.vz[i] = o.vz != null ? o.vz : rng.range(t.vz[0], t.vz[1]);
      P.age[i] = 0;
      P.life[i] = o.life != null ? o.life * rng.range(0.85, 1.15) : rng.range(t.life[0], t.life[1]);
      P.size[i] = rng.range(t.size[0], t.size[1]) * sizeMul;
      P.rot[i] = rng.float() * Math.PI * 2;
      P.spin[i] = (t.spin || 0) * rng.range(-1, 1);
      P.phase[i] = rng.float() * 100;
      P.alpha[i] = (o.alpha != null ? o.alpha : t.alpha) * rng.range(0.8, 1);
      P.grow[i] = t.grow;
      P.tx[i] = x; P.ty[i] = y;
      if (tname === 'birds') {
        // flock: loose V behind the leader along heading
        const hx = o.dirX != null ? dx : 1, hy = o.dirY != null ? dy : 0;
        const rank = c === 0 ? 0 : Math.ceil(c / 2), side = c % 2 ? 1 : -1;
        const px = -hy, py = hx;
        P.x[i] = x - hx * rank * 1.6 + px * side * rank * 1.4 + rng.range(-0.4, 0.4);
        P.y[i] = y - hy * rank * 1.6 + py * side * rank * 1.4 + rng.range(-0.4, 0.4);
        const bs = o.speed != null ? o.speed : 10;
        P.vx[i] = hx * bs; P.vy[i] = hy * bs;
        P.tx[i] = hx; P.ty[i] = hy;
        P.z[i] = (o.z != null ? o.z : t.z0) + rng.range(-1.5, 1.5);
        P.rot[i] = Math.atan2(hx, -hy);
      }
      if (tname === 'butterflies' || tname === 'fireflies') { P.tx[i] = x; P.ty[i] = y; }
    }
    return count;
  }

  /** advance all particles by dt real seconds; wind {x,y} m/s */
  function update(dt, wind, view, cullMargin) {
    const wx = wind.x, wy = wind.y;
    for (let i = P.n - 1; i >= 0; i--) {
      const age = (P.age[i] += dt);
      if (age >= P.life[i]) { kill(i); continue; }
      const t = TYPE_LIST[P.type[i]];
      const fl = P.flags[i];
      if ((fl & F_AMBIENT) && view && (P.x[i] < view.x0 - cullMargin || P.x[i] > view.x1 + cullMargin || P.y[i] < view.y0 - cullMargin || P.y[i] > view.y1 + cullMargin)) {
        if (t.kind !== K_BIRD) { kill(i); continue; }
      }
      if (fl & F_LANDED) { continue; }
      switch (t.kind) {
        case K_BUTTERFLY: {
          // erratic flutter around a slowly drifting target
          const ph = (P.phase[i] += dt);
          const ang = Math.sin(ph * 0.7 + P.spr2[i]) * 2.2 + Math.sin(ph * 2.3) * 0.9;
          const sp = 1.0;
          const tx = P.tx[i] + Math.cos(ph * 0.21 + i) * 2.5, ty = P.ty[i] + Math.sin(ph * 0.17 + i) * 2.5;
          const ax = (tx - P.x[i]) * 0.35 + Math.cos(ang + ph) * 2.2, ay = (ty - P.y[i]) * 0.35 + Math.sin(ang * 1.3 + ph) * 2.2;
          P.vx[i] += (ax - P.vx[i] * 0.9) * dt * 2.5; P.vy[i] += (ay - P.vy[i] * 0.9) * dt * 2.5;
          const vl = Math.hypot(P.vx[i], P.vy[i]);
          if (vl > sp * 1.6) { P.vx[i] *= sp * 1.6 / vl; P.vy[i] *= sp * 1.6 / vl; }
          P.x[i] += (P.vx[i] + wx * t.wind) * dt; P.y[i] += (P.vy[i] + wy * t.wind) * dt;
          P.z[i] = 0.9 + Math.sin(ph * 1.7 + i) * 0.45 + Math.sin(ph * 5.1) * 0.12;
          P.rot[i] = Math.atan2(P.vx[i], -P.vy[i]);
          continue;
        }
        case K_GLOW: {
          const ph = (P.phase[i] += dt);
          const ax = Math.sin(ph * 0.9 + i * 1.7) * 0.6 + (P.tx[i] - P.x[i]) * 0.05;
          const ay = Math.cos(ph * 0.7 + i * 2.3) * 0.6 + (P.ty[i] - P.y[i]) * 0.05;
          P.vx[i] += (ax - P.vx[i]) * dt; P.vy[i] += (ay - P.vy[i]) * dt;
          P.x[i] += (P.vx[i] + wx * t.wind) * dt; P.y[i] += (P.vy[i] + wy * t.wind) * dt;
          P.z[i] = 0.6 + Math.sin(ph * 0.5 + i) * 0.4;
          continue;
        }
        case K_BIRD: {
          const ph = (P.phase[i] += dt);
          // gentle collective wave + flap
          const s = Math.sin(ph * 0.4 + P.spr2[i] * 0.3) * 0.12;
          const hx = P.tx[i], hy = P.ty[i];
          const bs = Math.hypot(P.vx[i], P.vy[i]) || 10;
          const c = Math.cos(s), sn = Math.sin(s);
          const vx = (hx * c - hy * sn) * bs, vy = (hx * sn + hy * c) * bs;
          P.x[i] += (vx + wx * t.wind) * dt; P.y[i] += (vy + wy * t.wind) * dt;
          P.rot[i] = Math.atan2(vx, -vy);
          continue;
        }
        default: break;
      }
      // generic ballistic / drifting motion
      const dr = Math.exp(-t.drag * dt);
      const wk = t.wind;
      P.vx[i] = wx * wk + (P.vx[i] - wx * wk) * dr;
      P.vy[i] = wy * wk + (P.vy[i] - wy * wk) * dr;
      if (t.kind === K_LEAF) {
        // tumbling flutter: side-to-side sway, slow fall
        const ph = (P.phase[i] += dt * 2.2);
        P.x[i] += Math.cos(ph) * 0.9 * dt; P.y[i] += Math.sin(ph * 0.7) * 0.5 * dt;
      }
      P.vz[i] -= t.grav * dt;
      if (t.grav === 0 && t.kind === K_PUFF) P.vz[i] *= Math.exp(-0.5 * dt);
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      P.z[i] += P.vz[i] * dt;
      P.rot[i] += P.spin[i] * dt;
      if (P.z[i] <= 0 && (t.land || t.grav > 0)) {
        P.z[i] = 0;
        if (t.bounce && !(fl & F_BOUNCED) && P.vz[i] < -1.5) {
          P.vz[i] = -P.vz[i] * t.bounce; P.vx[i] *= 0.5; P.vy[i] *= 0.5; P.flags[i] |= F_BOUNCED;
        } else if (t.land) {
          P.flags[i] |= F_LANDED; P.layer[i] = L_GROUND;
          P.vx[i] = P.vy[i] = P.vz[i] = 0;
          // resting pieces linger: remaining life at least a few seconds
          const rest = t.kind === K_LEAF ? 6 : 1.8;
          if (P.life[i] - P.age[i] < rest) P.life[i] = P.age[i] + rest;
        } else { P.vz[i] = 0; }
      }
    }
  }

  function aliveCount(tname) {
    if (!tname) return P.n;
    const tid = TYPE_ID[tname];
    let c = 0;
    for (let i = 0; i < P.n; i++) if (P.type[i] === tid) c++;
    return c;
  }
  function clear(tname) {
    if (!tname) { P.n = 0; return; }
    const tid = TYPE_ID[tname];
    for (let i = P.n - 1; i >= 0; i--) if (P.type[i] === tid) kill(i);
  }

  function lifeAlpha(i, t) {
    const u = P.age[i] / P.life[i];
    let a = P.alpha[i];
    if (t.fadeIn > 0 && u < t.fadeIn) a *= u / t.fadeIn;
    const fo = 1 - t.fadeOut;
    if (u > fo) a *= (1 - u) / t.fadeOut;
    return a;
  }

  /** draw every particle of a layer. g has the world transform set. */
  function draw(g, view, layer, night) {
    if (!P.n) return 0;
    const m = g.getTransform();
    const Z = m.a, E = m.e, Fy = m.f;
    const list = sprites.list;
    let drawn = 0;
    const x0 = view.x0, x1 = view.x1, y0 = view.y0, y1 = view.y1;
    const additive = layer === L_GLOW;
    if (additive) g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < P.n; i++) {
      if (P.layer[i] !== layer) continue;
      const t = TYPE_LIST[P.type[i]];
      const x = P.x[i], y = P.y[i];
      let s = P.size[i];
      const u = P.age[i] / P.life[i];
      if (P.grow[i] !== 1) s *= 1 + (P.grow[i] - 1) * (1 - (1 - u) * (1 - u));
      s *= 1 + P.z[i] * 0.012; // subtle perspective gain with height
      if (x + s < x0 || x - s > x1 || y + s < y0 || y - s > y1) continue;
      let a = lifeAlpha(i, t);
      // big faint puffs cost the most fill and add little: cull them early
      if (a <= (t.kind === K_PUFF ? 0.06 : 0.01)) continue;
      let sx = s, sy = s;
      let img = list[P.spr[i]];
      let rot = P.rot[i];
      switch (t.kind) {
        case K_LEAF:
          if (!(P.flags[i] & F_LANDED)) sx = s * (0.25 + 0.75 * Math.abs(Math.cos(P.phase[i] * 1.3)));
          break;
        case K_BUTTERFLY: {
          const flap = Math.abs(Math.cos(P.phase[i] * 11 + i));
          sx = s * (0.18 + 0.82 * flap);
          break;
        }
        case K_BIRD: {
          const f = ((P.phase[i] * 5 + P.spr2[i] * 0.37) % 3 + 3) % 3;
          // glide most of the time, flap in bursts
          const flapping = Math.sin(P.phase[i] * 0.8 + P.spr2[i]) > -0.2;
          img = list[sprites.bird(flapping ? (f | 0) : 0, false)];
          break;
        }
        case K_GLOW: {
          // blink: slow pulse with occasional bright flash
          const ph = P.phase[i];
          const pulse = Math.max(0, Math.sin(ph * 1.9 + i * 0.7));
          a *= (0.3 + 0.7 * pulse * pulse) * night;
          rot = 0;
          if (a <= 0.02) continue;
          break;
        }
        case K_SPARKLE: {
          const tw = Math.abs(Math.sin(P.phase[i] + P.age[i] * 9));
          sx = sy = s * (0.5 + 0.5 * tw);
          rot = P.phase[i];
          break;
        }
        case K_RING:
          rot = 0; sy = s * 0.82;
          break;
        default: break;
      }
      const c = Math.cos(rot), sn = Math.sin(rot);
      g.globalAlpha = a > 1 ? 1 : a;
      g.setTransform(Z * c * sx, Z * sn * sx, -Z * sn * sy, Z * c * sy, E + Z * x, Fy + Z * y);
      g.drawImage(img, -0.5, -0.5, 1, 1);
      drawn++;
    }
    g.setTransform(m);
    g.globalAlpha = 1;
    if (additive) g.globalCompositeOperation = 'source-over';
    return drawn;
  }

  /** particle shadows into the core shadow buffer (called from F.shadow.custom) */
  function drawShadows(sg, sun, view) {
    const L = Math.min(8, Math.max(0, sun.shadowLen || 0));
    const dx = (sun.dirX || 0) * L, dy = (sun.dirY || 0) * L;
    const m = sg.getTransform();
    const Z = m.a, E = m.e, Fy = m.f;
    const list = sprites.list;
    const soft = list[sprites.softShadow()];
    for (let i = 0; i < P.n; i++) {
      const t = TYPE_LIST[P.type[i]];
      if (!t.shadow) continue;
      const z = P.z[i];
      const x = P.x[i] + dx * z, y = P.y[i] + dy * z;
      let s = P.size[i];
      if (x + 2 < view.x0 || x - 2 > view.x1 || y + 2 < view.y0 || y - 2 > view.y1) continue;
      const u = P.age[i] / P.life[i];
      let a = lifeAlpha(i, t);
      let img = soft, sx, sy, rot = 0;
      if (t.kind === K_BIRD) {
        img = list[sprites.bird(0, true)];
        sx = sy = s; rot = P.rot[i];
        a *= 0.8;
      } else if (t.kind === K_PUFF) {
        // only the older, larger puffs of a plume cast a (faint) shadow
        if (u < 0.3 || (i & 1)) continue;
        if (P.grow[i] !== 1) s *= 1 + (P.grow[i] - 1) * (1 - (1 - u) * (1 - u));
        sx = sy = s * 0.9;
        a *= t.shadow;
      } else if (t.kind === K_BUTTERFLY) {
        sx = s * 0.7; sy = s * 0.45; a *= 0.6;
      } else {
        sx = sy = s * 1.1; a *= 0.8;
      }
      if (a <= 0.01) continue;
      const c = Math.cos(rot), sn = Math.sin(rot);
      sg.globalAlpha = a > 1 ? 1 : a;
      sg.setTransform(Z * c * sx, Z * sn * sx, -Z * sn * sy, Z * c * sy, E + Z * x, Fy + Z * y);
      sg.drawImage(img, -0.5, -0.5, 1, 1);
    }
    sg.setTransform(m);
    sg.globalAlpha = 1;
  }

  /** submit firefly point lights (capped) */
  function lights(F, view, night, max) {
    if (night < 0.05) return;
    const tid = TYPE_ID.fireflies;
    let k = 0;
    for (let i = 0; i < P.n && k < max; i++) {
      if (P.type[i] !== tid) continue;
      const x = P.x[i], y = P.y[i];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      const pulse = Math.max(0, Math.sin(P.phase[i] * 1.9 + i * 0.7));
      const a = lifeAlpha(i, TYPES.fireflies) * pulse * pulse;
      if (a < 0.1) continue;
      F.light({ x, y, radius: 2.2, color: [200, 250, 120], intensity: 0.55 * a });
      k++;
    }
  }

  return { P, emit, update, draw, drawShadows, lights, count: aliveCount, clear, F_AMBIENT };
}
