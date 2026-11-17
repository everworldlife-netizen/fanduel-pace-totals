#!/usr/bin/env node
/* mid-37: the engine's "benched" discount (1/(1+exp((missed-7)/1.2))) undone for players who are NOT in tonight's starting
 * five: new remaining = engine remaining / discount (capped at the time left). No fitting. Miss before/after for the
 * reserves it touches (usual minutes missed >= 3) and for the whole stage; 2026 (all) and 2027. Also the mirror test:
 * for tonight's STARTERS make the discount harsher (M50 4 instead of 7). */
'use strict';
const C = require('./mid-common');
const b = (m, m50) => 1 / (1 + Math.exp((m - m50) / 1.2));
const mae = (T, p) => (T.length ? T.reduce((a, r) => a + Math.abs(r.ac0 - p(r)), 0) / T.length : NaN);
for (const y of [2026, 2027]) {
  const rows = C.load(y);
  for (const g of ['s18', 's24', 's30']) {
    const T = rows.filter((r) => r.g === g && C.p10(r));
    const sitR = (r) => r.sT === 0 && !r.on && !r.dnp && r.hN >= 3 && r.hMissed >= 3;
    const pR = (r) => (sitR(r) ? r.now0 + Math.min(48 - r.el, r.erem / b(r.hMissed, 7)) : r.mn0);
    const sitS = (r) => r.sT === 1 && !r.on && r.hN >= 3 && r.hMissed >= 3 && r.pf < (g === 's18' ? 2 : g === 's24' ? 3 : 4);
    const pS = (r) => (sitS(r) ? r.now0 + r.erem * b(r.hMissed, 4) / b(r.hMissed, 7) : r.mn0);
    const A = T.filter(sitR), S = T.filter(sitS);
    console.log(`${y} ${g}: reserves, discount undone (${A.length} players): ${mae(A, (r) => r.mn0).toFixed(3)} -> ${mae(A, pR).toFixed(3)} (${(100 * (mae(A, pR) / mae(A, (r) => r.mn0) - 1)).toFixed(1)}%), stage ${(100 * (mae(T, pR) / mae(T, (r) => r.mn0) - 1)).toFixed(2)}% | starters without foul trouble, harsher discount (${S.length}): ${mae(S, (r) => r.mn0).toFixed(3)} -> ${mae(S, pS).toFixed(3)} (${(100 * (mae(S, pS) / mae(S, (r) => r.mn0) - 1)).toFixed(1)}%), stage ${(100 * (mae(T, pS) / mae(T, (r) => r.mn0) - 1)).toFixed(2)}%`);
  }
}
