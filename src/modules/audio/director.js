// Ambience director: pure functions mapping (time, season, weather, water proximity) → layer levels 0..1.
import { clamp } from './synth.js';

const LAT = 51 * Math.PI / 180;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bell = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));

/** approximate sunrise/sunset (solar hours) at 51°N for a year fraction (0 = 1 Jan) */
export function sunTimes(yearFrac) {
  const decl = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (yearFrac + 10 / 365));
  const cosH = clamp(-Math.tan(LAT) * Math.tan(decl), -1, 1);
  const H = Math.acos(cosH) * 12 / Math.PI;
  return { rise: 12 - H, set: 12 + H };
}

export const SEASON_BIRDS = { spring: 1, summer: 0.8, autumn: 0.45, winter: 0.28 };
export const SEASON_CRICKETS = { spring: 0.3, summer: 1, autumn: 0.45, winter: 0 };
export const SEASON_OWL = { spring: 0.5, summer: 0.4, autumn: 0.85, winter: 0.7 };

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
/**
 * Normalised weather view. Prefers environment's eased continuous values (rain/storm/snow/fog 0..1),
 * falling back to the discrete kind only when those are absent.
 */
export function readWeather(w) {
  w = w || {};
  const kind = typeof w.kind === 'string' ? w.kind : 'clear';
  const intensity = fin(w.intensity) ? clamp(w.intensity, 0, 1) : 0.6;
  const rain = fin(w.rain) ? clamp(w.rain, 0, 1) : (kind === 'rain' || kind === 'storm' ? intensity : 0);
  const storm = fin(w.storm) ? clamp(w.storm, 0, 1) : (kind === 'storm' ? Math.max(0.5, intensity) : 0);
  const snow = fin(w.snow) ? clamp(w.snow, 0, 1) : (kind === 'snow' ? Math.max(0.5, intensity) : 0);
  const fog = fin(w.fog) ? clamp(w.fog, 0, 1) : (kind === 'fog' ? Math.max(0.5, intensity) : 0);
  const cloud = fin(w.cloudCover) ? clamp(w.cloudCover, 0, 1) : (kind === 'overcast' ? 0.9 : kind === 'cloudy' ? 0.6 : kind === 'clear' ? 0.15 : 0.8);
  const speed = w.wind && fin(w.wind.speed) ? Math.max(0, w.wind.speed) : 2 + 11 * storm + 3 * rain;
  const temp = fin(w.temperature) ? w.temperature : null;
  return { kind, rain, storm, snow, fog, cloud, windSpeed: speed, temp };
}

/**
 * Level targets for every ambience layer.
 * h = time of day (0..24), season, yearFrac, weather (readWeather output), water 0..1 proximity.
 */
export function ambienceLevels(h, season, yearFrac, W, water = 0) {
  const { rise, set } = sunTimes(yearFrac);
  const day = smooth(rise - 0.4, rise + 0.3, h) * (1 - smooth(set - 0.2, set + 0.5, h));
  const night = 1 - smooth(rise - 1.2, rise - 0.2, h) * (1 - smooth(set + 0.2, set + 1.2, h));
  const wetK = 1 - 0.85 * W.rain;
  const windK = 1 - 0.6 * smooth(8, 16, W.windSpeed);
  let temp = 1;
  if (W.temp != null) temp = smooth(9, 17, W.temp);
  const snowK = 1 - 0.6 * W.snow;
  const cloudK = 1 - 0.3 * smooth(0.5, 1, W.cloud);

  const chorus = bell(h, rise + 0.45, 0.75);
  const dusk = bell(h, set - 0.4, 0.55);
  const birds = clamp((SEASON_BIRDS[season] || 0.5) * (chorus * 1.0 + day * 0.32 + dusk * 0.35) * wetK * windK * snowK * cloudK, 0, 1);
  const crickets = clamp((SEASON_CRICKETS[season] || 0) * night * (1 - W.rain) * (1 - W.rain) * windK * (W.temp != null ? temp : 1) * (1 - W.snow), 0, 1);
  const owl = clamp((SEASON_OWL[season] || 0.5) * night * bell(h < 12 ? h + 24 : h, 23.5, 2.2) * (1 - 0.8 * W.rain) * windK, 0, 1);
  // no permanent floor: calm air is near-silent; a mild daytime swing (thermals) on light winds
  const wind = clamp(Math.pow(clamp((W.windSpeed - 0.8) / 13, 0, 1), 1.15) * (0.8 + 0.2 * day) + 0.35 * W.storm, 0, 1);
  const rain = W.rain;
  const music = clamp(0.6 * (bell(h, 7.5, 1.1) + bell(h, 19.5, 1.1)) * (1 - 0.5 * W.rain), 0, 0.6);
  const river = clamp(water, 0, 1);
  return { birds, crickets, owl, wind, rain, river, music, sunrise: rise, sunset: set, day };
}

/** muffling lowpass for the ambience bus (fog/snow absorb highs) — continuous in both */
export function muffleCutoff(W) {
  const k = clamp(W.snow * 0.85 + W.fog * 0.55, 0, 1);
  return 18000 * Math.pow(2600 / 18000, k);
}
