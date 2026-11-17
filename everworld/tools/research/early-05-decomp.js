#!/usr/bin/env node
/* early-05: where does the tip-off -> 6 min move come from, and which part is noise?
 * final minutes = now + rem_plain * (1 + sum_i beta_i x_i). Split the move into the plain part (qavg -> rotation map)
 * and each learned input's part (minutes), and regress real - tip-off number on the parts (slope 1 = that part is right,
 * 0 = noise, negative = harmful). Players who played > 0; clusters = team-games.
 *   node tools/research/early-05-decomp.js [2026|2027] [s6|s12] */
'use strict';
const C = require('./early-common');
const E = require('../../data/engines/final/engine.js');
const season = process.argv[2] || '2026', ST = process.argv[3] || 's6';
const les = C.L.readJSON(`${C.L.ROOT}/data/lessons/A4-final.json`);
const all = C.load(season);
const F = E.PAT_F;
const bS = les.PAT_PRIOR[ST].min.b, bP = les.PAT_PRIOR.pre.min.b;
// check: reconstruct mn from mp and x
let n = 0, err = 0, big = 0;
for (const o of all) { const r = o[ST]; if (!r.x) continue; const rem = r.mp - r.now[0]; let z = 0; for (let i = 0; i < F.length; i++) z += bS[i] * r.x[i]; const f = 1 + Math.max(-0.6, Math.min(1.5, z)); const rec = r.now[0] + rem * f; n++; err += Math.abs(rec - r.mn[0]); if (Math.abs(rec - r.mn[0]) > 0.5) big++; }
console.log(`reconstruction of the ${ST} number from plain + lessons: mean abs diff ${(err / n).toFixed(3)} min, ${big} of ${n} off by >0.5 (team normalisation / caps)`);
const groups = { starters: (o) => o.pre.sT === 1, 'bench in': (o) => o.pre.sT === 0 && o[ST].dnp === 0, 'bench not in': (o) => o.pre.sT === 0 && o[ST].dnp === 1 };
for (const [gn, gf] of Object.entries(groups)) {
  const li = all.filter((o) => gf(o) && o.ac > 0 && o[ST].x && o.pre.x);
  // parts
  const X = [], y = [], keys = [];
  const names = ['plain move', 'learned move'];
  for (const o of li) {
    const a = o.pre, b = o[ST];
    X.push([1, b.mp - a.mp, (b.mn[0] - b.mp) - (a.mn[0] - a.mp)]); y.push(o.ac - a.mn[0]); keys.push(o.tg);
  }
  const r = C.ols(X, y, keys);
  const sd = (j) => { let s = 0, s2 = 0; for (const x of X) { s += x[j]; s2 += x[j] * x[j]; } const m = s / X.length; return Math.sqrt(s2 / X.length - m * m); };
  console.log(`\n== ${gn} (${li.length} played>0) @${ST}: real - tipoff number regressed on the two parts of the move ==`);
  for (let j = 1; j < 3; j++) console.log(`  ${names[j - 1].padEnd(14)} sd ${sd(j).toFixed(2)} min  slope ${r.beta[j].toFixed(3)} ± ${r.se[j].toFixed(3)}`);
  // learned inputs one by one at this stage: contribution in minutes c_i = rem * beta_i * x_i ; regress (real - plain number) on all contributions jointly
  const act = []; for (let i = 0; i < F.length; i++) { if (!bS[i]) continue; let v = 0; for (const o of li) { const c = (o[ST].mp - o[ST].now[0]) * bS[i] * o[ST].x[i]; v += c * c; } if (Math.sqrt(v / li.length) > 0.03) act.push(i); }
  const X2 = [], y2 = [];
  for (const o of li) { const b = o[ST], rem = b.mp - b.now[0]; X2.push(act.map((i) => rem * bS[i] * b.x[i])); y2.push(o.ac - b.mp); }
  const r2 = C.ols(X2, y2, keys, 1e-6);
  console.log(`  learned inputs at ${ST}: rms contribution (min) and out-of-sample slope (1 = lesson right on these games; <0 = wrong sign)`);
  const outL = act.map((i, j) => ({ k: F[i], rms: Math.sqrt(X2.reduce((a, x) => a + x[j] * x[j], 0) / X2.length), mean: X2.reduce((a, x) => a + x[j], 0) / X2.length, b: r2.beta[j], se: r2.se[j] })).sort((a, b) => b.rms - a.rms);
  for (const q of outL) console.log(`    ${q.k.padEnd(10)} rms ${q.rms.toFixed(2)} mean ${q.mean >= 0 ? '+' : ''}${q.mean.toFixed(2)}  slope ${q.b.toFixed(2)} ± ${q.se.toFixed(2)}${Math.abs(q.b - 1) / q.se > 3 ? '   <-- differs from 1 by ' + ((q.b - 1) / q.se).toFixed(1) + ' se' : ''}`);
}
