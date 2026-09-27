// Painted particle / decal sprites for the effects module.
// Everything is painted once into ctx.art.sprite() caches (gouache look: soft noisy edges,
// tinted darker rims, inner dabs, grain) and then drawn scaled in metre space.

const TAU = Math.PI * 2;

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function createSprites(art, palette) {
  const list = [];          // index -> canvas
  const byKey = new Map();  // key -> index

  function reg(key, w, h, paint) {
    if (byKey.has(key)) return byKey.get(key);
    const c = art.sprite('fx:' + key, w, h, paint);
    list.push(c);
    byKey.set(key, list.length - 1);
    return list.length - 1;
  }

  // quantise a colour so arbitrary opts.color values don't explode the cache
  function quant(hex) {
    const [r, g, b] = art.hexToRgb(hex);
    const q = (v) => Math.min(255, Math.round(v / 12) * 12);
    return art.rgbToHex([q(r), q(g), q(b)]);
  }

  // ---------- soft cloud puff (dust, smoke, steam, spray, snow) ----------
  function puff(color, variant) {
    const col = quant(color);
    return reg(`puff:${col}:${variant}`, 64, 64, (g, w, h, rng) => {
      const n = art.noise('fxpuff' + variant);
      const base = art.hexToRgb(col);
      const light = art.hexToRgb(art.shade(col, 0.28));
      const dark = art.hexToRgb(art.shade(col, -0.22));
      const img = g.createImageData(w, h);
      const d = img.data;
      const cx = w / 2, cy = h / 2, R = w * 0.46;
      const ox = variant * 13.7, oy = variant * 7.3;
      // a few lobes so the silhouette is a cluster, not a disc
      const lobes = [];
      for (let i = 0; i < 4; i++) {
        const a = rng.float() * TAU, rr = rng.range(0.15, 0.32) * R;
        lobes.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rng.range(0.5, 0.68) * R]);
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let m = 0;
          for (const [lx, ly, lr] of lobes) {
            const dd = Math.hypot(x - lx, y - ly) / lr;
            m = Math.max(m, 1 - dd);
          }
          const nn = n.fbm(x * 0.09 + ox, y * 0.09 + oy, 3);
          const edge = smooth(0.0, 0.55, m + nn * 0.28);
          if (edge <= 0.003) continue;
          // core lighter (top-down volume), rim darker/tinted
          const t = smooth(0.0, 0.7, m + nn * 0.15);
          const k = 0.5 + nn * 0.5;
          let r = dark[0] + (base[0] - dark[0]) * t, gg = dark[1] + (base[1] - dark[1]) * t, b = dark[2] + (base[2] - dark[2]) * t;
          const lt = smooth(0.45, 0.95, m) * 0.6 * k;
          r += (light[0] - r) * lt; gg += (light[1] - gg) * lt; b += (light[2] - b) * lt;
          const grain = 1 + (rng.float() - 0.5) * 0.08;
          const o = (y * w + x) * 4;
          d[o] = r * grain; d[o + 1] = gg * grain; d[o + 2] = b * grain;
          d[o + 3] = 255 * edge * (0.72 + 0.28 * smooth(-0.3, 0.5, nn));
        }
      }
      g.putImageData(img, 0, 0);
    });
  }

  // ---------- straw / chaff sliver ----------
  function chaff(variant) {
    return reg(`chaff:${variant}`, 32, 32, (g, w, h, rng) => {
      const cols = ['#d9bf78', '#c9a95e', '#e6d08e', '#b8984f'];
      g.translate(w / 2, h / 2);
      g.rotate(rng.float() * TAU);
      const len = rng.range(10, 14);
      const c = cols[variant % cols.length];
      g.lineCap = 'round';
      g.strokeStyle = art.rgba(art.outline(c), 0.8);
      g.lineWidth = 3.8;
      g.beginPath(); g.moveTo(-len, rng.range(-2, 2)); g.quadraticCurveTo(0, rng.range(-4, 4), len, rng.range(-2, 2)); g.stroke();
      g.strokeStyle = c;
      g.lineWidth = 2.2;
      g.stroke();
      g.strokeStyle = art.rgba(art.shade(c, 0.45), 0.8);
      g.lineWidth = 0.8;
      g.stroke();
    });
  }

  // ---------- soil clod ----------
  function clod(variant) {
    return reg(`clod:${variant}`, 32, 32, (g, w, h, rng) => {
      const c = [palette.soil.dry, palette.soil.clay, palette.soil.moist][variant % 3];
      art.blobPath(g, w / 2, h / 2, w * 0.36, rng, 0.22, 6);
      g.fillStyle = c; g.fill();
      g.save(); g.clip();
      art.dabs(g, rng, 14, 0, 0, w, h, [art.shade(c, 0.2), art.shade(c, -0.25), palette.soil.furrowDark], 1.5, 4, 0.6);
      g.restore();
      art.blobPath(g, w / 2, h / 2, w * 0.36, rng, 0.22, 6);
      art.volume(g, w / 2, h / 2, w * 0.36, 0.35);
      g.strokeStyle = art.rgba(art.outline(c), 0.8); g.lineWidth = 1.4; g.stroke();
    });
  }

  // ---------- leaves & petals ----------
  function leaf(season, variant) {
    return reg(`leaf:${season}:${variant}`, 32, 32, (g, w, h, rng) => {
      const pal = season === 'autumn' ? palette.foliage.autumn.concat(['#d8a23c', '#b8452a'])
        : season === 'summer' ? palette.foliage.summer : palette.foliage.spring;
      const c = pal[variant % pal.length];
      g.translate(w / 2, h / 2);
      g.rotate(-Math.PI / 4);
      const L = 12, W = rng.range(5, 7.5);
      g.beginPath();
      if (variant % 3 === 0) {
        // lobed (oak-ish)
        const pts = 14;
        for (let i = 0; i <= pts; i++) {
          const t = i / pts, a = t * TAU;
          const lob = 1 + 0.22 * Math.sin(a * 5);
          const x = Math.sin(a) * W * lob, y = -Math.cos(a) * L * (0.9 + 0.1 * lob);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
      } else {
        g.moveTo(0, -L);
        g.bezierCurveTo(W * 1.2, -L * 0.4, W * 0.9, L * 0.6, 0, L * 0.85);
        g.bezierCurveTo(-W * 0.9, L * 0.6, -W * 1.2, -L * 0.4, 0, -L);
      }
      g.closePath();
      g.fillStyle = c; g.fill();
      g.save(); g.clip();
      art.dabs(g, rng, 8, -W, -L, W * 2, L * 2, [art.shade(c, 0.22), art.shade(c, -0.2), art.mix(c, '#8a6a2a', 0.4)], 1.5, 3.5, 0.5);
      g.restore();
      g.strokeStyle = art.rgba(art.outline(c), 0.85); g.lineWidth = 1.1; g.stroke();
      g.strokeStyle = art.rgba(art.shade(c, 0.4), 0.7); g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(0, -L * 0.8); g.lineTo(0, L * 1.05); g.stroke();
    });
  }
  function petal(variant) {
    return reg(`petal:${variant}`, 24, 24, (g, w, h, rng) => {
      const c = ['#f2d6de', '#e89ab6', '#f6eef0', '#f0c2cf'][variant % 4];
      g.translate(w / 2, h / 2); g.rotate(rng.float() * TAU);
      g.beginPath(); g.ellipse(0, 0, 7, 4.2, 0, 0, TAU);
      g.fillStyle = c; g.fill();
      g.fillStyle = art.rgba(art.shade(c, -0.15), 0.5);
      g.beginPath(); g.ellipse(-2.5, 0, 3, 2.2, 0, 0, TAU); g.fill();
      g.strokeStyle = art.rgba(art.outline(c), 0.45); g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(0, 0, 7, 4.2, 0, 0, TAU); g.stroke();
    });
  }

  // ---------- water: ring + crown splash ----------
  function ring() {
    return reg('ring', 64, 64, (g, w, h) => {
      const cx = w / 2, cy = h / 2;
      const gr = g.createRadialGradient(cx, cy, w * 0.3, cx, cy, w * 0.48);
      gr.addColorStop(0, 'rgba(223,238,233,0)');
      gr.addColorStop(0.55, 'rgba(236,246,242,0.85)');
      gr.addColorStop(0.75, 'rgba(160,196,200,0.5)');
      gr.addColorStop(1, 'rgba(47,93,116,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  }
  function crown(variant) {
    return reg(`crown:${variant}`, 32, 32, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      g.strokeStyle = 'rgba(240,248,250,0.85)'; g.lineWidth = 1.8;
      g.beginPath(); g.ellipse(cx, cy, 7, 6, 0, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(220,234,236,0.3)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(cx, cy, 13, 11.5, 0, 0, TAU); g.stroke();
      const n = 7 + variant;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rng.float() * 0.4, r = rng.range(8, 12);
        g.fillStyle = `rgba(244,250,250,${rng.range(0.75, 1)})`;
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng.range(1.3, 2.3), 0, TAU); g.fill();
      }
    });
  }

  // ---------- glows ----------
  function halo(color) {
    return reg(`halo:${color}`, 64, 64, (g, w, h) => {
      const [r, gg, b] = art.hexToRgb(color);
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, `rgba(255,255,235,1)`);
      gr.addColorStop(0.06, `rgba(250,255,220,1)`);
      gr.addColorStop(0.12, `rgba(${r},${gg},${b},0.85)`);
      gr.addColorStop(0.35, `rgba(${r},${gg},${b},0.28)`);
      gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  function ember(color) {
    return reg(`ember:${color}`, 32, 32, (g, w, h) => {
      const [r, gg, b] = art.hexToRgb(color);
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.18, `rgba(${r},${gg},${b},1)`);
      gr.addColorStop(0.45, `rgba(${r},${gg},${b},0.35)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  function sparkle() {
    return reg('sparkle', 48, 48, (g, w, h) => {
      const cx = w / 2, cy = h / 2;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
      gr.addColorStop(0, 'rgba(255,252,230,0.9)');
      gr.addColorStop(0.25, 'rgba(255,240,190,0.3)');
      gr.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,253,240,0.95)';
      for (const [a, L] of [[0, 22], [Math.PI / 2, 22], [Math.PI / 4, 11], [-Math.PI / 4, 11]]) {
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -1.8, L, 0); g.quadraticCurveTo(0, 1.8, -L, 0); g.fill();
        g.restore();
      }
    });
  }

  // ---------- butterflies (one wing pair, drawn with x-scale for the flap) ----------
  const BUTTERFLY = [
    ['#f4f1e4', '#3a3a40'],   // cabbage white
    ['#ecd35a', '#8a6a2a'],   // brimstone
    ['#b8452a', '#2e2a28'],   // peacock / red admiral
    ['#7fa2d6', '#2e3f5c'],   // common blue
    ['#e6893a', '#3a2a20'],   // orange tip-ish
  ];
  function butterfly(variant) {
    return reg(`butterfly:${variant}`, 48, 48, (g, w, h, rng) => {
      const [c, dk] = BUTTERFLY[variant % BUTTERFLY.length];
      g.translate(w / 2, h / 2);
      const wing = (sx) => {
        g.save(); g.scale(sx, 1);
        g.beginPath();
        g.moveTo(1, -2);
        g.bezierCurveTo(8, -18, 22, -14, 19, -3);
        g.bezierCurveTo(17, 1, 8, 1, 1, 1);
        g.bezierCurveTo(9, 3, 16, 8, 12, 15);
        g.bezierCurveTo(8, 19, 3, 11, 1, 3);
        g.closePath();
        g.fillStyle = c; g.fill();
        g.save(); g.clip();
        g.fillStyle = art.rgba(dk, 0.75);
        g.beginPath(); g.arc(17, -12, 5, 0, TAU); g.fill();
        g.fillStyle = art.rgba(art.shade(c, 0.35), 0.7);
        g.beginPath(); g.arc(9, -6, 3.5, 0, TAU); g.fill();
        if (variant === 2) { g.fillStyle = 'rgba(80,110,170,0.8)'; g.beginPath(); g.arc(15, -9, 2.2, 0, TAU); g.fill(); }
        g.restore();
        g.strokeStyle = art.rgba(art.outline(c), 0.9); g.lineWidth = 1.2; g.stroke();
        g.restore();
      };
      wing(1); wing(-1);
      g.fillStyle = art.outline(dk);
      g.beginPath(); g.ellipse(0, 1, 1.6, 8, 0, 0, TAU); g.fill();
      g.strokeStyle = art.rgba(dk, 0.8); g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(-0.5, -6); g.lineTo(-4, -12); g.moveTo(0.5, -6); g.lineTo(4, -12); g.stroke();
    });
  }

  // ---------- birds (3 flap frames, facing up / north) ----------
  function bird(frame, shadowOnly) {
    return reg(`bird:${frame}:${shadowOnly ? 's' : 'c'}`, 64, 64, (g, w, h) => {
      const body = shadowOnly ? palette.shadow : '#3d3530';
      const wingC = shadowOnly ? palette.shadow : '#4f463d';
      g.translate(w / 2, h / 2);
      // wing span shrinks as wings go up/down (seen from above)
      const span = [26, 20, 11][frame];
      const sweep = [2, -3, -6][frame];
      g.beginPath();
      g.moveTo(-2, -2);
      g.quadraticCurveTo(-span * 0.5, -6 + sweep, -span, 2 + sweep);
      g.quadraticCurveTo(-span * 0.55, 3 + sweep * 0.3, -2, 5);
      g.lineTo(2, 5);
      g.quadraticCurveTo(span * 0.55, 3 + sweep * 0.3, span, 2 + sweep);
      g.quadraticCurveTo(span * 0.5, -6 + sweep, 2, -2);
      g.closePath();
      g.fillStyle = wingC; g.fill();
      if (!shadowOnly) { g.strokeStyle = art.rgba(art.outline(wingC), 0.9); g.lineWidth = 1.2; g.stroke(); }
      g.beginPath(); g.ellipse(0, 1, 3, 9, 0, 0, TAU);
      g.fillStyle = body; g.fill();
      // tail
      g.beginPath(); g.moveTo(-2.5, 8); g.lineTo(0, 14); g.lineTo(2.5, 8); g.closePath(); g.fill();
      if (!shadowOnly) {
        g.fillStyle = art.rgba(art.shade(body, 0.35), 0.8);
        g.beginPath(); g.ellipse(0, -6, 2.2, 2.6, 0, 0, TAU); g.fill();
        g.fillStyle = '#c9a24a'; g.beginPath(); g.moveTo(-1, -9); g.lineTo(0, -12); g.lineTo(1, -9); g.fill();
      }
    });
  }

  // ---------- soft round shadow (particle shadows) ----------
  function softShadow() {
    return reg('softshadow', 32, 32, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      const [r, gg, b] = art.hexToRgb(palette.shadow);
      gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
      gr.addColorStop(0.5, `rgba(${r},${gg},${b},0.7)`);
      gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }

  // ---------- decals ----------
  function tyreStamp(variant, snow) {
    return reg(`d:tyre:${variant}:${snow ? 's' : 'd'}`, 32, 64, (g, w, h, rng) => {
      const c = PRINT(snow);
      for (let y = 2; y < h - 2; y += 7) {
        g.fillStyle = art.rgba(c, rng.range(0.45, 0.7));
        g.beginPath();
        g.moveTo(4, y); g.lineTo(w / 2, y + 4); g.lineTo(w - 4, y); g.lineTo(w - 4, y + 3); g.lineTo(w / 2, y + 7); g.lineTo(4, y + 3);
        g.closePath(); g.fill();
      }
      g.fillStyle = art.rgba(c, 0.18); g.fillRect(3, 0, w - 6, h);
    });
  }
  // prints on snow are pressed blue-grey hollows, not dark mud
  const PRINT = (snow) => (snow ? '#7d92b4' : '#3b2f24');
  function footprint(variant, snow) {
    return reg(`d:foot:${variant}:${snow ? 's' : 'd'}`, 32, 48, (g, w, h, rng) => {
      const c = PRINT(snow);
      const print = (x, y, flip) => {
        g.save(); g.translate(x, y); g.scale(flip, 1);
        g.fillStyle = art.rgba(c, 0.55);
        g.beginPath(); g.ellipse(0, -5, 4, 7, 0.1, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(0.5, 9, 3.2, 4, 0, 0, TAU); g.fill();
        g.fillStyle = art.rgba(c, 0.35);
        for (let i = 0; i < 4; i++) g.fillRect(-3, -10 + i * 3.2, 6, 1.2);
        g.restore();
      };
      print(9, 16 + rng.range(-1, 1), 1);
      print(23, 32 + rng.range(-1, 1), -1);
    });
  }
  function hoofprint(variant, snow) {
    return reg(`d:hoof2:${variant}:${snow ? 's' : 'd'}`, 32, 32, (g, w, h, rng) => {
      const c = PRINT(snow);
      // cloven hoof: two plump, slightly curved halves with a soft pressed edge
      for (const s of [-1, 1]) {
        const x = w / 2 + s * 4.2, y = h / 2 + rng.range(-0.8, 0.8);
        g.fillStyle = art.rgba(c, 0.22);
        g.beginPath(); g.ellipse(x, y, 5.2, 8.6, s * -0.18, 0, TAU); g.fill();
        g.fillStyle = art.rgba(c, 0.45);
        g.beginPath(); g.ellipse(x - s * 0.4, y + 0.5, 3.6, 7, s * -0.18, 0, TAU); g.fill();
      }
    });
  }
  function puddle(variant) {
    // Flat standing water, seen from above: a soft wet-dark soak in the ground, then a translucent
    // film that reflects the (pale) sky with a few long streaks of reflected cloud. Everything is
    // even-toned: no dome gradient, no outline, no centred highlight — it must never read as a stone.
    return reg(`d:puddle8:${variant}`, 160, 120, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      const r = w * 0.36;
      g.save(); g.translate(cx, cy); g.scale(1, h / w); g.translate(-cx, -cy);
      // organic outline from a few low harmonics (no spiky lobes / star shapes)
      const hs = [[2, rng.range(0.08, 0.15), rng.float() * TAU], [3, rng.range(0.04, 0.09), rng.float() * TAU], [5, rng.range(0.015, 0.035), rng.float() * TAU], [9, 0.012, rng.float() * TAU]];
      const path = (k, a0 = 0, a1 = TAU) => {
        g.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = a0 + (i / 64) * (a1 - a0);
          let rr = 1;
          for (const [f, amp, ph] of hs) rr += amp * Math.sin(a * f + ph);
          const x = cx + Math.cos(a) * r * rr * k, y = cy + Math.sin(a) * r * rr * k;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        if (a1 - a0 >= TAU) g.closePath();
      };
      // wet soak: a diffuse darkening of the ground around the water (no ring, no rim)
      const soak = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.45);
      soak.addColorStop(0, 'rgba(34,26,18,0.22)'); soak.addColorStop(0.5, 'rgba(34,26,18,0.1)'); soak.addColorStop(1, 'rgba(34,26,18,0)');
      g.fillStyle = soak; g.fillRect(0, 0, w, w);
      // water film: translucent, slightly darker and cooler than the mud (mud shows through),
      // feathered edge from several passes
      for (let k = 0; k < 6; k++) { path(1.02 - k * 0.045); g.fillStyle = 'rgba(64,82,100,0.075)'; g.fill(); }
      // sky sheen: a broad soft wash of pale sky over part of the surface
      path(0.92); g.save(); g.clip();
      // even wash (no directional gradient: that is what made r1 puddles read as domed stones)
      g.fillStyle = 'rgba(168,190,208,0.12)'; g.fillRect(0, 0, w, w);
      g.restore();
      // reflected cloud streaks (long, soft, horizontal-ish, all the same tone)
      path(0.9); g.save(); g.clip();
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const y = cy + rng.range(-0.65, 0.65) * r, x = cx + rng.range(-0.7, 0.2) * r, L = rng.range(0.3, 0.8) * r;
        g.strokeStyle = `rgba(214,228,236,${rng.range(0.12, 0.26)})`; g.lineWidth = rng.range(1.5, 4);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + L, y + rng.range(-3, 3)); g.stroke();
      }
      g.restore();
      // thin bright meniscus along part of the rim (catches the sky at the edge)
      const ga = rng.float() * TAU;
      path(0.965, ga, ga + 1.3); g.strokeStyle = 'rgba(236,244,246,0.26)'; g.lineWidth = 1.8; g.lineCap = 'round'; g.stroke();
      g.restore();
    });
  }
  // tileable dark mottle (64 px = 2 m) used as a stroke pattern to break up trail ribbons
  function mottle() {
    return reg('mottle2', 64, 64, (g, w, h, rng) => {
      for (let i = 0; i < 70; i++) {
        const x = rng.float() * w, y = rng.float() * h, rx = rng.range(2.5, 7), ry = rng.range(1.5, 4), a = rng.float() * Math.PI;
        const dark = rng.chance(0.8);
        g.fillStyle = dark ? `rgba(24,16,10,${rng.range(0.08, 0.26)})` : `rgba(255,245,225,${rng.range(0.05, 0.12)})`;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, TAU); g.fill();
        }
      }
    });
  }
  function scorch(variant) {
    // burnt patch: singed orange-brown grass ring, charred mottled centre, grey-white ash
    return reg(`d:scorch:${variant}`, 96, 96, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      const ring = g.createRadialGradient(cx, cy, w * 0.22, cx, cy, w * 0.48);
      ring.addColorStop(0, 'rgba(110,70,30,0.55)'); ring.addColorStop(0.6, 'rgba(150,100,40,0.3)'); ring.addColorStop(1, 'rgba(150,100,40,0)');
      g.fillStyle = ring; g.fillRect(0, 0, w, h);
      art.blobPath(g, cx, cy, w * 0.3, rng.fork('c'), 0.22, 6);
      g.fillStyle = 'rgba(44,34,28,0.8)'; g.fill();
      g.save(); g.clip();
      art.dabs(g, rng, 26, cx - w * 0.3, cy - h * 0.3, w * 0.6, h * 0.6, ['#2a2320', '#4a3e36', '#5f5048'], 2, 6, 0.6);
      art.dabs(g, rng, 18, cx - w * 0.2, cy - h * 0.2, w * 0.4, h * 0.4, ['#b9b2a8', '#d8d2c8', '#8f8880'], 1.5, 4, 0.6);
      g.restore();
      art.blobPath(g, cx, cy, w * 0.3, rng.fork('c'), 0.22, 6);
      g.strokeStyle = 'rgba(70,46,24,0.5)'; g.lineWidth = 2; g.stroke();
      for (let i = 0; i < 14; i++) { // charred twigs
        const a = rng.float() * TAU, r = rng.range(2, w * 0.2);
        g.strokeStyle = 'rgba(30,24,20,0.8)'; g.lineWidth = rng.range(1.5, 2.5); g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8) + rng.range(-3, 3)); g.stroke();
      }
    });
  }
  function spill(color, variant) {
    const col = quant(color);
    return reg(`d:spill:${col}:${variant}`, 96, 96, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.42);
      core.addColorStop(0, art.rgba(art.shade(col, -0.45), 0.3)); core.addColorStop(1, art.rgba(art.shade(col, -0.45), 0));
      g.fillStyle = core; g.fillRect(0, 0, w, h);
      const dark = art.shade(col, -0.35), light = art.shade(col, 0.3);
      for (let i = 0; i < 170; i++) {
        // denser in the middle, trailing out: gaussian scatter
        const px = cx + rng.gauss(0, w * 0.13), py = cy + rng.gauss(0, h * 0.13);
        if (px < 3 || py < 3 || px > w - 3 || py > h - 3) continue;
        const a = rng.float() * Math.PI;
        g.fillStyle = rng.chance(0.7) ? col : rng.chance(0.5) ? dark : light;
        g.beginPath(); g.ellipse(px, py, rng.range(1.3, 2.1), rng.range(0.8, 1.2), a, 0, Math.PI * 2); g.fill();
        g.strokeStyle = art.rgba(art.outline(col), 0.6); g.lineWidth = 0.5; g.stroke();
      }
    });
  }

  return {
    list, puff, chaff, ember, clod, leaf, petal, ring, crown, halo, sparkle, butterfly, bird, softShadow,
    tyreStamp, footprint, hoofprint, puddle, scorch, spill, mottle,
    BUTTERFLY_VARIANTS: BUTTERFLY.length,
  };
}
