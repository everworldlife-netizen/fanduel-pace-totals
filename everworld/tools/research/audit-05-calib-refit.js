#!/usr/bin/env node
'use strict';
/* Audit, step 5: the calibration bands of step 4 again, but on the minutes AFTER the cross-fitted plain refit of the 49
 * inputs: is the "too spread out" shape something a refit of the existing layer removes?
 * Bands are of the REFIT's remaining minutes. Graded rows (live: everyone; before tip: played). */
const C = require('./audit-common');
const FIT = require('./audit-fit');
const D26 = C.load(2026), D27 = C.load(2027);
FIT.attach(D26, D27);
const role = (() => { const i = process.argv.indexOf('--role'); return i >= 0 ? process.argv[i + 1] : 'all'; })();
const BANDS = [[-99, 0.5], [0.5, 2], [2, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 99]];
console.log(`role ${role}. band of REFIT remaining minutes | 2026: rows  refit  real   gap     z | 2027: rows refit real gap z`);
for (const g of C.STAGES) {
  const lv = g !== 'rep' && g !== 'pre';
  for (const [lo, hi] of BANDS) {
    const o = [];
    for (const D of [D26, D27]) {
      const nG = D.nGames, s = new Float64Array(nG), n = new Float64Array(nG); let e = 0, a = 0, N = 0;
      for (const r of D.rows) {
        if (r.g !== g || !(lv || r._played)) continue;
        if (role !== 'all' && (role === 'starter') !== (r.st === 1)) continue;
        const rem = r._mR - r.now[0];
        if (!(rem >= lo && rem < hi)) continue;
        s[r._gi] += r._dR; n[r._gi]++; e += rem; a += r._a[0] - r.now[0]; N++;
      }
      const m = C.clusterMean(s, n); o.push({ N, e: e / N, a: a / N, m: m.m, z: m.z });
    }
    if (!o[0].N) continue;
    console.log(`${g.padEnd(4)} ${String(lo < 0 ? 0 : lo).padStart(4)}-${String(hi > 90 ? '+' : hi).padEnd(4)} | ${String(o[0].N).padStart(6)} ${C.f2(o[0].e)} ${C.f2(o[0].a)} ${C.f2(o[0].m)} ${C.f1(o[0].z, 6)} | ${String(o[1].N).padStart(5)} ${C.f2(o[1].e)} ${C.f2(o[1].a)} ${C.f2(o[1].m)} ${C.f1(o[1].z, 6)}`);
  }
}
