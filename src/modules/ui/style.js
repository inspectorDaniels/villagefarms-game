// Scoped stylesheet for the HUD (everything lives under .hv-ui) + a procedurally
// painted paper texture (no external images).

/** Paint a tileable-ish neutral paper texture (near-white, multiplied over paper colours). */
export function paperTexture(ctx) {
  const S = 220;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  const n = ctx.noise('paper');
  const rng = ctx.rng('paper');
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // sample noise on a torus so the tile repeats without seams
      const ax = (x / S) * TAU, ay = (y / S) * TAU;
      const u = Math.cos(ax) * 1.6, v = Math.sin(ax) * 1.6, w = Math.cos(ay) * 1.6 + Math.sin(ay) * 0.7;
      const blot = n.fbm(u + w * 0.9, v + Math.sin(ay) * 1.6, 3); // -1..1
      const fine = rng.float() - 0.5;
      const L = 246 + blot * 7 + fine * 9;
      const o = (y * S + x) * 4;
      d[o] = L + 3; d[o + 1] = L; d[o + 2] = L - 6; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // fibres
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rng.float() * S, y = rng.float() * S, a = rng.float() * TAU, l = 4 + rng.float() * 12;
    g.strokeStyle = rng.chance(0.5) ? 'rgba(255,252,240,0.55)' : 'rgba(120,96,60,0.10)';
    g.lineWidth = 0.6 + rng.float() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  try { return c.toDataURL('image/png'); } catch (e) { return ''; }
}

