'use strict';
// Are a player's recent 4th-quarter minutes worth as much as his first-three-quarter minutes when predicting tonight?
// real minutes ~ a + b123 * (his recent Q1-Q3 average) + b4 * (his recent Q4 average), recent = the app's window, 0.85 recency weights.
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
for (const g of ['pre']) {
  for (const [nm, rf] of [['all', () => true], ['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
    const rs = S.rows.filter((r) => r.g === g && r.gap != null && r.f.n >= 3 && !r.fr && !r.dp && rf(r));
    const y = rs.map((r) => r.ac[0]), cl = rs.map((r) => r.id);
    const m = C.ols(y, rs.map((r) => [1, r.f.regAvg - r.f.q4w, r.f.q4w]), cl);
    const m2 = C.ols(y, rs.map((r) => [1, r.f.regAvg - r.f.q4w, r.f.q4wClose != null ? r.f.q4wClose : r.f.q4w, r.f.q4w - (r.f.q4wClose != null ? r.f.q4wClose : r.f.q4w)]), cl);
    console.log(`${g} ${season} ${nm.padEnd(8)} n ${rs.length}: real ~ ${m.beta[0].toFixed(2)} + ${m.beta[1].toFixed(3)} x Q1-3 avg (se ${m.se[1].toFixed(3)}) + ${m.beta[2].toFixed(3)} x Q4 avg (se ${m.se[2].toFixed(3)});  z of (b4 - b123/… ) difference: ${((m.beta[2] - m.beta[1]) / Math.sqrt(m.se[1] ** 2 + m.se[2] ** 2)).toFixed(1)}`);
    console.log(`     with Q4 split: Q1-3 ${m2.beta[1].toFixed(3)}, Q4 in close games ${m2.beta[2].toFixed(3)} (se ${m2.se[2].toFixed(3)}), extra Q4 in all games vs close ${m2.beta[3].toFixed(3)} (se ${m2.se[3].toFixed(3)})`);
  }
  // gap by Q4 share of his minutes
  const rs = S.rows.filter((r) => r.g === g && r.gap != null && r.f.n >= 3 && !r.fr && !r.dp && r.f.regAvg >= 8);
  for (const [nm, rf] of [['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
    const line = [];
    const cuts = [0.15, 0.19, 0.22, 0.25, 0.28, 0.32];
    for (let i = 0; i <= cuts.length; i++) { const lo = i ? cuts[i - 1] : -1, hi = i < cuts.length ? cuts[i] : 9; const q = rs.filter((r) => rf(r) && r.f.q4w / r.f.regAvg >= lo && r.f.q4w / r.f.regAvg < hi); if (q.length < 30) { line.push('-'.padEnd(21)); continue; } const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id)); line.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)}) n${q.length}`.padEnd(21)); }
    console.log(`  gap by Q4 share of usual minutes, ${nm.padEnd(8)}: ` + line.join(''));
  }
  console.log('                                  bins: <.15 | .15-.19 | .19-.22 | .22-.25 | .25-.28 | .28-.32 | .32+');
}
