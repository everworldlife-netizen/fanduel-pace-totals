/* mid-cand: one protocol for every candidate input.
 *   raw    = mean of (real - engine) minutes in the situation, z clustered by team-game (2026 and 2027)
 *   joint  = coefficient and cluster-robust z when the candidate is added to the 49 inputs (+ inputs already accepted), all of 2026
 *   split  = fit on the first half of 2026 (by date), apply to the second half: miss with / without the candidate (10+ minute players)
 *   y2027  = the all-2026 fit applied to 2027, with / without the candidate
 */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let R26 = null, R27 = null;
function data() { if (!R26) { R26 = C.load(2026); R27 = C.load(2027); } return { R26, R27 }; }
const flat = (r) => clamp((0.5 * (48 - r.el) - r.erem) / r.erem, -1, 4);
const lop = (r) => clamp((Math.abs(r.mg) - 8) / 10, 0, 2.5);
const BASE = { flat, flatLop: (r) => flat(r) * lop(r) };
/** cand: { name, stages: ['s24'], fns: [f...], names: [...], sit: (r)=>bool (the situation, for the raw gap) , accepted: [fns] } */
function test(cand) {
  const { R26, R27 } = data();
  const acc = cand.accepted || [];
  const out = [];
  for (const g of cand.stages) {
    const R = R26.filter((r) => r.g === g), R7 = R27.filter((r) => r.g === g);
    const sit = cand.sit || ((r) => cand.fns.some((f) => f(r)));
    const S = R.filter((r) => C.played(r) && sit(r)), S7 = R7.filter((r) => C.played(r) && sit(r));
    const raw = C.cl(S, (r) => r.gap), raw7 = C.cl(S7, (r) => r.gap);
    const ex0 = acc, ex1 = acc.concat(cand.fns);
    const full = F.fit(R, ex1);
    const k0 = F.D0 + acc.length;
    const { A, B } = F.splitByDate(R);
    const a0 = F.fit(A, ex0), a1 = F.fit(A, ex1);
    const cmp = F.compare(B, (r) => F.predict(r, a0.beta, ex0), (r) => F.predict(r, a1.beta, ex1));
    const cmpS = F.compare(B.filter(sit), (r) => F.predict(r, a0.beta, ex0), (r) => F.predict(r, a1.beta, ex1));
    const f0 = F.fit(R, ex0);
    const c7 = F.compare(R7, (r) => F.predict(r, f0.beta, ex0), (r) => F.predict(r, full.beta, ex1));
    const c7S = F.compare(R7.filter(sit), (r) => F.predict(r, f0.beta, ex0), (r) => F.predict(r, full.beta, ex1));
    // cleanest 2027 check: the 2027 engine already has well-trained mid-game lessons; add ONLY the candidate columns (2026 coefficients) on top of it
    const only = (r) => { const rem = r.mn0 - r.now0; if (!(rem >= 0.25)) return r.mn0; let z = 0; for (let i = 0; i < cand.fns.length; i++) z += full.beta[k0 + i] * (cand.fns[i](r) || 0); return r.now0 + rem * (1 + Math.max(-0.6, Math.min(1.5, z))); };
    const c7o = F.compare(R7, (r) => r.mn0, only), c7oS = F.compare(R7.filter(sit), (r) => r.mn0, only);
    // 2027 alone: same model fitted on 2027 rows only (ridge scaled to the sample size)
    const D7 = F.design(R7, ex1), D6 = F.design(R, ex1);
    let w7 = 0; for (const x of D7.X) w7 += x[0] * x[0];
    const lam7 = 32 * 25 * (w7 / D7.X.length) * (D7.X.length / D6.X.length); const o7 = C.ols(D7.X, D7.y, D7.keys, D7.X[0].map((_, j) => (j < F.D0 ? lam7 : lam7 * 0.1)));
    // the situation after the plain refit of 2026 (comparable with the raw 2027 gap, whose engine is well trained)
    const res = (() => { const T = S.map((r) => r.ac0 - F.predict(r, f0.beta, ex0)); const m = new Map(); S.forEach((r, i) => { let a = m.get(r.tg); if (!a) m.set(r.tg, (a = [0, 0])); a[0] += T[i]; a[1]++; }); let SS = 0, N = 0; for (const a of m.values()) { SS += a[0]; N += a[1]; } const mean = SS / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; } const G = m.size; return { mean, z: mean / (Math.sqrt(v * G / (G - 1)) / N) }; })();
    const o = { g, n: raw.n, tg: raw.G, raw: raw.mean, rawZ: raw.z, n7: raw7.n, raw7: raw7.mean, raw7Z: raw7.z,
      coef: cand.fns.map((_, i) => full.beta[k0 + i]), z: cand.fns.map((_, i) => full.z[k0 + i]),
      missBase: cmp.a, missNew: cmp.b, pct: cmp.pct, pctZ: cmp.z, pctSit: cmpS.pct, nSit: cmpS.n, missSitBase: cmpS.a, missSitNew: cmpS.b, pct7: c7.pct, pct7Z: c7.z, pct7Sit: c7S.pct, pct7o: c7o.pct, pct7oZ: c7o.z, pct7oSit: c7oS.pct, miss7: c7o.a, miss7Sit: c7oS.a, n7Sit: c7oS.n, coef7: cand.fns.map((_, i) => o7.beta[k0 + i]), z7: cand.fns.map((_, i) => o7.z[k0 + i]), res: res.mean, resZ: res.z };
    out.push(o);
    if (!cand.quiet) {
      console.log(`[${cand.name}] ${g}: situation n=${o.n} (tg ${o.tg}) raw gap ${C.fmt(o.raw, 2)} z ${C.fmt(o.rawZ, 1)}, after refit of accepted ${C.fmt(o.res, 2)} z ${C.fmt(o.resZ, 1)} | 2027 n=${o.n7} raw ${C.fmt(o.raw7, 2)} z ${C.fmt(o.raw7Z, 1)}`);
      console.log(`      joint: ${cand.fns.map((_, i) => `${(cand.names || [])[i] || 'c' + i} ${C.fmt(o.coef[i], 3)} (z ${o.z[i].toFixed(1)})`).join(', ')}`);
      console.log(`      2nd half 2026: ${o.missBase.toFixed(4)} -> ${o.missNew.toFixed(4)} (${o.pct.toFixed(2)}%, z ${o.pctZ.toFixed(1)}); in the situation (${o.nSit}): ${o.missSitBase.toFixed(3)} -> ${o.missSitNew.toFixed(3)} (${o.pctSit.toFixed(1)}%) | 2027: ${o.pct7.toFixed(2)}% (z ${o.pct7Z.toFixed(1)}), in the situation ${o.pct7Sit.toFixed(1)}%`);
      console.log(`      2027 engine + candidate only (2026 coef): ${o.miss7.toFixed(3)} ${o.pct7o.toFixed(2)}% (z ${o.pct7oZ.toFixed(1)}), in the situation (${o.n7Sit}) ${o.pct7oSit.toFixed(1)}% | fitted on 2027 alone: ${cand.fns.map((_, i) => `${C.fmt(o.coef7[i], 3)} (z ${o.z7[i].toFixed(1)})`).join(', ')}`);
    }
  }
  return out;
}
module.exports = { test, data, flat, lop, BASE, clamp, C, F };
