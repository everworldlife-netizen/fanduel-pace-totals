'use strict';
// sanity: does the rebuilt history match the engine's usual minutes and game counts?
const C = require('./pregame-common');
const t0 = Date.now();
const S = C.prepare(+process.argv[2] || 2026);
console.log('prepared in', Date.now() - t0, 'ms', S.rows.length, 'rows');
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g);
  let nn = 0, same = 0, d = 0, dn = 0, nof = 0, noTg = 0, negPid = 0, sTsame = 0, sTn = 0;
  for (const r of rs) {
    if (!r.f || r.f.n == null) { noTg++; continue; }
    if (r.pid < 0) negPid++;
    nn++; if (r.f.n === r.gms) same++;
    if (r.f.mpgRe != null && r.f.n === r.gms) { d += Math.abs(r.f.mpgRe - r.mpg); dn++; }
    if (r.f.n === 0) nof++;
    if (r.sT != null && r.f.sT != null) { sTn++; if (r.sT === r.f.sT) sTsame++; }
  }
  console.log(g, 'rows', rs.length, 'no team-game', noTg, 'neg pid', negPid, 'games count same', (same / nn).toFixed(3), 'mean |mpg diff| when same', (d / dn).toFixed(3), 'no window games', nof, 'sT agree', sTsame, '/', sTn);
  const ex = rs.filter((r) => r.f.n !== r.gms).slice(0, 6);
  for (const r of ex) console.log('   ', r.d, r.nm, r.tm, 'gms', r.gms, 'mine', r.f.n, 'teamN', r.f.teamN, 'mpg', r.mpg, 'mpgRe', r.f.mpgRe && r.f.mpgRe.toFixed(2), 'fr', r.fr, 'dp', r.dp);
}
const r = S.rows.find((x) => x.g === 'pre' && x.st === 1 && x.d > '2026-01-10');
console.log(JSON.stringify(r.f));
