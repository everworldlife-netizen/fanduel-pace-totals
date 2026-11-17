'use strict';
// Mean gap (real - engine) in bins of a signal, by role, with cluster-robust z.  node pregame-bins.js <season> <expr> <cuts> [stage] [filter expr]
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const specs = process.argv.slice(3).join(' ').split(';;').map((s) => s.trim()).filter(Boolean);
for (const spec of specs) {
  const [expr, cutS, flt] = spec.split('@@').map((s) => s.trim());
  const fn = new Function('r', 'C', `const f = r.f; return (${expr});`);
  const ff = flt ? new Function('r', 'C', `const f = r.f; return (${flt});`) : () => true;
  const cuts = cutS.split(',').map(Number);
  for (const g of ['rep', 'pre']) {
    console.log(`\n${g} ${season}: gap by [${expr}]${flt ? ' where ' + flt : ''}`);
    for (const [nm, rf] of [['all', () => true], ['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
      const rs = S.rows.filter((r) => r.g === g && r.gap != null && rf(r) && ff(r, C));
      const line = [];
      for (let i = 0; i <= cuts.length; i++) {
        const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
        const q = rs.filter((r) => { const v = fn(r, C); return v != null && isFinite(v) && v >= lo && v < hi; });
        if (!q.length) { line.push('      -      '); continue; }
        const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id));
        line.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)}) n${q.length}`);
      }
      console.log(`  ${nm.padEnd(9)} ` + line.map((s) => s.padEnd(20)).join(''));
    }
    console.log('  bins:      ' + [-Infinity, ...cuts].map((c, i) => `${c === -Infinity ? '' : c}..${i < cuts.length ? cuts[i] : ''}`.padEnd(20)).join(''));
  }
}
