// environment — sun & moon (real solar geometry at 51°N), ambient light, sky tint,
// seasonal weather (clear/cloudy/overcast/rain/storm/fog/snow), wind, cloud shadows,
// precipitation & fog rendering and the screen grade. Drives the core shadow + lighting passes
// through world.environment.
import { DAY_SECONDS, MONTH_DAYS, YEAR_DAYS } from '../../core/world.js';
import {
  solarPosition, moonPosition, shadowDir, ambientFor, sunColor, skyColor, clamp, lerp, smooth, mix3,
} from './sky.js';
import { WeatherPlan, targetsFor, KINDS } from './weather.js';
import { createFx } from './fx.js';
import { stageShowcase, SHOWCASE_PRESETS } from './showcase.js';

const DEG = Math.PI / 180;
const LUNATION_DAYS = MONTH_DAYS;      // one lunation per game month
const LUNAR_OFFSET = 2.58;             // days; puts a full moon on the showcase night
const TRANSITION_S = 1500;             // game seconds time-constant for weather blending
const NIGHT_DAYLIGHT = 0.3;

export const manifest = {
  id: 'environment',
  wave: 1,
  deps: [],
  optionalDeps: [],
  namespaces: ['environment'],
  api: ['getSun', 'getMoon', 'getWeather', 'setWeather', 'forecast', 'windAt', 'isNight', 'lightLevel'],
  emits: ['env:weather-changed', 'env:dawn', 'env:dusk', 'env:lightning'],
  listens: ['clock:day'],
};

