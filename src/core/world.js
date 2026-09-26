// Shared world data model. Core creates the root and empty namespaces;
// each module fills (and is the only writer of) its own namespaces.

export const WORLD_VERSION = 1;

export const NAMESPACES = [
  'terrain', 'environment', 'roads', 'economy', 'land', 'jobs', 'ui', 'audio', 'effects',
  'crops', 'buildings', 'props', 'vehicles', 'characters', 'player', 'animals', 'traffic',
  'buildtools', 'demo',
];

export const DAY_SECONDS = 86400;
export const MONTH_DAYS = 3;
export const YEAR_DAYS = 36;
export const START_DAY_OF_YEAR = 6; // 1 March
export const LATITUDE_DEG = 51;

export function createWorld({ seed = 'harvest-1', w = 1024, h = 1024 } = {}) {
  const world = {
    version: WORLD_VERSION,
    seed: String(seed),
    bounds: { w, h },
    time: { t: START_DAY_OF_YEAR * DAY_SECONDS + 7 * 3600, scale: 60, paused: false, frozen: false },
  };
  for (const ns of NAMESPACES) world[ns] = {};
  return world;
}
