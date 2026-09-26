// ?showcase=core — exercises the renderer pipeline without any module:
// cached painted ground, boxes/trees/poles casting sun shadows, lights at night.
import { DAY_SECONDS } from './world.js';

export function stageCoreSelftest({ world, renderer, camera, clock, art, palette }) {
  camera.set(40, 40, 18);
  const ground = art.sprite('selftest:ground', 80 * 8, 80 * 8, (g, w, h) => {
    art.noiseFill(g, 0, 0, w, h, palette.grass.summer, { scale: 0.02, seed: 'selftest', px: 2 });
  });
  renderer.addLayer('ground', (g) => g.drawImage(ground, 0, 0, 80, 80), 'core');

  // simple sun model (the environment module replaces this in real scenes)
  const sunFor = () => {
    const tod = clock.timeOfDay;
    const elev = Math.max(-0.2, Math.sin(((tod - 6) / 12) * Math.PI) * 0.95);
    const az = Math.PI * (0.5 + (tod - 6) / 12);
    const L = elev > 0.02 ? Math.min(8, 1 / Math.tan(elev)) : 8;
    const daylight = Math.max(0, Math.min(1, elev * 4 + 0.2));
    world.environment.sun = { azimuth: az, elevation: elev, dirX: -Math.sin(az), dirY: Math.cos(az), shadowLen: L, shadowStrength: 0.45 * Math.min(1, Math.max(0, elev * 5)) };
    world.environment.daylight = daylight;
    const n = palette.ambientNight;
    world.environment.ambient = [n[0] + (255 - n[0]) * daylight, n[1] + (255 - n[1]) * daylight, n[2] + (255 - n[2]) * daylight];
  };

  const boxes = [[20, 20, 8, 6, 0.2, 5], [50, 30, 10, 10, 0, 9], [30, 55, 5, 12, -0.4, 3]];
  const trees = [[62, 58, 3], [15, 45, 2.4], [68, 18, 2.8]];
  renderer.addCollector((view, F) => {
    sunFor();
    for (const [x, y, w, h, rot, ht] of boxes) {
      F.shadow.box(x, y, w, h, rot, ht);
      F.object({ y: y + h / 2, draw(g) { g.translate(x, y); g.rotate(rot); g.fillStyle = palette.roof.terracotta[0]; g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = art.outline(palette.roof.terracotta[0]); g.lineWidth = 0.15; g.strokeRect(-w / 2, -h / 2, w, h); } });
      F.light({ x: x, y: y + h / 2 + 1, radius: 7, color: palette.lamp, intensity: 0.9, glow: 0.6 });
    }
    for (const [x, y, r] of trees) {
      F.shadow.circle(x, y, r, 2, 2 + r * 2, 0.4);
      F.object({ y, draw(g) { g.fillStyle = palette.foliage.summer[0]; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); } });
    }
    F.shadow.pole(40, 70, 6, 0.2);
  }, 'core');
  world.time.t = Math.floor(world.time.t / DAY_SECONDS) * DAY_SECONDS + 12 * 3600;
}
