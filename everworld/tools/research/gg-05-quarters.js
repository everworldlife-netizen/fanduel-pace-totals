#!/usr/bin/env node
/* GG League at the quarter breaks (the clock is known exactly there): how should the score so far move the number?
 * 773 games with quarter scores; the pregame number comes from the walk-forward ratings (data/eb/wf-rows.json).
 *   node tools/research/gg-05-quarters.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const Q = JSON.parse(fs.readFileSync(path.join(L.ROOT, 'gg/static/seed/seed-quarters.json'), 'utf8'));
const WF = new Map(JSON.parse(fs.readFileSync(path.join(L.DATA, 'eb', 'wf-rows.json'), 'utf8')).map((r) => [r.id, r]));
const rows = [];
for (const [id, q] of Object.entries(Q)) { const w = WF.get(id); if (!w || !Array.isArray(q) || q.length !== 8) continue; const qt = [q[0] + q[1], q[2] + q[3], q[4] + q[5], q[6] + q[7]]; const reg = qt[0] + qt[1] + qt[2] + qt[3]; rows.push({ id, t: w.t, E: w.pred, fin: w.act, qt, reg, ot: w.act - reg }); }
rows.sort((a, b) => a.t - b.t);
console.log(`${rows.length} games with quarter scores and a walk-forward pregame number (${new Date(rows[0].t).toISOString().slice(0, 10)} to ${new Date(rows[rows.length - 1].t).toISOString().slice(0, 10)})`);
const share = [0, 1, 2, 3].map((i) => mean(rows.map((r) => r.qt[i])) / mean(rows.map((r) => r.reg)));
console.log(`share of regulation points by quarter: ${share.map((x) => x.toFixed(4)).join(' ')}; games that went past regulation: ${rows.filter((r) => r.ot > 0).length} (${(100 * rows.filter((r) => r.ot > 0).length / rows.length).toFixed(1)}%), adding ${mean(rows.map((r) => r.ot)).toFixed(2)} points a game on average`);
const QS = [0.2546, 0.2467, 0.2425, 0.2486], QSUM = QS.reduce((a, b) => a + b, 0), N0 = 6;
const K = (a, b) => { let r = 0; for (let q = 0; q < 4; q++) { const lo = q / 4, hi = (q + 1) / 4, u = Math.max(0, Math.min(b, hi) - Math.max(a, lo)); r += QS[q] * (u / 0.25); } return r / QSUM; };
const cut = Math.floor(rows.length * 0.6), FIT = rows.slice(0, cut), TEST = rows.slice(cut);
console.log(`fit on the first ${FIT.length} games, checked on the last ${TEST.length}\n`);
for (const nq of [1, 2, 3]) {
  const f = nq / 4, S = (r) => r.qt.slice(0, nq).reduce((a, b) => a + b, 0);
  const server = (r) => S(r) + ((N0 * r.E + S(r)) / (N0 + K(0, f))) * K(f, 1);
  // line: points still to come = a x (pregame number x share left) + b x (score so far - pregame number x share so far)
  const X = (r) => [r.E * (1 - f), S(r) - r.E * f], Y = (r) => r.fin - S(r);
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0; for (const r of FIT) { const [x1, x2] = X(r), y = Y(r); s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; t1 += x1 * y; t2 += x2 * y; }
  const det = s11 * s22 - s12 * s12, a = (t1 * s22 - t2 * s12) / det, b = (t2 * s11 - t1 * s12) / det;
  const fitted = (r) => S(r) + a * X(r)[0] + b * X(r)[1];
  const m = (R, fn) => mean(R.map((r) => Math.abs(fn(r) - r.fin))), bi = (R, fn) => mean(R.map((r) => fn(r) - r.fin));
  console.log(`after ${nq} quarter${nq > 1 ? 's' : ''}: fitted line: points to come = ${a.toFixed(3)} x (pregame x share left) + ${b.toFixed(3)} x (score so far - pregame x share so far)`);
  console.log(`   on the check games: pregame number alone ${m(TEST, (r) => r.E).toFixed(3)} | server formula ${m(TEST, server).toFixed(3)} (bias ${bi(TEST, server).toFixed(2)}) | fitted line ${m(TEST, fitted).toFixed(3)} (bias ${bi(TEST, fitted).toFixed(2)}) | score so far at the same pace ${m(TEST, (r) => S(r) / f).toFixed(3)}`);
  for (const bb of [0, 0.1, 0.2, 0.3, 0.4]) process.stdout.write(`   b=${bb}: ${m(TEST, (r) => S(r) + X(r)[0] + bb * X(r)[1]).toFixed(3)}`); console.log('  (a fixed at 1)');
}
