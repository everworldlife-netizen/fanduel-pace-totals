#!/usr/bin/env node
'use strict';
/* Audit, step 9: tonight's lineup against the usual role, at tip-off and through the first half. Reserves who start and usual
 * starters who come off the bench, by usual minutes: engine before the learned layer (plain), as shown, real; gap and z. */
const C = require('./audit-common');
const D = { 2026: C.load(2026), 2027: C.load(2027) };
const stages = (process.argv[2] || 'pre,s6,s12,s18,s24,s30').split(',');
const MP = [[0, 12], [12, 18], [18, 24], [24, 30], [30, 99]];
for (const g of stages) {
  console.log(`\n${g}: group | usual minutes | 2026 rows tg | plain shown real | gap z | cap hit (share at +150%) || 2027 rows | shown real | gap z`);
  for (const [gn, gf] of [['reserve who starts (st=0,sT=1)', (r) => r.st !== 1 && r.sT === 1], ['usual starter off the bench (st=1,sT=0)', (r) => r.st === 1 && r.sT === 0], ['starts, startUp input > 0.5', (r) => r.x[C.IX.startUp] > 0.5], ['starts, startUp 0..0.5', (r) => r.sT === 1 && r.x[C.IX.startUp] > 0 && r.x[C.IX.startUp] <= 0.5]]) for (const [lo, hi] of MP) {
    const o = {};
    for (const y of [2026, 2027]) {
      const nG = D[y].nGames, s = new Float64Array(nG), n = new Float64Array(nG); let N = 0, pl = 0, sh = 0, re = 0, cap = 0; const tg = new Set();
      for (const r of D[y].rows) { if (r.g !== g || !gf(r) || !(r.mpg >= lo && r.mpg < hi)) continue; if (!(r._played || r._s >= 2)) continue; s[r._gi] += r._d[0]; n[r._gi]++; N++; pl += r.mp; sh += r.mn[0]; re += r._a[0]; tg.add(r.id + ':' + r.tm); if (r.mp - r.now[0] > 0.25 && (r.mn[0] - r.now[0]) / (r.mp - r.now[0]) >= 2.45) cap++; }
      const m = C.clusterMean(s, n); o[y] = { N, pl: pl / N, sh: sh / N, re: re / N, m: m.m, z: m.z, tg: tg.size, cap: cap / N };
    }
    const a = o[2026], b = o[2027]; if (a.N < 20) continue;
    console.log(`${gn.padEnd(40)} ${String(lo).padStart(2)}-${String(hi > 90 ? '+' : hi).padEnd(2)} | ${String(a.N).padStart(5)} ${String(a.tg).padStart(4)} | ${C.f2(a.pl)} ${C.f2(a.sh)} ${C.f2(a.re)} | ${C.f2(a.m)} ${C.f1(a.z, 6)} | ${(100 * a.cap).toFixed(0).padStart(3)}% || ${String(b.N).padStart(4)} | ${C.f2(b.sh)} ${C.f2(b.re)} | ${C.f2(b.m)} ${C.f1(b.z, 6)}`);
  }
}
