// Seeded 2D gradient (Perlin-style) noise + fbm. Output of at() is roughly [-1, 1].
import { Rng } from './rng.js';

const GRADS = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  GRADS.push([Math.cos(a), Math.sin(a)]);
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

export class Noise2D {
  constructor(seed) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    rng.shuffle(p);
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  _grad(ix, iy, x, y) {
    const g = GRADS[this.perm[(ix + this.perm[iy & 255]) & 511] & 15];
    return g[0] * x + g[1] * y;
  }
  /** gradient noise in about [-1,1] */
  at(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const u = fade(fx), v = fade(fy);
    const n00 = this._grad(x0, y0, fx, fy);
    const n10 = this._grad(x0 + 1, y0, fx - 1, fy);
    const n01 = this._grad(x0, y0 + 1, fx, fy - 1);
    const n11 = this._grad(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return (a + v * (b - a)) * 1.414;
  }
  /** fractal sum, normalised to about [-1,1] */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * freq + i * 17.13, y * freq - i * 9.71);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  /** ridged fbm in [0,1] */
  ridged(x, y, octaves = 4) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(this.at(x * freq, y * freq)));
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
}
