#!/usr/bin/env node
/* late-17: calibration lines. real remaining = a + b x engine remaining, by stage x on/off x margin class (and the floor unit
 * in decided games). Cluster-robust se. Also the miss inside each class before/after its own line (in-sample, 2026). */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => r.ac0 != null);
const am = (r) => Math.abs(r.mg);
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g);
  console.log(`\n== ${g}`);
  const classes = [
    ['on, within 10', (r) => r.on && am(r) <= 10], ['on, 11-15', (r) => r.on && am(r) >= 11 && am(r) <= 15],
    ['on, 16+, five-on usual min < 20', (r) => r.on && am(r) >= 16 && r.mpgOn < 20], ['on, 16+, five-on usual min 20+', (r) => r.on && am(r) >= 16 && r.mpgOn >= 20],
    ['off, within 10', (r) => !r.on && am(r) <= 10], ['off, 11-15', (r) => !r.on && am(r) >= 11 && am(r) <= 15],
    ['off, 16+, five-on usual min < 20', (r) => !r.on && am(r) >= 16 && r.mpgOn < 20], ['off, 16+, five-on usual min 20+', (r) => !r.on && am(r) >= 16 && r.mpgOn >= 20],
  ];
  for (const [nm, f] of classes) {
    const S = A.filter(f); if (S.length < 50) continue;
    const o = C.ols(S.map((r) => [1, r.erem]), S.map((r) => r.rem), S.map((r) => r.tg));
    const T = S.filter(C.p10);
    const m0 = C.cl(T, (r) => Math.abs(r.ac0 - r.mn0)).mean, m1 = C.cl(T, (r) => Math.abs(r.rem - (o.beta[0] + o.beta[1] * r.erem))).mean;
    const e = C.cl(S, (r) => r.erem).mean, a = C.cl(S, (r) => r.rem).mean;
    console.log(`  ${nm.padEnd(34)} n=${String(S.length).padStart(5)}  mean engine ${e.toFixed(2)} real ${a.toFixed(2)} | real = ${o.beta[0].toFixed(2)} (se ${o.se[0].toFixed(2)}) + ${o.beta[1].toFixed(2)} (se ${o.se[1].toFixed(2)}) x engine | miss ${m0.toFixed(2)} -> ${m1.toFixed(2)}`);
  }
}
