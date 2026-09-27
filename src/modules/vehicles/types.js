// vehicles — type table (pure data). Units: metres, m/s, m/s², radians, litres, kg, hp.
// Geometry is in the vehicle's local frame: +y = rearwards, x = right, origin = body centre.
// Axle positions (fy = front axle, ry = rear axle) are local y. rot 0 = facing north.

export const KMH = 1 / 3.6;

// ---- surface speed factors (fraction of the type's road top speed) ----
// Tractors are geared low, so they lose less off-road than the pickup.
export const SURFACE_FACTOR = {
  tractor: { road: 1, lane: 1, track: 0.85, farmyard: 0.85, gravel: 0.8, grass: 0.62, meadow: 0.58, soil: 0.52, stubble: 0.55, ploughed: 0.42, sand: 0.45, rock: 0.35, forestFloor: 0.4, mud: 0.3, shallow: 0.22, snow: 0.5 },
  combine: { road: 1, lane: 1, track: 0.9, farmyard: 0.9, gravel: 0.85, grass: 0.75, meadow: 0.7, soil: 0.65, stubble: 0.75, ploughed: 0.5, sand: 0.5, rock: 0.35, forestFloor: 0.4, mud: 0.3, shallow: 0.2, snow: 0.5 },
  car: { road: 1, lane: 0.7, track: 0.45, farmyard: 0.45, gravel: 0.55, grass: 0.35, meadow: 0.3, soil: 0.25, stubble: 0.3, ploughed: 0.18, sand: 0.22, rock: 0.2, forestFloor: 0.2, mud: 0.12, shallow: 0.1, snow: 0.3 },
};
// maximum wading depth (m) — deeper water blocks the vehicle
export const WADE = { tractor: 0.6, combine: 0.6, car: 0.35 };
// surfaces that throw up dust / take ruts
export const DUSTY = new Set(['track', 'soil', 'ploughed', 'stubble', 'sand', 'farmyard', 'gravel', 'lane', 'mud']);
export const SOFT = new Set(['soil', 'ploughed', 'mud', 'meadow', 'grass', 'stubble', 'sand', 'snow', 'forestFloor']);

// ---- self-propelled types ----
// hp and prices of tractors/combines come from the simulation catalog (it is authoritative);
// the numbers here are only fall-backs when simulation has no entry.
export const TYPES = {
  tractor_t1: {
    kind: 'tractor', name: 'Old 95 hp tractor', catalog: 'tractor_t1', price: 26000, hp: 95, fourWD: false,
    len: 3.7, wid: 1.95, height: 2.55, fy: -1.05, ry: 1.05, maxSteer: 0.62, vmax: 30 * KMH, vrev: 9 * KMH,
    accel: 1.3, brake: 4.5, roll: 1.3, mass: 3600, tank: 110, burnIdle: 2.0, burnMax: 17,
    tyreF: { d: 0.78, w: 0.24, x: 0.66 }, tyreR: { d: 1.34, w: 0.4, x: 0.74 },
    hitchR: 1.95, hitchF: -1.95, paint: 'tractorRed', cab: 'small', beacon: true, engine: 'engine-tractor',
  },
  tractor_t2: {
    kind: 'tractor', name: '180 hp tractor', catalog: 'tractor_t2', price: 64000, hp: 180, fourWD: true,
    len: 4.6, wid: 2.3, height: 2.95, fy: -1.3, ry: 1.3, maxSteer: 0.6, vmax: 40 * KMH, vrev: 12 * KMH,
    accel: 1.7, brake: 5, roll: 1.2, mass: 6500, tank: 260, burnIdle: 2.8, burnMax: 32,
    tyreF: { d: 1.05, w: 0.42, x: 0.84 }, tyreR: { d: 1.62, w: 0.54, x: 0.9 },
    hitchR: 2.4, hitchF: -2.4, paint: 'tractorGreen', cab: 'mid', beacon: true, engine: 'engine-tractor',
  },
  tractor_t3: {
    kind: 'tractor', name: '300 hp 4WD tractor', catalog: 'tractor_t3', price: 150000, hp: 300, fourWD: true,
    len: 5.6, wid: 2.75, height: 3.3, fy: -1.55, ry: 1.55, maxSteer: 0.55, vmax: 50 * KMH, vrev: 14 * KMH,
    accel: 1.9, brake: 5.5, roll: 1.1, mass: 11500, tank: 520, burnIdle: 3.5, burnMax: 58,
    tyreF: { d: 1.5, w: 0.62, x: 0.98 }, tyreR: { d: 1.88, w: 0.7, x: 1.02 },
    hitchR: 2.9, hitchF: -2.9, paint: 'tractorBlue', cab: 'big', beacon: true, engine: 'engine-tractor',
  },
  combine_s: {
    kind: 'combine', name: 'Compact combine', catalog: 'combine_s', price: 118000, hp: 230, fourWD: false, rearSteer: true,
    len: 7.6, wid: 3.1, height: 3.9, fy: -1.9, ry: 2.2, maxSteer: 0.55, vmax: 25 * KMH, vrev: 8 * KMH,
    accel: 0.9, brake: 3.5, roll: 1.4, mass: 13000, tank: 420, burnIdle: 4, burnMax: 42,
    tyreF: { d: 1.6, w: 0.62, x: 1.12 }, tyreR: { d: 1.0, w: 0.42, x: 1.0 },
    header: { width: 4.5, depth: 1.9 }, grainTank: 7000, workSpeed: 5 * KMH, tool: 'harvest',
    paint: 'tractorGreen', beacon: true, engine: 'engine-combine',
  },
  combine_l: {
    kind: 'combine', name: 'Large combine', catalog: 'combine_l', price: 260000, hp: 420, fourWD: true, rearSteer: true,
    len: 8.8, wid: 3.5, height: 4.0, fy: -2.3, ry: 2.5, maxSteer: 0.52, vmax: 30 * KMH, vrev: 8 * KMH,
    accel: 0.9, brake: 3.5, roll: 1.4, mass: 18000, tank: 750, burnIdle: 5, burnMax: 70,
    tyreF: { d: 1.9, w: 0.8, x: 1.25 }, tyreR: { d: 1.2, w: 0.55, x: 1.1 },
    header: { width: 7.5, depth: 2.0 }, grainTank: 11000, workSpeed: 6 * KMH, tool: 'harvest',
    paint: 'tractorRed', beacon: true, engine: 'engine-combine',
  },
  pickup: {
    kind: 'car', name: 'Pickup truck', catalog: 'pickup', register: { category: 'car', price: 28000 }, price: 28000, hp: 190, fourWD: true,
    len: 5.3, wid: 1.95, height: 1.85, fy: -1.65, ry: 1.6, maxSteer: 0.6, vmax: 90 * KMH, vrev: 15 * KMH,
    accel: 3.2, brake: 7, roll: 0.5, mass: 2200, tank: 80, burnIdle: 0.9, burnMax: 16,
    tyreF: { d: 0.78, w: 0.27, x: 0.8 }, tyreR: { d: 0.78, w: 0.27, x: 0.8 },
    hitchR: 2.75, paint: 'navy', engine: 'engine-car',
  },
};

