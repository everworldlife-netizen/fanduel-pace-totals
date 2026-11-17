#!/usr/bin/env node
/* late-28: per-minute production from here to the end, real vs engine, as ratios of sums (no per-player scaling):
 * real = sum(final - so far) / sum(real minutes left); engine = sum(engine final - so far) / sum(engine minutes left).
 * By margin class and role at s36 / s42. z from the per-player difference (real stat left - engine rate of the GROUP x real
 * minutes left), clustered by team-game. 2026 and 2027. */
'use strict';
const C = require('./late-common');
for (const season of [2026, 2027]) {
  const rows = C.load(season).filter((r) => r.ac && r.mn);
  for (const g of ['s36', 's42']) {
    const A = rows.filter((r) => r.g === g);
    console.log(`\n== ${g} (${season})`);
    const sits = [
      ['all', () => true], ['within 9', (r) => Math.abs(r.mg) <= 9], ['10-15', (r) => Math.abs(r.mg) >= 10 && Math.abs(r.mg) <= 15], ['16+', (r) => Math.abs(r.mg) >= 16],
      ['16+ leading', (r) => r.mg >= 16], ['16+ trailing', (r) => r.mg <= -16],
      ['16+ usual starters', (r) => Math.abs(r.mg) >= 16 && r.st === 1], ['16+ bench 14-24', (r) => Math.abs(r.mg) >= 16 && r.st !== 1 && r.mpg >= 14], ['16+ deep bench', (r) => Math.abs(r.mg) >= 16 && r.mpg < 14],
      ['within 9 leading, on floor', (r) => r.mg >= 1 && r.mg <= 9 && r.on], ['within 9 trailing, on floor', (r) => r.mg <= -1 && r.mg >= -9 && r.on],
      ['trailing 10-15', (r) => r.mg <= -10 && r.mg >= -15], ['leading 10-15', (r) => r.mg >= 10 && r.mg <= 15],
    ];
    for (const [nm, f] of sits) {
      const S = A.filter(f); if (S.length < 30) continue;
      const sR = S.reduce((s, r) => s + r.rem, 0), sE = S.reduce((s, r) => s + r.erem, 0);
      const out = [];
      for (const [k, kn] of [[1, 'PTS'], [2, 'REB'], [3, 'AST']]) {
        const rr = S.reduce((s, r) => s + (r.ac[k] - r.now[k]), 0) / sR, re = S.reduce((s, r) => s + (r.mn[k] - r.now[k]), 0) / sE;
        const d = C.cl(S, (r) => (r.ac[k] - r.now[k]) - re * r.rem);
        out.push(`${kn} per min: real ${rr.toFixed(3)} engine ${re.toFixed(3)} (${C.fmt(100 * (rr / re - 1), 1)}%, z ${d.z.toFixed(1)})`);
      }
      console.log(`  ${nm.padEnd(28)} n=${String(S.length).padStart(5)} min left real ${(sR / S.length).toFixed(2)} eng ${(sE / S.length).toFixed(2)} | ` + out.join(' | '));
    }
  }
}
