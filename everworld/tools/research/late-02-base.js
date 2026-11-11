#!/usr/bin/env node
/* late-02: baseline at s36 / s42. Miss, signed gap (real - engine) by role x floor state x margin band. Team sums. */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season);
const bands = [[-99, -21, 'trail 21+'], [-20, -16, 'trail 16-20'], [-15, -11, 'trail 11-15'], [-10, -6, 'trail 6-10'], [-5, -1, 'trail 1-5'], [0, 0, 'tied'], [1, 5, 'lead 1-5'], [6, 10, 'lead 6-10'], [11, 15, 'lead 11-15'], [16, 20, 'lead 16-20'], [21, 99, 'lead 21+']];
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g);
  const P = A.filter(C.played), T = A.filter(C.p10);
  const mae = C.cl(T, (r) => Math.abs(r.ac0 - r.pr0)), maeMn = C.cl(T, (r) => Math.abs(r.ac0 - r.mn0));
  console.log(`\n== ${g}: rows ${A.length}, played ${P.length}, 10+ ${T.length}; miss shown ${mae.mean.toFixed(3)}  miss mn ${maeMn.mean.toFixed(3)}`);
  console.log(C.line('all played: gap', P));
  const states = [['on', (r) => r.on], ['off', (r) => !r.on && !r.dnp], ['dnp', (r) => r.dnp]];
  const roles = [['starter(st)', (r) => r.st === 1], ['bench 14+', (r) => r.st !== 1 && r.mpg >= 14], ['bench <14', (r) => r.st !== 1 && r.mpg < 14]];
  for (const [rn, rf] of roles) for (const [sn, sf] of states) {
    if (sn === 'dnp' && rn !== 'bench <14') continue;
    console.log(`  -- ${rn} / ${sn}`);
    for (const [lo, hi, bn] of bands) {
      const S = P.filter((r) => rf(r) && sf(r) && r.mg >= lo && r.mg <= hi);
      if (S.length < 30) continue;
      const c = C.cl(S, (r) => r.gap), e = C.cl(S, (r) => r.erem), a = C.cl(S, (r) => r.rem), m = C.cl(S.filter(C.p10), (r) => Math.abs(r.ac0 - r.pr0));
      console.log(`     ${bn.padEnd(12)} n=${String(c.n).padStart(5)} tg=${String(c.G).padStart(4)} engine rem ${e.mean.toFixed(2).padStart(5)} real rem ${a.mean.toFixed(2).padStart(5)} gap ${C.fmt(c.mean, 2).padStart(6)} z ${C.fmt(c.z, 1).padStart(6)}  miss ${m.mean.toFixed(2)}`);
    }
  }
}
