// The farm office board: ledger book, price charts, job cards, land map and summary cards,
// painted as paper/ink/watercolour pieces on a cork board. Pure drawing from a data snapshot.
import { ITEMS, JOB_TYPES, MONTHS, YEAR_DAYS } from './data.js';
import { seasonal } from './market.js';
import { INK, INK_SOFT, INK_GREEN, INK_RED, INK_BLUE, PENCIL, SERIF, HAND } from './paint.js';
import { drawIcon } from './icons.js';

const mod = (a, n) => ((a % n) + n) % n;

// ---------- formatting (Belgian style: 12.345,60) ----------
export function euro(x, dec = 0) {
  const neg = x < 0; x = Math.abs(x);
  const [i, f] = x.toFixed(dec).split('.');
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '− ' : '') + '€ ' + s + (f ? ',' + f : '');
}
export function priceStr(item, p) {
  const it = ITEMS[item];
  const dec = p < 1 ? 3 : p < 10 ? 2 : 0;
  return euro(p, dec) + '/' + it.unit;
}
export function dayLabel(d, withYear) {
  const doy = mod(d, YEAR_DAYS);
  const s = ['early', 'mid', 'late'][doy % 3] + ' ' + MONTHS[Math.floor(doy / 3)];
  return withYear ? s + ', year ' + (Math.floor(d / YEAR_DAYS) + 1) : s;
}
const CAT_LABEL = {
  sales: 'Crop sales', jobs: 'Contract work', subsidy: 'CAP payment', rent: 'Land rent', wages: 'Wages',
  interest: 'Interest', upkeep: 'Machine upkeep', lease: 'Leases', insurance: 'Insurance & fixed', fuel: 'Diesel',
  seed: 'Seed', fertiliser: 'Fertiliser', spray: 'Crop protection', contractor: 'Contractors', penalty: 'Penalties',
  purchase: 'Purchases', land: 'Land purchase', machinery: 'Machinery', loan: 'Loan drawn', loanRepay: 'Loan repaid',
  landSale: 'Land sold', assetSale: 'Machine sold', misc: 'Sundries',
};
const catLabel = (c) => CAT_LABEL[c] || c;

/** merge same-day same-category ledger lines so the book reads like a human kept it */
function bookLines(ledger, n) {
  const out = [];
  for (const e of ledger) {
    const last = out[out.length - 1];
    if (last && last.day === e.day && last.category === e.category && Math.sign(last.amount) === Math.sign(e.amount) && e.category !== 'sales' && e.category !== 'jobs') {
      last.amount += e.amount; last.n++;
      last.memo = catLabel(e.category) + ` (${last.n} items)`;
    } else out.push({ ...e, n: 1 });
    if (out.length > n) break;
  }
  return out.slice(0, n);
}