export function buildCss(P, tex) {
  const u = P.ui;
  return `
#ui > .hv-ui { pointer-events: none; }
.hv-ui {
  --paper: ${u.paper}; --paper2: ${u.paperDark}; --paper3: #d8c8a2; --ink: ${u.ink}; --ink2: ${u.inkSoft};
  --ink3: #8a7e6c; --accent: ${u.accent}; --accent2: ${u.accent2}; --danger: ${u.danger}; --gold: ${u.gold};
  --border: #74603f; --brass: #b08d4a; --wood: #5a4432;
  --tex: ${tex ? `url(${tex})` : 'none'};
  --shadow: 0 1px 1px rgba(40,26,10,.22), 0 4px 14px rgba(34,24,12,.26);
  position: fixed; inset: 0; pointer-events: none; overflow: hidden;
  font: 13px/1.35 'Segoe UI', system-ui, sans-serif; color: var(--ink);
  user-select: none; -webkit-user-select: none; -webkit-font-smoothing: antialiased;
}
.hv-ui.hv-night .hv-mini canvas { filter: brightness(.6) saturate(.7) sepia(.25); }
.hv-ui.hv-night .hv-char .pt svg { filter: brightness(.8) saturate(.85); }
.hv-ui.hv-night .hv-card, .hv-ui.hv-night .hv-tabs button, .hv-ui.hv-night .hv-wl .b { filter: brightness(.86) sepia(.12); }
.hv-ui.hv-night .hv-panel, .hv-ui.hv-night .hv-dialog { filter: brightness(.93) sepia(.08); }
.hv-ui.hv-night .hv-launch button { filter: brightness(.86); }
.hv-ui.hv-night { --paper: #eadcbd; --paper2: #dccaa3; --paper3: #cdb991; --shadow: 0 0 0 1px rgba(255,196,120,.22), 0 0 16px rgba(255,170,80,.16), 0 2px 3px rgba(0,0,0,.4), 0 6px 22px rgba(0,0,0,.5); --note: #eadcbc; }
.hv-ui * { box-sizing: border-box; }
.hv-ui .hv-hit { pointer-events: auto; }
.hv-ui .hv-serif { font-family: Georgia, 'Times New Roman', serif; }
.hv-ui .hv-ic { width: 1.25em; height: 1.25em; display: inline-block; vertical-align: -0.28em; fill: none; stroke: currentColor;
  stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; overflow: visible; flex: none; }
.hv-ui .hv-ic .w { fill: currentColor; stroke: none; opacity: .17; }
.hv-ui .hv-ic .f { fill: currentColor; stroke: none; }

/* ---------- paper card ---------- */
.hv-ui .hv-card {
  position: relative; background-color: var(--paper); background-image: var(--tex); background-blend-mode: multiply;
  border: 1px solid var(--border); border-radius: 7px;
  box-shadow: inset 0 0 0 2px rgba(255,249,234,.55), inset 0 0 0 3px rgba(138,112,70,.22), inset 0 -8px 16px -10px rgba(120,90,40,.25), var(--shadow);
}
.hv-ui .hv-card.hv-dark { background-color: var(--paper2); }

/* ---------- slots ---------- */
.hv-ui .hv-slot { position: absolute; display: flex; gap: 10px; pointer-events: none; }
.hv-ui .hv-slot.tl { top: 14px; left: 14px; flex-direction: column; align-items: flex-start; }
.hv-ui .hv-slot.tc { width: max-content; top: 12px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.hv-ui .hv-slot.tr { top: 14px; right: 14px; flex-direction: column; align-items: flex-end; }
.hv-ui .hv-slot.bl { bottom: 14px; left: 14px; flex-direction: column; align-items: flex-start; }
.hv-ui .hv-slot.bc { width: max-content; bottom: 14px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.hv-ui .hv-slot.br { bottom: 14px; right: 14px; flex-direction: column; align-items: flex-end; }
.hv-ui .hv-hud { padding: 8px 12px; }
.hv-ui .hv-hud.bare { padding: 0; background: none; border: 0; box-shadow: none; pointer-events: none; }

/* ---------- money ---------- */
.hv-ui .hv-money { display: flex; align-items: center; gap: 10px; padding: 7px 16px 8px 10px; min-width: 196px; }
.hv-ui .hv-money .coin { width: 34px; height: 34px; color: #8a6414; background: radial-gradient(circle at 40% 35%, #f1d88a, #d7ac48 60%, #b98a2c);
  border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 0 0 1.5px rgba(110,74,20,.55), 0 1px 2px rgba(60,40,10,.35); }
.hv-ui .hv-money .coin .hv-ic { width: 26px; height: 26px; stroke-width: 1.5; }
.hv-ui .hv-money .lbl { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink2); }
.hv-ui .hv-money .val { font: 600 22px/1.05 Georgia, serif; letter-spacing: .01em; white-space: nowrap; }
.hv-ui .hv-money .val.neg { color: var(--danger); }
.hv-ui .hv-money .delta { position: absolute; left: 58px; top: 100%; margin-top: 4px; font: 600 14px Georgia, serif; white-space: nowrap;
  padding: 1px 8px; border-radius: 10px; opacity: 0; transition: opacity .35s, transform .9s ease-out; transform: translateY(-4px); }
.hv-ui .hv-money .delta.on { opacity: 1; transform: translateY(0); }
.hv-ui .hv-money .delta.pos { color: #2f5a2b; background: rgba(233,240,214,.92); box-shadow: 0 0 0 1px rgba(63,107,58,.35); }
.hv-ui .hv-money .delta.neg { color: #8a2e25; background: rgba(245,226,214,.92); box-shadow: 0 0 0 1px rgba(168,57,47,.35); }

/* ---------- clock ---------- */
.hv-ui .hv-clock { display: flex; align-items: stretch; padding: 6px 8px 6px 10px; gap: 0; }
.hv-ui .hv-clock .sec { flex: none; display: flex; align-items: center; gap: 9px; padding: 0 12px; }
.hv-ui .hv-clock .sec + .sec { border-left: 1px solid rgba(116,96,63,.35); box-shadow: -1px 0 0 rgba(255,250,236,.6); }
.hv-ui .hv-clock .dial { width: 50px; height: 34px; flex: none; }
.hv-ui .hv-clock .time { font: 600 26px/1 Georgia, serif; letter-spacing: .02em; }
.hv-ui .hv-clock .cdate { font: italic 13px/1.2 Georgia, serif; color: var(--ink2); margin-top: 3px; white-space: nowrap; }
.hv-ui .hv-clock .wx .hv-ic { width: 30px; height: 30px; color: var(--ink); }
.hv-ui .hv-clock .wx .wi.sun { color: #a8661c; }
.hv-ui .hv-clock .wx .wi.moon { color: #4a5a7c; }
.hv-ui .hv-clock .temp { font: 600 19px/1 Georgia, serif; }
.hv-ui .hv-clock .wlabel { font-size: 11.5px; color: var(--ink2); white-space: nowrap; margin-top: 2px; }
.hv-ui .hv-speed { display: flex; gap: 3px; padding: 3px; border-radius: 6px; background: rgba(116,96,63,.12); box-shadow: inset 0 1px 2px rgba(80,60,30,.2); }
.hv-ui .hv-speed button { all: unset; box-sizing: border-box; cursor: pointer; height: 26px; min-width: 30px; padding: 0 6px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; gap: 2px; color: var(--ink2); font: 600 11px 'Segoe UI', system-ui, sans-serif; }
.hv-ui .hv-speed button .hv-ic { width: 13px; height: 13px; }
.hv-ui .hv-speed button:hover { background: rgba(255,250,236,.7); color: var(--ink); }
.hv-ui .hv-speed button.on { background: var(--paper); color: var(--ink); box-shadow: 0 0 0 1px rgba(116,96,63,.55), 0 1px 2px rgba(60,40,10,.3); }
.hv-ui .hv-speed button.on.pz { color: var(--accent2); }
.hv-ui .hv-paused-tag { font: italic 11px Georgia, serif; color: var(--accent2); letter-spacing: .04em; text-align: center; margin-top: 1px; height: 0; overflow: visible; }

/* ---------- minimap ---------- */
.hv-ui .hv-mini { padding: 7px 7px 6px; }
.hv-ui .hv-mini .frame { position: relative; width: 184px; height: 184px; border-radius: 4px; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(90,68,40,.6), 0 0 0 1px rgba(255,250,236,.7); cursor: crosshair; }
.hv-ui .hv-mini canvas { display: block; width: 184px; height: 184px; }
.hv-ui .hv-mini .cap { display: flex; justify-content: space-between; align-items: center; padding: 5px 3px 0; font: italic 12px Georgia, serif; color: var(--ink2); }
.hv-ui .hv-mini .cap b { font-style: normal; font-weight: 600; color: var(--ink); letter-spacing: .03em; }
.hv-ui .hv-mini .north { position: absolute; top: 5px; right: 5px; width: 22px; height: 28px; color: var(--ink); pointer-events: none;
  display: flex; flex-direction: column; align-items: center; font: 700 9px Georgia, serif; }
.hv-ui .hv-mini .north .hv-ic { width: 16px; height: 18px; }

/* ---------- launcher (bottom-right) ---------- */
.hv-ui .hv-launch { display: flex; gap: 7px; padding: 6px 8px; }
.hv-ui .hv-launch button { all: unset; cursor: pointer; position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  color: var(--ink); background: radial-gradient(circle at 45% 35%, #fbf4e3, var(--paper) 55%, var(--paper2));
  box-shadow: inset 0 0 0 1.5px var(--brass), inset 0 0 0 3px rgba(255,248,230,.7), 0 1px 3px rgba(50,34,14,.35); transition: transform .12s; }
.hv-ui .hv-launch button .hv-ic { width: 22px; height: 22px; }
.hv-ui .hv-launch button:hover { transform: translateY(-2px); }
.hv-ui .hv-launch button.on { color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 0 3.5px rgba(255,248,230,.8), 0 1px 3px rgba(50,34,14,.35); }
.hv-ui .hv-launch .kc { position: absolute; right: -3px; bottom: -3px; }

/* ---------- key caps ---------- */
.hv-ui .kc { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 4px;
  font: 700 10px/1 'Segoe UI', system-ui, sans-serif; color: var(--ink); background: linear-gradient(#fbf6ea, #e6d8b8);
  box-shadow: 0 0 0 1px rgba(90,68,40,.55), 0 1.5px 0 rgba(90,68,40,.55); letter-spacing: 0; }
.hv-ui .kc.lg { min-width: 24px; height: 23px; font-size: 12px; padding: 0 6px; border-radius: 5px; }

/* ---------- toolbar ---------- */
.hv-ui .hv-tools { display: flex; gap: 6px; padding: 7px 8px; align-items: flex-end; }
.hv-ui .hv-tool { all: unset; cursor: pointer; position: relative; width: 50px; height: 50px; border-radius: 6px; display: grid; place-items: center;
  color: var(--ink); background: rgba(255,250,236,.5); box-shadow: inset 0 0 0 1px rgba(116,96,63,.45), inset 0 -3px 6px -3px rgba(120,90,40,.3);
  transition: transform .12s, background .12s; }
.hv-ui .hv-tool .hv-ic { width: 28px; height: 28px; }
.hv-ui .hv-tool .n { position: absolute; left: 4px; top: 2px; font: 700 10px Georgia, serif; color: var(--ink3); }
.hv-ui .hv-tool:hover { background: rgba(255,250,236,.9); }
.hv-ui .hv-tool.on { background: var(--paper); transform: translateY(-4px); color: var(--accent);
  box-shadow: inset 0 0 0 2px var(--accent), 0 3px 6px rgba(50,34,14,.3); }
.hv-ui .hv-tool.on .n { color: var(--accent); }
.hv-ui .hv-toolname { font: italic 13px Georgia, serif; color: var(--ink); padding: 2px 12px; border-radius: 11px; background: rgba(243,234,214,.9);
  box-shadow: 0 0 0 1px rgba(116,96,63,.4), 0 1px 3px rgba(40,26,10,.25); margin-bottom: -2px; }

/* ---------- prompt ---------- */
.hv-ui .hv-prompt { display: flex; align-items: center; gap: 9px; padding: 6px 14px 6px 8px; font: 14px Georgia, serif; border-radius: 20px; }
.hv-ui .hv-prompt .kc { min-width: 26px; height: 26px; font-size: 13px; border-radius: 6px; }

/* ---------- characters ---------- */
.hv-ui .hv-char .rate { font: 600 10px Georgia, serif; color: var(--ink2); background: rgba(255,248,230,.75); border-radius: 7px; padding: 0 5px; line-height: 14px; }
.hv-ui .hv-char .rate.clk { color: #7a4a12; box-shadow: inset 0 0 0 1px rgba(160,110,30,.55); }
.hv-ui .hv-solv { display: flex; align-items: center; gap: 9px; padding: 7px 12px; max-width: 420px; color: var(--ink); font: 12px Georgia, serif; }
.hv-ui .hv-solv > div > b { display: block; font-size: 13px; }
.hv-ui .hv-solv span b { font-weight: 700; }
.hv-ui .hv-solv .si .hv-ic { width: 20px; height: 20px; }
.hv-ui .hv-solv.over { box-shadow: inset 3px 0 0 #c08a2a; }
.hv-ui .hv-solv.blocked, .hv-ui .hv-solv.bankrupt { box-shadow: inset 3px 0 0 #a83a26; }
.hv-ui .hv-solv.bankrupt b { color: #8a2a18; }
.hv-ui .hv-chars { display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px 8px 10px; }
.hv-ui .hv-char { all: unset; cursor: pointer; position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.hv-ui .hv-char .pt { width: 42px; height: 42px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1.5px rgba(90,68,40,.6), 0 1px 3px rgba(40,26,10,.35); transition: transform .12s; }
.hv-ui .hv-char .pt svg { display: block; width: 100%; height: 100%; }
.hv-ui .hv-char .nm { font: 11px Georgia, serif; color: var(--ink2); max-width: 62px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-ui .hv-char:hover .pt { transform: translateY(-2px); }
.hv-ui .hv-char.on .pt { width: 54px; height: 54px; box-shadow: 0 0 0 2px var(--gold), 0 0 0 3.5px rgba(255,248,230,.9), 0 0 0 4.5px rgba(116,86,30,.6), 0 2px 5px rgba(40,26,10,.4); }
.hv-ui .hv-char.on .nm { font-weight: 600; color: var(--ink); }
.hv-ui .hv-char .st { position: absolute; top: -2px; right: -4px; width: 17px; height: 17px; border-radius: 50%; background: var(--paper); display: grid; place-items: center;
  box-shadow: 0 0 0 1px rgba(90,68,40,.55); color: var(--ink2); }
.hv-ui .hv-char .st .hv-ic { width: 12px; height: 12px; }
.hv-ui .hv-chars .tab { align-self: center; display: flex; flex-direction: column; align-items: center; gap: 3px; padding-left: 8px; margin-left: 2px;
  border-left: 1px solid rgba(116,96,63,.3); font: italic 10.5px Georgia, serif; color: var(--ink2); }

/* ---------- toasts ---------- */
.hv-ui .hv-toasts { position: absolute; right: 14px; top: 262px; transition: width .2s; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; width: 330px; pointer-events: none; }
.hv-ui .hv-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; max-width: 100%; padding: 9px 14px 9px 10px; font-size: 13px;
  opacity: 0; transform: translateX(24px); transition: opacity .3s, transform .35s cubic-bezier(.2,.9,.3,1.2); }
.hv-ui .hv-toast.on { opacity: 1; transform: none; }
.hv-ui .hv-toast.out { opacity: 0; transform: translateX(16px); transition: opacity .4s, transform .4s; }
.hv-ui .hv-toast::before { content: ''; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px; border-radius: 0 2px 2px 0; background: var(--kc, var(--ink2)); }
.hv-ui .hv-toast .ti { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--kc, var(--ink2));
  background: rgba(255,250,236,.8); box-shadow: inset 0 0 0 1px currentColor; margin-left: 2px; }
.hv-ui .hv-toast .ti .hv-ic { width: 17px; height: 17px; }
.hv-ui .hv-toast .tx { padding-top: 3px; line-height: 1.35; }
.hv-ui .hv-toast .tx b { font: 600 13.5px Georgia, serif; }
.hv-ui .hv-toast.info { --kc: #4a6479; } .hv-ui .hv-toast.money { --kc: #9a6c16; } .hv-ui .hv-toast.warn { --kc: var(--accent2); }
.hv-ui .hv-toast.error { --kc: var(--danger); } .hv-ui .hv-toast.success { --kc: var(--accent); }

/* ---------- world labels ---------- */
.hv-ui .hv-labels { position: absolute; inset: 0; pointer-events: none; }
.hv-ui .hv-wl { position: absolute; left: 0; top: 0; will-change: transform; pointer-events: none; transition: opacity .25s; }
.hv-ui .hv-wl.hid { opacity: 0; }
.hv-ui .hv-wl .b { transform: translate(-50%, calc(-100% - 9px)); display: flex; align-items: center; gap: 6px; white-space: nowrap; padding: 3px 10px 3px 7px;
  border-radius: 12px; font: 12.5px Georgia, serif; color: var(--ink); background: rgba(243,234,214,.94);
  box-shadow: 0 0 0 1px rgba(116,96,63,.6), 0 2px 5px rgba(30,20,8,.3); position: relative; }
.hv-ui .hv-wl .b::after { content: ''; position: absolute; left: 50%; bottom: -5px; width: 8px; height: 8px; margin-left: -4px; transform: rotate(45deg);
  background: inherit; box-shadow: 1px 1px 0 rgba(116,96,63,.6); }
.hv-ui .hv-wl .b .hv-ic { width: 15px; height: 15px; }
.hv-ui .hv-wl .dot { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 1.5px rgba(243,234,214,.9); }
.hv-ui .hv-wl.field .b .hv-ic { color: var(--accent); } .hv-ui .hv-wl.sell .b .hv-ic { color: #9a6c16; }
.hv-ui .hv-wl.warn .b { color: #7a2a22; } .hv-ui .hv-wl.warn .b .hv-ic { color: var(--danger); }
.hv-ui .hv-wl.job .b .hv-ic { color: var(--accent2); }

/* ---------- panel ---------- */
.hv-ui .hv-panelwrap { position: absolute; left: 50%; top: 118px; transform: translateX(-50%); width: min(700px, 94vw); pointer-events: none;
  opacity: 0; transition: opacity .18s, transform .22s; }
.hv-ui .hv-panelwrap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
.hv-ui .hv-panelwrap:not(.on) { transform: translateX(-50%) translateY(10px); }
.hv-ui .hv-tabs { display: flex; gap: 3px; padding: 0 14px; position: relative; z-index: 1; margin-bottom: -1px; }
.hv-ui .hv-tabs button { all: unset; cursor: pointer; pointer-events: auto; display: flex; align-items: center; gap: 6px; padding: 6px 12px 7px; font: 12.5px Georgia, serif; color: var(--ink2);
  background-color: var(--paper2); background-image: var(--tex); background-blend-mode: multiply; border: 1px solid var(--border); border-bottom: 0; border-radius: 7px 7px 0 0;
  box-shadow: inset 0 1px 0 rgba(255,250,236,.6), 0 -1px 4px rgba(40,26,10,.12); transform: translateY(3px); transition: transform .12s; }
.hv-ui .hv-tabs button .hv-ic { width: 16px; height: 16px; }
.hv-ui .hv-tabs button:hover { transform: translateY(1px); color: var(--ink); }
.hv-ui .hv-tabs button.on { background-color: var(--paper); color: var(--ink); font-weight: 600; transform: none; padding-bottom: 9px; }
.hv-ui .hv-panel { pointer-events: auto; display: flex; flex-direction: column; max-height: var(--hv-pmax, calc(100vh - 118px - 170px)); }
.hv-ui .hv-panel .hd { display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px 18px; border-bottom: 1px solid rgba(116,96,63,.35);
  box-shadow: 0 1px 0 rgba(255,250,236,.7); }
.hv-ui .hv-panel .hd .pi { color: var(--accent); } .hv-ui .hv-panel .hd .pi .hv-ic { width: 26px; height: 26px; }
.hv-ui .hv-panel .hd h2 { margin: 0; font: 600 21px/1.1 Georgia, serif; letter-spacing: .01em; flex: 1; }
.hv-ui .hv-panel .hd .sub { font: italic 12.5px Georgia, serif; color: var(--ink2); font-weight: 400; margin-left: 8px; }
.hv-ui .hv-x { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; color: var(--ink2); font-size: 11px; padding: 3px 4px 3px 8px; border-radius: 5px; }
.hv-ui .hv-x:hover { color: var(--ink); background: rgba(116,96,63,.12); }
.hv-ui .hv-x .hv-ic { width: 18px; height: 18px; stroke-width: 1.8; }
.hv-ui .hv-panel .bd { padding: 14px 18px 18px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: rgba(116,96,63,.55) transparent; }
.hv-ui .hv-panel .bd::-webkit-scrollbar { width: 8px; } .hv-ui .hv-panel .bd::-webkit-scrollbar-thumb { background: rgba(116,96,63,.45); border-radius: 4px; }

/* ---------- panel content kit ---------- */
.hv-ui h3 { margin: 16px 0 7px; font: 600 12px 'Segoe UI', system-ui, sans-serif; letter-spacing: .13em; text-transform: uppercase; color: var(--ink2);
  display: flex; align-items: center; gap: 8px; }
.hv-ui h3::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(116,96,63,.45), rgba(116,96,63,0)); }
.hv-ui h3:first-child { margin-top: 0; }
.hv-ui .hv-stats { display: flex; gap: 10px; }
.hv-ui .hv-stat { flex: 1; padding: 8px 12px; border-radius: 6px; background: rgba(255,250,236,.55); box-shadow: inset 0 0 0 1px rgba(116,96,63,.28); }
.hv-ui .hv-stat .k { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink2); display: flex; align-items: center; gap: 5px; }
.hv-ui .hv-stat .k .hv-ic { width: 14px; height: 14px; }
.hv-ui .hv-stat .v { font: 600 20px/1.25 Georgia, serif; white-space: nowrap; }
.hv-ui .hv-stat .s { font-size: 11.5px; color: var(--ink2); }
.hv-ui .pos { color: #3a6634; } .hv-ui .neg { color: var(--danger); } .hv-ui .muted { color: var(--ink2); } .hv-ui .faint { color: var(--ink3); }
.hv-ui .hv-rows { display: flex; flex-direction: column; }
.hv-ui .hv-row { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-bottom: 1px dotted rgba(116,96,63,.4); min-height: 34px; }
.hv-ui .hv-row:last-child { border-bottom: 0; }
.hv-ui .hv-row .grow { flex: 1; min-width: 0; }
.hv-ui .hv-row .ttl { font: 14px Georgia, serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-ui .hv-row .meta { font-size: 11.5px; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-ui .hv-row .num { font: 600 14px Georgia, serif; white-space: nowrap; text-align: right; }
.hv-ui .hv-row .ico { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex: none; background: rgba(255,250,236,.7);
  box-shadow: inset 0 0 0 1px rgba(116,96,63,.35); color: var(--ink); }
.hv-ui .hv-row .ico .hv-ic { width: 19px; height: 19px; }
.hv-ui .hv-row.sel { background: rgba(63,107,58,.09); box-shadow: inset 3px 0 0 var(--accent); }
.hv-ui .hv-row.click { cursor: pointer; } .hv-ui .hv-row.click:hover { background: rgba(116,96,63,.08); }
.hv-ui .date { font: italic 12px Georgia, serif; color: var(--ink2); width: 46px; flex: none; }
.hv-ui .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 9px; font-size: 11px; white-space: nowrap;
  background: rgba(116,96,63,.12); color: var(--ink2); box-shadow: inset 0 0 0 1px rgba(116,96,63,.25); }
.hv-ui .chip .hv-ic { width: 12px; height: 12px; }
.hv-ui .chip.owned { background: rgba(63,107,58,.14); color: #2f5a2b; box-shadow: inset 0 0 0 1px rgba(63,107,58,.4); }
.hv-ui .chip.rented { background: rgba(201,154,46,.16); color: #7a5a14; box-shadow: inset 0 0 0 1px rgba(201,154,46,.5); }
.hv-ui .chip.forSale { background: rgba(184,101,46,.12); color: #8a4a1e; box-shadow: inset 0 0 0 1px rgba(184,101,46,.45); }
.hv-ui .chip.warn { background: rgba(168,57,47,.1); color: var(--danger); box-shadow: inset 0 0 0 1px rgba(168,57,47,.4); }
.hv-ui .hv-btn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px;
  border-radius: 5px; font: 600 12px 'Segoe UI', system-ui, sans-serif; color: var(--ink); white-space: nowrap;
  background: linear-gradient(#fbf6ea, #eadcbc); box-shadow: inset 0 0 0 1px rgba(116,96,63,.6), 0 1px 0 rgba(90,68,40,.4); }
.hv-ui .hv-btn .hv-ic { width: 15px; height: 15px; }
.hv-ui .hv-btn:hover { background: linear-gradient(#fffaf0, #f0e4c8); }
.hv-ui .hv-btn:active { transform: translateY(1px); box-shadow: inset 0 0 0 1px rgba(116,96,63,.6); }
.hv-ui .hv-btn.pri { color: #f6efdc; background: linear-gradient(#4f7f48, #3a6334); box-shadow: inset 0 0 0 1px #2c4c27, inset 0 1px 0 rgba(255,255,255,.2), 0 1px 0 rgba(30,50,20,.5); }
.hv-ui .hv-btn.pri:hover { background: linear-gradient(#5a8c52, #41703a); }
.hv-ui .hv-btn.warm { color: #fbf1df; background: linear-gradient(#c7773c, #a65a26); box-shadow: inset 0 0 0 1px #7e4219, inset 0 1px 0 rgba(255,255,255,.2), 0 1px 0 rgba(80,40,10,.5); }
.hv-ui .hv-btn[disabled], .hv-ui .hv-btn.dis { cursor: default; opacity: .45; filter: saturate(.3); transform: none; }
.hv-ui .hv-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 6px; background: rgba(116,96,63,.12); }
.hv-ui .hv-seg button { all: unset; cursor: pointer; padding: 3px 11px; border-radius: 4px; font: 12.5px Georgia, serif; color: var(--ink2); }
.hv-ui .hv-seg button.on { background: var(--paper); color: var(--ink); box-shadow: 0 0 0 1px rgba(116,96,63,.5); }
.hv-ui .hv-seg button .c { font: 600 10.5px 'Segoe UI', sans-serif; color: var(--ink3); margin-left: 3px; }
.hv-ui .hv-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 26px 20px; color: var(--ink2); }
.hv-ui .hv-empty .hv-ic { width: 46px; height: 46px; color: var(--ink3); stroke-width: 1.2; }
.hv-ui .hv-empty b { font: 600 15px Georgia, serif; color: var(--ink); }
.hv-ui .hv-empty span { font: italic 13px Georgia, serif; max-width: 360px; }
.hv-ui .hv-bar { height: 7px; border-radius: 4px; background: rgba(116,96,63,.16); box-shadow: inset 0 1px 1px rgba(80,60,30,.2); overflow: hidden; }
.hv-ui .hv-bar i { display: block; height: 100%; border-radius: 4px; background: repeating-linear-gradient(-45deg, #5a8a4e 0 5px, #4d7a43 5px 10px); }
.hv-ui svg.chart { display: block; width: 100%; overflow: visible; }
.hv-ui svg.chart text { font: 10.5px 'Segoe UI', system-ui, sans-serif; fill: var(--ink2); }
.hv-ui .spark { width: 92px; height: 26px; display: block; overflow: visible; }

/* market */
.hv-ui .hv-mkt { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 22px; }
.hv-ui .hv-mkt .hv-row { gap: 8px; }
.hv-ui .hv-mkt .hv-row:last-child { border-bottom: 1px dotted rgba(116,96,63,.4); }
.hv-ui .hv-mkt .meta b { color: var(--ink); font-weight: 600; }
.hv-ui .hv-mkt .spark { width: 56px; height: 24px; }
.hv-ui .hv-mkt .meta .hv-ic { width: 12px; height: 12px; color: #9a6c16; }
.hv-ui .hv-mkt .ttl { display: flex; align-items: center; gap: 6px; }
.hv-ui .hv-mkt .hv-row .ico .hv-ic { width: 21px; height: 21px; }

/* jobs */
.hv-ui .hv-jobs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.hv-ui .hv-job { position: relative; padding: 13px 13px 11px; border-radius: 3px; background-color: var(--note, #f8f1df); background-image: var(--tex); background-blend-mode: multiply;
  box-shadow: 0 0 0 1px rgba(116,96,63,.35), 0 2px 4px rgba(40,26,10,.18); display: flex; flex-direction: column; gap: 6px; }
.hv-ui .hv-job:nth-child(3n+1) { transform: rotate(-.5deg); } .hv-ui .hv-job:nth-child(3n+2) { transform: rotate(.45deg); }
.hv-ui .hv-job::before { content: ''; position: absolute; top: -5px; left: 50%; width: 11px; height: 11px; margin-left: -5px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e38a6a, #a8392f 70%); box-shadow: 0 1.5px 2px rgba(40,20,10,.45); }
.hv-ui .hv-job .top { display: flex; align-items: center; gap: 8px; }
.hv-ui .hv-job .top .ico { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: rgba(184,101,46,.12); color: #8a4a1e; flex: none; }
.hv-ui .hv-job .top .ico .hv-ic { width: 18px; height: 18px; }
.hv-ui .hv-job .kind { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink2); flex: 1; }
.hv-ui .hv-job .ttl { font: 600 15px/1.25 Georgia, serif; }
.hv-ui .hv-job .who { font: italic 12.5px Georgia, serif; color: var(--ink2); display: flex; align-items: center; gap: 5px; }
.hv-ui .hv-job .who .hv-ic { width: 14px; height: 14px; }
.hv-ui .hv-job .foot { display: flex; align-items: center; gap: 8px; margin-top: 3px; padding-top: 7px; border-top: 1px dashed rgba(116,96,63,.4); }
.hv-ui .hv-job .pay { font: 600 18px Georgia, serif; color: #2f5a2b; flex: 1; }
.hv-ui .hv-job .due { font-size: 11.5px; color: var(--ink2); }
.hv-ui .hv-job .due.soon { color: var(--danger); font-weight: 600; }
.hv-ui .hv-job.done { opacity: .75; } .hv-ui .hv-job.done::after { content: attr(data-stamp); position: absolute; right: 12px; top: 38px; transform: rotate(-12deg);
  font: 700 15px Georgia, serif; letter-spacing: .12em; color: rgba(63,107,58,.8); border: 2px solid rgba(63,107,58,.7); border-radius: 4px; padding: 1px 7px; }
.hv-ui .hv-job.failed::after { color: rgba(168,57,47,.8); border-color: rgba(168,57,47,.7); }

/* land */
.hv-ui .hv-land { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
.hv-ui .hv-landmap { border-radius: 5px; background: #efe3c6; box-shadow: inset 0 0 0 1px rgba(116,96,63,.45); padding: 6px; align-self: start; }
.hv-ui .hv-landmap svg { display: block; width: 100%; height: auto; }
.hv-ui .hv-landmap svg text { font: italic 10px Georgia, serif; fill: var(--ink); paint-order: stroke; stroke: rgba(243,234,214,.8); stroke-width: 2.5px; }
.hv-ui .hv-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; font-size: 11px; color: var(--ink2); }
.hv-ui .hv-legend i { display: inline-block; width: 12px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; box-shadow: inset 0 0 0 1px rgba(60,40,20,.45); }
.hv-ui .stars { color: var(--gold); display: inline-flex; } .hv-ui .stars .hv-ic { width: 11px; height: 11px; }
.hv-ui .stars .off { color: rgba(116,96,63,.35); }

/* help */
.hv-ui .hv-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 26px; }
.hv-ui .hv-keys .hv-row { min-height: 30px; padding: 4px 2px; }
.hv-ui .hv-keys .kcs { display: flex; gap: 3px; width: 118px; flex: none; }

/* ---------- modal ---------- */
.hv-ui .hv-modal { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(28,20,10,.32); pointer-events: auto; opacity: 0; transition: opacity .18s; }
.hv-ui .hv-modal.on { opacity: 1; }
.hv-ui .hv-dialog { width: min(400px, 90vw); padding: 18px 20px 16px; transform: translateY(8px); transition: transform .2s; }
.hv-ui .hv-modal.on .hv-dialog { transform: none; }
.hv-ui .hv-dialog h2 { margin: 0 0 8px; font: 600 19px Georgia, serif; display: flex; align-items: center; gap: 9px; }
.hv-ui .hv-dialog h2 .hv-ic { color: var(--accent2); width: 24px; height: 24px; }
.hv-ui .hv-dialog p { margin: 0 0 16px; font: 14px/1.45 Georgia, serif; color: var(--ink2); }
.hv-ui .hv-dialog .btns { display: flex; justify-content: flex-end; gap: 8px; }
.hv-ui .hv-dialog .hv-btn { height: 32px; padding: 0 16px; font-size: 12.5px; }
`;
}
