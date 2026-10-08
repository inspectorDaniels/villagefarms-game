// buildings — scripted mechanics test in the full game (dev only). Needs the dev server on :5173.
//   node src/modules/buildings/tests/game.test.cjs
// Loads the full game (terrain … characters, buildings), stops the rAF loop and steps the engine by
// hand, then checks placement rules, functions (storage, workshop, sell points, homes), money,
// lights, save/load, determinism and per-frame cost. Prints a PASS/FAIL line per check; exit 1 on failure.
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const puppeteer = require(path.join(root, 'node_modules/puppeteer-core'));
const { findChrome, chromeArgs } = require(path.join(root, 'tools/shot.js'));

const ONLY = process.env.ONLY || 'terrain,environment,roads,simulation,ui,audio,effects,crops,vehicles,characters,buildings';

async function scenario(page) {
  return page.evaluate(async () => {
    const G = window.__GAME__;
    G.engine.running = false;
    await new Promise((r) => setTimeout(r, 50));
    const step = (n) => { for (let i = 0; i < n; i++) G.engine.step(1 / 60); };
    const B = G.modules.get('buildings'), S = G.modules.get('simulation'), T = G.modules.get('terrain'), V = G.modules.get('vehicles');
    const inst = G.engine.instances.find((i) => i.id === 'buildings').inst;
    const out = { checks: [], nums: {} };
    const check = (name, ok, info) => out.checks.push({ name, ok: !!ok, info: info === undefined ? '' : info });
    const r2 = (x) => Math.round(x * 100) / 100;
    const W = G.world;
    // first valid spot on a spiral around (x,y) → [x,y]
    const spot = (type, x, y, rot, opts = {}) => {
      for (let r = 0; r < 200; r += 6) for (let a = 0; a < Math.max(1, r); a++) {
        const px = x + Math.cos(a / Math.max(1, r) * 6.283) * r, py = y + Math.sin(a / Math.max(1, r) * 6.283) * r;
        const q = B.canPlace(type, px, py, rot, opts);
        if (q && q.ok) return [px, py];
      }
      return [x, y];
    };

    // ---- site: dry, gentle ground near the farmhands; own a 160 × 160 m parcel, neighbour to the east
    const ch = W.characters.list.find((c) => c.role === 'hired') || W.characters.list[0];
    let site = null;
    for (let r = 0; r < 300 && !site; r += 10) {
      for (let a = 0; a < 16 && !site; a++) {
        const x = ch.home.x + Math.cos(a / 16 * 6.283) * r, y = ch.home.y + Math.sin(a / 16 * 6.283) * r;
        let ok = true;
        for (let dy = -40; dy <= 40 && ok; dy += 5) for (let dx = -40; dx <= 40 && ok; dx += 5) if (T.waterDepthAt(x + dx, y + dy) > 0 || T.slopeAt(x + dx, y + dy) > 0.2) ok = false;
        if (ok) site = { x: Math.round(x), y: Math.round(y) };
      }
    }
    out.nums.site = site;
    const X = site.x, Y = site.y;
    const ox0 = Math.min(X, ch.home.x) - 80, oy0 = Math.min(Y, ch.home.y) - 80, ox1 = Math.max(X, ch.home.x) + 45, oy1 = Math.max(Y, ch.home.y) + 80;
    S.defineParcel({ id: 'test:own', poly: [[ox0, oy0], [ox1, oy0], [ox1, oy1], [ox0, oy1]], state: 'owned' });
    S.defineParcel({ id: 'test:npc', poly: [[ox1, oy0], [ox1 + 160, oy0], [ox1 + 160, oy1], [ox1, oy1]], state: 'npc' });
    S.credit(900000, 'misc', 'test capital');

    // ---- 1. placement rules
    let c = B.canPlace('farmhouse', X - 30, Y - 30, 0);
    check('canPlace on own land', c && c.ok, c);
    const nb = spot('farmhouse', ox1 + 30, Y, 0, { owner: 'npc' });
    c = B.canPlace('farmhouse', nb[0], nb[1], 0, { owner: 'npc' });
    check('npc building ignores land rights', c && c.ok && nb[0] > ox1 + 8, { c, nb });
    c = B.canPlace('farmhouse', nb[0], nb[1], 0);
    check('canPlace rejects neighbour land for the player', c && !c.ok && c.reason === 'not your land', c);
    // water: nearest water point
    let wp = null;
    const lk = (T.lakes() || [])[0];
    if (lk) wp = { x: lk.x, y: lk.y };
    else { const rp = T.riverPaths()[0]; wp = { x: rp[Math.floor(rp.length / 2)][0], y: rp[Math.floor(rp.length / 2)][1] }; }
    c = B.canPlace('village_house', wp.x, wp.y, 0, { owner: 'npc' });
    check('canPlace rejects water', c && !c.ok && c.reason === 'water', c);
    c = B.canPlace('farmhouse', 3, 3, 0, { owner: 'npc' });
    check('canPlace rejects outside map', c && !c.ok, c);

    const money0 = S.money();
    const fhAt = spot('farmhouse', ch.home.x, ch.home.y - 18, Math.PI);
    const fh = B.place('farmhouse', fhAt[0], fhAt[1], Math.PI, { pay: true });
    const fhPrice = (S.catalog('building').find((q) => q.id === 'bld_farmhouse') || {}).price;
    check('place farmhouse with pay → id + charged catalog price', fh && r2(money0 - S.money()) === fhPrice, { fh, charged: r2(money0 - S.money()), fhPrice });
    const asset = S.assets().find((a) => a.itemId === 'bld_farmhouse');
    check('farmhouse is a simulation asset with upkeep', asset && asset.upkeepPerDay > 0, asset && asset.upkeepPerDay);
    const buyLine = S.ledger(40).find((e) => /Farmhouse/.test(e.memo) && e.amount < 0);
    check('purchase booked in the buildings ledger category', buyLine && buyLine.category === 'buildings', buyLine && buyLine.category);
    c = B.canPlace('barn', fhAt[0], fhAt[1], 0);
    check('overlap with a building rejected', c && !c.ok && c.reason === 'another building', c);
    check('place returns null on invalid spot + lastError', B.place('barn', fhAt[0], fhAt[1], 0) === null && B.lastError() === 'another building', B.lastError());

    // precise colliders: a 45° shed; a coop in the empty AABB corner is fine, one on the shed is not
    const shed = B.place('machine_shed', X - 20, Y + 40, Math.PI / 4, { pay: true });
    const sh = B.get(shed);
    const corner = { x: X - 20 + 10.2, y: Y + 40 - 10.2 };   // inside the AABB (half-diagonal ≈ 10.6) but outside the rotated walls
    const cc = B.canPlace('chicken_coop', corner.x, corner.y, 0);
    const cIn = B.canPlace('chicken_coop', X - 20 + 2, Y + 40 + 2, 0);
    check('rotated footprint uses the precise polygon', cc.ok && !cIn.ok, { corner: cc, inside: cIn, w: sh.w, h: sh.h });
    const hit = G.world && B.at(X - 20, Y + 40);
    check('at(x,y) finds the shed, not its AABB corner', hit && hit.id === shed && !B.at(corner.x, corner.y), hit && hit.id);

    // ---- 2. storage capacity
    const bulk0 = S.bulkRoom();
    const silo = B.place('grain_silo', X + 10, Y + 20, 0, { pay: true });
    const bulk1 = S.bulkRoom();
    check('grain silo raises simulation bulk capacity by 400 t', silo && r2(bulk1 - bulk0) === 400, { bulk0, bulk1 });
    const pot0 = S.storageRoom('potatoes');
    const ps = B.place('potato_store', X - 55, Y + 10, Math.PI / 2, { pay: true });
    const pot1 = S.storageRoom('potatoes');
    check('potato store raises potato capacity 80 → 680 t', ps && pot0 === 80 && pot1 === 680, { pot0, pot1 });
    S.addInventory('wheat', bulk1 - 10); // fill the store
    const refused = B.remove(silo);
    check('cannot demolish a full grain store', refused && !refused.ok && refused.reason === 'store not empty', refused);
    S.removeInventory('wheat', bulk1 - 10);
    const m1 = S.money();
    const rem = B.remove(silo);
    check('remove empty silo → resale credited, capacity back', rem.ok && rem.refund > 0 && r2(S.money() - m1) === r2(rem.refund) && S.bulkRoom() === bulk0, { rem, bulk: S.bulkRoom() });
    out.nums.capacity = { beds: B.capacity('beds'), potatoes: B.capacity('potatoes') };

    // ---- 3. workshop: repair (30 % rebate) + fuel point
    const door = B.doorOf(shed);
    const fp = (W.vehicles.fuelPoints || []).find((p) => Math.hypot(p.x - door.x, p.y - door.y) < 0.5);
    check('machine shed registers a vehicles fuel point at its door', !!fp, door);
    const trac = V.spawn('tractor_t1', door.x + 4, door.y - 4, 0, { fuel: 20, wear: 0.5 });
    const mr = S.money();
    const rep = B.repairAt(trac);
    check('repair at own workshop: charged, 30 % rebated', rep && rep.cost > 0 && r2(rep.rebate) === r2(rep.cost * 0.3) && r2(mr - S.money()) === r2(rep.cost - rep.rebate) && V.get(trac).wear === 0, { rep, paid: r2(mr - S.money()) });
    const far = V.spawn('tractor_t1', X + 30, Y - 60, 0, { fuel: 20, wear: 0.5 });
    check('no repair away from a workshop', B.repairAt(far) === false);
    const lit = V.refuel(trac);
    check('refuel works at the shed fuel point', lit > 0, lit);

    // ---- 4. sell point building (grain co-op) + deliver by trailer
    const coop = B.place('grain_coop', ...spot('grain_coop', X + 100, Y - 20, 0, { owner: 'npc' }), 0, { owner: 'npc' });
    out.nums.coopErr = B.lastError();
    const cb = B.get(coop);
    const sp = S.sellPoints().find((q) => q.id === cb.sellPointId);
    check('co-op defines a simulation sell point at its door', sp && Math.hypot(sp.x - cb.doors[0].x, sp.y - cb.doors[0].y) < 0.01 && sp.accepts.includes('wheat'), sp);
    const cd = cb.doors[0];
    const tr = V.spawn('trailer_grain', cd.x + 3, cd.y - 5, 0);
    const trv = W.vehicles.list.find((v) => v.id === tr);
    trv.cargo = { item: 'wheat', kg: 8000 };
    const md = S.money();
    const del = B.deliver(tr);
    check('deliver 8 t wheat at the co-op → sold via simulation', del && del.kg === 8000 && del.euros > 1000 && r2(S.money() - md) === r2(del.euros), { del, gained: r2(S.money() - md) });
    // r2: the farm store is full (of barley) — the trailer still sells, and the store is untouched
    S.addInventory('barley', S.bulkRoom());
    const inv0 = S.inventory(), room0 = S.bulkRoom();
    trv.cargo = { item: 'wheat', kg: 8000 };
    const md2 = S.money();
    const del2 = B.deliver(tr);
    const inv1 = S.inventory();
    check('co-op sale works with the farm store full, stock unchanged', room0 === 0 && del2.kg === 8000 && del2.euros > 1000 && r2(S.money() - md2) === r2(del2.euros) && r2(inv1.barley) === r2(inv0.barley) && !(inv1.wheat > 1e-9) && V.get(tr).cargo.kg === 0, { del2, room0, barley: [inv0.barley, inv1.barley], wheat: inv1.wheat });
    trv.cargo = { item: 'potatoes', kg: 3000 };
    const del3 = B.deliver(tr);
    check('0 kg delivery carries a reason (co-op does not buy potatoes, store full)', del3.kg === 0 && typeof del3.reason === 'string' && del3.reason.length > 3, del3);
    trv.cargo = { item: null, kg: 0 };
    S.removeInventory('barley', inv0.barley);
    const shop = B.place('shop', ...spot('shop', X + 120, Y + 40, 0, { owner: 'npc' }), 0, { owner: 'npc' });
    const eggs = S.price('eggs', B.get(shop).sellPointId);
    check('shop buys eggs, not wheat', eggs > 0 && !S.price('wheat', B.get(shop).sellPointId), eggs);
    const shopSp = B.get(shop).sellPointId;
    const rmShop = B.remove(shop, { owner: 'npc' });
    check('removed shop: sell point deleted from simulation', rmShop.ok && !S.price('eggs', shopSp) && !S.sellPoints().some((q) => q.id === shopSp), S.sellPoints().map((q) => q.id));
    const npcRm = B.remove(coop);
    check('player path cannot demolish an npc building', npcRm && !npcRm.ok && npcRm.reason === 'not yours' && B.get(coop), npcRm);

    // ---- 4b. bad input never throws; force keeps sanity; granting is opt-in and never refunds
    const n0 = B.list().length;
    const bad = [B.canPlace('barn', X, Y, 0, null), B.place('barn', X + 1000, Y, 0, null), B.remove('nope', null),
      B.place('barn', NaN, NaN, 0, { force: true }), B.place('chicken_coop', -50, -50, 0, { force: true }), B.place('barn', 'a', 5, 0, { force: true })];
    check('null opts / NaN / off-map with force → clean refusals', bad[0] && typeof bad[0].ok === 'boolean' && bad[1] === null && bad[2].ok === false && bad[3] === null && bad[4] === null && bad[5] === null && B.list().length === n0 && B.lastError() === 'bad position', { bad0: bad[0], err: B.lastError() });
    const nAssets = S.assets().length;
    const gAt = spot('farmhouse', X - 60, Y - 60, 0);
    const free = B.place('farmhouse', gAt[0], gAt[1], 0);
    check('placing without pay grants no simulation asset', free && S.assets().length === nAssets, S.assets().length - nAssets);
    const mg = S.money();
    const rmFree = B.remove(free);
    const gr = B.place('farmhouse', gAt[0], gAt[1], 0, { grant: true });
    const rmGr = B.remove(gr);
    const oldId = B.place('farmhouse', gAt[0], gAt[1], 0, { grant: true, ageYears: 40 });
    const oldA = S.assets().find((q) => q.id === (B.get(oldId) || {}).assetId);
    const fhList = (S.catalog('building').find((q) => q.id === 'bld_farmhouse') || {}).price;
    check('granted 40-year farmhouse is valued at the depreciated floor (30 %)', oldA && oldA.value === Math.round(fhList * 0.3), { value: oldA && oldA.value, floor: Math.round(fhList * 0.3) });
    B.remove(oldId);
    const wo = S.ledger(10).find((e) => e.category === 'writeOff');
    check('granted building is written off (one entry, no cash)', wo && wo.amount === 0, wo);
    check('no money printing: free + granted buildings refund €0', rmFree.ok && rmGr.ok && rmFree.refund === 0 && rmGr.refund === 0 && r2(S.money()) === r2(mg) && S.assets().length === nAssets, { money: r2(S.money() - mg), rmFree, rmGr });
    const dl = B.place('dealer', ...spot('dealer', X + 100, Y + 70, 0, { owner: 'npc' }), 0, { owner: 'npc' });
    const dd = B.doorOf(dl);
    const hasFp = () => (W.vehicles.fuelPoints || []).some((p) => Math.hypot(p.x - dd.x, p.y - dd.y) < 0.5);
    const fp1 = hasFp();
    B.remove(dl, { owner: 'npc' });
    const canRm = typeof V.removeFuelPoint === 'function';
    check('dealer fuel point added, and removed on demolition (vehicles.removeFuelPoint)', fp1 && canRm && !hasFp(), { fp1, after: hasFp(), canRm });
    // an unpaid, ungranted silo adds no room, reports none and never blocks its own demolition
    const cg0 = B.capacity('grain'), br0 = S.bulkRoom();
    const sAt = spot('grain_silo', X - 60, Y + 50, 0);
    const us = B.place('grain_silo', sAt[0], sAt[1], 0);
    S.addInventory('wheat', br0);
    const cg1 = B.capacity('grain'), br1 = S.bulkRoom();
    const rmUs = B.remove(us);
    S.removeInventory('wheat', br0);
    check('unbacked silo: capacity matches real room, demolition not blocked', us && cg1 === cg0 && br1 === 0 && rmUs.ok, { cg0, cg1, br1, rmUs });
    const pl = W.characters.list.find((q) => q.id === W.player.activeCharacterId);
    const plPos = [pl.x, pl.y];
    pl.x = gAt[0]; pl.y = gAt[1];   // test only: stand the player on a clear spot
    const onPl = B.canPlace('chicken_coop', pl.x, pl.y, 0, { anyLand: true, owner: 'npc' });
    const offPl = B.canPlace('chicken_coop', pl.x + 8, pl.y, 0, { anyLand: true, owner: 'npc' });
    pl.x = plPos[0]; pl.y = plPos[1];
    check('a character in the footprint blocks placement', onPl && !onPl.ok && onPl.reason === 'someone is standing there' && offPl.ok, { onPl, offPl });

    // ---- 5. homes: the hired hand sleeps at the farmhouse door
    const home = B.nearest('farmhouse', ch.home.x, ch.home.y);
    check('nearest(farmhouse) + doorOf for characters', home && home.id === fh && B.doorOf(home.id), home && home.dist);
    const fdoor = B.doorOf(fh);
    check('door lies outside the collider', !B.at(fdoor.x, fdoor.y));
    if (home.dist < 60) {
      G.setTime('22:30');
      const hired = W.characters.list.find((q) => q.id === ch.id);
      if (hired.id === W.player.activeCharacterId) G.modules.get('characters').cycle();
      const d0 = Math.hypot(hired.x - fdoor.x, hired.y - fdoor.y);
      let n = 0;
      for (; n < 90 * 60 && hired.state !== 'inside'; n++) step(1);
      check('hired hand walks home and goes inside at the farmhouse door', hired.state === 'inside' && Math.hypot(hired.x - fdoor.x, hired.y - fdoor.y) < 0.6 && d0 > 1, { state: hired.state, startDist: r2(d0), d: r2(Math.hypot(hired.x - fdoor.x, hired.y - fdoor.y)), secs: r2(n / 60) });
    } else check('farmhouse within 60 m of the hand\'s home', false, home.dist);

    // ---- 6. vehicles collide with the precise building polygon
    // farmhouse faces south (rot π): start 10 m south of the door, facing north, drive into the wall
    const t2 = V.spawn('tractor_t2', fdoor.x, fdoor.y + 10, 0, { fuel: 50 });
    const ty0 = V.get(t2).y;
    V.enter(t2, 'test:driver');
    for (let i = 0; i < 600; i++) { V.control(t2, { throttle: 1, brake: 0, steer: 0 }); step(1); }
    const tv = V.get(t2);
    const len = (V.types()[tv.type] || {}).len || 4;
    const nose = [tv.x + Math.sin(tv.rot) * (len / 2 - 0.3), tv.y - Math.cos(tv.rot) * (len / 2 - 0.3)];
    const wallY = fdoor.y - 0.8;
    check('tractor drives up and is stopped at the wall, not inside it', tv.blocked === 'solid' && ty0 - tv.y > 3 && !B.at(tv.x, tv.y) && !B.at(nose[0], nose[1]) && tv.y - len / 2 > wallY - 0.8, { blocked: tv.blocked, moved: r2(ty0 - tv.y), front: r2(tv.y - len / 2), wallY: r2(wallY) });
    V.exit(t2);

    // ---- 7. lights: seeded schedule, F.light at night only
    G.setCamera(fhAt[0], fhAt[1], 14);
    G.setTime('21:15'); step(3);
    const lon = B.lightsOn(fh);
    G.setTime('12:00'); step(3);
    const loff = B.lightsOn(fh);
    check('farmhouse windows lit at 21:15, dark at noon', lon.windows > 0 && loff.windows === 0 && !loff.porch, { lon, loff });

    // ---- 8. events
    const ev = G.events();
    check('events buildings:placed / removed emitted', ev['buildings:placed'] >= 6 && ev['buildings:removed'] >= 2, { placed: ev['buildings:placed'], removed: ev['buildings:removed'] });

    // ---- 9. save / load round trip
    const snap = JSON.parse(JSON.stringify(inst.save()));
    for (const b of B.list()) B.remove(b.id, { force: true });
    const empty = B.list().length;
    let threw = null;
    try { inst.load({ counter: 3, list: [null, 5, 'x', { type: 'barn' }, { id: 'buildings:99', type: 'barn', x: NaN, y: 1 }] }); } catch (e) { threw = String(e); }
    check('load skips null / malformed entries without throwing', !threw && B.list().length === 0, threw);
    // old save (before r2): no `purchased` flag → an asset means it was bought
    const old = JSON.parse(JSON.stringify(snap));
    for (const q of old.list) delete q.purchased;
    inst.load(old);
    const fhOld = B.get(fh);
    check('old save: building with an assetId loads as purchased', fhOld && fhOld.assetId && fhOld.purchased === true, fhOld && [fhOld.assetId, fhOld.purchased]);
    inst.load(snap);
    const back = B.list();
    check('save/load restores buildings, colliders and sell points', empty === 0 && back.length === snap.list.length && B.at(X - 20, Y + 40) && S.price('wheat', B.get(coop).sellPointId) > 0, { n: back.length });
    out.nums.saveHash = JSON.stringify(inst.save().list.map((b) => [b.id, b.type, b.variant, r2(b.x), r2(b.y), r2(b.rot), b.doors[0].x, b.doors[0].y, b.sellPointId, b.name]));
    out.nums.lightsHash = JSON.stringify(B.list().map((b) => B.lightsOn(b.id, 21.5)));

    // ---- 10. perf with a dense village on screen at night
    const vx = X + 110, vy = Y + 20;
    for (let i = 0; i < 6; i++) B.place('village_house', ...spot('village_house', vx - 30 + i * 11, vy + 34, 0, { owner: 'npc', variant: i % 3 }), 0, { owner: 'npc', variant: i % 3 });
    for (const [t, dx, dy] of [['church', -10, 58], ['dairy', 30, 60], ['dealer', 60, 20]]) B.place(t, ...spot(t, vx + dx, vy + dy, 0, { owner: 'npc' }), 0, { owner: 'npc' });
    out.nums.total = B.list().length;
    G.setCamera(vx, vy + 30, 9);
    G.setTime('21:40');
    G.engine.running = false; G.engine.start();
    await G.waitFrames(150);
    const h = G.health().find((q) => q.id === 'buildings');
    const st = G.stats();
    out.nums.perf = { msAvg: h.msAvg, errors: h.errors, lights: st.lights, frameMsAvg: st.frameMsAvg, drawCalls: st.drawCalls };
    check('buildings ≤ 1.5 ms/frame, lights submitted at night', h.msAvg <= 1.5 && st.lights > 5 && h.errors === 0, out.nums.perf);
    return out;
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: false, args: [...chromeArgs(), '--mute-audio'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const url = `http://localhost:5173/?only=${ONLY}&freeze=1&time=11:00`;
  const run = async () => {
    await page.goto(url);
    await page.waitForFunction('window.__GAME__ && (window.__GAME__.ready || window.__GAME__.fatal)', { timeout: 90000 });
    return scenario(page);
  };
  const a = await run();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const b = await run();
  a.checks.push({ name: 'determinism: two runs give identical buildings + light schedule', ok: a.nums.saveHash === b.nums.saveHash && a.nums.lightsHash === b.nums.lightsHash, info: '' });
  let fail = 0;
  for (const c of a.checks) { if (!c.ok) fail++; console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${typeof c.info === 'string' ? c.info : JSON.stringify(c.info)}`); }
  console.log('nums', JSON.stringify({ site: a.nums.site, capacity: a.nums.capacity, total: a.nums.total, perf: a.nums.perf }));
  const bErr = errors.filter((e) => /buildings/.test(e));
  console.log(`console errors: ${errors.length} (buildings: ${bErr.length})`, errors.slice(0, 5));
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fail || bErr.length ? 1 : 0);
})();