// ---- towed / mounted implements ----
// mount: 'rear' (3-point, rigid), 'front' (rigid), 'trailed' (articulated drawbar).
// hitch: distance from the implement's hitch point to its body centre (rigid) — for trailed,
// tongue = hitch → axle distance and axleY = local y of the axle (from body centre).
// work: { tool, width (m), speed (m/s cap while lowered), needHp (hp for full work speed) }.
export const IMPLEMENTS = {
  plough_s: {
    kind: 'implement', name: '7-furrow reversible plough (3 m)', kit: 'tillage_s', mount: 'rear', len: 3.45, wid: 3.0, height: 1.2, hitch: 1.78, mass: 1300,
    work: { tool: 'plough', width: 3.0, speed: 8 * KMH, needHp: 90, trail: 'furrow' }, look: 'plough', furrows: 7,
  },
  plough_l: {
    kind: 'implement', name: '9-furrow reversible plough (4.2 m)', kit: 'tillage_l', mount: 'rear', len: 4.35, wid: 4.1, height: 1.3, hitch: 2.2, mass: 2100,
    work: { tool: 'plough', width: 4.2, speed: 8 * KMH, needHp: 170, trail: 'furrow' }, look: 'plough', furrows: 9,
  },
  cultivator: {
    kind: 'implement', name: '3 m cultivator', catalog: 'cultivator', register: { category: 'tillage', price: 7500 }, mount: 'rear', len: 1.9, wid: 3.0, height: 1.0, hitch: 1.0, mass: 900,
    work: { tool: 'cultivate', width: 3.0, speed: 10 * KMH, needHp: 110, trail: 'track' }, look: 'cultivator',
  },
  seeder_s: {
    kind: 'implement', name: '3 m seed drill', kit: 'tillage_s', mount: 'rear', len: 2.1, wid: 3.0, height: 1.6, hitch: 1.1, mass: 1100,
    work: { tool: 'seed', width: 3.0, speed: 10 * KMH, needHp: 80, trail: 'track' }, look: 'seeder',
  },
  seeder_l: {
    kind: 'implement', name: '4 m seed drill', kit: 'tillage_l', mount: 'rear', len: 2.3, wid: 4.0, height: 1.7, hitch: 1.2, mass: 1600,
    work: { tool: 'seed', width: 4.0, speed: 10 * KMH, needHp: 110, trail: 'track' }, look: 'seeder',
  },
  sprayer: {
    kind: 'implement', name: '18 m sprayer', kit: 'sprayer', mount: 'rear', len: 1.9, wid: 2.4, height: 2.1, hitch: 1.0, mass: 900,
    work: { tool: 'spray', width: 18, speed: 10 * KMH, needHp: 60 }, look: 'sprayer', foldW: 2.4,
  },
  spreader: {
    kind: 'implement', name: 'Fertiliser spreader', kit: 'sprayer', mount: 'rear', len: 1.5, wid: 2.2, height: 1.4, hitch: 0.8, mass: 500,
    work: { tool: 'fertilise', width: 18, speed: 10 * KMH, needHp: 50 }, look: 'spreader',
  },
  mower: {
    kind: 'implement', name: '3 m disc mower', catalog: 'mower', mount: 'rear', len: 1.4, wid: 3.0, height: 0.9, hitch: 0.75, mass: 700,
    work: { tool: 'mow', width: 3.0, speed: 12 * KMH, needHp: 70 }, look: 'mower',
  },
  rake: {
    kind: 'implement', name: 'Rotary rake', catalog: 'rake', register: { category: 'hay', price: 6000 }, mount: 'rear', len: 2.6, wid: 3.4, height: 1.2, hitch: 1.4, mass: 600,
    work: { tool: 'rake', width: 3.4, speed: 12 * KMH, needHp: 50 }, look: 'rake',
  },
  baler: {
    kind: 'implement', name: 'Round baler', catalog: 'baler', register: { category: 'hay', price: 24000 }, mount: 'trailed', len: 3.2, wid: 2.5, height: 2.4, tongue: 3.1, axleY: 0.5, mass: 2800,
    work: { tool: 'bale', width: 3.0, speed: 12 * KMH, needHp: 80 }, look: 'baler',
  },
  root_harvester: {
    kind: 'implement', name: '2-row root harvester (potato/beet)', catalog: 'root_harvester', register: { category: 'harvester', price: 65000 }, mount: 'trailed', len: 6.2, wid: 3.0, height: 3.2, tongue: 5.2, axleY: 1.2, mass: 7500,
    work: { tool: 'harvest', width: 1.5, speed: 5 * KMH, needHp: 130 }, capacity: 6000, look: 'rootHarvester',
  },
  trailer_grain: {
    kind: 'trailer', name: '14 t tipping trailer', catalog: 'trailer', mount: 'trailed', len: 6.4, wid: 2.5, height: 2.3, tongue: 5.0, axleY: 0.9, mass: 4200,
    capacity: 14000, look: 'grainTrailer',
  },
  trailer_flat: {
    kind: 'trailer', name: 'Flatbed trailer', catalog: 'trailer_flat', register: { category: 'trailer', price: 6500 }, mount: 'trailed', len: 6.0, wid: 2.45, height: 1.2, tongue: 4.6, axleY: 0.8, mass: 2600,
    capacity: 10000, look: 'flatbed',
  },
  loader: {
    kind: 'implement', name: 'Front loader', catalog: 'front_loader', register: { category: 'loader', price: 8000 }, mount: 'front', len: 1.6, wid: 2.3, height: 1.2, hitch: 0.8, mass: 900,
    look: 'loader',
  },
};

