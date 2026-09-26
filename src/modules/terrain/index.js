// STUB — to be replaced by the terrain builder.
export const manifest = {
  id: 'terrain', wave: 1, deps: [], optionalDeps: [], namespaces: ['terrain'],
  api: [], emits: [], listens: [],
};
export async function init(ctx) { return { api: {} }; }
export const showcase = { deps: [], presets: { default: { camera: { x: 64, y: 64, zoom: 16 }, time: '10:00' } }, async stage(ctx) {} };
