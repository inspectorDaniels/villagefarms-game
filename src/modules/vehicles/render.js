// vehicles — drawing (y-sorted objects + shadow casters + lights) and cosmetic effects/audio.
import { ALL, TYPES, DUSTY, SOFT } from './types.js';
import { toWorld } from './drive.js';

const TAU = Math.PI * 2;

export function createRender({ ctx, W, byId, painter, driver, mod, fxRng, isDark }) {
  const art = ctx.art, P = ctx.palette;
  const engines = new Map(); // vehicleId -> audio loop handle
  const HEAD = P.headlight || [255, 236, 200];

  const ao = art.sprite('veh:ao', 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(22,26,36,0.55)'); gr.addColorStop(0.6, 'rgba(22,26,36,0.3)'); gr.addColorStop(1, 'rgba(22,26,36,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  function bodySprite(v) {
    const T = ALL[v.type];
    const col = v.paint || T.paint;
    if (T.kind === 'tractor') return painter.tractor(T, col);
    if (T.kind === 'combine') return painter.combine(T, col);
    if (T.kind === 'car') return painter.pickup(T, col);
    return painter.implement(v.type);
  }
  function tyrePhase(odo, d) { const pitch = Math.max(0.12, d * 0.11); return Math.floor(((odo || 0) / (pitch / 4))) & 3; }
  function drawTyre(g, x, y, rot, t, phase, lugs) {
    const img = painter.tyre(t.d, t.w, phase, lugs);
    art.draw(g, img, x, y, t.w + 0.1, t.d + 0.1, rot);
  }
  function wheelsOf(v) {
    const T = ALL[v.type];
    const out = [];
    if (T.tyreF) {
      const fs = T.rearSteer ? 0 : v.steer || 0, rs = T.rearSteer ? -(v.steer || 0) : 0;
      for (const s of [-1, 1]) {
        out.push([s * T.tyreF.x, T.fy, fs, T.tyreF]);
        out.push([s * T.tyreR.x, T.ry, rs, T.tyreR]);
      }
    } else if (T.mount === 'trailed') {
      const tw = { d: T.look === 'baler' ? 0.8 : 0.95, w: 0.42 };
      for (const s of [-1, 1]) {
        if (T.look === 'grainTrailer' || T.look === 'flatbed') { out.push([s * (T.wid / 2 - 0.2), T.axleY - 0.55, 0, tw]); out.push([s * (T.wid / 2 - 0.2), T.axleY + 0.55, 0, tw]); }
        else out.push([s * (T.wid / 2 - 0.1), T.axleY, 0, tw]);
      }
    }
    return out;
  }

  function drawVehicle(g, v, view) {
    const T = ALL[v.type];
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    // contact occlusion
    art.draw(g, ao, v.x, v.y, T.wid + 0.9, T.len + 0.9, v.rot, 0.8);
    g.translate(v.x, v.y); g.rotate(v.rot);
    const lugs = T.kind !== 'car' && T.mount !== 'trailed';
    for (const [lx, ly, st, t] of wheelsOf(v)) drawTyre(g, lx, ly, st, t, tyrePhase(v.odo, t.d), lugs);
    // sprayer / spreader: unfolded boom when working
    if (T.look === 'sprayer' && v.lowered) art.draw(g, painter.boom(T.work.width), 0, T.len / 2 - 0.1, T.work.width + 0.7, 1.2);
    const img = bodySprite(v);
    const pad = painter.PAD * 2;
    art.draw(g, img, 0, 0, T.wid + pad, T.len + pad);
    // cargo heap
    const capKg = T.grainTank || (T.look === 'grainTrailer' ? T.capacity : 0);
    if (capKg && v.cargo && v.cargo.kg > 0) {
      const f = Math.min(1, v.cargo.kg / capKg);
      if (T.header) art.draw(g, painter.grainPile(+(T.wid * 0.6).toFixed(2), +(T.len * 0.3).toFixed(2), v.cargo.item), 0, -T.len / 2 + 1.9 + T.len * 0.18, T.wid * 0.6 * (0.5 + 0.5 * f) + 0.4, T.len * 0.3 * (0.5 + 0.5 * f) + 0.4, 0, 0.5 + 0.5 * f);
      else art.draw(g, painter.grainPile(+(T.wid - 0.35).toFixed(2), +(T.len - 1.3).toFixed(2), v.cargo.item), 0, 0.5, (T.wid - 0.35) * (0.6 + 0.4 * f) + 0.5, (T.len - 1.3) * (0.7 + 0.3 * f) + 0.5, 0, 0.45 + 0.55 * f);
    }
    // combine header + animated reel
    if (T.header) {
      const H = T.header, hy = -T.len / 2 - H.depth / 2 + 0.1;
      art.draw(g, painter.header(T, v.paint || T.paint), 0, hy, H.width + pad, H.depth + pad);
      const spin = v.lowered ? (view.time || 0) * 3.2 : 0;
      g.strokeStyle = art.shade(P.paint.tractorYellow, -0.1); g.lineWidth = 0.07; g.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const ph = ((k / 5 + spin / TAU) % 1 + 1) % 1;
        const yy = hy - H.depth * 0.32 + Math.cos(ph * TAU) * H.depth * 0.26;
        g.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * TAU));
        g.beginPath(); g.moveTo(-H.width / 2 + 0.3, yy); g.lineTo(H.width / 2 - 0.3, yy); g.stroke();
      }
      g.globalAlpha = 1;
      g.strokeStyle = art.shade(P.paint.tractorYellow, -0.4); g.lineWidth = 0.05;
      g.beginPath(); g.moveTo(-H.width / 2 + 0.25, hy - H.depth * 0.32); g.lineTo(H.width / 2 - 0.25, hy - H.depth * 0.32); g.stroke();
      // auger swung out while unloading
      if (v.unloading) {
        g.strokeStyle = art.shade(P.paint[v.paint || T.paint] || P.paint.tractorGreen, -0.3); g.lineWidth = 0.32;
        g.beginPath(); g.moveTo(-T.wid / 2 + 0.1, -T.len * 0.1 + 0.4); g.lineTo(-T.wid / 2 - 3.2, -T.len * 0.1); g.stroke();
      }
    }
    // beacon on the roof
    if (T.beacon && v.lights) {
      const t = view.time || 0;
      const by = T.kind === 'combine' ? -T.len / 2 + 0.6 : -T.len * 0.02;
      g.fillStyle = art.mix('#f4a340', '#fff2c0', 0.5 + 0.5 * Math.sin(t * 9));
      g.beginPath(); g.arc(0, by, 0.12, 0, TAU); g.fill();
    }
    g.rotate(-v.rot); g.translate(-v.x, -v.y);
    void c; void s;
  }

  function submitShadows(F, v) {
    const T = ALL[v.type];
    if (T.kind === 'tractor') {
      const [hx, hy] = toWorld(v.x, v.y, v.rot, 0, -T.len * 0.22);
      F.shadow.box(hx, hy, T.wid * 0.42, T.len * 0.55, v.rot, T.height * 0.55);
      const [cx, cy] = toWorld(v.x, v.y, v.rot, 0, T.len * 0.12);
      F.shadow.box(cx, cy, T.wid * 0.66, T.len * 0.36, v.rot, T.height);
      for (const sx of [-1, 1]) {
        const [wx, wy] = toWorld(v.x, v.y, v.rot, sx * T.tyreR.x, T.ry);
        F.shadow.box(wx, wy, T.tyreR.w, T.tyreR.d * 0.9, v.rot, T.tyreR.d);
      }
    } else if (T.kind === 'combine') {
      F.shadow.box(v.x, v.y, T.wid * 0.85, T.len * 0.9, v.rot, T.height);
      const [hx, hy] = toWorld(v.x, v.y, v.rot, 0, -T.len / 2 - T.header.depth / 2);
      F.shadow.box(hx, hy, T.header.width, T.header.depth * 0.8, v.rot, 1.2, 0.2);
    } else if (T.kind === 'car') {
      const [cx, cy] = toWorld(v.x, v.y, v.rot, 0, -T.len * 0.05);
      F.shadow.box(cx, cy, T.wid * 0.9, T.len * 0.35, v.rot, T.height);
      F.shadow.box(v.x, v.y, T.wid * 0.95, T.len * 0.95, v.rot, T.height * 0.55);
    } else {
      F.shadow.box(v.x, v.y, T.wid * 0.85, T.len * 0.8, v.rot, T.height, T.mount === 'trailed' ? 0.3 : 0.15);
      if (T.look === 'sprayer' && v.lowered) { const [bx, by] = toWorld(v.x, v.y, v.rot, 0, T.len / 2); F.shadow.box(bx, by, T.work.width, 0.25, v.rot, 1.1, 0.8); }
    }
  }

  function submitLights(F, v, view) {
    const T = ALL[v.type];
    if (!v.lights || !TYPES[v.type]) return;
    const fwd = v.rot - Math.PI / 2;
    const frontY = -T.len / 2 - (T.header ? T.header.depth : 0);
    for (const sx of [-1, 1]) {
      const [lx, ly] = toWorld(v.x, v.y, v.rot, sx * T.wid * 0.3, frontY + 0.1);
      F.light({ x: lx, y: ly, radius: T.kind === 'car' ? 26 : 20, color: HEAD, intensity: 0.85, cone: { angle: fwd, spread: 0.42 }, glow: 0.9, glowRadius: 0.55 });
      const [tx, ty] = toWorld(v.x, v.y, v.rot, sx * T.wid * 0.36, T.len / 2 - 0.05);
      F.light({ x: tx, y: ty, radius: 2.4, color: [230, 60, 40], intensity: 0.55, glow: 0.9, glowRadius: 0.35 });
    }
    // work lights to the rear while an implement is down
    if (v.lowered && T.kind === 'tractor') {
      const [wx, wy] = toWorld(v.x, v.y, v.rot, 0, T.len * 0.15);
      F.light({ x: wx, y: wy, radius: 13, color: HEAD, intensity: 0.6, cone: { angle: fwd + Math.PI, spread: 0.7 } });
    }
    if (T.beacon) {
      const by = T.kind === 'combine' ? -T.len / 2 + 0.6 : -T.len * 0.02;
      const [bx, byy] = toWorld(v.x, v.y, v.rot, 0, by);
      const pulse = 0.5 + 0.5 * Math.sin((view.time || 0) * 9);
      F.light({ x: bx, y: byy, radius: 6, color: [255, 160, 50], intensity: 0.25 + 0.45 * pulse, glow: 1, glowRadius: 0.45 + 0.3 * pulse });
    }
  }

  function collect(view, F) {
    const m = 12;
    for (const v of W.list) {
      if (v.x < view.x0 - m || v.x > view.x1 + m || v.y < view.y0 - m || v.y > view.y1 + m) continue;
      const T = ALL[v.type];
      // implements draw just behind the tractor they hang on (sorted by their own y)
      F.object({ y: v.y + (T.mount === 'rear' || T.mount === 'trailed' ? -0.01 : 0), draw: (g) => drawVehicle(g, v, view) });
      submitShadows(F, v);
      submitLights(F, v, view);
    }
  }

  // ---------------------------------------------------------------- cosmetic effects (called from the fixed step)
  function endTrails(v) {
    const fx = mod('effects');
    if (!fx || !fx.endTrail) return;
    fx.endTrail(v.id + ':w');
  }
  function fx(v, parts, surf, sp, thr) {
    const fxm = mod('effects');
    if (!fxm) return;
    const T = ALL[v.type];
    v._fx = (v._fx || 0) + 1;
    const n = v._fx;
    const env = ctx.world.environment || {};
    const wet = env.weather && Number.isFinite(env.weather.wetness) ? env.weather.wetness : 0;
    const moving = Math.abs(sp) > 0.3;
    // tyre trails on soft / dirty ground (every 3rd step; ribbons interpolate)
    if (moving && (n % 3) === 0 && (SOFT.has(surf) || DUSTY.has(surf) || wet > 0.4) && surf !== 'road') {
      for (const sx of [-1, 1]) {
        const [x, y] = toWorld(v.x, v.y, v.rot, sx * T.tyreR.x, T.ry);
        fxm.trail(v.id + (sx < 0 ? ':L' : ':R'), x, y, v.rot, T.tyreR.w, 'tyre');
      }
      for (const p of parts) {
        const I = ALL[p.type];
        if (I.mount === 'trailed') for (const sx of [-1, 1]) {
          const [x, y] = toWorld(p.x, p.y, p.rot, sx * (I.wid / 2 - 0.2), I.axleY);
          fxm.trail(p.id + (sx < 0 ? ':L' : ':R'), x, y, p.rot, 0.42, 'tyre');
        }
      }
    }
    // working strips (furrow / track ribbons behind lowered implements)
    if (moving && (n % 2) === 0) {
      for (const p of parts) {
        const I = ALL[p.type];
        if (!p.lowered || !I.work || !I.work.trail) continue;
        const [x, y] = toWorld(p.x, p.y, p.rot, 0, I.len / 2 - 0.1);
        fxm.trail(p.id + ':w', x, y, p.rot, I.work.width, I.work.trail);
        if (I.work.tool === 'plough' && (n % 8) === 0) fxm.emit('clods', x + (fxRng.float() - 0.5) * I.work.width, y, { count: 1, size: 0.18, z: 0.3 });
      }
    }
    const dryness = Math.max(0, 1 - wet * 1.4);
    // dust behind the rear wheels
    if (moving && DUSTY.has(surf) && dryness > 0.05 && Math.abs(sp) > 1.6 && (n % 4) === 0) {
      const [x, y] = toWorld(v.x, v.y, v.rot, (fxRng.float() - 0.5) * T.wid, T.len / 2 + 0.3);
      fxm.emit('dust', x, y, { count: 1, dirX: -Math.sin(v.rot) * 0.4, dirY: Math.cos(v.rot) * 0.4, speed: 0.6, size: 1.1 + Math.min(1.5, Math.abs(sp) * 0.15), alpha: 0.35 * dryness * Math.min(1, Math.abs(sp) / 5) + 0.1 });
    }
    // combine chaff while harvesting
    if (T.header && v.lowered && moving && (n % 5) === 0) {
      const [x, y] = toWorld(v.x, v.y, v.rot, (fxRng.float() - 0.5) * T.wid * 0.6, T.len / 2 + 0.4);
      fxm.emit('chaff', x, y, { count: 2, dirX: -Math.sin(v.rot), dirY: Math.cos(v.rot), speed: 1.2 });
    }
    // exhaust puffs: rate follows engine load
    if (v.engine) {
      const every = Math.max(3, Math.round(16 - 12 * (v.load || 0)));
      if ((n % every) === 0) {
        const stack = T.kind === 'combine' ? [T.wid * 0.3, T.len / 2 - 2.3] : T.kind === 'car' ? [0.6, T.len / 2 + 0.1] : [T.wid * 0.18, -0.35];
        const [x, y] = toWorld(v.x, v.y, v.rot, stack[0], stack[1]);
        fxm.emit('exhaust', x, y, { count: 1, z: T.kind === 'car' ? 0.3 : T.height * 0.95, size: 0.35 + 0.6 * (v.load || 0), alpha: 0.18 + 0.4 * (v.load || 0) * (1 - 0.5 * (v.wear < 0.5 ? 1 : 0)) });
      }
    }
  }

  // ---------------------------------------------------------------- engine audio (cosmetic, per frame)
  function frame() {
    const audio = mod('audio');
    if (!audio || !audio.loop) return;
    for (const v of W.list) {
      const T = TYPES[v.type];
      if (!T) continue;
      let h = engines.get(v.id);
      if (v.engine) {
        const rpm = Math.min(1, 0.22 + 0.55 * Math.abs(v.speed) / Math.max(1, T.vmax) + 0.35 * (v.load || 0));
        if (!h) { h = audio.loop(T.engine || 'engine-tractor', { x: v.x, y: v.y, rpm, load: v.load || 0 }); if (h) engines.set(v.id, h); }
        else { h.setPosition(v.x, v.y); h.setParam('rpm', rpm); h.setParam('load', v.load || 0); }
      } else if (h) { h.stop(0.6); engines.delete(v.id); }
    }
  }
  function release(v) {
    const h = engines.get(v.id);
    if (h) { h.stop(0.2); engines.delete(v.id); }
    const fxm = mod('effects');
    if (fxm && fxm.endTrail) { fxm.endTrail(v.id + ':L'); fxm.endTrail(v.id + ':R'); fxm.endTrail(v.id + ':w'); }
  }
  void byId; void driver; void isDark;
  return { collect, fx, frame, endTrails, release };
}
