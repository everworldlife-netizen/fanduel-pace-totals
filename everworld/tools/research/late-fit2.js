/* late-fit2: like late-fit, but the pull toward "no effect" can be set per input (the engine has this too: PAT_LAMF gives
 * rare-but-strong inputs a weaker pull). ridgeCand = the factor for candidate inputs relative to the engine's usual pull. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
function olsV(X, y, keys, ridge) {
  const n = X.length, d = X[0].length;
  const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (let i = 0; i < n; i++) { const x = X[i]; for (let p = 0; p < d; p++) { if (!x[p]) continue; b[p] += x[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += x[p] * x[q]; } }
  for (let p = 0; p < d; p++) A[p][p] += ridge[p];
  const inv = C.invert(A);
  const beta = new Float64Array(d);
  for (let p = 0; p < d; p++) for (let q = 0; q < d; q++) beta[p] += inv[p][q] * b[q];
  const sc = new Map();
  for (let i = 0; i < n; i++) { const x = X[i]; let e = y[i]; for (let p = 0; p < d; p++) e -= x[p] * beta[p]; let s = sc.get(keys[i]); if (!s) sc.set(keys[i], (s = new Float64Array(d))); for (let p = 0; p < d; p++) s[p] += x[p] * e; }
  const M = Array.from({ length: d }, () => new Float64Array(d));
  for (const s of sc.values()) for (let p = 0; p < d; p++) { if (!s[p]) continue; for (let q = 0; q < d; q++) M[p][q] += s[p] * s[q]; }
  const se = new Float64Array(d);
  for (let p = 0; p < d; p++) { let v = 0; for (let q = 0; q < d; q++) { if (!inv[p][q]) continue; for (let r = 0; r < d; r++) v += inv[p][q] * M[q][r] * inv[r][p]; } se[p] = Math.sqrt(Math.max(v, 0)); }
  return { beta: Array.from(beta), se: Array.from(se), z: Array.from(beta).map((v, i) => v / se[i]), G: sc.size, n };
}
function fit(rows, extra, ridgeCand = 1) {
  const Dn = F.design(rows, extra);
  let w = 0; for (const x of Dn.X) w += x[0] * x[0];
  const lam = 32 * 25 * (w / Dn.X.length);
  const d = Dn.X[0].length, ridge = new Array(d).fill(lam);
  for (let j = F.D0; j < d; j++) ridge[j] = lam * ridgeCand;
  return olsV(Dn.X, Dn.y, Dn.keys, ridge);
}
module.exports = { fit, olsV };
