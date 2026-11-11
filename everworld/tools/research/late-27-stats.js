#!/usr/bin/env node
/* late-27: end-of-game fouling and the stats. With the minutes he REALLY played from here plugged in (the engine's own
 * per-minute numbers), are points / rebounds / assists off in close games late? By the lead at 6:00 left and at the end of Q3.
 * gap = real stat - [stat so far + engine remaining stat x real remaining minutes / engine remaining minutes]. */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => r.ac && r.mn && r.erem >= 1 && r.rem >= 1);
const adj = (r, k) => r.ac[k] - (r.now[k] + Math.max(r.mn[k] - r.now[k], 0) * r.rem / r.erem);
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g);
  console.log(`\n== ${g} (${season}): players with 1+ real and engine minutes left, ${A.length} rows`);
  const sits = [
    ['all', () => true], ['on the floor', (r) => r.on],
    ['leading 1-4', (r) => r.mg >= 1 && r.mg <= 4], ['leading 5-9', (r) => r.mg >= 5 && r.mg <= 9], ['leading 10-15', (r) => r.mg >= 10 && r.mg <= 15],
    ['trailing 1-4', (r) => r.mg <= -1 && r.mg >= -4], ['trailing 5-9', (r) => r.mg <= -5 && r.mg >= -9], ['trailing 10-15', (r) => r.mg <= -10 && r.mg >= -15],
    ['within 9, either side', (r) => Math.abs(r.mg) <= 9], ['16+ either side', (r) => Math.abs(r.mg) >= 16],
    ['leading 1-9, high usage (25%+)', (r) => r.mg >= 1 && r.mg <= 9 && r.usg >= 0.25], ['trailing 1-9, high usage (25%+)', (r) => r.mg <= -1 && r.mg >= -9 && r.usg >= 0.25],
    ['leading 1-9, low usage (<17%)', (r) => r.mg >= 1 && r.mg <= 9 && r.usg < 0.17], ['trailing 1-9, low usage (<17%)', (r) => r.mg <= -1 && r.mg >= -9 && r.usg < 0.17],
    ['game went to overtime (outcome, not usable live)', (r) => r.ot === 1],
    ['16+ deep bench (<14)', (r) => Math.abs(r.mg) >= 16 && r.mpg < 14], ['16+ usual starters', (r) => Math.abs(r.mg) >= 16 && r.st === 1],
  ];
  for (const [nm, f] of sits) {
    const S = A.filter(f); if (S.length < 30) continue;
    const p = C.cl(S, (r) => adj(r, 1)), rb = C.cl(S, (r) => adj(r, 2)), as = C.cl(S, (r) => adj(r, 3));
    const pm = C.cl(S, (r) => r.rem).mean;
    console.log(`  ${nm.padEnd(46)} n=${String(S.length).padStart(5)} tg=${String(p.G).padStart(4)} (real min left ${pm.toFixed(1)}) | PTS ${C.fmt(p.mean, 2)} z ${p.z.toFixed(1).padStart(5)} | REB ${C.fmt(rb.mean, 2)} z ${rb.z.toFixed(1).padStart(5)} | AST ${C.fmt(as.mean, 2)} z ${as.z.toFixed(1).padStart(5)}`);
  }
}
