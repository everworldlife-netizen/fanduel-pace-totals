#!/usr/bin/env node
/* mid-01: sanity + baseline. Miss per stage, bias by simple groups, consistency of the "on" flag with the stints. */
'use strict';
const C = require('./mid-common');
const season = +process.argv[2] || 2026;
const rows = C.load(season);
for (const g of ['s12', 's18', 's24', 's30', 's36']) {
  const A = rows.filter((r) => r.g === g);
  const P = A.filter(C.played), T = A.filter(C.p10);
  const mae = C.cl(T, (r) => Math.abs(r.ac0 - r.pr0)), maeMn = C.cl(T, (r) => Math.abs(r.ac0 - r.mn0)), maeMp = C.cl(T, (r) => Math.abs(r.ac0 - r.mp));
  console.log(`\n== ${g}: rows ${A.length}, played ${P.length}, 10+ ${T.length}; miss shown ${mae.mean.toFixed(3)}  miss mn ${maeMn.mean.toFixed(3)}  miss before learned layer ${maeMp.mean.toFixed(3)}`);
  console.log(C.line('all played: gap', P));
  console.log(C.line('  on now', P.filter((r) => r.on)));
  console.log(C.line('  off, has played', P.filter((r) => !r.on && !r.dnp)));
  console.log(C.line('  not checked in', P.filter((r) => r.dnp)));
  console.log(C.line('  usual starter (st)', P.filter((r) => r.st)));
  console.log(C.line('  started tonight (sT)', P.filter((r) => r.sT === 1)));
  console.log(C.line('  bench tonight (sT=0)', P.filter((r) => r.sT === 0)));
  const bad = A.filter((r) => r.on !== r.onChk).length, badSt = A.filter((r) => r.sT != null && r.sT !== r.stG).length;
  console.log(`  on flag vs stints disagree: ${bad}; sT vs stint-start disagree: ${badSt}; no history: ${A.filter((r) => !r.hN).length}`);
  // team sums
  const tg = new Map();
  for (const r of A) { let t = tg.get(r.tg); if (!t) tg.set(r.tg, (t = { mn: 0, ac: 0, ot: r.ot })); t.mn += r.mn0; t.ac += r.ac0 || 0; }
  const reg = [...tg.values()].filter((t) => !t.ot);
  const m = (f) => reg.reduce((a, t) => a + f(t), 0) / reg.length;
  console.log(`  team sums (regulation games, ${reg.length} team-games): engine ${m((t) => t.mn).toFixed(2)}, real (projected players) ${m((t) => t.ac).toFixed(2)}; OT share ${(1 - reg.length / tg.size).toFixed(3)}`);
}
