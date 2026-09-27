// Appearance generation: seeded, palette-based outfits for farmhands and villagers.
// An appearance is plain data (saved with the character) — sprites are keyed by it.

export const FIRST_NAMES = {
  m: ['Tom', 'Jef', 'Pieter', 'Wout', 'Luc', 'Bram', 'Stijn', 'Koen', 'Arne', 'Joris', 'Dirk', 'Gust', 'Rik', 'Marc', 'Lode'],
  f: ['Marie', 'Lotte', 'Anke', 'Els', 'Fien', 'Griet', 'Hanne', 'Ilse', 'Josefien', 'Lien', 'Nele', 'Roos', 'Sofie', 'Trees', 'Yana'],
};

export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'bald', 'crop'];
export const HATS = ['none', 'cap', 'flatcap', 'straw', 'beanie', 'scarf'];

const BOOTS = { welly: '#3f5a3e', wellyBlack: '#2f3136', leather: '#6a4a30', shoe: '#4a3a30', red: '#8a3a30' };
const TROUSERS = ['#4a4f5c', '#5a4a3a', '#3f4a5a', '#6b6450', '#3a3a40', '#6e5a44'];
const OVERALLS = ['#3f5f86', '#4d6b4a', '#6e5a44', '#2e3f5c', '#7a4a3a'];
const HAT_COLS = ['#8a3a30', '#3f5f86', '#5d6b3a', '#c49a3c', '#3a3a40', '#b86b3a', '#6b4d7a'];
const SKIRTS = ['#6b4d7a', '#3f5f86', '#8a3a30', '#5d6b3a', '#7a6a55', '#2e3f5c'];

/**
 * make an appearance. role: 'player'|'hired'|'villager'. rng: core Rng.
 * Farmhands get working clothes (overalls, wellies, caps); villagers get everyday clothes,
 * skirts/coats/aprons, baskets and walking sticks.
 */
export function makeAppearance(rng, role, palette, opts = {}) {
  const sex = opts.sex || (rng.chance(0.5) ? 'm' : 'f');
  const age = opts.age || rng.weighted([['adult', 6], ['young', 2], ['old', 2]]);
  const skin = rng.pick(palette.skin);
  let hair = rng.pick(palette.hair.slice(0, 4).concat(palette.hair[5]));
  if (age === 'old') hair = rng.chance(0.7) ? palette.hair[4] : '#c8c4bc';
  const cloth = palette.cloth;
  const farm = role !== 'villager';
  let hairStyle = sex === 'm'
    ? rng.weighted([['short', 5], ['crop', 3], ['curly', 2], ['bald', age === 'old' ? 4 : 0.6], ['long', 0.5]])
    : rng.weighted([['long', 4], ['bun', 4], ['curly', 2], ['short', 1.5]]);
  let hat = farm
    ? rng.weighted([['cap', 4], ['flatcap', 3], ['straw', 2], ['beanie', 1.2], ['none', 1.5], ['scarf', sex === 'f' ? 1.5 : 0]])
    : rng.weighted([['none', 6], ['flatcap', sex === 'm' ? 2.5 : 0.2], ['cap', 1], ['beanie', 0.8], ['scarf', sex === 'f' ? 1.4 : 0], ['straw', 0.6]]);
  const top = rng.pick(cloth);
  let overalls = null;
  let skirt = null;
  let apron = null;
  let coat = false;
  if (farm) {
    if (rng.chance(0.7)) overalls = rng.pick(OVERALLS.filter((c) => c !== top));
  } else {
    if (sex === 'f' && rng.chance(0.55)) skirt = rng.pick(SKIRTS.filter((c) => c !== top));
    if (rng.chance(0.18)) apron = rng.chance(0.5) ? '#ece6d8' : '#c9b184';
    coat = rng.chance(age === 'old' ? 0.6 : 0.3);
  }
  const pattern = rng.weighted([['plain', farm ? 3 : 5], ['plaid', farm ? 3 : 1], ['stripe', 1.2], ['knit', 0.8]]);
  const boots = farm ? rng.pick([BOOTS.welly, BOOTS.wellyBlack, BOOTS.leather, BOOTS.welly])
    : rng.pick([BOOTS.shoe, BOOTS.leather, BOOTS.shoe, BOOTS.red]);
  const trousers = rng.pick(TROUSERS);
  const build = age === 'young' ? rng.range(0.9, 0.98) : rng.range(0.94, 1.1);
  const a = {
    sex, age, skin, hair, hairStyle, hat,
    hatColor: hat === 'straw' ? '#d8b46a' : rng.pick(HAT_COLS),
    top, pattern, overalls, skirt, apron, coat, trousers, boots,
    gloves: farm && rng.chance(0.5) ? '#a07a4e' : null,
    scarf: rng.chance(0.25) ? rng.pick(HAT_COLS) : null,
    build: +build.toFixed(2),
    carry: farm ? null : rng.weighted([['none', 6], ['basket', 2], ['bag', 1.5], ['stick', age === 'old' ? 4 : 0], ['bread', 0.8]]),
    variant: rng.int(0, 999),
  };
  Object.assign(a, opts.appearance || {});
  if (opts.appearance && opts.appearance.hat === 'straw' && !opts.appearance.hatColor) a.hatColor = '#d8b46a';
  return a;
}

/** stable key for sprite caching */
export function appKey(a) {
  return [a.skin, a.hair, a.hairStyle, a.hat, a.hatColor, a.top, a.pattern, a.overalls || '-', a.skirt || '-', a.apron || '-',
    a.coat ? 1 : 0, a.trousers, a.boots, a.gloves || '-', a.scarf || '-', a.build, a.variant % 7].join('|');
}

/** portrait fields for ui.setCharacters */
export function portraitOf(a) {
  const style = a.hat === 'cap' || a.hat === 'flatcap' ? 'cap' : (a.hairStyle === 'crop' ? 'short' : a.hairStyle);
  return { skin: a.skin, hair: a.hair, cloth: a.overalls || a.top, style };
}

export function pickName(rng, sex, used) {
  const pool = FIRST_NAMES[sex] || FIRST_NAMES.m;
  for (let i = 0; i < 20; i++) {
    const n = rng.pick(pool);
    if (!used.has(n)) return n;
  }
  return rng.pick(pool);
}
