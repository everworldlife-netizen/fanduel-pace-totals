#!/usr/bin/env node
/* late-25: all the findings of a stage together. Model:  real remaining = engine remaining + sum over situations k of
 * 1[k] x (a_k + b_k x engine remaining)   (a row can be in several situations; rows in none keep the engine's number).
 * Fitted on the first half of 2026 -> second half; all 2026 -> 2027. L2 = least squares, L1 = least absolute (IRLS).
 * Also "leave one out": the joint gain without each situation, to see what each one adds on top of the others. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const dec = (r) => am(r) >= 16, flag = (r) => r.mpgOn < 20;
const SETS = {
  s42: {
    flagOffReg: (r) => !r.on && dec(r) && flag(r) && !D(r),
    flagOnBench: (r) => r.on && dec(r) && flag(r) && !S(r),
    sOnDecided: (r) => r.on && dec(r) && !flag(r) && S(r),
    deepWait: (r) => !r.on && dec(r) && !flag(r) && D(r),
    restClose: (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12,
    deepOffClose: (r) => !r.on && am(r) <= 10 && D(r),
    benchOffClose: (r) => !r.on && am(r) <= 10 && B(r),
    sOnClose: (r) => r.on && am(r) <= 10 && S(r),
    sOffDecReg: (r) => !r.on && dec(r) && !flag(r) && S(r),
    bOffDecReg: (r) => !r.on && dec(r) && !flag(r) && B(r),
  },
  s36: {
    deepLop: (r) => D(r) && am(r) >= 16,
    flagOffReg26: (r) => !D(r) && !r.on && am(r) >= 26 && r.mpgOn < 22,
    sFullQ3: (r) => S(r) && r.on && r.stintNow >= 11.9,
    benchJustIn: (r) => r.on && r.stintNow < 4 && !S(r),
    midBenchLead: (r) => !S(r) && r.mpg >= 18 && r.mg >= 16,
    benchHot: (r) => B(r) && am(r) <= 15 && r.now0 - 0.75 * r.mpg >= 3,
    onLowEngine: (r) => r.on && r.erem < 3,
    engineHigh: (r) => r.erem >= 9.5,
  },
};
function fitJoint(rows, fs, kind) {
  const X = [], y = [], keys = [];
  for (const r of rows) { const x = []; let any = 0; for (const f of fs) { const v = f(r) ? 1 : 0; any += v; x.push(v, v * r.erem); } if (!any) continue; X.push(x); y.push(r.rem - r.erem); keys.push(r.tg); }
  let w = null, beta = null;
  for (let it = 0; it < (kind === 'L1' ? 30 : 1); it++) {
    const Xw = w ? X.map((x, i) => x.map((v) => v * Math.sqrt(w[i]))) : X, yw = w ? y.map((v, i) => v * Math.sqrt(w[i])) : y;
    beta = C.ols(Xw, yw, keys, 1e-6).beta;
    if (kind === 'L1') w = y.map((v, i) => 1 / Math.max(Math.abs(v - X[i].reduce((s, xv, j) => s + xv * beta[j], 0)), 0.05));
  }
  return beta;
}
const pred = (fs, beta, left) => (r) => { let d = 0, any = 0; fs.forEach((f, k) => { if (f(r)) { any = 1; d += beta[2 * k] + beta[2 * k + 1] * r.erem; } }); return any ? r.now0 + Math.max(0, Math.min(left + 1, r.erem + d)) : r.mn0; };
for (const stage of ['s36', 's42']) {
  const left = stage === 's36' ? 12 : 6;
  const rows = C.load(2026).filter((r) => r.ac0 != null && r.g === stage), rows27 = C.load(2027).filter((r) => r.ac0 != null && r.g === stage);
  const { A: h1, B: h2 } = C.splitByDate(rows);
  const names = Object.keys(SETS[stage]), fs = names.map((k) => SETS[stage][k]);
  console.log(`\n== ${stage}: ${names.length} situations together`);
  for (const kind of ['L2', 'L1']) {
    const b1 = fitJoint(h1, fs, kind), b2 = fitJoint(rows, fs, kind);
    const c = AN.compare(h2, (r) => r.mn0, pred(fs, b1, left)), d = AN.compare(rows27, (r) => r.mn0, pred(fs, b2, left));
    console.log(`  ${kind}: H1->H2 ${c.a.toFixed(3)} -> ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)}) | 2026->2027 ${d.a.toFixed(3)} -> ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%, z ${d.z.toFixed(1)})`);
    console.log('     lines (all 2026), real remaining = engine + a + b x engine: ' + names.map((k, i) => `${k} ${C.fmt(b2[2 * i], 2)}${C.fmt(b2[2 * i + 1], 2)}e`).join(', '));
    for (let k = 0; k < names.length; k++) {
      const fk = fs.filter((_, i) => i !== k); const bb = fitJoint(h1, fk, kind), bb2 = fitJoint(rows, fk, kind);
      const cc = AN.compare(h2, (r) => r.mn0, pred(fk, bb, left)), dd = AN.compare(rows27, (r) => r.mn0, pred(fk, bb2, left));
      console.log(`     without ${names[k].padEnd(14)}: H2 ${cc.pct.toFixed(2)}% (it adds ${(c.pct - cc.pct).toFixed(2)}) | 2027 ${dd.pct.toFixed(2)}% (adds ${(d.pct - dd.pct).toFixed(2)})`);
    }
  }
}
