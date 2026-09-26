// Pure sky/light maths: solar geometry (NOAA approximations), a simple moon, and the
// colour model for ambient light, direct sunlight and sky tint. No DOM, no state.

const DEG = Math.PI / 180;
export const LATITUDE_DEG = 51;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lum = (c) => (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);

/**
 * Sun position for latitude `latDeg`, astronomical year fraction `yearFrac` (0 = 1 Jan) and
 * local mean solar time `tod` in hours (clock 12:00 ≈ solar noon, corrected by the equation of time).
 * Returns { elevation, azimuth, declination } in radians; azimuth from north, clockwise.
 * Elevation includes atmospheric refraction near the horizon (apparent elevation).
 */
export function solarPosition(yearFrac, tod, latDeg = LATITUDE_DEG) {
  const gamma = 2 * Math.PI * (yearFrac * 365.2422 + (tod - 12) / 24) / 365.2422;
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const eqtMin = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const tst = tod + eqtMin / 60;                 // true (apparent) solar time, hours
  return horizontal(decl, (tst - 12) * 15 * DEG, latDeg * DEG);
}

/** equatorial → horizontal. ha = hour angle (rad, + afternoon), lat rad */
export function horizontal(decl, ha, lat) {
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  let el = Math.asin(clamp(sinEl, -1, 1));
  const east = -Math.cos(decl) * Math.sin(ha);
  const north = Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(ha);
  let az = Math.atan2(east, north);
  if (az < 0) az += Math.PI * 2;
  // refraction (Saemundsson), degrees → only matters within a few degrees of the horizon
  const h = el / DEG;
  if (h > -1.5) {
    const hh = Math.max(h, -0.9);
    el += (1.02 / Math.tan((hh + 10.3 / (hh + 5.11)) * DEG)) / 60 * DEG;
  }
  return { elevation: el, azimuth: az, declination: decl };
}

/**
 * Moon: a compact model good enough for night light. One lunation per game month
 * (`lunationDays` game days). phase 0 = new, 0.5 = full. The moon trails the sun by
 * phase × 24 h of hour angle and sits at roughly the opposite declination when full.
 */
export function moonPosition(absDayFloat, yearFrac, tod, sunDecl, lunationDays, latDeg = LATITUDE_DEG) {
  const phase = ((absDayFloat / lunationDays) % 1 + 1) % 1;
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;           // 0 new … 1 full
  const decl = -sunDecl * Math.cos(phase * 2 * Math.PI) + 5.1 * DEG * Math.sin(absDayFloat * 0.9);
  const ha = ((tod - 12) / 24 - phase) * 2 * Math.PI;
  const p = horizontal(decl, ha, latDeg * DEG);
  return { ...p, phase, illumination: illum };
}

/** shadow direction (unit, world x east / y south) for a light at azimuth `az` */
export function shadowDir(az) { return { x: -Math.sin(az), y: Math.cos(az) }; }

// ---------- colour model ----------
// Ambient (multiply) colour of a clear sky by solar elevation in degrees. Dusk ≠ dawn slightly.
const AMB_KEYS = [
  [-18, [34, 44, 88]],
  [-12, [42, 52, 100]],
  [-8, [66, 74, 132]],
  [-5, [104, 106, 166]],
  [-2.5, [164, 128, 160]],
  [0, [236, 164, 132]],
  [3, [252, 186, 136]],
  [7, [255, 210, 164]],
  [12, [255, 230, 196]],
  [20, [255, 243, 224]],
  [35, [255, 251, 242]],
  [60, [255, 255, 250]],
];
function keyed(keys, x) {
  if (x <= keys[0][0]) return keys[0][1].slice();
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, c0] = keys[i - 1], [x1, c1] = keys[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
      return mix3(c0, c1, s);
    }
  }
  return keys[keys.length - 1][1].slice();
}

const SUN_KEYS = [
  [-2, [255, 120, 70]], [0, [255, 140, 82]], [4, [255, 178, 118]], [10, [255, 212, 160]],
  [20, [255, 234, 200]], [40, [255, 246, 228]], [70, [255, 250, 240]],
];
const SKY_KEYS = [
  [-18, [16, 22, 44]], [-10, [30, 40, 78]], [-5, [70, 76, 128]], [-2, [168, 120, 140]],
  [0, [238, 150, 110]], [4, [240, 190, 150]], [10, [170, 196, 222]], [25, [132, 176, 222]], [60, [112, 164, 222]],
];

export function clearAmbient(elevDeg, rising) {
  const c = keyed(AMB_KEYS, elevDeg);
  if (rising && elevDeg < 15 && elevDeg > -14) {           // dawn: a touch cooler / pinker
    const k = 1 - Math.abs(elevDeg) / 15;
    c[0] -= 10 * k; c[1] -= 4 * k; c[2] += 10 * k;
  }
  return c;
}
export function sunColor(elevDeg) { return keyed(SUN_KEYS, elevDeg); }
export function skyColor(elevDeg) { return keyed(SKY_KEYS, elevDeg); }

/**
 * Full ambient model. w = weather state { cloudCover, rain, storm, fog, snow, snowCover }.
 * moon = { elevation, illumination }. Returns [r,g,b] 0..255.
 */
export function ambientFor(elevDeg, rising, w, moon) {
  let c = clearAmbient(elevDeg, rising);
  // moonlight lifts the night a little (cool, silvery)
  if (moon && elevDeg < -4) {
    const m = moon.illumination * smooth(-2, 25, moon.elevation / DEG) * smooth(-4, -12, elevDeg) * (1 - 0.8 * w.cloudCover);
    c = [c[0] + 18 * m, c[1] + 24 * m, c[2] + 34 * m];
  }
  const cc = w.cloudCover;
  // overcast light: flatter, cooler grey of the same brightness, then dimmer
  const L = lum(c);
  const grey = [L * 0.93, L * 0.97, L * 1.03];
  c = mix3(c, grey, cc * 0.72);
  const dim = 1 - 0.14 * cc - 0.12 * w.rain - 0.22 * w.storm;
  c = [c[0] * dim, c[1] * dim, c[2] * dim];
  // fog: milky, low contrast
  if (w.fog > 0) {
    const L2 = lum(c);
    c = mix3(c, [L2 * 0.98 + 8, L2 * 1.0 + 8, L2 * 1.02 + 8], w.fog * 0.55);
  }
  // snow on the ground bounces light back up: brighter, cooler
  if (w.snowCover > 0) {
    const k = w.snowCover * smooth(-6, 6, elevDeg);
    c = [c[0] * (1 + 0.02 * k), c[1] * (1 + 0.04 * k), c[2] * (1 + 0.1 * k)];
  }
  // gameplay floor: even a rainy new-moon night keeps shapes readable
  c = [Math.max(c[0], 32), Math.max(c[1], 40), Math.max(c[2], 76)];
  return c.map((v) => clamp(Math.round(v), 0, 255));
}
