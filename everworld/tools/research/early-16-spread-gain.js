#!/usr/bin/env node
/* early-16: the over-spread correction priced, and what is left of the situational findings after it.
 * (1) gap = a + b*(number - pivot) fitted per class (starters; bench checked in) on the first half of 2026, applied to the
 *     second half and (fitted on all 2026) to 2026-27: miss for 10+ players, paired z by team-game.
 * (2) the same correction cross-fitted on both halves, then the situational gaps again on the corrected number.
 * (3) as two more columns of the learned layer (pivot - plain final) / plain remaining, per class.
 *   node tools/research/early-16-spread-gain.js */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const PIV = { S: 29.5, I: 21 };
for (const [ST, EL] of [['s6', 6], ['s12', 12]]) {
  const cls = (o) => (o.pre.sT === 1 ? 'S' : o[ST].dnp === 0 ? 'I' : 'N');
  const fitC = (tr) => { const m = {}; for (const c of ['S', 'I']) { const li = tr.filter((o) => cls(o) === c && o.ac > 0); m[c] = C.ols(li.map((o) => [1, o[ST].mn[0] - PIV[c]]), li.map((o) => o.ac - o[ST].mn[0]), li.map((o) => o.tg)); } return m; };
  const corr = (m, o) => { const c = cls(o); return c === 'N' ? 0 : m[c].beta[0] + m[c].beta[1] * (o[ST].mn[0] - PIV[c]); };
  const H1 = a26.filter((o) => o.d < mid), H2 = a26.filter((o) => o.d >= mid);
  const m1 = fitC(H1), m2 = fitC(H2), mAll = fitC(a26);
  console.log(`\n===== ${ST} =====`);
  console.log(`fit on first half 2026: starters gap = ${m1.S.beta[0].toFixed(2)} + ${m1.S.beta[1].toFixed(3)}*(number-29.5) [z ${m1.S.z[1].toFixed(1)}]; bench in gap = ${m1.I.beta[0].toFixed(2)} + ${m1.I.beta[1].toFixed(3)}*(number-21) [z ${m1.I.z[1].toFixed(1)}]`);
  console.log(`fit on all 2026:        starters gap = ${mAll.S.beta[0].toFixed(2)} + ${mAll.S.beta[1].toFixed(3)}*(number-29.5) [z ${mAll.S.z[1].toFixed(1)}]; bench in gap = ${mAll.I.beta[0].toFixed(2)} + ${mAll.I.beta[1].toFixed(3)}*(number-21) [z ${mAll.I.z[1].toFixed(1)}]`);
  const m27 = fitC(a27);
  console.log(`fit on 2026-27 itself:  starters b ${m27.S.beta[1].toFixed(3)} [z ${m27.S.z[1].toFixed(1)}]; bench in b ${m27.I.beta[1].toFixed(3)} [z ${m27.I.z[1].toFixed(1)}]`);
  const cmp = (te, m, pop, which) => { const li = te.filter(pop); const mp = new Map(); let sa = 0, sb = 0; for (const o of li) { const a = Math.abs(o[ST].pr[0] - o.ac), b = Math.abs(o[ST].pr[0] + (which.includes(cls(o)) ? corr(m, o) : 0) - o.ac); sa += a; sb += b; mp.set(o.tg, (mp.get(o.tg) || 0) + b - a); } const arr = [...mp.values()]; const mu = arr.reduce((x, y) => x + y, 0) / arr.length; const v = arr.reduce((x, y) => x + (y - mu) * (y - mu), 0) / (arr.length - 1); return `${(sa / li.length).toFixed(3)} -> ${(sb / li.length).toFixed(3)} (${(100 * (sb - sa) / sa).toFixed(2)}%, z ${(mu / Math.sqrt(v / arr.length)).toFixed(1)}, n=${li.length})`; };
  for (const [lab, te, m] of [['2nd half 2026 (fit 1st half)', H2, m1], ['2026-27 (fit 2026)', a27, mAll]]) {
    console.log(`  ${lab}:`);
    console.log(`    starters corrected : starters 10+ ${cmp(te, m, (o) => o.ac >= 10 && cls(o) === 'S', 'S')} | whole stage 10+ ${cmp(te, m, (o) => o.ac >= 10, 'S')}`);
    console.log(`    bench-in corrected : bench in 10+ ${cmp(te, m, (o) => o.ac >= 10 && cls(o) === 'I', 'I')} | whole stage 10+ ${cmp(te, m, (o) => o.ac >= 10, 'I')}`);
    console.log(`    both               : whole stage 10+ ${cmp(te, m, (o) => o.ac >= 10, 'SI')} | everyone listed ${cmp(te, m, () => true, 'SI')}`);
  }
  // (2) situational gaps after the correction (cross-fitted)
  const adj = new Map(); for (const o of H2) adj.set(o.k, o[ST].mn[0] + corr(m1, o)); for (const o of H1) adj.set(o.k, o[ST].mn[0] + corr(m2, o));
  const adj7 = new Map(a27.map((o) => [o.k, o[ST].mn[0] + corr(mAll, o)]));
  const bench = (o) => o.pre.sT === 0, isIn = (o) => bench(o) && o[ST].dnp === 0, starts = (o) => o.pre.sT === 1;
  const SITS = [
    ['earlyIn 3+ min before usual', (o) => isIn(o) && o.f.nB >= 2 && o.f.ciBMed - o.f['tIn' + EL] >= 3],
    ['earlyIn 6+', (o) => isIn(o) && o.f.nB >= 2 && o.f.ciBMed - o.f['tIn' + EL] >= 6],
    ['neverBy', (o) => isIn(o) && o.f.nB >= 2 && o.f['pInB' + EL] === 0],
    ['queue jump (first in, usual order 3rd+)', (o) => isIn(o) && o.f['firstSub' + EL] != null && Math.abs(o.f['tIn' + EL] - o.f['firstSub' + EL]) < 0.02 && o.f.rankB >= 3],
    ['bench in, no bench history', (o) => isIn(o) && o.f.nB < 2],
    ['bench in, about usual time', (o) => isIn(o) && o.f.nB >= 2 && Math.abs(o.f.ciBMed - o.f['tIn' + EL]) < 1.5],
    ['starts, usual minutes < 24', (o) => starts(o) && o.pre.mpg < 24],
    ['reserve who starts (share<0.3)', (o) => starts(o) && o.f.nP >= 2 && o.f.startShare < 0.3],
    ['regular starter, usual minutes < 24', (o) => starts(o) && o.f.nP >= 2 && o.f.startShare >= 0.7 && o.pre.mpg < 24],
    ['starter usual minutes 34+', (o) => starts(o) && o.pre.mpg >= 34],
    ['starter 2+ fouls sitting', (o) => starts(o) && o[ST].pf >= 2 && o[ST].on === 0],
    ['starter 2+ fouls on', (o) => starts(o) && o[ST].pf >= 2 && o[ST].on === 1],
    ['starter off, usually on now', (o) => starts(o) && o[ST].on === 0 && o.f['pOnS' + EL] != null && o.f['pOnS' + EL] >= 0.75],
    ['starter never sat', (o) => starts(o) && o[ST].on === 1 && o[ST].now[0] >= EL - 0.02],
    ['bench in, team trails 10+', (o) => isIn(o) && o[ST].mg <= -10],
    ['bench in, team leads 10+', (o) => isIn(o) && o[ST].mg >= 10],
    ['starter, team trails 10+', (o) => starts(o) && o[ST].mg <= -10],
    ['starter, team leads 10+', (o) => starts(o) && o[ST].mg >= 10],
  ];
  console.log('  situational gaps (played) before -> after the over-spread correction | 2026-27 before -> after');
  for (const [nm, sit] of SITS) {
    const li = a26.filter((o) => sit(o) && o.ac > 0), l7 = a27.filter((o) => sit(o) && o.ac > 0);
    if (li.length < 30) continue;
    const b = C.cl(li, (o) => o.ac - o[ST].mn[0]), a = C.cl(li, (o) => o.ac - adj.get(o.k));
    const b7 = l7.length >= 15 ? C.cl(l7, (o) => o.ac - o[ST].mn[0]) : null, a7 = l7.length >= 15 ? C.cl(l7, (o) => o.ac - adj7.get(o.k)) : null;
    console.log(`    ${nm.padEnd(42)} n=${String(li.length).padStart(5)} ${b.mean.toFixed(2)} (z ${b.z.toFixed(1)}) -> ${a.mean.toFixed(2)} (z ${a.z.toFixed(1)}) | n=${l7.length} ${b7 ? `${b7.mean.toFixed(2)} (z ${b7.z.toFixed(1)}) -> ${a7.mean.toFixed(2)} (z ${a7.z.toFixed(1)})` : 'n/a'}`);
  }
  // (3) in the layer
  const names = ['spreadS', 'spreadI'];
  const extra = (o, st) => { const r = o[st]; const rem = Math.max(r.mp - r.now[0], 2); return [o.pre.sT === 1 ? clamp((PIV.S - r.mp) / rem, -1, 1.5) : 0, o.pre.sT === 0 && r.dnp === 0 ? clamp((PIV.I - r.mp) / rem, -1, 2) : 0]; };
  const r26 = Fx.prep(a26, ST, extra), r27 = Fx.prep(a27, ST, extra); const R1 = r26.filter((q) => q.d < mid), R2 = r26.filter((q) => q.d >= mid);
  const base = Array.from({ length: 49 }, (_, i) => i);
  for (const rule of ['all', 'played']) {
    const b0 = Fx.fit(R1, rule, 8, base), b1 = Fx.fit(R1, rule, 8, base.concat([49, 50])), b0f = Fx.fit(r26, rule, 8, base), b1f = Fx.fit(r26, rule, 8, base.concat([49, 50]));
    const c = ['10+', 'played', 'listed'].map((pn) => Fx.compare(R2, (q) => Fx.predict(q, b0.beta), (q) => Fx.predict(q, b1.beta), Fx.POPS[pn]));
    const c7 = ['10+', 'played', 'listed'].map((pn) => Fx.compare(r27, (q) => Fx.predict(q, b0f.beta), (q) => Fx.predict(q, b1f.beta), Fx.POPS[pn]));
    const e7 = Fx.compare(r27, (q) => q.eng, (q) => Fx.predict(q, b1f.beta), Fx.POPS['10+']);
    console.log(`  in the layer (rule ${rule}): +spreadS +spreadI vs same 49 re-taught: 2nd half 2026 10+ ${c[0].a.toFixed(3)} -> ${c[0].b.toFixed(3)} (${c[0].pct.toFixed(2)}%, z ${c[0].z.toFixed(1)}), played ${c[1].pct.toFixed(2)}% (z ${c[1].z.toFixed(1)}), listed ${c[2].pct.toFixed(2)}% (z ${c[2].z.toFixed(1)}) | 2026-27: 10+ ${c7[0].a.toFixed(3)} -> ${c7[0].b.toFixed(3)} (${c7[0].pct.toFixed(2)}%, z ${c7[0].z.toFixed(1)}), played ${c7[1].pct.toFixed(2)}% (z ${c7[1].z.toFixed(1)}), listed ${c7[2].pct.toFixed(2)}% (z ${c7[2].z.toFixed(1)}); vs the 2027 engine number 10+: ${e7.pct.toFixed(2)}% (z ${e7.z.toFixed(1)}) | coefficients ${b1f.beta[49].toFixed(3)} ${b1f.beta[50].toFixed(3)}`);
  }
}
