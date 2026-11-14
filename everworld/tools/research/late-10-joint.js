#!/usr/bin/env node
/* late-10: candidate inputs on top of the existing 49 (same ridge form as the engine's layer).
 *  (1) all of 2026: coefficient and cluster-robust z of each candidate, alone (added one at a time) and jointly;
 *  (2) fit first half of 2026 -> second half: miss of engine, plain refit, refit + candidates;
 *  (3) fit all 2026 -> 2027. */
'use strict';
const C = require('./late-common'), F = require('./late-fit'), K = require('./late-cand');
const rows = C.load(2026), rows27 = C.load(2027);
for (const [g, CS] of [['s36', K.C36], ['s42', K.C42]]) {
  const names = Object.keys(CS), fs = names.map((k) => CS[k]);
  const A = rows.filter((r) => r.g === g), B27 = rows27.filter((r) => r.g === g);
  console.log(`\n== ${g}: candidates on top of the 49 existing inputs (all 2026: ${A.length} rows)`);
  const joint = F.fit(A, fs);
  console.log('  candidate          rows   alone: coef (z)      joint: coef (z)');
  for (let i = 0; i < names.length; i++) {
    const one = F.fit(A, [fs[i]]);
    const n = A.filter((r) => fs[i](r)).length;
    console.log(`  ${names[i].padEnd(16)} ${String(n).padStart(6)}   ${C.fmt(one.beta[49], 3)} (${one.z[49].toFixed(1).padStart(5)})      ${C.fmt(joint.beta[49 + i], 3)} (${joint.z[49 + i].toFixed(1).padStart(5)})`);
  }
  const { cutDate, A: h1, B: h2 } = C.splitByDate(A);
  const p0 = F.fit(h1, null), p1 = F.fit(h1, fs);
  const c0 = F.compare(h2, (r) => r.mn0, (r) => F.predict(r, p0.beta, null));
  const c1 = F.compare(h2, (r) => r.mn0, (r) => F.predict(r, p1.beta, fs));
  const c01 = F.compare(h2, (r) => F.predict(r, p0.beta, null), (r) => F.predict(r, p1.beta, fs));
  console.log(`  first half -> second half (cut ${cutDate}, n=${c0.n}): engine ${c0.a.toFixed(3)} | plain refit ${c0.b.toFixed(3)} (${c0.pct.toFixed(2)}%) | refit + candidates ${c1.b.toFixed(3)} (${c1.pct.toFixed(2)}%, z ${c1.z.toFixed(1)}); candidates over plain refit ${c01.pct.toFixed(2)}% (z ${c01.z.toFixed(1)})`);
  const q0 = F.fit(A, null);
  const d0 = F.compare(B27, (r) => r.mn0, (r) => F.predict(r, q0.beta, null)), d1 = F.compare(B27, (r) => r.mn0, (r) => F.predict(r, joint.beta, fs));
  const d01 = F.compare(B27, (r) => F.predict(r, q0.beta, null), (r) => F.predict(r, joint.beta, fs));
  console.log(`  all 2026 -> 2027 (n=${d0.n}): engine ${d0.a.toFixed(3)} | plain refit ${d0.b.toFixed(3)} (${d0.pct.toFixed(2)}%) | refit + candidates ${d1.b.toFixed(3)} (${d1.pct.toFixed(2)}%, z ${d1.z.toFixed(1)}); candidates over plain refit ${d01.pct.toFixed(2)}% (z ${d01.z.toFixed(1)})`);
}
