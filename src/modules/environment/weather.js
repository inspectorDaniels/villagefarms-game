// Deterministic seasonal weather (Belgium-like maritime climate).
// A slow "pressure" noise over days drives regimes (high → clear/fog, low → rain/storm);
// each day is split into four 6-hour segments with their own kind + intensity.

import { clamp, lerp, smooth } from './sky.js';

export const KINDS = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog', 'snow'];

// month 0..11: mean daily min / max °C, rain bias (+ = wetter), storm propensity, fog propensity
const CLIMATE = [
  { tMin: 0.8, tMax: 5.8, wet: 0.10, storm: 0.00, fog: 0.35 },   // Jan
  { tMin: 0.6, tMax: 7.0, wet: 0.05, storm: 0.00, fog: 0.30 },   // Feb
  { tMin: 2.8, tMax: 10.8, wet: 0.02, storm: 0.02, fog: 0.22 },  // Mar
  { tMin: 4.8, tMax: 14.8, wet: -0.08, storm: 0.05, fog: 0.12 }, // Apr
  { tMin: 8.6, tMax: 18.4, wet: -0.04, storm: 0.15, fog: 0.08 }, // May
  { tMin: 11.4, tMax: 21.0, wet: -0.04, storm: 0.30, fog: 0.04 },// Jun
  { tMin: 13.5, tMax: 23.3, wet: -0.06, storm: 0.40, fog: 0.03 },// Jul
  { tMin: 13.2, tMax: 23.0, wet: -0.02, storm: 0.35, fog: 0.06 },// Aug
  { tMin: 10.8, tMax: 19.4, wet: 0.00, storm: 0.12, fog: 0.20 }, // Sep
  { tMin: 7.6, tMax: 15.2, wet: 0.08, storm: 0.04, fog: 0.35 },  // Oct
  { tMin: 4.2, tMax: 9.6, wet: 0.12, storm: 0.00, fog: 0.40 },   // Nov
  { tMin: 1.8, tMax: 6.4, wet: 0.14, storm: 0.00, fog: 0.35 },   // Dec
];

/** Continuous targets for a (kind, intensity) pair. */
export function targetsFor(kind, intensity = 0.6) {
  const i = clamp(intensity, 0, 1);
  switch (kind) {
    case 'clear': return { cloudCover: 0.04 + 0.1 * i, rain: 0, snow: 0, storm: 0, fog: 0, windMul: 0.8 };
    case 'cloudy': return { cloudCover: 0.24 + 0.24 * i, rain: 0, snow: 0, storm: 0, fog: 0, windMul: 1.0 };
    case 'overcast': return { cloudCover: 0.82 + 0.16 * i, rain: 0, snow: 0, storm: 0, fog: 0, windMul: 1.1 };
    case 'rain': return { cloudCover: 0.92 + 0.08 * i, rain: 0.25 + 0.75 * i, snow: 0, storm: 0, fog: 0.08 * i, windMul: 1.2 + 0.5 * i };
    case 'storm': return { cloudCover: 1, rain: 0.85 + 0.15 * i, snow: 0, storm: 0.6 + 0.4 * i, fog: 0.05, windMul: 2.4 + 0.8 * i };
    case 'fog': return { cloudCover: 0.6 + 0.3 * i, rain: 0, snow: 0, storm: 0, fog: 0.45 + 0.55 * i, windMul: 0.25 };
    case 'snow': return { cloudCover: 0.95, rain: 0, snow: 0.25 + 0.75 * i, storm: 0, fog: 0.12 * i, windMul: 0.9 + 0.4 * i };
    default: return targetsFor('clear', i);
  }
}

export class WeatherPlan {
  /** noise: Noise2D; rngFor(stream) → Rng; lunation unused here */
  constructor(noise, rngFor, daysPerMonth, daysPerYear) {
    this.noise = noise;
    this.rngFor = rngFor;
    this.dpm = daysPerMonth;
    this.dpy = daysPerYear;
    this.cache = new Map();
  }
  climate(absDay) { return CLIMATE[Math.floor((((absDay % this.dpy) + this.dpy) % this.dpy) / this.dpm) % 12]; }
  /** smooth climate: blend neighbouring months so temperatures don't step */
  climateSmooth(absDayF) {
    const doy = ((absDayF % this.dpy) + this.dpy) % this.dpy;
    const mf = doy / this.dpm - 0.5;
    const m0 = Math.floor(mf), t = mf - m0;
    const a = CLIMATE[((m0 % 12) + 12) % 12], b = CLIMATE[(((m0 + 1) % 12) + 12) % 12];
    const o = {};
    for (const k of Object.keys(a)) o[k] = lerp(a[k], b[k], t);
    return o;
  }
  pressure(absDayF) {
    // slow regime (several days) + faster fronts, roughly [-1, 1]
    return 0.7 * this.noise.fbm(absDayF * 0.33, 3.7, 2) + 0.45 * this.noise.at(absDayF * 1.3, 11.2);
  }

