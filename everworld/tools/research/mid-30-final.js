#!/usr/bin/env node
/* mid-30: final numbers for the report. One chain of inputs per stage, each step measured three ways:
 *   (a) joint coefficient and cluster-robust z on all of 2026 (in the full model of that stage),
 *   (b) fit on the first half of 2026 by date -> miss on the second half (players with 10+ real minutes), step by step,
 *   (c) the all-2026 fit applied to 2027, step by step; and the same model fitted on 2027 alone (coefficients, z).
 * Writes data/research/mid-final.json. */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE, C, F } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const lastPf = (r) => (r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99);
const satSinceFoul = (r) => !r.on && r.pfAt.length && (r.el - r.sitFor) >= lastPf(r) - 0.1 && (r.el - r.sitFor) <= lastPf(r) + 1.5;
const IN = {
  flat: BASE.flat,
  flatLop: BASE.flatLop,
  paceT: (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4),
  onB: (r) => (r.sT === 0 && r.on ? 1 : 0),
  offS: (r) => (r.sT === 1 && !r.on ? 1 : 0),
  lopTier: (r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5),
  foulSeat: (r) => (r.el === 24 && r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0),
  flatOn: (r) => (r.on ? BASE.flat(r) : 0),
  flatFav: (r) => (r.fav != null ? BASE.flat(r) * clamp((Math.abs(r.fav) - 4) / 6, 0, 2) : 0),
  starterGone: (r) => (r.el === 30 && r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15 ? 1 : 0),
  benchMissed: (r) => (r.sT === 0 && !r.on && !r.dnp && r.hN >= 3 ? clamp((r.hMissed - 4) / 2, 0, 2) : 0),
};
const chains = {
  s18: ['flat', 'flatLop', 'flatOn', 'offS', 'flatFav'],
  s24: ['flat', 'flatLop', 'paceT', 'lopTier', 'flatFav', 'foulSeat', 'benchMissed'],
  s30: ['flat', 'onB', 'offS', 'lopTier', 'starterGone', 'benchMissed'],
};
const alt = process.argv.includes('--alt') ? { s30: ['flat', 'flatLop', 'onB', 'offS', 'lopTier', 'starterGone', 'benchMissed'] } : {};
const { R26, R27 } = K.data();
const out = {};
for (const g of ['s18', 's24', 's30']) {
  const names = alt[g] || chains[g];
  const R = R26.filter((r) => r.g === g), R7 = R27.filter((r) => r.g === g);
  const { cutDate, A, B } = F.splitByDate(R);
  const ex = names.map((k) => IN[k]);
  const full = F.fit(R, ex);
  const D7 = F.design(R7, ex), D6 = F.design(R, ex); let w7 = 0; for (const x of D7.X) w7 += x[0] * x[0];
  const lam7 = 32 * 25 * (w7 / D7.X.length) * (D7.X.length / D6.X.length);
  const o7 = C.ols(D7.X, D7.y, D7.keys, D7.X[0].map((_, j) => (j < F.D0 ? lam7 : lam7 * 0.1)));
  console.log(`\n================ ${g}: chain ${names.join(' -> ')}  (2026 split at ${cutDate}; 2nd half 10+ players ${B.filter(C.p10).length}; 2027 10+ players ${R7.filter(C.p10).length})`);
  console.log('  joint model, all of 2026 | same model on 2027 alone:');
  names.forEach((k, i) => console.log(`     ${k.padEnd(12)} coef ${C.fmt(full.beta[49 + i], 3)} z ${full.z[49 + i].toFixed(1).padStart(6)} | 2027 coef ${C.fmt(o7.beta[49 + i], 3)} z ${o7.z[49 + i].toFixed(1).padStart(5)} | rows where it is on: ${R.filter((r) => IN[k](r)).length}, team-games ${new Set(R.filter((r) => IN[k](r)).map((r) => r.tg)).size}`));
  const steps = [];
  let prevH = (r) => r.mn0, prev7 = (r) => r.mn0;
  const hE0 = F.compare(B, (r) => r.mn0, (r) => r.mn0);
  console.log(`  engine as is: 2nd half 2026 miss ${hE0.a.toFixed(3)}; 2027 miss ${F.compare(R7, (r) => r.mn0, (r) => r.mn0).a.toFixed(3)}`);
  for (let k = 0; k <= names.length; k++) {
    const e = ex.slice(0, k), nm = k === 0 ? 'plain refit (49 inputs)' : '+ ' + names[k - 1];
    const a = F.fit(A, e.length ? e : null), f = F.fit(R, e.length ? e : null);
    const ph = (r) => F.predict(r, a.beta, e.length ? e : null), p7 = (r) => F.predict(r, f.beta, e.length ? e : null);
    const cH = F.compare(B, prevH, ph), cHE = F.compare(B, (r) => r.mn0, ph), c7 = F.compare(R7, prev7, p7), c7E = F.compare(R7, (r) => r.mn0, p7);
    console.log(`     ${nm.padEnd(26)} 2nd half 2026: ${cH.b.toFixed(4)}  step ${cH.pct.toFixed(2)}% (z ${cH.z.toFixed(1)})  total vs engine ${cHE.pct.toFixed(2)}% | 2027: ${c7.b.toFixed(4)} step ${c7.pct.toFixed(2)}% (z ${c7.z.toFixed(1)}) total vs engine ${c7E.pct.toFixed(2)}% (z ${c7E.z.toFixed(1)})`);
    steps.push({ name: nm, miss2026h2: cH.b, stepPct: cH.pct, stepZ: cH.z, totalPct: cHE.pct, miss2027: c7.b, step2027: c7.pct, step2027z: c7.z, total2027: c7E.pct });
    prevH = ph; prev7 = p7;
  }
  out[g] = { names, coef: names.map((_, i) => full.beta[49 + i]), z: names.map((_, i) => full.z[49 + i]), coef2027: names.map((_, i) => o7.beta[49 + i]), z2027: names.map((_, i) => o7.z[49 + i]), engine2026h2: hE0.a, steps };
}
if (!process.argv.includes('--alt')) C.L.writeJSON(`${C.L.ROOT}/data/research/mid-final.json`, out);
