// Showcase: a small painted farmyard corner that exists only to demonstrate the environment —
// shadow direction/length through the day (shed, trees, poles, fence, bales), a lamp and a door
// light at night, cloud shadows, wind (windsock, swaying grass), wet ground + sky-tinted puddles,
// snow cover, rain / snow / fog / storm. All art is painted once into cached sprites.
import { clamp, smooth } from './sky.js';

const CAM = { x: 60, y: 57, zoom: 20 };
export const SHOWCASE_PRESETS = {
  default: { camera: CAM, time: '10:30', day: 10, weather: 'cloudy', intensity: 0.6 },
  noon: { camera: CAM, time: '13:00', day: 16, weather: 'clear', intensity: 0.1 },
  golden: { camera: CAM, time: '19:10', day: 20, weather: 'clear', intensity: 0.1 },
  night: { camera: CAM, time: '23:30', day: 22, weather: 'clear', intensity: 0.1 },
  rain: { camera: CAM, time: '15:00', day: 28, weather: 'rain', intensity: 0.75 },
  fog: { camera: CAM, time: '08:40', day: 31, weather: 'fog', intensity: 0.8 },
  snow: { camera: CAM, time: '11:30', day: 1, weather: 'snow', intensity: 0.65 },
  storm: { camera: CAM, time: '17:30', day: 20, weather: 'storm', intensity: 0.9 },
  closeup: { camera: { x: 64, y: 58, zoom: 44 }, time: '21:50', day: 20, weather: 'clear', intensity: 0.1 },
};

// scene extents (metres)
const GX = 8, GY = 22, GW = 112, GH = 74, GPPM = 12;

const PATH = [[6, 84], [22, 80], [36, 72], [48, 66], [58, 63.5], [68, 62], [80, 57], [92, 49], [104, 40], [122, 33]];
const SHED = { x: 71, y: 51, w: 6.4, h: 4.6, rot: 0.06, height: 3.6 };
const TREES = [
  { x: 38, y: 45, r: 3.6, type: 'oak', seed: 1 },
  { x: 91, y: 68, r: 3.1, type: 'oak', seed: 2 },
  { x: 28, y: 63, r: 2.5, type: 'pine', seed: 3 },
  { x: 99, y: 58, r: 2.2, type: 'pine', seed: 4 },
];
const LAMP = { x: 56.5, y: 60.6, height: 4.4 };
const SOCK = { x: 48, y: 53, height: 6.5 };
const BALES = [[80, 62.2, 0.85], [82.1, 61.4, 0.85], [81.1, 63.9, 0.85]];
const CRATES = [[66.2, 56.6, 1.0, 0.9, 0.1], [67.5, 57.1, 0.9, 0.8, -0.2], [66.8, 55.7, 0.8, 1.6, 0.05]];
const FENCE = { x0: 62, x1: 86, y: 71.5, post: 2.4 };
const WALL = [[23, 55], [26, 48], [31, 42], [34, 38.5]];
const GRASS = [[45.5, 73.4, 0.8], [58.5, 76.8, 0.9], [36, 51, 0.7], [93, 47.5, 0.8], [44, 69, 1.0], [46, 71.5, 0.8], [42.5, 72.5, 0.9], [88, 45, 1], [90.5, 46.5, 0.85], [60, 75, 0.9], [62.3, 76.2, 0.8], [33, 53, 0.8], [75, 75, 0.9], [52, 47, 0.8]];
const PUDDLES = [[35, 71.8, 1.5, 0.8, 0.3], [52.5, 64.6, 1.9, 0.9, -0.1], [74.8, 60.5, 1.3, 0.7, 0.4], [86.5, 53.6, 1.6, 0.7, 0.6], [20.5, 80.6, 1.2, 0.6, 0.2]];