export async function init(ctx) {
  const { world, clock } = ctx;
  const params = ctx.params;
  const env = world.environment;
  const plan = new WeatherPlan(ctx.noise('weather'), (s) => ctx.rng(s), MONTH_DAYS, YEAR_DAYS);
  const gustNoise = ctx.noise('gusts');
  const fx = createFx(ctx);
  fx.ensureFields();                     // bake the cloud/fog noise field at load, not in the first frame
  const flashRng = ctx.rng('lightning');

  // live continuous weather parameters (blended toward targets)
  const cur = { cloudCover: 0.2, rain: 0, snow: 0, storm: 0, fog: 0, windMul: 1 };
  const wind = { x: 1.5, y: -1.5, speed: 2.1, dirDeg: 45 };
  let forced = null;                     // { kind, intensity }
  let kind = 'clear', intensity = 0.5;
  let wetness = 0, snowCover = 0;
  let windT = 0;                          // fixed-step accumulated real seconds (gust advection)
  let drift = { x: 0, y: 0 };             // cloud / fog drift, metres (cosmetic, frame time)
  let prevSunUp = null;
  let baseAmbient = [255, 255, 255];
  const flash = { level: 0, t: 0, next: 6 + flashRng.float() * 6, at: { x: 0.5, y: 0.2 }, pulses: [] };

  env.sun = { azimuth: Math.PI, elevation: 0.9, dirX: 0, dirY: -1, shadowLen: 0.8, shadowStrength: 0.4, color: [255, 250, 240], source: 'sun' };
  env.moon = { azimuth: 0, elevation: -1, phase: 0, illumination: 0 };
  env.ambient = [255, 255, 255];
  env.daylight = 1;
  env.sky = [132, 176, 222];
  env.weather = { kind, intensity, cloudCover: 0.2, wetness: 0, snowCover: 0, fog: 0, rain: 0, snow: 0, storm: 0, precipitation: 0, wind: { x: 1.5, y: -1.5, speed: 2.1 }, temperature: 10 };
  env.forecast = [];
  env.golden = 0;

  const absDayF = () => clock.t / DAY_SECONDS;

  function targetState() {
    const d = clock.day, tod = clock.timeOfDay;
    const seg = forced || plan.at(d, tod);
    return { kind: seg.kind, intensity: seg.intensity, t: targetsFor(seg.kind, seg.intensity), day: plan.day(d) };
  }

  function windTarget(dayPlan, mul) {
    const dir = dayPlan.wind.dirDeg * DEG;
    const speed = dayPlan.wind.base * mul;
    return { x: Math.sin(dir) * speed, y: -Math.cos(dir) * speed, speed, dirDeg: dayPlan.wind.dirDeg };
  }

  function temperatureNow() {
    let t = plan.temperature(clock.day, clock.timeOfDay);
    if (forced) {
      if (forced.kind === 'snow') t = Math.min(t, -1.5 + 0.5 * Math.sin(clock.timeOfDay / 24 * 6.28));
      else if (t < 2 && (forced.kind === 'rain' || forced.kind === 'storm')) t = 3.5;
      if (forced.kind === 'storm') t = Math.max(t, 17);
    }
    return t;
  }

  /** ground wetness / snow cover integration over gameDt seconds */
  function integrateGround(p, temp, sunF, gameDt) {
    const h = gameDt / 3600;
    if (p.rain > 0.03) wetness += h * (0.6 + 2.4 * p.rain);
    else {
      const dry = (0.1 + 0.55 * sunF * (1 - p.cloudCover)) * (1 + Math.max(0, temp) / 14) * (1 - 0.8 * p.fog);
      wetness -= h * dry * 0.35;
      if (p.fog > 0.3) wetness = Math.max(wetness, Math.min(0.3, wetness + h * 0.2 * p.fog)); // dew
    }
    if (p.snow > 0.03 && temp < 1.8) snowCover += h * (0.25 + 0.9 * p.snow);
    else if (temp > 0.5 || p.rain > 0.05) {
      const melt = Math.min(snowCover, h * (Math.max(0, temp - 0.5) * 0.05 + p.rain * 0.25 + 0.4 * sunF * (1 - p.cloudCover) * (temp > 0 ? 1 : 0)));
      snowCover -= melt;
      wetness += melt * 0.8;
    }
    wetness = clamp(wetness, 0, 1);
    snowCover = clamp(snowCover, 0, 1);
  }

  /** warm up ground state by replaying `hours` of weather in 10-minute steps (deterministic) */
  function warmUp(hours, useForced) {
    const t1 = clock.t;
    const steps = Math.round(hours * 6);
    for (let i = steps; i > 0; i--) {
      const t = t1 - i * 600;
      const d = Math.floor(t / DAY_SECONDS), tod = (t - d * DAY_SECONDS) / 3600;
      const seg = useForced && forced ? forced : plan.at(d, tod);
      const p = targetsFor(seg.kind, seg.intensity);
      const sp = solarPosition((t / DAY_SECONDS % YEAR_DAYS) / YEAR_DAYS, tod);
      let temp = plan.temperature(d, tod);
      if (useForced && forced && forced.kind === 'snow') temp = Math.min(temp, -1.5);
      integrateGround(p, temp, clamp(Math.sin(sp.elevation) * 1.5, 0, 1), 600);
    }
  }

  function snapWeather() {
    const ts = targetState();
    Object.assign(cur, ts.t);
    kind = ts.kind; intensity = ts.intensity;
    const wt = windTarget(ts.day, cur.windMul);
    Object.assign(wind, wt);
  }

  function computeLight() {
    const yf = clock.yearFrac, tod = clock.timeOfDay;
    const sp = solarPosition(yf, tod);
    const mp = moonPosition(absDayF() + LUNAR_OFFSET, yf, tod, sp.declination, LUNATION_DAYS);
    const elevDeg = sp.elevation / DEG;
    const rising = tod < 12;
    const w = { cloudCover: cur.cloudCover, rain: cur.rain, storm: cur.storm, fog: cur.fog, snow: cur.snow, snowCover };
    baseAmbient = ambientFor(elevDeg, rising, w, mp);

    // which light casts the shadows: sun by day, the moon on clear moonlit nights
    const sunStrength = 0.45 * smooth(-1, 5.5, elevDeg) * (1 - 0.85 * cur.cloudCover) * (1 - 0.7 * cur.fog) * (1 - 0.6 * Math.max(cur.rain, cur.snow));
    const moonStrength = 0.17 * mp.illumination * smooth(3, 22, mp.elevation / DEG) * smooth(-5, -12, elevDeg) * (1 - 0.9 * cur.cloudCover) * (1 - 0.8 * cur.fog);
    const useMoon = moonStrength > sunStrength;
    const src = useMoon ? mp : sp;
    const dir = shadowDir(src.azimuth);
    const el = Math.max(src.elevation, 0.02);
    const S = env.sun;
    S.azimuth = sp.azimuth;
    S.elevation = sp.elevation;
    S.dirX = dir.x; S.dirY = dir.y;
    S.shadowLen = Math.min(8, 1 / Math.tan(el));
    S.shadowStrength = +Math.max(sunStrength, moonStrength).toFixed(4);
    S.color = useMoon ? [176, 194, 232] : sunColor(elevDeg).map(Math.round);
    S.source = useMoon ? 'moon' : 'sun';
    const M = env.moon;
    M.azimuth = mp.azimuth; M.elevation = mp.elevation; M.phase = +mp.phase.toFixed(3); M.illumination = +mp.illumination.toFixed(3);

    env.daylight = +smooth(-9, 5, elevDeg).toFixed(4);
    const sky = skyColor(elevDeg);
    const L = (sky[0] + sky[1] + sky[2]) / 3;
    env.sky = mix3(sky, [L * 0.95 + 20, L * 0.98 + 20, L + 22], cur.cloudCover * 0.8).map((v) => clamp(Math.round(v), 0, 255));
    env.golden = +(smooth(16, 3, elevDeg) * smooth(-4, 1.5, elevDeg) * (1 - 0.75 * cur.cloudCover) * (1 - 0.6 * cur.fog)).toFixed(3);

    // dawn / dusk events on the geometric horizon
    const up = elevDeg > -0.833;
    if (prevSunUp !== null && up !== prevSunUp) ctx.events.emit(up ? 'env:dawn' : 'env:dusk', { day: clock.day, time: clock.format() });
    prevSunUp = up;
    return sp;
  }

  function publishWeather(temp) {
    const W = env.weather;
    W.kind = kind; W.intensity = +intensity.toFixed(3);
    W.cloudCover = +cur.cloudCover.toFixed(3);
    W.rain = +cur.rain.toFixed(3); W.snow = +cur.snow.toFixed(3); W.storm = +cur.storm.toFixed(3);
    W.precipitation = +Math.max(cur.rain, cur.snow).toFixed(3);
    W.fog = +cur.fog.toFixed(3);
    W.wetness = +wetness.toFixed(3); W.snowCover = +snowCover.toFixed(3);
    W.wind.x = +wind.x.toFixed(3); W.wind.y = +wind.y.toFixed(3); W.wind.speed = +wind.speed.toFixed(2);
    W.temperature = +temp.toFixed(1);
    W.forced = !!forced;
  }

  function refreshForecast() {
    const out = [];
    for (let i = 1; i <= 5; i++) {
      const p = plan.day(clock.day + i);
      out.push({ day: p.day, kind: p.kind, tempMin: p.tempMin, tempMax: p.tempMax, rainMm: p.rainMm });
    }
    env.forecast = out;
  }

  function setKind(k, i) {
    if (k !== kind) {
      const prev = kind;
      kind = k; intensity = i;
      ctx.events.emit('env:weather-changed', { kind: k, intensity: i, prev });
    } else intensity = i;
  }

  /** clock jumped (time/day set, load): rebuild weather + ground state for the new moment */
  function resync() {
    wetness = 0; snowCover = 0;
    const f = forced;
    forced = null;
    snapWeather();
    warmUp(12, false);
    forced = f;
    if (forced) { snapWeather(); warmUp(3, true); }
    refreshForecast();
  }
  let lastT = clock.t;

  function update(dt) {
    if (Math.abs(clock.t - lastT) > 3600) resync();
    lastT = clock.t;
    const gameDt = dt * clock.rate;
    windT += dt;
    const ts = targetState();
    setKind(ts.kind, ts.intensity);
    if (gameDt > 0) {
      const k = 1 - Math.exp(-gameDt / TRANSITION_S);
      for (const key of Object.keys(cur)) cur[key] += (ts.t[key] - cur[key]) * k;
      const wt = windTarget(ts.day, cur.windMul);
      const kw = 1 - Math.exp(-gameDt / 900);
      wind.x += (wt.x - wind.x) * kw; wind.y += (wt.y - wind.y) * kw;
      wind.speed = Math.hypot(wind.x, wind.y);
    }
    const sp = computeLight();
    const temp = temperatureNow();
    if (gameDt > 0) integrateGround(cur, temp, clamp(Math.sin(sp.elevation) * 1.5, 0, 1), gameDt);
    publishWeather(temp);
    env.ambient = flash.level > 0.01 ? applyFlash(baseAmbient) : baseAmbient;
  }

  function applyFlash(a) {
    return mix3(a, [236, 240, 255], clamp(flash.level, 0, 1) * 0.85).map(Math.round);
  }

  function frame(dt) {
    // cloud & fog drift: clouds ride faster upper winds; cosmetic, real time
    const k = 0.9;
    drift.x += wind.x * k * dt; drift.y += wind.y * k * dt;
    // lightning (seeded schedule): double/triple flicker
    if (cur.storm > 0.2) {
      flash.t += dt;
      if (flash.t >= flash.next) {
        flash.t = 0;
        flash.next = lerp(9, 3.5, cur.storm) + flashRng.float() * 6;
        const n = flashRng.int(2, 3);
        flash.pulses = [];
        let at = 0;
        for (let i = 0; i < n; i++) { flash.pulses.push({ at, amp: i === 0 ? 1 : flashRng.range(0.45, 0.9) }); at += flashRng.range(0.07, 0.16); }
        flash.at = { x: flashRng.range(0.05, 0.95), y: flashRng.range(-0.1, 0.5) };
        ctx.events.emit('env:lightning', { x: flash.at.x, y: flash.at.y, distance: flashRng.range(0.5, 6) });
      }
      let lvl = 0;
      for (const p of flash.pulses) {
        const u = flash.t - p.at;
        if (u >= 0) lvl = Math.max(lvl, p.amp * Math.exp(-u * 16) * (u < 0.02 ? u / 0.02 : 1));
      }
      flash.level = lvl * cur.storm;
    } else flash.level = 0;
    if (params.flash === '1' && cur.storm > 0.2) flash.level = Math.max(flash.level, 0.55); // screenshot aid
    env.ambient = flash.level > 0.01 ? applyFlash(baseAmbient) : baseAmbient;
  }

  // ---------- rendering hooks ----------
  ctx.renderer.addCollector((view, F) => {
    const cc = cur.cloudCover;
    if (cc > 0.04 && env.sun.shadowStrength > 0.005) {
      F.shadow.custom((sg, sun, v) => fx.drawCloudShadows(sg, v || view, cc, drift));
    }
  });
  ctx.renderer.addLayer('weather', (g, view) => {
    const w = { rain: cur.rain, snow: cur.snow, fog: cur.fog, storm: cur.storm, cloudCover: cur.cloudCover, wind };
    const t = view.time || 0;
    fx.drawHaze(g, view, w);
    fx.drawFog(g, view, w, t, drift);
    fx.drawSnow(g, view, w, t);
    fx.drawRain(g, view, w, t);
  }, 10);
  ctx.renderer.addLayer('screen', (g, view) => {
    fx.drawScreen(g, view, {
      weather: { cloudCover: cur.cloudCover, rain: cur.rain, fog: cur.fog, storm: cur.storm },
      golden: env.golden, night: 1 - env.daylight,
      shadowDir: { x: -Math.sin(env.sun.azimuth), y: Math.cos(env.sun.azimuth) },
      flash: flash.level, flashAt: flash.at,
    });
  }, -10);

  ctx.events.on('clock:day', () => refreshForecast());

  // ---------- API ----------
  const api = {
    getSun() { return env.sun; },
    getMoon() { return env.moon; },
    getWeather() { return env.weather; },
    /** force weather. kind ∈ KINDS or 'auto' (release to the seasonal plan). opts.instant snaps. */
    setWeather(k, i = 0.7, opts = {}) {
      if (k === 'auto' || k == null) { forced = null; return env.weather; }
      if (!KINDS.includes(k)) { ctx.warn(`setWeather: unknown kind "${k}" (valid: ${KINDS.join(', ')}, auto)`); return env.weather; }
      forced = { kind: k, intensity: clamp(Number(i), 0, 1) || 0.7 };
      if (opts.instant || clock.paused) {
        snapWeather();
        if (opts.warm !== false) warmUp(3, true);
        computeLight();
        publishWeather(temperatureNow());
        env.ambient = baseAmbient;
      }
      return env.weather;
    },
    forecast(days = 5) {
      const n = clamp(Math.floor(days) || 5, 1, 14);
      const out = [];
      for (let i = 1; i <= n; i++) {
        const p = plan.day(clock.day + i);
        out.push({ day: p.day, kind: p.kind, tempMin: p.tempMin, tempMax: p.tempMax, rainMm: p.rainMm });
      }
      return out;
    },
    /** local gusty wind at (x, y) metres: { x, y, speed (m/s), gust 0..1 } */
    windAt(x, y) {
      const s = wind.speed;
      const ax = x - wind.x * windT * 1.4, ay = y - wind.y * windT * 1.4;   // gusts advect with the wind
      const g = gustNoise.fbm(ax / 38, ay / 38, 2);
      const gust = clamp(0.5 + g * 0.9, 0, 1);
      const mul = 0.55 + gust * (0.8 + 0.25 * cur.storm);
      const turn = gustNoise.at(ax / 90 + 13.1, ay / 90 - 7.7) * 0.45;
      const c = Math.cos(turn), si = Math.sin(turn);
      const wx = (wind.x * c - wind.y * si) * mul, wy = (wind.x * si + wind.y * c) * mul;
      return { x: wx, y: wy, speed: Math.hypot(wx, wy), gust: +gust.toFixed(3), base: s };
    },
    isNight() { return env.daylight < NIGHT_DAYLIGHT; },
    lightLevel() { return clamp(env.daylight * (1 - 0.35 * cur.cloudCover) * (1 - 0.2 * cur.fog), 0, 1); },
  };

  // ---------- initial state ----------
  snapWeather();
  warmUp(12, false);
  if (params.weather) {
    const k = params.weather;
    api.setWeather(k, params.intensity != null ? Number(params.intensity) : 0.75, { instant: true });
  }
  computeLight();
  publishWeather(temperatureNow());
  env.ambient = baseAmbient;
  refreshForecast();

  const inst = {
    api,
    update,
    frame,
    save() { return { forced, wetness, snowCover, cur: { ...cur }, wind: { ...wind } }; },
    load(d) {
      if (!d) return;
      forced = d.forced || null;
      if (Number.isFinite(d.wetness)) wetness = d.wetness;
      if (Number.isFinite(d.snowCover)) snowCover = d.snowCover;
      if (d.cur) for (const k of Object.keys(cur)) if (Number.isFinite(d.cur[k])) cur[k] = d.cur[k];
      if (d.wind) Object.assign(wind, d.wind);
    },
  };
  INSTANCES.set(ctx, { api, resync });
  return inst;
}

const INSTANCES = new WeakMap();

export const showcase = {
  deps: [],
  presets: SHOWCASE_PRESETS,
  async stage(ctx, presetName) { return stageShowcase(ctx, presetName, INSTANCES.get(ctx)); },
};
