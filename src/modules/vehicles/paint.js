// vehicles — painted top-down sprites (gouache style). Painted once into the sprite cache at
// art.PPM px/m, facing north (front = top). Wheels are separate sprites (4 tread phases) so they
// can steer and roll. No directional light is baked: only symmetric form shading.
import { ALL } from './types.js';

export function createPainter(art, P) {
  const PPM = art.PPM;
  const S = art.shade, M = art.mix;
  const PAD = 0.35; // metres of padding around bodies (outline + contact shadow)

  function rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  /** painted panel: base + symmetric cross-shading (form, not sun) + dabs + tinted outline */
  function panel(g, rng, x, y, w, h, r, col, o = {}) {
    rrect(g, x, y, w, h, r);
    g.fillStyle = col; g.fill();
    g.save(); rrect(g, x, y, w, h, r); g.clip();
    const horiz = o.horiz !== false;
    const gr = horiz ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, S(col, -0.28)); gr.addColorStop(0.3, S(col, 0.05)); gr.addColorStop(0.5, S(col, o.gloss || 0.18));
    gr.addColorStop(0.7, S(col, 0.05)); gr.addColorStop(1, S(col, -0.28));
    g.fillStyle = gr; g.globalAlpha = 0.85; g.fillRect(x, y, w, h); g.globalAlpha = 1;
    const n = Math.max(3, Math.round(w * h * 14));
    art.dabs(g, rng, n, x, y, w, h, [S(col, 0.12), S(col, -0.12), M(col, '#e8d8b0', 0.2)], 0.03, Math.min(0.16, Math.min(w, h) * 0.3), 0.22);
    if (o.ridge) { g.strokeStyle = S(col, 0.35); g.lineWidth = 0.05; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x + w / 2, y + 0.08); g.lineTo(x + w / 2, y + h - 0.08); g.stroke(); g.globalAlpha = 1; }
    g.restore();
    rrect(g, x, y, w, h, r);
    g.strokeStyle = art.outline(col); g.lineWidth = o.lw || 0.05; g.stroke();
  }
  function glass(g, x, y, w, h, r) {
    rrect(g, x, y, w, h, r);
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, S(P.glass, 0.25)); gr.addColorStop(0.45, P.glass); gr.addColorStop(0.55, S(P.glass, 0.35)); gr.addColorStop(1, S(P.glass, -0.2));
    g.fillStyle = gr; g.fill();
    g.strokeStyle = art.outline(P.glass); g.lineWidth = 0.04; g.stroke();
  }
  function metal(g, rng, x, y, w, h, r, col = P.metal[0]) { panel(g, rng, x, y, w, h, r, col, { gloss: 0.3, lw: 0.035 }); }
  function dot(g, x, y, r, col, line) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); if (line) { g.strokeStyle = line; g.lineWidth = 0.03; g.stroke(); } }
  function begin(key, wM, hM, fn) {
    return art.sprite(key, (wM + PAD * 2) * PPM, (hM + PAD * 2) * PPM, (g, w, h, rng) => {
      g.translate(w / 2, h / 2); g.scale(PPM, PPM);
      fn(g, rng, wM, hM);
      g.setTransform(1, 0, 0, 1, 0, 0);
      art.grain(g, w, h, rng, 0.05, 0.01);
    });
  }
  const paintCol = (name) => (P.paint && P.paint[name]) || P.paint.tractorRed;

  // ---------------------------------------------------------------- tyres (4 roll phases)
  function tyre(d, w, phase, lugs = true) {
    const key = `veh:tyre:${d}:${w}:${phase}:${lugs ? 1 : 0}`;
    return art.sprite(key, (w + 0.1) * PPM, (d + 0.1) * PPM, (g, pw, ph, rng) => {
      g.translate(pw / 2, ph / 2); g.scale(PPM, PPM);
      rrect(g, -w / 2, -d / 2, w, d, Math.min(w * 0.3, 0.12));
      const gr = g.createLinearGradient(0, -d / 2, 0, d / 2);
      gr.addColorStop(0, S(P.tyre, -0.2)); gr.addColorStop(0.5, S(P.tyre, 0.14)); gr.addColorStop(1, S(P.tyre, -0.2));
      g.fillStyle = gr; g.fill();
      g.save(); rrect(g, -w / 2, -d / 2, w, d, Math.min(w * 0.3, 0.12)); g.clip();
      // chevron lugs, shifted by phase so the wheel appears to roll
      const pitch = lugs ? Math.max(0.12, d * 0.11) : 0.07;
      g.strokeStyle = S(P.tyre, lugs ? 0.32 : 0.18); g.lineWidth = lugs ? pitch * 0.34 : 0.02;
      for (let yy = -d / 2 - pitch + (phase / 4) * pitch; yy < d / 2 + pitch; yy += pitch) {
        // foreshortening: lugs bunch up toward the top and bottom of the visible tread
        const t = yy / (d / 2);
        const y2 = Math.sign(t) * Math.pow(Math.min(1, Math.abs(t)), 0.8) * d / 2;
        g.beginPath();
        if (lugs) { g.moveTo(-w / 2, y2 - pitch * 0.25); g.lineTo(0, y2 + pitch * 0.2); g.lineTo(w / 2, y2 - pitch * 0.25); }
        else { g.moveTo(-w / 2, y2); g.lineTo(w / 2, y2); }
        g.stroke();
      }
      g.restore();
      rrect(g, -w / 2, -d / 2, w, d, Math.min(w * 0.3, 0.12));
      g.strokeStyle = S(P.tyre, -0.4); g.lineWidth = 0.035; g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0);
      art.grain(g, pw, ph, rng, 0.05, 0.03);
    });
  }

  // ---------------------------------------------------------------- self-propelled bodies
  function tractor(T, col) {
    return begin(`veh:body:${T.name}:${col}`, T.wid, T.len, (g, rng, W, L) => {
      const c = paintCol(col);
      const big = T.cab === 'big' ? 1 : T.cab === 'mid' ? 0.6 : 0;
      const hoodW = W * (0.36 + 0.04 * big), hoodY0 = -L / 2, hoodY1 = -L / 2 + L * 0.5;
      // front weight block + grille
      metal(g, rng, -hoodW * 0.6, -L / 2 - 0.02, hoodW * 1.2, 0.26, 0.05, S(P.metal[2], -0.2));
      // fenders over rear wheels (drawn below the cab)
      const fx = T.tyreR.x, fw = T.tyreR.w + 0.12;
      for (const s of [-1, 1]) panel(g, rng, s * fx - fw / 2, T.ry - T.tyreR.d * 0.52, fw, T.tyreR.d * 1.02, 0.2, c, { gloss: 0.22 });
      // hood
      panel(g, rng, -hoodW / 2, hoodY0 + 0.18, hoodW, hoodY1 - hoodY0, 0.16, c, { ridge: true, gloss: 0.26 });
      // grille slats
      g.strokeStyle = S(P.metal[2], -0.3); g.lineWidth = 0.035;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * hoodW * 0.16, hoodY0 + 0.22); g.lineTo(i * hoodW * 0.16, hoodY0 + 0.36); g.stroke(); }
      // cab: roof over glass band
      const cabW = W * (0.62 + 0.06 * big), cabY = hoodY1 - 0.15, cabL = L * (0.34 + 0.02 * big);
      glass(g, -cabW / 2, cabY, cabW, cabL, 0.14);
      panel(g, rng, -cabW / 2 + 0.1, cabY + 0.1, cabW - 0.2, cabL - 0.2, 0.12, big ? P.paint.white : c, { gloss: 0.3 });
      // roof vents / beacon base
      metal(g, rng, -0.12, cabY + 0.18, 0.24, 0.14, 0.04, P.metal[1]);
      // mirrors
      g.strokeStyle = S(P.metal[2], -0.2); g.lineWidth = 0.05;
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(s * cabW / 2, cabY + 0.25); g.lineTo(s * (cabW / 2 + 0.28), cabY + 0.12); g.stroke();
        rrect(g, s * (cabW / 2 + 0.28) - 0.06, cabY + 0.02, 0.12, 0.2, 0.03); g.fillStyle = S(P.glass, -0.3); g.fill();
      }
      // exhaust stack (right of hood, in front of cab) with a soot ring
      dot(g, hoodW / 2 - 0.08, hoodY1 - 0.35, 0.09, S(P.metal[2], -0.35), S(P.metal[2], -0.5));
      dot(g, hoodW / 2 - 0.08, hoodY1 - 0.35, 0.05, '#2a2622');
      // rear link arms + hitch
      g.strokeStyle = S(P.metal[2], -0.25); g.lineWidth = 0.08;
      g.beginPath(); g.moveTo(-0.35, L / 2 - 0.35); g.lineTo(-0.3, L / 2 + 0.1); g.moveTo(0.35, L / 2 - 0.35); g.lineTo(0.3, L / 2 + 0.1); g.stroke();
      metal(g, rng, -0.18, L / 2 - 0.22, 0.36, 0.26, 0.05, P.metal[2]);
      // head lamps
      for (const s of [-1, 1]) dot(g, s * hoodW * 0.36, hoodY0 + 0.3, 0.06, '#f4ecd0', S(P.metal[2], -0.3));
    });
  }
  function combine(T, col) {
    return begin(`veh:body:${T.name}:${col}`, T.wid, T.len, (g, rng, W, L) => {
      const c = paintCol(col);
      // main body
      panel(g, rng, -W * 0.42, -L / 2 + 0.9, W * 0.84, L - 1.0, 0.25, c, { gloss: 0.2 });
      // grain tank (open top) — golden when full is drawn per frame; here the empty hopper
      const tx = -W * 0.36, ty = -L / 2 + 1.9, tw = W * 0.72, tl = L * 0.36;
      panel(g, rng, tx, ty, tw, tl, 0.12, S(c, -0.1));
      rrect(g, tx + 0.14, ty + 0.14, tw - 0.28, tl - 0.28, 0.08); g.fillStyle = S(P.metal[2], -0.35); g.fill();
      // engine deck + grilles at rear
      metal(g, rng, -W * 0.3, L / 2 - 1.9, W * 0.6, 1.0, 0.1, P.metal[1]);
      g.strokeStyle = S(P.metal[2], -0.2); g.lineWidth = 0.04;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-W * 0.26, L / 2 - 1.8 + i * 0.15); g.lineTo(W * 0.26, L / 2 - 1.8 + i * 0.15); g.stroke(); }
      // straw chopper (rear)
      metal(g, rng, -W * 0.34, L / 2 - 0.55, W * 0.68, 0.5, 0.08, P.metal[2]);
      // cab at the front with glass all round
      const cw = W * 0.5;
      glass(g, -cw / 2, -L / 2 + 0.05, cw, 1.7, 0.18);
      panel(g, rng, -cw / 2 + 0.12, -L / 2 + 0.28, cw - 0.24, 1.3, 0.12, P.paint.white, { gloss: 0.3 });
      // unloading auger folded along the left side
      g.strokeStyle = S(c, -0.4); g.lineWidth = 0.34; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-W / 2 + 0.1, L / 2 - 1.4); g.lineTo(-W / 2 + 0.1, -L / 2 + 1.1); g.stroke();
      g.strokeStyle = S(c, 0.1); g.lineWidth = 0.22; g.stroke();
      // exhaust
      dot(g, W * 0.3, L / 2 - 2.3, 0.1, S(P.metal[2], -0.35));
      // ladder
      g.strokeStyle = S(P.metal[1], -0.2); g.lineWidth = 0.04;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-W * 0.5, -L / 2 + 1.9 + i * 0.22); g.lineTo(-W * 0.38, -L / 2 + 1.9 + i * 0.22); g.stroke(); }
    });
  }
  /** combine header without the reel (reel is animated per frame) */
  function header(T, col) {
    const H = T.header;
    return begin(`veh:header:${T.name}:${col}`, H.width, H.depth, (g, rng, W, D) => {
      const c = paintCol(col);
      // floor / cutter bar
      metal(g, rng, -W / 2, -D / 2 + 0.25, W, D - 0.35, 0.1, P.metal[1]);
      g.strokeStyle = S(P.metal[2], -0.2); g.lineWidth = 0.03;
      for (let x = -W / 2 + 0.1; x < W / 2; x += 0.18) { g.beginPath(); g.moveTo(x, -D / 2 + 0.2); g.lineTo(x + 0.06, -D / 2 + 0.34); g.stroke(); }
      // back wall + auger
      panel(g, rng, -W / 2, D / 2 - 0.5, W, 0.45, 0.08, c);
      g.strokeStyle = S(P.metal[1], -0.1); g.lineWidth = 0.22; g.beginPath(); g.moveTo(-W / 2 + 0.3, D / 2 - 0.75); g.lineTo(W / 2 - 0.3, D / 2 - 0.75); g.stroke();
      // side panels + crop dividers
      for (const s of [-1, 1]) {
        panel(g, rng, s > 0 ? W / 2 - 0.16 : -W / 2, -D / 2 + 0.1, 0.16, D - 0.2, 0.05, c);
        g.beginPath(); g.moveTo(s * (W / 2 - 0.08), -D / 2 - 0.25); g.lineTo(s * (W / 2 - 0.08) - 0.12, -D / 2 + 0.2); g.lineTo(s * (W / 2 - 0.08) + 0.12, -D / 2 + 0.2); g.closePath();
        g.fillStyle = S(c, 0.1); g.fill(); g.strokeStyle = art.outline(c); g.lineWidth = 0.03; g.stroke();
      }
    });
  }
  function pickup(T, col) {
    return begin(`veh:body:${T.name}:${col}`, T.wid, T.len, (g, rng, W, L) => {
      const c = paintCol(col);
      panel(g, rng, -W / 2 + 0.05, -L / 2, W - 0.1, L, 0.35, c, { gloss: 0.3 });
      // bonnet crease
      g.strokeStyle = S(c, 0.3); g.lineWidth = 0.03;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.35, -L / 2 + 0.2); g.lineTo(s * 0.4, -L / 2 + 1.2); g.stroke(); }
      // windscreen, roof, rear window
      glass(g, -W / 2 + 0.2, -L / 2 + 1.3, W - 0.4, 0.55, 0.12);
      panel(g, rng, -W / 2 + 0.2, -L / 2 + 1.8, W - 0.4, 1.1, 0.15, c, { gloss: 0.35 });
      glass(g, -W / 2 + 0.25, -L / 2 + 2.9, W - 0.5, 0.22, 0.06);
      // load bed
      rrect(g, -W / 2 + 0.16, -L / 2 + 3.25, W - 0.32, L - 3.45, 0.06);
      g.fillStyle = S(P.metal[2], -0.25); g.fill();
      g.strokeStyle = S(P.metal[2], -0.4); g.lineWidth = 0.03;
      for (let x = -W / 2 + 0.35; x < W / 2 - 0.2; x += 0.22) { g.beginPath(); g.moveTo(x, -L / 2 + 3.3); g.lineTo(x, L / 2 - 0.25); g.stroke(); }
      // mirrors + lamps
      for (const s of [-1, 1]) {
        rrect(g, s * (W / 2 + 0.05) - 0.08, -L / 2 + 1.35, 0.16, 0.12, 0.04); g.fillStyle = S(c, -0.3); g.fill();
        dot(g, s * (W / 2 - 0.32), -L / 2 + 0.12, 0.09, '#f4ecd0', S(c, -0.4));
        dot(g, s * (W / 2 - 0.22), L / 2 - 0.08, 0.07, '#a8392f');
      }
    });
  }

  // ---------------------------------------------------------------- implements
  function implement(type) {
    const I = ALL[type];
    return begin(`veh:impl:${type}`, I.wid, I.len, (g, rng, W, L) => {
      const frame = P.paint.navy, steel = P.metal[0], red = P.paint.tractorRed, yel = P.paint.tractorYellow;
      switch (I.look) {
        case 'plough': {
          // headstock + diagonal beam with mouldboards
          metal(g, rng, -0.4, -L / 2, 0.8, 0.3, 0.06, frame);
          g.strokeStyle = S(red, -0.25); g.lineWidth = 0.16; g.lineCap = 'round';
          g.beginPath(); g.moveTo(0, -L / 2 + 0.2); g.lineTo(W / 2 - 0.3, L / 2 - 0.2); g.stroke();
          g.strokeStyle = red; g.lineWidth = 0.1; g.stroke();
          const n = I.furrows;
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            const x = t * (W / 2 - 0.3) - W * 0.35 + 0.2, y = -L / 2 + 0.3 + t * (L - 0.6);
            g.save(); g.translate(x, y); g.rotate(-0.55);
            rrect(g, -0.28, -0.14, 0.62, 0.3, 0.12);
            const gr = g.createLinearGradient(-0.28, 0, 0.34, 0);
            gr.addColorStop(0, S(steel, 0.4)); gr.addColorStop(0.5, S(steel, 0.1)); gr.addColorStop(1, S(steel, -0.3));
            g.fillStyle = gr; g.fill(); g.strokeStyle = art.outline(steel); g.lineWidth = 0.03; g.stroke();
            g.restore();
            g.strokeStyle = S(red, -0.2); g.lineWidth = 0.06; g.beginPath(); g.moveTo(x + 0.15, y - 0.05); g.lineTo(x + 0.35, y - 0.1); g.stroke();
          }
          // depth wheel
          rrect(g, W / 2 - 0.3, L / 2 - 0.55, 0.18, 0.5, 0.06); g.fillStyle = P.tyre; g.fill();
          break;
        }
        case 'cultivator': {
          metal(g, rng, -W / 2, -L / 2 + 0.15, W, 0.2, 0.05, frame);
          metal(g, rng, -0.35, -L / 2, 0.7, 0.35, 0.06, frame);
          for (let row = 0; row < 3; row++) {
            const y = -L / 2 + 0.55 + row * 0.42;
            metal(g, rng, -W / 2 + 0.05, y - 0.05, W - 0.1, 0.1, 0.03, S(frame, 0.1));
            for (let x = -W / 2 + 0.15 + (row % 2) * 0.12; x < W / 2 - 0.1; x += 0.25) dot(g, x, y + 0.1, 0.045, S(steel, 0.2), S(steel, -0.4));
          }
          // crumbler roller
          g.fillStyle = S(steel, -0.1); rrect(g, -W / 2 + 0.05, L / 2 - 0.35, W - 0.1, 0.3, 0.12); g.fill();
          g.strokeStyle = S(steel, -0.45); g.lineWidth = 0.025;
          for (let x = -W / 2 + 0.1; x < W / 2; x += 0.1) { g.beginPath(); g.moveTo(x, L / 2 - 0.34); g.lineTo(x + 0.04, L / 2 - 0.06); g.stroke(); }
          break;
        }
        case 'seeder': {
          metal(g, rng, -0.35, -L / 2, 0.7, 0.3, 0.06, frame);
          panel(g, rng, -W / 2 + 0.1, -L / 2 + 0.3, W - 0.2, L * 0.45, 0.1, P.paint.tractorBlue, { gloss: 0.25 });
          // hopper lid ridges
          g.strokeStyle = S(P.paint.tractorBlue, 0.3); g.lineWidth = 0.03;
          for (let x = -W / 2 + 0.4; x < W / 2 - 0.2; x += 0.5) { g.beginPath(); g.moveTo(x, -L / 2 + 0.4); g.lineTo(x, -L / 2 + 0.25 + L * 0.45); g.stroke(); }
          // coulter discs
          for (let x = -W / 2 + 0.12; x < W / 2 - 0.05; x += 0.125) { rrect(g, x - 0.02, L / 2 - 0.75, 0.04, 0.3, 0.02); g.fillStyle = S(steel, 0.1); g.fill(); }
          metal(g, rng, -W / 2, L / 2 - 0.4, W, 0.3, 0.1, S(steel, -0.1));
          break;
        }
        case 'sprayer': {
          metal(g, rng, -0.35, -L / 2, 0.7, 0.3, 0.06, frame);
          // white tank
          panel(g, rng, -W * 0.36, -L / 2 + 0.25, W * 0.72, L * 0.62, 0.35, P.paint.white, { gloss: 0.25 });
          dot(g, 0, -L / 2 + 0.6, 0.12, S(yel, 0), art.outline(yel));
          // folded boom frame at the rear
          metal(g, rng, -W / 2, L / 2 - 0.4, W, 0.3, 0.06, S(yel, -0.1));
          break;
        }
        case 'spreader': {
          metal(g, rng, -0.3, -L / 2, 0.6, 0.25, 0.05, frame);
          panel(g, rng, -W / 2 + 0.05, -L / 2 + 0.2, W - 0.1, L * 0.7, 0.2, S(P.paint.tractorBlue, 0.1));
          rrect(g, -W / 2 + 0.25, -L / 2 + 0.4, W - 0.5, L * 0.45, 0.12); g.fillStyle = M(P.paint.white, '#c9c2b0', 0.4); g.fill();
          for (const s of [-1, 1]) { dot(g, s * 0.45, L / 2 - 0.25, 0.22, S(steel, 0.15), S(steel, -0.4)); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + s * 0.4; g.strokeStyle = S(steel, -0.3); g.lineWidth = 0.03; g.beginPath(); g.moveTo(s * 0.45, L / 2 - 0.25); g.lineTo(s * 0.45 + Math.cos(a) * 0.2, L / 2 - 0.25 + Math.sin(a) * 0.2); g.stroke(); } }
          break;
        }
        case 'mower': {
          metal(g, rng, -0.35, -L / 2, 0.7, 0.3, 0.06, frame);
          panel(g, rng, -W / 2, -L / 2 + 0.3, W, L - 0.35, 0.18, red, { gloss: 0.22 });
          for (let x = -W / 2 + 0.3; x < W / 2 - 0.1; x += 0.45) dot(g, x, L / 2 - 0.25, 0.14, S(steel, 0.1), S(steel, -0.4));
          break;
        }
        case 'rake': {
          metal(g, rng, -0.1, -L / 2, 0.2, L * 0.6, 0.05, frame);
          for (const s of [-1, 1]) {
            const cx = s * (W / 2 - 0.9), cy = L / 2 - 0.9;
            for (let k = 0; k < 10; k++) {
              const a = (k / 10) * Math.PI * 2;
              g.strokeStyle = S(yel, -0.2); g.lineWidth = 0.05; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 0.82, cy + Math.sin(a) * 0.82); g.stroke();
            }
            dot(g, cx, cy, 0.22, yel, art.outline(yel));
          }
          break;
        }
        case 'baler': {
          metal(g, rng, -0.06, -L / 2, 0.12, 1.4, 0.04, frame);
          panel(g, rng, -W / 2 + 0.2, -L / 2 + 1.1, W - 0.4, L - 1.2, 0.35, S(red, 0.05), { horiz: false });
          metal(g, rng, -W / 2, -L / 2 + 0.95, W, 0.35, 0.08, S(steel, -0.1));
          g.strokeStyle = S(red, 0.3); g.lineWidth = 0.04; g.beginPath(); g.arc(0, L / 2 - 0.8, 0.55, Math.PI, 0); g.stroke();
          break;
        }
        case 'rootHarvester': {
          g.strokeStyle = S(frame, -0.2); g.lineWidth = 0.14;
          g.beginPath(); g.moveTo(0, -L / 2 - 0.1); g.lineTo(-0.9, -L / 2 + 1.6); g.stroke();
          dot(g, 0, -L / 2 - 0.05, 0.09, S(frame, -0.3));
          // lifting shares + web (front-left, over the rows), bunker (rear)
          metal(g, rng, -W / 2, -L / 2 + 1.4, 1.7, 0.5, 0.08, S(steel, -0.1));
          g.strokeStyle = S(steel, -0.45); g.lineWidth = 0.03;
          for (let yy = -L / 2 + 1.95; yy < -L / 2 + 3.3; yy += 0.12) { g.beginPath(); g.moveTo(-W / 2 + 0.15, yy); g.lineTo(-W / 2 + 1.5, yy); g.stroke(); }
          panel(g, rng, -W / 2 + 0.1, -L / 2 + 1.9, 1.5, 1.5, 0.08, S(red, -0.1));
          panel(g, rng, -W / 2 + 0.2, -L / 2 + 3.3, W - 0.4, L / 2 - 0.2 + 0.1, 0.15, red, { gloss: 0.2 });
          rrect(g, -W / 2 + 0.4, -L / 2 + 3.5, W - 0.8, L / 2 - 0.7, 0.08); g.fillStyle = S(red, -0.5); g.fill();
          for (const s2 of [-1, 1]) dot(g, s2 * (W / 2 - 0.3), L / 2 - 0.08, 0.06, '#a8392f');
          break;
        }
        case 'grainTrailer':
        case 'flatbed': {
          const c = I.look === 'grainTrailer' ? P.paint.tractorRed : P.timber[0];
          // drawbar
          g.strokeStyle = S(frame, -0.2); g.lineWidth = 0.14;
          g.beginPath(); g.moveTo(0, -L / 2 - 0.1); g.lineTo(-0.5, -L / 2 + 1.0); g.moveTo(0, -L / 2 - 0.1); g.lineTo(0.5, -L / 2 + 1.0); g.stroke();
          dot(g, 0, -L / 2 - 0.05, 0.09, S(frame, -0.3));
          const bodyY = -L / 2 + 1.0;
          if (I.look === 'grainTrailer') {
            panel(g, rng, -W / 2, bodyY, W, L - 1.0, 0.1, c, { gloss: 0.2 });
            rrect(g, -W / 2 + 0.14, bodyY + 0.14, W - 0.28, L - 1.28, 0.06);
            const gr = g.createLinearGradient(-W / 2, 0, W / 2, 0);
            gr.addColorStop(0, S(c, -0.55)); gr.addColorStop(0.5, S(c, -0.35)); gr.addColorStop(1, S(c, -0.55));
            g.fillStyle = gr; g.fill();
            g.strokeStyle = S(c, 0.25); g.lineWidth = 0.04;
            for (let y = bodyY + 0.6; y < L / 2 - 0.2; y += 0.9) { g.beginPath(); g.moveTo(-W / 2 + 0.02, y); g.lineTo(-W / 2 + 0.12, y); g.moveTo(W / 2 - 0.12, y); g.lineTo(W / 2 - 0.02, y); g.stroke(); }
          } else {
            panel(g, rng, -W / 2, bodyY, W, L - 1.0, 0.06, c, { horiz: false, gloss: 0.12 });
            g.strokeStyle = S(c, -0.35); g.lineWidth = 0.025;
            for (let x = -W / 2 + 0.2; x < W / 2; x += 0.2) { g.beginPath(); g.moveTo(x, bodyY + 0.05); g.lineTo(x, L / 2 - 0.05); g.stroke(); }
          }
          for (const s of [-1, 1]) dot(g, s * (W / 2 - 0.15), L / 2 - 0.08, 0.06, '#a8392f');
          break;
        }
        case 'loader': {
          // bucket at front, two arms back to the tractor
          panel(g, rng, -W / 2, -L / 2, W, 0.7, 0.08, S(steel, -0.05), { horiz: false });
          g.strokeStyle = S(steel, -0.45); g.lineWidth = 0.03;
          for (let x = -W / 2 + 0.12; x < W / 2; x += 0.2) { g.beginPath(); g.moveTo(x, -L / 2 - 0.02); g.lineTo(x, -L / 2 + 0.1); g.stroke(); }
          for (const s of [-1, 1]) { g.strokeStyle = S(P.paint.tractorGreen, -0.2); g.lineWidth = 0.16; g.beginPath(); g.moveTo(s * 0.8, -L / 2 + 0.6); g.lineTo(s * 0.6, L / 2); g.stroke(); }
          break;
        }
        default:
          panel(g, rng, -W / 2, -L / 2, W, L, 0.1, P.metal[0]);
      }
    });
  }

  /** unfolded sprayer / spreader boom (width w) */
  function boom(w) {
    return begin(`veh:boom:${w}`, w, 0.5, (g, rng, W) => {
      const yel = P.paint.tractorYellow;
      metal(g, rng, -W / 2, -0.12, W, 0.18, 0.05, S(yel, -0.1));
      g.strokeStyle = S(yel, -0.35); g.lineWidth = 0.03;
      for (let x = -W / 2 + 0.2; x < W / 2; x += 0.5) { g.beginPath(); g.moveTo(x, -0.1); g.lineTo(x + 0.25, 0.05); g.lineTo(x + 0.5, -0.1); g.stroke(); }
      for (let x = -W / 2 + 0.25; x < W / 2; x += 0.5) dot(g, x, 0.12, 0.04, S(P.metal[1], 0.2), S(P.metal[2], -0.3));
    });
  }
  /** grain heap in a tank/trailer: fill 0..1 */
  function grainPile(wM, lM, crop = 'wheat') {
    const col = crop === 'rapeseed' ? '#3a2e28' : crop === 'maize' ? '#e0b12e' : '#d9b865';
    return begin(`veh:grain:${wM}:${lM}:${crop}`, wM, lM, (g, rng, W, L) => {
      rrect(g, -W / 2, -L / 2, W, L, Math.min(W, L) * 0.3);
      const gr = g.createRadialGradient(0, 0, 0.1, 0, 0, Math.max(W, L) * 0.6);
      gr.addColorStop(0, S(col, 0.22)); gr.addColorStop(0.7, col); gr.addColorStop(1, S(col, -0.25));
      g.fillStyle = gr; g.fill();
      g.save(); g.clip(); art.dabs(g, rng, Math.round(W * L * 30), -W / 2, -L / 2, W, L, [S(col, 0.2), S(col, -0.15)], 0.02, 0.06, 0.4); g.restore();
    });
  }
  return { tractor, combine, header, pickup, implement, boom, tyre, grainPile, PAD, rrect, panel };
}