export const ALL = Object.assign({}, TYPES, IMPLEMENTS);

// simulation catalog item → vehicle types spawned when it is bought (kits spawn several)
export const KITS = {
  tractor_t1: ['tractor_t1'], tractor_t2: ['tractor_t2'], tractor_t3: ['tractor_t3'],
  combine_s: ['combine_s'], combine_l: ['combine_l'],
  tillage_s: ['plough_s', 'seeder_s'], tillage_l: ['plough_l', 'seeder_l'],
  sprayer: ['sprayer', 'spreader'], trailer: ['trailer_grain'], mower: ['mower'],
  pickup: ['pickup'], cultivator: ['cultivator'], rake: ['rake'], baler: ['baler'],
  trailer_flat: ['trailer_flat'], front_loader: ['loader'], root_harvester: ['root_harvester'],
};

// upgrades: cost as a fraction of the machine's list price (min €)
export const UPGRADES = {
  engine: { name: 'Engine chip-tune (+20 % power)', frac: 0.1, min: 2500, kinds: ['tractor', 'combine', 'car'] },
  tyres: { name: 'Twin / flotation tyres', frac: 0.06, min: 3000, kinds: ['tractor', 'combine'] },
  gps: { name: 'GPS row guidance (auto-steer)', frac: 0, min: 6500, kinds: ['tractor', 'combine'] },
};

export const FUEL_TIME = 2;        // 1 real second of engine time burns 2 machine-seconds of diesel
export const WEAR_PER_HOUR = 0.05; // wear per real hour of engine time at full load
export const REPAIR_FRAC = 0.12;   // full repair (wear 1 → 0) costs 12 % of list price

// field efficiency (turns, overlaps, headlands) used for area rates: ha/h = width × speed × 0.36 × FIELD_EFF
export const FIELD_EFF = 0.8;
