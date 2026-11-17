#!/usr/bin/env node
/* Before and after, by stage: players (same graded population), game total, final margin, win chance.
 *   node tools/research/v18-11-result.js <before run> <after run>
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const [A, B] = process.argv.slice(2, 4).map((f) => L.readJSON(path.resolve(f)));
const lab = { rep: 'no lineup', 0: 'tip-off' };
console.log(`${path.basename(process.argv[2])} → ${path.basename(process.argv[3])}`);
console.log('stage      games |  PTS before → after     |  REB before → after     |  AST before → after     |  3PM            |  MIN            | total miss (book line) | final margin miss | win chance sq. miss (book)');
for (const s of Object.keys(A.acc)) {
  const a = A.acc[s], b = B.acc[s]; if (!b) continue;
  const ids = Object.keys(a.per).filter((id) => b.per[id]);
  const col = (X, n, d) => { let N = 0, S = 0; for (const id of ids) { N += X.per[id][d]; S += X.per[id][n]; } return S / N; };
  const pc = (x, y) => `${x.toFixed(3)} → ${y.toFixed(3)} (${((y / x - 1) * 100 >= 0 ? '+' : '') + ((y / x - 1) * 100).toFixed(2)}%)`;
  const gm = (X) => { const T = [], M = [], Br = [], Bk = [], Ln = []; for (const id of ids) { const it = games.get(+id), pg = X.per[id]; if (!it) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; T.push(Math.abs(pg[17])); M.push(Math.abs(pg[20] - (fv - fh))); Br.push((pg[21] - (fv > fh ? 1 : 0)) ** 2); if (it.market && it.market.pAway != null) Bk.push((it.market.pAway - (fv > fh ? 1 : 0)) ** 2); if (it.market && it.market.total) Ln.push(Math.abs(it.market.total - fv - fh)); } return { T: mean(T), M: mean(M), Br: mean(Br), Bk: mean(Bk), Ln: mean(Ln) }; };
  const ga = gm(a), gb = gm(b);
  console.log(String(lab[s] || s + ':00').padEnd(10), String(ids.length).padStart(5), '|', pc(col(a, 12, 11), col(b, 12, 11)), '|', pc(col(a, 14, 11), col(b, 14, 11)), '|', pc(col(a, 15, 11), col(b, 15, 11)), '|', `${col(a, 16, 11).toFixed(3)} → ${col(b, 16, 11).toFixed(3)}`, '|', `${col(a, 13, 11).toFixed(3)} → ${col(b, 13, 11).toFixed(3)}`, '|', `${ga.T.toFixed(2)} → ${gb.T.toFixed(2)} (${ga.Ln.toFixed(2)})`, '|', `${ga.M.toFixed(2)} → ${gb.M.toFixed(2)}`, '|', `${ga.Br.toFixed(4)} → ${gb.Br.toFixed(4)} (${ga.Bk.toFixed(4)})`);
}
