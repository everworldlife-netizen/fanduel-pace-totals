#!/usr/bin/env node
/* early-08: scan of early-game situations. For each situation: the gap real - number among players who PLAYED (rule 5),
 * against (a) the engine's number in the dump and (b) a clean re-teaching of the same 49 inputs (cross-fitted by date
 * halves on 2026; taught on 2026 for the 2027 check), taught on players who played. Also the everyone-listed view
 * (never in = what he has) against the engine and a clean all-listed re-teaching. z is clustered by team-game.
 *   node tools/research/early-08-scan.js [s6|s12] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6'; const EL = ST === 's6' ? 6 : 12;
const a26 = C.load('2026'), a27 = C.load('2027');
const r26 = Fx.prep(a26, ST), r27 = Fx.prep(a27, ST);
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const H1 = r26.filter((q) => q.d < mid), H2 = r26.filter((q) => q.d >= mid);
for (const [tr, te] of [[H1, H2], [H2, H1]]) { const bP = Fx.fit(tr, 'played'), bA = Fx.fit(tr, 'all'); for (const q of te) { q.pP = Fx.predict(q, bP.beta); q.pA = Fx.predict(q, bA.beta); } }
{ const bP = Fx.fit(r26, 'played'), bA = Fx.fit(r26, 'all'); for (const q of r27) { q.pP = Fx.predict(q, bP.beta); q.pA = Fx.predict(q, bA.beta); } }
const f = (q) => q.o.f; const S = (q) => q.o[ST];
const bench = (q) => q.o.pre.sT === 0, starter = (q) => q.o.pre.sT === 1;
const notIn = (q) => bench(q) && S(q).dnp === 1, isIn = (q) => bench(q) && S(q).dnp === 0;
const my = (q) => (f(q).ciBMed != null ? f(q).ciBMed : null);
const SITS = [
  // --- bench, not yet in ---
  ['notIn: all', notIn],
  ['notIn: usual check-in already passed (ciBMed <= now-1)', (q) => notIn(q) && f(q).nB >= 2 && my(q) <= EL - 1],
  ['notIn: usual check-in still ahead (ciBMed >= now+1), nB>=2', (q) => notIn(q) && f(q).nB >= 2 && my(q) >= EL + 1 && my(q) < 24],
  ['notIn: in by now in >=75% of his bench games', (q) => notIn(q) && f(q).nB >= 2 && f(q)['pInB' + EL] >= 0.75],
  ['notIn: never in by now in his bench games (nB>=3)', (q) => notIn(q) && f(q).nB >= 3 && f(q)['pInB' + EL] === 0],
  ['notIn: passed over by >=1 later-usual mate', (q) => notIn(q) && f(q)['passed' + EL] >= 1],
  ['notIn: passed over by >=2', (q) => notIn(q) && f(q)['passed' + EL] >= 2],
  ['notIn: 3+ bench mates already in', (q) => notIn(q) && f(q)['nBenchIn' + EL] >= 3],
  ['notIn: no bench mate in yet', (q) => notIn(q) && f(q)['nBenchIn' + EL] === 0],
  ['notIn: his turn passed (usual rank <= bench mates in)', (q) => notIn(q) && f(q).rankB != null && f(q).rankB <= f(q)['nBenchIn' + EL]],
  ['notIn: usual rank 1-2 off the bench', (q) => notIn(q) && f(q).rankB != null && f(q).rankB <= 2 && f(q).nB >= 2],
  ['notIn: did not play last team game', (q) => notIn(q) && f(q).nT >= 1 && f(q).lastPlayed[0] === '0'],
  ['notIn: did not play last 2 team games', (q) => notIn(q) && f(q).nT >= 2 && f(q).lastPlayed.slice(0, 2) === '00'],
  ['notIn: played all recent team games (nT>=4)', (q) => notIn(q) && f(q).nT >= 4 && f(q).nP === f(q).nT],
  ['notIn: played 50-99% of recent team games', (q) => notIn(q) && f(q).nT >= 4 && f(q).nP / f(q).nT >= 0.5 && f(q).nP < f(q).nT],
  ['notIn: played <50% of recent team games', (q) => notIn(q) && f(q).nT >= 4 && f(q).nP / f(q).nT < 0.5],
  ['notIn: usual starter (startShare>=0.6) on the bench', (q) => notIn(q) && f(q).nP >= 2 && f(q).startShare >= 0.6],
  ['notIn: a starter has 2+ fouls', (q) => notIn(q) && f(q)['stPf2_' + EL] >= 1],
  ['notIn: 2+ starters already off the floor', (q) => notIn(q) && f(q)['stOff' + EL] >= 2],
  // --- bench, in ---
  ['in: all', isIn],
  ['in: 6+ min earlier than his usual bench check-in', (q) => isIn(q) && f(q).nB >= 2 && my(q) - f(q)['tIn' + EL] >= 6],
  ['in: 3-6 min earlier than usual', (q) => isIn(q) && f(q).nB >= 2 && my(q) - f(q)['tIn' + EL] >= 3 && my(q) - f(q)['tIn' + EL] < 6],
  ['in: about usual (within 1.5)', (q) => isIn(q) && f(q).nB >= 2 && Math.abs(my(q) - f(q)['tIn' + EL]) < 1.5],
  ['in: 2+ min later than usual', (q) => isIn(q) && f(q).nB >= 2 && f(q)['tIn' + EL] - my(q) >= 2],
  ['in: never in by now in his bench games (nB>=2)', (q) => isIn(q) && f(q).nB >= 2 && f(q)['pInB' + EL] === 0],
  ['in: no bench history (nB<2)', (q) => isIn(q) && f(q).nB < 2],
  ['in: no bench history, usual starter (startShare>=0.6)', (q) => isIn(q) && f(q).nB < 2 && f(q).nP >= 2 && f(q).startShare >= 0.6],
  ['in: no history at all (nP<2)', (q) => isIn(q) && f(q).nP < 2],
  ['in: first bench player in for his team', (q) => isIn(q) && f(q)['firstSub' + EL] != null && Math.abs(f(q)['tIn' + EL] - f(q)['firstSub' + EL]) < 0.02],
  ['in: first in, but usual rank >=3', (q) => isIn(q) && f(q)['firstSub' + EL] != null && Math.abs(f(q)['tIn' + EL] - f(q)['firstSub' + EL]) < 0.02 && f(q).rankB >= 3],
  ['in: came in before 3:00 gone', (q) => isIn(q) && f(q)['tIn' + EL] < 3],
  ['in: early (3+) and a starter has 2+ fouls', (q) => isIn(q) && f(q).nB >= 2 && my(q) - f(q)['tIn' + EL] >= 3 && f(q)['stPf2_' + EL] >= 1],
  ['in: early (3+) and no starter with 2+ fouls', (q) => isIn(q) && f(q).nB >= 2 && my(q) - f(q)['tIn' + EL] >= 3 && f(q)['stPf2_' + EL] === 0],
  ['in: on the floor now', (q) => isIn(q) && S(q).on === 1],
  ['in: already back on the bench', (q) => isIn(q) && S(q).on === 0],
  // --- starters ---
  ['starter: all', starter],
  ['starter: on, never sat', (q) => starter(q) && S(q).on === 1 && S(q).now[0] >= EL - 0.02],
  ['starter: off now', (q) => starter(q) && S(q).on === 0],
  ['starter: off now, usually ON at this minute (pOnS>=0.75)', (q) => starter(q) && S(q).on === 0 && f(q)['pOnS' + EL] != null && f(q)['pOnS' + EL] >= 0.75],
  ['starter: off now, usually OFF at this minute (pOnS<=0.25)', (q) => starter(q) && S(q).on === 0 && f(q)['pOnS' + EL] != null && f(q)['pOnS' + EL] <= 0.25],
  ['starter: on now, usually OFF at this minute (pOnS<=0.25)', (q) => starter(q) && S(q).on === 1 && f(q)['pOnS' + EL] != null && f(q)['pOnS' + EL] <= 0.25],
  ['starter: on now, usually ON (pOnS>=0.75)', (q) => starter(q) && S(q).on === 1 && f(q)['pOnS' + EL] != null && f(q)['pOnS' + EL] >= 0.75],
  ['starter: subbed out 2+ min before his usual first rest', (q) => starter(q) && f(q)['tOut' + EL] != null && f(q).out1Med != null && f(q).out1Med - f(q)['tOut' + EL] >= 2],
  ['starter: subbed out 2+ early, no foul', (q) => starter(q) && f(q)['tOut' + EL] != null && f(q).out1Med != null && f(q).out1Med - f(q)['tOut' + EL] >= 2 && S(q).pf === 0],
  ['starter: subbed out 2+ early, 2+ fouls', (q) => starter(q) && f(q)['tOut' + EL] != null && f(q).out1Med != null && f(q).out1Med - f(q)['tOut' + EL] >= 2 && S(q).pf >= 2],
  ['starter: out before 3:00 gone, no foul', (q) => starter(q) && f(q)['tOut' + EL] != null && f(q)['tOut' + EL] < 3 && S(q).pf === 0],
  ['starter: still on 2+ min past his usual first rest', (q) => starter(q) && S(q).on === 1 && S(q).now[0] >= EL - 0.02 && f(q).out1Med != null && EL - f(q).out1Med >= 2],
  ['starter: 2+ fouls', (q) => starter(q) && S(q).pf >= 2],
  ['starter: 2+ fouls, still on', (q) => starter(q) && S(q).pf >= 2 && S(q).on === 1],
  ['starter: 2+ fouls, sitting', (q) => starter(q) && S(q).pf >= 2 && S(q).on === 0],
  ['starter: 1 foul', (q) => starter(q) && S(q).pf === 1],
  ['starter: reserve who starts (st=0)', (q) => starter(q) && q.o.pre.st !== 1],
  ['starter: reserve who starts, startShare<0.3', (q) => starter(q) && f(q).nP >= 2 && f(q).startShare < 0.3],
  ['starter: reserve who starts, no history (nP<2)', (q) => starter(q) && f(q).nP < 2],
  ['starter: usual starter (startShare>=0.7)', (q) => starter(q) && f(q).nP >= 2 && f(q).startShare >= 0.7],
  ['starter: a fellow starter has 2+ fouls', (q) => starter(q) && S(q).pf < 2 && f(q)['stPf2_' + EL] >= 1],
  ['starter: team leads by 10+', (q) => starter(q) && S(q).mg >= 10],
  ['starter: team trails by 10+', (q) => starter(q) && S(q).mg <= -10],
  ['bench: team leads by 10+', (q) => bench(q) && S(q).mg >= 10],
  ['bench: team trails by 10+', (q) => bench(q) && S(q).mg <= -10],
  ['starter: hot start (track x>=1.5)', (q) => starter(q) && S(q).x[11] >= 1.5],
  ['starter: cold start (track x<=-1)', (q) => starter(q) && S(q).x[11] <= -1],
];
function stat(rows, sit, val) { const li = rows.filter(sit); if (li.length < 20) return { n: li.length, mean: NaN, z: NaN, G: 0 }; const m = new Map(); for (const q of li) { let a = m.get(q.tg); if (!a) m.set(q.tg, (a = [0, 0])); a[0] += val(q); a[1]++; } let Ssum = 0, N = 0; for (const a of m.values()) { Ssum += a[0]; N += a[1]; } const mean = Ssum / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; } const G = m.size; return { n: N, G, mean, z: mean / (Math.sqrt(v * G / (G - 1)) / N) }; }
const fm = (s) => (isNaN(s.mean) ? '   n/a      ' : `${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(2)} (${s.z.toFixed(1)})`.padEnd(13));
console.log(`stage ${ST}. Gap = real - number. P = players who played (>0); L = everyone listed (never in = what he has).`);
console.log('situation'.padEnd(58) + ' 2026: nP  team-g | P vs engine  | P vs clean   | L vs engine  | L vs clean   || 2027: nP | P vs engine  | P vs clean   | L vs clean');
const res = [];
for (const [name, sit] of SITS) {
  const pl = (q) => sit(q) && q.played;
  const a = stat(r26, pl, (q) => q.ac - q.eng), b = stat(r26, pl, (q) => q.ac - q.pP), c = stat(r26, sit, (q) => q.tgtAll - q.eng), d = stat(r26, sit, (q) => q.tgtAll - q.pA);
  const a7 = stat(r27, pl, (q) => q.ac - q.eng), b7 = stat(r27, pl, (q) => q.ac - q.pP), d7 = stat(r27, sit, (q) => q.tgtAll - q.pA);
  console.log(name.padEnd(58) + String(a.n).padStart(9) + String(a.G).padStart(8) + ' | ' + fm(a) + '| ' + fm(b) + '| ' + fm(c) + '| ' + fm(d) + '|| ' + String(a7.n).padStart(7) + ' | ' + fm(a7) + '| ' + fm(b7) + '| ' + fm(d7));
  res.push({ name, n: a.n, G: a.G, pEng: a, pClean: b, lEng: c, lClean: d, n27: a7.n, pEng27: a7, pClean27: b7, lClean27: d7 });
}
C.L.writeJSON(`${C.L.ROOT}/data/research/early-scan-${ST}.json`, res);
