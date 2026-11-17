#!/usr/bin/env node
/* How much of the middle should the shown number hold, by stage and stat? (refit on box scores that count every three)
 *   node tools/research/v18-04-land.js <fit rows> <check rows> [<check rows> ...]
 * shown = max(what he has, (1 - w) x plain average + w x middle of the simulations). Average miss for players with 10+ real
 * minutes (the app's grading rule). The weight is chosen on the first file and checked on the others.
 */
'use strict';
const path = require('path');
const L = require('../lib');
// the table in the engine being studied (read from its source: it is not exported)
const src = require('fs').readFileSync(path.join(L.ROOT, process.env.ENGINE || 'data/engines/v17b/engine.js'), 'utf8');
const E = { LAND: Function(`return (${/^const LAND = (\{[\s\S]*?\});/m.exec(src)[1]})`)() };
const load = (f) => L.readJSON(path.resolve(f)).filter((r) => !r.un && r.ac && r.ac[0] >= 10 && r.md);
const st = (r) => `${r.g === 'rep' ? 'rep' : r.el}`;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const K = ['pts', 'reb', 'ast', 'fg3m'];
const W = [0, 0.25, 0.5, 0.75, 1];
const sets = process.argv.slice(2).map((f) => ({ name: path.basename(f).replace('.rows.json.gz', ''), rows: load(f) }));
const mae = (R, i, w) => mean(R.map((r) => Math.abs(Math.max(r.now[i + 1], (1 - w) * r.mn[i + 1] + w * r.md[i]) - r.ac[i + 1])));
const cur = (s, k) => { const g = s === 'rep' ? 'rep' : s === '0' ? 'pre' : `s${Math.min(42, Math.max(6, Math.round(+s / 6) * 6))}`; return (E.LAND && E.LAND[g] && E.LAND[g][k]) || 0; };
if (!E.LAND) console.log('(engine does not export LAND: "now" column shows 0)');
for (const s of [...new Set(sets[0].rows.map(st))]) {
  console.log(`\nstage ${s}`);
  for (let i = 0; i < 4; i++) {
    const k = K[i];
    const line = [];
    let best = null;
    for (const S of sets) {
      const R = S.rows.filter((r) => st(r) === s); if (!R.length) { line.push(`${S.name}: -`); continue; }
      const m = W.map((w) => mae(R, i, w));
      if (!best) { best = W[m.indexOf(Math.min(...m))]; }
      const c = cur(s, k);
      line.push(`${S.name} (${R.length}): ` + W.map((w, j) => `${w === c ? '[' : ''}${m[j].toFixed(4)}${w === c ? ']' : ''}`).join(' ') + ` | best on fit set ${best}: ${((mae(R, i, best) / mae(R, i, c) - 1) * 100).toFixed(2)}%`);
    }
    console.log(`  ${k.padEnd(4)} w=0 .25 .5 .75 1 → ` + line.join('\n                         '));
  }
}
