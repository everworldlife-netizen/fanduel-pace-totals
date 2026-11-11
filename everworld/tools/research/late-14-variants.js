#!/usr/bin/env node
/* late-14: variants of each candidate definition, one at a time on top of the 49 existing inputs (weak pull x0.05 on the
 * candidate): coefficient, cluster z (all 2026), and the first-half -> second-half gain over the plain refit. */
'use strict';
const C = require('./late-common'), F = require('./late-fit'), F2 = require('./late-fit2');
const rows = C.load(2026);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const Dd = (r) => clamp((am(r) - 10) / 10, 0, 1), W = (r) => clamp((24 - r.mpgOn) / 8, 0, 1.5), Cl = (r) => clamp((12 - am(r)) / 6, 0, 1);
const predict = (r, beta, extra, lo = -0.95) => { const rem = r.mn0 - r.now0; if (!(rem >= 0.25)) return r.mn0; let z = 0; for (let j = 0; j < 49; j++) z += beta[j] * r.x[j]; if (extra) for (let j = 0; j < extra.length; j++) z += beta[49 + j] * (extra[j](r) || 0); return r.now0 + rem * (1 + Math.max(lo, Math.min(1.5, z))); };
const V42 = {
  // regulars off the floor in a decided game
  'offReg: stOn<=1 & am>=16': (r) => (!r.on && !D(r) && r.stOn <= 1 && am(r) >= 16 ? 1 : 0),
  'offReg: top5On<=1 & am>=16': (r) => (!r.on && !D(r) && r.top5On <= 1 && am(r) >= 16 ? 1 : 0),
  'offReg: mpgOn<20 & am>=16': (r) => (!r.on && !D(r) && r.mpgOn < 20 && am(r) >= 16 ? 1 : 0),
  'offReg: Dd x W (continuous)': (r) => (!r.on && !D(r) ? Dd(r) * W(r) : 0),
  'offAny: Dd x W': (r) => (!r.on ? Dd(r) * W(r) : 0),
  'offReg: Dd x min(W,1)': (r) => (!r.on && !D(r) ? Dd(r) * Math.min(W(r), 1) : 0),
  // non-starters on the floor in a decided game
  'onBench: stOn<=1 & am>=16': (r) => (r.on && !S(r) && r.stOn <= 1 && am(r) >= 16 ? 1 : 0),
  'onBench: mpgOn<20 & am>=16': (r) => (r.on && !S(r) && r.mpgOn < 20 && am(r) >= 16 ? 1 : 0),
  'onBench: Dd x W': (r) => (r.on && !S(r) ? Dd(r) * W(r) : 0),
  'onAny: Dd x W': (r) => (r.on ? Dd(r) * W(r) : 0),
  'onAny: Dd x W x (24-mpg)/12': (r) => (r.on ? Dd(r) * W(r) * clamp((27 - r.mpg) / 12, 0, 1.5) : 0),
  // deep bench waiting
  'deepWait: D off am>=16 stOn>=2': (r) => (!r.on && D(r) && am(r) >= 16 && r.stOn >= 2 ? 1 : 0),
  'deepWait: D off Dd x (1-min(W,1))': (r) => (!r.on && D(r) ? Dd(r) * (1 - Math.min(W(r), 1)) : 0),
  'deepWait: mpg<18 off Dd x (1-min(W,1))': (r) => (!r.on && !S(r) && r.mpg < 18 ? Dd(r) * (1 - Math.min(W(r), 1)) : 0),
  // starter resting in a close game
  'rest: S off am<=10 sit<12': (r) => (!r.on && S(r) && am(r) <= 10 && r.sitFor < 12 ? 1 : 0),
  'rest: S off Cl sit<12': (r) => (!r.on && S(r) && r.sitFor < 12 ? Cl(r) : 0),
  'rest: (S or sT) off am<=10 sit<12': (r) => (!r.on && (S(r) || r.sT === 1) && am(r) <= 10 && r.sitFor < 12 ? 1 : 0),
  'rest: top5 off am<=10 sit<12': (r) => (!r.on && r.top5 && am(r) <= 10 && r.sitFor < 12 ? 1 : 0),
  'rest: closing rank<=5 off am<=10 sit<12': (r) => (!r.on && r.cgNA >= 2 && r.cgRkA <= 5 && am(r) <= 10 && r.sitFor < 12 ? 1 : 0),
  'rest: S off am<=10 sit 1-12': (r) => (!r.on && S(r) && am(r) <= 10 && r.sitFor < 12 && r.sitFor >= 1 ? 1 : 0),
  'rest: S off am<=10 sit<12 & started': (r) => (!r.on && S(r) && r.sT !== 0 && am(r) <= 10 && r.sitFor < 12 ? 1 : 0),
  'rest: S off am<=15 sit<12': (r) => (!r.on && S(r) && am(r) <= 15 && r.sitFor < 12 ? 1 : 0),
  'rest: S off sit<12 lead<=15 or trail<=10': (r) => (!r.on && S(r) && r.mg <= 15 && r.mg >= -10 && r.sitFor < 12 ? 1 : 0),
  // deep bench off in a close game
  'deepOffClose: D off am<=10': (r) => (!r.on && D(r) && am(r) <= 10 ? 1 : 0),
  'deepOffClose: D off Cl': (r) => (!r.on && D(r) ? Cl(r) : 0),
  'nonCloserOff: rank>=8 off am<=10': (r) => (!r.on && r.cgNA >= 2 && r.cgRkA >= 8 && am(r) <= 10 ? 1 : 0),
  'lowOffClose: off Cl x (18-mpg)/8': (r) => (!r.on && !S(r) ? Cl(r) * clamp((18 - r.mpg) / 8, 0, 1.5) : 0),
  // starters on, trailing
  'sOnT16: S on trail 16-20 stOn>=3': (r) => (r.on && S(r) && r.mg <= -16 && r.mg >= -20 && r.stOn >= 3 ? 1 : 0),
  'sOnT: S on trail 13-20': (r) => (r.on && S(r) && r.mg <= -13 && r.mg >= -20 ? 1 : 0),
  'sOnT: S on trail 16-20': (r) => (r.on && S(r) && r.mg <= -16 && r.mg >= -20 ? 1 : 0),
  'sOnT21: S on trail 21+': (r) => (r.on && S(r) && r.mg <= -21 ? 1 : 0),
  'sOn fresh in decided: S on stint<1 am>=16': (r) => (r.on && S(r) && r.stintNow < 1 && am(r) >= 16 ? 1 : 0),
  'S on 5 fouls within 10': (r) => (r.on && S(r) && r.pf === 5 && am(r) <= 10 ? 1 : 0),
  'on 5 fouls': (r) => (r.on && r.pf === 5 ? 1 : 0),
  'S on long stint (9+) within 10': (r) => (r.on && S(r) && r.stintNow >= 9 && am(r) <= 10 ? 1 : 0),
};
const V36 = {
  'deepLop: D x (am-10)/10 [0,2]': (r) => (D(r) ? clamp((am(r) - 10) / 10, 0, 2) : 0),
  'deepLop: D x (am-15)/10 [0,2]': (r) => (D(r) ? clamp((am(r) - 15) / 10, 0, 2) : 0),
  'deepLop: mpg<18 x (am-15)/10 x (18-mpg)/8': (r) => (!S(r) ? clamp((am(r) - 15) / 10, 0, 2) * clamp((18 - r.mpg) / 8, 0, 1.5) : 0),
  'deepOffClose: D off am<=10': (r) => (!r.on && D(r) && am(r) <= 10 ? 1 : 0),
  'deepOffClose: D off am<=10 & no Q3 min': (r) => (!r.on && D(r) && am(r) <= 10 && r.q3 < 0.01 ? 1 : 0),
  'deepOffClose: D off am<=10 & sat 12+': (r) => (!r.on && D(r) && am(r) <= 10 && r.sitFor >= 12 ? 1 : 0),
  'midBench: nonS mpg>=18 am<=15': (r) => (!S(r) && r.mpg >= 18 && am(r) <= 15 ? 1 : 0),
  'midBench: nonS tent(mpg 14..24) am<=15': (r) => (!S(r) && am(r) <= 15 ? clamp((r.mpg - 14) / 8, 0, 1.25) : 0),
  'midBenchLead: nonS mpg>=18 lead>=16': (r) => (!S(r) && r.mpg >= 18 && r.mg >= 16 ? 1 : 0),
  'midBenchLop: nonS mpg>=18 am>=16': (r) => (!S(r) && r.mpg >= 18 && am(r) >= 16 ? 1 : 0),
  'lowStarterLop: S mpg<27 am>=16': (r) => (S(r) && r.mpg < 27 && am(r) >= 16 ? 1 : 0),
  'benchHot: B x (now-0.75mpg)/6': (r) => (B(r) ? clamp((r.now0 - 0.75 * r.mpg) / 6, -1, 1.5) : 0),
  'benchHot: nonS x (now-0.75mpg)/6 am<=15': (r) => (!S(r) && am(r) <= 15 ? clamp((r.now0 - 0.75 * r.mpg) / 6, -1, 1.5) : 0),
  'sOffLop26: S off am>=26': (r) => (S(r) && !r.on && am(r) >= 26 ? 1 : 0),
  'sOffLop: S off am>=26 & mpgOn<26': (r) => (S(r) && !r.on && am(r) >= 26 && r.mpgOn < 26 ? 1 : 0),
  'sOffLop: S off x (am-20)/10 x W': (r) => (S(r) && !r.on ? clamp((am(r) - 20) / 10, 0, 1.5) * W(r) : 0),
  'offReg36: off mpg>=14 x (am-20)/10 x W': (r) => (!D(r) && !r.on ? clamp((am(r) - 20) / 10, 0, 1.5) * W(r) : 0),
  'sFullQ3: S on stint>=11.9': (r) => (S(r) && r.on && r.stintNow >= 11.9 ? 1 : 0),
  'sLongStint: S on (stint-4)/8': (r) => (S(r) && r.on ? clamp((r.stintNow - 4) / 8, -0.5, 1) : 0),
  'longStint: any on (stint-4)/8': (r) => (r.on ? clamp((r.stintNow - 4) / 8, -0.5, 1) : 0),
  'freshOn: on stint<4': (r) => (r.on && r.stintNow < 4 ? 1 : 0),
  'freshOn: on stint<2': (r) => (r.on && r.stintNow < 2 ? 1 : 0),
  'S sat 1-2 at Q3 end': (r) => (S(r) && !r.on && r.sitFor < 2 ? 1 : 0),
  'flagOffS: S off stOn<=1 am>=21': (r) => (!r.on && S(r) && r.stOn <= 1 && am(r) >= 21 ? 1 : 0),
  'startsBench: nonS sT=1': (r) => (!S(r) && r.sT === 1 ? 1 : 0),
  'starterBenched: S sT=0': (r) => (S(r) && r.sT === 0 ? 1 : 0),
  'S 5 fouls': (r) => (S(r) && r.pf >= 5 ? 1 : 0),
  '4 fouls on': (r) => (r.on && r.pf === 4 ? 1 : 0),
};
for (const [g, VS] of [['s36', V36], ['s42', V42]]) {
  const A = rows.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  const p0 = F.fit(h1, null);
  console.log(`\n== ${g}: one candidate at a time (pull x0.05)`);
  console.log('  candidate                                        rows>0   coef    z(all 2026)   H1->H2 gain over plain refit');
  for (const [name, f] of Object.entries(VS)) {
    const all = F2.fit(A, [f], 0.05), half = F2.fit(h1, [f], 0.05);
    const c = F.compare(h2, (r) => F.predict(r, p0.beta, null), (r) => predict(r, half.beta, [f]));
    console.log(`  ${name.padEnd(48)} ${String(A.filter((r) => f(r) > 0).length).padStart(6)}  ${C.fmt(all.beta[49], 3)}   ${all.z[49].toFixed(1).padStart(6)}        ${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})`);
  }
}
