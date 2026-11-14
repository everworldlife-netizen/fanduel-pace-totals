#!/usr/bin/env node
/* mid-16: confirmation on 2027 that does not lean on 2026 coefficients. The 2027 engine carries well-trained mid-game
 * lessons, so the fair question there is: does the candidate add to a refit made ON 2027-style data?
 * 6-fold cross-validation by game inside 2027 (121 games): miss of engine / plain refit / refit + candidates on held-out games.
 * Also: the 2026 fit applied to 2027 (absolute misses). */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE, C, F } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const sets = { 'flat': [BASE.flat], 'flat+flatLop': [BASE.flat, BASE.flatLop], 'flat+flatLop+paceT': [BASE.flat, BASE.flatLop, paceT], 'paceT only': [paceT] };
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
      const lam0 = 32 * 25 * (w / D.X.length) * (D.X.length / 23000); // same ridge-to-data ratio as a full-season fit
      const o = C.ols(D.X, D.y, D.keys, D.X[0].map((_, j) => (j < F.D0 ? lam0 : lam0 * 0.1)));
      for (const r of te) out.set(r, F.predict(r, o.beta, ex));
    }
    return out;
  };
  const p0 = pred(null);
  const c0 = F.compare(R, (r) => r.mn0, (r) => p0.get(r));
  console.log(`\n== ${g} 2027 (${ids.length} games, 10+ players ${c0.n}): engine ${c0.a.toFixed(3)}; plain refit by CV ${c0.b.toFixed(3)} (${c0.pct.toFixed(2)}%, z ${c0.z.toFixed(1)})`);
  const f0 = F.fit(R6, null);
  const e0 = F.compare(R, (r) => r.mn0, (r) => F.predict(r, f0.beta, null));
  console.log(`   2026 plain refit applied to 2027: ${e0.b.toFixed(3)} (${e0.pct.toFixed(2)}% vs engine)`);
  for (const [nm, ex] of Object.entries(sets)) {
    const p1 = pred(ex);
    const c = F.compare(R, (r) => p0.get(r), (r) => p1.get(r)), cE = F.compare(R, (r) => r.mn0, (r) => p1.get(r));
    const f1 = F.fit(R6, ex);
    const e1 = F.compare(R, (r) => r.mn0, (r) => F.predict(r, f1.beta, ex));
    console.log(`   ${nm.padEnd(20)} CV in 2027: ${c.b.toFixed(3)}  vs CV plain refit ${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})  vs engine ${cE.pct.toFixed(2)}% (z ${cE.z.toFixed(1)}) | 2026 fit applied: ${e1.b.toFixed(3)} (${e1.pct.toFixed(2)}% vs engine, z ${e1.z.toFixed(1)})`);
  }
}
