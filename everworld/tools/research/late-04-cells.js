#!/usr/bin/env node
/* late-04: where the plain refit (existing 49 inputs, refitted on all of 2026 = the best they can do) still misses.
 * Residual = real final - refit final, by role x floor state x margin band, then by extra dimensions inside cells. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const season = +process.argv[2] || 2026;
const rows = C.load(2026);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const state = (r) => (r.on ? 'on' : r.dnp ? 'dnp' : 'off');
const mb = (m) => { const a = Math.abs(m); return a <= 5 ? 'c0-5' : a <= 10 ? 'c6-10' : a <= 15 ? (m > 0 ? 'L11-15' : 'T11-15') : a <= 20 ? (m > 0 ? 'L16-20' : 'T16-20') : m > 0 ? 'L21+' : 'T21+'; };
const order = ['T21+', 'T16-20', 'T11-15', 'c6-10', 'c0-5', 'L11-15', 'L16-20', 'L21+'];
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g);
  const o = F.fit(A, null);
  for (const r of A) { r.fitted = F.predict(r, o.beta, null); r.res = (r.ac0 != null ? r.ac0 : r.now0) - r.fitted; }
  console.log(`\n== ${g}: residual of the plain refit (all rows incl. players who never came in) by role / state / margin`);
  for (const ro of ['S', 'B', 'D']) for (const stt of ['on', 'off', 'dnp']) {
    const cells = [];
    for (const b of order) {
      const S = A.filter((r) => role(r) === ro && state(r) === stt && mb(r.mg) === b);
      if (S.length < 40) { cells.push(`${b}: -`); continue; }
      const c = C.cl(S, (r) => r.res), e = C.cl(S, (r) => r.fitted - r.now0);
      cells.push(`${b}: ${C.fmt(c.mean, 2)} (z${c.z.toFixed(1)}, rem ${e.mean.toFixed(1)}, n${c.n})`);
    }
    console.log(`  ${ro}/${stt.padEnd(3)} ` + cells.join(' | '));
  }
}
