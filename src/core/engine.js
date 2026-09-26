// Main loop: fixed 60 Hz simulation steps + one render per animation frame.

export const STEP = 1 / 60;
const MAX_STEPS = 4;

export class Engine {
  constructor({ clock, camera, input, renderer, health, instances }) {
    this.clock = clock;
    this.camera = camera;
    this.input = input;
    this.renderer = renderer;
    this.health = health;
    this.instances = instances; // ordered [{id, inst}]
    this.acc = 0;
    this.last = 0;
    this.frameCount = 0;
    this.running = false;
    this.frameIntervals = [];
    this.cpuTimes = [];
    this.waiters = [];
    this.realTime = 0;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (ts) => {
      if (!this.running) return;
      this._tick(ts);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  _panCamera(dt) {
    if (this.camera.following) return;
    const i = this.input;
    const sp = (i.down('run') ? 900 : 420) / this.camera.zoom;
    let mx = 0, my = 0;
    if (i.down('left')) mx -= 1;
    if (i.down('right')) mx += 1;
    if (i.down('up')) my -= 1;
    if (i.down('down')) my += 1;
    this.camera.x += mx * sp * dt;
    this.camera.y += my * sp * dt;
  }
  step(dt) {
    this.clock.advance(dt);
    for (const { id, inst } of this.instances) {
      if (inst.update) this.health.guard(id, 'update', inst.update, inst, [dt]);
    }
    this.input.endStep();
  }
  _tick(ts) {
    const t0 = performance.now();
    let dt = (ts - this.last) / 1000;
    this.last = ts;
    if (!(dt > 0)) dt = STEP;
    this.frameIntervals.push(dt);
    if (this.frameIntervals.length > 120) this.frameIntervals.shift();
    dt = Math.min(dt, 0.1);
    this.realTime += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this._panCamera(dt);
    for (const { id, inst } of this.instances) {
      if (inst.frame) this.health.guard(id, 'frame', inst.frame, inst, [dt]);
    }
    this.camera.update(dt, this.health);
    this.input.refresh();
    this.renderer.render(dt, this.realTime);
    this.health.endFrame();
    this.cpuTimes.push(performance.now() - t0);
    if (this.cpuTimes.length > 240) this.cpuTimes.shift();
    this.frameCount++;
    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.frame <= this.frameCount);
      this.waiters = this.waiters.filter((w) => w.frame > this.frameCount);
      for (const w of due) w.resolve(this.frameCount);
    }
  }
  waitFrames(n) {
    return new Promise((resolve) => this.waiters.push({ frame: this.frameCount + n, resolve }));
  }
  stats() {
    const iv = this.frameIntervals;
    const avgIv = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
    const cpu = this.cpuTimes.slice().sort((a, b) => a - b);
    const avg = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0;
    const p95 = cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))] : 0;
    return {
      frames: this.frameCount,
      fps: avgIv ? +(1 / avgIv).toFixed(1) : 0,
      frameMsAvg: +avg.toFixed(2),
      frameMsP95: +p95.toFixed(2),
      ...this.renderer.stats,
    };
  }
}
