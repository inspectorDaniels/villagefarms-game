// Painted body parts for top-down people, cached through ctx.art.sprite.
// People are small (≈0.5 m shoulders), so parts are painted at SPPM = 3 × art.PPM px/m to hold
// detail at 48–96 px/m close-ups; they are drawn scaled in metre space.
// Every part is painted facing "up" (−y = forward). No directional light: only soft top-down form
// shading (lighter crown/spine, darker rims), gouache dabs, grain and tinted outlines.

export const SPPM = 96;
const TAU = Math.PI * 2;

export function createSprites(art, palette) {
  const S = SPPM;
  const { shade, mix, rgba, outline } = art;

  // ------------------------------------------------------------------ helpers
  /** superellipse path (rounded-rect-like body shapes); front (−y) side can be flattened */
  function sePath(g, cx, cy, a, b, n = 2.6, front = 1) {
    g.beginPath();
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * TAU;
      const c = Math.cos(t), s = Math.sin(t);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      let y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      if (y < 0) y *= front;
      if (i === 0) g.moveTo(cx + x, cy + y); else g.lineTo(cx + x, cy + y);
    }
    g.closePath();
  }
  function ellipsePath(g, cx, cy, rx, ry, rot = 0) { g.beginPath(); g.ellipse(cx, cy, rx, ry, rot, 0, TAU); }
  function capsulePath(g, cx, y0, y1, r) {
    g.beginPath();
    g.arc(cx, y0 + r, r, Math.PI, 0);
    g.lineTo(cx + r, y1 - r);
    g.arc(cx, y1 - r, r, 0, Math.PI);
    g.closePath();
  }
  /**
   * gouache fill of the current path: base colour, dabs of nearby tones, optional volume shading,
   * then a tinted outline. path() must (re)build the path.
   */
  function gouache(g, path, col, rng, box, o = {}) {
    const [x, y, w, h] = box;
    g.save();
    path(); g.clip();
    g.fillStyle = col;
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    const dabR = o.dabR || Math.max(1.2, Math.min(w, h) * 0.07);
    art.dabs(g, rng, o.dabs || Math.ceil((w * h) / (dabR * dabR * 2.2)), x, y, w, h,
      [shade(col, 0.1), shade(col, -0.1), mix(col, '#c9b184', 0.08), shade(col, 0.04)], dabR * 0.6, dabR * 1.3, o.dabAlpha || 0.45);
    if (o.under) o.under(g);
    if (o.vol !== 0) {
      const cx = o.cx != null ? o.cx : x + w / 2, cy = o.cy != null ? o.cy : y + h / 2, r = o.r || Math.max(w, h) / 2;
      const gr = g.createRadialGradient(cx, cy - r * 0.08, r * 0.05, cx, cy, r * 1.05);
      const v = o.vol == null ? 0.32 : o.vol;
      gr.addColorStop(0, `rgba(255,248,228,${v * 0.55})`);
      gr.addColorStop(0.5, 'rgba(255,248,228,0)');
      gr.addColorStop(0.82, `rgba(24,26,40,${v * 0.25})`);
      gr.addColorStop(1, `rgba(24,26,40,${v * 0.75})`);
      g.fillStyle = gr;
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
    }
    if (o.over) o.over(g);
    art.grain(g, w + x, h + y, rng, 0.05, 0.05);
    g.restore();
    if (o.outline !== false) {
      path();
      g.lineWidth = o.lw || 1.5;
      g.lineJoin = 'round';
      g.strokeStyle = rgba(outline(col), o.outlineAlpha || 0.85);
      g.stroke();
    }
  }
  const M = (v) => v * S;

  // ------------------------------------------------------------------ torso
  function torsoDims(a) {
    const coat = a.coat ? 0.018 : 0;
    return { ha: 0.225 * a.build + coat, hb: 0.118 * (0.95 + a.build * 0.05) + coat * 0.8 };
  }
  function torso(a) {
    const { ha, hb } = torsoDims(a);
    const W = M(ha * 2 + 0.1), H = M(hb * 2 + 0.14);
    const key = `chr:torso:${a.top}|${a.pattern}|${a.overalls}|${a.apron}|${a.coat}|${a.scarf}|${a.build}|${a.variant % 5}`;
    return art.sprite(key, W, H, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, A = M(ha), B = M(hb);
      const top = a.coat ? mix(a.top, '#5a4a3a', 0.35) : a.top;
      const path = () => sePath(g, cx, cy, A, B, 2.7, 0.88);
      gouache(g, path, top, rng, [cx - A, cy - B, A * 2, B * 2], {
        r: A, vol: 0.3,
        under: (g) => {
          // cloth pattern
          if (a.pattern === 'plaid' && !a.coat) {
            g.globalAlpha = 0.32; g.fillStyle = shade(top, -0.4);
            for (let x = cx - A; x < cx + A; x += M(0.055)) g.fillRect(x, cy - B, M(0.016), B * 2);
            for (let y = cy - B; y < cy + B; y += M(0.055)) g.fillRect(cx - A, y, A * 2, M(0.016));
            g.globalAlpha = 0.25; g.fillStyle = shade(top, 0.5);
            for (let x = cx - A + M(0.03); x < cx + A; x += M(0.055)) g.fillRect(x, cy - B, M(0.005), B * 2);
            g.globalAlpha = 1;
          } else if (a.pattern === 'stripe' && !a.coat) {
            g.globalAlpha = 0.3; g.fillStyle = shade(top, 0.55);
            for (let y = cy - B; y < cy + B; y += M(0.04)) g.fillRect(cx - A, y, A * 2, M(0.014));
            g.globalAlpha = 1;
          } else if (a.pattern === 'knit') {
            g.strokeStyle = rgba(shade(top, -0.3), 0.35); g.lineWidth = 0.8;
            for (let y = cy - B; y < cy + B; y += 3) for (let x = cx - A; x < cx + A; x += 4) {
              g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y + 2); g.lineTo(x + 4, y); g.stroke();
            }
          }
          // spine seam and shoulder seams
          g.strokeStyle = rgba(shade(top, -0.35), 0.35); g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx, cy + M(0.03)); g.lineTo(cx + 0.5, cy + B); g.stroke();
          for (const s of [-1, 1]) {
            g.beginPath(); g.arc(cx + s * (A - M(0.06)), cy, M(0.07), s > 0 ? -1.2 : Math.PI - 1.2 + 2.4 - 2.4, s > 0 ? 1.2 : Math.PI + 1.2); g.stroke();
          }
          if (a.overalls) {
            const oc = a.overalls;
            // back panel
            g.save();
            sePath(g, cx, cy + B * 0.62, M(0.12), B * 0.55, 3, 1); g.clip();
            g.fillStyle = oc; g.fillRect(cx - A, cy, A * 2, B * 1.2);
            art.dabs(g, rng, 30, cx - A, cy, A * 2, B, [shade(oc, 0.12), shade(oc, -0.12)], 1, 2.5, 0.5);
            g.restore();
            // straps over the shoulders
            for (const s of [-1, 1]) {
              g.fillStyle = oc;
              g.beginPath();
              g.moveTo(cx + s * M(0.085), cy - B - 2); g.lineTo(cx + s * M(0.125), cy - B - 2);
              g.lineTo(cx + s * M(0.1), cy + B * 0.2); g.lineTo(cx + s * M(0.06), cy + B * 0.2);
              g.closePath(); g.fill();
              g.strokeStyle = rgba(shade(oc, -0.5), 0.5); g.lineWidth = 0.8; g.stroke();
              // stitch
              g.strokeStyle = rgba('#e8d9a8', 0.5); g.setLineDash([1.5, 1.5]);
              g.beginPath(); g.moveTo(cx + s * M(0.105), cy - B); g.lineTo(cx + s * M(0.08), cy + B * 0.15); g.stroke();
              g.setLineDash([]);
              // brass buckle at the front
              g.fillStyle = '#c99a2e';
              g.beginPath(); g.arc(cx + s * M(0.105), cy - B + M(0.02), M(0.012), 0, TAU); g.fill();
            }
            // bib front
            g.fillStyle = oc;
            g.beginPath(); g.moveTo(cx - M(0.1), cy - B - 2); g.lineTo(cx + M(0.1), cy - B - 2); g.lineTo(cx + M(0.085), cy - B + M(0.03)); g.lineTo(cx - M(0.085), cy - B + M(0.03)); g.closePath(); g.fill();
          }
          if (a.apron) {
            g.strokeStyle = rgba(shade(a.apron, -0.2), 0.9); g.lineWidth = M(0.012);
            g.beginPath(); g.moveTo(cx - A, cy + B * 0.35); g.quadraticCurveTo(cx, cy + B * 0.5, cx + A, cy + B * 0.35); g.stroke();
            g.fillStyle = a.apron;
            g.beginPath(); g.moveTo(cx - M(0.09), cy - B - 2); g.lineTo(cx + M(0.09), cy - B - 2); g.lineTo(cx + M(0.08), cy - B + M(0.035)); g.lineTo(cx - M(0.08), cy - B + M(0.035)); g.closePath(); g.fill();
            // neck loop
            g.beginPath(); g.arc(cx, cy - M(0.01), M(0.09), Math.PI * 1.05, Math.PI * 1.95); g.stroke();
          }
          if (a.coat) {
            // turned-up collar and a belt/back vent
            g.strokeStyle = rgba(shade(top, -0.4), 0.45); g.lineWidth = 1.2;
            g.beginPath(); g.moveTo(cx, cy + B * 0.3); g.lineTo(cx, cy + B); g.stroke();
            g.fillStyle = shade(top, -0.15);
            g.beginPath(); g.ellipse(cx, cy - M(0.005), M(0.125), M(0.1), 0, 0, TAU); g.fill();
          }
        },
      });
      if (a.scarf) {
        // knitted scarf ring around the neck + tail down the back
        const sc = a.scarf;
        g.lineCap = 'round';
        g.strokeStyle = sc; g.lineWidth = M(0.04);
        g.beginPath(); g.ellipse(cx, cy - M(0.01), M(0.105), M(0.095), 0, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(cx + M(0.05), cy + M(0.07)); g.quadraticCurveTo(cx + M(0.08), cy + M(0.11), cx + M(0.06), cy + B + M(0.02)); g.stroke();
        g.strokeStyle = rgba(shade(sc, 0.4), 0.6); g.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
          const t = (i / 12) * TAU;
          g.beginPath(); g.moveTo(cx + Math.cos(t) * M(0.088), cy - M(0.01) + Math.sin(t) * M(0.078));
          g.lineTo(cx + Math.cos(t) * M(0.122), cy - M(0.01) + Math.sin(t) * M(0.112)); g.stroke();
        }
        g.strokeStyle = rgba(outline(sc), 0.7); g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx, cy - M(0.01), M(0.125), M(0.115), 0, 0, TAU); g.stroke();
      }
    });
  }

  /** skirt / coat tails: a flared shape under the torso */
  function skirt(a) {
    const col = a.skirt || mix(a.top, '#5a4a3a', 0.35);
    const long = !!a.skirt;
    const W = M(0.5), H = M(0.46);
    return art.sprite(`chr:skirt:${col}|${long}|${a.build}`, W, H, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      const rx = M(long ? 0.2 : 0.2) * a.build, ry = M(long ? 0.17 : 0.15);
      const path = () => sePath(g, cx, cy + M(0.01), rx, ry, 2.3, 0.9);
      gouache(g, path, col, rng, [cx - rx, cy - ry, rx * 2, ry * 2], {
        r: rx, vol: 0.28,
        under: (g) => {
          g.strokeStyle = rgba(shade(col, -0.4), 0.35); g.lineWidth = 1.1;
          for (let i = 0; i < 14; i++) {
            const t = (i / 14) * TAU;
            g.beginPath(); g.moveTo(cx + Math.cos(t) * rx * 0.35, cy + Math.sin(t) * ry * 0.35);
            g.lineTo(cx + Math.cos(t) * rx * 1.05, cy + Math.sin(t) * ry * 1.05); g.stroke();
          }
        },
      });
    });
  }

  /** hips/seat seen past the torso when striding (trousers or overalls) */
  function hips(a) {
    const col = a.overalls || a.trousers;
    const W = M(0.46), H = M(0.3);
    return art.sprite(`chr:hips:${col}|${a.build}`, W, H, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, A = M(0.165) * a.build, B = M(0.1);
      const path = () => sePath(g, cx, cy, A, B, 2.4, 1);
      gouache(g, path, col, rng, [cx - A, cy - B, A * 2, B * 2], { r: A, vol: 0.3,
        over: (g) => {
          // back pockets + seam
          g.strokeStyle = rgba(shade(col, -0.4), 0.45); g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx, cy - B * 0.2); g.lineTo(cx, cy + B); g.stroke();
          for (const s of [-1, 1]) { g.strokeRect(cx + s * A * 0.5 - M(0.035), cy + B * 0.05, M(0.07), M(0.06)); }
        } });
    });
  }

  // ------------------------------------------------------------------ head
  function head(a) {
    const W = M(0.46);
    const key = `chr:head:${a.skin}|${a.hair}|${a.hairStyle}|${a.hat}|${a.hatColor}|${a.variant % 5}`;
    return art.sprite(key, W, W, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, r = M(0.098);
      const hair = a.hair, skin = a.skin;
      const hairDark = shade(hair, -0.35), hairLight = shade(hair, 0.25);
      // hair behind the head (long hair falls onto the back, bun)
      if (a.hairStyle === 'long' && a.hat !== 'scarf') {
        const p = () => { g.beginPath(); g.ellipse(cx, cy + r * 0.55, r * 1.08, r * 1.02, 0, 0, TAU); };
        gouache(g, p, hair, rng, [cx - r * 1.1, cy - r * 0.5, r * 2.2, r * 2.1], { vol: 0.25, lw: 1.2,
          over: (g) => strands(g, rng, cx, cy + r * 0.2, r * 1.5, hairDark, hairLight, 0.5, Math.PI * 0.15, Math.PI * 0.85, 18) });
      }
      // ears
      for (const s of [-1, 1]) {
        const p = () => ellipsePath(g, cx + s * r * 0.96, cy + r * 0.05, r * 0.2, r * 0.3);
        gouache(g, p, shade(skin, -0.05), rng, [cx + s * r - r * 0.25, cy - r * 0.3, r * 0.5, r * 0.7], { vol: 0.2, lw: 1 });
      }
      // nose tip peeking out at the front
      gouache(g, () => ellipsePath(g, cx, cy - r * 0.97, r * 0.17, r * 0.2), skin, rng, [cx - r * 0.2, cy - r * 1.2, r * 0.4, r * 0.4], { vol: 0.15, lw: 1 });
      // skull
      gouache(g, () => ellipsePath(g, cx, cy, r, r * 1.02), skin, rng, [cx - r, cy - r, r * 2, r * 2], {
        vol: 0.3, lw: 1.3,
        under: (g) => {
          // brow shadow & cheeks: a warm flush at the front edge
          const gr = g.createRadialGradient(cx, cy - r * 0.9, 1, cx, cy - r * 0.9, r * 0.8);
          gr.addColorStop(0, rgba('#c86a50', 0.18)); gr.addColorStop(1, rgba('#c86a50', 0));
          g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r);
        },
      });
      // hair on top
      const hairPath = (cover) => () => {
        g.beginPath();
        g.moveTo(cx - r * 1.08, cy - r * cover * 0.55);
        g.quadraticCurveTo(cx, cy - r * (cover + 0.25), cx + r * 1.08, cy - r * cover * 0.55);
        g.lineTo(cx + r * 1.1, cy + r * 1.1); g.lineTo(cx - r * 1.1, cy + r * 1.1); g.closePath();
      };
      const clipHead = (k = 1.04) => { g.beginPath(); g.ellipse(cx, cy, r * k, r * k * 1.02, 0, 0, TAU); g.clip(); };
      const style = a.hairStyle;
      if (style !== 'bald') {
        g.save(); clipHead(style === 'curly' ? 1.12 : 1.05);
        if (style === 'curly') {
          const p = () => { art.blobPath(g, cx, cy + r * 0.12, r * 1.02, rng, 0.08, 12); };
          gouache(g, p, hair, rng, [cx - r * 1.2, cy - r, r * 2.4, r * 2.3], { vol: 0.3, lw: 1.1, outline: false,
            over: (g) => {
              for (let i = 0; i < 26; i++) {
                const t = rng.float() * TAU, d = rng.float() * r * 0.95;
                g.strokeStyle = rng.chance(0.5) ? rgba(hairDark, 0.6) : rgba(hairLight, 0.5); g.lineWidth = 1;
                g.beginPath(); g.arc(cx + Math.cos(t) * d, cy + r * 0.12 + Math.sin(t) * d, r * 0.13, 0, Math.PI * 1.4); g.stroke();
              }
            } });
        } else {
          const cover = style === 'crop' ? 0.55 : style === 'bun' ? 0.7 : 0.62;
          gouache(g, hairPath(cover), hair, rng, [cx - r * 1.1, cy - r * 1.1, r * 2.2, r * 2.2], { vol: 0.3, outline: false,
            over: (g) => {
              if (style === 'crop') {
                for (let i = 0; i < 90; i++) { g.fillStyle = rgba(rng.chance(0.5) ? hairDark : hairLight, 0.5); g.fillRect(cx + rng.range(-r, r), cy + rng.range(-r * 0.6, r), 1, 1); }
              } else if (style === 'bun') {
                strands(g, rng, cx, cy + r * 0.95, r * 2.2, hairDark, hairLight, 0.55, -Math.PI * 0.95, -Math.PI * 0.05, 26);
              } else {
                strands(g, rng, cx + r * 0.1, cy + r * 0.3, r * 1.4, hairDark, hairLight, 0.55, 0, TAU, 34);
                // parting
                g.strokeStyle = rgba(shade(skin, -0.2), 0.5); g.lineWidth = 1;
                g.beginPath(); g.moveTo(cx + r * 0.25, cy - r * 0.55); g.quadraticCurveTo(cx + r * 0.2, cy, cx + r * 0.1, cy + r * 0.3); g.stroke();
              }
            } });
        }
        g.restore();
      } else {
        // fringe of hair around the back and sides, shiny pate
        g.save(); clipHead(1.02);
        g.strokeStyle = hair; g.lineWidth = r * 0.34;
        g.beginPath(); g.arc(cx, cy, r * 0.9, Math.PI * 0.05, Math.PI * 0.95); g.stroke();
        strands(g, rng, cx, cy, r * 1.1, hairDark, hairLight, 0.5, Math.PI * 0.1, Math.PI * 0.9, 14);
        g.restore();
        const gr = g.createRadialGradient(cx - r * 0.1, cy - r * 0.2, 1, cx, cy - r * 0.1, r * 0.5);
        gr.addColorStop(0, 'rgba(255,248,230,0.35)'); gr.addColorStop(1, 'rgba(255,248,230,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy - r * 0.1, r * 0.5, 0, TAU); g.fill();
      }
      if (a.hairStyle === 'bun' && a.hat !== 'scarf' && a.hat !== 'beanie') {
        const p = () => { g.beginPath(); g.arc(cx, cy + r * 0.9, r * 0.36, 0, TAU); };
        gouache(g, p, hair, rng, [cx - r * 0.4, cy + r * 0.5, r * 0.8, r * 0.8], { vol: 0.35, lw: 1,
          over: (g) => { g.strokeStyle = rgba(hairDark, 0.6); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy + r * 0.9, r * 0.2, 0.5, 4.5); g.stroke(); } });
      }
      // outline the head silhouette once more under hats
      hat(g, a, cx, cy, r, rng);
    });
  }

  function strands(g, rng, ox, oy, len, dark, light, alpha, a0, a1, n) {
    g.lineWidth = 1;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const t = a0 + (a1 - a0) * (i + rng.float()) / n;
      const l = len * rng.range(0.6, 1);
      g.strokeStyle = rgba(rng.chance(0.55) ? dark : light, alpha * rng.range(0.6, 1));
      g.beginPath();
      g.moveTo(ox + Math.cos(t) * len * 0.08, oy + Math.sin(t) * len * 0.08);
      g.quadraticCurveTo(ox + Math.cos(t + 0.25) * l * 0.5, oy + Math.sin(t + 0.25) * l * 0.5, ox + Math.cos(t) * l, oy + Math.sin(t) * l);
      g.stroke();
    }
  }

  function hat(g, a, cx, cy, r, rng) {
    const hc = a.hatColor;
    switch (a.hat) {
      case 'cap': {
        // visor first (under the crown edge)
        const vp = () => { g.beginPath(); g.ellipse(cx, cy - r * 0.95, r * 0.78, r * 0.62, 0, Math.PI, TAU); g.closePath(); };
        gouache(g, vp, shade(hc, -0.12), rng, [cx - r, cy - r * 1.6, r * 2, r * 0.7], { vol: 0.2, lw: 1.2 });
        const cp = () => ellipsePath(g, cx, cy + r * 0.02, r * 1.02, r * 1.02);
        gouache(g, cp, hc, rng, [cx - r * 1.05, cy - r, r * 2.1, r * 2.1], { vol: 0.38, lw: 1.3,
          over: (g) => {
            g.strokeStyle = rgba(shade(hc, -0.45), 0.45); g.lineWidth = 1;
            for (let i = 0; i < 6; i++) { const t = (i / 6) * TAU + 0.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t) * r * 1.1, cy + Math.sin(t) * r * 1.1); g.stroke(); }
            g.fillStyle = shade(hc, -0.3); g.beginPath(); g.arc(cx, cy, r * 0.1, 0, TAU); g.fill();
            // back strap opening
            g.fillStyle = rgba(shade(a.hair, -0.1), 0.9); g.beginPath(); g.ellipse(cx, cy + r * 0.86, r * 0.22, r * 0.1, 0, 0, TAU); g.fill();
          } });
        break;
      }
      case 'flatcap': {
        const tw = mix(hc, '#7a6a55', 0.55);
        const cp = () => { g.beginPath(); g.ellipse(cx, cy - r * 0.12, r * 1.1, r * 1.08, 0, 0, TAU); };
        gouache(g, cp, tw, rng, [cx - r * 1.15, cy - r * 1.25, r * 2.3, r * 2.3], { vol: 0.32, lw: 1.3,
          over: (g) => {
            // herringbone tweed
            g.lineWidth = 0.8;
            for (let y = cy - r * 1.3; y < cy + r; y += 3) for (let x = cx - r * 1.2; x < cx + r * 1.2; x += 5) {
              g.strokeStyle = rgba(rng.chance(0.5) ? shade(tw, -0.35) : shade(tw, 0.3), 0.35);
              g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2.5, y + (((x / 5) | 0) % 2 ? 2 : -2)); g.stroke();
            }
            // front brim fold
            g.strokeStyle = rgba(shade(tw, -0.5), 0.6); g.lineWidth = 1.2;
            g.beginPath(); g.ellipse(cx, cy - r * 0.62, r * 0.8, r * 0.45, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
            g.fillStyle = shade(tw, -0.2); g.beginPath(); g.arc(cx, cy - r * 0.2, r * 0.08, 0, TAU); g.fill();
          } });
        break;
      }
      case 'straw': {
        const st = '#d8b46a';
        const R = r * 1.95;
        const bp = () => { art.blobPath(g, cx, cy, R, rng, 0.03, 7); };
        gouache(g, bp, st, rng, [cx - R, cy - R, R * 2, R * 2], { vol: 0.3, lw: 1.3,
          over: (g) => {
            g.lineWidth = 1;
            for (let rr = r * 1.1; rr < R; rr += 2.4) { g.strokeStyle = rgba(rng.chance(0.5) ? '#a0823e' : '#f0dca0', 0.45); g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.stroke(); }
            for (let i = 0; i < 40; i++) { const t = rng.float() * TAU; g.strokeStyle = rgba('#8f6f34', 0.25); g.beginPath(); g.moveTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); g.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); g.stroke(); }
          } });
        const cp = () => ellipsePath(g, cx, cy, r * 1.0, r * 1.0);
        gouache(g, cp, shade(st, 0.08), rng, [cx - r, cy - r, r * 2, r * 2], { vol: 0.35, lw: 1.1,
          over: (g) => { g.lineWidth = 0.8; for (let rr = 2; rr < r; rr += 2.2) { g.strokeStyle = rgba('#a0823e', 0.35); g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.stroke(); } } });
        g.strokeStyle = hc; g.lineWidth = r * 0.22;
        g.beginPath(); g.arc(cx, cy, r * 1.08, 0, TAU); g.stroke();
        break;
      }
      case 'beanie': {
        const cp = () => ellipsePath(g, cx, cy + r * 0.04, r * 1.05, r * 1.05);
        gouache(g, cp, hc, rng, [cx - r * 1.1, cy - r, r * 2.2, r * 2.2], { vol: 0.35, lw: 1.3,
          over: (g) => {
            g.lineWidth = 1.2;
            for (let i = 0; i < 22; i++) { const t = (i / 22) * TAU; g.strokeStyle = rgba(shade(hc, -0.35), 0.4); g.beginPath(); g.moveTo(cx + Math.cos(t) * r * 0.15, cy + Math.sin(t) * r * 0.15); g.lineTo(cx + Math.cos(t) * r * 1.05, cy + Math.sin(t) * r * 1.05); g.stroke(); }
            g.strokeStyle = rgba(shade(hc, 0.25), 0.8); g.lineWidth = r * 0.22; g.beginPath(); g.arc(cx, cy + r * 0.04, r * 0.93, 0, TAU); g.stroke();
          } });
        const pp = () => { art.blobPath(g, cx, cy + r * 0.1, r * 0.34, rng, 0.2, 9); };
        gouache(g, pp, shade(hc, 0.35), rng, [cx - r * 0.4, cy - r * 0.3, r * 0.8, r * 0.8], { vol: 0.3, lw: 1 });
        break;
      }
      case 'scarf': {
        const cp = () => { g.beginPath(); g.ellipse(cx, cy + r * 0.1, r * 1.08, r * 1.02, 0, 0, TAU); };
        gouache(g, cp, hc, rng, [cx - r * 1.1, cy - r, r * 2.2, r * 2.2], { vol: 0.35, lw: 1.2,
          over: (g) => {
            for (let i = 0; i < 16; i++) { g.fillStyle = rgba('#f3ead6', 0.7); g.beginPath(); g.arc(cx + rng.range(-r, r), cy + rng.range(-r * 0.8, r), r * 0.07, 0, TAU); g.fill(); }
            g.strokeStyle = rgba(shade(hc, -0.4), 0.5); g.lineWidth = 1;
            for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(cx - r * 0.6 + i * r * 0.3, cy - r * 0.7); g.quadraticCurveTo(cx - r * 0.3 + i * r * 0.15, cy, cx, cy + r * 1.0); g.stroke(); }
          } });
        // knot + tails at the back
        for (const s of [-1, 1]) {
          const kp = () => { g.beginPath(); g.moveTo(cx, cy + r * 1.0); g.lineTo(cx + s * r * 0.45, cy + r * 1.6); g.lineTo(cx + s * r * 0.1, cy + r * 1.55); g.closePath(); };
          gouache(g, kp, shade(hc, -0.08), rng, [cx - r * 0.5, cy + r * 0.9, r, r * 0.8], { vol: 0.15, lw: 1 });
        }
        break;
      }
      default: {
        // no hat: a soft outline around hair edge
        g.strokeStyle = rgba(outline(a.hairStyle === 'bald' ? a.skin : a.hair), 0.55);
        g.lineWidth = 1.1;
        g.beginPath(); g.ellipse(cx, cy, r * 1.04, r * 1.06, 0, 0, TAU); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ limbs
  function foot(a) {
    const W = M(0.14), H = M(0.32);
    return art.sprite(`chr:foot:${a.boots}|${a.trousers}|${a.skirt ? 1 : 0}`, W, H, (g, w, h, rng) => {
      const cx = w / 2;
      const leg = a.skirt ? a.skin : a.trousers;
      // trouser leg / shin seen from above at the heel end
      gouache(g, () => ellipsePath(g, cx, h / 2 + M(0.055), M(0.05), M(0.055)), leg, rng, [cx - M(0.06), h / 2, M(0.12), M(0.12)], { vol: 0.35, lw: 1.1 });
      // boot: toe forward (up)
      const bp = () => {
        g.beginPath();
        g.moveTo(cx, h / 2 - M(0.135));
        g.bezierCurveTo(cx + M(0.055), h / 2 - M(0.135), cx + M(0.052), h / 2 - M(0.02), cx + M(0.042), h / 2 + M(0.07));
        g.quadraticCurveTo(cx, h / 2 + M(0.1), cx - M(0.042), h / 2 + M(0.07));
        g.bezierCurveTo(cx - M(0.052), h / 2 - M(0.02), cx - M(0.055), h / 2 - M(0.135), cx, h / 2 - M(0.135));
        g.closePath();
      };
      gouache(g, bp, a.boots, rng, [cx - M(0.06), h / 2 - M(0.14), M(0.12), M(0.24)], { vol: 0.4, lw: 1.2,
        cy: h / 2 - M(0.02), r: M(0.12),
        over: (g) => {
          // welly shine / laces
          g.strokeStyle = rgba('#fff8e6', 0.28); g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(cx - M(0.012), h / 2 - M(0.11)); g.quadraticCurveTo(cx - M(0.025), h / 2 - M(0.05), cx - M(0.02), h / 2); g.stroke();
          g.strokeStyle = rgba(shade(a.boots, -0.5), 0.55); g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx - M(0.03), h / 2 - M(0.03)); g.quadraticCurveTo(cx, h / 2 - M(0.045), cx + M(0.03), h / 2 - M(0.03)); g.stroke();
        } });
      // redraw the cuff over the boot top
      g.globalAlpha = 0.95;
      gouache(g, () => ellipsePath(g, cx, h / 2 + M(0.06), M(0.045), M(0.042)), leg, rng, [cx - M(0.05), h / 2 + M(0.02), M(0.1), M(0.09)], { vol: 0.4, lw: 1 });
      g.globalAlpha = 1;
    });
  }

  function sleeve(a) {
    const col = a.coat ? mix(a.top, '#5a4a3a', 0.35) : a.top;
    const W = M(0.12), H = M(0.32);
    return art.sprite(`chr:sleeve:${col}|${a.pattern}`, W, H, (g, w, h, rng) => {
      const cx = w / 2, r = M(0.046);
      const p = () => capsulePath(g, cx, M(0.01), h - M(0.01), r);
      gouache(g, p, col, rng, [cx - r, 0, r * 2, h], { vol: 0.35, lw: 1.2, cx, cy: h / 2, r: M(0.08),
        over: (g) => {
          if (a.pattern === 'plaid' && !a.coat) { g.fillStyle = rgba(shade(col, -0.4), 0.3); for (let y = 0; y < h; y += M(0.055)) g.fillRect(0, y, w, M(0.016)); }
          // rolled cuff near the hand end (top)
          g.fillStyle = rgba(shade(col, 0.22), 0.9); g.fillRect(cx - r, M(0.03), r * 2, M(0.03));
          g.strokeStyle = rgba(shade(col, -0.4), 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(cx - r, M(0.06)); g.lineTo(cx + r, M(0.06)); g.stroke();
          // elbow crease
          g.strokeStyle = rgba(shade(col, -0.35), 0.35); g.beginPath(); g.moveTo(cx - r * 0.6, h * 0.55); g.quadraticCurveTo(cx, h * 0.5, cx + r * 0.6, h * 0.55); g.stroke();
        } });
    });
  }

  function hand(a) {
    const col = a.gloves || a.skin;
    const W = M(0.1);
    return art.sprite(`chr:hand:${col}`, W, W, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, r = M(0.034);
      const p = () => {
        g.beginPath();
        g.ellipse(cx, cy, r, r * 1.15, 0, 0, TAU);
        g.moveTo(cx + r * 1.4, cy + r * 0.1); g.ellipse(cx + r * 0.95, cy + r * 0.1, r * 0.45, r * 0.3, -0.5, 0, TAU);
      };
      gouache(g, p, col, rng, [cx - r * 1.2, cy - r * 1.3, r * 2.6, r * 2.6], { vol: 0.35, lw: 1.1, r });
      g.strokeStyle = rgba(outline(col), 0.4); g.lineWidth = 0.8;
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(cx + i * r * 0.35, cy - r * 1.05); g.lineTo(cx + i * r * 0.35, cy - r * 0.6); g.stroke(); }
    });
  }

  function contact() {
    const W = M(0.7), H = M(0.56);
    return art.sprite('chr:contact', W, H, (g, w, h) => { art.contactShadow(g, w / 2, h / 2, w * 0.42, h * 0.4, 0.42); });
  }

  // ------------------------------------------------------------------ tools & carried items
  // spec: { len (m, true length along forward), w (m), grip (m from the back end) }
  const TOOL_SPECS = {
    hoe: { len: 1.25, w: 0.22, grip: 0.18 },
    fork: { len: 1.3, w: 0.22, grip: 0.18 },
    water: { len: 0.46, w: 0.3, grip: 0.24 },
    seed: { len: 0.24, w: 0.22, grip: 0.12 },
    lantern: { len: 0.14, w: 0.13, grip: 0.07 },
    basket: { len: 0.2, w: 0.3, grip: 0.1 },
    bag: { len: 0.14, w: 0.24, grip: 0.07 },
    bread: { len: 0.3, w: 0.14, grip: 0.15 },
    stick: { len: 0.95, w: 0.07, grip: 0.9 },
  };
  const WOOD = '#9d7650', METAL = '#8b9196';
  function shaft(g, rng, cx, y0, y1, wpx) {
    const p = () => { g.beginPath(); g.rect(cx - wpx / 2, y0, wpx, y1 - y0); };
    gouache(g, p, WOOD, rng, [cx - wpx, y0, wpx * 2, y1 - y0], { vol: 0.2, lw: 1, dabR: 1.2,
      over: (g) => { g.strokeStyle = rgba('#fff0d0', 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - wpx * 0.15, y0); g.lineTo(cx - wpx * 0.15, y1); g.stroke(); } });
  }
  function tool(kind) {
    const sp = TOOL_SPECS[kind];
    if (!sp) return null;
    const W = M(sp.w), H = M(sp.len);
    return art.sprite(`chr:tool:${kind}`, W, H, (g, w, h, rng) => {
      const cx = w / 2;
      switch (kind) {
        case 'hoe': {
          shaft(g, rng, cx, M(0.05), h - 1, M(0.034));
          const bp = () => { g.beginPath(); g.moveTo(cx - M(0.09), M(0.012)); g.lineTo(cx + M(0.09), M(0.012)); g.lineTo(cx + M(0.08), M(0.06)); g.lineTo(cx - M(0.08), M(0.06)); g.closePath(); };
          gouache(g, bp, METAL, rng, [cx - M(0.1), 0, M(0.2), M(0.07)], { vol: 0.2, lw: 1.2,
            over: (g) => { g.fillStyle = rgba(palette.rust, 0.45); g.fillRect(cx - M(0.08), M(0.035), M(0.05), M(0.02)); g.fillStyle = rgba('#e8eef0', 0.6); g.fillRect(cx - M(0.08), M(0.013), M(0.16), 1.5); } });
          g.fillStyle = shade(METAL, -0.3); g.fillRect(cx - M(0.014), M(0.05), M(0.028), M(0.05));
          break;
        }
        case 'fork': {
          shaft(g, rng, cx, M(0.3), h - 1, M(0.034));
          g.lineCap = 'round';
          const tines = [-0.075, -0.025, 0.025, 0.075];
          g.strokeStyle = shade(METAL, -0.45); g.lineWidth = M(0.02);
          g.beginPath(); g.moveTo(cx - M(0.08), M(0.3)); g.quadraticCurveTo(cx, M(0.36), cx + M(0.08), M(0.3)); g.stroke();
          for (const t of tines) { g.beginPath(); g.moveTo(cx + M(t), M(0.3)); g.lineTo(cx + M(t * 1.1), M(0.02)); g.stroke(); }
          g.strokeStyle = METAL; g.lineWidth = M(0.011);
          for (const t of tines) { g.beginPath(); g.moveTo(cx + M(t), M(0.3)); g.lineTo(cx + M(t * 1.1), M(0.025)); g.stroke(); }
          g.fillStyle = shade(METAL, -0.2); g.fillRect(cx - M(0.02), M(0.3), M(0.04), M(0.08));
          break;
        }
        case 'water': {
          const col = '#5d7a58';
          // spout to the front
          g.lineCap = 'round';
          g.strokeStyle = outline(col); g.lineWidth = M(0.036);
          g.beginPath(); g.moveTo(cx + M(0.03), M(0.24)); g.lineTo(cx + M(0.01), M(0.05)); g.stroke();
          g.strokeStyle = col; g.lineWidth = M(0.024);
          g.beginPath(); g.moveTo(cx + M(0.03), M(0.24)); g.lineTo(cx + M(0.01), M(0.05)); g.stroke();
          const rp = () => ellipsePath(g, cx + M(0.008), M(0.045), M(0.036), M(0.03));
          gouache(g, rp, '#a3a9ad', rng, [cx - M(0.04), M(0.01), M(0.09), M(0.07)], { vol: 0.25, lw: 1,
            over: (g) => { g.fillStyle = rgba('#3a3a40', 0.5); for (let i = 0; i < 7; i++) g.fillRect(cx + M(0.008) + rng.range(-M(0.02), M(0.02)), M(0.045) + rng.range(-M(0.015), M(0.015)), 1.2, 1.2); } });
          // body
          const bp = () => ellipsePath(g, cx, M(0.33), M(0.12), M(0.11));
          gouache(g, bp, col, rng, [cx - M(0.12), M(0.22), M(0.24), M(0.22)], { vol: 0.4, lw: 1.3,
            over: (g) => {
              g.strokeStyle = rgba(shade(col, -0.4), 0.5); g.lineWidth = 1;
              g.beginPath(); g.ellipse(cx, M(0.33), M(0.09), M(0.08), 0, 0, TAU); g.stroke();
              g.fillStyle = rgba('#20302a', 0.7); g.beginPath(); g.ellipse(cx, M(0.36), M(0.04), M(0.035), 0, 0, TAU); g.fill();
            } });
          // handle
          g.strokeStyle = outline(col); g.lineWidth = M(0.028);
          g.beginPath(); g.moveTo(cx, M(0.24)); g.lineTo(cx, M(0.43)); g.stroke();
          g.strokeStyle = shade(col, 0.15); g.lineWidth = M(0.016);
          g.beginPath(); g.moveTo(cx, M(0.24)); g.lineTo(cx, M(0.43)); g.stroke();
          break;
        }
        case 'seed': {
          const col = '#b89a5a';
          const bp = () => { art.blobPath(g, cx, h / 2 + M(0.01), M(0.095), rng, 0.08, 6); };
          gouache(g, bp, col, rng, [0, 0, w, h], { vol: 0.4, lw: 1.3,
            over: (g) => {
              g.strokeStyle = rgba(shade(col, -0.35), 0.35); g.lineWidth = 0.8;
              for (let y = 0; y < h; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 1); g.stroke(); }
              g.fillStyle = rgba('#e6c860', 0.9); for (let i = 0; i < 16; i++) { g.beginPath(); g.ellipse(cx + rng.range(-M(0.04), M(0.04)), h / 2 + rng.range(-M(0.03), M(0.03)), 1.4, 2, rng.float() * 3, 0, TAU); g.fill(); }
              g.strokeStyle = rgba('#5a4432', 0.8); g.lineWidth = 1.4; g.beginPath(); g.ellipse(cx, h / 2, M(0.055), M(0.045), 0, 0, TAU); g.stroke();
            } });
          break;
        }
        case 'lantern': {
          const col = '#6b5a45';
          const bp = () => { g.beginPath(); g.rect(cx - M(0.045), h / 2 - M(0.045), M(0.09), M(0.09)); };
          gouache(g, bp, col, rng, [0, 0, w, h], { vol: 0.2, lw: 1.2 });
          const gr = g.createRadialGradient(cx, h / 2, 0, cx, h / 2, M(0.05));
          gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.5, '#ffd58a'); gr.addColorStop(1, 'rgba(230,150,60,0.6)');
          g.fillStyle = gr; g.beginPath(); g.arc(cx, h / 2, M(0.034), 0, TAU); g.fill();
          g.strokeStyle = '#c99a2e'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, h / 2, M(0.05), 0, TAU); g.stroke();
          g.beginPath(); g.moveTo(cx - M(0.045), h / 2); g.lineTo(cx + M(0.045), h / 2); g.moveTo(cx, h / 2 - M(0.045)); g.lineTo(cx, h / 2 + M(0.045)); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
          break;
        }
        case 'basket': {
          const col = '#b08a5c';
          const bp = () => ellipsePath(g, cx, h / 2, M(0.13), M(0.085));
          gouache(g, bp, col, rng, [0, 0, w, h], { vol: 0.3, lw: 1.3,
            over: (g) => {
              g.lineWidth = 1; for (let x = -M(0.13); x < M(0.13); x += 3) { g.strokeStyle = rgba(shade(col, -0.4), 0.45); g.beginPath(); g.moveTo(cx + x, 0); g.lineTo(cx + x + 2, h); g.stroke(); }
              // contents: apples & a cloth
              for (let i = 0; i < 4; i++) { g.fillStyle = rng.pick(['#b8352b', '#c0643f', '#7ea84a']); g.beginPath(); g.arc(cx + rng.range(-M(0.07), M(0.07)), h / 2 + rng.range(-M(0.03), M(0.03)), M(0.025), 0, TAU); g.fill(); }
              g.fillStyle = rgba('#f2f0e6', 0.9); g.beginPath(); g.ellipse(cx + M(0.05), h / 2 + M(0.01), M(0.05), M(0.035), 0.4, 0, TAU); g.fill();
            } });
          g.strokeStyle = shade(col, -0.3); g.lineWidth = M(0.016);
          g.beginPath(); g.moveTo(cx - M(0.11), h / 2); g.quadraticCurveTo(cx, h / 2 - M(0.02), cx + M(0.11), h / 2); g.stroke();
          break;
        }
        case 'bag': {
          const col = '#8a5a3a';
          const bp = () => { g.beginPath(); g.rect(cx - M(0.1), h / 2 - M(0.05), M(0.2), M(0.1)); };
          gouache(g, bp, col, rng, [0, 0, w, h], { vol: 0.3, lw: 1.3,
            over: (g) => { g.fillStyle = shade(col, -0.2); g.fillRect(cx - M(0.1), h / 2 - M(0.05), M(0.2), M(0.04)); g.fillStyle = '#c99a2e'; g.fillRect(cx - 1.5, h / 2 - M(0.015), 3, 3); } });
          break;
        }
        case 'bread': {
          const bp = () => { g.beginPath(); g.rect(cx - M(0.05), h / 2 - M(0.05), M(0.1), M(0.14)); };
          gouache(g, bp, '#e6dcc0', rng, [0, 0, w, h], { vol: 0.2, lw: 1.1 });
          const lp = () => ellipsePath(g, cx + M(0.01), M(0.08), M(0.028), M(0.09), 0.15);
          gouache(g, lp, '#c7954a', rng, [0, 0, w, M(0.18)], { vol: 0.35, lw: 1,
            over: (g) => { g.strokeStyle = rgba('#f0d8a0', 0.8); g.lineWidth = 1.2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx - 3, M(0.03 + i * 0.045)); g.lineTo(cx + 4, M(0.045 + i * 0.045)); g.stroke(); } } });
          break;
        }
        case 'stick': {
          shaft(g, rng, cx, M(0.02), h - M(0.02), M(0.028));
          g.strokeStyle = outline(WOOD); g.lineWidth = M(0.03); g.lineCap = 'round';
          g.beginPath(); g.moveTo(cx, h - M(0.03)); g.quadraticCurveTo(cx + M(0.03), h - M(0.03), cx + M(0.025), h - M(0.01)); g.stroke();
          break;
        }
        default: break;
      }
    });
  }

  function umbrella(col) {
    const R = 0.5, W = M(R * 2 + 0.04);
    return art.sprite(`chr:umbrella:${col}`, W, W, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, r = M(R);
      const n = 8;
      const pt = (i, k = 1) => { const t = (i / n) * TAU - Math.PI / 2; return [cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k]; };
      for (let i = 0; i < n; i++) {
        const c = i % 2 ? col : shade(col, 0.18);
        const p = () => {
          const [x0, y0] = pt(i), [x1, y1] = pt(i + 1), [mx, my] = pt(i + 0.5, 0.9);
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.closePath();
        };
        gouache(g, p, c, rng, [0, 0, w, h], { vol: 0.25, lw: 1, cx, cy, r, dabs: 60, outline: false });
      }
      g.strokeStyle = rgba(outline(col), 0.8); g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const [x0, y0] = pt(i), [mx, my] = pt(i + 0.5, 0.9), [x1, y1] = pt(i + 1);
        if (i === 0) g.moveTo(x0, y0);
        if (i < n) g.quadraticCurveTo(mx, my, x1, y1);
      }
      g.stroke();
      g.lineWidth = 1; g.strokeStyle = rgba(shade(col, -0.45), 0.55);
      for (let i = 0; i < n; i++) { const [x, y] = pt(i); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,248,228,0.25)'); gr.addColorStop(0.6, 'rgba(255,248,228,0)'); gr.addColorStop(1, 'rgba(24,26,40,0.2)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.fillStyle = '#3a3a40'; g.beginPath(); g.arc(cx, cy, M(0.018), 0, TAU); g.fill();
    });
  }

  // world-ui ring for the active character (painted brush ring)
  function ring() {
    const W = M(1.1);
    return art.sprite('chr:ring', W, W, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, r = M(0.44);
      g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = rgba(k === 0 ? '#fff4d6' : '#f3ead6', k === 0 ? 0.85 : 0.35);
        g.lineWidth = k === 0 ? M(0.028) : M(0.05);
        g.beginPath();
        const a0 = rng.range(0, 1);
        for (let i = 0; i <= 60; i++) {
          const t = a0 + (i / 60) * TAU * 0.97;
          const rr = r + Math.sin(t * 3 + k) * M(0.006) + rng.range(-0.4, 0.4);
          if (i === 0) g.moveTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); else g.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
        }
        g.stroke();
      }
      // small forward chevron
      g.fillStyle = rgba('#fff4d6', 0.9);
      g.beginPath(); g.moveTo(cx, cy - r - M(0.09)); g.lineTo(cx + M(0.05), cy - r - M(0.02)); g.lineTo(cx - M(0.05), cy - r - M(0.02)); g.closePath(); g.fill();
    });
  }

  // ------------------------------------------------------------------ sleeping
  /** canvas bedroll with a pillow (0.8 × 2.0 m), painted facing up (pillow at −y) */
  function bedroll(a) {
    const W = M(0.84), H = M(2.04);
    return art.sprite(`chr:bedroll:${a.variant % 3}`, W, H, (g, w, h, rng) => {
      const cx = w / 2;
      const mat = ['#7a6a55', '#6b5d48', '#5d6b52'][a.variant % 3];
      const mp = () => { art.wobblyPath(g, [[cx - M(0.38), M(0.04)], [cx + M(0.38), M(0.04)], [cx + M(0.39), h - M(0.04)], [cx - M(0.39), h - M(0.04)]], rng, 1.2); };
      gouache(g, mp, mat, rng, [0, 0, w, h], { vol: 0.12, lw: 1.6,
        over: (g) => {
          // woven canvas + stitched hem
          g.strokeStyle = rgba(shade(mat, -0.3), 0.25); g.lineWidth = 1;
          for (let y = M(0.06); y < h - M(0.05); y += 3) { g.beginPath(); g.moveTo(cx - M(0.37), y); g.lineTo(cx + M(0.37), y + rng.range(-0.6, 0.6)); g.stroke(); }
          g.strokeStyle = rgba('#e8d9a8', 0.45); g.setLineDash([3, 3]);
          g.strokeRect(cx - M(0.34), M(0.08), M(0.68), h - M(0.16));
          g.setLineDash([]);
        } });
      // rolled foot end
      const rp = () => { g.beginPath(); g.ellipse(cx, h - M(0.1), M(0.39), M(0.08), 0, 0, TAU); };
      gouache(g, rp, shade(mat, 0.08), rng, [cx - M(0.4), h - M(0.2), M(0.8), M(0.2)], { vol: 0.35, lw: 1.3,
        over: (g) => { g.strokeStyle = rgba(shade(mat, -0.4), 0.5); g.lineWidth = 1; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx + i * M(0.14), h - M(0.17)); g.lineTo(cx + i * M(0.14), h - M(0.03)); g.stroke(); } } });
      // pillow
      const pil = '#e9e1cc';
      const pp2 = () => { g.beginPath(); g.ellipse(cx, M(0.3), M(0.3), M(0.17), 0, 0, TAU); };
      gouache(g, pp2, pil, rng, [cx - M(0.3), M(0.13), M(0.6), M(0.34)], { vol: 0.35, lw: 1.3,
        over: (g) => { g.strokeStyle = rgba(shade(pil, -0.3), 0.4); g.lineWidth = 1; g.beginPath(); g.moveTo(cx - M(0.2), M(0.28)); g.quadraticCurveTo(cx, M(0.34), cx + M(0.22), M(0.26)); g.stroke(); } });
    });
  }
  /** quilt / wool blanket over the sleeper (0.78 × 1.34 m) — body bump under it */
  function blanket(a) {
    const W = M(0.82), H = M(1.38);
    const col = a.overalls ? mix(a.overalls, '#8a3a30', 0.5) : mix(a.top, '#6b4d7a', 0.3);
    return art.sprite(`chr:blanket:${col}`, W, H, (g, w, h, rng) => {
      const cx = w / 2;
      const bp = () => {
        g.beginPath();
        g.moveTo(cx - M(0.33), M(0.05));
        g.quadraticCurveTo(cx, M(0.0), cx + M(0.34), M(0.06));
        g.quadraticCurveTo(cx + M(0.4), h / 2, cx + M(0.33), h - M(0.06));
        g.quadraticCurveTo(cx, h - M(0.01), cx - M(0.34), h - M(0.05));
        g.quadraticCurveTo(cx - M(0.4), h / 2, cx - M(0.33), M(0.05));
        g.closePath();
      };
      gouache(g, bp, col, rng, [0, 0, w, h], { vol: 0.2, lw: 1.5, cx, cy: M(0.5), r: M(0.6),
        under: (g) => {
          // quilt squares with a darker check
          g.strokeStyle = rgba(shade(col, -0.35), 0.4); g.lineWidth = 1.2;
          for (let x = cx - M(0.33); x < cx + M(0.35); x += M(0.165)) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rng.range(-1, 1), h); g.stroke(); }
          for (let y = M(0.05); y < h; y += M(0.165)) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + rng.range(-1, 1)); g.stroke(); }
          g.fillStyle = rgba(shade(col, 0.3), 0.18);
          for (let y = M(0.05), j = 0; y < h; y += M(0.165), j++) for (let x = cx - M(0.33), i = 0; x < cx + M(0.35); x += M(0.165), i++) if ((i + j) % 2) g.fillRect(x, y, M(0.165), M(0.165));
          // the sleeper's shape: shoulders, hip and knees raise the blanket
          const bump = (x, y, rx, ry, al) => { const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, `rgba(255,248,228,${al})`); gr.addColorStop(1, 'rgba(255,248,228,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); };
          bump(cx, M(0.2), M(0.28), M(0.16), 0.3);
          bump(cx + M(0.03), M(0.6), M(0.2), M(0.2), 0.22);
          bump(cx + M(0.08), M(1.0), M(0.16), M(0.14), 0.2);
          // fold creases between them
          g.strokeStyle = rgba(shade(col, -0.45), 0.35); g.lineWidth = 1.4;
          for (const y of [0.4, 0.8, 1.15]) { g.beginPath(); g.moveTo(cx - M(0.28), M(y)); g.quadraticCurveTo(cx, M(y + 0.05), cx + M(0.3), M(y - 0.02)); g.stroke(); }
        } });
      // turned-down sheet edge at the top
      const tp = () => { g.beginPath(); g.moveTo(cx - M(0.33), M(0.05)); g.quadraticCurveTo(cx, M(0.0), cx + M(0.34), M(0.06)); g.lineTo(cx + M(0.34), M(0.13)); g.quadraticCurveTo(cx, M(0.09), cx - M(0.33), M(0.12)); g.closePath(); };
      gouache(g, tp, '#ece6d8', rng, [0, 0, w, M(0.15)], { vol: 0.1, lw: 1.1 });
    });
  }

  // ------------------------------------------------------------------ showcase set dressing
  function crate(variant) {
    const W = M(0.66);
    return art.sprite(`chr:crate:${variant}`, W, W, (g, w, h, rng) => {
      const wood = ['#a47b4f', '#9a7550', '#8e6a44'][variant % 3];
      const p = () => { art.wobblyPath(g, [[M(0.03), M(0.03)], [w - M(0.03), M(0.03)], [w - M(0.03), h - M(0.03)], [M(0.03), h - M(0.03)]], rng, 0.8); };
      gouache(g, p, wood, rng, [0, 0, w, h], { vol: 0.15, lw: 1.8,
        over: (g) => {
          g.strokeStyle = rgba(shade(wood, -0.5), 0.6); g.lineWidth = 1.6;
          for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(M(0.04), i * h / 4); g.lineTo(w - M(0.04), i * h / 4 + rng.range(-1, 1)); g.stroke(); }
          g.strokeStyle = rgba(shade(wood, 0.35), 0.35); g.lineWidth = 1;
          for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) { const y = i * h / 4 + M(0.03) + k * 4; g.beginPath(); g.moveTo(M(0.06), y); g.lineTo(w - M(0.06), y + rng.range(-1, 1)); g.stroke(); }
          // frame battens + nails
          g.strokeStyle = rgba(shade(wood, -0.25), 0.9); g.lineWidth = M(0.05);
          g.strokeRect(M(0.055), M(0.055), w - M(0.11), h - M(0.11));
          g.fillStyle = '#5a5f66';
          for (const [x, y] of [[0.09, 0.09], [0.57, 0.09], [0.09, 0.57], [0.57, 0.57]]) { g.beginPath(); g.arc(M(x), M(y), 1.6, 0, TAU); g.fill(); }
          // contents: potatoes or apples
          if (variant % 2 === 0) {
            g.save(); g.beginPath(); g.rect(M(0.09), M(0.09), w - M(0.18), h - M(0.18)); g.clip();
            for (let i = 0; i < 26; i++) {
              const x = rng.range(M(0.1), w - M(0.1)), y = rng.range(M(0.1), h - M(0.1));
              const c = variant % 4 === 0 ? rng.pick(['#c7a36a', '#b8925a', '#d4b27a']) : rng.pick(['#b8352b', '#c0643f', '#9c2a24', '#7ea84a']);
              g.fillStyle = c; g.beginPath(); g.ellipse(x, y, M(0.05), M(0.043), rng.float() * 3, 0, TAU); g.fill();
              g.strokeStyle = rgba(outline(c), 0.6); g.lineWidth = 1; g.stroke();
              g.fillStyle = 'rgba(255,248,228,0.35)'; g.beginPath(); g.arc(x - 1.5, y - 1.5, 1.6, 0, TAU); g.fill();
            }
            g.restore();
          }
        } });
    });
  }
  function bale() {
    const W = M(1.3), H = M(0.62);
    return art.sprite('chr:bale', W, H, (g, w, h, rng) => {
      const st = '#d2b46e';
      const p = () => { art.wobblyPath(g, [[M(0.04), M(0.05)], [w - M(0.04), M(0.04)], [w - M(0.05), h - M(0.05)], [M(0.05), h - M(0.04)]], rng, 1.5); };
      gouache(g, p, st, rng, [0, 0, w, h], { vol: 0.3, lw: 1.6,
        under: (g) => {
          for (let i = 0; i < 260; i++) {
            const x = rng.range(0, w), y = rng.range(0, h);
            g.strokeStyle = rgba(rng.pick(['#a8884a', '#ecd79c', '#b89a5a', '#f3e2aa']), 0.6); g.lineWidth = 1;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-6, 6), y + rng.range(-2, 2)); g.stroke();
          }
        },
        over: (g) => {
          g.strokeStyle = rgba('#b8352b', 0.75); g.lineWidth = 2;
          for (const f of [0.3, 0.7]) { g.beginPath(); g.moveTo(w * f, 0); g.lineTo(w * f + 1, h); g.stroke(); }
        } });
    });
  }

  return { torso, torsoDims, skirt, hips, head, foot, sleeve, hand, contact, tool, umbrella, ring, bedroll, blanket, crate, bale, TOOL_SPECS };
}