export async function stageShowcase(ctx, presetName, inst) {
  const { art, palette, clock, world } = ctx;
  const env = world.environment;
  const P = SHOWCASE_PRESETS[presetName] || SHOWCASE_PRESETS.default;
  const api = inst && inst.api;
  if (api) {
    if (ctx.params.weather) api.setWeather(ctx.params.weather, ctx.params.intensity != null ? Number(ctx.params.intensity) : 0.75, { instant: true });
    else if (P.weather) api.setWeather(P.weather, P.intensity, { instant: true });
    if (inst.resync) inst.resync();
  }
  const season = () => clock.season;
  const PPM = art.PPM;

  // ---------------- painting ----------------
  function paintPathStroke(g, s, width, color, alpha, rng, jitter) {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = width * s;
    g.beginPath();
    PATH.forEach(([x, y], i) => {
      const px = (x - GX) * s + (jitter ? rng.range(-jitter, jitter) : 0), py = (y - GY) * s + (jitter ? rng.range(-jitter, jitter) : 0);
      if (i === 0) g.moveTo(px, py); else {
        const [qx, qy] = PATH[i - 1];
        const mx = ((qx + x) / 2 - GX) * s, my = ((qy + y) / 2 - GY) * s;
        g.quadraticCurveTo((qx - GX) * s, (qy - GY) * s, mx, my);
        if (i === PATH.length - 1) g.lineTo(px, py);
      }
    });
    g.stroke();
    g.restore();
  }

  const groundSprite = (sea) => art.sprite(`env:sc:ground:${sea}`, GW * GPPM, GH * GPPM, (g, w, h, rng) => {
    const cols = palette.grass[sea];
    art.noiseFill(g, 0, 0, w, h, [art.shade(cols[2], -0.08), cols[2], cols[0], cols[1], cols[3]], { scale: 0.011, grain: 0.05, seed: 'env-ground-' + sea, px: 2 });
    // broad painterly mottling
    const n = art.noise('env-mottle');
    for (let i = 0; i < 2600; i++) {
      const x = rng.float() * w, y = rng.float() * h;
      const v = n.fbm(x * 0.006, y * 0.006, 2);
      g.globalAlpha = 0.16 + rng.float() * 0.14;
      g.fillStyle = v > 0 ? art.shade(rng.pick(cols), 0.12) : art.shade(rng.pick(cols), -0.18);
      g.beginPath();
      g.ellipse(x, y, rng.range(4, 14), rng.range(3, 8), rng.float() * 3.14, 0, 6.283);
      g.fill();
    }
    // meadow patches
    for (let i = 0; i < 900; i++) {
      const x = rng.float() * w, y = rng.float() * h;
      if (n.fbm(x * 0.004 + 9, y * 0.004, 2) < 0.15) continue;
      g.globalAlpha = 0.25;
      g.fillStyle = sea === 'winter' ? art.shade(palette.grass.winter[1], 0.1) : rng.pick(palette.meadow);
      g.beginPath(); g.ellipse(x, y, rng.range(3, 9), rng.range(2, 6), rng.float() * 3.14, 0, 6.283); g.fill();
    }
    // grass blade strokes
    g.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = rng.float() * w, y = rng.float() * h;
      const a = -1.57 + rng.range(-0.6, 0.6), l = rng.range(2, 5);
      g.globalAlpha = rng.range(0.25, 0.55);
      g.strokeStyle = rng.chance(0.5) ? art.shade(rng.pick(cols), -0.3) : art.shade(rng.pick(cols), 0.18);
      g.lineWidth = rng.range(0.7, 1.4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // the dirt track
    const s = GPPM;
    paintPathStroke(g, s, 3.4, art.shade(cols[2], -0.25), 0.35, rng, 0);
    paintPathStroke(g, s, 2.7, palette.soil.dry, 1, rng, 0);
    paintPathStroke(g, s, 1.6, art.mix(palette.soil.dry, palette.sand[1], 0.45), 0.8, rng, 0);
    // ruts + gravel speckle along the track
    g.save();
    g.lineCap = 'round';
    g.globalAlpha = 0.28;
    g.strokeStyle = palette.soil.moist; g.lineWidth = 0.28 * s;
    for (const off of [-0.65, 0.65]) {
      g.beginPath();
      PATH.forEach(([x, y], i) => {
        const [nx, ny] = i < PATH.length - 1 ? PATH[i + 1] : [x + 1, y];
        const dx = nx - x, dy = ny - y, l = Math.hypot(dx, dy) || 1;
        const px = (x - GX - dy / l * off) * s, py = (y - GY + dx / l * off) * s;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
    }
    g.restore();
    for (let i = 0; i < 2200; i++) {
      const k = rng.int(0, PATH.length - 2), t = rng.float();
      const [ax, ay] = PATH[k], [bx, by] = PATH[k + 1];
      const x = (ax + (bx - ax) * t - GX) * s + rng.gauss(0, 0.8 * s), y = (ay + (by - ay) * t - GY) * s + rng.gauss(0, 0.8 * s);
      g.globalAlpha = rng.range(0.3, 0.7);
      g.fillStyle = rng.pick(palette.gravel);
      g.fillRect(x, y, rng.range(1, 2.5), rng.range(1, 2));
    }
    // grass creeping over the track edges
    for (let i = 0; i < 1400; i++) {
      const k = rng.int(0, PATH.length - 2), t = rng.float();
      const [ax, ay] = PATH[k], [bx, by] = PATH[k + 1];
      const side = rng.chance(0.5) ? 1 : -1, dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
      const off = side * rng.range(1.0, 1.6);
      const x = (ax + dx * t - GX - dy / l * off) * s, y = (ay + dy * t - GY + dx / l * off) * s;
      g.globalAlpha = 0.5;
      g.strokeStyle = art.shade(rng.pick(cols), rng.range(-0.25, 0.1));
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-2, 2), y - rng.range(2, 5)); g.stroke();
    }
    // wild flowers (not in winter)
    if (sea !== 'winter') {
      const fl = sea === 'autumn' ? [palette.flowers[5], palette.flowers[0]] : palette.flowers;
      const count = sea === 'summer' ? 700 : sea === 'spring' ? 900 : 250;
      for (let i = 0; i < count; i++) {
        const cx = rng.float() * w, cy = rng.float() * h;
        if (n.fbm(cx * 0.004 + 9, cy * 0.004, 2) < 0.05) continue;
        g.globalAlpha = rng.range(0.6, 0.95);
        g.fillStyle = rng.pick(fl);
        g.beginPath(); g.arc(cx, cy, rng.range(0.8, 1.6), 0, 6.283); g.fill();
      }
    }
    // mown apron around the shed and AO where things stand
    g.globalAlpha = 1;
    const aoAt = (x, y, rx, ry, a) => art.contactShadow(g, (x - GX) * s, (y - GY) * s, rx * s, ry * s, a);
    aoAt(SHED.x, SHED.y, SHED.w * 0.72, SHED.h * 0.78, 0.4);
    for (const t of TREES) aoAt(t.x, t.y, t.r * 0.8, t.r * 0.8, 0.22);
    for (const [x, y, r] of BALES) aoAt(x, y, r * 1.5, r * 1.4, 0.35);
    for (const [x, y, w2, h2] of CRATES) aoAt(x, y, w2, h2, 0.3);
    for (let i = 0; i < WALL.length - 1; i++) {
      const [ax, ay] = WALL[i], [bx, by] = WALL[i + 1];
      for (let t = 0; t <= 1; t += 0.2) aoAt(ax + (bx - ax) * t, ay + (by - ay) * t, 1.2, 1.2, 0.18);
    }
    art.grain(g, w, h, rng, 0.05, 0.015);
  });

  /** snow layer with coverage `level` (0..1): patchy at low cover, drifts + hollows at full */
  const snowSprite = (level) => art.sprite(`env:sc:snow:${level}`, GW * GPPM / 2, GH * GPPM / 2, (g, w, h, rng) => {
    const img = g.createImageData(w, h);
    const d = img.data;
    const n = art.noise('env-snow'), n2 = art.noise('env-snow2');
    const th = 1 - level * 1.15;
    const cols = palette.snow.map(art.hexToRgb);
    const hollow = [196, 208, 228];
    const s = GPPM / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (n.fbm(x * 0.03, y * 0.03, 4) + 1) / 2;
      // track stays slushier / thinner
      let a = smooth(th - 0.08, th + 0.08, v);
      const wx = x / s + GX, wy = y / s + GY;
      let dTrack = 99;
      for (let i = 0; i < PATH.length - 1; i++) {
        const [ax, ay] = PATH[i], [bx, by] = PATH[i + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = clamp(((wx - ax) * dx + (wy - ay) * dy) / l2, 0, 1);
        dTrack = Math.min(dTrack, Math.hypot(wx - ax - dx * t, wy - ay - dy * t));
      }
      if (dTrack < 1.5) a *= 0.55 + 0.3 * smooth(0.3, 1.5, dTrack);
      const m = (n2.fbm(x * 0.012, y * 0.012, 3) + 1) / 2;
      const c = cols[(x * 7 + y * 13) % 3];
      const hk = smooth(0.35, 0.75, 1 - m) * 0.55;
      const o = (y * w + x) * 4;
      const gr = 1 + (rng.float() - 0.5) * 0.04;
      d[o] = (c[0] + (hollow[0] - c[0]) * hk) * gr;
      d[o + 1] = (c[1] + (hollow[1] - c[1]) * hk) * gr;
      d[o + 2] = (c[2] + (hollow[2] - c[2]) * hk) * gr;
      d[o + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  });

  const shedSprite = (snow) => art.sprite(`env:sc:shed:${snow ? 'snow' : 'plain'}`, SHED.w * PPM + 8, SHED.h * PPM + 8, (g, w, h, rng) => {
    const W = SHED.w * PPM, H = SHED.h * PPM, ox = 4, oy = 4;
    const cols = palette.roof.terracotta;
    g.save();
    art.wobblyPath(g, [[ox, oy], [ox + W, oy], [ox + W, oy + H], [ox, oy + H]], rng, 1.2);
    g.clip();
    g.fillStyle = cols[0]; g.fillRect(0, 0, w, h);
    // tile courses parallel to the ridge (ridge runs along x through the middle)
    const rows = 11, rowH = H / rows;
    for (let r = 0; r < rows; r++) {
      const y = oy + r * rowH;
      for (let x = ox - (r % 2) * 7; x < ox + W; x += 14) {
        g.fillStyle = art.shade(rng.pick(cols), rng.range(-0.12, 0.12));
        g.beginPath();
        const up = r < rows / 2;
        if (up) { g.moveTo(x, y + rowH); g.quadraticCurveTo(x + 7, y - 2, x + 14, y + rowH); }
        else { g.moveTo(x, y); g.quadraticCurveTo(x + 7, y + rowH + 2, x + 14, y); }
        g.closePath(); g.fill();
      }
      g.strokeStyle = art.rgba(art.outline(cols[0]), 0.35);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(ox, r < rows / 2 ? y + rowH : y); g.lineTo(ox + W, r < rows / 2 ? y + rowH : y); g.stroke();
    }
    // moss & weathering
    g.save();
    art.dabs(g, rng, 60, ox, oy, W, H, [palette.roof.moss, art.shade(palette.roof.moss, 0.2)], 1.5, 5, 0.35);
    g.restore();
    // soft form shading: darker toward the eaves, highlight along the ridge
    const gr = g.createLinearGradient(0, oy, 0, oy + H);
    gr.addColorStop(0, 'rgba(24,20,34,0.28)'); gr.addColorStop(0.46, 'rgba(255,240,215,0.1)');
    gr.addColorStop(0.54, 'rgba(255,240,215,0.1)'); gr.addColorStop(1, 'rgba(24,20,34,0.28)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // ridge cap
    g.fillStyle = art.shade(cols[2], -0.1);
    g.fillRect(ox, oy + H / 2 - 4, W, 8);
    g.fillStyle = art.rgba(art.shade(cols[3], 0.2), 0.6);
    g.fillRect(ox, oy + H / 2 - 3, W, 2);
    // chimney
    const cx = ox + W * 0.72, cy = oy + H * 0.26;
    g.fillStyle = palette.brick[0]; g.fillRect(cx - 9, cy - 9, 18, 18);
    g.fillStyle = palette.brick[2]; g.fillRect(cx - 9, cy + 3, 18, 6);
    g.fillStyle = '#2b2622'; g.fillRect(cx - 5, cy - 5, 10, 10);
    g.strokeStyle = art.outline(palette.brick[0]); g.lineWidth = 1.5; g.strokeRect(cx - 9, cy - 9, 18, 18);
    if (snow) {
      g.globalAlpha = 0.92;
      for (let i = 0; i < 700; i++) {
        const x = ox + rng.float() * W, y = oy + rng.float() * H;
        if (Math.abs(y - oy - H / 2) < 5 && rng.chance(0.6)) continue;
        if (Math.abs(x - cx) < 11 && Math.abs(y - cy) < 11) continue;
        g.fillStyle = rng.pick(palette.snow);
        g.beginPath(); g.ellipse(x, y, rng.range(3, 8), rng.range(2, 5), 0, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      const sg = g.createLinearGradient(0, oy, 0, oy + H);
      sg.addColorStop(0, 'rgba(170,186,214,0.35)'); sg.addColorStop(0.5, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(170,186,214,0.35)');
      g.fillStyle = sg; g.fillRect(0, 0, w, h);
    }
    art.grain(g, w, h, rng, 0.06, 0.03);
    g.restore();
    g.strokeStyle = art.outline(cols[0]); g.lineWidth = 2;
    art.wobblyPath(g, [[ox, oy], [ox + W, oy], [ox + W, oy + H], [ox, oy + H]], rng, 1.2);
    g.stroke();
  });

  const oakSprite = (r, sea, seed) => {
    const S = Math.ceil(r * 2.3 * PPM);
    return art.sprite(`env:sc:oak:${sea}:${seed}`, S, S, (g, w, h, rng) => {
      const c = w / 2, R = r * PPM;
      if (sea === 'winter') {
        // bare crown: branch structure + a few clinging leaves
        g.lineCap = 'round';
        const bark = palette.bark;
        const branch = (x, y, a, len, wd, depth) => {
          const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
          g.strokeStyle = art.shade(bark[depth % 3], depth * 0.06); g.lineWidth = wd;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + rng.range(-4, 4), (y + y2) / 2 + rng.range(-4, 4), x2, y2); g.stroke();
          if (depth < 4) for (let k = 0; k < 2 + (depth < 2 ? 1 : 0); k++) branch(x2, y2, a + rng.range(-0.7, 0.7), len * rng.range(0.55, 0.75), wd * 0.62, depth + 1);
        };
        for (let k = 0; k < 6; k++) branch(c, c, k / 6 * 6.283 + rng.range(-0.3, 0.3), R * 0.42, 6, 0);
        art.dabs(g, rng, 40, c - R, c - R, 2 * R, 2 * R, palette.foliage.winter, 1.5, 3, 0.5);
        g.fillStyle = art.shade(bark[0], -0.1); g.beginPath(); g.arc(c, c, 6, 0, 6.283); g.fill();
        return;
      }
      const cols = palette.foliage[sea];
      art.contactShadow(g, c, c, R * 1.05, R * 1.05, 0.25);
      // clusters
      const clusters = [];
      for (let k = 0; k < 15; k++) {
        const a = rng.float() * 6.283, d = Math.sqrt(rng.float()) * R * 0.62;
        clusters.push([c + Math.cos(a) * d, c + Math.sin(a) * d, R * rng.range(0.3, 0.44)]);
      }
      clusters.sort((p, q) => Math.hypot(q[0] - c, q[1] - c) - Math.hypot(p[0] - c, p[1] - c));
      for (const [x, y, cr] of clusters) {
        art.blobPath(g, x, y, cr, rng, 0.2, 7);
        g.fillStyle = art.shade(cols[2], -0.15); g.fill();
        g.strokeStyle = art.rgba(art.outline(cols[2]), 0.55); g.lineWidth = 1.5; g.stroke();
        art.blobPath(g, x, y - cr * 0.05, cr * 0.82, rng, 0.2, 7);
        g.fillStyle = cols[0]; g.fill();
        g.save(); g.clip();
        art.dabs(g, rng, 26, x - cr, y - cr, cr * 2, cr * 2, [cols[1], cols[3], cols[0]], cr * 0.1, cr * 0.28, 0.55);
        g.restore();
        art.blobPath(g, x, y, cr * 0.82, rng, 0.2, 7);
        art.volume(g, x, y, cr * 0.9, 0.3);
      }
      // top highlight flecks (top-down: sky-lit leaf tops)
      art.dabs(g, rng, 60, c - R * 0.7, c - R * 0.7, R * 1.4, R * 1.4, [art.shade(cols[3], 0.25)], 1.2, 3, 0.45);
      art.grain(g, w, h, rng, 0.05, 0.02);
    });
  };

  const pineSprite = (r, seed) => {
    const S = Math.ceil(r * 2.3 * PPM);
    return art.sprite(`env:sc:pine:${seed}`, S, S, (g, w, h, rng) => {
      const c = w / 2, R = r * PPM;
      const cols = palette.conifer;
      art.contactShadow(g, c, c, R, R, 0.3);
      for (let tier = 0; tier < 5; tier++) {
        const rr = R * (1 - tier * 0.19);
        const spikes = 13 - tier;
        g.beginPath();
        const ph = rng.float() * 6.283;
        for (let i = 0; i <= spikes * 2; i++) {
          const a = ph + (i / (spikes * 2)) * 6.283;
          const rad = i % 2 === 0 ? rr * rng.range(0.92, 1.05) : rr * rng.range(0.66, 0.76);
          const x = c + Math.cos(a) * rad, y = c + Math.sin(a) * rad;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fillStyle = art.shade(cols[tier % 2 === 0 ? 2 : 0], tier * 0.07);
        g.fill();
        g.strokeStyle = art.rgba(art.outline(cols[2]), 0.45); g.lineWidth = 1.2; g.stroke();
        g.save(); g.clip();
        art.dabs(g, rng, 30, c - rr, c - rr, rr * 2, rr * 2, [cols[1], cols[3]], 1, 3, 0.35);
        g.restore();
      }
      g.fillStyle = art.shade(cols[3], 0.15); g.beginPath(); g.arc(c, c, 3, 0, 6.283); g.fill();
      art.grain(g, w, h, rng, 0.05, 0.02);
    });
  };
  const pineSnowSprite = (r, seed) => {
    const S = Math.ceil(r * 2.3 * PPM);
    return art.sprite(`env:sc:pinesnow:${seed}`, S, S, (g, w, h, rng) => {
      const c = w / 2, R = r * PPM;
      for (let i = 0; i < 160; i++) {
        const a = rng.float() * 6.283, d = Math.sqrt(rng.float()) * R * 0.95;
        g.globalAlpha = rng.range(0.55, 0.95);
        g.fillStyle = rng.pick(palette.snow);
        g.beginPath(); g.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, rng.range(2, 5), rng.range(1.5, 3), a, 0, 6.283); g.fill();
      }
    });
  };

  const baleSprite = (r) => art.sprite('env:sc:bale', Math.ceil(r * 2.2 * PPM), Math.ceil(r * 2.2 * PPM), (g, w, h, rng) => {
    const c = w / 2, R = r * PPM;
    const cols = palette.roof.thatch;
    g.beginPath(); g.arc(c, c, R, 0, 6.283);
    g.fillStyle = cols[0]; g.fill();
    g.save(); g.clip();
    g.lineCap = 'round';
    for (let a = 0; a < 40; a += 0.18) {            // spiral of straw
      const rad = (a / 40) * R;
      g.strokeStyle = art.shade(rng.pick(cols), rng.range(-0.2, 0.2));
      g.lineWidth = rng.range(1, 2.2);
      g.beginPath(); g.arc(c, c, rad, a, a + 0.5); g.stroke();
    }
    art.volume(g, c, c, R, 0.3);
    g.restore();
    g.beginPath(); g.arc(c, c, R, 0, 6.283);
    g.strokeStyle = art.outline(cols[0]); g.lineWidth = 2; g.stroke();
    // net wrap strands
    g.strokeStyle = 'rgba(240,236,220,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(c - R, c - R + k * R * 0.5); g.lineTo(c + R, c - R * 0.8 + k * R * 0.5); g.stroke(); }
  });

  const crateSprite = (w0, h0) => art.sprite(`env:sc:crate:${w0}x${h0}`, Math.ceil(w0 * PPM) + 4, Math.ceil(h0 * PPM) + 4, (g, w, h, rng) => {
    const cols = palette.timber;
    const W = w0 * PPM, H = h0 * PPM;
    g.fillStyle = cols[0]; g.fillRect(2, 2, W, H);
    const planks = Math.max(3, Math.round(H / 8));
    for (let i = 0; i < planks; i++) {
      g.fillStyle = art.shade(rng.pick(cols), rng.range(-0.12, 0.12));
      g.fillRect(3, 2 + i * H / planks + 1, W - 2, H / planks - 2);
    }
    g.strokeStyle = art.shade(cols[2], -0.2); g.lineWidth = 2.5;
    g.strokeRect(3, 3, W - 2, H - 2);
    g.beginPath(); g.moveTo(3, 3); g.lineTo(W + 1, H + 1); g.stroke();
    art.grain(g, w, h, rng, 0.07, 0.05);
  });

  const lampSprite = art.sprite('env:sc:lamp', 28, 28, (g, w, h, rng) => {
    const c = w / 2;
    g.fillStyle = palette.metal[2]; g.beginPath(); g.arc(c, c, 11, 0, 6.283); g.fill();
    g.fillStyle = art.shade(palette.metal[0], -0.35); g.beginPath(); g.arc(c, c, 8, 0, 6.283); g.fill();
    g.fillStyle = palette.metal[1]; g.beginPath(); g.arc(c - 2, c - 2, 3, 0, 6.283); g.fill();
    g.strokeStyle = art.outline(palette.metal[2]); g.lineWidth = 1.5; g.beginPath(); g.arc(c, c, 11, 0, 6.283); g.stroke();
  });

  const stones = [];
  {
    const rng = ctx.rng('wall');
    for (let i = 0; i < WALL.length - 1; i++) {
      const [ax, ay] = WALL[i], [bx, by] = WALL[i + 1];
      const len = Math.hypot(bx - ax, by - ay), n = Math.round(len / 0.55);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        for (const side of [-0.22, 0.22]) {
          stones.push({ x: ax + (bx - ax) * t + nx * side + rng.range(-0.06, 0.06), y: ay + (by - ay) * t + ny * side + rng.range(-0.06, 0.06), r: rng.range(0.24, 0.34), c: rng.pick(palette.rock), k: stones.length });
        }
      }
    }
  }
  const stoneSprites = [0, 1, 2, 3].map((i) => art.sprite('env:sc:stone:' + i, 26, 26, (g, w, h, rng) => {
    art.blobPath(g, 13, 13, 10, rng, 0.2, 5);
    g.fillStyle = palette.rock[i]; g.fill();
    g.save(); g.clip(); art.dabs(g, rng, 10, 0, 0, 26, 26, palette.rock, 1, 3, 0.4);
    art.dabs(g, rng, 3, 0, 0, 26, 26, [palette.roof.moss], 1.5, 3, 0.45); g.restore();
    art.blobPath(g, 13, 13, 10, rng, 0.2, 5); art.volume(g, 13, 13, 10, 0.35);
    g.strokeStyle = art.outline(palette.rock[i]); g.lineWidth = 1.3; art.blobPath(g, 13, 13, 10, rng, 0.2, 5); g.stroke();
  }));

  const grassClump = (sea) => art.sprite(`env:sc:clump:${sea}`, 80, 80, (g, w, h, rng) => {
    const cols = sea === 'winter' ? ['#a39a78', '#b7ad86', '#8a8266'] : sea === 'autumn' ? ['#a39a4e', '#b8a860', '#8a8a44'] : [palette.grass[sea][2], palette.grass[sea][1], palette.meadow[1], palette.grass[sea][3]];
    const c = 40;
    art.contactShadow(g, c, c, 22, 20, 0.35);
    g.lineCap = 'round';
    // three passes: dark base blades, mid, then pale sky-lit tips on top
    for (let pass = 0; pass < 3; pass++) {
      const n = [70, 60, 40][pass];
      for (let i = 0; i < n; i++) {
        const a = rng.float() * 6.283, l = rng.range(8, 34) * (pass === 2 ? 0.8 : 1);
        const bend = rng.range(-0.5, 0.5);
        g.strokeStyle = art.shade(rng.pick(cols), [-0.35, -0.05, 0.22][pass] + rng.range(-0.08, 0.08));
        g.lineWidth = rng.range(1.1, 2.2) * (pass === 2 ? 0.8 : 1);
        g.globalAlpha = pass === 0 ? 0.9 : 0.8;
        const sx = c + rng.range(-4, 4), sy = c + rng.range(-4, 4);
        g.beginPath(); g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + Math.cos(a + bend) * l * 0.55, sy + Math.sin(a + bend) * l * 0.55, sx + Math.cos(a) * l, sy + Math.sin(a) * l);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    if (sea === 'summer' || sea === 'autumn') {
      for (let i = 0; i < 14; i++) {                    // seed heads
        const a = rng.float() * 6.283, d = rng.range(14, 30);
        g.fillStyle = art.shade(sea === 'summer' ? '#c9b877' : '#b39a5a', rng.range(-0.1, 0.1));
        g.beginPath(); g.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, 2.6, 1.2, a, 0, 6.283); g.fill();
      }
    } else if (sea === 'spring') art.dabs(g, rng, 7, 20, 20, 40, 40, [palette.flowers[0], palette.flowers[2], palette.flowers[3]], 1.2, 2, 0.9);
  });

  // bare winter oak branch skeleton (for its lace-like shadow)
  const branchSets = TREES.filter((t) => t.type === 'oak').map((t) => {
    const rng = ctx.rng('branches:' + t.seed);
    const segs = [];
    const branch = (x, y, z, a, len, wd, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len, z2 = z + len * rng.range(0.35, 0.8);
      segs.push([x, y, z, x2, y2, z2, wd]);
      if (depth < 3) for (let k = 0; k < 2; k++) branch(x2, y2, z2, a + rng.range(-0.8, 0.8), len * rng.range(0.55, 0.75), wd * 0.6, depth + 1);
    };
    for (let k = 0; k < 6; k++) branch(t.x, t.y, 2.6, k / 6 * 6.283 + rng.range(-0.3, 0.3), t.r * 0.45, 0.22, 0);
    return { t, segs };
  });

  // ---------------- per-frame submission ----------------
  const inView = (x, y, r, v) => x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
  const lampOn = () => clamp(smooth(0.5, 0.2, env.daylight) + (env.weather.storm > 0.4 ? 0.5 : 0) + (env.weather.fog > 0.5 ? 0.35 : 0), 0, 1);
  const wetGround = art.rgba('#1c2430', 1);

  ctx.renderer.addLayer('ground', (g, view) => {
    const sea = season();
    g.drawImage(groundSprite(sea), GX, GY, GW, GH);
    const W = env.weather;
    if (W.wetness > 0.02) {
      g.globalAlpha = W.wetness * 0.24;
      g.fillStyle = wetGround;
      g.fillRect(GX, GY, GW, GH);
      g.globalAlpha = 1;
    }
    if (W.snowCover > 0.02) {
      const lv = W.snowCover;
      const levels = [0.35, 0.7, 1];
      let i = 0; while (i < 2 && lv > levels[i]) i++;
      const lo = i === 0 ? 0 : levels[i - 1], hi = levels[i];
      const t = clamp((lv - lo) / (hi - lo), 0, 1);
      if (i > 0) g.drawImage(snowSprite(levels[i - 1]), GX, GY, GW, GH);
      g.globalAlpha = t;
      g.drawImage(snowSprite(levels[i]), GX, GY, GW, GH);
      g.globalAlpha = 1;
    }
  });

  // irregular puddle outlines (unit shapes, scaled by how wet it is)
  const puddleShapes = PUDDLES.map(([x, y, rx, ry, rot], i) => {
    const rng = ctx.rng('puddle:' + i);
    const pts = [], n = 22, ph = rng.float() * 6.28, f2 = rng.range(0.1, 0.22), f3 = rng.range(0.05, 0.14);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283;
      const r = 1 + f2 * Math.sin(a * 2 + ph) + f3 * Math.sin(a * 3 + ph * 2) + rng.range(-0.05, 0.05);
      const lx = Math.cos(a) * rx * r, ly = Math.sin(a) * ry * r;
      pts.push([lx * Math.cos(rot) - ly * Math.sin(rot), lx * Math.sin(rot) + ly * Math.cos(rot)]);
    }
    return { x, y, rx, pts };
  });
  const puddlePath = (g, p, k) => {
    g.beginPath();
    const n = p.pts.length;
    for (let i = 0; i <= n; i++) {
      const [x0, y0] = p.pts[i % n], [x1, y1] = p.pts[(i + 1) % n];
      const mx = p.x + (x0 + x1) / 2 * k, my = p.y + (y0 + y1) / 2 * k;
      if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p.x + x0 * k, p.y + y0 * k, mx, my);
    }
    g.closePath();
  };
  ctx.renderer.addLayer('ground-detail', (g, view) => {
    // puddles mirror the sky (sunset orange, night blue, grey drizzle)
    const W = env.weather;
    const a = smooth(0.3, 0.85, W.wetness) * (1 - W.snowCover);
    if (a < 0.02) return;
    const sky = env.sky, amb = env.ambient;
    // reflected sky, pre-divided by the ambient so the lighting pass doesn't darken it twice
    const rr = Math.min(235, sky[0] * 235 / Math.max(70, amb[0])), gg = Math.min(240, sky[1] * 235 / Math.max(70, amb[1])), bb = Math.min(245, sky[2] * 235 / Math.max(70, amb[2]));
    const k = 0.45 + 0.55 * a;
    for (const p of puddleShapes) {
      if (!inView(p.x, p.y, p.rx * 1.4, view)) continue;
      // dark wet-mud rim
      g.globalAlpha = a * 0.75;
      g.fillStyle = palette.soil.wet;
      puddlePath(g, p, k * 1.18); g.fill();
      // sky reflection: darker toward the near bank, bright band of sky beyond
      g.globalAlpha = a * 0.92;
      const gr = g.createLinearGradient(p.x, p.y - p.rx, p.x, p.y + p.rx);
      gr.addColorStop(0, `rgb(${rr * 0.62 | 0},${gg * 0.66 | 0},${bb * 0.72 | 0})`);
      gr.addColorStop(0.55, `rgb(${rr | 0},${gg | 0},${bb | 0})`);
      gr.addColorStop(1, `rgb(${rr * 0.8 | 0},${gg * 0.84 | 0},${bb * 0.9 | 0})`);
      g.fillStyle = gr;
      puddlePath(g, p, k); g.fill();
      // ripples when it rains, a glint rim otherwise
      g.globalAlpha = a * (0.25 + 0.3 * W.rain);
      g.strokeStyle = '#eef2f0'; g.lineWidth = 0.04;
      g.save(); puddlePath(g, p, k); g.clip();
      if (W.rain > 0.05) {
        const t = view.time || 0;
        for (let i = 0; i < 5; i++) {
          const ph = (t * 1.3 + i * 0.37 + p.x * 0.1) % 1;
          const ox = Math.sin(i * 7.1 + p.y) * p.rx * 0.5, oy = Math.cos(i * 3.3 + p.x) * p.rx * 0.25;
          g.globalAlpha = a * 0.5 * (1 - ph) * W.rain;
          g.beginPath(); g.ellipse(p.x + ox, p.y + oy, 0.05 + ph * 0.45, 0.04 + ph * 0.3, 0, 0, 6.283); g.stroke();
        }
      } else {
        puddlePath(g, p, k * 0.9); g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
    }
  });

  ctx.renderer.addCollector((view, F) => {
    const sea = season();
    const W = env.weather;
    const snow = W.snowCover;
    const lamp = lampOn();
    const api2 = api;

    // shed
    if (inView(SHED.x, SHED.y, 6, view)) {
      F.shadow.box(SHED.x, SHED.y, SHED.w, SHED.h, SHED.rot, SHED.height - 0.9);
      // gable roof: a ridge prism above the walls (triangle cross-section approximated by a narrower box)
      F.shadow.box(SHED.x, SHED.y, SHED.w, SHED.h * 0.5, SHED.rot, SHED.height, SHED.height - 0.9);
      const c = Math.cos(SHED.rot), s = Math.sin(SHED.rot);
      const chx = SHED.x + (0.22 * SHED.w) * c - (-0.24 * SHED.h) * s, chy = SHED.y + (0.22 * SHED.w) * s + (-0.24 * SHED.h) * c;
      F.shadow.box(chx, chy, 0.56, 0.56, SHED.rot, SHED.height + 0.9);
      F.object({ y: SHED.y + SHED.h / 2, draw(g) {
        const img = shedSprite(false);
        const w = img.width / PPM, h = img.height / PPM;
        art.draw(g, img, SHED.x, SHED.y, w, h, SHED.rot);
        if (snow > 0.05) art.draw(g, shedSprite(true), SHED.x, SHED.y, w, h, SHED.rot, clamp(snow * 1.3, 0, 1));
      } });
      if (lamp > 0.01) {
        const Ld = SHED.h / 2 + 1.1, dx = SHED.x - Ld * s, dy = SHED.y + Ld * c;
        F.light({ x: dx - 1.2, y: dy, radius: 6.5, color: [255, 200, 130], intensity: 0.75 * lamp, glow: 0.5, glowRadius: 1.4 });
      }
    }

    // trees
    for (const t of TREES) {
      if (!inView(t.x, t.y, t.r + 12, view)) continue;
      const bare = t.type === 'oak' && sea === 'winter';
      if (t.type === 'pine') F.shadow.circle(t.x, t.y, t.r * 0.9, 0.8, 0.8 + t.r * 3.2, 0.3);
      else if (!bare) F.shadow.circle(t.x, t.y, t.r * 0.95, 2.4, 2.4 + t.r * 1.8, 0.45);
      else {
        const set = branchSets.find((b) => b.t === t);
        F.shadow.pole(t.x, t.y, 2.6, 0.5);
        F.shadow.custom((sg, sun) => {
          const L = Math.min(8, sun.shadowLen), dx = sun.dirX * L, dy = sun.dirY * L;
          sg.lineCap = 'round'; sg.strokeStyle = sg.fillStyle;
          for (const [x0, y0, z0, x1, y1, z1, wd] of set.segs) {
            sg.lineWidth = wd * 1.4;
            sg.beginPath(); sg.moveTo(x0 + dx * z0, y0 + dy * z0); sg.lineTo(x1 + dx * z1, y1 + dy * z1); sg.stroke();
          }
        });
      }
      F.object({ y: t.y + 0.5, draw(g, v) {
        const img = t.type === 'pine' ? pineSprite(t.r, t.seed) : oakSprite(t.r, sea, t.seed);
        const sz = img.width / PPM;
        // canopy sways a hair in gusts
        const wnd = api2 ? api2.windAt(t.x, t.y) : null;
        const ox = wnd ? wnd.x * 0.012 * (0.5 + wnd.gust) : 0, oy = wnd ? wnd.y * 0.012 * (0.5 + wnd.gust) : 0;
        art.draw(g, img, t.x + ox, t.y + oy, sz, sz);
        if (t.type === 'pine' && snow > 0.1) art.draw(g, pineSnowSprite(t.r, t.seed), t.x + ox, t.y + oy, sz, sz, 0, clamp(snow, 0, 1));
      } });
    }

    // lamp post
    if (inView(LAMP.x, LAMP.y, 12, view)) {
      F.shadow.pole(LAMP.x, LAMP.y, LAMP.height, 0.16);
      F.shadow.circle(LAMP.x, LAMP.y, 0.32, LAMP.height - 0.4, LAMP.height);
      F.object({ y: LAMP.y, draw(g) {
        art.draw(g, lampSprite, LAMP.x, LAMP.y, 0.85, 0.85);
        if (lamp > 0.05) {
          g.globalAlpha = lamp;
          g.fillStyle = '#fff1c8';
          g.beginPath(); g.arc(LAMP.x, LAMP.y, 0.18, 0, 6.283); g.fill();
          g.globalAlpha = 1;
        }
      } });
      if (lamp > 0.01) F.light({ x: LAMP.x, y: LAMP.y, radius: 12, color: palette.lamp, intensity: 0.95 * lamp, glow: 0.9, glowRadius: 2.2 });
    }

    // windsock: pole + a striped sock streaming downwind
    if (inView(SOCK.x, SOCK.y, 12, view)) {
      const wnd = api2 ? api2.windAt(SOCK.x, SOCK.y) : { x: 1, y: 0, speed: 1, gust: 0.5 };
      const sp = wnd.speed;
      const ang = Math.atan2(wnd.y, wnd.x);
      const fill = clamp(sp / 8, 0.25, 1);                 // how inflated/straight it is
      const len = 1.7 * (0.55 + 0.45 * fill);
      F.shadow.pole(SOCK.x, SOCK.y, SOCK.height, 0.12);
      F.shadow.custom((sg, sun) => {
        const L = Math.min(8, sun.shadowLen), z = SOCK.height - 0.1 - (1 - fill) * 0.6;
        const bx = SOCK.x + sun.dirX * L * z, by = SOCK.y + sun.dirY * L * z;
        const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len - (1 - fill) * sun.dirY * L * 0.7;
        sg.lineCap = 'round'; sg.strokeStyle = sg.fillStyle;
        sg.lineWidth = 0.34; sg.beginPath(); sg.moveTo(bx, by); sg.lineTo(ex, ey); sg.stroke();
      });
      F.object({ y: SOCK.y + 0.3, draw(g, v) {
        const t = v.time || 0;
        g.translate(SOCK.x, SOCK.y);
        g.rotate(ang + Math.sin(t * (3 + sp)) * 0.06 * (1.2 - fill));
        const segs = 5;
        for (let i = 0; i < segs; i++) {
          const x0 = (i / segs) * len, x1 = ((i + 1) / segs) * len;
          const r0 = 0.2 * (1 - i / segs * 0.45), r1 = 0.2 * (1 - (i + 1) / segs * 0.45);
          const wob = Math.sin(t * 9 + i * 1.3) * 0.03 * (i + 1) * (1.1 - fill);
          g.fillStyle = i % 2 === 0 ? '#d9662e' : '#efe9dc';
          g.beginPath(); g.moveTo(x0, -r0 + wob); g.lineTo(x1, -r1 + wob * 1.3); g.lineTo(x1, r1 + wob * 1.3); g.lineTo(x0, r0 + wob); g.closePath(); g.fill();
        }
        g.strokeStyle = art.outline('#d9662e'); g.lineWidth = 0.035;
        g.beginPath(); g.moveTo(0, -0.2); g.lineTo(len, -0.11); g.lineTo(len, 0.11); g.lineTo(0, 0.2); g.closePath(); g.stroke();
        g.fillStyle = palette.metal[2]; g.beginPath(); g.arc(0, 0, 0.12, 0, 6.283); g.fill();
        g.strokeStyle = palette.metal[1]; g.lineWidth = 0.06; g.beginPath(); g.arc(0, 0, 0.22, 0, 6.283); g.stroke();
      } });
    }

    // round bales
    for (const [x, y, r] of BALES) {
      if (!inView(x, y, r + 6, view)) continue;
      F.shadow.cylinder(x, y, r, 1.3);
      F.object({ y: y + r, draw(g) {
        art.draw(g, baleSprite(r), x, y, r * 2.2, r * 2.2);
        if (snow > 0.1) { g.globalAlpha = clamp(snow, 0, 0.9); g.fillStyle = palette.snow[0]; g.beginPath(); g.ellipse(x, y, r * 0.8, r * 0.75, 0, 0, 6.283); g.fill(); g.globalAlpha = 1; }
      } });
    }
    // crates
    for (const [x, y, w, h, rot] of CRATES) {
      if (!inView(x, y, 6, view)) continue;
      const ht = h > 1.2 ? 1.6 : 0.85;
      F.shadow.box(x, y, w, Math.min(h, 1), rot, ht);
      F.object({ y: y + 0.5, draw(g) { const img = crateSprite(w, Math.min(h, 1)); art.draw(g, img, x, y, img.width / PPM, img.height / PPM, rot); } });
    }
    // fence
    if (inView((FENCE.x0 + FENCE.x1) / 2, FENCE.y, 16, view)) {
      const posts = [];
      for (let x = FENCE.x0; x <= FENCE.x1 + 0.01; x += FENCE.post) posts.push(x);
      for (const x of posts) F.shadow.pole(x, FENCE.y, 1.2, 0.14);
      const cx = (FENCE.x0 + FENCE.x1) / 2, W = FENCE.x1 - FENCE.x0;
      F.shadow.box(cx, FENCE.y, W, 0.07, 0, 1.08, 1.0);
      F.shadow.box(cx, FENCE.y, W, 0.07, 0, 0.62, 0.55);
      F.object({ y: FENCE.y, draw(g) {
        const tim = palette.timber;
        g.strokeStyle = art.shade(tim[2], -0.2); g.lineWidth = 0.2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(FENCE.x0, FENCE.y); g.lineTo(FENCE.x1, FENCE.y); g.stroke();
        g.strokeStyle = tim[3]; g.lineWidth = 0.1;
        g.beginPath(); g.moveTo(FENCE.x0, FENCE.y - 0.02); g.lineTo(FENCE.x1, FENCE.y - 0.02); g.stroke();
        for (const x of posts) {
          g.fillStyle = art.shade(tim[2], -0.25); g.fillRect(x - 0.15, FENCE.y - 0.15, 0.3, 0.3);
          g.fillStyle = tim[1]; g.fillRect(x - 0.1, FENCE.y - 0.1, 0.2, 0.2); g.fillStyle = tim[3]; g.fillRect(x - 0.07, FENCE.y - 0.08, 0.1, 0.08);
          if (snow > 0.2) { g.fillStyle = palette.snow[2]; g.fillRect(x - 0.08, FENCE.y - 0.08, 0.16, 0.16); }
        }
      } });
    }
    // dry-stone wall
    for (let i = 0; i < WALL.length - 1; i++) F.shadow.wall(WALL[i][0], WALL[i][1], WALL[i + 1][0], WALL[i + 1][1], 0.95, 0.7);
    F.object({ y: 50, draw(g) {
      for (const s of stones) {
        art.draw(g, stoneSprites[s.k % 4], s.x, s.y, s.r * 2.6, s.r * 2.6, s.k);
      }
      if (snow > 0.15) {
        g.globalAlpha = clamp(snow, 0, 0.85); g.fillStyle = palette.snow[0];
        for (const s of stones) if (s.k % 3 !== 0) { g.beginPath(); g.ellipse(s.x, s.y, s.r * 0.8, s.r * 0.6, 0, 0, 6.283); g.fill(); }
        g.globalAlpha = 1;
      }
    } });
    // tall grass tufts that sway with the local wind
    for (const [x, y, sc] of GRASS) {
      if (!inView(x, y, 2, view)) continue;
      F.object({ y: y - 0.3, draw(g, v) {
        const wnd = api2 ? api2.windAt(x, y) : { x: 0, y: 0, gust: 0 };
        const t = v.time || 0;
        const flutter = Math.sin(t * 2.3 + x * 0.7) * 0.05 * (0.3 + wnd.gust);
        const s = 2.6 * sc;
        const lean = clamp(Math.hypot(wnd.x, wnd.y) * 0.03 + flutter, 0, 0.35);
        g.translate(x, y); g.rotate(Math.atan2(wnd.y, wnd.x));
        g.scale(1 + lean * 0.5, 1 - lean * 0.25);           // blades comb out downwind
        g.drawImage(grassClump(sea), -s / 2 + lean * s * 0.35, -s / 2, s, s);
      } });
    }
  });
}