export function createBoard(P, art) {
  // ======================= LEDGER =======================
  function ledger(g, cx, cy, rot, w, h, D, rng, rows = 17) {
    const img = P.paper(w, h, { tone: 'cream', ruled: 27, ruledTop: 124, margin: [78, w - 118], deckle: 0.7 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, 'Kasboek', 26, 54, { size: 36, italic: true });
      P.text(g, 'Ledger · Hoeve Ter Linde', 28, 78, { size: 14, italic: true, color: INK_SOFT });
      P.text(g, 'balance', w - 24, 40, { size: 12, italic: true, align: 'right', color: PENCIL });
      P.text(g, euro(D.money), w - 24, 70, { size: 26, bold: true, align: 'right', color: D.money >= 0 ? INK_GREEN : INK_RED });
      P.text(g, 'Date', 14, 114, { size: 12, italic: true, color: PENCIL });
      P.text(g, 'Entry', 90, 114, { size: 12, italic: true, color: PENCIL });
      P.text(g, 'Amount', w - 24, 114, { size: 12, italic: true, align: 'right', color: PENCIL });
      P.line(g, 10, 119, w - 10, 119, rng, { w: 1, color: INK, alpha: 0.6 });
      const lines = bookLines(D.ledger, rows);
      let y = 144;
      let lastDay = null;
      for (const e of lines) {
        if (y > h - 70) break;
        if (e.day !== lastDay) P.text(g, dayLabel(e.day), 12, y, { size: 11.5, italic: true, color: INK_SOFT, maxW: 62 });
        lastDay = e.day;
        P.text(g, e.memo, 88, y, { size: 13.5, italic: true, maxW: w - 88 - 128, shrink: 0.76 });
        P.text(g, (e.amount >= 0 ? '+ ' : '') + euro(e.amount, 2), w - 20, y, { size: 13.5, align: 'right', color: e.amount >= 0 ? INK_GREEN : INK_RED });
        y += 27;
      }
      const by = h - 44;
      P.line(g, w - 150, by - 18, w - 16, by - 18, rng, { w: 1, alpha: 0.7 });
      P.line(g, w - 150, by - 14, w - 16, by - 14, rng, { w: 1, alpha: 0.7 });
      P.text(g, 'carried forward', 88, by + 4, { size: 13, italic: true, color: INK_SOFT });
      P.text(g, euro(D.money, 2), w - 20, by + 4, { size: 15, bold: true, align: 'right', color: D.money >= 0 ? INK_GREEN : INK_RED });
      if (D.loans.length) {
        const bal = D.loans.reduce((a, l) => a + l.balance, 0);
        P.text(g, `farm loan: ${euro(bal)} left at ${(D.loans[0].rate * 100).toFixed(1).replace('.', ',')} %`, 88, by + 26, { size: 12, italic: true, color: PENCIL, font: SERIF });
      }
    });
  }

  // ======================= CHART =======================
  function chart(g, x, y, w, h, id, hist, rng, o = {}) {
    if (!hist || hist.length < 2) return;
    const it = ITEMS[id];
    const d0 = hist[0][0], d1 = hist[hist.length - 1][0];
    const norm = (d) => it.base * seasonal(id, mod(d, YEAR_DAYS));
    let lo = Infinity, hi = -Infinity;
    for (const [d, p] of hist) { lo = Math.min(lo, p, norm(d) * 0.97); hi = Math.max(hi, p, norm(d) * 1.03); }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const X = (d) => x + ((d - d0) / (d1 - d0)) * w;
    const Y = (p) => y + h - ((p - lo) / (hi - lo)) * h;
    g.save();
    // year separators and month ticks
    for (let d = Math.ceil(d0); d <= d1; d++) {
      const doy = mod(d, YEAR_DAYS);
      if (doy === 0) {
        P.line(g, X(d), y - 4, X(d), y + h, rng, { w: 0.9, color: PENCIL, alpha: 0.55, passes: 1 });
        if (o.axes) P.text(g, 'year ' + (Math.floor(d / YEAR_DAYS) + 1) + ' →', X(d) + 3, y + h + 30, { size: 11, italic: true, bold: true, color: INK_SOFT });
      }
      if (doy % 3 === 0 && o.axes) {
        g.strokeStyle = art.rgba(PENCIL, 0.6); g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(d), y + h); g.lineTo(X(d), y + h + 4); g.stroke();
        const m = doy / 3;
        if (m % 3 === 0) P.text(g, MONTHS[m], X(d), y + h + 16, { size: 10.5, align: 'center', color: PENCIL, italic: true });
      }
    }
    // price axis
    if (o.axes) {
      const step = niceStep((hi - lo) / 4);
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        g.strokeStyle = art.rgba(PENCIL, 0.25); g.setLineDash([3, 4]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, Y(v)); g.lineTo(x + w, Y(v)); g.stroke(); g.setLineDash([]);
        P.text(g, fmtAxis(v), x - 6, Y(v) + 4, { size: 10.5, align: 'right', color: PENCIL });
      }
      P.line(g, x, y + h, x + w, y + h, rng, { w: 1, color: INK_SOFT, alpha: 0.7, passes: 1 });
      P.line(g, x, y - 2, x, y + h, rng, { w: 1, color: INK_SOFT, alpha: 0.7, passes: 1 });
    }
    // seasonal norm: pencil dashes
    if (o.norm !== false && it.amp) {
      g.save(); g.setLineDash([2, 5]); g.strokeStyle = art.rgba(INK_BLUE, 0.55); g.lineWidth = 1.2;
      g.beginPath();
      for (let d = d0; d <= d1; d += 0.5) { const px = X(d), py = Y(norm(d)); if (d === d0) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke(); g.restore();
    }
    // wash under the curve
    const path = (gg) => {
      gg.beginPath(); gg.moveTo(X(hist[0][0]), y + h);
      for (const [d, p] of hist) gg.lineTo(X(d), Y(p));
      gg.lineTo(X(d1), y + h); gg.closePath();
    };
    P.wash(g, path, it.color === '#e6e0cf' ? '#9fb3bf' : it.color, rng, { alpha: 0.26, edge: 0.01, bounds: [x, y, w, h] });
    // ink line
    P.ink(g, hist.map(([d, p]) => [X(d), Y(p)]), rng, { w: o.lineW || 1.8, jitter: 0.25, color: INK });
    // harvest ears
    if (it.kind === 'carry' && o.marks !== false) {
      for (let d = Math.ceil(d0); d <= d1; d++) if (mod(d, YEAR_DAYS) === it.harvestDoy) {
        const hx = X(d), lowP = hist.find((q) => q[0] === d);
        const hy = lowP ? Y(lowP[1]) + 14 : y + h - 10;
        drawIcon(P, g, art, 'harvest', hx - 7, Math.min(y + h - 16, hy), 14, rng);
      }
    }
    // hi / lo notes
    if (o.notes) {
      let hiP = hist[0], loP = hist[0];
      for (const q of hist) { if (q[1] > hiP[1]) hiP = q; if (q[1] < loP[1]) loP = q; }
      for (const [q, lbl, dy] of [[hiP, 'high', -9], [loP, 'low', 18]]) {
        g.strokeStyle = art.rgba(INK_RED, 0.8); g.lineWidth = 1.2;
        g.beginPath(); g.arc(X(q[0]), Y(q[1]), 5, 0, 7); g.stroke();
        const ax = Math.min(x + w - 60, Math.max(x + 30, X(q[0])));
        P.text(g, `${lbl} ${fmtAxis(q[1])}`, ax, Y(q[1]) + dy, { size: 11, italic: true, color: INK_RED, align: 'center', font: HAND });
      }
    }
    // today dot
    const last = hist[hist.length - 1];
    g.fillStyle = art.rgba(INK_RED, 0.9);
    g.beginPath(); g.arc(X(last[0]), Y(last[1]), 3.4, 0, 7); g.fill();
    g.restore();
  }
  function niceStep(s) {
    const p = Math.pow(10, Math.floor(Math.log10(s)));
    const m = s / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  function fmtAxis(v) { return v < 1 ? '€' + v.toFixed(2).replace('.', ',') : v < 10 ? '€' + v.toFixed(1).replace('.', ',') : '€' + Math.round(v); }
  function change(hist, back) {
    const n = hist.length; if (n < 2) return 0;
    const a = hist[Math.max(0, n - 1 - back)][1], b = hist[n - 1][1];
    return (b - a) / a;
  }
  function trendText(ch) {
    const pct = (ch * 100).toFixed(1).replace('.', ',');
    return (ch >= 0 ? '▲ +' : '▼ ') + pct + ' %';
  }

  // price sheet: grid of charts
  function priceSheet(g, cx, cy, rot, w, h, D, rng, big) {
    const img = P.paper(w, h, { tone: 'white', grid: big ? 18 : 14, deckle: 0.5 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      if (big) {
        P.text(g, 'Market prices', 36, 58, { size: 34, italic: true });
        P.text(g, `three seasons of quotes to ${dayLabel(D.today, true)} — dashed blue: the usual seasonal level`, 38, 84, { size: 14, italic: true, color: INK_SOFT });
      } else {
        P.text(g, 'Market prices', 22, 38, { size: 22, italic: true });
        P.text(g, 'last three harvests', 186, 38, { size: 12, italic: true, color: PENCIL });
      }
      const cols = 3, rowsN = 2;
      const top = big ? 112 : 54, left = big ? 30 : 14;
      const cw = (w - left * 2) / cols, ch = (h - top - (big ? 20 : 10)) / rowsN;
      D.chartItems.forEach((id, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x0 = left + c * cw, y0 = top + r * ch;
        const hist = D.history[id];
        const it = ITEMS[id];
        const cur = hist.length ? hist[hist.length - 1][1] : 0;
        const ch1 = change(hist, 3), ch12 = change(hist, 36);
        if (big) {
          P.text(g, it.name, x0 + 56, y0 + 26, { size: 21, bold: true });
          P.text(g, priceStr(id, cur), x0 + cw - 22, y0 + 26, { size: 21, align: 'right', color: INK_BLUE, bold: true });
          P.text(g, `month ${trendText(ch1)}`, x0 + 56, y0 + 46, { size: 12, italic: true, color: ch1 >= 0 ? INK_GREEN : INK_RED });
          P.text(g, `year ${trendText(ch12)}`, x0 + 180, y0 + 46, { size: 12, italic: true, color: ch12 >= 0 ? INK_GREEN : INK_RED });
          chart(g, x0 + 56, y0 + 66, cw - 84, ch - 104, id, hist, rng, { axes: true, notes: true });
        } else {
          P.text(g, it.name, x0 + 10, y0 + 22, { size: 15, bold: true });
          P.text(g, priceStr(id, cur), x0 + cw - 12, y0 + 22, { size: 14, align: 'right', color: INK_BLUE });
          P.text(g, trendText(ch1), x0 + cw - 12, y0 + 38, { size: 10.5, align: 'right', italic: true, color: ch1 >= 0 ? INK_GREEN : INK_RED });
          chart(g, x0 + 12, y0 + 44, cw - 26, ch - 58, id, hist, rng, { lineW: 1.4 });
        }
      });
    });
  }

  // today's quotes per sell point
  function quotesCard(g, cx, cy, rot, w, h, D, rng) {
    const img = P.paper(w, h, { tone: 'yellow', deckle: 1 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, "Today's quotes", 22, 44, { size: 24, italic: true });
      P.text(g, dayLabel(D.today, true), 22, 66, { size: 13, italic: true, color: INK_SOFT });
      let y = 100;
      for (const sp of D.sellPoints) {
        if (y > h - 40) break;
        drawIcon(P, g, art, sp.id === 'shop' ? 'house' : 'silo', 14, y - 20, 26, rng);
        P.text(g, sp.name, 46, y - 2, { size: 14, bold: true, maxW: w - 60 });
        y += 20;
        for (const q of sp.quotes.slice(0, 3)) {
          P.text(g, ITEMS[q.item].name, 50, y, { size: 13, italic: true, color: INK_SOFT });
          P.text(g, priceStr(q.item, q.price), w - 22, y, { size: 13, align: 'right' });
          if (q.sat > 0.02) P.text(g, `glut −${Math.round(q.sat * 100)}%`, w - 120, y, { size: 11, italic: true, color: INK_RED, align: 'right', font: HAND });
          y += 19;
        }
        y += 16;
      }
      const inv = Object.entries(D.inventory).filter(([k, q]) => q > 0.05 && ITEMS[k]);
      if (inv.length) {
        y = Math.max(y, h - 150);
        P.line(g, 20, y - 18, w - 20, y - 18, rng, { w: 0.9, alpha: 0.5 });
        P.text(g, 'In our store', 22, y + 2, { size: 16, italic: true, bold: true });
        y += 24;
        for (const [k, q] of inv.slice(0, 3)) {
          const best = Math.max(...D.sellPoints.filter((sp) => sp.quotes.some((x) => x.item === k)).map((sp) => sp.quotes.find((x) => x.item === k).price), D.prices[k] * 0.97);
          P.text(g, `${q.toFixed(1).replace('.', ',')} ${ITEMS[k].unit} ${ITEMS[k].name.toLowerCase()}`, 26, y, { size: 13.5, italic: true });
          P.text(g, '≈ ' + euro(q * best), w - 22, y, { size: 14, bold: true, align: 'right', color: INK_GREEN });
          y += 21;
        }
      }
      P.text(g, 'sell on a quiet day — big loads flood a buyer', 22, h - 20, { size: 11.5, italic: true, color: PENCIL, font: HAND, maxW: w - 30 });
    }, 0.8);
  }

  // ======================= JOBS =======================
  function jobCard(g, cx, cy, rot, w, h, j, D, rng) {
    const img = P.paper(w, h, { tone: 'white', ruled: 22, ruledTop: 60 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      g.strokeStyle = 'rgba(176,60,50,0.45)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(0, 40); g.lineTo(w, 40); g.stroke();
      drawIcon(P, g, art, j.type === 'harvest' && (j.crop === 'potatoes' || j.crop === 'sugarBeet') ? 'lift' : j.type, 12, 46, 58, rng);
      P.text(g, (j.type === 'harvest' && (j.crop === 'potatoes' || j.crop === 'sugarBeet') ? 'Lift' : JOB_TYPES[j.type].title).toUpperCase(), 14, 28, { size: 12, color: PENCIL, font: SERIF });
      P.text(g, euro(j.status === 'completed' && j.paid ? j.paid : j.pay), w - 16, 32, { size: 24, bold: true, align: 'right', color: INK_GREEN });
      P.text(g, j.title, 82, 66, { size: 16, bold: true, maxW: w - 96 });
      P.text(g, `for ${j.client}, ${j.clientFarm}`, 82, 88, { size: 13, italic: true, color: INK_SOFT, maxW: w - 96 });
      let where = '';
      if (j.from && j.to && j.type !== 'plough' && j.type !== 'sow' && j.type !== 'harvest' && j.type !== 'mow') where = `${j.from.name} → ${j.to.name}`;
      else if (j.to) where = `at ${j.to.name}`;
      else if (j.unit === 'h') where = 'in the village';
      if (where) P.text(g, where, 82, 110, { size: 12.5, italic: true, color: INK_BLUE, maxW: w - 96 });
      const left = j.deadlineDay - D.today;
      const due = j.status === 'offered' ? `offer ends ${dayLabel(j.expiresDay)} · due ${dayLabel(j.deadlineDay)}` : `due ${dayLabel(j.deadlineDay)}${j.status === 'accepted' ? (left <= 0 ? ' — today!' : ` — ${left} day${left > 1 ? 's' : ''} left`) : ''}`;
      P.text(g, due, 14, h - 16, { size: 12, italic: true, color: j.status === 'accepted' && left <= 0 ? INK_RED : INK_SOFT, maxW: j.status === 'accepted' ? w - 200 : w - 28 });
      if (j.status === 'accepted') {
        const bw = 110, bh = 11, bx = w - bw - 52, by = h - 26;
        P.ink(g, [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]], rng, { close: true, w: 1.1, jitter: 0.4 });
        if (j.progress > 0) P.wash(g, (gg) => { gg.beginPath(); gg.rect(bx + 1, by + 1, (bw - 2) * j.progress, bh - 2); }, '#6f9a3f', rng, { alpha: 0.6, edge: 0.5 });
        P.text(g, `${Math.round(j.progress * 100)} %`, bx + bw + 6, by + 10, { size: 11, italic: true, color: INK_SOFT });
        P.stamp(g, 'ACCEPTED', 44, h - 58, INK_BLUE, -0.2, rng, { size: 11 });
      } else if (j.status === 'completed') P.stamp(g, 'PAID', 44, h - 58, INK_GREEN, -0.22, rng, { size: 16 });
      else if (j.status === 'failed') P.stamp(g, 'MISSED', 44, h - 58, INK_RED, 0.16, rng, { size: 13 });
      else if (j.status === 'expired') P.stamp(g, 'TAKEN', 44, h - 58, PENCIL, 0.1, rng, { size: 13 });
    }, 0.9);
  }

  // ======================= MAP =======================
  const STATE_STYLE = {
    owned: { color: '#6f9a3f', label: 'ours' },
    rented: { color: '#d49a3a', label: 'rented by us' },
    forSale: { color: '#b8652e', label: 'for sale' },
    forRent: { color: '#6fa3a8', label: 'to let' },
    npc: { color: '#a39c90', label: 'neighbour' },
  };
  function landMap(g, cx, cy, rot, w, h, D, rng, big) {
    const img = P.paper(w, h, { tone: 'cream', deckle: 1.2 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, big ? 'Kaart van de vallei' : 'The valley', 26, big ? 52 : 38, { size: big ? 32 : 22, italic: true });
      if (big) P.text(g, 'land register sketch — who farms what', 28, 76, { size: 14, italic: true, color: INK_SOFT });
      const parcels = D.parcels;
      if (!parcels.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of parcels) { x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1]); x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3]); }
      for (const s of D.sellPoints) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
      const top = big ? 96 : 52, bottom = big ? 70 : 40, side = big ? 40 : 22;
      const s = Math.min((w - side * 2) / (x1 - x0 + 20), (h - top - bottom) / (y1 - y0 + 20));
      const ox = side + ((w - side * 2) - (x1 - x0) * s) / 2 - x0 * s;
      const oy = top + ((h - top - bottom) - (y1 - y0) * s) / 2 - y0 * s;
      const M = ([x, y]) => [ox + x * s, oy + y * s];
      // decor: woods, village, brook, lanes
      const DC = D.decor;
      const polyPath = (pts) => (gg) => { gg.beginPath(); pts.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y))); gg.closePath(); };
      const bboxOf = (pts) => { let a = Infinity, b2 = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of pts) { a = Math.min(a, x); b2 = Math.min(b2, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b2, c - a, d - b2]; };
      const woodLabels = [];
      if (DC) {
        for (const wpoly of DC.woods || []) {
          const pts = wpoly.map(M), bb = bboxOf(pts);
          P.wash(g, polyPath(pts), '#4f7f2f', rng, { alpha: 0.18, bounds: bb });
          g.save(); polyPath(pts)(g); g.clip();
          const tr = Math.max(5, 11 * s * 1.6);
          for (let ty = bb[1] + tr * 0.6; ty < bb[1] + bb[3]; ty += tr * 1.25) for (let tx = bb[0] + tr * 0.6 + ((ty / tr) % 2) * tr * 0.5; tx < bb[0] + bb[2]; tx += tr * 1.3) {
            const jx = tx + rng.range(-3, 3), jy = ty + rng.range(-3, 3), rr = tr * rng.range(0.55, 0.8);
            P.wash(g, (gg) => { gg.beginPath(); gg.arc(jx, jy, rr, 0, 7); }, rng.pick(['#4f7f2f', '#3f6b27', '#5f8f38']), rng, { alpha: 0.5, edge: 1 });
            P.ink(g, [[jx - rr * 0.8, jy + rr * 0.1], [jx - rr * 0.3, jy - rr * 0.8], [jx + rr * 0.5, jy - rr * 0.7], [jx + rr * 0.85, jy + 0.2 * rr]], rng, { w: 0.8, alpha: 0.5, jitter: 0.4, passes: 1 });
          }
          g.restore();
          const cc = [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2];
          woodLabels.push(() => P.text(g, 'Lindebos', cc[0], cc[1] + 4, { size: big ? 14 : 10.5, italic: true, bold: true, align: 'center', color: '#2f4a22', halo: '#f1e6cc' }));
        }
        for (const vpoly of DC.village || []) {
          const pts = vpoly.map(M), bb = bboxOf(pts);
          P.wash(g, polyPath(pts), '#c9b184', rng, { alpha: 0.2, bounds: bb });
          const hs = Math.max(12, 16 * s * 1.8);
          const spots = [[0.28, 0.3], [0.62, 0.24], [0.45, 0.55], [0.75, 0.6], [0.25, 0.72], [0.55, 0.82]];
          for (const [fx, fy] of spots) drawIcon(P, g, art, 'house', bb[0] + bb[2] * fx - hs / 2, bb[1] + bb[3] * fy - hs / 2, hs, rng);
          woodLabels.push(() => P.text(g, 'Ter Beek', bb[0] + bb[2] / 2, bb[1] + (big ? 22 : 14), { size: big ? 15 : 11, italic: true, bold: true, align: 'center', halo: '#f1e6cc' }));
        }
      }
      const drawLanesAndBrook = () => {
        if (!DC) return;
        const brook = DC.brook.map(M);
        P.ink(g, brook, rng, { w: Math.max(3, 9 * s), color: '#6fa3a8', alpha: 0.55, jitter: 0.6, passes: 1 });
        P.ink(g, brook, rng, { w: 1.1, color: INK_BLUE, alpha: 0.75, jitter: 0.6 });
        for (const ln of DC.lanes) {
          const pts = ln.map(M);
          P.ink(g, pts, rng, { w: Math.max(4, 10 * s), color: '#d8cdb4', alpha: 0.95, jitter: 0.2, passes: 1 });
          P.ink(g, pts, rng, { w: 0.9, color: PENCIL, alpha: 0.85, jitter: 0.5 });
        }
      };
      const labels = [];
      for (const p of parcels) {
        const st = STATE_STYLE[p.state] || STATE_STYLE.npc;
        const pts = p.poly.map(M);
        const path = (gg) => { gg.beginPath(); pts.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y))); gg.closePath(); };
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [x, y] of pts) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
        P.wash(g, path, st.color, rng, { alpha: p.state === 'npc' ? 0.22 : 0.36, bounds: [bx0, by0, bx1 - bx0, by1 - by0] });
        if (p.state === 'forRent' || p.state === 'forSale') P.hatch(g, path, [bx0, by0, bx1 - bx0, by1 - by0], art.shade(st.color, -0.3), rng, 9, p.state === 'forSale' ? 0.8 : -0.8);
        P.ink(g, pts, rng, { close: true, w: 1.3, jitter: 0.7, alpha: 0.8 });
        labels.push(() => {
          const [mx, my] = M(p.center);
          const ha = (p.area / 1e4).toFixed(1).replace('.', ',') + ' ha';
          const small = (bx1 - bx0) < 110;
          const mine = p.state !== 'npc';
          // never truncate: shrink a little, otherwise leave the name off (the register lists it)
          const drawn = P.text(g, p.name.replace(/ \(.*\)/, ''), mx, my - 4, { size: big ? (small ? 13 : 16) : (small ? 10 : 12), italic: true, bold: p.state === 'owned' || p.state === 'rented', align: 'center', maxW: bx1 - bx0 - 6, shrink: 0.8, whole: true, halo: '#f1e6cc' });
          let sub = ha;
          if (p.state === 'forSale') sub += ' · ' + euro(p.price);
          else if (p.state === 'forRent') sub += ` · ${euro(p.rentPerHaYear)}/ha`;
          else if (p.state === 'npc' && p.owner && big) sub += ' · ' + p.owner.split(' ').slice(-1)[0];
          else if (p.state === 'rented' && big) sub += ` · ${euro(p.rentPerHaYear)}/ha`;
          const o = { size: big ? 11.5 : 9.5, align: 'center', color: INK_SOFT, maxW: bx1 - bx0 - 4, shrink: 0.85, whole: true, halo: '#f1e6cc' };
          const y2 = my + (big ? 14 : 10) - (drawn ? 0 : 7);
          if (!P.text(g, sub, mx, y2, o) && (mine || big)) P.text(g, ha, mx, y2, o);
        });
      }
      drawLanesAndBrook();
      for (const l of labels) l();
      for (const l of woodLabels) l();
      for (const sp of D.sellPoints) {
        const [px, py] = M([sp.x, sp.y]);
        const sz = big ? 30 : 20;
        drawIcon(P, g, art, sp.id === 'shop' ? 'house' : 'silo', px - sz / 2, py - sz / 2, sz, rng);
        // the farm shop sits on the crossroads between parcels: label it above the icon
        if (big) P.text(g, sp.name, px, sp.id === 'shop' ? py - sz / 2 - 5 : py + sz / 2 + 12, { size: 11.5, italic: true, bold: true, align: 'center', color: INK, halo: '#f1e6cc' });
      }
      // compass + scale bar
      const cxp = w - (big ? 60 : 36), cyp = big ? 60 : 40, r = big ? 22 : 14;
      P.ink(g, [[cxp, cyp + r], [cxp, cyp - r]], rng, { w: 1.3 });
      g.fillStyle = art.rgba(INK, 0.85);
      g.beginPath(); g.moveTo(cxp, cyp - r - 4); g.lineTo(cxp - 5, cyp - r + 6); g.lineTo(cxp + 5, cyp - r + 6); g.closePath(); g.fill();
      P.text(g, 'N', cxp, cyp - r - 8, { size: big ? 14 : 11, bold: true, align: 'center' });
      P.ink(g, [[cxp - r * 0.7, cyp], [cxp + r * 0.7, cyp]], rng, { w: 0.9, alpha: 0.6 });
      const sb = 100 * s, sx0 = side, sy0 = h - (big ? 30 : 16);
      P.ink(g, [[sx0, sy0], [sx0 + sb, sy0]], rng, { w: 2 });
      P.ink(g, [[sx0, sy0 - 4], [sx0, sy0 + 4]], rng, { w: 1.2 }); P.ink(g, [[sx0 + sb, sy0 - 4], [sx0 + sb, sy0 + 4]], rng, { w: 1.2 });
      P.text(g, '100 m', sx0 + sb + 8, sy0 + 4, { size: 11, italic: true, color: INK_SOFT });
      // legend
      if (big) {
        let lx = sx0 + sb + 80;
        for (const k of ['owned', 'rented', 'forRent', 'forSale', 'npc']) {
          const st = STATE_STYLE[k];
          P.wash(g, (gg) => { gg.beginPath(); gg.rect(lx, sy0 - 9, 22, 14); }, st.color, rng, { alpha: k === 'npc' ? 0.3 : 0.45 });
          lx += 28 + P.text(g, st.label, lx + 28, sy0 + 3, { size: 12, italic: true }) + 18;
        }
      }
    }, 0.8);
  }

  // ======================= CARDS =======================
  function pnlCard(g, cx, cy, rot, w, h, D, rng) {
    const img = P.paper(w, h, { tone: 'green', deckle: 0.8 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      const S = D.summary;
      P.text(g, 'This season', 20, 38, { size: 22, italic: true });
      P.text(g, 'last 12 months, operating', 20, 58, { size: 12, italic: true, color: INK_SOFT });
      P.text(g, (S.operatingNet >= 0 ? '+ ' : '') + euro(S.operatingNet), w - 20, 42, { size: 24, bold: true, align: 'right', color: S.operatingNet >= 0 ? INK_GREEN : INK_RED });
      const cats = Object.entries(S.byCategory).filter(([k]) => !['loan', 'loanRepay', 'land', 'landSale', 'machinery', 'assetSale'].includes(k)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
      const maxV = Math.max(1, ...cats.map((c) => Math.abs(c[1])));
      let y = 84;
      const bx = 150, bw = w - bx - 90;
      for (const [k, v] of cats) {
        P.text(g, catLabel(k), 20, y + 10, { size: 12.5, italic: true, maxW: bx - 26 });
        const len = Math.max(3, (Math.abs(v) / maxV) * bw);
        P.wash(g, (gg) => { gg.beginPath(); gg.moveTo(bx, y); gg.lineTo(bx + len, y + 1); gg.lineTo(bx + len - 2, y + 13); gg.lineTo(bx, y + 12); gg.closePath(); }, v >= 0 ? '#6f9a3f' : '#b8352b', rng, { alpha: 0.5, edge: 1 });
        P.text(g, euro(v), w - 18, y + 11, { size: 12, align: 'right', color: v >= 0 ? INK_GREEN : INK_RED });
        y += 21;
      }
    });
  }

  function farmCard(g, cx, cy, rot, w, h, D, rng) {
    const img = P.paper(w, h, { tone: 'kraft', deckle: 1 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, 'The farm', 20, 36, { size: 22, italic: true });
      const own = D.parcels.filter((p) => p.state === 'owned').reduce((a, p) => a + p.area, 0) / 1e4;
      const rent = D.parcels.filter((p) => p.state === 'rented').reduce((a, p) => a + p.area, 0) / 1e4;
      const rows = [
        ['Land owned', own.toFixed(1).replace('.', ',') + ' ha'],
        ['Land rented', rent.toFixed(1).replace('.', ',') + ' ha'],
        ['In store', Object.entries(D.inventory).filter(([, q]) => q > 0.05).map(([k, q]) => `${q.toFixed(0)} ${ITEMS[k] ? ITEMS[k].unit : ''} ${k}`).join(', ') || 'empty'],
        ['Machines', (() => { const m = D.assets.slice().sort((a, b) => b.price - a.price); return m.length ? m.slice(0, 2).map((a) => a.name.replace(/^Used /, '')).join(', ') + (m.length > 2 ? ` +${m.length - 2} more` : '') : 'none'; })()],
        ['Farmhands', D.workers.length ? D.workers.map((x) => `${x.name} (${euro(x.wage)}/day)`).join(', ') : 'none hired'],
        ['Reputation', '★'.repeat(Math.round(D.rep * 5)) + '☆'.repeat(5 - Math.round(D.rep * 5))],
      ];
      let y = 66;
      for (const [k, v] of rows) {
        P.text(g, k, 20, y, { size: 12.5, italic: true, color: INK_SOFT });
        P.text(g, v, 122, y, { size: 13, maxW: w - 136, color: k === 'Reputation' ? '#8a5a10' : INK });
        y += 23;
      }
    });
  }

  function rosterCard(g, cx, cy, rot, w, h, D, rng) {
    const img = P.paper(w, h, { tone: 'cream', ruled: 24, ruledTop: 76, deckle: 0.8 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, 'Contract book', 20, 40, { size: 24, italic: true });
      const st = D.jobStats;
      P.text(g, `${st.completed} done · ${st.failed} missed · ${euro(st.earned)} earned`, 20, 62, { size: 12.5, italic: true, color: INK_SOFT });
      let y = 96;
      const best = Object.entries(D.clients).sort((a, b) => b[1].rep - a[1].rep).slice(0, 6);
      for (const [name, c] of best) {
        P.text(g, name, 20, y, { size: 13.5, italic: true, maxW: w - 130 });
        const stars = Math.round(c.rep * 5);
        P.text(g, '★'.repeat(stars) + '☆'.repeat(5 - stars), w - 20, y, { size: 13, align: 'right', color: '#8a5a10' });
        y += 24;
      }
      if (D.monthlyJobs && D.monthlyJobs.length) {
        const cy0 = y + 18, chH = h - cy0 - 60, n = D.monthlyJobs.length, bw2 = (w - 50) / n;
        P.text(g, 'contract income per month', 20, cy0 + 4, { size: 12.5, italic: true, color: INK_SOFT });
        const mx = Math.max(1, ...D.monthlyJobs.map((m) => m.v));
        D.monthlyJobs.forEach((m, i) => {
          const bh2 = (m.v / mx) * (chH - 30), bx2 = 26 + i * bw2, by2 = cy0 + chH - 8;
          if (bh2 > 1) P.wash(g, (gg) => { gg.beginPath(); gg.rect(bx2 + 2, by2 - bh2, bw2 - 5, bh2); }, '#6f9a3f', rng, { alpha: 0.55, edge: 1 });
          P.text(g, MONTHS[m.month][0], bx2 + bw2 / 2, by2 + 14, { size: 10.5, align: 'center', color: PENCIL });
        });
        P.line(g, 22, cy0 + chH - 8, w - 22, cy0 + chH - 8, rng, { w: 1, alpha: 0.6 });
      }
      P.text(g, 'good work brings better-paid offers', 20, h - 18, { size: 11.5, font: HAND, color: PENCIL, maxW: w - 30 });
    });
  }

  function titleStrip(g, cx, cy, rot, w, h, title, sub, rng) {
    const img = P.paper(w, h, { tone: 'white', deckle: 0.6 });
    P.sheet(g, img, cx, cy, rot, (g) => {
      P.text(g, title, w / 2, h / 2 + 2, { size: 24, italic: true, align: 'center' });
      if (sub) P.text(g, sub, w / 2, h / 2 + 22, { size: 12.5, italic: true, align: 'center', color: INK_SOFT });
    }, 0.6);
  }

  function note(g, cx, cy, rot, w, h, lines, rng) {
    const img = P.paper(w, h, { tone: 'yellow' });
    P.sheet(g, img, cx, cy, rot, (g) => {
      let y = 34;
      for (const l of lines) { P.text(g, l, 16, y, { size: 14, font: HAND, maxW: w - 26 }); y += 24; }
    }, 0.7);
  }

  return { ledger, priceSheet, quotesCard, jobCard, landMap, pnlCard, farmCard, rosterCard, titleStrip, note, chart };
}
