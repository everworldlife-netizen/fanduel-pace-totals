#!/usr/bin/env node
/* early-14: the evidence table for the early-stage findings (rules 3-6 of the brief).
 * For each finding at a stage: players who PLAYED in the situation, gap = real - engine average (mn), z clustered by
 * team-game; the same on 2026-27; and the gain: the effect is fitted on the first half of 2026 (gap = a + b*v on the
 * situation's players who played), added to the shown number in the second half, miss before -> after for players with
 * 10+ real minutes (inside the situation, and over the whole stage). Also the everyone-listed miss (never in = 0).
 *   node tools/research/early-14-evidence.js */
'use strict';
const C = require('./early-common');
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const bench = (o) => o.pre.sT === 0, starts = (o) => o.pre.sT === 1;
const F = [];
for (const [ST, EL] of [['s6', 6], ['s12', 12]]) {
  const notIn = (o) => bench(o) && o[ST].dnp === 1, isIn = (o) => bench(o) && o[ST].dnp === 0;
  F.push({ name: `not yet in (bench), ${ST}`, ST, sit: notIn, v: (o) => o[ST].mn[0] - 12, desc: 'v = engine number - 12' });
  F.push({ name: `not yet in, played every recent team game (nT>=4), ${ST}`, ST, sit: (o) => notIn(o) && o.f.nT >= 4 && o.f.nP === o.f.nT, v: null });
  F.push({ name: `not yet in, did NOT play last team game, ${ST}`, ST, sit: (o) => notIn(o) && o.f.nT >= 1 && o.f.lastPlayed[0] === '0', v: null });
  F.push({ name: `earlyIn: bench, in, 3+ min before usual bench check-in, ${ST}`, ST, sit: (o) => isIn(o) && o.f.nB >= 2 && o.f.ciBMed - o.f['tIn' + EL] >= 3, v: (o) => clamp((o.f.ciBMed - o.f['tIn' + EL]) / 6, 0, 2) - 1, desc: 'v = earliness/6 - 1' });
  F.push({ name: `earlyIn (6+ min before usual), ${ST}`, ST, sit: (o) => isIn(o) && o.f.nB >= 2 && o.f.ciBMed - o.f['tIn' + EL] >= 6, v: null });
  F.push({ name: `neverBy: bench, in, never in by now in recent bench games, ${ST}`, ST, sit: (o) => isIn(o) && o.f.nB >= 2 && o.f['pInB' + EL] === 0, v: null });
  F.push({ name: `queue jump: first bench player in, usual order 3rd or later, ${ST}`, ST, sit: (o) => isIn(o) && o.f['firstSub' + EL] != null && Math.abs(o.f['tIn' + EL] - o.f['firstSub' + EL]) < 0.02 && o.f.rankB >= 3, v: null });
  F.push({ name: `bench in, engine number < 18, ${ST}`, ST, sit: (o) => isIn(o) && o[ST].mn[0] < 18, v: (o) => o[ST].mn[0] - 14, desc: 'v = engine number - 14' });
  F.push({ name: `bench in (all): slope on engine number, ${ST}`, ST, sit: isIn, v: (o) => o[ST].mn[0] - 21, desc: 'v = engine number - 21' });
  F.push({ name: `demotedWait: usual starter (start share>=0.6) on bench, not in, ${ST}`, ST, sit: (o) => notIn(o) && o.f.nP >= 2 && o.f.startShare >= 0.6, v: null });
  F.push({ name: `reserve who starts (start share<0.3), ${ST}`, ST, sit: (o) => starts(o) && o.f.nP >= 2 && o.f.startShare < 0.3, v: (o) => clamp((24 - o.pre.mpg) / 6, -1, 2), desc: 'v = (24-mpg)/6' });
  F.push({ name: `starts tonight, usual minutes < 24, ${ST}`, ST, sit: (o) => starts(o) && o.pre.mpg < 24, v: (o) => clamp((24 - o.pre.mpg) / 6, 0, 2) - 0.5, desc: 'v = (24-mpg)/6 - 0.5' });
  F.push({ name: `regular starter (start share>=0.7), usual minutes < 24, ${ST}`, ST, sit: (o) => starts(o) && o.f.nP >= 2 && o.f.startShare >= 0.7 && o.pre.mpg < 24, v: null });
  F.push({ name: `starter, 2+ fouls, sitting, ${ST}`, ST, sit: (o) => starts(o) && o[ST].pf >= 2 && o[ST].on === 0, v: null });
  F.push({ name: `starter, 2+ fouls, still on, ${ST}`, ST, sit: (o) => starts(o) && o[ST].pf >= 2 && o[ST].on === 1, v: null });
  F.push({ name: `starter off now, usually on at this minute (>=75%), ${ST}`, ST, sit: (o) => starts(o) && o[ST].on === 0 && o.f['pOnS' + EL] != null && o.f['pOnS' + EL] >= 0.75, v: null });
  F.push({ name: `starter never sat, ${ST}`, ST, sit: (o) => starts(o) && o[ST].on === 1 && o[ST].now[0] >= EL - 0.02, v: null });
  F.push({ name: `bench, team trails by 10+, ${ST}`, ST, sit: (o) => bench(o) && o[ST].mg <= -10, v: null });
}
function fitLin(li, ST, v) { // gap = a + b v, cluster z
  const y = li.map((o) => o.ac - o[ST].mn[0]);
  if (!v) { const s = C.cl(li, (o) => o.ac - o[ST].mn[0]); return { a: s.mean, za: s.z, b: 0, zb: NaN, G: s.G }; }
  const r = C.ols(li.map((o) => [1, v(o)]), y, li.map((o) => o.tg));
  return { a: r.beta[0], za: r.z[0], b: r.beta[1], zb: r.z[1], G: r.G };
}
const mae = (li, p) => li.reduce((a, o) => a + Math.abs(p(o) - o.ac), 0) / Math.max(li.length, 1);
const out = [];
for (const f of F) {
  const ST = f.ST;
  const P26 = a26.filter((o) => f.sit(o) && o.ac > 0), P27 = a27.filter((o) => f.sit(o) && o.ac > 0);
  if (P26.length < 30) continue;
  const m26 = C.cl(P26, (o) => o.ac - o[ST].mn[0]), m27 = P27.length >= 15 ? C.cl(P27, (o) => o.ac - o[ST].mn[0]) : { mean: NaN, z: NaN, n: P27.length };
  const l26 = C.cl(a26.filter(f.sit), (o) => o.ac - o[ST].mn[0]), l27s = a27.filter(f.sit), l27 = l27s.length >= 15 ? C.cl(l27s, (o) => o.ac - o[ST].mn[0]) : { mean: NaN, z: NaN };
  const full = fitLin(P26, ST, f.v), full27 = P27.length >= 30 && f.v ? fitLin(P27, ST, f.v) : null;
  // gain: fit on first half, apply to second half
  const h1 = P26.filter((o) => o.d < mid); const e = fitLin(h1, ST, f.v);
  const adj = (o) => o[ST].pr[0] + (f.sit(o) ? e.a + (f.v ? e.b * f.v(o) : 0) : 0);
  const H2 = a26.filter((o) => o.d >= mid);
  const in10 = H2.filter((o) => f.sit(o) && o.ac >= 10), all10 = H2.filter((o) => o.ac >= 10), inL = H2.filter(f.sit);
  const g = { sitBefore: mae(in10, (o) => o[ST].pr[0]), sitAfter: mae(in10, adj), allBefore: mae(all10, (o) => o[ST].pr[0]), allAfter: mae(all10, adj), listedBefore: mae(H2, (o) => o[ST].pr[0]), listedAfter: mae(H2, adj), n10: in10.length };
  // 2027: apply the effect fitted on all of 2026
  const adj7 = (o) => o[ST].pr[0] + (f.sit(o) ? full.a + (f.v ? full.b * f.v(o) : 0) : 0);
  const t10 = a27.filter((o) => o.ac >= 10), s10 = t10.filter(f.sit);
  const g7 = { sitBefore: mae(s10, (o) => o[ST].pr[0]), sitAfter: mae(s10, adj7), allBefore: mae(t10, (o) => o[ST].pr[0]), allAfter: mae(t10, adj7), listedBefore: mae(a27, (o) => o[ST].pr[0]), listedAfter: mae(a27, adj7) };
  const p = (a, b) => (100 * (b - a) / a).toFixed(2) + '%';
  console.log(`\n${f.name}`);
  console.log(`  2026 played: n=${m26.n} (${m26.G} team-games) gap ${m26.mean.toFixed(2)} z ${m26.z.toFixed(1)}${f.v ? ` | ${f.desc}: a ${full.a.toFixed(2)} (z ${full.za.toFixed(1)}) b ${full.b.toFixed(3)} (z ${full.zb.toFixed(1)})` : ''} | listed gap ${l26.mean.toFixed(2)} z ${l26.z.toFixed(1)} (n ${l26.n})`);
  console.log(`  2027 played: n=${m27.n} gap ${isNaN(m27.mean) ? 'n/a' : m27.mean.toFixed(2) + ' z ' + m27.z.toFixed(1)}${full27 ? ` | a ${full27.a.toFixed(2)} b ${full27.b.toFixed(3)} (z ${full27.zb.toFixed(1)})` : ''} | listed gap ${isNaN(l27.mean) ? 'n/a' : l27.mean.toFixed(2) + ' z ' + l27.z.toFixed(1)}`);
  console.log(`  gain (fit 1st half -> 2nd half 2026), 10+: in situation ${g.sitBefore.toFixed(3)} -> ${g.sitAfter.toFixed(3)} (${p(g.sitBefore, g.sitAfter)}, n=${g.n10}); whole stage ${g.allBefore.toFixed(3)} -> ${g.allAfter.toFixed(3)} (${p(g.allBefore, g.allAfter)}); everyone listed ${g.listedBefore.toFixed(3)} -> ${g.listedAfter.toFixed(3)} (${p(g.listedBefore, g.listedAfter)})`);
  console.log(`  2027 (effect from 2026), 10+: in situation ${g7.sitBefore.toFixed(3)} -> ${g7.sitAfter.toFixed(3)} (${p(g7.sitBefore, g7.sitAfter)}, n=${s10.length}); whole stage ${g7.allBefore.toFixed(3)} -> ${g7.allAfter.toFixed(3)} (${p(g7.allBefore, g7.allAfter)}); everyone listed ${g7.listedBefore.toFixed(3)} -> ${g7.listedAfter.toFixed(3)} (${p(g7.listedBefore, g7.listedAfter)})`);
  out.push({ name: f.name, stage: ST, n26: m26.n, G26: m26.G, gap26: +m26.mean.toFixed(3), z26: +m26.z.toFixed(2), lin: f.v ? { desc: f.desc, a: full.a, b: full.b, zb: full.zb } : null, listed26: { gap: l26.mean, z: l26.z }, n27: m27.n, gap27: m27.mean, z27: m27.z, listed27: { gap: l27.mean, z: l27.z }, gain: g, gain27: g7 });
}
C.L.writeJSON(`${C.L.ROOT}/data/research/early-evidence.json`, out);
