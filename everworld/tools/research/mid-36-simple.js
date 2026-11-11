#!/usr/bin/env node
/* mid-36: rule 6 done the plainest way, no refit of anything else. One number per stage:
 *   new remaining = engine remaining + c x (anchor - engine remaining)
 * c fitted by least squares on the first half of 2026, applied to the second half and to 2027; miss vs the engine as it is.
 * Anchors: half = half of the time left; pace (half-time only) = first-half minutes; both = two numbers. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const R26 = C.load(2026), R27 = C.load(2027);
const fit1 = (rows, fs) => { // OLS of (real rem - engine rem) on [f1, f2...] without intercept
  const X = [], y = [], k = [];
  for (const r of rows) { if (r.ac0 == null || !(r.erem >= 0.25)) continue; X.push(fs.map((f) => f(r))); y.push(r.rem - r.erem); k.push(r.tg); }
  return C.ols(X, y, k);
};
const half = (r) => 0.5 * (48 - r.el) - r.erem, pace = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2) * (48 - r.el) / Math.min(r.el, 24) - r.erem;
const lopHalf = (r) => half(r) * Math.max(0, Math.min(2.5, (Math.abs(r.mg) - 8) / 10));
const sets = { 'half': [half], 'half + half x lopsided': [half, lopHalf], 'half + pace': [half, pace], 'half + half x lopsided + pace': [half, lopHalf, pace] };
for (const g of ['s18', 's24', 's30']) {
  const R = R26.filter((r) => r.g === g), R7 = R27.filter((r) => r.g === g);
  const { A, B } = F.splitByDate(R);
  console.log(`\n== ${g}`);
  for (const [nm, fs] of Object.entries(sets)) {
    const o = fit1(A, fs), oAll = fit1(R, fs), o7 = fit1(R7, fs);
    const pred = (b) => (r) => (r.erem >= 0.25 ? r.now0 + Math.max(0, r.erem + fs.reduce((s, f, i) => s + b[i] * f(r), 0)) : r.mn0);
    const cB = F.compare(B, (r) => r.mn0, pred(o.beta)), c7 = F.compare(R7, (r) => r.mn0, pred(oAll.beta));
    console.log(`   ${nm.padEnd(30)} c (1st half) ${o.beta.map((b) => b.toFixed(3)).join(', ')} | all 2026 ${oAll.beta.map((b, i) => `${b.toFixed(3)} (z ${oAll.z[i].toFixed(1)})`).join(', ')} | 2027 alone ${o7.beta.map((b, i) => `${b.toFixed(3)} (z ${o7.z[i].toFixed(1)})`).join(', ')}`);
    console.log(`   ${''.padEnd(30)} 2nd half 2026: ${cB.a.toFixed(3)} -> ${cB.b.toFixed(3)} (${cB.pct.toFixed(2)}%, z ${cB.z.toFixed(1)}) | 2027 with the 2026 c: ${c7.a.toFixed(3)} -> ${c7.b.toFixed(3)} (${c7.pct.toFixed(2)}%, z ${c7.z.toFixed(1)})`);
  }
}
