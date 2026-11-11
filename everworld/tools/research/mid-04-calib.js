#!/usr/bin/env node
/* mid-04: is the engine's remaining-minutes number calibrated? Bins of engine remaining, by stage and on/off:
 * real remaining vs engine remaining (raw), and after the plain refit. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const season = +process.argv[2] || 2026;
const rows = F.addResid(C.load(season).filter((r) => ['s18', 's24', 's30'].includes(r.g)));
const bins = [0, 0.25, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 30];
for (const g of ['s18', 's24', 's30']) for (const grp of ['on', 'off']) {
  const A = rows.filter((r) => r.g === g && r.ac0 != null && (grp === 'on' ? r.on : !r.on && !r.dnp));
  console.log(`\n== ${g} ${grp}: engine remaining bin -> n, engine rem, real rem, gap (z), gap after plain refit (z)`);
  for (let i = 0; i < bins.length - 1; i++) {
    const B = A.filter((r) => r.erem >= bins[i] && r.erem < bins[i + 1]);
    if (B.length < 40) continue;
    const e = C.cl(B, (r) => r.erem), a = C.cl(B, (r) => r.rem), gp = C.cl(B, (r) => r.gap), rs = C.cl(B, (r) => r.res);
    console.log(`  ${String(bins[i]).padStart(5)}-${String(bins[i + 1]).padEnd(5)} n=${String(B.length).padStart(5)}  eng ${e.mean.toFixed(2).padStart(6)}  real ${a.mean.toFixed(2).padStart(6)}  gap ${C.fmt(gp.mean, 2)} (z ${C.fmt(gp.z, 1)})  res ${C.fmt(rs.mean, 2)} (z ${C.fmt(rs.z, 1)})`);
  }
}
