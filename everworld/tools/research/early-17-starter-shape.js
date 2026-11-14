#!/usr/bin/env node
/* early-17: shape of the over-spread for players who start tonight (bins of the engine number), tip-off / 6 / 12 min,
 * both seasons; and a two-slope fit (below / above the pivot 29.5). */
'use strict';
const C = require('./early-common');
for (const season of ['2026', '2027']) {
  const all = C.load(season).filter((o) => o.pre.sT === 1 && o.ac > 0);
  for (const ST of ['pre', 's6', 's12']) {
    console.log(`\n-- ${season} ${ST}: starters tonight by engine number --`);
    for (const [lo, hi] of [[0, 20], [20, 24], [24, 27], [27, 30], [30, 33], [33, 36], [36, 50]]) {
      const li = all.filter((o) => o[ST].mn[0] >= lo && o[ST].mn[0] < hi); if (li.length < 15) continue;
      const g = C.cl(li, (o) => o.ac - o[ST].mn[0]);
      console.log(`  number ${String(lo).padStart(2)}-${String(hi).padEnd(2)} n=${String(li.length).padStart(5)} engine ${(li.reduce((a, o) => a + o[ST].mn[0], 0) / li.length).toFixed(1)} usual ${(li.reduce((a, o) => a + o.pre.mpg, 0) / li.length).toFixed(1)} real ${(li.reduce((a, o) => a + o.ac, 0) / li.length).toFixed(1)} gap ${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(2)} (z ${g.z.toFixed(1)})`);
    }
    const r = C.ols(all.map((o) => [1, Math.min(o[ST].mn[0] - 29.5, 0), Math.max(o[ST].mn[0] - 29.5, 0)]), all.map((o) => o.ac - o[ST].mn[0]), all.map((o) => o.tg));
    console.log(`  two slopes: below 29.5: ${r.beta[1].toFixed(3)} (z ${r.z[1].toFixed(1)}), above: ${r.beta[2].toFixed(3)} (z ${r.z[2].toFixed(1)}), at pivot ${r.beta[0].toFixed(2)}`);
    // is it the usual minutes or the rest of the number? gap on (mpg - 29.5) and (number - mpg)
    const r2 = C.ols(all.map((o) => [1, o.pre.mpg - 29.5, o[ST].mn[0] - o.pre.mpg]), all.map((o) => o.ac - o[ST].mn[0]), all.map((o) => o.tg));
    console.log(`  split: gap on usual minutes ${r2.beta[1].toFixed(3)} (z ${r2.z[1].toFixed(1)}), on (number - usual minutes) ${r2.beta[2].toFixed(3)} (z ${r2.z[2].toFixed(1)})`);
  }
}
// bench in: split usual vs rest
for (const season of ['2026', '2027']) for (const ST of ['s6', 's12']) {
  const li = C.load(season).filter((o) => o.pre.sT === 0 && o[ST].dnp === 0);
  const r2 = C.ols(li.map((o) => [1, o.pre.mpg - 21, o[ST].mn[0] - o.pre.mpg]), li.map((o) => o.ac - o[ST].mn[0]), li.map((o) => o.tg));
  const r3 = C.ols(li.map((o) => [1, Math.min(o[ST].mn[0] - 21, 0), Math.max(o[ST].mn[0] - 21, 0)]), li.map((o) => o.ac - o[ST].mn[0]), li.map((o) => o.tg));
  console.log(`${season} ${ST} bench in (n=${li.length}): gap on usual minutes ${r2.beta[1].toFixed(3)} (z ${r2.z[1].toFixed(1)}), on (number - usual) ${r2.beta[2].toFixed(3)} (z ${r2.z[2].toFixed(1)}) | two slopes below 21: ${r3.beta[1].toFixed(3)} (z ${r3.z[1].toFixed(1)}), above: ${r3.beta[2].toFixed(3)} (z ${r3.z[2].toFixed(1)}), at pivot ${r3.beta[0].toFixed(2)}`);
}
