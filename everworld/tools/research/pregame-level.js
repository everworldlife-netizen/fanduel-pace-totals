#!/usr/bin/env node
/* Pregame research, part 1: the LEVEL of the minutes number. How should the engine's plain number, his usual minutes,
 * the close-games-only base, the season average and the learned correction be weighted? Joint regression of the gap
 * on the engine's learned inputs (refit, additive and times-plain-minutes) plus the level pieces; cluster = game.
 *   node tools/research/pregame-level.js [season]
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const hinge = (v, c) => Math.max(0, v - c);
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null && r.f.n >= 1);
  const y = rs.map((r) => r.gap), cl = rs.map((r) => r.id);
  const live = []; for (let j = 0; j < 49; j++) { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } if (j === 0 || b - a > 1e-9) live.push(j); }
  const ctl = (r, mult) => { const a = live.map((j) => r.x[j]); if (mult) for (const j of live) a.push((r.x[j] * r.mp) / 24); return a; };
  const pieces = {
    closeGap: (r) => r.f.closeAvg - r.f.regAvg, otGap: (r) => r.mpg - r.f.regAvg, fill: (r) => r.mp - r.f.closeAvg, seasonGap: (r) => (r.f.seasonMpg != null ? r.f.seasonMpg - r.mpg : 0),
    learned: (r) => r.mn[0] - r.mp, 'mn>34': (r) => hinge(r.mn[0], 34), 'mn<12': (r) => hinge(12, r.mn[0]),
  };
  const names = Object.keys(pieces);
  console.log(`\n=== ${g} ${season}: ${rs.length} player-games with recent games, ${new Set(cl).size} games`);
  for (const [nm, f] of [['all', () => true], ['starters', (r) => r.st === 1], ['others', (r) => r.st !== 1]]) {
    const idx = rs.map((r, i) => i).filter((i) => f(rs[i]));
    for (const mult of [0, 1]) {
      const X = idx.map((i) => [...ctl(rs[i], mult), ...names.map((k) => pieces[k](rs[i]))]);
      const m = C.ols(idx.map((i) => y[i]), X, idx.map((i) => cl[i]), 1e-3);
      const k0 = X[0].length - names.length;
      console.log(`  ${nm.padEnd(8)} ${mult ? 'x and x*plain' : 'x only      '} | ` + names.map((k, i) => `${k} ${m.beta[k0 + i].toFixed(2)} (${m.z[k0 + i].toFixed(1)})`).join('  '));
    }
  }
  // spread of each piece
  console.log('  sd of pieces: ' + names.map((k) => `${k} ${C.sd(rs.map((r) => pieces[k](r))).toFixed(2)}`).join('  '));
}
