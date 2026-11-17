#!/usr/bin/env node
/* mid-32: rule 6 for the rare situations, done the literal way: the effect = the average gap (real - number) inside the
 * situation on the first half of 2026; add that constant to the players in the situation on the second half; miss before
 * and after (10+ minute players), inside the situation and over the whole stage. Two "numbers" are corrected:
 *   E = the engine as it is;   M = the stage's general model (plain refit + flat/flatLop/paceT/onB/offS/lopTier), fitted on the first half.
 * Also the same constant applied to 2027 (engine as it is). */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE, C, F } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const lastPf = (r) => (r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99);
const satSinceFoul = (r) => !r.on && r.pfAt.length && (r.el - r.sitFor) >= lastPf(r) - 0.1 && (r.el - r.sitFor) <= lastPf(r) + 1.5;
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const onB = (r) => (r.sT === 0 && r.on ? 1 : 0), offS = (r) => (r.sT === 1 && !r.on ? 1 : 0), lopTier = (r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5);
const gen = { s18: [BASE.flat, BASE.flatLop, offS], s24: [BASE.flat, BASE.flatLop, paceT], s30: [BASE.flat, onB, offS, lopTier] };
const S = [
  ['s24', 'foulSeat: 3-4 fouls, pulled for the foul, sat 4+ min to the half', (r) => r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4],
  ['s24', 'foulSeat, starters tonight, sat 8+', (r) => r.sT === 1 && r.pf === 3 && satSinceFoul(r) && r.sitFor >= 8],
  ['s30', 'starterGone: starter, off 2.5+ min, <=3 fouls, within 15', (r) => r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15],
  ['s30', 'starterGone: never started the second half', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3 && Math.abs(r.mg) < 15],
  ['s30', 'benchMissed: reserve, off, 6+ usual minutes missed', (r) => r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6],
  ['s24', 'benchMissed: reserve, off, 6+ usual minutes missed', (r) => r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6],
];
const { R26, R27 } = K.data();
const mae = (T, p) => (T.length ? T.reduce((a, r) => a + Math.abs(r.ac0 - p(r)), 0) / T.length : NaN);
for (const [g, nm, f] of S) {
  const R = R26.filter((r) => r.g === g), R7 = R27.filter((r) => r.g === g);
  const { A, B } = F.splitByDate(R);
  const ex = gen[g], a = F.fit(A, ex);
  const pm = (r) => F.predict(r, a.beta, ex);
  const As = A.filter((r) => C.played(r) && f(r)), Bs = B.filter((r) => C.p10(r) && f(r)), Ball = B.filter(C.p10), R7s = R7.filter((r) => C.p10(r) && f(r)), R7all = R7.filter(C.p10);
  const dE = As.reduce((s, r) => s + r.ac0 - r.mn0, 0) / As.length, dM = As.reduce((s, r) => s + r.ac0 - pm(r), 0) / As.length;
  const pE = (r) => r.mn0, pE2 = (r) => (f(r) ? Math.max(r.now0, r.mn0 + dE) : r.mn0), pM2 = (r) => (f(r) ? Math.max(r.now0, pm(r) + dM) : pm(r));
  console.log(`\n${g} ${nm}`);
  console.log(`   first half: ${As.length} players, constant vs engine ${C.fmt(dE, 2)} min, vs general model ${C.fmt(dM, 2)} min`);
  console.log(`   second half, in the situation (${Bs.length} players 10+): engine ${mae(Bs, pE).toFixed(3)} -> ${mae(Bs, pE2).toFixed(3)} (${(100 * (mae(Bs, pE2) / mae(Bs, pE) - 1)).toFixed(1)}%); general model ${mae(Bs, pm).toFixed(3)} -> ${mae(Bs, pM2).toFixed(3)} (${(100 * (mae(Bs, pM2) / mae(Bs, pm) - 1)).toFixed(1)}%)`);
  console.log(`   second half, whole stage (${Ball.length}): engine ${mae(Ball, pE).toFixed(4)} -> ${mae(Ball, pE2).toFixed(4)} (${(100 * (mae(Ball, pE2) / mae(Ball, pE) - 1)).toFixed(2)}%); general model ${mae(Ball, pm).toFixed(4)} -> ${mae(Ball, pM2).toFixed(4)} (${(100 * (mae(Ball, pM2) / mae(Ball, pm) - 1)).toFixed(2)}%)`);
  const dE26 = R.filter((r) => C.played(r) && f(r)); const dAll = dE26.reduce((s, r) => s + r.ac0 - r.mn0, 0) / dE26.length;
  const p7 = (r) => (f(r) ? Math.max(r.now0, r.mn0 + dAll) : r.mn0);
  console.log(`   2027 (constant from all of 2026 = ${C.fmt(dAll, 2)}): in the situation (${R7s.length}) ${mae(R7s, pE).toFixed(3)} -> ${mae(R7s, p7).toFixed(3)} (${(100 * (mae(R7s, p7) / mae(R7s, pE) - 1)).toFixed(1)}%); whole stage ${(100 * (mae(R7all, p7) / mae(R7all, pE) - 1)).toFixed(2)}%`);
}
