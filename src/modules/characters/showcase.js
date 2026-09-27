// Showcase: a small farmyard (terrain painted), a village street (roads), set dressing, and
// staged farmhands / villagers for each preset. Showcase-only code.

export const presets = {
  default: { camera: { x: 512, y: 512, zoom: 56 }, time: '10:00' },
  walk: { camera: { x: 512, y: 512, zoom: 80 }, time: '11:00' },
  tools: { camera: { x: 512, y: 512, zoom: 64 }, time: '14:30' },
  night: { camera: { x: 512, y: 512, zoom: 42 }, time: '22:40' },
  crowd: { camera: { x: 512, y: 512, zoom: 24 }, time: '11:30' },
};

/** flat, dry site with room around it (deterministic scan) */
function findSite(terrain, x0, y0) {
  if (!terrain) return { x: x0, y: y0 };
  const ok = (x, y) => {
    for (let dy = -34; dy <= 50; dy += 6) for (let dx = -34; dx <= 34; dx += 6) {
      const s = terrain.surfaceAt(x + dx, y + dy);
      if (s === 'water' || s === 'shallow' || s === 'mud' || s === 'rock' || s === 'sand') return false;
    }
    for (let dy = -12; dy <= 12; dy += 4) for (let dx = -12; dx <= 12; dx += 4) if ((terrain.slopeAt(x + dx, y + dy) || 0) > 0.06) return false;
    return true;
  };
  for (let r = 0; r < 400; r += 16) {
    const n = Math.max(1, Math.round(r / 10));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.round(x0 + Math.cos(a) * r), y = Math.round(y0 + Math.sin(a) * r);
      if (x < 80 || y < 80 || x > 944 || y > 944) continue;
      if (ok(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

export async function stage(ctx, name, S) {
  const terrain = ctx.modules.get('terrain');
  const roads = ctx.modules.get('roads');
  const env = ctx.modules.get('environment');
  const site = findSite(terrain, 470, 430);
  const X = site.x, Y = site.y;

  // ---------------------------------------------------------------- ground
  if (terrain) {
    // painted areas never overlap (their soft edge bands would fight): yard, vegetable bed,
    // ploughed strip and a muddy patch each sit on open grass
    terrain.paintSurface({ poly: [[X - 12.5, Y - 5.5], [X - 5, Y - 6.4], [X + 1.2, Y - 5.6], [X + 1.4, Y + 1], [X + 0.8, Y + 7.6], [X - 6, Y + 8.2], [X - 12.8, Y + 7.4]] }, 'farmyard');
    terrain.paintSurface({ poly: [[X + 3.2, Y - 7], [X + 9.2, Y - 7], [X + 9.2, Y - 2], [X + 3.2, Y - 2]] }, 'soil');
    terrain.paintSurface({ poly: [[X + 4, Y + 3.5], [X + 13, Y + 3.5], [X + 13, Y + 7], [X + 4, Y + 7]] }, 'ploughed', { angle: 0 });
    terrain.paintSurface({ x: X - 3, y: Y - 10.5, r: 1.5 }, 'mud');
  }
  if (roads && name === 'crowd') {
    // gravel lane past the yard + a small village street further south (crowd preset)
    const SY = Y + 34;
    roads.generateNetwork({
      nodes: [[X - 70, Y + 10.5], [X + 70, Y + 10.5], [X + 2, Y + 10.5], [X - 60, SY], [X + 2, SY], [X + 64, SY], [X + 2, SY + 40]],
      edges: [[0, 2, 'lane'], [2, 1, 'lane'], [2, 4, 'lane'], [3, 4, 'village'], [4, 5, 'village'], [4, 6, 'village']],
    });
  }
  if (env && name === 'crowd') env.setWeather('clear', 0.4, { instant: true });
  if (env && (name === 'default' || name === 'tools' || name === 'walk')) env.setWeather('clear', 0.4, { instant: true });
  if (env && name === 'night') env.setWeather('clear', 0.3, { instant: true });

  // ---------------------------------------------------------------- set dressing (showcase only)
  const items = [
    { k: 'crate', v: 0, x: X - 6.2, y: Y - 1.2, rot: 0.08, h: 0.62 },
    { k: 'crate', v: 1, x: X - 5.5, y: Y - 1.1, rot: -0.05, h: 0.62 },
    { k: 'crate', v: 2, x: X - 5.85, y: Y - 1.18, rot: 0.15, h: 1.24, top: true },
    { k: 'crate', v: 4, x: X + 10.2, y: Y - 1.4, rot: 0.3, h: 0.62 },
    { k: 'bale', x: X - 11, y: Y + 2.4, rot: 1.45, h: 0.55 },
    { k: 'bale', x: X - 11.2, y: Y + 4.1, rot: 1.62, h: 0.55 },
  ];
  let nid = 0;
  for (const it of items) {
    if (it.top) continue;
    const w = it.k === 'bale' ? 1.3 : 0.64, h = it.k === 'bale' ? 0.62 : 0.64;
    const r = Math.abs(Math.sin(it.rot)) > 0.7 ? [h, w] : [w, h];
    ctx.spatial.insert({ id: 'characters:prop:' + nid++, kind: 'prop', x0: it.x - r[0] / 2, y0: it.y - r[1] / 2, x1: it.x + r[0] / 2, y1: it.y + r[1] / 2, solid: true, owner: 'showcase' });
  }
  const P = S.parts;
  ctx.renderer.addCollector((view, F) => {
    for (const it of items) {
      if (it.x < view.x0 - 2 || it.x > view.x1 + 2 || it.y < view.y0 - 2 || it.y > view.y1 + 2) continue;
      const img = it.k === 'bale' ? P.bale() : P.crate(it.v);
      const w = img.width / 96, h = img.height / 96;
      F.shadow.box(it.x, it.y, w * 0.95, h * 0.95, it.rot, it.h);
      F.object({ y: it.y + (it.top ? 0.01 : 0), draw: (g) => {
        g.translate(it.x, it.y - (it.top ? 0.05 : 0)); g.rotate(it.rot);
        const s = it.top ? 1.02 : 1;
        g.drawImage(img, -w / 2 * s, -h / 2 * s, w * s, h * s);
      } });
    }
  });

  // ---------------------------------------------------------------- people
  const cam = (x, y, z) => { ctx.camera.set(x, y, z); ctx.camera.follow(() => ({ x, y })); };
  const hold = (id, o) => S.api.assignTask(id, { kind: 'hold', ...o });
  const pinAction = [];
  const sp = (o) => S.spawn(o);

  if (name === 'default') {
    const you = sp({ role: 'player', name: 'Jef', x: X + 4.6, y: Y - 1.2, rot: 0, tool: 'water', sex: 'm', age: 'adult', appearance: { hat: 'flatcap' } });
    S.setActive(you, true);
    hold(you, { rot: -0.1, action: { tool: 'water', u: 0.55 } });
    const a = sp({ role: 'hired', name: 'Lotte', x: X + 11.5, y: Y - 4.5, tool: 'hoe', sex: 'f', appearance: { hat: 'straw', overalls: '#3f5f86' } });
    S.api.assignTask(a, { kind: 'work', x: X + 11.2, y: Y - 6.6, r: 2, tool: 'hoe', rot: Math.PI / 2, pace: 0.35, showcase: true });
    const b = sp({ role: 'hired', name: 'Wout', x: X - 9, y: Y + 5, tool: 'fork', sex: 'm', appearance: { hat: 'cap' } });
    S.api.assignTask(b, { kind: 'patrol', points: [[X - 9, Y + 5.5], [X - 0.5, Y + 5.2], [X - 0.8, Y - 3.8], [X - 8.5, Y - 3.5]], run: false });
    const c = sp({ role: 'hired', name: 'Marie', x: X + 7.6, y: Y - 1.1, tool: 'seed', sex: 'f', age: 'young', appearance: { hat: 'scarf' } });
    hold(c, { rot: 0.05, action: { tool: 'seed', u: 0.5 } });
    cam(X + 1.5, Y - 1, 56);
  } else if (name === 'walk') {
    // a walk-cycle "turnaround": four different farmhands mid-stride in four directions,
    // two runners, and one live walker circling
    const rows = [
      { x: X - 3.2, y: Y - 1.1, rot: Math.PI / 2, phase: 0.12, o: { sex: 'm', appearance: { hat: 'cap' } }, tool: 'hoe' },
      { x: X - 1.6, y: Y - 1.1, rot: 0, phase: 0.37, o: { sex: 'f', appearance: { hat: 'none', hairStyle: 'long' } }, tool: 'water' },
      { x: X, y: Y - 1.1, rot: Math.PI, phase: 0.62, o: { sex: 'm', age: 'old', appearance: { hat: 'flatcap' } }, tool: 'seed' },
      { x: X + 1.6, y: Y - 1.1, rot: -Math.PI / 2, phase: 0.87, o: { sex: 'f', appearance: { hat: 'straw' } }, tool: 'fork' },
      { x: X - 2.4, y: Y + 1.0, rot: Math.PI / 2, phase: 0.25, o: { sex: 'm', appearance: { hat: 'beanie' } }, tool: 'hand', run: true },
      { x: X + 0.4, y: Y + 1.0, rot: Math.PI / 2, phase: 0.75, o: { sex: 'f', appearance: { hat: 'none', hairStyle: 'bun' } }, tool: 'hand', run: true },
    ];
    let first = null;
    for (const r of rows) {
      const id = sp({ role: first ? 'hired' : 'player', x: r.x, y: r.y, rot: r.rot, tool: r.tool, ...r.o });
      if (!first) { first = id; S.setActive(id, true); }
      hold(id, { rot: r.rot, phase: r.phase, walk: 1, running: !!r.run });
    }
    const w = sp({ role: 'hired', x: X + 3, y: Y + 0.5, tool: 'hoe', sex: 'm' });
    S.api.assignTask(w, { kind: 'patrol', points: [[X + 2.6, Y - 0.2], [X + 3.6, Y + 1.8], [X + 1.8, Y + 2.4]] });
    cam(X - 0.5, Y + 0.1, 80);
  } else if (name === 'tools') {
    const list = [
      { tool: 'hoe', u: 0.3, o: { sex: 'm', appearance: { hat: 'cap' } } },
      { tool: 'hoe', u: 0.5, o: { sex: 'f', appearance: { hat: 'straw' } } },
      { tool: 'water', u: 0.6, o: { sex: 'm', age: 'old', appearance: { hat: 'flatcap' } } },
      { tool: 'seed', u: 0.52, o: { sex: 'f', appearance: { hat: 'scarf' } } },
      { tool: 'fork', u: 0.55, o: { sex: 'm', appearance: { hat: 'beanie' } } },
      { tool: 'hand', u: 0.45, o: { sex: 'f', age: 'young', appearance: { hat: 'none' } } },
    ];
    list.forEach((t, i) => {
      const x = X + 3.4 + (i % 3) * 2.1, y = Y - 2.6 + Math.floor(i / 3) * 3.4;
      const id = sp({ role: i ? 'hired' : 'player', x, y, rot: 0, tool: t.tool, ...t.o });
      if (!i) S.setActive(id, true);
      hold(id, { rot: 0, action: { tool: t.tool, u: t.u } });
    });
    // tilled cells in front of the hoers + sown rows to show the ground result
    const C = S.C;
    for (let i = 0; i < 4; i++) C.plots[`${Math.floor(X + 7.4)},${Math.floor(Y - 7 + i)}`] = { sown: 1, rot: 0 };
    cam(X + 5.5, Y - 2.2, 64);
  } else if (name === 'night') {
    const you = sp({ role: 'player', name: 'Jef', x: X - 1, y: Y + 2, rot: 1.2, tool: 'hoe', sex: 'm', appearance: { hat: 'flatcap' } });
    S.setActive(you, true);
    hold(you, { rot: 2.2, phase: 0.3, walk: 1 });
    const a = sp({ role: 'hired', name: 'Lotte', x: X + 5, y: Y - 1.5, tool: 'hoe', sex: 'f', appearance: { hat: 'straw' } });
    S.api.assignTask(a, { kind: 'work', x: X + 6, y: Y - 2.2, r: 2, tool: 'hoe', rot: 0, stay: true, pinned: true, pace: 0.5, showcase: true });
    const b = sp({ role: 'hired', name: 'Wout', x: X - 6, y: Y - 3.5, rot: 1.5708, tool: 'fork', sex: 'm', home: { x: X - 6, y: Y - 3.5, rot: 1.5708 } });
    S.api.assignTask(b, { kind: 'sleep', pinned: true });
    const c = sp({ role: 'hired', name: 'Marie', x: X + 1, y: Y + 5, tool: 'water', sex: 'f' });
    S.api.assignTask(c, { kind: 'patrol', points: [[X + 1, Y + 5], [X - 4, Y + 4.4], [X - 4.5, Y - 0.2], [X + 1.5, Y + 0.5]], pinned: true });
    cam(X, Y + 0.4, 42);
  } else if (name === 'crowd') {
    // villagers on the village street + a couple of farmhands passing on the lane
    const SY = Y + 34;
    S.villagers(18, { x0: X - 30, y0: SY - 16, x1: X + 34, y1: SY + 16 });
    const you = sp({ role: 'player', x: X + 2, y: Y + 12.5, rot: Math.PI, tool: 'hoe', sex: 'm' });
    S.setActive(you, true);
    S.api.assignTask(you, { kind: 'hold', rot: Math.PI, phase: 0.2, walk: 1 });
    const h = sp({ role: 'hired', x: X + 0.2, y: Y + 14, tool: 'fork' });
    S.api.assignTask(h, { kind: 'follow', targetId: you });
    cam(X + 2, SY - 2, 24);
    // let them spread out along the pavements before the shot
    for (let i = 0; i < 120; i++) S.simulate(1 / 60);
  }
  void pinAction;
}
