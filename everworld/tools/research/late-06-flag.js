#!/usr/bin/env node
/* late-06: the "white flag" picture. Residual of the plain refit by role x on/off x |margin| band x number of the team's
 * usual starters (24+ min a game) on the floor at that moment. Stage s36 (end of Q3) and s42 (6:00 left). */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const rows = C.load(2026);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g); const o = F.fit(A, null);
  for (const r of A) { r.fitted = F.predict(r, o.beta, null); r.res = (r.ac0 != null ? r.ac0 : r.now0) - r.fitted; }
  console.log(`\n== ${g}: cells = residual z (engine-refit remaining -> real remaining, n)`);
  for (const ro of ['S', 'B', 'D']) for (const on of [1, 0]) {
    console.log(` ${ro} ${on ? 'ON ' : 'OFF'}        own starters on floor: 0-1 | 2 | 3 | 4-5`);
    for (const [lo, hi, sg] of [[21, 99, -1], [16, 20, -1], [11, 15, -1], [0, 10, 0], [11, 15, 1], [16, 20, 1], [21, 99, 1]]) {
      const cells = [];
      for (const [a, b] of [[0, 1], [2, 2], [3, 3], [4, 5]]) {
        const S = A.filter((r) => role(r) === ro && r.on === on && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi && (sg === 0 || Math.sign(r.mg) === sg) && r.stOn >= a && r.stOn <= b);
        if (S.length < 25) { cells.push(`      n${String(S.length).padStart(3)}              `); continue; }
        const c = C.cl(S, (r) => r.res), e = C.cl(S, (r) => r.fitted - r.now0), a2 = C.cl(S, (r) => r.rem);
        cells.push(`${C.fmt(c.mean, 2)} z${c.z.toFixed(1).padStart(5)} (${e.mean.toFixed(1)}->${a2.mean.toFixed(1)} n${String(c.n).padStart(4)})`);
      }
      console.log(`   ${(sg < 0 ? 'trail ' : sg > 0 ? 'lead  ' : 'within ') + lo + (hi < 99 ? '-' + hi : '+')}`.padEnd(16) + cells.join(' | '));
    }
  }
}
