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
      const c = [palette.soil.ploughed, palette.soil.moist, palette.soil.dry][variant % 3];
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
      g.strokeStyle = 'rgba(230,240,240,0.55)'; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(cx, cy, 7, 6, 0, 0, TAU); g.stroke();
      const n = 7 + variant;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rng.float() * 0.4, r = rng.range(8, 12);
        g.fillStyle = `rgba(236,244,244,${rng.range(0.6, 0.95)})`;
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng.range(1, 1.9), 0, TAU); g.fill();
      }
    });
  }

  // ---------- glows ----------
  function halo(color) {
    return reg(`halo:${color}`, 64, 64, (g, w, h) => {
      const [r, gg, b] = art.hexToRgb(color);
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, `rgba(255,255,235,1)`);
      gr.addColorStop(0.1, `rgba(${r},${gg},${b},0.9)`);
      gr.addColorStop(0.35, `rgba(${r},${gg},${b},0.28)`);
      gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
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
  function tyreStamp(variant) {
    return reg(`d:tyre:${variant}`, 32, 64, (g, w, h, rng) => {
      const c = '#3a2e22';
      for (let y = 2; y < h - 2; y += 7) {
        g.fillStyle = art.rgba(c, rng.range(0.45, 0.7));
        g.beginPath();
        g.moveTo(4, y); g.lineTo(w / 2, y + 4); g.lineTo(w - 4, y); g.lineTo(w - 4, y + 3); g.lineTo(w / 2, y + 7); g.lineTo(4, y + 3);
        g.closePath(); g.fill();
      }
      g.fillStyle = art.rgba(c, 0.18); g.fillRect(3, 0, w - 6, h);
    });
  }
  function footprint(variant) {
    return reg(`d:foot:${variant}`, 32, 48, (g, w, h, rng) => {
      const c = '#3b2f24';
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
  function hoofprint(variant) {
    return reg(`d:hoof:${variant}`, 32, 32, (g, w, h, rng) => {
      const c = '#3b2f24';
      g.fillStyle = art.rgba(c, 0.6);
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(w / 2 + s * 4.5, h / 2 + rng.range(-1, 1), 3.4, 7, s * -0.15, 0, TAU); g.fill();
      }
    });
  }
  function puddle(variant) {
    return reg(`d:puddle:${variant}`, 128, 96, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      g.save(); g.translate(cx, cy); g.scale(1, h / w); g.translate(-cx, -cy);
      const r = w * 0.4;
      // darkened wet soil halo
      const halo = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.25);
      halo.addColorStop(0, 'rgba(40,30,22,0.55)'); halo.addColorStop(1, 'rgba(40,30,22,0)');
      g.fillStyle = halo; g.fillRect(0, 0, w, w);
      const shape = rng.fork('w');
      const path = () => art.blobPath(g, cx, cy, r, shape.fork('p'), 0.26, 4);
      path();
      const gr = g.createRadialGradient(cx - r * 0.15, cy - r * 0.1, r * 0.1, cx, cy, r * 1.05);
      gr.addColorStop(0, '#b4c6ce');
      gr.addColorStop(0.55, '#8ea6b2');
      gr.addColorStop(1, '#4f6674');
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      // soft cloud reflections + a couple of sky glints
      art.dabs(g, rng, 14, cx - r, cy - r, r * 2, r * 2, ['#dfe9ec', '#9fb4be', '#c7d6dc'], r * 0.12, r * 0.28, 0.3);
      g.strokeStyle = 'rgba(250,252,250,0.45)'; g.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        g.lineWidth = rng.range(1.5, 2.5);
        const y = cy - r * 0.25 + i * r * 0.35 + rng.range(-3, 3);
        g.beginPath(); g.moveTo(cx - r * 0.4 + rng.range(-6, 6), y); g.lineTo(cx + r * 0.1 + rng.range(-6, 6), y - 2); g.stroke();
      }
      // water meets mud: soft darker inner edge, no hard outline
      g.lineWidth = 9; g.strokeStyle = 'rgba(48,40,32,0.28)'; path(); g.stroke();
      g.lineWidth = 3; g.strokeStyle = 'rgba(40,32,24,0.35)'; path(); g.stroke();
      g.restore();
      g.restore();
    });
  }
  function scorch(variant) {
    return reg(`d:scorch:${variant}`, 96, 96, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      for (let i = 0; i < 26; i++) {
        const a = rng.float() * TAU, rr = rng.range(0, w * 0.3);
        const gr = g.createRadialGradient(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rng.range(8, 20));
        gr.addColorStop(0, `rgba(30,26,24,${rng.range(0.25, 0.45)})`);
        gr.addColorStop(1, 'rgba(30,26,24,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }
      art.dabs(g, rng, 30, w * 0.25, h * 0.25, w * 0.5, h * 0.5, ['#6b6560', '#8a847c', '#2a2522'], 1, 3, 0.5);
    });
  }
  function spill(color, variant) {
    const col = quant(color);
    return reg(`d:spill:${col}:${variant}`, 64, 64, (g, w, h, rng) => {
      art.blobPath(g, w / 2, h / 2, w * 0.36, rng, 0.3, 8);
      g.fillStyle = art.rgba(col, 0.75); g.fill();
      g.save(); g.clip();
      art.dabs(g, rng, 20, 0, 0, w, h, [art.shade(col, 0.25), art.shade(col, -0.25)], 1.5, 4, 0.5);
      g.restore();
      for (let i = 0; i < 6; i++) {
        g.fillStyle = art.rgba(col, 0.6);
        g.beginPath(); g.arc(w / 2 + rng.range(-28, 28), h / 2 + rng.range(-28, 28), rng.range(1, 3), 0, TAU); g.fill();
      }
    });
  }

  return {
    list, puff, chaff, clod, leaf, petal, ring, crown, halo, sparkle, butterfly, bird, softShadow,
    tyreStamp, footprint, hoofprint, puddle, scorch, spill,
    BUTTERFLY_VARIANTS: BUTTERFLY.length,
  };
}
