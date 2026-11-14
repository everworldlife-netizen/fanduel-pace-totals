#!/usr/bin/env node
/* early-06: how much of the 6-minute problem is HOW the stage was taught (no new input at all)?
 * Fit the 49 existing inputs on the first half of 2026 (by date), test on the second half:
 *   engine      the number in the dump (lessons A4: s6/s12 taught on the incomplete 2023-25 games, everyone listed)
 *   refit-all   same 49 inputs, taught on complete games (first half of 2026), everyone listed (the engine's live rule)
 *   refit-play  same 49 inputs, taught on complete games, only players who played (the tip-off rule = the population graded)
 *   node tools/research/early-06-refit.js [s6|s12] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6';
const all = C.load('2026');
const dates = [...new Set(all.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const rows = Fx.prep(all, ST);
const H1 = rows.filter((q) => q.d < mid), H2 = rows.filter((q) => q.d >= mid);
console.log(`stage ${ST}: first half ${H1.length} rows (to ${mid}), second half ${H2.length} rows; games ${new Set(H1.map((q) => q.o.pre.id)).size} / ${new Set(H2.map((q) => q.o.pre.id)).size}`);
const bA = Fx.fit(H1, 'all'), bP = Fx.fit(H1, 'played');
const preds = { 'tip-off number': (q) => q.o.pre.mn[0], engine: (q) => q.eng, 'plain (no lessons)': (q) => q.now + q.rem, 'refit-all': (q) => Fx.predict(q, bA.beta), 'refit-play': (q) => Fx.predict(q, bP.beta) };
for (const [pn, pop] of Object.entries(Fx.POPS)) {
  console.log(`\n-- second half, population: ${pn} --`);
  for (const [name, p] of Object.entries(preds)) {
    const c = Fx.compare(H2, preds.engine, p, pop);
    let bias = 0, n = 0; for (const q of H2) if (pop(q)) { bias += q.ac - p(q); n++; }
    console.log(`  ${name.padEnd(20)} miss ${c.b.toFixed(3)}  vs engine ${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})  bias(real-number) ${(bias / n).toFixed(2)}`);
  }
}
// by class (10+)
console.log('\n-- second half, 10+ by class: tip-off / engine / refit-all / refit-play --');
const classes = { starters: (q) => q.o.pre.sT === 1, 'bench in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 0, 'bench not in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 1 };
for (const [cn, cf] of Object.entries(classes)) {
  const li = H2.filter((q) => cf(q) && q.ac >= 10); const m = (p) => (li.reduce((a, q) => a + Math.abs(p(q) - q.ac), 0) / li.length).toFixed(3);
  console.log(`  ${cn.padEnd(14)} n=${li.length}  ${m(preds['tip-off number'])} / ${m(preds.engine)} / ${m(preds['refit-all'])} / ${m(preds['refit-play'])}`);
}
const E = require('../../data/engines/final/engine.js'); const F = E.PAT_F;
const les = C.L.readJSON(`${C.L.ROOT}/data/lessons/A4-final.json`).PAT_PRIOR[ST].min.b;
console.log('\ncoefficients: engine lessons (A4) | refit-all | refit-play');
for (let i = 0; i < 49; i++) if (Math.abs(les[i]) > 0.02 || Math.abs(bA.beta[i]) > 0.02 || Math.abs(bP.beta[i]) > 0.02) console.log(`  ${F[i].padEnd(10)} ${les[i].toFixed(3).padStart(7)} | ${bA.beta[i].toFixed(3).padStart(7)} | ${bP.beta[i].toFixed(3).padStart(7)}`);
