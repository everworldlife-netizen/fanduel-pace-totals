#!/usr/bin/env node
/* late-19: the ceiling for the average miss (trees with absolute loss) from the live floor state at s36 / s42.
 * Trained on the first half of 2026 -> second half; all 2026 -> 2027. Writes the result to data/research/late-ceiling1.json */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor'), G1 = require('./late-gbm1');
const rows = C.load(2026).filter((r) => r.ac0 != null), rows27 = C.load(2027).filter((r) => r.ac0 != null);
const nz = (v, d = -1) => (v == null || Number.isNaN(v) ? d : v);
const fF = (r) => [r.mn0 - r.now0, r.on, r.sitFor, r.stintNow, r.mpg, r.now0, r.mg, Math.abs(r.mg), r.mpgOn, r.oMpgOn, r.stOn, r.oStOn, r.top5On, r.pf, r.q3, r.q4sf, r.d6, r.d3, nz(r.sT), r.st, r.top5, nz(r.fav, 0), r.mMax, r.mMin, r.h1];
const fH = (r) => [nz(r.cgShA), nz(r.cgRkA, 12), nz(r.cgNA, 0), nz(r.cgShX), nz(r.cgRkX, 12), nz(r.remSA), nz(r.remBSA), nz(r.remBSX), nz(r.remSX), nz(r.remCSX), nz(r.remLX), nz(r.nBSX, 0), nz(r.l6CX), nz(r.l3CrX), nz(r.mpgHX)];
const sets = { 'floor state': fF, 'floor state + history': (r) => [...fF(r), ...fH(r)] };
const out = {};
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g), B27 = rows27.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  for (const [nm, f] of Object.entries(sets)) {
    const m = G1.train(h1.map(f), h1.map((r) => r.ac0 - r.mn0), { rounds: 150, depth: 4, lr: 0.1, minLeaf: 60 });
    const c = AN.compare(h2, (r) => r.mn0, (r) => Math.max(r.now0, r.mn0 + G1.predict(m, f(r))));
    const m2 = G1.train(A.map(f), A.map((r) => r.ac0 - r.mn0), { rounds: 150, depth: 4, lr: 0.1, minLeaf: 60 });
    const d = AN.compare(B27, (r) => r.mn0, (r) => Math.max(r.now0, r.mn0 + G1.predict(m2, f(r))));
    const line = `${g} L1 trees on ${nm.padEnd(22)}: H1->H2 ${c.a.toFixed(3)} -> ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)}) | 2026->2027 ${d.a.toFixed(3)} -> ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%, z ${d.z.toFixed(1)})`;
    console.log(line); out[`${g}:${nm}`] = { h2: c, y27: d };
  }
}
C.L.writeJSON(`${C.L.ROOT}/data/research/late-ceiling1.json`, out);
