/* late-fit: a stand-in for "refit the learned minutes layer", in the engine's own form (same as mid-fit).
 * The engine multiplies a player's remaining minutes by (1 + sum of coefficient x input), capped at -60% / +150%.
 * Here the same form is fitted ON TOP of the number the engine shows:
 *     real final - engine final  ~  engine remaining x (b . inputs)
 * with the engine's ridge (32 x 25 pseudo-rows of average weight). With only the 49 existing inputs this is the
 * "plain refit" baseline (what retraining the existing layer on complete games gives); extra columns are candidates.
 * A candidate is real only if it adds to the plain refit. Rows of players who never played count with their minutes so far. */
'use strict';
const C = require('./late-common');
const D0 = 49;
function design(rows, extra) {
  const X = [], y = [], keys = [], idx = [];
  const ne = extra ? extra.length : 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], rem = r.mn0 - r.now0;
    if (!(rem >= 0.25)) continue;
    const fin = r.ac0 != null ? r.ac0 : r.now0;
    const x = new Array(D0 + ne);
    for (let j = 0; j < D0; j++) x[j] = rem * r.x[j];
    for (let j = 0; j < ne; j++) x[D0 + j] = rem * (extra[j](r) || 0);
    X.push(x); y.push(fin - r.mn0); keys.push(r.tg); idx.push(i);
  }
  return { X, y, keys, idx };
}
function ridgeOf(X) { let w = 0; for (const x of X) w += x[0] * x[0]; return 32 * 25 * (w / X.length); }
function fit(rows, extra, opts = {}) {
  const Dn = design(rows, extra);
  const lam = opts.ridge != null ? opts.ridge : ridgeOf(Dn.X);
  return C.ols(Dn.X, Dn.y, Dn.keys, lam);
}
function predict(r, beta, extra) {
  const rem = r.mn0 - r.now0;
  if (!(rem >= 0.25)) return r.mn0;
  let z = 0;
  for (let j = 0; j < D0; j++) z += beta[j] * r.x[j];
  if (extra) for (let j = 0; j < extra.length; j++) z += beta[D0 + j] * (extra[j](r) || 0);
  return r.now0 + rem * (1 + Math.max(-0.6, Math.min(1.5, z)));
}
/** paired comparison of two predictions on rows with ac0 >= 10: mean abs miss each, difference, z clustered by game. */
function compare(rows, predA, predB) {
  const T = rows.filter(C.p10);
  const a = C.cl(T, (r) => Math.abs(r.ac0 - predA(r)), (r) => r.id), b = C.cl(T, (r) => Math.abs(r.ac0 - predB(r)), (r) => r.id);
  const d = C.cl(T, (r) => Math.abs(r.ac0 - predB(r)) - Math.abs(r.ac0 - predA(r)), (r) => r.id);
  return { n: T.length, a: a.mean, b: b.mean, d: d.mean, z: d.z, pct: 100 * d.mean / a.mean };
}
module.exports = { design, fit, predict, compare, D0 };
