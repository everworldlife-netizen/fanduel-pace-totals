#!/usr/bin/env node
/* early-07: confirmation on 2026-27 of "teach the early stages on complete games" and of the population rule.
 * Fit the 49 existing inputs on ALL of 2025-26 (complete games), apply to the 121 games of 2026-27 and compare with
 * the number in the 2027 dump (lessons H2-final: s6/s12 from every game of 2023-26, incomplete ones included).
 *   node tools/research/early-07-refit27.js [s6|s12] [lam] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6'; const lam = +(process.argv[3] || 32);
const tr = Fx.prep(C.load('2026'), ST), te = Fx.prep(C.load('2027'), ST);
const bA = Fx.fit(tr, 'all', lam), bP = Fx.fit(tr, 'played', lam);
const preds = { 'tip-off number': (q) => q.o.pre.mn[0], engine: (q) => q.eng, 'plain (no lessons)': (q) => q.now + q.rem, 'refit-all': (q) => Fx.predict(q, bA.beta), 'refit-play': (q) => Fx.predict(q, bP.beta) };
console.log(`stage ${ST}, lam ${lam}: taught on ${tr.length} rows of 2025-26, tested on ${te.length} rows / ${new Set(te.map((q) => q.o.pre.id)).size} games of 2026-27`);
for (const [pn, pop] of Object.entries(Fx.POPS)) {
  console.log(`-- 2026-27, population: ${pn} --`);
  for (const [name, p] of Object.entries(preds)) {
    const c = Fx.compare(te, preds.engine, p, pop);
    let bias = 0, n = 0; for (const q of te) if (pop(q)) { bias += q.ac - p(q); n++; }
    console.log(`  ${name.padEnd(20)} miss ${c.b.toFixed(3)}  vs engine ${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})  bias ${(bias / n).toFixed(2)}`);
  }
}
const classes = { starters: (q) => q.o.pre.sT === 1, 'bench in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 0, 'bench not in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 1 };
console.log('-- 2026-27, 10+ by class: tip-off / engine / refit-all / refit-play --');
for (const [cn, cf] of Object.entries(classes)) {
  const li = te.filter((q) => cf(q) && q.ac >= 10); const m = (p) => (li.reduce((a, q) => a + Math.abs(p(q) - q.ac), 0) / li.length).toFixed(3);
  console.log(`  ${cn.padEnd(14)} n=${li.length}  ${m(preds['tip-off number'])} / ${m(preds.engine)} / ${m(preds['refit-all'])} / ${m(preds['refit-play'])}`);
}
