#!/usr/bin/env node
/* late-05: inside the cells that the plain refit misses: which extra facts sort the residual?
 * Prints the mean residual (real - refit) by bins of candidate facts, with z clustered by team-game. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const rows = C.load(2026);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const by = {};
for (const g of ['s36', 's42']) { const A = rows.filter((r) => r.g === g); const o = F.fit(A, null); for (const r of A) { r.fitted = F.predict(r, o.beta, null); r.res = (r.ac0 != null ? r.ac0 : r.now0) - r.fitted; } by[g] = A; }
function table(title, S, f, cuts, labels) {
  const out = [];
  for (let i = 0; i <= cuts.length; i++) {
    const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
    const T = S.filter((r) => { const v = f(r); return v != null && v >= lo && v < hi; });
    if (T.length < 25) { out.push(`${labels ? labels[i] : `[${lo},${hi})`}: n${T.length}`); continue; }
    const c = C.cl(T, (r) => r.res), e = C.cl(T, (r) => r.fitted - r.now0), a = C.cl(T, (r) => r.rem);
    out.push(`${labels ? labels[i] : `[${lo},${hi})`}: ${C.fmt(c.mean, 2)} z${c.z.toFixed(1)} (eng ${e.mean.toFixed(1)} real ${a.mean.toFixed(1)} n${c.n})`);
  }
  console.log(`  ${title.padEnd(34)} ` + out.join(' | '));
}
const A42 = by.s42, A36 = by.s36;
console.log('\n== s42, usual starters OFF the floor, game within 10');
{ const S = A42.filter((r) => role(r) === 'S' && !r.on && Math.abs(r.mg) <= 10);
  table('sat for (min)', S, (r) => r.sitFor, [1, 2, 3, 4.5, 6, 9, 12]);
  table('fouls', S, (r) => r.pf, [3, 4, 5, 6], ['0-2', '3', '4', '5', '6']);
  table('usual minutes', S, (r) => r.mpg, [27, 30, 33]);
  table('closing share A (last 6, close)', S, (r) => (r.cgNA ? r.cgShA : null), [0.2, 0.4, 0.6, 0.8]);
  table('closing rank A', S, (r) => (r.cgNA ? r.cgRkA : null), [2, 4, 6, 8]);
  table('closing share X', S, (r) => (r.cgNX ? r.cgShX : null), [0.2, 0.4, 0.6, 0.8]);
  table('minutes tonight vs usual', S, (r) => r.now0 - r.mpg * 42 / 48, [-8, -4, -1, 2]);
  table('started tonight', S, (r) => r.sT, [0.5], ['no', 'yes']);
  table('own starters on floor', S, (r) => r.stOn, [1, 2, 3, 4]);
  table('margin', S, (r) => r.mg, [-6, -2, 3, 7]);
  table('margin swing last 6', S, (r) => r.d6, [-8, -3, 3, 8]);
}
console.log('\n== s42, usual starters ON the floor, by margin and own starters on floor');
{ for (const [lo, hi] of [[-99, -21], [-20, -16], [-15, -11], [-10, 10], [11, 15], [16, 20], [21, 99]]) {
    const S = A42.filter((r) => role(r) === 'S' && r.on && r.mg >= lo && r.mg <= hi);
    table(`mg ${lo}..${hi}: own starters on`, S, (r) => r.stOn, [2, 3, 4, 5], ['1', '2', '3', '4', '5']);
    table(`mg ${lo}..${hi}: opp starters on`, S, (r) => r.oStOn, [1, 2, 3, 4, 5], ['0', '1', '2', '3', '4', '5']);
    table(`mg ${lo}..${hi}: swing last 6`, S, (r) => r.d6, [-8, -3, 3, 8]);
    table(`mg ${lo}..${hi}: stint so far`, S, (r) => r.stintNow, [2, 4, 6, 9]);
  } }
console.log('\n== s42, usual starters OFF, lopsided: by margin and own starters on floor');
{ for (const [lo, hi] of [[-99, -21], [-20, -16], [-15, -11], [11, 15], [16, 20], [21, 99]]) {
    const S = A42.filter((r) => role(r) === 'S' && !r.on && r.mg >= lo && r.mg <= hi);
    table(`mg ${lo}..${hi}: own starters on`, S, (r) => r.stOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4']);
    table(`mg ${lo}..${hi}: sat for`, S, (r) => r.sitFor, [2, 4, 6, 9]);
    table(`mg ${lo}..${hi}: swing last 6`, S, (r) => r.d6, [-8, -3, 3, 8]);
  } }
console.log('\n== s42, deep bench (usual < 14 min): on / off by margin and own starters on');
{ for (const on of [1, 0]) for (const [lo, hi] of [[0, 10], [11, 15], [16, 20], [21, 99]]) {
    const S = A42.filter((r) => role(r) === 'D' && r.on === on && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: own starters on`, S, (r) => r.stOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: usual minutes`, S, (r) => r.mpg, [5, 8, 11]);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: minutes tonight`, S, (r) => r.now0, [4, 8, 12, 18]);
  } }
console.log('\n== s42, bench 14+: on / off by margin and own starters on');
{ for (const on of [1, 0]) for (const [lo, hi] of [[0, 10], [11, 15], [16, 20], [21, 99]]) {
    const S = A42.filter((r) => role(r) === 'B' && r.on === on && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: own starters on`, S, (r) => r.stOn, [1, 2, 3, 4], ['0', '1', '2', '3', '4+']);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: sat for`, S, (r) => (on ? null : r.sitFor), [2, 4, 6, 9]);
    table(`${on ? 'ON' : 'OFF'} |mg| ${lo}..${hi}: closing share A`, S, (r) => (r.cgNA ? r.cgShA : null), [0.15, 0.35, 0.6]);
  } }
