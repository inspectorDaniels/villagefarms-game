// The shared palette. Every module colours from these tokens (tints/shades allowed via art.shade/mix).
// Style: painted gouache, slightly desaturated, warm earth + cool shadows.

export const palette = {
  // vegetation by season
  grass: {
    spring: ['#7fa650', '#8fb65a', '#6e9444', '#9cc067'],
    summer: ['#6f9a3f', '#7ea84a', '#5e8636', '#8aae52'],
    autumn: ['#94984a', '#a39a4e', '#7e8540', '#b2a458'],
    winter: ['#8d9579', '#9ba287', '#7b846a', '#b9bcae'],
  },
  meadow: ['#a3b25c', '#b8be6a', '#8d9f4d', '#c9c27a'],
  foliage: {
    spring: ['#6f9e3e', '#86b24c', '#5a8a33', '#a6c96a'],
    summer: ['#4f7f2f', '#5f8f38', '#3f6b27', '#78a148'],
    autumn: ['#c07a2c', '#d49a3a', '#a4542a', '#8f6a2a'],
    winter: ['#6b5a45', '#7a6a55', '#5a4a38', '#8b7b68'],
  },
  conifer: ['#2f5a3a', '#3b6b45', '#244a30', '#4d7a52'],
  bark: ['#5a4432', '#6e5540', '#46352a'],
  flowers: ['#e8d45a', '#e07a5f', '#f2f0e6', '#b78fd6', '#e89ab6', '#f4a340'],

  // ground
  soil: { dry: '#8a6a48', moist: '#6e5238', wet: '#54402d', ploughed: '#5e4632', furrowDark: '#46331f', clay: '#9a7050' },
  sand: ['#d8c79a', '#cdb887', '#e4d6ad'],
  gravel: ['#a39c90', '#8f887c', '#b7b0a3', '#7a7468'],
  rock: ['#8a8680', '#9d9993', '#6f6b66', '#b3aea6'],
  water: { deep: '#2f5d74', mid: '#3f7a8c', shallow: '#6fa3a8', foam: '#dfeee9', reed: '#7d8c4a' },
  snow: ['#eef2f4', '#dfe6ea', '#f8fafb'],
  mud: '#5b4a36',

  // man-made
  asphalt: ['#4a4c50', '#55575b', '#3f4145', '#5f6165'],
  asphaltWorn: '#6a6a66',
  roadLine: '#e9e4d2',
  roadLineYellow: '#e2b93b',
  kerb: '#b8b3a8',
  concrete: ['#b5b1a8', '#a8a49b', '#c3bfb6'],
  brick: ['#a6533b', '#b4623f', '#8e4632', '#c07452'],
  whitewash: ['#ece6d8', '#e2dac8', '#f4efe3'],
  plaster: ['#e0cfa9', '#d4be94', '#c9b184'],
  timber: ['#8a6440', '#9d7650', '#6f4e32', '#b08a5c'],
  timberPainted: { red: '#9b3a2e', green: '#4d6b4a', blue: '#4a6479', cream: '#e6dcc0' },
  roof: {
    terracotta: ['#b3553a', '#c0643f', '#9a4630', '#cf7a52'],
    slate: ['#4f5864', '#5d6773', '#424a55', '#6d7784'],
    thatch: ['#b89a5a', '#c7aa68', '#a2854a'],
    metal: ['#7d8a8f', '#8e9ba0', '#6a777c'],
    moss: '#6f7a45',
  },
  glass: '#3d5563',
  windowLit: '#ffd58a',
  metal: ['#8b9196', '#a3a9ad', '#6c7277'],
  rust: '#8a4a2a',

  // vehicles (paint)
  paint: {
    tractorRed: '#b8352b', tractorGreen: '#3f7a3a', tractorBlue: '#2f5f9a', tractorYellow: '#e0b12e',
    white: '#e8e6df', silver: '#a9adb0', black: '#2b2d31', navy: '#2e3f5c', maroon: '#6e2a2e', teal: '#2f6f6e', cream: '#e3d8b8',
  },
  tyre: '#26272a',

  // characters
  skin: ['#f1d0b0', '#d9a77c', '#b27b52', '#7f5234', '#5a3a26'],
  hair: ['#2b2018', '#5a3b22', '#a0672e', '#d8b46a', '#8a8a8a', '#b44a22'],
  cloth: ['#3f5f86', '#8a3a30', '#5d6b3a', '#c49a3c', '#6b4d7a', '#e6dcc4', '#3a3a40', '#b86b3a'],

  // animals
  animal: { cowWhite: '#eeeae0', cowBlack: '#2e2a28', cowBrown: '#7a4a2e', sheep: '#e8e2d2', sheepFace: '#3a332d', hen: '#b5653a', henWhite: '#f2eee4', comb: '#c8322a', dog: '#9a6a3a' },

  // light & atmosphere
  shadow: '#1d2433',          // colour of shadows (cool, sky-lit)
  ambientNight: [38, 48, 92],
  ambientDusk: [255, 170, 120],
  lamp: [255, 196, 120],
  headlight: [255, 236, 200],

  // UI
  ui: {
    paper: '#f3ead6', paperDark: '#e4d7b8', ink: '#2e2a24', inkSoft: '#5b5246',
    accent: '#3f6b3a', accent2: '#b8652e', danger: '#a8392f', gold: '#c99a2e',
    panel: 'rgba(40, 34, 28, 0.82)', panelBorder: '#8a7654',
  },
};
