#!/usr/bin/env node
/* Where do the published numbers miss, and in which direction? (study of Nov 13, 2026)
 *   node tools/research/v18-01-bias.js <rows dump> [<run json>]
 * Rows: bt2 --dump. Per stage: the signed miss of every stat for players who played (shown number and plain average),
 * the slope of real on shown, and, with the run file and the prepared games, the game total against the book's line.
 */
'use strict';
const path = require('path');
const L = require('../lib');
const rows = L.readJSON(path.resolve(process.argv[2]));
const run = process.argv[3] ? L.readJSON(path.resolve(process.argv[3])) : null;
const STAGES = [...new Set(rows.map((r) => `${r.g === 'rep' ? 'rep' : r.el}`))];
const name = (s) => (s === 'rep' ? 'pre-lineup' : s === '0' ? 'tip-off' : `${s} min`);
const K = ['min', 'pts', 'reb', 'ast', '3pm'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const slope = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } return sxx ? sxy / sxx : NaN; };
console.log(`rows ${rows.length}, games ${new Set(rows.map((r) => r.id)).size}`);
console.log('\nSIGNED MISS (real minus number; + = the number was too low). Players who played at all and had a number. "avg" = plain average of the simulations, "shown" = what the app shows.');
console.log('stage        players |  MIN avg/shown  |  PTS avg/shown  |  REB avg/shown  |  AST avg/shown  |  3PM avg/shown  | to-come PTS: real / avg  ratio');
for (const s of STAGES) {
  const R = rows.filter((r) => !r.un && `${r.g === 'rep' ? 'rep' : r.el}` === s && r.ac && r.ac[0] > 0);
  if (!R.length) continue;
  const cells = K.map((k, i) => `${mean(R.map((r) => r.ac[i] - r.mn[i])).toFixed(2).padStart(6)} /${mean(R.map((r) => r.ac[i] - r.pr[i])).toFixed(2).padStart(6)} `);
  const tcReal = mean(R.map((r) => r.ac[1] - r.now[1])), tcAvg = mean(R.map((r) => r.mn[1] - r.now[1]));
  console.log(name(s).padEnd(11), String(R.length).padStart(7), '|', cells.join('| '), '|', tcReal.toFixed(2), '/', tcAvg.toFixed(2), ' ', (tcReal / tcAvg).toFixed(3));
}
console.log('\nSLOPE of real on shown (1 = right spread; below 1 = high numbers finish lower and low numbers higher), players who played, for what is still to come');
console.log('stage        |   MIN    PTS    REB    AST    3PM');
for (const s of STAGES) {
  const R = rows.filter((r) => !r.un && `${r.g === 'rep' ? 'rep' : r.el}` === s && r.ac && r.ac[0] > 0);
  if (!R.length) continue;
  console.log(name(s).padEnd(12), '|', K.map((k, i) => slope(R.map((r) => r.pr[i] - r.now[i]), R.map((r) => r.ac[i] - r.now[i])).toFixed(3).padStart(6)).join(' '));
}
// team level: all points of a team's players with a number (plain averages) against what those players really scored, and the points of players with no number
console.log('\nTEAM POINTS: sum of plain averages of the players with a number, against the real points of the whole team');
console.log('stage        teams | our sum   real team  miss   | of which: players with a number who never played were given | players with no number scored');
for (const s of STAGES) {
  const by = new Map();
  for (const r of rows) { if (`${r.un ? '' : r.g === 'rep' ? 'rep' : r.el}` !== s && !(r.un && `${r.el}` === s)) continue; const k = `${r.id}:${r.tm}`; const o = by.get(k) || { sum: 0, real: 0, ghost: 0, unp: 0 }; if (r.un) { o.real += r.ac[1]; o.unp += r.ac[1]; } else { o.sum += r.mn[1]; if (r.ac) o.real += r.ac[1]; else o.ghost += r.mn[1] - r.now[1]; } by.set(k, o); }
  const T = [...by.values()]; if (!T.length) continue;
  console.log(name(s).padEnd(11), String(T.length).padStart(6), '|', mean(T.map((t) => t.sum)).toFixed(1).padStart(6), mean(T.map((t) => t.real)).toFixed(1).padStart(10), mean(T.map((t) => t.sum - t.real)).toFixed(2).padStart(7), '  |', mean(T.map((t) => t.ghost)).toFixed(2).padStart(8), '                                                  |', mean(T.map((t) => t.unp)).toFixed(2));
}
if (run) {
  console.log('\nGAME TOTAL (the app\'s projected final, both teams): signed miss, average miss, the book line\'s miss, and the best mix of the two');
  console.log('stage        games | our bias  our miss | line miss | our number shifted by its bias | best mix: weight on the line, miss');
  const games = new Map();
  for (const season of [2026, 2027]) try { for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it); } catch { /* season not prepared */ }
  for (const [s, A] of Object.entries(run.acc)) {
    const G = [];
    for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || !it.market || !it.market.total) continue; const real = it.g.visitor_team_score + it.g.home_team_score; G.push({ ours: real + pg[17], line: it.market.total, real }); }
    if (!G.length) continue;
    const bias = mean(G.map((g) => g.ours - g.real));
    const miss = (f) => mean(G.map((g) => Math.abs(f(g) - g.real)));
    let best = [0, miss((g) => g.ours - bias)];
    for (let w = 0; w <= 1.0001; w += 0.1) { const m = miss((g) => (1 - w) * (g.ours - bias) + w * g.line); if (m < best[1] - 1e-9) best = [w, m]; }
    console.log(name(s).padEnd(11), String(G.length).padStart(6), '|', bias.toFixed(2).padStart(7), miss((g) => g.ours).toFixed(2).padStart(9), ' |', miss((g) => g.line).toFixed(2).padStart(8), ' |', miss((g) => g.ours - bias).toFixed(2).padStart(10), '                    |', best[0].toFixed(1), best[1].toFixed(2));
  }
}
