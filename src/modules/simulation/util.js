// Local copy of core/rng.js (hashString + Rng), byte-for-byte the same algorithm, so the pure
// simulation can run under plain Node (tests/progression.mjs) without importing src/core
// (which Node 14 would treat as CommonJS). createRng(seed, 'simulation', name) here yields the
// same stream as ctx.rng(name) in the game.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.seed = seed >>> 0; this._next = mulberry32(this.seed); }
  float() { return this._next(); }
  range(a, b) { return a + (b - a) * this._next(); }
  int(a, b) { return a + Math.floor(this._next() * (b - a + 1)); }
  chance(p) { return this._next() < p; }
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  weighted(items) {
    let total = 0;
    for (const it of items) total += it[1];
    let r = this._next() * total;
    for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  gauss(mean = 0, sd = 1) {
    let u = 0;
    while (u === 0) u = this._next();
    const v = this._next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this._next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  fork(name) { return new Rng(hashString(this.seed + ':' + name)); }
}

export function createRng(...parts) { return new Rng(hashString(parts.join(':'))); }
