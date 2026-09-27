// Body rig: poses a top-down person from the painted parts in sprites.js and draws it.
// Local frame: metres, origin between the feet, facing −y (rot 0 = north), drawn under the
// character's rotation. Two paths:
//   * live  — every part drawn from the 96 px/m part sprites (close zoom, actions, sleepers)
//   * cached— 8 walk frames + 1 idle frame per appearance/carry composed once at CPPM px/m
//             (far zoom / crowds: one drawImage per person + the held tool).
import { SPPM } from './sprites.js';
import { appKey } from './appearance.js';

const TAU = Math.PI * 2;
export const CPPM = 48;          // cached frame resolution
export const WALK_FRAMES = 8;
const FRAME_M = 1.0;             // cached frame size (m)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

/** long tools are carried over the shoulder; others hang in a hand */
export const LONG_TOOLS = { hoe: 1, fork: 1 };

export function createBody(art, parts) {
  const S = SPPM;

  function img(g, c, x, y, rot = 0, sx = 1, sy = 1) {
    const w = c.width / S, h = c.height / S;
    if (rot || sx !== 1 || sy !== 1) {
      g.save();
      g.translate(x, y);
      if (rot) g.rotate(rot);
      if (sx !== 1 || sy !== 1) g.scale(sx, sy);
      g.drawImage(c, -w / 2, -h / 2, w, h);
      g.restore();
    } else g.drawImage(c, x - w / 2, y - h / 2, w, h);
  }

  /** draw a tool sprite with its grip at (gx,gy), axis angle rot (0 = pointing forward), length factor k */
  function drawTool(g, kind, gx, gy, rot, k = 1, wScale = 1) {
    const c = parts.tool(kind);
    const sp = parts.TOOL_SPECS[kind];
    if (!c || !sp) return;
    g.save();
    g.translate(gx, gy);
    g.rotate(rot);
    g.scale(wScale, k);
    g.drawImage(c, -sp.w / 2, -(sp.len - sp.grip), sp.w, sp.len);
    g.restore();
  }

  // ------------------------------------------------------------------ pose
  /**
   * compute a pose from character state.
   * ch: { appearance:a, phase, walk (0..1), running, tool, action:{tool,u}, lantern, carry }
   */
  function pose(ch, time) {
    const a = ch.appearance;
    const { ha } = parts.torsoDims(a);
    const w = clamp(ch.walk || 0, 0, 1);
    const run = ch.running ? 1 : 0;
    const ph = (ch.phase || 0) * TAU;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const stride = w * (run ? 0.2 : 0.14);
    const P = {
      ha, w,
      footL: { x: -0.085, y: 0.02 + stride * sn, lift: w * Math.max(0, cs) },
      footR: { x: 0.085, y: 0.02 - stride * sn, lift: w * Math.max(0, -cs) },
      twist: w * (run ? 0.12 : 0.075) * sn,
      bob: 1 + w * (run ? 0.03 : 0.018) * Math.abs(cs),
      lean: w * (run ? 0.03 : 0.01),
      headRot: 0, headY: -0.005,
      shoulder: ha - 0.03,
      handL: null, handR: null,
      tool: null,   // { kind, gx, gy, rot, k, wScale }
      extra: [],    // additional carried items [{kind,gx,gy,rot,k}]
      skirtRot: 0,
    };
    const swing = w * (run ? 0.36 : 0.24);
    const sx = P.shoulder + 0.03;
    // default arm swing: opposite to the leg on the same side
    P.handL = { x: -sx - 0.012 * w, y: 0.03 - swing * sn * 1.0 };
    P.handR = { x: sx + 0.012 * w, y: 0.03 + swing * sn * 1.0 };
    P.skirtRot = -P.twist * 0.6;

    // idle life: slow glance around
    if (w < 0.3 && !ch.action) {
      const n = Math.sin(time * 0.37 + (a.variant || 0)) * Math.sin(time * 0.23 + (a.variant || 0) * 0.3);
      P.headRot = clamp(n * 1.4, -0.55, 0.55);
    } else P.headRot = -P.twist * 0.7;

    const tool = ch.tool && ch.tool !== 'hand' ? ch.tool : null;
    const act = ch.action;
    if (act) actionPose(P, act, sx);
    else if (tool) carryPose(P, tool, sx, sn, w);
    // secondary carried items (villagers: basket/bag/stick/bread; farmhands: lantern at night)
    const leftFree = !P.lockL;
    const carry = ch.carry;
    if (carry && carry !== 'none' && !act) {
      if (carry === 'stick') {
        P.handR = { x: sx + 0.05, y: -0.1 + swing * sn * 0.4 };
        P.extra.push({ kind: 'stick', gx: P.handR.x, gy: P.handR.y, rot: 0.08, k: 0.32 });
      } else if (carry === 'basket' && leftFree) {
        P.handL = { x: -sx + 0.02, y: -0.06 };
        P.extra.push({ kind: 'basket', gx: -sx - 0.03, gy: -0.02, rot: -0.2, k: 1 });
        P.lockL = true;
      } else if (carry === 'bag' && leftFree) {
        P.handL = { x: -sx - 0.02, y: 0.04 - swing * sn * 0.6 };
        P.extra.push({ kind: 'bag', gx: P.handL.x - 0.04, gy: P.handL.y + 0.02, rot: 0.1 - swing * sn * 0.8, k: 1 });
        P.lockL = true;
      } else if (carry === 'bread' && leftFree) {
        P.handL = { x: -sx + 0.03, y: -0.02 };
        P.extra.push({ kind: 'bread', gx: -sx + 0.01, gy: 0.02, rot: -0.35, k: 1 });
        P.lockL = true;
      }
    }
    if (ch.lantern) {
      // lantern hangs from whichever hand is free, swinging on its bail
      const useLeft = !P.lockL;
      const h = useLeft ? P.handL : P.handR;
      const s = useLeft ? -1 : 1;
      if (!act || useLeft) {
        const lx = h.x + s * 0.035, ly = h.y + 0.01;
        P.extra.push({ kind: 'lantern', gx: lx, gy: ly, rot: 0.3 * sn * w, k: 1, lantern: true });
        P.lanternAt = { x: lx, y: ly };
      }
    }
    return P;
  }

  function carryPose(P, tool, sx, sn, w) {
    if (LONG_TOOLS[tool]) {
      // shaft over the right shoulder, hand in front of the shoulder, head behind
      P.handR = { x: sx - 0.04, y: -0.12 + 0.015 * sn * w };
      P.tool = { kind: tool, gx: P.handR.x + 0.01, gy: P.handR.y + 0.02, rot: Math.PI - 0.32, k: 0.9, wScale: 1 };
      P.toolOver = true; // drawn above the torso (it lies on the shoulder)
      P.lockR = true;
    } else if (tool === 'water') {
      P.tool = { kind: 'water', gx: P.handR.x + 0.02, gy: P.handR.y + 0.02, rot: 0.06 + sn * 0.12 * w, k: 1, wScale: 1 };
      P.lockR = true;
    } else if (tool === 'seed') {
      // seed bag on a strap at the left hip
      P.handL = { x: -sx + 0.005, y: 0.02 };
      P.tool = { kind: 'seed', gx: -sx - 0.05, gy: 0.05, rot: -0.25, k: 1, wScale: 1 };
      P.lockL = true;
    }
  }

  /** tool-use animations; act = { tool, u (0..1) } */
  function actionPose(P, act, sx) {
    const u = act.u;
    const kind = act.tool;
    const twoHands = (G, rot, k, along) => {
      const dx = Math.sin(rot) * k, dy = -Math.cos(rot) * k;
      P.handR = { x: G.x, y: G.y };
      P.handL = { x: G.x + dx * along, y: G.y + dy * along };
      P.lockL = P.lockR = true;
    };
    P.headRot = 0;
    switch (kind) {
      case 'hoe':
      case 'fork': {
        let k, rot, G, lean;
        if (kind === 'hoe') {
          // raise overhead (shaft tips toward the viewer) → strike forward → drag back → recover
          const r = smooth(seg(u, 0, 0.36)), s = seg(u, 0.36, 0.5), d = smooth(seg(u, 0.5, 0.78)), b = smooth(seg(u, 0.78, 1));
          const sE = s * s; // accelerate into the strike
          k = lerp(lerp(lerp(0.5, -0.22, r), 0.78, sE), 0.62, d);
          k = lerp(k, 0.5, b);
          rot = lerp(lerp(0.12, 0.02, r), -0.04, sE);
          G = { x: lerp(lerp(0.1, 0.05, r), 0.06, sE), y: lerp(lerp(-0.16, -0.12, r), -0.27, sE) };
          G.y = lerp(G.y, -0.2, d); G.y = lerp(G.y, -0.16, b);
          lean = lerp(lerp(0, -0.02, r), 0.05, sE) * (1 - b);
          P.tool = { kind, gx: G.x, gy: G.y, rot, k, wScale: 1 + Math.max(0, -k) * 0.35 };
        } else {
          // pitchfork: thrust in → lift and toss to the right → recover
          const t = smooth(seg(u, 0, 0.35)), l = smooth(seg(u, 0.35, 0.68)), b = smooth(seg(u, 0.68, 1));
          k = lerp(lerp(lerp(0.55, 0.85, t), 0.45, l), 0.55, b);
          rot = lerp(lerp(lerp(0.05, 0.0, t), 0.75, l), 0.05, b);
          G = { x: lerp(lerp(0.1, 0.08, t), 0.14, l), y: lerp(lerp(-0.16, -0.3, t), -0.2, l) };
          G.x = lerp(G.x, 0.1, b); G.y = lerp(G.y, -0.16, b);
          lean = (0.05 * t - 0.02 * l) * (1 - b);
          P.tool = { kind, gx: G.x, gy: G.y, rot, k, wScale: 1 };
        }
        twoHands(G, rot, Math.max(0.25, Math.abs(k)), 0.34);
        P.lean = lean;
        P.twist = -0.12 * (1 - Math.abs(k - 0.5));
        P.headY = -0.005 - lean * 0.8;
        P.toolOver = true;
        break;
      }
      case 'water': {
        const e = smooth(seg(u, 0, 0.25)), b = smooth(seg(u, 0.82, 1));
        const f = e * (1 - b);
        P.handR = { x: lerp(sx + 0.02, 0.14, f), y: lerp(0.03, -0.3, f) };
        P.handL = { x: lerp(-sx - 0.02, -0.02, f), y: lerp(0.03, -0.22, f) };
        const pour = f * (0.9 + 0.1 * Math.sin(u * 40));
        P.tool = { kind: 'water', gx: P.handR.x + 0.01, gy: P.handR.y + 0.02, rot: -0.35 * pour, k: 1 + 0.12 * pour, wScale: 1 };
        P.twist = -0.08 * f;
        P.lean = 0.03 * f;
        P.lockL = P.lockR = true;
        P.spout = { x: P.tool.gx + Math.sin(P.tool.rot) * 0.32, y: P.tool.gy - Math.cos(P.tool.rot) * 0.32 * P.tool.k };
        break;
      }
      case 'seed': {
        // dip into the bag at the left hip, then broadcast in a sweeping arc to the front-right
        const d = smooth(seg(u, 0, 0.3)), s = smooth(seg(u, 0.3, 0.62)), b = smooth(seg(u, 0.62, 1));
        const bagX = -sx - 0.05;
        let hx = lerp(sx + 0.02, bagX + 0.03, d), hy = lerp(0.03, 0.02, d);
        const ang = lerp(-1.4, 0.9, s);
        if (s > 0) { hx = lerp(hx, Math.sin(ang) * 0.36, s); hy = lerp(hy, -Math.cos(ang) * 0.3, s); }
        hx = lerp(hx, sx + 0.02, b); hy = lerp(hy, 0.03, b);
        P.handR = { x: hx, y: hy };
        P.handL = { x: -sx + 0.005, y: 0.02 };
        P.tool = { kind: 'seed', gx: -sx - 0.05, gy: 0.05, rot: -0.25, k: 1, wScale: 1 };
        P.twist = lerp(0.12 * d, -0.16, s) * (1 - b);
        P.lockL = P.lockR = true;
        break;
      }
      default: {
        // bare hands: reach forward, grab, pull back
        const r = smooth(seg(u, 0, 0.4)), b = smooth(seg(u, 0.55, 1));
        const f = r * (1 - b);
        P.handR = { x: lerp(sx + 0.01, 0.09, f), y: lerp(0.03, -0.38, f) };
        P.handL = { x: lerp(-sx - 0.01, -0.09, f), y: lerp(0.03, -0.36, f) };
        P.lean = 0.05 * f;
        P.headY = -0.005 - 0.04 * f;
        P.lockL = P.lockR = true;
      }
    }
  }

  // ------------------------------------------------------------------ drawing
  function drawArm(g, a, side, P, hand) {
    const sx = side * P.shoulder, sy = 0;
    // shoulders rotate with the torso twist
    const c = Math.cos(P.twist), s = Math.sin(P.twist);
    const shx = sx * c - sy * s, shy = sx * s + sy * c;
    const dx = hand.x - shx, dy = hand.y - shy;
    const len = Math.hypot(dx, dy);
    const rot = Math.atan2(dx, -dy);
    const sl = parts.sleeve(a);
    const natural = sl.height / S;
    const L = Math.max(0.1, len + 0.07);
    img(g, sl, (shx + hand.x) / 2, (shy + hand.y) / 2, rot, 1, L / natural);
    img(g, parts.hand(a), hand.x, hand.y, rot + (side < 0 ? 0.25 : -0.25), side < 0 ? -1 : 1, 1);
  }

  function drawItem(g, it) { drawTool(g, it.kind, it.gx, it.gy, it.rot, it.k, 1); }

  /** draw a posed person in local coordinates (already translated/rotated) */
  function drawPosed(g, a, P, opts = {}) {
    const skirted = !!(a.skirt || a.coat);
    if (opts.contact !== false) img(g, parts.contact(), 0, 0.02);
    // feet
    const fl = P.footL, fr = P.footR, foot = parts.foot(a);
    img(g, foot, fl.x, fl.y, -0.06, 1 + fl.lift * 0.06, 1 + fl.lift * 0.06);
    img(g, foot, fr.x, fr.y, 0.06, -(1 + fr.lift * 0.06), 1 + fr.lift * 0.06);
    if (skirted) img(g, parts.skirt(a), 0, 0.035, P.skirtRot);
    g.save();
    g.translate(0, -P.lean);
    if (P.bob !== 1) g.scale(P.bob, P.bob);
    // items hanging low (bag, seed bag, watering can, lantern) go under the arms
    const tool = P.tool;
    if (tool && !P.toolOver && opts.tool !== false) drawTool(g, tool.kind, tool.gx, tool.gy, tool.rot, tool.k, tool.wScale);
    for (const it of P.extra) if (it.kind !== 'stick') drawItem(g, it);
    drawArm(g, a, -1, P, P.handL);
    drawArm(g, a, 1, P, P.handR);
    img(g, parts.torso(a), 0, 0, P.twist);
    img(g, parts.head(a), 0, P.headY, P.twist * -0.4 + P.headRot);
    if (tool && P.toolOver && opts.tool !== false) {
      drawTool(g, tool.kind, tool.gx, tool.gy, tool.rot, tool.k, tool.wScale);
      // the gripping hands sit on top of the shaft
      img(g, parts.hand(a), P.handR.x, P.handR.y, tool.rot, 1, 1);
      if (P.lockL && P.handL && (tool.k < 0.99 || true) && Math.hypot(P.handL.x - P.handR.x, P.handL.y - P.handR.y) > 0.06) img(g, parts.hand(a), P.handL.x, P.handL.y, tool.rot, -1, 1);
    }
    for (const it of P.extra) if (it.kind === 'stick') drawItem(g, it);
    g.restore();
  }

  // ------------------------------------------------------------------ cached frames
  const frameCache = new Map();
  /** cached body frame (no tool on top, no contact): idx -1 = idle, 0..7 = walk, 8..15 = run */
  function frame(ch, idx) {
    const a = ch.appearance;
    const carry = ch.tool && ch.tool !== 'hand' ? ch.tool : (ch.carry || 'none');
    const key = `chr:frame:${appKey(a)}|${carry}|${ch.lantern ? 1 : 0}|${idx}`;
    let c = frameCache.get(key);
    if (c) return c;
    const px = Math.round(FRAME_M * CPPM);
    c = art.canvas(px, px);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.setTransform(CPPM, 0, 0, CPPM, px / 2, px / 2);
    const run = idx >= WALK_FRAMES;
    const fake = {
      appearance: a, tool: ch.tool, carry: ch.carry, lantern: ch.lantern,
      walk: idx < 0 ? 0 : 1, running: run, phase: idx < 0 ? 0 : (idx % WALK_FRAMES) / WALK_FRAMES,
    };
    const P = pose(fake, 0);
    P.headRot = idx < 0 ? 0 : P.headRot;
    drawPosed(g, a, P, { contact: false, tool: !P.toolOver });
    frameCache.set(key, c);
    if (frameCache.size > 1400) { const k0 = frameCache.keys().next().value; frameCache.delete(k0); }
    return c;
  }

  /**
   * draw character ch at its world position. live = full rig; otherwise cached frame.
   * returns world position of the lantern (or null) for the light pass.
   */
  function draw(g, ch, time, live) {
    const a = ch.appearance;
    g.save();
    g.translate(ch.x, ch.y);
    g.rotate(ch.rot || 0);
    let P;
    if (live || ch.action) {
      P = pose(ch, time);
      drawPosed(g, a, P);
    } else {
      const moving = (ch.walk || 0) > 0.35;
      const idx = moving ? Math.floor(((ch.phase || 0) % 1 + 1) % 1 * WALK_FRAMES) + (ch.running ? WALK_FRAMES : 0) : -1;
      img(g, parts.contact(), 0, 0.02);
      const fr = frame(ch, idx);
      g.drawImage(fr, -FRAME_M / 2, -FRAME_M / 2, FRAME_M, FRAME_M);
      P = null;
      // long tools on the shoulder are drawn on top of the cached body
      if (ch.tool && LONG_TOOLS[ch.tool]) {
        const fake = { appearance: a, tool: ch.tool, walk: moving ? 1 : 0, running: ch.running, phase: idx < 0 ? 0 : (idx % WALK_FRAMES) / WALK_FRAMES };
        const Q = pose(fake, 0);
        g.save(); g.translate(0, -Q.lean); if (Q.bob !== 1) g.scale(Q.bob, Q.bob);
        drawTool(g, Q.tool.kind, Q.tool.gx, Q.tool.gy, Q.tool.rot, Q.tool.k, 1);
        img(g, parts.hand(a), Q.handR.x, Q.handR.y, Q.tool.rot);
        g.restore();
      }
    }
    g.restore();
    return P;
  }

  /** lantern world position for a character (cheap approximation, no full pose) */
  function lanternWorld(ch) {
    const side = ch.tool === 'seed' || (ch.carry && ch.carry !== 'none' && ch.carry !== 'stick') ? 1 : -1;
    const lx = side * 0.28, ly = 0.04;
    const c = Math.cos(ch.rot || 0), s = Math.sin(ch.rot || 0);
    return { x: ch.x + lx * c - ly * s, y: ch.y + lx * s + ly * c };
  }

  /** a sleeping figure on a bedroll (head from the rig, blanket painted in extras) */
  function drawSleeper(g, ch, extras, time) {
    const a = ch.appearance;
    g.save();
    g.translate(ch.x, ch.y);
    g.rotate(ch.rot || 0);
    img(g, extras.bedroll(a), 0, 0);
    // head on the pillow, turned to one side; blanket rises and falls with breathing
    const br = 1 + 0.02 * Math.sin(time * 1.6 + (a.variant || 0));
    img(g, parts.head(a), 0, -0.68, 0.5, 0.95, 0.95);
    img(g, extras.blanket(a), 0, 0.12, 0, br, 1);
    g.restore();
  }

  return { pose, draw, drawPosed, drawTool, drawSleeper, lanternWorld, frame, img };
}
