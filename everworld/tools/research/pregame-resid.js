#!/usr/bin/env node
/* Pregame research: mean of what is left of the gap AFTER the level model, in bins of a signal, by role.
 * Level model = refit of the engine's learned inputs (times plain minutes) + role dummies + the accepted level signals.
 *   node tools/research/pregame-resid.js <season> "<expr> @@ cut,cut,... [@@ filter]" ;; ...     (r = row, f = r.f)
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const CAND = require('./pregame-cands')(season);
const LEVEL = (process.env.LEVEL || 'rest,moveBack,longGap5,l10Mpg-mpg,q4-quarter').split(',');
const specs = process.argv.slice(3).join(' ').split(';;').map((s) => s.trim()).filter(Boolean);
const byStage = {};
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  const live = []; for (let j = 0; j < 49; j++) { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } if (j === 0 || b - a > 1e-9) live.push(j); }
  const X = rs.map((r) => { const a = [1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0]; for (const j of live) a.push((r.x[j] * r.mp) / 24); for (const k of LEVEL) { const v = CAND[k](r); a.push(v == null ? 0 : v); } return a; });
  const m = C.ols(rs.map((r) => r.gap), X, rs.map((r) => r.id), 1e-3);
  rs.forEach((r, i) => { let p = 0; for (let j = 0; j < X[i].length; j++) p += X[i][j] * m.beta[j]; r.res = r.gap - p; });
  byStage[g] = rs;
}
for (const spec of specs) {
  const [expr, cutS, flt] = spec.split('@@').map((s) => s.trim());
  const fn = new Function('r', 'C', `const f = r.f; return (${expr});`);
  const ff = flt ? new Function('r', 'C', `const f = r.f; return (${flt});`) : () => true;
  const cuts = cutS.split(',').map(Number);
  for (const g of ['rep', 'pre']) {
    console.log(`\n${g} ${season}: left-over gap by [${expr}]${flt ? ' where ' + flt : ''}`);
    for (const [nm, rf] of [['all', () => true], ['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
      const rs = byStage[g].filter((r) => rf(r) && ff(r, C));
      const line = [];
      for (let i = 0; i <= cuts.length; i++) {
        const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
        const q = rs.filter((r) => { const v = fn(r, C); return v != null && isFinite(v) && v >= lo && v < hi; });
        if (q.length < 15) { line.push('-'); continue; }
        const c = C.cmean(q.map((r) => r.res), q.map((r) => r.id));
        line.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)}) n${q.length}`);
      }
      console.log(`  ${nm.padEnd(9)} ` + line.map((s) => s.padEnd(21)).join(''));
    }
    console.log('  bins:     ' + [-Infinity, ...cuts].map((c, i) => `${c === -Infinity ? '' : c}..${i < cuts.length ? cuts[i] : ''}`.padEnd(21)).join(''));
  }
}