  /** plan for one absolute day: { day, segs:[{kind,intensity}×4], tempMin, tempMax, rainMm, wind:{dir, base} } */
  day(absDay) {
    let p = this.cache.get(absDay);
    if (p) return p;
    const rng = this.rngFor('day:' + absDay);
    const cl = this.climateSmooth(absDay + 0.5);
    const anomaly = this.noise.fbm(absDay * 0.21, 42.5, 2) * 3.2;
    let tMin = cl.tMin + anomaly + rng.range(-1, 1);
    let tMax = cl.tMax + anomaly + rng.range(-1.2, 1.2);
    const segs = [];
    let rainMm = 0;
    // prevailing south-westerly (wind blowing toward NE), veering with the pressure systems
    const dirDeg = 45 + this.noise.at(absDay * 0.4, 77.7) * 70 + rng.range(-12, 12); // direction the wind blows TO, from north clockwise
    const p0 = this.pressure(absDay + 0.5);
    const baseWind = clamp(3.2 - p0 * 2.2 + rng.range(-0.8, 0.8), 0.8, 7);
    for (let s = 0; s < 4; s++) {
      const r = this.rngFor('seg:' + absDay + ':' + s);
      const pr = this.pressure(absDay + (s + 0.5) / 4) - cl.wet;
      let kind, intensity;
      if (pr > 0.42) { kind = 'clear'; intensity = r.float(); }
      else if (pr > 0.12) { kind = 'cloudy'; intensity = clamp((0.42 - pr) / 0.3, 0, 1); }
      else if (pr > -0.12) { kind = 'overcast'; intensity = clamp((0.12 - pr) / 0.24, 0, 1); }
      else { kind = 'rain'; intensity = clamp(0.2 + (-0.12 - pr) * 1.3, 0.2, 1); }
      // convective storms: warm afternoons in unsettled weather
      if ((kind === 'rain' || kind === 'overcast') && s === 2 && tMax > 18 && r.chance(cl.storm * (kind === 'rain' ? 1.6 : 0.6))) {
        kind = 'storm'; intensity = r.range(0.5, 1);
      }
      // radiation fog: calm high-pressure nights / mornings in the cold half of the year
      if ((s === 0 || s === 1) && pr > 0.05 && baseWind < 3.4 && r.chance(cl.fog * (s === 0 ? 1.3 : 0.9))) {
        kind = 'fog'; intensity = r.range(0.45, 1);
      }
      // precipitation turns to snow when it's cold
      const segTemp = s === 0 ? tMin : s === 2 ? tMax : (tMin + tMax) / 2;
      if (kind === 'rain' && segTemp < 1.8) kind = 'snow';
      if (kind === 'rain') rainMm += intensity * 1.6 * 6;
      if (kind === 'storm') rainMm += intensity * 5 * 6 * 0.4;
      if (kind === 'snow') rainMm += intensity * 0.9 * 6;
      segs.push({ kind, intensity: +intensity.toFixed(3) });
    }
    // cloudy days have a smaller temperature range, clear days a larger one
    const cloudiness = segs.reduce((a, s) => a + targetsFor(s.kind, s.intensity).cloudCover, 0) / 4;
    const mid = (tMin + tMax) / 2, half = Math.max(1.5, (tMax - tMin) / 2) * lerp(1.25, 0.6, cloudiness);
    tMin = mid - half; tMax = mid + half;
    const snowy = segs.some((s) => s.kind === 'snow');
    if (snowy) { tMax = Math.min(tMax, 1.6); tMin = Math.min(tMin, tMax - 3); }
    p = {
      day: absDay, segs,
      tempMin: +tMin.toFixed(1), tempMax: +tMax.toFixed(1), rainMm: +rainMm.toFixed(1),
      wind: { dirDeg, base: +baseWind.toFixed(2) },
    };
    p.kind = dominantKind(segs);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(absDay, p);
    return p;
  }

  /** {kind, intensity} active at a given absolute day + hour */
  at(absDay, tod) {
    const d = this.day(absDay);
    return d.segs[clamp(Math.floor(tod / 6), 0, 3)];
  }

  /** air temperature (°C) at a given time, diurnal curve min at sunrise-ish, max at ~15:00 */
  temperature(absDay, tod) {
    const d = this.day(absDay);
    if (tod < 6) return lerp(this.day(absDay - 1).tempMax, d.tempMin, smooth(15, 30, tod + 24));
    if (tod < 15) return lerp(d.tempMin, d.tempMax, smooth(6, 15, tod));
    return lerp(d.tempMax, this.day(absDay + 1).tempMin, smooth(15, 30, tod));
  }
}

const SEVERITY = { clear: 0, cloudy: 1, overcast: 2, fog: 3, rain: 4, snow: 5, storm: 6 };
function dominantKind(segs) {
  // daytime segments dominate the headline; the most severe wins if it lasts
  let best = segs[1].kind, bestScore = -1;
  const counts = {};
  for (let i = 1; i < 4; i++) counts[segs[i].kind] = (counts[segs[i].kind] || 0) + 1;
  for (const [k, n] of Object.entries(counts)) {
    const score = n * 2 + SEVERITY[k] * 0.7;
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}
