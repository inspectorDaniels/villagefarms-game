// buildings — painted top-down roof sprites (gouache style), cached in the shared sprite cache.
// Pure top-down: walls show only as the eave edge; no directional light is baked (the core shadow
// pass casts the building's shadow). Only soft symmetric form shading: slopes darken toward the
// eaves, ridge caps catch a little light.

const OV = 0.45;   // eave overhang (m)
const AO = 0.7;    // margin for the contact shadow (m)

export function createPainter(art, P) {
  const PPM = art.PPM;
  const S = art.shade, M = art.mix;

  const MAT = {
    terracotta: { cols: P.roof.terracotta, course: 0.34, joint: 0.26, kind: 'tile' },
    slate: { cols: P.roof.slate, course: 0.27, joint: 0.36, kind: 'tile' },
    metal: { cols: P.roof.metal, course: 0.2, kind: 'corr' },
    fibre: { cols: [M(P.concrete[0], P.roof.metal[2], 0.35), P.concrete[1], M(P.concrete[2], P.roof.metal[0], 0.3)], course: 0.28, kind: 'corr' },
    panel: { cols: [M(P.timberPainted.cream, P.concrete[0], 0.4), P.timberPainted.cream, M(P.timberPainted.cream, P.concrete[1], 0.55)], course: 1.0, kind: 'seam' },
    felt: { cols: [S(P.timberPainted.green, -0.35), S(P.timberPainted.green, -0.2), M(P.timberPainted.green, P.roof.slate[1], 0.5)], course: 0.9, kind: 'batten' },
    thatch: { cols: P.roof.thatch, course: 0.5, kind: 'thatch' },
  };

  function pxRect(x, y, w, h, cx, cy) {
    return [Math.round(cx + x * PPM), Math.round(cy + y * PPM), Math.max(1, Math.round(w * PPM)), Math.max(1, Math.round(h * PPM))];
  }

  function contact(g, x, y, w, h, alpha = 0.34) {
    g.save();
    g.shadowColor = `rgba(20,24,36,${alpha})`;
    g.shadowBlur = AO * PPM * 0.9;
    g.fillStyle = `rgba(20,24,36,${alpha})`;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  function snowCover(g, rng, x, y, w, h, amount, ridgeY) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.globalAlpha = 0.82 * amount;
    g.fillStyle = P.snow[0];
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
    art.dabs(g, rng, Math.round(w * h * 5), x, y, w, h, [P.snow[1], P.snow[2], P.snow[0]], 0.08, 0.35, 0.5 * amount);
    // thinner at eaves (drip edges) and bare streak on the ridge
    g.globalAlpha = 0.35 * amount;
    g.fillStyle = S(P.snow[1], -0.15);
    g.fillRect(x, y, w, 0.12); g.fillRect(x, y + h - 0.12, w, 0.12);
    if (ridgeY != null) { g.fillRect(x, ridgeY - 0.05, w, 0.1); }
    g.restore();
  }

  // ---------------------------------------------------------------- gable roof (ridge along x)
  function gable(part, snow) {
    const { w, d, mat } = part;
    const key = `bld:gable:${mat}:${w}x${d}:${part.chim ? part.chim.join(';') : ''}:${part.sky ? part.sky.join(';') : ''}:${part.vent ? 1 : 0}:${part.stripe ? 1 : 0}:${part.open ? 1 : 0}:${snow ? 1 : 0}`;
    const RW = w + OV * 2, RD = d + OV * 2;
    const SW = RW + AO * 2, SD = RD + AO * 2;
    const m = MAT[mat] || MAT.slate;
    return {
      w: SW, h: SD,
      img: art.sprite(key, SW * PPM, SD * PPM, (g, pw, ph, rng) => {
        const cx = pw / 2, cy = ph / 2;
        // contact shadow around the walls
        g.setTransform(PPM, 0, 0, PPM, cx, cy);
        contact(g, -w / 2, -d / 2, w, d);
        // base noisy paint (pixel space)
        g.setTransform(1, 0, 0, 1, 0, 0);
        const [rx, ry, rw, rh] = pxRect(-RW / 2, -RD / 2, RW, RD, cx, cy);
        art.noiseFill(g, rx, ry, rw, rh, m.cols, { scale: 0.08, grain: 0.08, seed: 'bld:' + mat, px: 2 });
        g.setTransform(PPM, 0, 0, PPM, cx, cy);
        const x0 = -RW / 2, y0 = -RD / 2;
        g.save();
        g.beginPath(); g.rect(x0, y0, RW, RD); g.clip();
        const base = m.cols[1];
        // material texture
        if (m.kind === 'tile') {
          for (const side of [-1, 1]) {
            let row = 0;
            for (let t = 0.2; t < RD / 2; t += m.course, row++) {
              const yy = side * t;
              g.strokeStyle = S(base, -0.45); g.globalAlpha = 0.6; g.lineWidth = 0.04;
              g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + RW, yy); g.stroke();
              g.strokeStyle = S(base, 0.25); g.globalAlpha = 0.18; g.lineWidth = 0.03;
              g.beginPath(); g.moveTo(x0, yy - side * 0.05); g.lineTo(x0 + RW, yy - side * 0.05); g.stroke();
              // staggered joints + a few odd-coloured tiles
              g.strokeStyle = S(base, -0.35); g.globalAlpha = 0.28; g.lineWidth = 0.025;
              const off = (row % 2) * m.joint / 2;
              g.beginPath();
              for (let xx = x0 + off; xx < x0 + RW; xx += m.joint) { g.moveTo(xx, yy); g.lineTo(xx, yy - side * m.course * 0.9); }
              g.stroke();
              if (rng.chance(0.7)) {
                g.globalAlpha = 0.25; g.fillStyle = rng.pick([S(base, 0.18), S(base, -0.18), M(base, P.roof.moss, 0.3)]);
                const xx = x0 + off + rng.int(0, Math.floor(RW / m.joint)) * m.joint;
                g.fillRect(xx, side > 0 ? yy - m.course : yy, m.joint, m.course);
              }
            }
          }
        } else if (m.kind === 'corr') {
          for (let xx = x0; xx < x0 + RW; xx += m.course) {
            g.globalAlpha = 0.22; g.fillStyle = S(base, 0.25); g.fillRect(xx, y0, m.course * 0.35, RD);
            g.globalAlpha = 0.2; g.fillStyle = S(base, -0.3); g.fillRect(xx + m.course * 0.55, y0, m.course * 0.3, RD);
          }
          // sheet laps across the slope
          g.globalAlpha = 0.35; g.strokeStyle = S(base, -0.35); g.lineWidth = 0.04;
          for (const side of [-1, 1]) for (let t = 3; t < RD / 2 - 0.3; t += 3) { g.beginPath(); g.moveTo(x0, side * t); g.lineTo(x0 + RW, side * t); g.stroke(); }
          // rust / lichen streaks
          const n = Math.round(RW * 0.6);
          for (let i = 0; i < n; i++) {
            const xx = x0 + rng.float() * RW, side = rng.chance(0.5) ? -1 : 1, len = rng.range(0.4, 2.2);
            g.globalAlpha = rng.range(0.08, 0.2);
            g.fillStyle = mat === 'fibre' ? rng.pick([P.roof.moss, '#c9c070', S(base, -0.3)]) : P.rust;
            g.fillRect(xx, side > 0 ? RD / 2 - len : -RD / 2, rng.range(0.08, 0.3), len);
          }
        } else if (m.kind === 'seam') {
          g.globalAlpha = 0.4; g.strokeStyle = S(base, -0.3); g.lineWidth = 0.05;
          for (let xx = x0 + 0.5; xx < x0 + RW; xx += m.course) { g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y0 + RD); g.stroke(); }
          g.globalAlpha = 0.25; g.strokeStyle = S(base, 0.35); g.lineWidth = 0.03;
          for (let xx = x0 + 0.56; xx < x0 + RW; xx += m.course) { g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y0 + RD); g.stroke(); }
        } else if (m.kind === 'batten') {
          g.globalAlpha = 0.45; g.strokeStyle = S(base, -0.4); g.lineWidth = 0.06;
          for (let xx = x0 + 0.4; xx < x0 + RW; xx += m.course) { g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y0 + RD); g.stroke(); }
        } else if (m.kind === 'thatch') {
          for (let i = 0; i < RW * RD * 22; i++) {
            const xx = x0 + rng.float() * RW, side = rng.chance(0.5) ? -1 : 1, t = rng.float() * RD / 2;
            g.globalAlpha = rng.range(0.15, 0.35);
            g.strokeStyle = rng.pick([S(base, 0.2), S(base, -0.3), m.cols[2], m.cols[0]]);
            g.lineWidth = rng.range(0.03, 0.06);
            g.beginPath(); g.moveTo(xx, side * t); g.lineTo(xx + rng.range(-0.05, 0.05), side * (t + rng.range(0.25, 0.6))); g.stroke();
          }
        }
        g.globalAlpha = 1;
        // symmetric form shading: light at the ridge, darker toward both eaves
        const gr = g.createLinearGradient(0, y0, 0, y0 + RD);
        gr.addColorStop(0, 'rgba(20,24,40,0.26)'); gr.addColorStop(0.42, 'rgba(255,248,230,0.05)');
        gr.addColorStop(0.5, 'rgba(255,248,230,0.1)'); gr.addColorStop(0.58, 'rgba(255,248,230,0.05)'); gr.addColorStop(1, 'rgba(20,24,40,0.26)');
        g.fillStyle = gr; g.fillRect(x0, y0, RW, RD);
        // moss on the front slope eave (tiles, thatch)
        if (m.kind === 'tile' || m.kind === 'thatch') {
          g.save(); g.beginPath(); g.rect(x0, y0, RW, RD / 2); g.clip();
          art.dabs(g, rng, Math.round(RW * 3), x0, y0, RW, RD * 0.22, [P.roof.moss, M(P.roof.moss, base, 0.4), S(P.roof.moss, 0.15)], 0.08, 0.3, 0.35);
          g.restore();
        }
        // ridge cap
        const capW = m.kind === 'thatch' ? 0.7 : 0.34;
        g.fillStyle = m.kind === 'tile' ? S(base, -0.15) : m.kind === 'thatch' ? S(base, -0.25) : S(base, 0.12);
        g.globalAlpha = 0.9; g.fillRect(x0, -capW / 2, RW, capW); g.globalAlpha = 1;
        if (m.kind === 'tile') {
          g.strokeStyle = S(base, -0.45); g.lineWidth = 0.025; g.globalAlpha = 0.5;
          g.beginPath(); for (let xx = x0 + 0.1; xx < x0 + RW; xx += 0.42) { g.moveTo(xx, -capW / 2); g.lineTo(xx, capW / 2); } g.stroke();
        }
        g.strokeStyle = S(base, 0.35); g.lineWidth = 0.03; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + RW, 0); g.stroke();
        g.globalAlpha = 1;
        if (part.vent) {
          // ridge ventilation strip (livestock sheds)
          g.fillStyle = S(P.roof.metal[2], -0.2); g.fillRect(x0 + 1, -0.35, RW - 2, 0.7);
          g.strokeStyle = S(P.roof.metal[0], 0.25); g.lineWidth = 0.04; g.globalAlpha = 0.6;
          g.beginPath(); for (let xx = x0 + 1.2; xx < x0 + RW - 1; xx += 0.3) { g.moveTo(xx, -0.3); g.lineTo(xx, 0.3); } g.stroke();
          g.globalAlpha = 1;
        }
        if (part.stripe) {
          // dealer: translucent roof-light strips
          g.globalAlpha = 0.55; g.fillStyle = M(P.glass, '#dfeee9', 0.55);
          for (let xx = x0 + 2.5; xx < x0 + RW - 2; xx += 4.5) { g.fillRect(xx, -RD / 2 + 1.5, 0.9, RD / 2 - 2.2); g.fillRect(xx, 0.7, 0.9, RD / 2 - 2.2); }
          g.globalAlpha = 1;
        }
        // skylights (they glow at night via F.light)
        for (const [sx, sy] of part.sky || []) {
          for (const sd of [-1, 1]) {
            const yy = sd * sy;
            g.fillStyle = S(base, -0.4); g.fillRect(sx - 0.55, yy - 0.45, 1.1, 0.9);
            const gg = g.createLinearGradient(sx - 0.45, yy - 0.35, sx + 0.45, yy + 0.35);
            gg.addColorStop(0, S(P.glass, 0.3)); gg.addColorStop(0.5, P.glass); gg.addColorStop(1, S(P.glass, -0.25));
            g.fillStyle = gg; g.fillRect(sx - 0.45, yy - 0.35, 0.9, 0.7);
            g.strokeStyle = S(P.glass, 0.4); g.lineWidth = 0.03; g.beginPath(); g.moveTo(sx, yy - 0.35); g.lineTo(sx, yy + 0.35); g.stroke();
          }
        }
        // gutters (long sides) and verges (gable ends)
        g.fillStyle = S(P.metal[2], -0.1); g.globalAlpha = m.kind === 'thatch' ? 0 : 0.75;
        g.fillRect(x0, y0, RW, 0.12); g.fillRect(x0, y0 + RD - 0.12, RW, 0.12);
        g.globalAlpha = 0.5; g.fillStyle = S(base, -0.45);
        g.fillRect(x0, y0, 0.14, RD); g.fillRect(x0 + RW - 0.14, y0, 0.14, RD);
        g.globalAlpha = 1;
        if (snow) snowCover(g, rng, x0, y0, RW, RD, 1, 0);
        // chimneys (brick stacks on the ridge)
        for (const [chx, chy] of part.chim || []) {
          const cw = 0.75, ch = 0.9;
          g.fillStyle = P.brick[2]; g.fillRect(chx - cw / 2, chy - ch / 2, cw, ch);
          g.fillStyle = P.brick[1]; g.fillRect(chx - cw / 2 + 0.06, chy - ch / 2 + 0.06, cw - 0.12, ch - 0.12);
          g.strokeStyle = S(P.brick[0], -0.3); g.lineWidth = 0.02; g.globalAlpha = 0.6;
          g.beginPath(); for (let k = 1; k < 4; k++) { g.moveTo(chx - cw / 2, chy - ch / 2 + k * ch / 4); g.lineTo(chx + cw / 2, chy - ch / 2 + k * ch / 4); } g.stroke();
          g.globalAlpha = 1;
          g.fillStyle = S(P.concrete[1], -0.1); g.fillRect(chx - 0.3, chy - 0.3, 0.6, 0.6);
          g.fillStyle = '#2a2622'; g.beginPath(); g.arc(chx - 0.1, chy, 0.12, 0, Math.PI * 2); g.arc(chx + 0.14, chy, 0.12, 0, Math.PI * 2); g.fill();
          if (snow) { g.fillStyle = P.snow[0]; g.globalAlpha = 0.8; g.fillRect(chx - cw / 2, chy - ch / 2, cw, 0.15); g.globalAlpha = 1; }
          g.strokeStyle = art.outline(P.brick[1]); g.lineWidth = 0.04; g.strokeRect(chx - cw / 2, chy - ch / 2, cw, ch);
        }
        g.restore();
        g.strokeStyle = art.outline(base); g.lineWidth = 0.07; g.globalAlpha = 0.85;
        g.strokeRect(x0, y0, RW, RD);
        g.globalAlpha = 1;
        g.setTransform(1, 0, 0, 1, 0, 0);
        art.grain(g, pw, ph, rng, 0.05, 0.012);
      }),
    };
  }

  // ---------------------------------------------------------------- round silo / tank
  function silo(part, snow) {
    const r = part.r, tank = !!part.tank;
    const key = `bld:silo:${r}:${tank ? 1 : 0}:${snow ? 1 : 0}`;
    const SZ = (r + AO + 0.2) * 2;
    return {
      w: SZ, h: SZ,
      img: art.sprite(key, SZ * PPM, SZ * PPM, (g, pw, ph, rng) => {
        g.setTransform(PPM, 0, 0, PPM, pw / 2, ph / 2);
        g.save(); g.shadowColor = 'rgba(20,24,36,0.34)'; g.shadowBlur = AO * PPM * 0.9; g.fillStyle = 'rgba(20,24,36,0.34)';
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
        const base = tank ? M(P.metal[1], '#f0f2f2', 0.35) : P.metal[1];
        const gr = g.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
        gr.addColorStop(0, S(base, 0.3)); gr.addColorStop(0.6, base); gr.addColorStop(1, S(base, -0.3));
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
        g.save(); g.clip();
        // cone panels (radial seams) and corrugation rings on the eave ring
        const n = Math.max(12, Math.round(r * 5));
        g.strokeStyle = S(base, -0.35); g.lineWidth = 0.035; g.globalAlpha = 0.5;
        g.beginPath();
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.moveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.stroke();
        g.globalAlpha = 0.35; g.lineWidth = 0.05;
        for (let rr = r - 0.12; rr > r - 0.55; rr -= 0.14) { g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke(); }
        art.dabs(g, rng, Math.round(r * r * 8), -r, -r, r * 2, r * 2, [S(base, 0.15), S(base, -0.15), tank ? S(base, 0.3) : P.rust], 0.05, 0.25, 0.14);
        if (!tank) {
          // ladder + walkway to the top hatch
          g.globalAlpha = 0.8; g.strokeStyle = S(P.metal[2], -0.35); g.lineWidth = 0.05;
          g.beginPath(); g.moveTo(-0.18, -r); g.lineTo(-0.18, -0.6); g.moveTo(0.18, -r); g.lineTo(0.18, -0.6); g.stroke();
          g.lineWidth = 0.03; g.beginPath(); for (let yy = -r + 0.2; yy < -0.6; yy += 0.3) { g.moveTo(-0.18, yy); g.lineTo(0.18, yy); } g.stroke();
        }
        g.globalAlpha = 1;
        if (snow) { g.globalAlpha = 0.75; g.fillStyle = P.snow[0]; g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
        g.restore();
        // top hatch
        g.beginPath(); g.arc(0, 0, Math.min(0.6, r * 0.18), 0, Math.PI * 2);
        g.fillStyle = S(base, 0.2); g.fill(); g.strokeStyle = S(base, -0.45); g.lineWidth = 0.05; g.stroke();
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.strokeStyle = art.outline(base); g.lineWidth = 0.08; g.stroke();
        g.setTransform(1, 0, 0, 1, 0, 0);
        art.grain(g, pw, ph, rng, 0.05, 0.012);
      }),
    };
  }

  // ---------------------------------------------------------------- church tower with spire
  function tower(part, snow) {
    const { w, d } = part;
    const key = `bld:tower:${w}x${d}:${snow ? 1 : 0}`;
    const SW = w + AO * 2 + 0.4, SD = d + AO * 2 + 0.4;
    return {
      w: SW, h: SD,
      img: art.sprite(key, SW * PPM, SD * PPM, (g, pw, ph, rng) => {
        const cx = pw / 2, cy = ph / 2;
        g.setTransform(PPM, 0, 0, PPM, cx, cy);
        contact(g, -w / 2, -d / 2, w, d, 0.4);
        g.setTransform(1, 0, 0, 1, 0, 0);
        const [rx, ry, rw, rh] = pxRect(-w / 2, -d / 2, w, d, cx, cy);
        art.noiseFill(g, rx, ry, rw, rh, P.concrete, { scale: 0.06, grain: 0.08, seed: 'bld:stone', px: 2 });
        g.setTransform(PPM, 0, 0, PPM, cx, cy);
        // parapet stones
        g.strokeStyle = S(P.concrete[1], -0.35); g.lineWidth = 0.04; g.globalAlpha = 0.5;
        g.strokeRect(-w / 2 + 0.35, -d / 2 + 0.35, w - 0.7, d - 0.7);
        g.globalAlpha = 1;
        // spire: four slate faces meeting at the finial (symmetric tones)
        const i = 0.55, hx = w / 2 - i, hy = d / 2 - i;
        const faces = [
          [[-hx, -hy], [hx, -hy]], [[hx, -hy], [hx, hy]], [[hx, hy], [-hx, hy]], [[-hx, hy], [-hx, -hy]],
        ];
        faces.forEach(([a, b], k) => {
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(0, 0); g.closePath();
          g.fillStyle = k % 2 ? S(P.roof.slate[0], -0.08) : S(P.roof.slate[1], 0.02); g.fill();
          g.save(); g.clip();
          g.strokeStyle = S(P.roof.slate[0], -0.4); g.lineWidth = 0.03; g.globalAlpha = 0.45;
          for (let t = 0.12; t < 1; t += 0.1) { g.beginPath(); g.moveTo(a[0] * (1 - t), a[1] * (1 - t)); g.lineTo(b[0] * (1 - t), b[1] * (1 - t)); g.stroke(); }
          if (snow) { g.globalAlpha = 0.6; g.fillStyle = P.snow[0]; g.fillRect(-w, -d, w * 2, d * 2); }
          g.restore();
        });
        g.strokeStyle = S(P.roof.slate[2], 0.3); g.lineWidth = 0.05; g.globalAlpha = 0.6;
        g.beginPath(); g.moveTo(-hx, -hy); g.lineTo(hx, hy); g.moveTo(hx, -hy); g.lineTo(-hx, hy); g.stroke();
        g.globalAlpha = 1;
        g.beginPath(); g.arc(0, 0, 0.22, 0, Math.PI * 2); g.fillStyle = P.ui.gold; g.fill(); g.strokeStyle = S(P.ui.gold, -0.5); g.lineWidth = 0.04; g.stroke();
        g.strokeStyle = art.outline(P.concrete[1]); g.lineWidth = 0.08; g.strokeRect(-w / 2, -d / 2, w, d);
        g.setTransform(1, 0, 0, 1, 0, 0);
        art.grain(g, pw, ph, rng, 0.05, 0.012);
      }),
    };
  }

  // ---------------------------------------------------------------- ground aprons (door step / concrete apron)
  function apron(width, depth) {
    const key = `bld:apron:${width}x${depth}`;
    return art.sprite(key, (width + 0.6) * PPM, (depth + 0.6) * PPM, (g, pw, ph, rng) => {
      const x = 0.3 * PPM, y = 0.3 * PPM, w = width * PPM, h = depth * PPM;
      art.noiseFill(g, Math.round(x), Math.round(y), Math.round(w), Math.round(h), P.concrete, { scale: 0.08, grain: 0.1, seed: 'bld:apron', px: 2 });
      // feathered edges
      g.globalCompositeOperation = 'destination-in';
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.75, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0.0)');
      g.fillStyle = gr; g.fillRect(0, 0, pw, ph);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(40,40,44,0.25)'; g.lineWidth = 1;
      for (let xx = x + 1.5 * PPM; xx < x + w; xx += 3 * PPM) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h * 0.8); g.stroke(); }
      art.dabs(g, rng, Math.round(width * depth * 3), x, y, w, h * 0.8, ['rgba(70,60,50,0.5)', 'rgba(90,80,60,0.4)'], 2, 7, 0.25);
    });
  }

  return { gable, silo, tower, apron, OV, AO };
}
