#!/usr/bin/env node
/* late-12: which definition of the white flag separates best at 6:00 left? For regulars who are OFF the floor (usual 14+ min)
 * and for non-starters who are ON, real remaining minutes by: usual starters on the floor (stOn), tonight's starters on the
 * floor (sTOn), top-5-by-minutes on the floor (top5On), mean usual minutes of the five on the floor (mpgOn), and the margin. */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => r.g === 's42' && r.ac0 != null);
function tab(title, S, f, cuts, labels) {
  const out = [];
  for (let i = 0; i <= cuts.length; i++) {
    const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
    const T = S.filter((r) => { const v = f(r); return v != null && v >= lo && v < hi; });
    if (T.length < 20) { out.push(`${labels ? labels[i] : lo}: n${T.length}`); continue; }
    const e = C.cl(T, (r) => r.erem), a = C.cl(T, (r) => r.rem), z0 = T.filter((r) => r.rem < 0.05).length / T.length;
    out.push(`${labels ? labels[i] : `[${lo},${hi})`}: eng ${e.mean.toFixed(2)} real ${a.mean.toFixed(2)} (${Math.round(100 * z0)}% none, n${T.length})`);
  }
  console.log(`  ${title.padEnd(26)} ` + out.join(' | '));
}
for (const [lo, hi] of [[11, 15], [16, 20], [21, 99]]) {
  const offReg = rows.filter((r) => !r.on && r.mpg >= 14 && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
  console.log(`\n== |margin| ${lo}-${hi}: regulars (14+ min) OFF the floor at 6:00`);
  tab('usual starters on', offReg, (r) => r.stOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab("tonight's starters on", offReg, (r) => r.sTOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('top-5 by minutes on', offReg, (r) => r.top5On, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('mean usual min of five on', offReg, (r) => r.mpgOn, [12, 16, 20, 24, 28]);
  tab('opp usual starters on', offReg, (r) => r.oStOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('sat for', offReg, (r) => r.sitFor, [1, 2, 4, 6, 9]);
  const onNS = rows.filter((r) => r.on && r.st !== 1 && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
  console.log(`   non-starters ON the floor at 6:00`);
  tab('usual starters on', onNS, (r) => r.stOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab("tonight's starters on", onNS, (r) => r.sTOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('top-5 by minutes on', onNS, (r) => r.top5On, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('mean usual min of five on', onNS, (r) => r.mpgOn, [12, 16, 20, 24, 28]);
  tab('own usual minutes', onNS, (r) => r.mpg, [6, 10, 14, 18, 21]);
  tab('stint so far', onNS, (r) => r.stintNow, [1, 2, 4, 6]);
  const onS = rows.filter((r) => r.on && r.st === 1 && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
  console.log(`   usual starters ON the floor at 6:00`);
  tab('usual starters on', onS, (r) => r.stOn, [2, 3, 4, 5], ['1', '2', '3', '4', '5']);
  tab('mean usual min of five on', onS, (r) => r.mpgOn, [16, 20, 24, 28]);
  tab('opp usual starters on', onS, (r) => r.oStOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
  tab('own usual minutes', onS, (r) => r.mpg, [27, 30, 33]);
  tab('stint so far', onS, (r) => r.stintNow, [1, 2, 4, 6, 9]);
  tab('lead(+)/trail(-)', onS, (r) => Math.sign(r.mg), [0], ['trail', 'lead']);
}
