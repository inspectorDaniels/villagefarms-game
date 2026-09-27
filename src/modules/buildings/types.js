// buildings — type table. Local frame of a building: x → right, y → down, the FRONT (main door)
// is the −y side, so at rot 0 a building faces north (engine convention: rot 0 = up, clockwise).
// Every type is made of parts: 'gable' (rectangular body + pitched roof, ridge along local x),
// 'silo' (round bin with conical cap) or 'tower' (square tower with a spire).
//
// function keys:
//   home:{beds}                      characters sleep here (door used by characters/ai.js sleep task)
//   storage:{item,t}                 raises simulation capacity (grain via catalog asset, potatoes via setCapacity)
//   livestock:{kind,n}               animal places (read by animals through capacity(kind))
//   services:['repair','fuel']       vehicles repair / vehicles.addFuelPoint at the door
//   sell:{accepts,name}              simulation.defineSellPoint at the door
// catalog: id registered with simulation.registerCatalogItem (grain silos reuse simulation's own
// grain_store / grain_store_l entries so bulkRoom() counts them).

export const TYPES = {
  farmhouse: {
    name: 'Farmhouse', group: 'farm', lights: 'home', chimney: true, porch: true,
    fn: { home: { beds: 4 } },
    catalog: { id: 'bld_farmhouse', category: 'building', price: 180000 },
    variants: [
      { parts: [{ k: 'gable', w: 14, d: 9, eave: 3.4, ridge: 8, mat: 'terracotta', chim: [[-5.2, 0], [5.2, 0]], sky: [[-2, 2.4], [2.5, 2.4]] }] },
      { parts: [{ k: 'gable', w: 16, d: 8.5, eave: 3.2, ridge: 7.6, mat: 'slate', chim: [[-6.2, 0], [1.5, 0]], sky: [[-3, 2.2], [4, 2.2]] },
        { k: 'gable', x: 4.5, y: 6.2, w: 5, d: 4.2, eave: 2.6, ridge: 4.6, mat: 'slate', rot: Math.PI / 2 }] },
    ],
  },
  barn: {
    name: 'Barn', group: 'farm', lights: 'work',
    fn: { storage: { item: 'straw', t: 250 } },
    catalog: { id: 'bld_barn', category: 'building', price: 65000 },
    variants: [
      { parts: [{ k: 'gable', w: 22, d: 13, eave: 5, ridge: 10, mat: 'slate' }] },
      { name: 'Hay barn', parts: [{ k: 'gable', w: 18, d: 10, eave: 5.5, ridge: 8.5, mat: 'metal', open: true }] },
    ],
  },
  machine_shed: {
    name: 'Machine shed & workshop', group: 'farm', lights: 'work', porch: true,
    fn: { services: ['repair', 'fuel'] },
    catalog: { id: 'bld_machine_shed', category: 'building', price: 55000 },
    variants: [
      { parts: [{ k: 'gable', w: 18, d: 12, eave: 5, ridge: 7.2, mat: 'metal', wide: true }] },
      { parts: [{ k: 'gable', w: 24, d: 14, eave: 5.5, ridge: 8, mat: 'metal', wide: true }] },
    ],
  },
  grain_silo: {
    name: 'Grain silo', group: 'farm', lights: 'none',
    fn: { storage: { item: 'grain', t: 400 } },
    catalog: { id: 'grain_store', category: 'storage', price: 40000, external: true },
    variants: [
      { parts: [{ k: 'silo', r: 3.6, h: 12 }] },
      { catalog: { id: 'grain_store_l', category: 'storage', price: 85000, external: true }, fn: { storage: { item: 'grain', t: 1000 } },
        name: 'Grain silo & dryer', parts: [{ k: 'silo', x: -3.2, r: 4.2, h: 15 }, { k: 'silo', x: 5.6, r: 4.2, h: 15 }] },
    ],
  },
  potato_store: {
    name: 'Potato store', group: 'farm', lights: 'work',
    fn: { storage: { item: 'potatoes', t: 600 } },
    catalog: { id: 'bld_potato_store', category: 'storage_potato', price: 45000, meta: { capacity: 600, item: 'potatoes' } },
    variants: [
      { parts: [{ k: 'gable', w: 18, d: 12, eave: 6, ridge: 8, mat: 'panel', wide: true }] },
    ],
  },
  cow_shed: {
    name: 'Cow shed', group: 'farm', lights: 'work',
    fn: { livestock: { kind: 'cows', n: 40 } },
    catalog: { id: 'bld_cow_shed', category: 'building', price: 70000 },
    variants: [
      { parts: [{ k: 'gable', w: 26, d: 14, eave: 3.8, ridge: 7.5, mat: 'fibre', vent: true }] },
      { fn: { livestock: { kind: 'cows', n: 24 } }, parts: [{ k: 'gable', w: 18, d: 12, eave: 3.6, ridge: 7, mat: 'fibre', vent: true }] },
    ],
  },
  sheep_shelter: {
    name: 'Sheep shelter', group: 'farm', lights: 'none',
    fn: { livestock: { kind: 'sheep', n: 25 } },
    catalog: { id: 'bld_sheep_shelter', category: 'building', price: 9000 },
    variants: [{ parts: [{ k: 'gable', w: 12, d: 6, eave: 2.4, ridge: 3.8, mat: 'metal', open: true }] }],
  },
  chicken_coop: {
    name: 'Chicken coop', group: 'farm', lights: 'none',
    fn: { livestock: { kind: 'chickens', n: 30 } },
    catalog: { id: 'bld_chicken_coop', category: 'building', price: 3500 },
    variants: [
      { parts: [{ k: 'gable', w: 5, d: 3.2, eave: 1.8, ridge: 2.8, mat: 'felt' }] },
      { fn: { livestock: { kind: 'chickens', n: 60 } }, parts: [{ k: 'gable', w: 8, d: 4, eave: 2, ridge: 3.2, mat: 'felt' }] },
    ],
  },
  village_house: {
    name: 'House', group: 'village', lights: 'home', chimney: true, porch: true,
    fn: { home: { beds: 3 } },
    catalog: { id: 'bld_house', category: 'building', price: 150000 },
    variants: [
      { name: 'Detached house', parts: [{ k: 'gable', w: 9, d: 8, eave: 3.2, ridge: 7.6, mat: 'terracotta', chim: [[3.2, 0]], sky: [[-2, 2]] }] },
      { name: 'Row house', parts: [{ k: 'gable', w: 6.5, d: 10, eave: 5.6, ridge: 9.4, mat: 'slate', chim: [[-2.6, 0]], sky: [[1.2, 2.6]] }] },
      { name: 'Cottage', parts: [{ k: 'gable', w: 10, d: 6.5, eave: 2.6, ridge: 6.4, mat: 'thatch', chim: [[-3.6, 0]] }] },
    ],
  },
  shop: {
    name: 'Village shop', group: 'village', lights: 'shop', porch: true, chimney: true,
    fn: { sell: { name: 'Village shop', accepts: ['eggs', 'potatoes', 'wool', 'milk'] } },
    variants: [{ parts: [{ k: 'gable', w: 12, d: 9, eave: 3.6, ridge: 7.8, mat: 'slate', chim: [[4.6, 0]], sky: [[-3, 2.4]] }] }],
  },
  grain_coop: {
    name: 'Grain co-op', group: 'village', lights: 'work', porch: true,
    fn: { sell: { name: 'Grain co-op', accepts: ['wheat', 'barley', 'oats', 'rapeseed', 'maize'] }, services: ['weigh'] },
    variants: [{ parts: [{ k: 'gable', w: 22, d: 12, eave: 6, ridge: 9, mat: 'metal', wide: true },
      { k: 'silo', x: -6.5, y: 11, r: 4, h: 18 }, { k: 'silo', x: 2.5, y: 11, r: 4, h: 18 }, { k: 'silo', x: 11, y: 11, r: 3.2, h: 16 }] }],
  },
  dairy: {
    name: 'Dairy', group: 'village', lights: 'work', porch: true,
    fn: { sell: { name: 'Valley dairy', accepts: ['milk', 'eggs'] } },
    variants: [{ parts: [{ k: 'gable', w: 16, d: 11, eave: 4.5, ridge: 7.5, mat: 'panel', vent: true }, { k: 'silo', x: 10.5, y: 2, r: 1.8, h: 7, tank: true }] }],
  },
  dealer: {
    name: 'Agricultural dealer', group: 'village', lights: 'shop', porch: true,
    fn: { sell: { name: 'Dealer (fodder trade)', accepts: ['hay', 'straw'] }, services: ['repair', 'fuel', 'dealer'] },
    variants: [{ parts: [{ k: 'gable', w: 22, d: 13, eave: 5.5, ridge: 8, mat: 'metal', wide: true, stripe: true }] }],
  },
  church: {
    name: 'Church', group: 'village', lights: 'church',
    fn: {},
    variants: [{ parts: [{ k: 'gable', x: 3, w: 22, d: 11, eave: 7, ridge: 14, mat: 'slate' }, { k: 'tower', x: -10.5, w: 6.5, d: 6.5, h: 26 }] }],
  },
};

export const MATERIALS = ['terracotta', 'slate', 'metal', 'fibre', 'panel', 'felt', 'thatch'];

/** merged definition for type + variant */
export function defOf(type, variant = 0) {
  const T = TYPES[type];
  if (!T) return null;
  const vi = Math.max(0, Math.min(T.variants.length - 1, variant | 0));
  const V = T.variants[vi];
  return {
    type, variant: vi, name: V.name || T.name, group: T.group, lights: T.lights, porch: !!T.porch, chimney: !!T.chimney,
    fn: { ...T.fn, ...(V.fn || {}) }, catalog: V.catalog || T.catalog || null,
    parts: V.parts.map((p) => ({ x: 0, y: 0, rot: 0, ...p })),
  };
}
