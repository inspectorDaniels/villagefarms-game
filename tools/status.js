// Fold critic reviews (docs/reviews/<id>-r<N>.md) into docs/STATUS.json and print the queue,
// weakest module first.   node tools/status.js [--set id=status]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const statusPath = path.join(root, 'docs', 'STATUS.json');
const reviewsDir = path.join(root, 'docs', 'reviews');
const S = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') {
    const [id, st] = args[++i].split('=');
    if (S.modules[id]) S.modules[id].status = st;
  }
}

for (const f of fs.existsSync(reviewsDir) ? fs.readdirSync(reviewsDir) : []) {
  const m = f.match(/^(.+)-r(\d+)\.md$/);
  if (!m) continue;
  const [, id, n] = m;
  const text = fs.readFileSync(path.join(reviewsDir, f), 'utf8');
  const score = text.match(/Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const pass = text.match(/Pass:\s*(yes|no)/i);
  const mustFix = (text.split(/##\s*Must fix/i)[1] || '').split(/\n##\s/)[0]
    .split('\n').map((l) => l.trim()).filter((l) => /^(\d+\.|-|\*)\s+/.test(l)).map((l) => l.replace(/^(\d+\.|-|\*)\s+/, ''));
  const target = id === 'game' ? S.game : S.modules[id];
  if (!target) continue;
  const round = Number(n);
  const existing = target.rounds.find((r) => r.round === round);
  const rec = { round, score: score ? Number(score[1]) : null, pass: pass ? pass[1].toLowerCase() === 'yes' : false, review: `docs/reviews/${f}` };
  if (existing) Object.assign(existing, rec); else target.rounds.push(rec);
  target.rounds.sort((a, b) => a.round - b.round);
  const last = target.rounds[target.rounds.length - 1];
  if (last.round === round) {
    target.score = rec.score;
    target.pass = rec.pass;
    target.openIssues = mustFix.slice(0, 15);
    if (id !== 'game') target.status = rec.pass ? 'passing' : 'failing';
  }
}
S.updated = new Date().toISOString();
fs.writeFileSync(statusPath, JSON.stringify(S, null, 2));

const rows = Object.entries(S.modules).map(([id, m]) => ({ id, wave: m.wave, status: m.status, score: m.score, rounds: m.rounds.length, pass: m.pass }));
rows.sort((a, b) => (a.pass - b.pass) || ((a.score == null ? -1 : a.score) - (b.score == null ? -1 : b.score)) || a.wave - b.wave);
console.log('id           wave status     score rounds pass');
for (const r of rows) console.log(`${r.id.padEnd(12)} ${String(r.wave).padEnd(4)} ${String(r.status).padEnd(10)} ${String(r.score == null ? '-' : r.score).padEnd(5)} ${String(r.rounds).padEnd(6)} ${r.pass ? 'yes' : 'no'}`);
console.log(`game: score ${S.game.score == null ? '-' : S.game.score} pass ${S.game.pass ? 'yes' : 'no'}`);
