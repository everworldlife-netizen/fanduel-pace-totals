#!/usr/bin/env node
'use strict';
/* Audit, step 4: is the engine's own "minutes still to come" calibrated? Bands of the engine's remaining minutes at each
 * stage, by role: engine remaining vs real remaining (graded rows: live = everyone, never got in = 0; before tip = played).
 *   node tools/research/audit-04-calib.js [--role reserve|starter|all] */
const C = require('./audit-common');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const role = arg('--role', 'all');
const BANDS = [[-99, 0.5], [0.5, 2], [2, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 99]];
const out = {};
for (const season of [2026, 2027]) {
  const D = C.load(season), nG = D.nGames;
  for (const g of C.STAGES) {
    const lv = g !== 'rep' && g !== 'pre';
    const rows = D.rows.filter((r) => r.g === g && (lv || r._played) && (role === 'all' || (role === 'starter') === (r.st === 1)));
    BANDS.forEach(([lo, hi], bi) => {
      const s = new Float64Array(nG), n = new Float64Array(nG); let e = 0, a = 0, N = 0, n10 = 0, miss = 0;
      for (const r of rows) { if (!(r._remE >= lo && r._remE < hi)) continue; s[r._gi] += r._d[0]; n[r._gi]++; e += r._remE; a += r._a[0] - r.now[0]; N++; if (r._p10) { n10++; miss += r._e[0]; } }
      const m = C.clusterMean(s, n);
      (out[g] = out[g] || {})[bi] = Object.assign((out[g] || {})[bi] || {}, { [season]: { N, e: e / N, a: a / N, m: m.m, z: m.z, n10, miss: miss / n10 } });
    });
  }
}
console.log(`role ${role}. band of engine remaining minutes | 2026: rows  engine  real   gap     z   miss(10+) | 2027: rows engine real gap z`);
for (const g of C.STAGES) for (let bi = 0; bi < BANDS.length; bi++) {
  const a = out[g][bi][2026], b = out[g][bi][2027];
  if (!a.N) continue;
  console.log(`${g.padEnd(4)} ${String(BANDS[bi][0] < 0 ? 0 : BANDS[bi][0]).padStart(4)}-${String(BANDS[bi][1] > 90 ? '+' : BANDS[bi][1]).padEnd(4)} | ${String(a.N).padStart(6)} ${C.f2(a.e)} ${C.f2(a.a)} ${C.f2(a.m)} ${C.f1(a.z, 6)} ${C.f2(a.miss)} | ${String(b.N).padStart(5)} ${C.f2(b.e)} ${C.f2(b.a)} ${C.f2(b.m)} ${C.f1(b.z, 6)}`);
}
