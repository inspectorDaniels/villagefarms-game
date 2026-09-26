// Little ink-and-wash vignettes for job cards and map symbols. Drawn in a s×s box at (x,y).
import { INK } from './paint.js';

export function drawIcon(P, g, art, type, x, y, s, rng) {
  g.save();
  g.translate(x, y);
  g.scale(s / 64, s / 64);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const wash = (fn, col, a = 0.45) => { g.save(); fn(); g.fillStyle = art.rgba(col, a); g.fill(); g.restore(); };
  const stroke = (fn, w = 2.2, col = INK, a = 0.85) => { g.save(); fn(); g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = w; g.stroke(); g.restore(); };
  switch (type) {
    case 'plough': {
      // furrowed field + mouldboard blades
      wash(() => { g.beginPath(); g.ellipse(32, 44, 28, 14, 0, 0, 7); }, '#6e5238', 0.55);
      for (let i = 0; i < 4; i++) stroke(() => { g.beginPath(); g.moveTo(8 + i * 4, 38 + i * 4); g.quadraticCurveTo(32, 32 + i * 4, 58 - i * 3, 40 + i * 4); }, 1.4, '#46331f', 0.7);
      for (let i = 0; i < 3; i++) {
        wash(() => { g.beginPath(); g.moveTo(14 + i * 14, 12); g.quadraticCurveTo(26 + i * 14, 16, 24 + i * 14, 30); g.lineTo(16 + i * 14, 26); g.closePath(); }, '#b8352b', 0.7);
        stroke(() => { g.beginPath(); g.moveTo(14 + i * 14, 12); g.quadraticCurveTo(26 + i * 14, 16, 24 + i * 14, 30); g.lineTo(16 + i * 14, 26); g.closePath(); }, 1.6);
      }
      stroke(() => { g.beginPath(); g.moveTo(6, 10); g.lineTo(52, 10); }, 2.6);
      break;
    }
    case 'sow': {
      wash(() => { g.beginPath(); g.ellipse(32, 36, 28, 22, 0, 0, 7); }, '#6e5238', 0.45);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        wash(() => { g.beginPath(); g.ellipse(12 + c * 8 + (r % 2) * 3, 22 + r * 9, 2.2, 1.6, 0.4, 0, 7); }, '#d8b46a', 0.95);
      }
      for (let r = 0; r < 4; r++) stroke(() => { g.beginPath(); g.moveTo(8, 25 + r * 9); g.lineTo(58, 25 + r * 9); }, 0.9, '#46331f', 0.5);
      stroke(() => { g.beginPath(); g.moveTo(40, 8); g.quadraticCurveTo(44, 16, 38, 20); }, 1.8, '#3f6b3a');
      wash(() => { g.beginPath(); g.ellipse(45, 12, 6, 3, -0.6, 0, 7); }, '#6f9e3e', 0.8);
      break;
    }
    case 'harvest': {
      for (let k = -1; k <= 1; k++) {
        g.save(); g.translate(32 + k * 12, 58); g.rotate(k * 0.25);
        stroke(() => { g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -46); }, 1.8, '#8a6a2a');
        for (let i = 0; i < 6; i++) for (const side of [-1, 1]) {
          wash(() => { g.beginPath(); g.ellipse(side * 3.4, -44 + i * 5, 3.2, 5.2, side * 0.5, 0, 7); }, '#d4a73c', 0.9);
          stroke(() => { g.beginPath(); g.ellipse(side * 3.4, -44 + i * 5, 3.2, 5.2, side * 0.5, 0, 7); }, 0.8, '#7a5520', 0.6);
        }
        stroke(() => { g.beginPath(); g.moveTo(0, -48); g.lineTo(0, -58); }, 0.7, '#7a5520', 0.6);
        g.restore();
      }
      break;
    }
    case 'lift': { // root crop: beet / potatoes with leaves, soil clods
      wash(() => { g.beginPath(); g.ellipse(32, 54, 26, 7, 0, 0, 7); }, '#6e5238', 0.55);
      for (const [bx, by, r] of [[22, 38, 10], [42, 42, 8]]) {
        for (let k = -1; k <= 1; k++) {
          wash(() => { g.beginPath(); g.ellipse(bx + k * 5, by - r - 9, 4, 9, k * 0.5, 0, 7); }, '#5f8f38', 0.85);
          stroke(() => { g.beginPath(); g.moveTo(bx, by - r + 2); g.lineTo(bx + k * 7, by - r - 15); }, 1, '#3f6b27', 0.8);
        }
        wash(() => { g.beginPath(); g.moveTo(bx - r, by - r * 0.4); g.quadraticCurveTo(bx, by - r * 1.3, bx + r, by - r * 0.4); g.quadraticCurveTo(bx + r * 0.6, by + r * 0.9, bx, by + r * 1.5); g.quadraticCurveTo(bx - r * 0.6, by + r * 0.9, bx - r, by - r * 0.4); }, '#efe3cf', 0.95);
        stroke(() => { g.beginPath(); g.moveTo(bx - r, by - r * 0.4); g.quadraticCurveTo(bx, by - r * 1.3, bx + r, by - r * 0.4); g.quadraticCurveTo(bx + r * 0.6, by + r * 0.9, bx, by + r * 1.5); g.quadraticCurveTo(bx - r * 0.6, by + r * 0.9, bx - r, by - r * 0.4); }, 1.5);
        stroke(() => { g.beginPath(); g.moveTo(bx - r * 0.4, by); g.lineTo(bx - r * 0.1, by + 1); g.moveTo(bx + r * 0.2, by + r * 0.5); g.lineTo(bx + r * 0.45, by + r * 0.45); }, 0.9, '#8a6440', 0.6);
      }
      break;
    }
    case 'mow': {
      for (let i = 0; i < 9; i++) stroke(() => { g.beginPath(); g.moveTo(6 + i * 6, 58); g.quadraticCurveTo(4 + i * 6 + (i % 2 ? 4 : -3), 46, 7 + i * 6, 34 + (i % 3) * 4); }, 1.8, '#5f8f38', 0.9);
      stroke(() => { g.beginPath(); g.moveTo(14, 6); g.lineTo(34, 50); }, 2.6, '#8a6440');
      wash(() => { g.beginPath(); g.moveTo(34, 50); g.quadraticCurveTo(50, 44, 62, 30); g.quadraticCurveTo(52, 48, 34, 54); g.closePath(); }, '#a3a9ad', 0.95);
      stroke(() => { g.beginPath(); g.moveTo(34, 50); g.quadraticCurveTo(50, 44, 62, 30); g.quadraticCurveTo(52, 48, 34, 54); g.closePath(); }, 1.3);
      break;
    }
    case 'transport': {
      wash(() => { g.beginPath(); g.moveTo(8, 18); g.lineTo(52, 18); g.lineTo(48, 40); g.lineTo(12, 40); g.closePath(); }, '#9b3a2e', 0.75);
      wash(() => { g.beginPath(); g.moveTo(10, 18); g.quadraticCurveTo(30, 4, 50, 18); g.closePath(); }, '#d4a73c', 0.9);
      stroke(() => { g.beginPath(); g.moveTo(8, 18); g.lineTo(52, 18); g.lineTo(48, 40); g.lineTo(12, 40); g.closePath(); }, 1.8);
      stroke(() => { g.beginPath(); g.moveTo(48, 36); g.lineTo(62, 36); }, 2.2);
      for (const cx of [20, 38]) { wash(() => { g.beginPath(); g.arc(cx, 46, 7, 0, 7); }, '#26272a', 0.9); stroke(() => { g.beginPath(); g.arc(cx, 46, 2.5, 0, 7); }, 1.2, '#a3a9ad'); }
      break;
    }
    case 'deliver': {
      wash(() => { g.beginPath(); g.moveTo(10, 24); g.lineTo(34, 14); g.lineTo(56, 22); g.lineTo(56, 48); g.lineTo(32, 58); g.lineTo(10, 48); g.closePath(); }, '#c9a878', 0.9);
      stroke(() => { g.beginPath(); g.moveTo(10, 24); g.lineTo(34, 14); g.lineTo(56, 22); g.lineTo(56, 48); g.lineTo(32, 58); g.lineTo(10, 48); g.closePath(); g.moveTo(10, 24); g.lineTo(32, 32); g.lineTo(56, 22); g.moveTo(32, 32); g.lineTo(32, 58); }, 1.7);
      stroke(() => { g.beginPath(); g.moveTo(21, 19); g.lineTo(44, 27); g.lineTo(44, 36); }, 3, '#e6dcc0', 0.9);
      break;
    }
    case 'animalCare': {
      // cow's head, front view
      wash(() => { g.beginPath(); g.ellipse(32, 30, 15, 18, 0, 0, 7); }, '#eeeae0', 0.95);
      wash(() => { g.beginPath(); g.ellipse(26, 22, 7, 8, 0.3, 0, 7); }, '#2e2a28', 0.8);
      wash(() => { g.beginPath(); g.ellipse(32, 44, 12, 8, 0, 0, 7); }, '#e89ab6', 0.8);
      stroke(() => { g.beginPath(); g.ellipse(32, 30, 15, 18, 0, 0, 7); }, 1.7);
      stroke(() => { g.beginPath(); g.ellipse(32, 44, 12, 8, 0, 0, 7); }, 1.3);
      for (const sx of [-1, 1]) {
        wash(() => { g.beginPath(); g.ellipse(32 + sx * 20, 22, 7, 3.5, sx * 0.4, 0, 7); }, '#eeeae0', 0.95);
        stroke(() => { g.beginPath(); g.ellipse(32 + sx * 20, 22, 7, 3.5, sx * 0.4, 0, 7); }, 1.2);
        stroke(() => { g.beginPath(); g.moveTo(32 + sx * 9, 13); g.quadraticCurveTo(32 + sx * 14, 6, 32 + sx * 12, 3); }, 2.2, '#a39c90');
        wash(() => { g.beginPath(); g.arc(32 + sx * 6, 30, 1.8, 0, 7); }, INK, 0.9);
        wash(() => { g.beginPath(); g.arc(32 + sx * 5, 45, 1.8, 0, 7); }, '#6e2a2e', 0.8);
      }
      break;
    }
    case 'shopHelp': {
      wash(() => { g.beginPath(); g.rect(10, 26, 44, 32); }, '#e0cfa9', 0.95);
      stroke(() => { g.beginPath(); g.rect(10, 26, 44, 32); }, 1.6);
      for (let i = 0; i < 5; i++) {
        wash(() => { g.beginPath(); g.moveTo(8 + i * 10, 16); g.lineTo(18 + i * 10, 16); g.lineTo(18 + i * 10, 26); g.quadraticCurveTo(13 + i * 10, 31, 8 + i * 10, 26); g.closePath(); }, i % 2 ? '#e6dcc0' : '#4d6b4a', 0.95);
      }
      stroke(() => { g.beginPath(); g.moveTo(8, 16); g.lineTo(58, 16); }, 1.6);
      wash(() => { g.beginPath(); g.rect(16, 36, 12, 22); }, '#8a6440', 0.9);
      wash(() => { g.beginPath(); g.rect(34, 36, 14, 10); }, '#3d5563', 0.8);
      stroke(() => { g.beginPath(); g.rect(16, 36, 12, 22); g.rect(34, 36, 14, 10); }, 1.2);
      break;
    }
    case 'villageWork': {
      g.save(); g.translate(32, 32); g.rotate(-0.7);
      wash(() => { g.beginPath(); g.rect(-3, -6, 6, 34); }, '#9d7650', 0.95);
      stroke(() => { g.beginPath(); g.rect(-3, -6, 6, 34); }, 1.3);
      wash(() => { g.beginPath(); g.rect(-14, -16, 28, 10); }, '#6c7277', 0.95);
      stroke(() => { g.beginPath(); g.rect(-14, -16, 28, 10); }, 1.5);
      g.restore();
      for (let i = 0; i < 3; i++) stroke(() => { g.beginPath(); g.moveTo(44 + i * 5, 50); g.lineTo(46 + i * 5, 58); }, 2, '#8b9196');
      break;
    }
    case 'snowClear': {
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        stroke(() => { g.beginPath(); g.moveTo(32 - Math.cos(a) * 24, 32 - Math.sin(a) * 24); g.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); }, 2.2, INK_BLUE_ICON);
      }
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const bx = 32 + Math.cos(a) * 15, by = 32 + Math.sin(a) * 15;
        stroke(() => { g.beginPath(); g.moveTo(bx + Math.cos(a + 0.9) * 6, by + Math.sin(a + 0.9) * 6); g.lineTo(bx, by); g.lineTo(bx + Math.cos(a - 0.9) * 6, by + Math.sin(a - 0.9) * 6); }, 1.6, INK_BLUE_ICON);
      }
      wash(() => { g.beginPath(); g.arc(32, 32, 26, 0, 7); }, '#b9cfe0', 0.35);
      break;
    }
    case 'silo': { // sell-point symbol
      wash(() => { g.beginPath(); g.rect(14, 18, 16, 38); g.rect(34, 30, 18, 26); }, '#a3a9ad', 0.85);
      wash(() => { g.beginPath(); g.ellipse(22, 18, 8, 5, 0, Math.PI, 0); }, '#7d8a8f', 0.9);
      stroke(() => { g.beginPath(); g.rect(14, 18, 16, 38); g.moveTo(14, 18); g.ellipse(22, 18, 8, 5, 0, Math.PI, 0); g.moveTo(34, 30); g.lineTo(43, 22); g.lineTo(52, 30); g.lineTo(52, 56); g.lineTo(34, 56); g.closePath(); }, 1.6);
      break;
    }
    case 'house': {
      wash(() => { g.beginPath(); g.rect(14, 30, 36, 26); }, '#ece6d8', 0.95);
      wash(() => { g.beginPath(); g.moveTo(10, 32); g.lineTo(32, 12); g.lineTo(54, 32); g.closePath(); }, '#b3553a', 0.85);
      stroke(() => { g.beginPath(); g.rect(14, 30, 36, 26); g.moveTo(10, 32); g.lineTo(32, 12); g.lineTo(54, 32); }, 1.6);
      wash(() => { g.beginPath(); g.rect(28, 42, 8, 14); }, '#4d6b4a', 0.9);
      break;
    }
    default: {
      stroke(() => { g.beginPath(); g.arc(32, 32, 20, 0, 7); }, 2);
    }
  }
  g.restore();
}
const INK_BLUE_ICON = '#34506e';
