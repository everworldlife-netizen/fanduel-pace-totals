#!/usr/bin/env node
/* Pregame research: the additive constants by role that the learned layer cannot express (it multiplies plain minutes).
 * y = real - plain minutes ~ learned inputs x plain/24 (refit) + constants. Prints the constants, then what is left by
 * level of the plain number (is a finer additive shape needed?).   node tools/research/pregame-const.js [season]
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  const live = []; for (let j = 0; j < 49; j++) { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } if (j === 0 || b - a > 1e-9) live.push(j); }
  const y = rs.map((r) => r.ac[0] - r.mp - (g === 'rep' ? 0 : 0)), cl = rs.map((r) => r.id);
  const role = (r) => [1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0];
  const X = rs.map((r) => [...role(r), ...live.map((j) => (r.x[j] * r.mp) / 24)]);
  const m = C.ols(y, X, cl, 1e-3);
  console.log(`\n${g} ${season}: constants on top of the refit layer: all ${m.beta[0].toFixed(2)} (z ${m.z[0].toFixed(1)}), starters (24+ usual) ${m.beta[1].toFixed(2)} more (z ${m.z[1].toFixed(1)}), under 18 usual ${m.beta[2].toFixed(2)} more (z ${m.z[2].toFixed(1)})`);
  console.log(`   = add ${(m.beta[0] + m.beta[1]).toFixed(2)} minutes for a starter, ${m.beta[0].toFixed(2)} for an 18-24 player, ${(m.beta[0] + m.beta[2]).toFixed(2)} for an under-18 player; and the layer's own base factor becomes ${(m.beta[3] / 24 * 100).toFixed(1)}% of plain minutes`);
  // layer only (no constants), for comparison
  const mL = C.ols(y, X.map((x) => x.slice(3)), cl, 1e-3);
  const res = rs.map((r, i) => y[i] - X[i].reduce((s, v, j) => s + v * m.beta[j], 0)), resL = rs.map((r, i) => y[i] - X[i].slice(3).reduce((s, v, j) => s + v * mL.beta[j], 0));
  const cuts = [6, 10, 14, 18, 22, 26, 30, 33, 36];
  const line = (rr, label) => { const o = []; for (let i = 0; i <= cuts.length; i++) { const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity; const idx = rs.map((r, k) => k).filter((k) => rs[k].mp >= lo && rs[k].mp < hi); if (idx.length < 30) { o.push('-'); continue; } const c = C.cmean(idx.map((k) => rr[k]), idx.map((k) => cl[k])); o.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)})`); } console.log(`   ${label.padEnd(34)} ` + o.map((s) => s.padEnd(14)).join('')); };
  line(rs.map((r) => r.gap), 'gap of the engine as it is');
  line(resL, 'left after the layer refit');
  line(res, 'left after layer + constants');
  console.log('   ' + 'plain minutes:'.padEnd(34) + ' ' + ['<6', '6-10', '10-14', '14-18', '18-22', '22-26', '26-30', '30-33', '33-36', '36+'].map((s) => s.padEnd(14)).join(''));
}
