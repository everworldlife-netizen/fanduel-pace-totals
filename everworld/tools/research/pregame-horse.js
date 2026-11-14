'use strict';
// Horse race of simple minutes estimators at the two pregame stages: which ingredients does the real number follow?
const C = require('./pregame-common');
const S = C.prepare(+process.argv[2] || 2026);
const mae = (rs, f) => C.mean(rs.map((r) => Math.abs(r.ac[0] - f(r))));
for (const g of ['rep', 'pre']) {
  const all = S.rows.filter((r) => r.g === g && r.gap != null && !r.fr && r.f.seasonMpg != null && r.f.cleanMpg != null);
  const p10 = all.filter((r) => r.ac[0] >= 10);
  console.log(`\n${g}: ${all.length} played rows with history, ${p10.length} with 10+ real minutes`);
  console.log('  miss10: engine shown', mae(p10, (r) => r.pr[0]).toFixed(3), '| plain (before learned layer)', mae(p10, (r) => r.mp).toFixed(3), '| usual minutes mpg', mae(p10, (r) => r.mpg).toFixed(3), '| season mean', mae(p10, (r) => r.f.seasonMpg).toFixed(3),
    '| last-10 mean', mae(p10, (r) => r.f.l10Mpg).toFixed(3), '| half mpg half season', mae(p10, (r) => 0.5 * r.mpg + 0.5 * r.f.seasonMpg).toFixed(3), '| clean', mae(p10, (r) => r.f.cleanMpg).toFixed(3));
  for (const [nm, f] of [['all', () => true], ['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
    const rs = all.filter(f);
    const y = rs.map((r) => r.ac[0]), cl = rs.map((r) => r.id);
    const m1 = C.ols(y, rs.map((r) => [1, r.mn[0]]), cl);
    const m2 = C.ols(y, rs.map((r) => [1, r.mp, r.mpg, r.f.seasonMpg]), cl);
    const m3 = C.ols(y, rs.map((r) => [1, r.mn[0], r.mp, r.mpg, r.f.seasonMpg, r.f.l10Mpg, r.f.cleanMpg]), cl);
    console.log(`  ${nm.padEnd(8)} real ~ a + b*engine: a ${m1.beta[0].toFixed(2)} b ${m1.beta[1].toFixed(3)} (z vs 1: ${((m1.beta[1] - 1) / m1.se[1]).toFixed(1)})`);
    console.log(`           real ~ plain, mpg, season: ${m2.beta.slice(1).map((b, i) => b.toFixed(3) + ' (z ' + m2.z[i + 1].toFixed(1) + ')').join('  ')}`);
    console.log(`           real ~ engine, plain, mpg, season, last10, clean: ${m3.beta.slice(1).map((b, i) => b.toFixed(3) + ' (z ' + m3.z[i + 1].toFixed(1) + ')').join('  ')}`);
  }
  // how far the plain number sits from usual minutes, and what that difference is worth
  const d = all.map((r) => r.mp - r.mpg);
  console.log('  plain - mpg: mean', C.mean(d).toFixed(2), 'sd', C.sd(d).toFixed(2), '| mn - mp: mean', C.mean(all.map((r) => r.mn[0] - r.mp)).toFixed(2), 'sd', C.sd(all.map((r) => r.mn[0] - r.mp)).toFixed(2), '| season - mpg sd', C.sd(all.map((r) => r.f.seasonMpg - r.mpg)).toFixed(2));
}
