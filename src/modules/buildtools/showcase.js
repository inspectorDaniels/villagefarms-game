// buildtools — showcase: a small farm with parcels in every land state, and the tools in use.

export const deps = ['terrain', 'environment', 'roads', 'crops', 'buildings'];
export const presets = {
  default: { camera: { x: 512, y: 512, zoom: 9 }, time: '10:30' },
  invalid: { camera: { x: 512, y: 512, zoom: 9 }, time: '10:30' },
  field: { camera: { x: 512, y: 512, zoom: 6 }, time: '11:30' },
  land: { camera: { x: 512, y: 512, zoom: 2.6 }, time: '12:00' },
};

function findSite(T) {
  // the flattest dry spot for the whole parcel layout (x −160..+130, y −110..+130 around the yard corner)
  if (!T) return { x: 512, y: 512 };
  let best = { x: 512, y: 512 }, bs = Infinity;
  for (let y = 150; y <= 870; y += 40) for (let x = 190; x <= 860; x += 40) {
    let ms = 0;
    for (let dy = -110; dy <= 130 && ms < bs; dy += 15) for (let dx = -160; dx <= 130; dx += 15) {
      if ((T.waterDepthAt(x + dx, y + dy) || 0) > 0) { ms = Infinity; break; }
      ms = Math.max(ms, (T.slopeAt && T.slopeAt(x + dx, y + dy)) || 0);
    }
    if (ms < bs) { bs = ms; best = { x, y }; }
  }
  return best;
}

export async function stage(ctx, name) {
  const S = ctx.modules.get('simulation');
  const BT = ctx.modules.get('buildtools');
  const T = ctx.modules.get('terrain');
  const B = ctx.modules.get('buildings');
  const env = ctx.modules.get('environment');
  if (!S || !BT) return;
  if (env && env.setWeather) env.setWeather('clear', 0.2, { instant: true });
  const c = findSite(T);
  const X = c.x, Y = c.y;
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // yard (owned) · field parcel (rented) · neighbour · for sale · to let
  S.defineParcel({ id: 'bt:yard', name: 'Hoeve De Linde', poly: rect(X - 70, Y - 50, X + 10, Y + 40), state: 'owned', soil: 0.6 });
  S.defineParcel({ id: 'bt:rent', name: 'Lindeveld', poly: rect(X + 10, Y - 50, X + 110, Y + 40), state: 'rented', soil: 0.7 });
  S.defineParcel({ id: 'bt:npc', name: 'Hof Peeters', poly: rect(X - 70, Y + 40, X + 20, Y + 120), state: 'npc', soil: 0.5 });
  S.defineParcel({ id: 'bt:sale', name: 'Broekkant', poly: [[X + 20, Y + 40], [X + 110, Y + 40], [X + 125, Y + 125], [X + 20, Y + 120]], state: 'forSale', soil: 0.65 });
  S.defineParcel({ id: 'bt:let', name: 'Molenstuk', poly: rect(X - 160, Y - 50, X - 70, Y + 60), state: 'forRent', soil: 0.55 });
  S.credit(250000, 'misc', 'showcase capital');
  if (B) {
    B.place('farmhouse', X - 45, Y - 30, 0, { owner: 'player', anyLand: true });
    B.place('machine_shed', X - 45, Y + 10, Math.PI / 2, { owner: 'player', anyLand: true });
  }
  const C = ctx.modules.get('crops');
  if (C) C.createField([[X + 60, Y - 42], [X + 104, Y - 42], [X + 104, Y + 32], [X + 60, Y + 32]], { parcelId: 'bt:rent', crop: 'wheat', name: 'Field 1' });

  let cam = [X - 10, Y - 5, 9];
  if (name === 'invalid') {
    BT.select('building', 'barn:0');
    BT.preview(X - 25, Y + 44); // straddles the neighbour's boundary
    cam = [X - 20, Y + 10, 9];
  } else if (name === 'field') {
    BT.select('field');
    for (const p of [[X + 16, Y - 40], [X + 52, Y - 44], [X + 55, Y + 5]]) await BT.placeAt(p[0], p[1]);
    BT.preview(X + 20, Y + 30);
    cam = [X + 40, Y - 5, 6];
  } else if (name === 'land') {
    BT.enter('land');
    BT.preview(X + 70, Y + 85);
    cam = [X - 20, Y + 35, 2.6];
  } else {
    BT.select('building', 'barn:0');
    BT.preview(X - 10, Y - 20);
    cam = [X - 20, Y - 10, 9];
  }
  const U = ctx.modules.get('ui');
  if (U && U.closePanel) U.closePanel();
  ctx.camera.set(cam[0], cam[1], cam[2]);
  ctx.camera.follow(() => ({ x: cam[0], y: cam[1] }));
}
