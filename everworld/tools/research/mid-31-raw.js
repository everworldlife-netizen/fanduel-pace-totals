#!/usr/bin/env node
/* mid-31: raw situation gaps for the report (rule 5: real - engine minutes, players who played; z by team-game),
 * 2026 and 2027 side by side, plus the engine's remaining vs the real remaining and the 10+ miss in the situation. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const R = { 2026: F.addResid(C.load(2026).filter((r) => ['s18', 's24', 's30'].includes(r.g))).filter(C.played), 2027: C.load(2027).filter(C.played) };
const half = (r) => 0.5 * (48 - r.el);
const S = [
  ['s18', 'engine remaining <= half-left - 5', (r) => r.erem <= half(r) - 5],
  ['s18', 'engine remaining >= half-left + 5', (r) => r.erem >= half(r) + 5],
  ['s24', 'engine remaining <= half-left - 4', (r) => r.erem <= half(r) - 4],
  ['s24', 'engine remaining >= half-left + 4', (r) => r.erem >= half(r) + 4],
  ['s30', 'engine remaining <= half-left - 3', (r) => r.erem <= half(r) - 3],
  ['s30', 'engine remaining >= half-left + 3', (r) => r.erem >= half(r) + 3],
  ['s24', 'lopsided (16+) & engine rem <= half-left - 4', (r) => Math.abs(r.mg) >= 16 && r.erem <= half(r) - 4],
  ['s24', 'lopsided (16+) & engine rem >= half-left + 4', (r) => Math.abs(r.mg) >= 16 && r.erem >= half(r) + 4],
  ['s24', 'close (<=7) & engine rem <= half-left - 4', (r) => Math.abs(r.mg) <= 7 && r.erem <= half(r) - 4],
  ['s24', 'close (<=7) & engine rem >= half-left + 4', (r) => Math.abs(r.mg) <= 7 && r.erem >= half(r) + 4],
  ['s24', 'first-half minutes - engine 2nd-half number >= +4', (r) => r.now0 - r.erem >= 4],
  ['s24', 'first-half minutes - engine 2nd-half number 2..4', (r) => r.now0 - r.erem >= 2 && r.now0 - r.erem < 4],
  ['s24', 'first-half minutes - engine 2nd-half number -2..2', (r) => Math.abs(r.now0 - r.erem) < 2],
  ['s24', 'first-half minutes - engine 2nd-half number -4..-2', (r) => r.now0 - r.erem <= -2 && r.now0 - r.erem > -4],
  ['s24', 'first-half minutes - engine 2nd-half number <= -4', (r) => r.now0 - r.erem <= -4],
  ['s18', 'starter tonight, off the floor at 18:00', (r) => r.sT === 1 && !r.on],
  ['s30', 'starter tonight, off the floor at 30:00', (r) => r.sT === 1 && !r.on],
  ['s30', 'reserve tonight, on the floor at 30:00', (r) => r.sT === 0 && r.on],
  ['s30', 'starter on since the half began', (r) => r.sT === 1 && r.on && r.stintNow >= 5.99],
  ['s18', 'starter, 2 fouls, on since the 2nd foul', (r) => r.sT === 1 && r.pf === 2 && r.on && r.pfAt.length && r.el - r.stintNow < r.pfAt[r.pfAt.length - 1]],
  ['s18', 'starter off 13+ min at 18:00', (r) => r.sT === 1 && !r.on && r.sitFor >= 13],
  ['s30', '4 fouls at 30:00', (r) => r.pf === 4],
  ['s24', 'reserve, 4+ more first-half minutes than usual', (r) => r.sT === 0 && r.hN >= 3 && r.now0 - r.hSoFar >= 4],
  ['s30', 'reserve, 4+ more minutes than usual by 30:00', (r) => r.sT === 0 && r.hN >= 3 && r.now0 - r.hSoFar >= 4],
];
for (const [g, nm, f] of S) {
  let line = `${g} ${nm.padEnd(50)}`;
  for (const y of [2026, 2027]) {
    const B = R[y].filter((r) => r.g === g && f(r));
    if (!B.length) { line += ` | ${y}: none`; continue; }
    const gp = C.cl(B, (r) => r.gap), en = C.cl(B, (r) => r.erem), re = C.cl(B, (r) => r.rem);
    const T = B.filter(C.p10), mae = T.length ? T.reduce((a, r) => a + Math.abs(r.ac0 - r.pr0), 0) / T.length : NaN;
    let extra = '';
    if (y === 2026) { const rs = C.cl(B, (r) => r.res); extra = ` (after plain refit ${C.fmt(rs.mean, 2)} z ${C.fmt(rs.z, 1)})`; }
    line += ` | ${y}: n=${String(B.length).padStart(5)} tg=${String(gp.G).padStart(4)} eng ${en.mean.toFixed(1).padStart(4)} real ${re.mean.toFixed(1).padStart(4)} gap ${C.fmt(gp.mean, 2)} z ${C.fmt(gp.z, 1).padStart(5)}${extra} miss ${mae.toFixed(2)}`;
  }
  console.log(line);
}
