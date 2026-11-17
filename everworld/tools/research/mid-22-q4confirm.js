#!/usr/bin/env node
/* mid-22: the key cells of the Q4 table and of the mid-game margin x tier table, 2026 vs 2027 (raw gap = real - engine). */
'use strict';
const C = require('./mid-common');
const cells = [
  ['s36', '28+ mpg, 20+ either way after Q3', (r) => r.mpg >= 28 && Math.abs(r.mg) >= 20],
  ['s36', '28+ mpg, 25+ either way after Q3', (r) => r.mpg >= 28 && Math.abs(r.mg) >= 25],
  ['s36', '18-24 mpg, leading 20+ after Q3', (r) => r.mpg >= 18 && r.mpg < 24 && r.mg >= 20],
  ['s36', '<12 mpg, 20+ either way after Q3', (r) => r.mpg < 12 && Math.abs(r.mg) >= 20],
  ['s36', '<18 mpg, trailing 20+ after Q3', (r) => r.mpg < 18 && r.mg <= -20],
  ['s36', '28+ mpg, 8-14 either way after Q3', (r) => r.mpg >= 28 && Math.abs(r.mg) >= 8 && Math.abs(r.mg) <= 14],
  ['s30', '28+ mpg, 24+ either way at 30', (r) => r.mpg >= 28 && Math.abs(r.mg) >= 24],
  ['s30', '18-24 mpg, leading 16+ at 30', (r) => r.mpg >= 18 && r.mpg < 24 && r.mg >= 16],
  ['s30', '24-28 mpg, leading 16-23 at 30', (r) => r.mpg >= 24 && r.mpg < 28 && r.mg >= 16 && r.mg <= 23],
  ['s30', '<12 mpg, trailing 16+ at 30', (r) => r.mpg < 12 && r.mg <= -16],
  ['s30', '<12 mpg, leading 24+ at 30', (r) => r.mpg < 12 && r.mg >= 24],
  ['s24', '<12 mpg, trailing 16+ at half', (r) => r.mpg < 12 && r.mg <= -16],
  ['s24', '18-24 mpg, leading 16+ at half', (r) => r.mpg >= 18 && r.mpg < 24 && r.mg >= 16],
  ['s24', '28+ mpg, 24+ either way at half', (r) => r.mpg >= 28 && Math.abs(r.mg) >= 24],
  ['s24', '32+ mpg, trailing 8-15 at half', (r) => r.mpg >= 32 && r.mg <= -8 && r.mg >= -15],
];
const R = { 2026: C.load(2026).filter(C.played), 2027: C.load(2027).filter(C.played) };
for (const [g, nm, f] of cells) {
  let line = `${g} ${nm.padEnd(36)}`;
  for (const y of [2026, 2027]) {
    const B = R[y].filter((r) => r.g === g && f(r));
    const gp = C.cl(B, (r) => r.gap), en = C.cl(B, (r) => r.erem), re = C.cl(B, (r) => r.rem);
    line += ` | ${y}: n=${String(B.length).padStart(4)} tg=${String(gp.G).padStart(3)} eng ${en.mean.toFixed(1).padStart(4)} real ${re.mean.toFixed(1).padStart(4)} gap ${C.fmt(gp.mean, 2)} z ${C.fmt(gp.z, 1).padStart(5)}`;
  }
  console.log(line);
}
