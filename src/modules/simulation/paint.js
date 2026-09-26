// Painting helpers for the farm-office board: paper, cork, timber, ink, watercolour washes,
// pins, tape and rubber stamps. All work in the (screen-space) pixel coords of a cache canvas.

export const INK = '#2e2a24';
export const INK_SOFT = '#5b5246';
export const INK_GREEN = '#35602f';
export const INK_RED = '#9c3328';
export const INK_BLUE = '#34506e';
export const PENCIL = '#7d7466';
export const SERIF = 'Georgia, "Times New Roman", serif';
export const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", Georgia, cursive';

export function createPainter(art, pal) {
  const papers = new Map();

  function canvas(w, h) { return art.canvas(w, h); }

  /** textured paper sheet (cached). opts: tone 'cream'|'white'|'kraft'|'blue', deckle, ruled, grid, margin */
  function paper(w, h, opts = {}) {
    w = Math.round(w); h = Math.round(h);
    const key = JSON.stringify([w, h, opts]);
    if (papers.has(key)) return papers.get(key);
    const tones = {
      cream: [pal.ui.paper, '#efe2c4', '#f6eedd', '#eadbb9'],
      white: ['#f7f2e6', '#f1eadb', '#fbf8f0', '#ece4d2'],
      kraft: ['#c9a878', '#bf9c6a', '#d3b487', '#b89060'],
      yellow: ['#f2df8e', '#ecd57e', '#f6e7a4', '#e5cc74'],
      green: ['#dfe6c8', '#d6dfbd', '#e6ebd3', '#ccd6b0'],
    };
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const rng = art.rng('paper:' + key);
    art.noiseFill(g, 0, 0, w, h, tones[opts.tone || 'cream'], { scale: 0.012, grain: 0.035, seed: 'paper' + (opts.tone || 'c'), px: 2 });
    // fibres
    g.lineWidth = 0.6;
    for (let i = 0; i < w * h * 0.0004; i++) {
      const x = rng.float() * w, y = rng.float() * h, a = rng.float() * Math.PI, l = rng.range(3, 12);
      g.strokeStyle = rng.chance(0.5) ? 'rgba(120,96,60,0.10)' : 'rgba(255,252,240,0.25)';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rng.range(-2, 2), y + Math.sin(a) * l * 0.5 + rng.range(-2, 2), x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    if (opts.ruled) {
      const top = opts.ruledTop || 70;
      for (let y = top; y < h - 20; y += opts.ruled) {
        g.strokeStyle = 'rgba(80,120,160,0.22)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(8, y + rng.range(-0.3, 0.3)); g.lineTo(w - 8, y + rng.range(-0.3, 0.3)); g.stroke();
      }
    }
    if (opts.margin) {
      g.strokeStyle = 'rgba(176,60,50,0.38)'; g.lineWidth = 1.2;
      for (const mx of [].concat(opts.margin)) { g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx + rng.range(-0.6, 0.6), h); g.stroke(); }
    }
    if (opts.grid) {
      const s = opts.grid;
      for (let x = 0; x < w; x += s) {
        const major = Math.round(x / s) % 5 === 0;
        g.strokeStyle = major ? 'rgba(90,140,120,0.26)' : 'rgba(90,140,120,0.12)'; g.lineWidth = major ? 1 : 0.7;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
      }
      for (let y = 0; y < h; y += s) {
        const major = Math.round(y / s) % 5 === 0;
        g.strokeStyle = major ? 'rgba(90,140,120,0.26)' : 'rgba(90,140,120,0.12)'; g.lineWidth = major ? 1 : 0.7;
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
      }
    }
    // age: warm darkening toward the edges + a few foxing spots
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.56);
    gr.addColorStop(0, 'rgba(160,120,60,0)');
    gr.addColorStop(1, 'rgba(150,105,50,0.22)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3 + rng.int(0, 4); i++) {
      const x = rng.float() * w, y = rng.float() * h, r = rng.range(2, 7);
      g.fillStyle = 'rgba(150,100,45,0.08)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    if (opts.deckle) {
      g.globalCompositeOperation = 'destination-in';
      const pts = [[2, 2], [w - 2, 2], [w - 2, h - 2], [2, h - 2]];
      g.fillStyle = '#000';
      art.wobblyPath(g, pts, rng, opts.deckle, true);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    papers.set(key, c);
    return c;
  }

  /** cork board texture */
  function cork(w, h) {
    const c = canvas(w, h);
    const g = c.getContext('2d');
    art.noiseFill(g, 0, 0, w, h, ['#9c7446', '#b08553', '#8a633b', '#c09561', '#a57b4a'], { scale: 0.045, grain: 0.12, seed: 'cork', px: 2 });
    const rng = art.rng('cork' + w + 'x' + h);
    for (let i = 0; i < w * h * 0.004; i++) {
      g.fillStyle = rng.chance(0.55) ? 'rgba(70,45,22,0.35)' : 'rgba(225,190,140,0.30)';
      const r = rng.range(0.6, 2.2);
      g.beginPath(); g.ellipse(rng.float() * w, rng.float() * h, r, r * rng.range(0.5, 1), rng.float() * 3, 0, 7); g.fill();
    }
    // old pin holes
    for (let i = 0; i < w * h * 0.00005; i++) {
      g.fillStyle = 'rgba(40,26,14,0.55)';
      g.beginPath(); g.arc(rng.float() * w, rng.float() * h, 1.1, 0, 7); g.fill();
    }
    return c;
  }

  /** painted timber frame of thickness t around a w×h rect (drawn at 0,0) */
  function timberFrame(g, w, h, t) {
    const rng = art.rng('frame');
    const cols = pal.timber;
    const sides = [[0, 0, w, t, 'h'], [0, h - t, w, t, 'h'], [0, 0, t, h, 'v'], [w - t, 0, t, h, 'v']];
    for (const [x, y, ww, hh, dir] of sides) {
      g.save();
      g.beginPath(); g.rect(x, y, ww, hh); g.clip();
      g.fillStyle = art.shade(cols[0], -0.1); g.fillRect(x, y, ww, hh);
      const n = dir === 'h' ? hh : ww;
      for (let i = 0; i < n; i += 1.5) {
        g.strokeStyle = rng.chance(0.5) ? art.rgba(art.shade(cols[1], 0.05), 0.35) : art.rgba(cols[2], 0.35);
        g.lineWidth = rng.range(0.6, 1.6);
        g.beginPath();
        if (dir === 'h') { g.moveTo(x, y + i); for (let s = 0; s <= ww; s += 40) g.lineTo(x + s, y + i + Math.sin(s * 0.013 + i) * 1.2); }
        else { g.moveTo(x + i, y); for (let s = 0; s <= hh; s += 40) g.lineTo(x + i + Math.sin(s * 0.013 + i) * 1.2, y + s); }
        g.stroke();
      }
      // bevel shading
      const gr = dir === 'h' ? g.createLinearGradient(0, y, 0, y + hh) : g.createLinearGradient(x, 0, x + ww, 0);
      gr.addColorStop(0, 'rgba(255,240,210,0.22)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(30,18,8,0.35)');
      g.fillStyle = gr; g.fillRect(x, y, ww, hh);
      g.restore();
    }
    // mitred corners
    g.strokeStyle = 'rgba(40,24,10,0.45)'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(t, t); g.moveTo(w, 0); g.lineTo(w - t, t); g.moveTo(0, h); g.lineTo(t, h - t); g.moveTo(w, h); g.lineTo(w - t, h - t);
    g.stroke();
    // inner shadow on the cork
    const sh = 14;
    const grads = [
      [t, t, w - 2 * t, sh, g.createLinearGradient(0, t, 0, t + sh)],
      [t, t, sh, h - 2 * t, g.createLinearGradient(t, 0, t + sh, 0)],
    ];
    for (const [x, y, ww, hh, gr] of grads) { gr.addColorStop(0, 'rgba(30,18,8,0.45)'); gr.addColorStop(1, 'rgba(30,18,8,0)'); g.fillStyle = gr; g.fillRect(x, y, ww, hh); }
  }

  /** draw a sheet with a soft cast shadow, rotated about its centre. body(g) draws in sheet coords. */
  function sheet(g, img, cx, cy, rot, body, lift = 1) {
    const w = img.width, h = img.height;
    g.save();
    g.translate(cx, cy); g.rotate(rot);
    g.save();
    g.shadowColor = 'rgba(28,18,8,0.45)';
    g.shadowBlur = 10 + 8 * lift; g.shadowOffsetX = 3 * lift; g.shadowOffsetY = 6 * lift;
    g.drawImage(img, -w / 2, -h / 2);
    g.restore();
    g.translate(-w / 2, -h / 2);
    if (body) body(g, w, h);
    g.restore();
  }

  function pin(g, x, y, color = '#b8352b') {
    g.save();
    g.fillStyle = 'rgba(20,12,6,0.35)';
    g.beginPath(); g.ellipse(x + 3, y + 4, 7, 5, 0.5, 0, 7); g.fill();
    const gr = g.createRadialGradient(x - 2.5, y - 2.5, 0.5, x, y, 7.5);
    gr.addColorStop(0, art.shade(color, 0.6)); gr.addColorStop(0.45, color); gr.addColorStop(1, art.shade(color, -0.5));
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
    g.strokeStyle = art.rgba(art.outline(color), 0.7); g.lineWidth = 0.8; g.stroke();
    g.fillStyle = 'rgba(255,250,235,0.8)'; g.beginPath(); g.arc(x - 2.4, y - 2.6, 1.6, 0, 7); g.fill();
    g.restore();
  }

  function tape(g, x, y, w, rot, rng) {
    g.save();
    g.translate(x, y); g.rotate(rot);
    const h = 22;
    g.beginPath();
    g.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 6; i++) g.lineTo(-w / 2 + (w * i) / 6, -h / 2 + (i % 2 ? 1.2 : -0.6));
    for (let i = 0; i <= 5; i++) g.lineTo(w / 2 + (i % 2 ? 2 : -1), -h / 2 + (h * i) / 5);
    for (let i = 6; i >= 0; i--) g.lineTo(-w / 2 + (w * i) / 6, h / 2 + (i % 2 ? -0.8 : 0.8));
    for (let i = 5; i >= 0; i--) g.lineTo(-w / 2 + (i % 2 ? -2 : 1), -h / 2 + (h * i) / 5);
    g.closePath();
    g.fillStyle = 'rgba(236,226,192,0.72)'; g.fill();
    g.strokeStyle = 'rgba(160,140,100,0.35)'; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = 'rgba(255,255,245,0.18)'; g.fillRect(-w / 2 + 4, -h / 2 + 3, w - 8, 4);
    if (rng) for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(140,120,80,0.10)'; g.fillRect(rng.range(-w / 2, w / 2), rng.range(-h / 2, h / 2), 2, 1); }
    g.restore();
  }

  function text(g, s, x, y, o = {}) {
    g.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size || 14}px ${o.font || SERIF}`;
    g.textAlign = o.align || 'left';
    g.textBaseline = o.base || 'alphabetic';
    g.fillStyle = o.color || INK;
    g.globalAlpha = o.alpha == null ? 0.92 : o.alpha;
    if (o.maxW) s = fit(g, s, o.maxW);
    if (o.halo) { g.save(); g.globalAlpha = 0.75; g.strokeStyle = o.halo; g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeText(s, x, y); g.restore(); }
    g.fillText(s, x, y);
    g.globalAlpha = 1;
    return g.measureText(s).width;
  }
  function fit(g, s, maxW) {
    if (g.measureText(s).width <= maxW) return s;
    while (s.length > 2 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  /** hand-inked polyline */
  function ink(g, pts, rng, o = {}) {
    if (pts.length < 2) return;
    g.save();
    g.strokeStyle = o.color || INK;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const passes = o.passes || 2;
    for (let p = 0; p < passes; p++) {
      g.globalAlpha = (o.alpha || 0.85) * (p ? 0.45 : 1);
      g.lineWidth = (o.w || 1.4) * (p ? 0.6 : 1);
      g.beginPath();
      const j = (o.jitter == null ? 0.5 : o.jitter);
      pts.forEach(([x, y], i) => { const X = x + rng.range(-j, j), Y = y + rng.range(-j, j); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      if (o.close) g.closePath();
      g.stroke();
    }
    g.restore();
  }
  function line(g, x0, y0, x1, y1, rng, o = {}) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 30));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    ink(g, pts, rng, o);
  }

  /** watercolour wash over path built by pathFn(g): layered translucent fills + darker pooled edge */
  function wash(g, pathFn, color, rng, o = {}) {
    g.save();
    const a = o.alpha == null ? 0.32 : o.alpha;
    for (let i = 0; i < 3; i++) {
      g.save();
      g.translate(rng.range(-1.2, 1.2), rng.range(-1.2, 1.2));
      pathFn(g);
      g.fillStyle = art.rgba(color, a * (i === 0 ? 1 : 0.45));
      g.fill();
      g.restore();
    }
    pathFn(g);
    g.strokeStyle = art.rgba(art.shade(color, -0.25), a * 1.1);
    g.lineWidth = o.edge || 1.6;
    g.stroke();
    // pigment granulation
    pathFn(g); g.clip();
    const b = o.bounds;
    if (b) {
      for (let i = 0; i < (b[2] * b[3]) / 90; i++) {
        g.fillStyle = art.rgba(rng.chance(0.5) ? art.shade(color, -0.3) : art.shade(color, 0.35), 0.12);
        g.beginPath(); g.arc(b[0] + rng.float() * b[2], b[1] + rng.float() * b[3], rng.range(0.6, 2.4), 0, 7); g.fill();
      }
    }
    g.restore();
  }

  /** hatch the current clip area */
  function hatch(g, pathFn, b, color, rng, spacing = 7, angle = -0.8) {
    g.save();
    pathFn(g); g.clip();
    g.strokeStyle = art.rgba(color, 0.45); g.lineWidth = 1;
    const c = Math.cos(angle), s = Math.sin(angle);
    const R = Math.hypot(b[2], b[3]);
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    for (let d = -R; d < R; d += spacing) {
      g.beginPath();
      g.moveTo(cx + c * -R - s * d + rng.range(-1, 1), cy + s * -R + c * d);
      g.lineTo(cx + c * R - s * d + rng.range(-1, 1), cy + s * R + c * d);
      g.stroke();
    }
    g.restore();
  }

  /** rubber stamp (ink with gaps) */
  function stamp(g, label, x, y, color, rot, rng, o = {}) {
    g.save();
    g.translate(x, y); g.rotate(rot);
    const size = o.size || 16;
    g.font = `bold ${size}px ${SERIF}`;
    const tw = g.measureText(label).width;
    const w = tw + 22, h = size + 14;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w + 8); c.height = Math.ceil(h + 8);
    const s = c.getContext('2d');
    s.strokeStyle = color; s.fillStyle = color; s.lineWidth = 2.4;
    s.beginPath(); s.rect(4, 4, w, h); s.stroke();
    s.lineWidth = 1; s.beginPath(); s.rect(7, 7, w - 6, h - 6); s.stroke();
    s.font = `bold ${size}px ${SERIF}`; s.textAlign = 'center'; s.textBaseline = 'middle';
    s.fillText(label, 4 + w / 2, 4 + h / 2 + 1);
    // worn ink: knock out speckles
    s.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < (w * h) / 14; i++) { s.globalAlpha = rng.range(0.3, 1); s.fillRect(rng.float() * c.width, rng.float() * c.height, rng.range(0.8, 2.2), rng.range(0.8, 2)); }
    g.globalAlpha = o.alpha || 0.72;
    g.drawImage(c, -c.width / 2, -c.height / 2);
    g.restore();
  }

  /** coffee ring stain */
  function coffeeRing(g, x, y, r, rng) {
    g.save();
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = `rgba(120,78,36,${0.10 + i * 0.03})`;
      g.lineWidth = rng.range(1.5, 4);
      g.beginPath(); g.arc(x + rng.range(-1, 1), y + rng.range(-1, 1), r + rng.range(-1.5, 1.5), rng.range(0, 1), rng.range(4.8, 6.2)); g.stroke();
    }
    g.fillStyle = 'rgba(140,95,45,0.05)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.restore();
  }

  return { paper, cork, timberFrame, sheet, pin, tape, text, fit, ink, line, wash, hatch, stamp, coffeeRing };
}
