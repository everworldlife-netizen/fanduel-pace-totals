#!/usr/bin/env node
/* late-08: overtime. How often a game goes to overtime by the margin at 36:00 and at 42:00 (unit = game), what the engine's
 * formula says (pOt = min(0.6, 1.8 * phi(m / sd) / sd), sd = 2.5 * sqrt(48 - el)), and whether the extra minutes are in
 * the number: team sum of engine remaining minutes vs 5 x time left, and the gap of the closers by margin. */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season);
const pOtEngine = (m, el) => { const sd = 2.5 * Math.sqrt(48 - el), z = m / sd; return Math.min(0.6, (1.8 * Math.exp(-0.5 * z * z)) / (sd * 2.5066)); };
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g), el = g === 's36' ? 36 : 42;
  const games = new Map();
  for (const r of A) { let x = games.get(r.id); if (!x) games.set(r.id, (x = { am: Math.abs(r.mg), ot: r.ot, len: r.len, sumE: {}, sumR: {}, sumReg: {} })); x.sumE[r.tm] = (x.sumE[r.tm] || 0) + r.erem; x.sumR[r.tm] = (x.sumR[r.tm] || 0) + (r.rem || 0); x.sumReg[r.tm] = (x.sumReg[r.tm] || 0) + r.remReg; }
  const G = [...games.values()];
  console.log(`\n== ${g} (${season}): ${G.length} games, ${G.filter((x) => x.ot).length} went to overtime (${(100 * G.filter((x) => x.ot).length / G.length).toFixed(1)}%)`);
  console.log('  |margin|   games   OT   real P(OT)   engine formula   team sum of engine remaining - 5 x left (=OT minutes inside the number, per team)   real OT minutes per team (projected players)');
  for (const [lo, hi] of [[0, 0], [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 13], [14, 17], [18, 99]]) {
    const S = G.filter((x) => x.am >= lo && x.am <= hi); if (!S.length) continue;
    const p = S.filter((x) => x.ot).length / S.length;
    const pe = S.reduce((s, x) => s + pOtEngine(x.am, el), 0) / S.length;
    let se = 0, sr = 0, n = 0; for (const x of S) for (const t of Object.keys(x.sumE)) { se += x.sumE[t] - 5 * (48 - el); sr += x.sumR[t] - x.sumReg[t]; n++; }
    console.log(`  ${String(lo).padStart(2)}-${String(hi).padEnd(2)}    ${String(S.length).padStart(5)} ${String(S.filter((x) => x.ot).length).padStart(4)}     ${(100 * p).toFixed(1).padStart(5)}%        ${(100 * pe).toFixed(1).padStart(5)}%          ${(se / n).toFixed(2).padStart(6)}                                  ${(sr / n).toFixed(2)}   (expected OT min per team if 25 x P: real ${(25 * p * 1.1).toFixed(2)})`);
  }
  // closers: on the floor, usual starters, by margin: gap split into regulation and overtime parts
  console.log('  players on the floor now, by |margin|: engine remaining, real regulation remaining, real OT minutes, gap');
  for (const [lo, hi] of [[0, 2], [3, 5], [6, 8], [9, 12]]) {
    const S = A.filter((r) => r.on && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi && r.ac0 != null);
    const e = C.cl(S, (r) => r.erem, (r) => r.id), rg = C.cl(S, (r) => r.remReg, (r) => r.id), ot = C.cl(S, (r) => r.remOT, (r) => r.id), gp = C.cl(S, (r) => r.gap, (r) => r.id);
    const noOT = S.filter((r) => !r.ot), gpN = C.cl(noOT, (r) => r.gap, (r) => r.id), wOT = S.filter((r) => r.ot), gpO = C.cl(wOT, (r) => r.gap, (r) => r.id);
    console.log(`   ${lo}-${hi}: n=${S.length} engine ${e.mean.toFixed(2)} | real regulation ${rg.mean.toFixed(2)} + OT ${ot.mean.toFixed(2)} | gap ${C.fmt(gp.mean, 2)} (z ${gp.z.toFixed(1)}) | games without OT: gap ${C.fmt(gpN.mean, 2)}; games with OT (n=${wOT.length}): gap ${C.fmt(gpO.mean, 2)}`);
  }
}
