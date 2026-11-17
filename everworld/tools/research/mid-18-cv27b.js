#!/usr/bin/env node
/* mid-18: 6-fold CV inside 2027 + 2026-fit-applied-to-2027 for stage-specific additions on top of flat + flatLop (+ paceT at the half).
 * Reports each set against the previous one (paired, clustered by game). */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE, C, F } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const onB = (r) => (r.sT === 0 && r.on ? 1 : 0), offS = (r) => (r.sT === 1 && !r.on ? 1 : 0);
const lastPf = (r) => (r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99);
const satSinceFoul = (r) => !r.on && r.pfAt.length && (r.el - r.sitFor) >= lastPf(r) - 0.1 && (r.el - r.sitFor) <= lastPf(r) + 1.5;
const foulSeat = (r) => (r.el === 24 && r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0);
const starterGone = (r) => (r.el === 30 && r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15 ? 1 : 0);
const benchMissed = (r) => (r.el === 30 && r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6 ? 1 : 0);
const lopTier = (r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5);
const chains = {
  s18: [['flat+flatLop', [BASE.flat, BASE.flatLop]], ['+offS', [BASE.flat, BASE.flatLop, offS]], ['+offS+onB', [BASE.flat, BASE.flatLop, offS, onB]]],
  s24: [['flat+flatLop', [BASE.flat, BASE.flatLop]], ['+paceT', [BASE.flat, BASE.flatLop, paceT]], ['+paceT+foulSeat', [BASE.flat, BASE.flatLop, paceT, foulSeat]]],
  s30: [['flat+flatLop', [BASE.flat, BASE.flatLop]], ['+onB+offS', [BASE.flat, BASE.flatLop, onB, offS]], ['+onB+offS+lopTier', [BASE.flat, BASE.flatLop, onB, offS, lopTier]], ['+onB+offS+lopTier+starterGone+benchMissed', [BASE.flat, BASE.flatLop, onB, offS, lopTier, starterGone, benchMissed]]],
};
const { R26, R27 } = K.data();
const NF = 6;
for (const g of ['s18', 's24', 's30']) {
  const R = R27.filter((r) => r.g === g), R6 = R26.filter((r) => r.g === g);
  const ids = [...new Set(R.map((r) => r.id))].sort((a, b) => a - b);
  const fold = new Map(ids.map((id, i) => [id, i % NF]));
  const pred = (ex) => {
    const out = new Map();
    for (let f = 0; f < NF; f++) {
      const tr = R.filter((r) => fold.get(r.id) !== f), te = R.filter((r) => fold.get(r.id) === f);
      const D = F.design(tr, ex); let w = 0; for (const x of D.X) w += x[0] * x[0];
      const lam0 = 32 * 25 * (w / D.X.length) * (D.X.length / 23000);
      const o = C.ols(D.X, D.y, D.keys, D.X[0].map((_, j) => (j < F.D0 ? lam0 : lam0 * 0.1)));
      for (const r of te) out.set(r, F.predict(r, o.beta, ex));
    }
    return out;
  };
  const { A, B } = F.splitByDate(R6);
  console.log(`\n== ${g}`);
  let prevCV = null, prev26 = null, prevHalf = null;
  for (const [nm, ex] of chains[g]) {
    const p1 = pred(ex);
    const f1 = F.fit(R6, ex), a1 = F.fit(A, ex);
    const cv = (r) => p1.get(r), ap = (r) => F.predict(r, f1.beta, ex), hf = (r) => F.predict(r, a1.beta, ex);
    const cE = F.compare(R, (r) => r.mn0, cv), aE = F.compare(R, (r) => r.mn0, ap), hE = F.compare(B, (r) => r.mn0, hf);
    let line = `   ${nm.padEnd(44)} 2026 2nd half ${hE.b.toFixed(3)} (${hE.pct.toFixed(2)}% vs engine)`;
    if (prevHalf) { const c = F.compare(B, prevHalf, hf); line += ` step ${c.pct.toFixed(2)}% z ${c.z.toFixed(1)}`; }
    line += ` | 2027 by 2026 fit ${aE.b.toFixed(3)} (${aE.pct.toFixed(2)}%)`;
    if (prev26) { const c = F.compare(R, prev26, ap); line += ` step ${c.pct.toFixed(2)}% z ${c.z.toFixed(1)}`; }
    line += ` | 2027 CV ${cE.b.toFixed(3)} (${cE.pct.toFixed(2)}%)`;
    if (prevCV) { const c = F.compare(R, prevCV, cv); line += ` step ${c.pct.toFixed(2)}% z ${c.z.toFixed(1)}`; }
    console.log(line);
    prevCV = cv; prev26 = ap; prevHalf = hf;
  }
}
