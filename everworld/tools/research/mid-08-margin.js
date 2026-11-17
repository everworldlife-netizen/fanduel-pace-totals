#!/usr/bin/env node
/* mid-08: lead at this moment x role tier -> second-half minutes. Per cell: n, real remaining, engine remaining,
 * gap (real - engine) with z, the gap left after a plain refit (res) and after refit + flat + flatLop (res2).
 * Tiers by usual minutes (mpg). Margin from the player's side (+ = his team leads). */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const season = +process.argv[2] || 2026;
const flat = (r) => clamp((0.5 * (48 - r.el) - r.erem) / r.erem, -1, 4);
const lop = (r) => clamp((Math.abs(r.mg) - 8) / 10, 0, 2.5);
const EX = [flat, (r) => flat(r) * lop(r)];
const rows = F.addResid(C.load(season).filter((r) => ['s18', 's24', 's30'].includes(r.g)));
for (const g of ['s18', 's24', 's30']) { const R = rows.filter((r) => r.g === g); const o = F.fit(R, EX); for (const r of R) r.res2 = r.ac0 != null ? r.ac0 - F.predict(r, o.beta, EX) : null; }
const tiers = [['32+', 32, 99], ['28-32', 28, 32], ['24-28', 24, 28], ['18-24', 18, 24], ['12-18', 12, 18], ['<12', 0, 12]];
const mbins = [['trail 24+', -99, -24], ['trail 16-23', -23, -16], ['trail 8-15', -15, -8], ['within 7', -7, 7], ['lead 8-15', 8, 15], ['lead 16-23', 16, 23], ['lead 24+', 24, 99]];
for (const g of ['s24', 's30']) {
  console.log(`\n===== ${g}: margin now x usual-minutes tier (cells: n | real rem / engine rem | gap z | res z | res2 z) =====`);
  for (const [tn, lo, hi] of tiers) {
    console.log(` tier ${tn} mpg`);
    for (const [mn, a, b] of mbins) {
      const B = rows.filter((r) => r.g === g && r.ac0 != null && r.mpg >= lo && r.mpg < hi && r.mg >= a && r.mg <= b);
      if (B.length < 40) continue;
      const re = C.cl(B, (r) => r.rem), en = C.cl(B, (r) => r.erem), gp = C.cl(B, (r) => r.gap), rs = C.cl(B, (r) => r.res), r2 = C.cl(B, (r) => r.res2);
      console.log(`   ${mn.padEnd(12)} n=${String(B.length).padStart(5)} | real ${re.mean.toFixed(2).padStart(5)} eng ${en.mean.toFixed(2).padStart(5)} | gap ${C.fmt(gp.mean, 2)} z ${C.fmt(gp.z, 1).padStart(6)} | res ${C.fmt(rs.mean, 2)} z ${C.fmt(rs.z, 1).padStart(5)} | res2 ${C.fmt(r2.mean, 2)} z ${C.fmt(r2.z, 1).padStart(5)}`);
    }
  }
}
