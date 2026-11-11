#!/usr/bin/env node
/* late-11: the same candidates with a weaker pull on the new inputs (they are rare but strong, like the lineup inputs).
 * First half of 2026 -> second half, and all 2026 -> 2027, for several pulls. Also the cap: the layer cannot cut more than
 * 60% or add more than 150%; the white-flag cases want -100%, so the cap is also tried at -95%. */
'use strict';
const C = require('./late-common'), F = require('./late-fit'), F2 = require('./late-fit2'), K = require('./late-cand');
const rows = C.load(2026), rows27 = C.load(2027);
const predict = (r, beta, extra, lo) => { const rem = r.mn0 - r.now0; if (!(rem >= 0.25)) return r.mn0; let z = 0; for (let j = 0; j < 49; j++) z += beta[j] * r.x[j]; if (extra) for (let j = 0; j < extra.length; j++) z += beta[49 + j] * (extra[j](r) || 0); return r.now0 + rem * (1 + Math.max(lo, Math.min(1.5, z))); };
for (const [g, CS] of [['s36', K.C36], ['s42', K.C42]]) {
  const names = Object.keys(CS), fs = names.map((k) => CS[k]);
  const A = rows.filter((r) => r.g === g), B27 = rows27.filter((r) => r.g === g);
  const { A: h1, B: h2 } = C.splitByDate(A);
  const p0 = F.fit(h1, null), q0 = F.fit(A, null);
  console.log(`\n== ${g}`);
  for (const rc of [1, 0.25, 0.05, 0.01]) for (const lo of [-0.6, -0.95]) {
    const p1 = F2.fit(h1, fs, rc), q1 = F2.fit(A, fs, rc);
    const c1 = F.compare(h2, (r) => r.mn0, (r) => predict(r, p1.beta, fs, lo)), c01 = F.compare(h2, (r) => F.predict(r, p0.beta, null), (r) => predict(r, p1.beta, fs, lo));
    const d1 = F.compare(B27, (r) => r.mn0, (r) => predict(r, q1.beta, fs, lo)), d01 = F.compare(B27, (r) => F.predict(r, q0.beta, null), (r) => predict(r, q1.beta, fs, lo));
    console.log(`  pull x${rc}, cap ${lo}: H1->H2 engine ${c1.a.toFixed(3)} -> ${c1.b.toFixed(3)} (${c1.pct.toFixed(2)}%, z ${c1.z.toFixed(1)}; over plain refit ${c01.pct.toFixed(2)}% z ${c01.z.toFixed(1)}) | 2026->2027 ${d1.a.toFixed(3)} -> ${d1.b.toFixed(3)} (${d1.pct.toFixed(2)}%, z ${d1.z.toFixed(1)}; over plain refit ${d01.pct.toFixed(2)}% z ${d01.z.toFixed(1)})`);
    if (rc === 0.05 && lo === -0.95) console.log('     coefficients (all 2026): ' + names.map((k, i) => `${k} ${C.fmt(q1.beta[49 + i], 2)} (z ${q1.z[49 + i].toFixed(1)})`).join(', '));
  }
}
