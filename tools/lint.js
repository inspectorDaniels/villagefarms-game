// Determinism + ownership lint. `node tools/lint.js [module]`
// - forbids Math.random / Date.now / new Date( / performance.now in src/modules (use ctx.rng / ctx.clock)
// - forbids imports from another module's folder (use ctx.modules.get)
// - forbids external URLs (asset policy: no network)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'src', 'modules');
const only = process.argv[2];
const RULES = [
  [/Math\.random\s*\(/, 'Math.random is forbidden — use ctx.rng(stream)'],
  [/Date\.now\s*\(/, 'Date.now is forbidden — use ctx.clock'],
  [/new Date\s*\(/, 'new Date() is forbidden — use ctx.clock'],
  [/performance\.now\s*\(/, 'performance.now is forbidden in modules (core measures timings)'],
  [/https?:\/\/(?!localhost)/, 'external URL — asset policy forbids network assets'],
];
let problems = 0;
function walk(dir, mod) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p, mod); continue; }
    if (!p.endsWith('.js')) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const [re, msg] of RULES) if (re.test(line)) { problems++; console.log(`${path.relative(process.cwd(), p)}:${i + 1}  ${msg}`); }
      const imp = line.match(/import\s+.*from\s+['"]([^'"]+)['"]/) || line.match(/import\(\s*['"]([^'"]+)['"]/);
      if (imp) {
        const target = path.resolve(path.dirname(p), imp[1]);
        const rel = path.relative(root, target);
        const inCore = target.includes(path.join('src', 'core'));
        if (!rel.startsWith(mod + path.sep) && !rel.startsWith('..') && !inCore) { problems++; console.log(`${path.relative(process.cwd(), p)}:${i + 1}  imports another module's folder (${imp[1]}) — use ctx.modules.get()`); }
      }
    });
  }
}
for (const mod of fs.readdirSync(root)) {
  const d = path.join(root, mod);
  if (!fs.statSync(d).isDirectory()) continue;
  if (only && mod !== only) continue;
  walk(d, mod);
}
console.log(problems ? `${problems} problem(s)` : 'lint OK');
process.exit(problems ? 1 : 0);
