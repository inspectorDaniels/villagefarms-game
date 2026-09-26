// STUB — to be replaced by the ui builder.
export const manifest = {
  id: 'ui', wave: 1, deps: [], optionalDeps: [], namespaces: ['ui'],
  api: [], emits: [], listens: [],
};
export async function init(ctx) { return { api: {} }; }
export const showcase = { deps: [], presets: { default: { camera: { x: 64, y: 64, zoom: 16 }, time: '10:00' } }, async stage(ctx) {} };
