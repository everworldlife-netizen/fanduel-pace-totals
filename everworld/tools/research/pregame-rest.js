'use strict';
// The engine's number = plain minutes x learned factor + what comes after (refill, team scaling, overtime). Which part misses?
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  console.log(`\n${g} ${season}: after-the-layer part (mn - plain x factor): mean ${C.mean(rs.map((r) => r.rest)).toFixed(2)} sd ${C.sd(rs.map((r) => r.rest)).toFixed(2)}; learned part: mean ${C.mean(rs.map((r) => r.lin)).toFixed(2)} sd ${C.sd(rs.map((r) => r.lin)).toFixed(2)}`);
  for (const [nm, rf] of [['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
    const cuts = [-0.5, 0.3, 0.8, 1.5, 2.5, 4, 6];
    const line = [];
    for (let i = 0; i <= cuts.length; i++) {
      const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
      const q = rs.filter((r) => rf(r) && r.rest >= lo && r.rest < hi);
      if (q.length < 20) { line.push('-'.padEnd(22)); continue; }
      const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id));
      line.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)}) n${q.length}`.padEnd(22));
    }
    console.log(`  ${nm.padEnd(9)} gap by after-part bin: ` + line.join(''));
  }
  console.log('            bins:                  ' + ['..-0.5', '-0.5..0.3', '0.3..0.8', '0.8..1.5', '1.5..2.5', '2.5..4', '4..6', '6..'].map((s) => s.padEnd(22)).join(''));
  const y = rs.map((r) => r.gap), cl = rs.map((r) => r.id);
  const m = C.ols(y, rs.map((r) => [1, r.st === 1 ? 1 : 0, r.rest, r.lin]), cl);
  console.log(`  gap ~ 1 + starter + after-part + learned-part: after ${m.beta[2].toFixed(3)} (z ${m.z[2].toFixed(1)})  learned ${m.beta[3].toFixed(3)} (z ${m.z[3].toFixed(1)})`);
  // sample: the team's whole after-part
  const tg = {}; for (const r of S.rows.filter((x) => x.g === g)) { const t = tg[r.tgk] = tg[r.tgk] || { rest: 0, mp: 0, mn: 0, n: 0, out: r.f.outTot || 0 }; t.rest += r.rest; t.mp += r.mp; t.mn += r.mn[0]; t.n++; }
  const T = Object.values(tg);
  console.log(`  per team-game: sum plain ${C.mean(T.map((t) => t.mp)).toFixed(1)}, sum engine ${C.mean(T.map((t) => t.mn)).toFixed(1)}, sum after-part ${C.mean(T.map((t) => t.rest)).toFixed(1)} (sd ${C.sd(T.map((t) => t.rest)).toFixed(1)}), players ${C.mean(T.map((t) => t.n)).toFixed(1)}`);
}
