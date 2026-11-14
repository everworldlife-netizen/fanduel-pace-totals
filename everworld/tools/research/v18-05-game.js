#!/usr/bin/env node
/* Game total, margin and win chance: ours against the book's closing line, and the best mix, by stage. (study of Nov 13, 2026)
 *   node tools/research/v18-05-game.js <run json> [<run json> ...]     (runs made after replay.js started keeping per[20..21])
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const name = (s) => (s === 'rep' ? 'pre-lineup' : s === '0' ? 'tip-off' : `${s} min`);
for (const f of process.argv.slice(2)) {
  const run = L.readJSON(path.resolve(f));
  console.log(`\n${path.basename(f)}`);
  console.log('stage       games | TOTAL ours (bias)  line   best w: miss | MARGIN ours  line   best w: miss | WIN CHANCE (Brier) ours  book  best w | winner picked: ours book');
  for (const [s, A] of Object.entries(run.acc)) {
    const G = [];
    for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || !it.market || it.market.total == null || it.market.spreadHome == null || pg[20] == null) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; G.push({ tot: fv + fh + pg[17], line: it.market.total, real: fv + fh, mar: pg[20], spr: it.market.spreadHome, rm: fv - fh, p: pg[21], pb: it.market.pAway, w: fv > fh ? 1 : 0 }); }
    if (!G.length) continue;
    const bias = mean(G.map((g) => g.tot - g.real));
    const best = (f2) => { let b = [0, f2(0)]; for (let w = 0.1; w <= 1.0001; w += 0.1) { const m = f2(w); if (m < b[1] - 1e-9) b = [w, m]; } return b; };
    const tB = best((w) => mean(G.map((g) => Math.abs((1 - w) * g.tot + w * g.line - g.real))));
    // the book's spread is the home team's line (negative = home favoured): visitor minus home expected = spreadHome
    const mB = best((w) => mean(G.map((g) => Math.abs((1 - w) * g.mar + w * g.spr - g.rm))));
    const Gp = G.filter((g) => g.pb != null);
    const pB = Gp.length ? best((w) => mean(Gp.map((g) => ((1 - w) * g.p + w * g.pb - g.w) ** 2))) : [NaN, NaN];
    console.log(name(s).padEnd(11), String(G.length).padStart(5), '|', mean(G.map((g) => Math.abs(g.tot - g.real))).toFixed(2).padStart(6), `(${bias.toFixed(2)})`.padStart(8), mean(G.map((g) => Math.abs(g.line - g.real))).toFixed(2).padStart(6), `  ${tB[0].toFixed(1)}: ${tB[1].toFixed(2)}`, '|', mean(G.map((g) => Math.abs(g.mar - g.rm))).toFixed(2).padStart(6), mean(G.map((g) => Math.abs(g.spr - g.rm))).toFixed(2).padStart(6), `  ${mB[0].toFixed(1)}: ${mB[1].toFixed(2)}`, '|', mean(Gp.map((g) => (g.p - g.w) ** 2)).toFixed(4).padStart(8), mean(Gp.map((g) => (g.pb - g.w) ** 2)).toFixed(4), ` ${pB[0].toFixed(1)}: ${pB[1].toFixed(4)}`, '|', (100 * mean(G.map((g) => ((g.mar > 0) === (g.rm > 0) ? 1 : 0)))).toFixed(0) + '%', (100 * mean(G.map((g) => ((g.spr > 0) === (g.rm > 0) ? 1 : 0)))).toFixed(0) + '%');
  }
}
