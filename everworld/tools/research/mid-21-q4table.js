#!/usr/bin/env node
/* mid-21: what a lopsided score after three quarters really does to 4th-quarter minutes, by role tier, against what the
 * engine projects at that moment (s36 rows). Share = minutes really played after 36:00 / his usual Q4 minutes (own last 10).
 * This is the mechanism the mid-game simulation has to reproduce (it simulates the Q3 margin and then sets Q4 minutes). */
'use strict';
const C = require('./mid-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => r.g === 's36' && r.ac0 != null && r.hN >= 3);
const tiers = [['32+', 32, 99], ['28-32', 28, 32], ['24-28', 24, 28], ['18-24', 18, 24], ['12-18', 12, 18], ['<12', 0, 12]];
const mb = [['trail 25+', -99, -25], ['trail 20-24', -24, -20], ['trail 15-19', -19, -15], ['trail 8-14', -14, -8], ['within 7', -7, 7], ['lead 8-14', 8, 14], ['lead 15-19', 15, 19], ['lead 20-24', 20, 24], ['lead 25+', 25, 99]];
console.log(`season ${season}: Q4 minutes really played / usual Q4 minutes  [engine's projection / usual]  (n)`);
console.log('tier'.padEnd(8) + mb.map((m) => m[0].padStart(20)).join(''));
for (const [tn, lo, hi] of tiers) {
  let line = tn.padEnd(8);
  for (const [, a, b] of mb) {
    const B = rows.filter((r) => r.mpg >= lo && r.mpg < hi && r.mg >= a && r.mg <= b);
    if (B.length < 25) { line += '-'.padStart(20); continue; }
    const u = B.reduce((s, r) => s + r.hQ4, 0), re = B.reduce((s, r) => s + r.rem, 0), en = B.reduce((s, r) => s + r.erem, 0);
    line += `${(re / u).toFixed(2)} [${(en / u).toFixed(2)}] (${B.length})`.padStart(20);
  }
  console.log(line);
}
console.log('\nminutes: real Q4 / engine Q4 (mean per player)');
for (const [tn, lo, hi] of tiers) {
  let line = tn.padEnd(8);
  for (const [, a, b] of mb) {
    const B = rows.filter((r) => r.mpg >= lo && r.mpg < hi && r.mg >= a && r.mg <= b);
    if (B.length < 25) { line += '-'.padStart(20); continue; }
    line += `${(B.reduce((s, r) => s + r.rem, 0) / B.length).toFixed(1)} / ${(B.reduce((s, r) => s + r.erem, 0) / B.length).toFixed(1)}`.padStart(20);
  }
  console.log(line);
}
