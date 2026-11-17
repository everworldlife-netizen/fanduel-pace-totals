#!/usr/bin/env node
/* early-04: bench players who have not checked in after 6 (and 12) minutes. Does "his usual check-in time has / has not
 * passed" separate those who go on to play from those who do not? History is point-in-time (previous 8 team games).
 *   node tools/research/early-04-checkin.js [2026|2027] */
'use strict';
const C = require('./early-common');
const season = process.argv[2] || '2026';
const all = C.load(season);
// sanity: tonight features vs dump
let bad = 0, n = 0; for (const o of all) { n++; if ((o.f.tIn6 == null ? 1 : 0) !== o.s6.dnp || Math.abs(o.f.tMin6 - o.s6.now[0]) > 0.3) bad++; }
console.log(`season ${season}: ${all.length} player-games; tonight-feature mismatches vs dump at 6 min: ${bad} of ${n}`);
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
function tab(title, list, st, binF, bins) {
  console.log(`\n-- ${title} --`);
  console.log('bin'.padEnd(26) + '      n  never-in%  <10min%  real(all)  engine  gap all (z)      | played>0: n   real  engine  gap (z)        | 10+: miss pre -> ' + st);
  for (const [lab, lo, hi] of bins) {
    const li = list.filter((o) => { const v = binF(o); return v != null && v >= lo && v < hi; });
    if (li.length < 25) { console.log(lab.padEnd(26) + String(li.length).padStart(7) + '  (too few)'); continue; }
    const g = C.cl(li, (o) => o.ac - o[st].mn[0]);
    const pl = li.filter((o) => o.ac > 0), p10 = li.filter((o) => o.ac >= 10);
    const gp = C.cl(pl, (o) => o.ac - o[st].mn[0]);
    const m = (l, f) => l.reduce((a, o) => a + f(o), 0) / Math.max(l.length, 1);
    console.log(lab.padEnd(26) + String(li.length).padStart(7) + (100 * li.filter((o) => !(o.ac > 0)).length / li.length).toFixed(1).padStart(10) + (100 * li.filter((o) => o.ac < 10).length / li.length).toFixed(1).padStart(9)
      + m(li, (o) => o.ac).toFixed(2).padStart(10) + m(li, (o) => o[st].mn[0]).toFixed(2).padStart(8) + `  ${f2(g.mean)} (${g.z.toFixed(1)})`.padEnd(18)
      + `| ${String(pl.length).padStart(6)} ${m(pl, (o) => o.ac).toFixed(2).padStart(6)} ${m(pl, (o) => o[st].mn[0]).toFixed(2).padStart(6)}  ${f2(gp.mean)} (${gp.z.toFixed(1)})`.padEnd(46)
      + `| ${p10.length} ${m(p10, (o) => Math.abs(o.pre.pr[0] - o.ac)).toFixed(2)} -> ${m(p10, (o) => Math.abs(o[st].pr[0] - o.ac)).toFixed(2)}`);
  }
}
const B6 = all.filter((o) => o.pre.sT === 0 && o.s6.dnp === 1);
const shareBins = [['none (0)', 0, 0.001], ['0-25%', 0.001, 0.26], ['25-50%', 0.26, 0.51], ['50-75%', 0.51, 0.76], ['75-99%', 0.76, 0.999], ['always (100%)', 0.999, 2]];
tab('bench, NOT in by 6: by share of his recent bench games in which he had checked in by 6 (pInB6)', B6.filter((o) => o.f.nB >= 2), 's6', (o) => o.f.pInB6, shareBins);
tab('bench, NOT in by 6: no bench history (nB<2)', B6.filter((o) => o.f.nB < 2), 's6', () => 0.5, [['nB<2', 0, 1]]);
tab('bench, NOT in by 6: by share of recent TEAM games he played (nP/nT)', B6.filter((o) => o.f.nT >= 3), 's6', (o) => o.f.nP / o.f.nT, [['0', 0, 0.001], ['<=25%', 0.001, 0.26], ['25-50%', 0.26, 0.51], ['50-75%', 0.51, 0.76], ['75-99%', 0.76, 0.999], ['100%', 0.999, 2]]);
tab('bench, NOT in by 6: by usual bench check-in minute (median, ciBMed)', B6.filter((o) => o.f.nB >= 2), 's6', (o) => o.f.ciBMed, [['<4', 0, 4], ['4-6', 4, 6], ['6-8', 6, 8], ['8-10', 8, 10], ['10-12', 10, 12], ['12-15', 12, 15], ['15-24', 15, 24], ['24+', 24, 99]]);
tab('bench, NOT in by 6: played his last team game? (lastPlayed[0])', B6.filter((o) => o.f.nT >= 1), 's6', (o) => +o.f.lastPlayed[0], [['no', 0, 0.5], ['yes', 0.5, 2]]);
tab('bench, NOT in by 6: bench mates already in (nBenchIn6)', B6, 's6', (o) => o.f.nBenchIn6, [['0', 0, 1], ['1', 1, 2], ['2', 2, 3], ['3+', 3, 9]]);
tab('bench, NOT in by 6: passed over by later-usual mates (passed6)', B6.filter((o) => o.f.nB >= 2), 's6', (o) => o.f.passed6, [['0', 0, 1], ['1', 1, 2], ['2+', 2, 9]]);
tab('bench, NOT in by 6: full-share players (played 100% of last team games, nT>=4) by mpg', B6.filter((o) => o.f.nT >= 4 && o.f.nP === o.f.nT), 's6', (o) => o.pre.mpg, [['<8', 0, 8], ['8-12', 8, 12], ['12-18', 12, 18], ['18-24', 18, 24], ['24+', 24, 99]]);
// two-way: play share x usual check-in passed
console.log('\n== two-way: played-share (rows) x pInB6 (cols): gap all-listed at s6 [n] ==');
for (const [rl, rlo, rhi] of [['share<50%', 0, 0.5], ['50-99%', 0.5, 0.999], ['100%', 0.999, 2]]) {
  let s = rl.padEnd(12);
  for (const [cl2, lo, hi] of [['pIn 0', 0, 0.001], ['0-50', 0.001, 0.51], ['50-99', 0.51, 0.999], ['100', 0.999, 2]]) {
    const li = B6.filter((o) => o.f.nT >= 3 && o.f.nB >= 2 && o.f.nP / o.f.nT >= rlo && o.f.nP / o.f.nT < rhi && o.f.pInB6 >= lo && o.f.pInB6 < hi);
    if (li.length < 25) { s += ` | ${cl2}: n=${li.length}`.padEnd(40); continue; }
    const g = C.cl(li, (o) => o.ac - o.s6.mn[0]); const pl = li.filter((o) => o.ac > 0); const gp = pl.length > 20 ? C.cl(pl, (o) => o.ac - o.s6.mn[0]) : { mean: NaN, z: NaN };
    s += ` | ${cl2}: ${f2(g.mean)} z${g.z.toFixed(1)} [${li.length}] pl>0 ${f2(gp.mean)} never ${(100 * li.filter((o) => !(o.ac > 0)).length / li.length).toFixed(0)}%`.padEnd(40);
  }
  console.log(s);
}
// 12 minutes
const B12 = all.filter((o) => o.pre.sT === 0 && o.s12.dnp === 1);
tab('bench, NOT in by 12: by share of his recent bench games in by 12 (pInB12)', B12.filter((o) => o.f.nB >= 2), 's12', (o) => o.f.pInB12, shareBins);
tab('bench, NOT in by 12: by share of recent TEAM games he played', B12.filter((o) => o.f.nT >= 3), 's12', (o) => o.f.nP / o.f.nT, [['0', 0, 0.001], ['<=25%', 0.001, 0.26], ['25-50%', 0.26, 0.51], ['50-75%', 0.51, 0.76], ['75-99%', 0.76, 0.999], ['100%', 0.999, 2]]);
tab('bench, NOT in by 12: by usual bench check-in minute', B12.filter((o) => o.f.nB >= 2), 's12', (o) => o.f.ciBMed, [['<6', 0, 6], ['6-9', 6, 9], ['9-12', 9, 12], ['12-13', 12, 13], ['13-15', 13, 15], ['15-18', 15, 18], ['18-24', 18, 24], ['24+', 24, 99]]);
tab('bench, NOT in by 12: bench mates already in (nBenchIn12)', B12, 's12', (o) => o.f.nBenchIn12, [['0-1', 0, 2], ['2', 2, 3], ['3', 3, 4], ['4', 4, 5], ['5+', 5, 9]]);
// in by 6 bench: earlier than usual?
const I6 = all.filter((o) => o.pre.sT === 0 && o.s6.dnp === 0);
tab('bench, IN by 6: by share of his bench games in by 6 (pInB6)', I6.filter((o) => o.f.nB >= 2), 's6', (o) => o.f.pInB6, shareBins);
tab('bench, IN by 6: no bench history', I6.filter((o) => o.f.nB < 2), 's6', () => 0.5, [['nB<2', 0, 1]]);
tab('bench, IN by 6: by tonight check-in minus usual (tIn6 - ciBMed)', I6.filter((o) => o.f.nB >= 2), 's6', (o) => o.f.tIn6 - o.f.ciBMed, [['6+ early', -99, -6], ['3-6 early', -6, -3], ['1-3 early', -3, -1], ['about usual', -1, 1], ['later', 1, 99]]);
const I12 = all.filter((o) => o.pre.sT === 0 && o.s12.dnp === 0 && o.s6.dnp === 1);
tab('bench, came in between 6 and 12: tonight check-in minus usual (tIn12 - ciBMed) @s12', I12.filter((o) => o.f.nB >= 2), 's12', (o) => o.f.tIn12 - o.f.ciBMed, [['6+ early', -99, -6], ['3-6 early', -6, -3], ['1-3 early', -3, -1], ['about usual', -1, 1], ['1-3 late', 1, 3], ['3+ late', 3, 99]]);
