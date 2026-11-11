#!/usr/bin/env node
/* late-16: calibration of the engine's remaining minutes at s36 / s42: real remaining by bins of engine remaining
 * (all players; then split by on / off the floor). Is the engine's number too spread out (needs a shrink)? */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => r.ac0 != null);
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g), left = g === 's36' ? 12 : 6;
  const cuts = g === 's36' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0.5, 1, 1.5, 2, 3, 4, 5, 5.5, 6];
  for (const [nm, f] of [['all', () => true], ['on the floor', (r) => r.on], ['off the floor', (r) => !r.on], ['within 10', (r) => Math.abs(r.mg) <= 10], ['within 10, on', (r) => Math.abs(r.mg) <= 10 && r.on], ['within 10, off', (r) => Math.abs(r.mg) <= 10 && !r.on], ['16+', (r) => Math.abs(r.mg) >= 16]]) {
    const S = A.filter(f); const out = [];
    for (let i = 0; i <= cuts.length; i++) {
      const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
      const T = S.filter((r) => r.erem >= lo && r.erem < hi); if (T.length < 30) { out.push(`<${hi}: n${T.length}`); continue; }
      const e = C.cl(T, (r) => r.erem), a = C.cl(T, (r) => r.rem), gp = C.cl(T, (r) => r.gap);
      out.push(`${e.mean.toFixed(1)}->${a.mean.toFixed(2)} (z${gp.z.toFixed(1)}, n${T.length})`);
    }
    console.log(`${g} ${nm.padEnd(15)} ` + out.join(' | '));
  }
  // slope of real remaining on engine remaining
  const o = C.ols(A.map((r) => [1, r.erem]), A.map((r) => r.rem), A.map((r) => r.tg));
  console.log(`${g} real remaining = ${o.beta[0].toFixed(2)} + ${o.beta[1].toFixed(3)} x engine remaining (slope se ${o.se[1].toFixed(3)})`);
}
