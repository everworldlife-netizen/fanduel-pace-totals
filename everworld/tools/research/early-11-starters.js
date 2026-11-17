#!/usr/bin/env node
/* early-11: players who START tonight, at tip-off / 6 / 12 min: gap (real - engine) by how often they started recently
 * and by usual minutes; the on/off state against the usual pattern; early fouls.
 *   node tools/research/early-11-starters.js [2026|2027] */
'use strict';
const C = require('./early-common');
const season = process.argv[2] || '2026';
const all = C.load(season).filter((o) => o.pre.sT === 1 && o.ac > 0);
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
function row(label, li) {
  if (li.length < 20) { console.log(label.padEnd(44) + ` n=${li.length}`); return; }
  let s = label.padEnd(44) + ` n=${String(li.length).padStart(5)} real ${(li.reduce((a, o) => a + o.ac, 0) / li.length).toFixed(1)}`;
  for (const st of ['pre', 's6', 's12']) { const g = C.cl(li, (o) => o.ac - o[st].mn[0]); const p = C.cl(li, (o) => o.ac - o[st].mp); s += ` | ${st}: ${f2(g.mean)} (${g.z.toFixed(1)}) plain ${f2(p.mean)}`; }
  console.log(s);
}
console.log('== starters tonight: gap real - engine number (z), and real - plain number, by recent start share and usual minutes ==');
const ss = (o) => (o.f.nP >= 2 ? o.f.startShare : null);
for (const [l, lo, hi] of [['start share 0', 0, 0.001], ['0-30%', 0.001, 0.3], ['30-70%', 0.3, 0.7], ['70-99%', 0.7, 0.999], ['100%', 0.999, 2]]) {
  row(l, all.filter((o) => ss(o) != null && ss(o) >= lo && ss(o) < hi));
  for (const [m, mlo, mhi] of [['mpg<18', 0, 18], ['18-24', 18, 24], ['24-30', 24, 30], ['30+', 30, 99]]) row('    ' + l + ', ' + m, all.filter((o) => ss(o) != null && ss(o) >= lo && ss(o) < hi && o.pre.mpg >= mlo && o.pre.mpg < mhi));
}
row('no history (nP<2)', all.filter((o) => o.f.nP < 2));
console.log('\n== reserves who start (start share < 30%): gap at s12 by minutes played in Q1 and by usual bench minutes ==');
const res = all.filter((o) => ss(o) != null && ss(o) < 0.3);
for (const [l, lo, hi] of [['Q1 min <6', 0, 6], ['6-8', 6, 8], ['8-10', 8, 10], ['10-12', 10, 12.1]]) row(l, res.filter((o) => o.s12.now[0] >= lo && o.s12.now[0] < hi));
for (const [l, lo, hi] of [['games in log 2-3', 2, 4], ['4-5', 4, 6], ['6-8', 6, 9]]) row('nP ' + l, res.filter((o) => o.f.nP >= lo && o.f.nP < hi));
// how many games in a row has he started? use lastPlayed + we don't have start flags per game; skip.
console.log('\n== starters at 12 min: on/off against the usual pattern (share of his recent starts in which he was on the floor at 12:00) ==');
for (const on of [1, 0]) for (const [l, lo, hi] of [['usually off (<=25%)', 0, 0.2501], ['mixed', 0.2501, 0.7499], ['usually on (>=75%)', 0.7499, 2]]) row(`${on ? 'ON ' : 'OFF'} at 12, ${l}`, all.filter((o) => o.s12.on === on && o.f.pOnS12 != null && o.f.pOnS12 >= lo && o.f.pOnS12 < hi));
console.log('\n== starters at 6 min: on/off against the usual pattern ==');
for (const on of [1, 0]) for (const [l, lo, hi] of [['usually off (<=25%)', 0, 0.2501], ['mixed', 0.2501, 0.7499], ['usually on (>=75%)', 0.7499, 2]]) row(`${on ? 'ON ' : 'OFF'} at 6, ${l}`, all.filter((o) => o.s6.on === on && o.f.pOnS6 != null && o.f.pOnS6 >= lo && o.f.pOnS6 < hi));
// slope of gap on (on - pOnS) at s12 and s6
for (const [st, el] of [['s6', 6], ['s12', 12]]) {
  const li = all.filter((o) => o.f['pOnS' + el] != null);
  const X = li.map((o) => [1, o[st].on - o.f['pOnS' + el], o[st].on]), y = li.map((o) => o.ac - o[st].mn[0]);
  const r = C.ols(X, y, li.map((o) => o.tg));
  const r1 = C.ols(li.map((o) => [1, o[st].on - o.f['pOnS' + el]]), y, li.map((o) => o.tg));
  console.log(`\n${st}: gap ~ a + b*(on - usual share on): b = ${r1.beta[1].toFixed(2)} (z ${r1.z[1].toFixed(1)}), n=${li.length} | with the raw on flag too: surprise ${r.beta[1].toFixed(2)} (z ${r.z[1].toFixed(1)}), on ${r.beta[2].toFixed(2)} (z ${r.z[2].toFixed(1)})`);
  const r2 = C.ols(li.map((o) => [1, o.f['pOnS' + el] * (1 - o[st].on), (1 - o.f['pOnS' + el]) * o[st].on]), y, li.map((o) => o.tg));
  console.log(`   split: off-when-usually-on ${r2.beta[1].toFixed(2)} (z ${r2.z[1].toFixed(1)}), on-when-usually-off ${r2.beta[2].toFixed(2)} (z ${r2.z[2].toFixed(1)})`);
}
console.log('\n== early fouls (starters) ==');
for (const [st, el] of [['s6', 6], ['s12', 12]]) for (const pf of [0, 1, 2, 3]) for (const on of [1, 0]) {
  const li = all.filter((o) => (pf === 3 ? o[st].pf >= 3 : o[st].pf === pf) && o[st].on === on);
  if (li.length < 20) continue; const g = C.cl(li, (o) => o.ac - o[st].mn[0]);
  console.log(`${st} pf${pf === 3 ? '>=3' : '=' + pf} ${on ? 'on ' : 'off'} n=${String(li.length).padStart(5)} real ${(li.reduce((a, o) => a + o.ac, 0) / li.length).toFixed(1)} engine ${(li.reduce((a, o) => a + o[st].mn[0], 0) / li.length).toFixed(1)} tip-off number ${(li.reduce((a, o) => a + o.pre.mn[0], 0) / li.length).toFixed(1)} gap ${f2(g.mean)} (z ${g.z.toFixed(1)})`);
}
