#!/usr/bin/env node
/* late-15: the ceiling. Boosted trees predict (real final - engine final) from the live state at s36 / s42, trained on the
 * first half of 2026, tested on the second half and on 2027 (trained on all 2026). Feature sets:
 *   E  = engine remaining + the 49 existing inputs (what a perfect refit of the existing inputs could do, any shape)
 *   E+F = plus the floor picture and stints: own on/off, sat for, stint so far, usual minutes, minutes tonight, margin,
 *         usual minutes of the five on the floor (both teams), starters on the floor (both), fouls, Q3 minutes, swing
 *   E+F+H = plus history: closing share / rank, remaining minutes in his earlier games in the same state and margin band */
'use strict';
const C = require('./late-common'), F = require('./late-fit'), G = require('./late-gbm');
const rows = C.load(2026), rows27 = C.load(2027);
const nz = (v, d = -1) => (v == null || Number.isNaN(v) ? d : v);
const fE = (r) => [r.mn0 - r.now0, ...r.x];
const fF = (r) => [r.on, r.sitFor, r.stintNow, r.mpg, r.now0, r.mg, Math.abs(r.mg), r.mpgOn, r.oMpgOn, r.stOn, r.oStOn, r.top5On, r.pf, r.q3, r.q4sf, r.d6, r.d3, nz(r.sT), r.st, r.top5, nz(r.fav, 0), r.mMax, r.mMin, r.h1];
const fH = (r) => [nz(r.cgShA), nz(r.cgRkA, 12), nz(r.cgNA, 0), nz(r.cgShX), nz(r.cgRkX, 12), nz(r.remSA), nz(r.remBSA), nz(r.remBSX), nz(r.remSX), nz(r.remCSX), nz(r.remLX), nz(r.nBSX, 0), nz(r.l6CX), nz(r.l3CrX), nz(r.mpgHX)];
const sets = { E: (r) => fE(r), 'E+F': (r) => [...fE(r), ...fF(r)], 'E+F+H': (r) => [...fE(r), ...fF(r), ...fH(r)], 'F only (+engine rem)': (r) => [r.mn0 - r.now0, ...fF(r)] };
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g && r.ac0 != null), B27 = rows27.filter((r) => r.g === g && r.ac0 != null);
  const { A: h1, B: h2 } = C.splitByDate(A);
  const p0 = F.fit(h1, null), q0 = F.fit(A, null);
  const c0 = F.compare(h2, (r) => r.mn0, (r) => F.predict(r, p0.beta, null)), d0 = F.compare(B27, (r) => r.mn0, (r) => F.predict(r, q0.beta, null));
  console.log(`\n== ${g}: engine ${c0.a.toFixed(3)} (H2) / ${d0.a.toFixed(3)} (2027); plain refit ${c0.pct.toFixed(2)}% / ${d0.pct.toFixed(2)}%`);
  for (const [nm, f] of Object.entries(sets)) {
    const m = G.train(h1.map(f), h1.map((r) => r.ac0 - r.mn0), { rounds: 200, depth: 4, lr: 0.06, minLeaf: 60 });
    const c = F.compare(h2, (r) => r.mn0, (r) => Math.max(r.now0, r.mn0 + G.predict(m, f(r))));
    const m2 = G.train(A.map(f), A.map((r) => r.ac0 - r.mn0), { rounds: 200, depth: 4, lr: 0.06, minLeaf: 60 });
    const d = F.compare(B27, (r) => r.mn0, (r) => Math.max(r.now0, r.mn0 + G.predict(m2, f(r))));
    console.log(`  trees on ${nm.padEnd(22)}: H1->H2 ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)}) | 2026->2027 ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%, z ${d.z.toFixed(1)})`);
  }
}
