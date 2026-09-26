// Minimap: cached base (terrain.minimap() + roads.drawMinimap() + parcel outlines, or a painted
// parchment wash when terrain is absent) plus a cheap dynamic overlay (view rect, player, sell points).

const PARCEL_COL = { owned: [63, 107, 58], rented: [201, 154, 46], forSale: [184, 101, 46], npc: [120, 108, 90] };

function findEntity(ns, id) {
  if (!ns || id == null) return null;
  if (ns[id] && typeof ns[id].x === 'number') return ns[id];
  for (const k of Object.keys(ns)) {
    const v = ns[k];
    if (Array.isArray(v)) { const e = v.find((q) => q && q.id === id); if (e) return e; }
    else if (v && typeof v === 'object' && v[id] && typeof v[id].x === 'number') return v[id];
  }
  return null;
}

export class Minimap {
  constructor(ctx, data, size = 184) {
    this.ctx = ctx;
    this.data = data;
    this.size = size;
    this.scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1)) * 1.5;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = Math.round(size * this.scale);
    this.g = this.canvas.getContext('2d');
    this.base = null;
    this.dirty = true;
    this.sig = '';
    this.hasTerrain = false;
  }
  invalidate() { this.dirty = true; }

  _paintParchment(g, S) {
    const n = this.ctx.noise('minimap');
    const rng = this.ctx.rng('minimap');
    const R = 96;
    const c = document.createElement('canvas');
    c.width = c.height = R;
    const cg = c.getContext('2d');
    const img = cg.createImageData(R, R);
    const d = img.data;
    const paper = [236, 224, 193], meadow = [176, 180, 118], deep = [132, 150, 92];
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const v = (n.fbm(x * 0.045, y * 0.045, 4) + 1) / 2;
      const w = Math.min(1, Math.max(0, (v - 0.32) * 1.9));
      const k = Math.min(1, Math.max(0, (v - 0.62) * 3));
      const o = (y * R + x) * 4;
      for (let i = 0; i < 3; i++) d[o + i] = paper[i] + (meadow[i] - paper[i]) * w * 0.8 + (deep[i] - meadow[i]) * k * 0.6 + (rng.float() - 0.5) * 6;
      d[o + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, S, S);
    // hand-inked contour hints
    g.strokeStyle = 'rgba(110,86,50,0.16)';
    g.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const x = rng.float() * S, y = rng.float() * S;
      const v = n.fbm((x / S) * R * 0.045, (y / S) * R * 0.045, 4);
      if (v < 0.25) continue;
      g.beginPath(); g.arc(x, y, 3 + rng.float() * 5, 0.3, 2.4); g.stroke();
    }
  }

  _buildBase() {
    const ctx = this.ctx;
    const S = this.canvas.width;
    const W = ctx.world.bounds.w, H = ctx.world.bounds.h;
    const b = this.base || (this.base = document.createElement('canvas'));
    b.width = b.height = S;
    const g = b.getContext('2d');
    g.fillStyle = '#ece0c1';
    g.fillRect(0, 0, S, S);
    const terrain = ctx.modules.get('terrain');
    let img = null;
    if (terrain && typeof terrain.minimap === 'function') img = terrain.minimap(S);
    this.hasTerrain = !!(img && img.width);
    if (this.hasTerrain) g.drawImage(img, 0, 0, S, S);
    else this._paintParchment(g, S);
    // parchment toning so the map sits in the paper frame
    g.fillStyle = 'rgba(236,222,186,0.16)';
    g.fillRect(0, 0, S, S);
    const roads = ctx.modules.get('roads');
    if (roads && typeof roads.drawMinimap === 'function') {
      g.save();
      roads.drawMinimap(g, S / W);
      g.restore();
    }
    // parcels
    const sx = S / W, sy = S / H;
    for (const p of this.data.parcels()) {
      const col = PARCEL_COL[p.state] || PARCEL_COL.npc;
      g.beginPath();
      p.poly.forEach(([x, y], i) => (i ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)));
      g.closePath();
      if (p.state !== 'npc') { g.fillStyle = `rgba(${col},${p.state === 'forSale' ? 0.18 : 0.42})`; g.fill(); }
      g.strokeStyle = `rgba(${col},0.95)`;
      g.lineWidth = p.state === 'owned' || p.state === 'rented' ? 1.6 : 1;
      g.setLineDash(p.state === 'forSale' ? [3, 2] : []);
      g.stroke();
    }
    g.setLineDash([]);
    // vignette edge (old paper)
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
    gr.addColorStop(0, 'rgba(90,64,30,0)');
    gr.addColorStop(1, 'rgba(90,64,30,0.28)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    this.dirty = false;
  }

  /** redraw; cheap unless the base is dirty */
  draw() {
    const ctx = this.ctx;
    const sig = this.data.parcels().map((p) => p.id + p.state).join();
    if (sig !== this.sig) { this.sig = sig; this.dirty = true; }
    if (this.dirty || !this.base) this._buildBase();
    const g = this.g, S = this.canvas.width;
    const W = ctx.world.bounds.w, H = ctx.world.bounds.h;
    const sx = S / W, sy = S / H;
    g.drawImage(this.base, 0, 0);
    // sell points
    for (const sp of this.data.sellPoints()) {
      if (typeof sp.x !== 'number') continue;
      const x = sp.x * sx, y = sp.y * sy;
      g.fillStyle = '#c99a2e'; g.strokeStyle = '#5a3e10'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, 3.4 * this.scale / 1.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // camera view rectangle
    const v = ctx.camera.view();
    g.strokeStyle = 'rgba(46,42,36,0.85)';
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.strokeRect(Math.max(1, v.x0 * sx), Math.max(1, v.y0 * sy), Math.min(S - 2, (v.x1 - v.x0) * sx), Math.min(S - 2, (v.y1 - v.y0) * sy));
    g.setLineDash([]);
    // player marker
    const pl = ctx.world.player && ctx.world.player.activeCharacterId;
    const e = findEntity(ctx.world.characters, pl) || findEntity(ctx.world.vehicles, pl);
    if (e) {
      const x = e.x * sx, y = e.y * sy, r = e.rot || 0, k = this.scale;
      g.save();
      g.translate(x, y); g.rotate(r);
      g.beginPath(); g.moveTo(0, -6 * k); g.lineTo(4.2 * k, 4.5 * k); g.lineTo(0, 2.6 * k); g.lineTo(-4.2 * k, 4.5 * k); g.closePath();
      g.fillStyle = '#b8352b'; g.strokeStyle = '#f3ead6'; g.lineWidth = 1.4 * k;
      g.stroke(); g.fill();
      g.restore();
    }
  }
}
