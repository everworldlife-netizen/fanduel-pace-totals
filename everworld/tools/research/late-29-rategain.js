#!/usr/bin/env node
/* late-29: the late per-minute level. Engine's remaining points / rebounds / assists are low on average from the end of Q3 on.
 * Fit one factor per stat and stage on the first half of 2026 (ratio of sums: real remaining / engine remaining, all
 * projected players), apply to the second half and to 2027: signed bias before/after, and the miss (10+ minute players)
 * of the plain average (mn) and of the shown number (pr, moved by the same amount). */
'use strict';
const C = require('./late-common');
const r26 = C.load(2026).filter((r) => r.ac && r.mn), r27 = C.load(2027).filter((r) => r.ac && r.mn);
for (const g of ['s36', 's42']) {
  const A = r26.filter((r) => r.g === g), B = r27.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  for (const [k, kn] of [[1, 'PTS'], [2, 'REB'], [3, 'AST']]) {
    const fac = (S) => S.reduce((s, r) => s + (r.ac[k] - r.now[k]), 0) / S.reduce((s, r) => s + (r.mn[k] - r.now[k]), 0);
    const k1 = fac(h1), kAll = fac(A), k27 = fac(B);
    const bias = C.cl(A, (r) => r.ac[k] - r.mn[k]), bias27 = C.cl(B, (r) => r.ac[k] - r.mn[k]);
    const ev = (S, f) => {
      const T = S.filter(C.p10);
      const m0 = C.cl(T, (r) => Math.abs(r.ac[k] - r.mn[k]), (r) => r.id).mean, m1 = C.cl(T, (r) => Math.abs(r.ac[k] - (r.mn[k] + (f - 1) * (r.mn[k] - r.now[k]))), (r) => r.id).mean;
      const p0 = C.cl(T, (r) => Math.abs(r.ac[k] - r.pr[k]), (r) => r.id).mean, p1 = C.cl(T, (r) => Math.abs(r.ac[k] - (r.pr[k] + (f - 1) * (r.mn[k] - r.now[k]))), (r) => r.id).mean;
      const dz = C.cl(T, (r) => Math.abs(r.ac[k] - (r.mn[k] + (f - 1) * (r.mn[k] - r.now[k]))) - Math.abs(r.ac[k] - r.mn[k]), (r) => r.id).z;
      return `plain average miss ${m0.toFixed(3)} -> ${m1.toFixed(3)} (${(100 * (m1 / m0 - 1)).toFixed(2)}%, z ${dz.toFixed(1)}); shown number miss ${p0.toFixed(3)} -> ${p1.toFixed(3)} (${(100 * (p1 / p0 - 1)).toFixed(2)}%)`;
    };
    console.log(`${g} ${kn}: real/engine remaining = ${kAll.toFixed(3)} (2026; first half ${k1.toFixed(3)}; 2027 ${k27.toFixed(3)}) | bias per player ${C.fmt(bias.mean, 3)} z ${bias.z.toFixed(1)} (2027 ${C.fmt(bias27.mean, 3)} z ${bias27.z.toFixed(1)})`);
    console.log(`     H1 factor on H2: ${ev(h2, k1)}`);
    console.log(`     2026 factor on 2027: ${ev(B, kAll)}`);
  }
}
