/* early-common: load the dump (pre/s6/s12 joined per player-game) with the rotation-timing features. */
'use strict';
const L = require('../lib');
function load(season) {
  const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
  const F = L.readJSON(`${L.ROOT}/data/research/early-feat-${season}.json.gz`);
  const J = new Map();
  for (const r of rows) { if (r.un || !(r.g === 'pre' || r.g === 's6' || r.g === 's12' || r.g === 'rep')) continue; const k = r.id + ':' + r.pid; let o = J.get(k); if (!o) J.set(k, (o = { k })); o[r.g] = r; }
  const all = [];
  for (const o of J.values()) { if (!(o.pre && o.s6 && o.s12)) continue; o.f = F[o.k]; if (!o.f) continue; o.ac = o.pre.ac ? o.pre.ac[0] : 0; o.tg = o.pre.id + ':' + o.pre.tm; o.d = o.pre.d; all.push(o); }
  return all;
}
/** mean of f over list with team-game clustered z (ratio estimator). */
function cl(list, f, keyF) {
  const m = new Map();
  for (const o of list) { const k = keyF ? keyF(o) : o.tg; let a = m.get(k); if (!a) m.set(k, (a = [0, 0])); a[0] += f(o); a[1]++; }
  let S = 0, N = 0; for (const a of m.values()) { S += a[0]; N += a[1]; }
  const mean = S / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; }
  const G = m.size; const se = G > 1 ? Math.sqrt(v * G / (G - 1)) / N : NaN;
  return { mean, se, z: mean / se, n: N, G };
}
/** difference of means A - B with clustered se (clusters may overlap: use per-cluster linearisation on the pooled set). */
function diff(listA, listB, f) {
  const a = cl(listA, f), b = cl(listB, f);
  // conservative: treat as independent unless same clusters; do a joint linearisation
  const m = new Map();
  for (const o of listA) { let x = m.get(o.tg); if (!x) m.set(o.tg, (x = [0, 0, 0, 0])); x[0] += f(o) - a.mean; x[1]++; }
  for (const o of listB) { let x = m.get(o.tg); if (!x) m.set(o.tg, (x = [0, 0, 0, 0])); x[2] += f(o) - b.mean; x[3]++; }
  let v = 0; for (const x of m.values()) { const e = x[0] / a.n - x[2] / b.n; v += e * e; }
  const G = m.size; const se = Math.sqrt(v * G / (G - 1));
  return { d: a.mean - b.mean, se, z: (a.mean - b.mean) / se, nA: a.n, nB: b.n, GA: a.G, a: a.mean, b: b.mean };
}
/** OLS with cluster-robust se. X rows arrays, y array, cluster keys. Returns beta, se, z. */
function ols(X, y, keys, ridge = 0) {
  const n = X.length, d = X[0].length;
  const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (let i = 0; i < n; i++) { const x = X[i]; for (let p = 0; p < d; p++) { if (!x[p]) continue; b[p] += x[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += x[p] * x[q]; } }
  for (let p = 0; p < d; p++) A[p][p] += ridge;
  const inv = invert(A);
  const beta = new Float64Array(d);
  for (let p = 0; p < d; p++) for (let q = 0; q < d; q++) beta[p] += inv[p][q] * b[q];
  // cluster meat
  const sc = new Map();
  for (let i = 0; i < n; i++) { const x = X[i]; let e = y[i]; for (let p = 0; p < d; p++) e -= x[p] * beta[p]; let s = sc.get(keys[i]); if (!s) sc.set(keys[i], (s = new Float64Array(d))); for (let p = 0; p < d; p++) s[p] += x[p] * e; }
  const M = Array.from({ length: d }, () => new Float64Array(d));
  for (const s of sc.values()) for (let p = 0; p < d; p++) { if (!s[p]) continue; for (let q = 0; q < d; q++) M[p][q] += s[p] * s[q]; }
  const se = new Float64Array(d);
  for (let p = 0; p < d; p++) { let v = 0; for (let q = 0; q < d; q++) for (let r = 0; r < d; r++) v += inv[p][q] * M[q][r] * inv[r][p]; se[p] = Math.sqrt(Math.max(v, 0)); }
  return { beta: Array.from(beta), se: Array.from(se), z: Array.from(beta).map((v, i) => v / se[i]), G: sc.size, n };
}
function invert(A) {
  const d = A.length; const M = A.map((r, i) => { const x = new Float64Array(2 * d); x.set(r); x[d + i] = 1; return x; });
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) { M[c][c] = 1e-10; }
    [M[c], M[piv]] = [M[piv], M[c]];
    const pv = M[c][c]; for (let k = 0; k < 2 * d; k++) M[c][k] /= pv;
    for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c]; if (!f) continue; for (let k = 0; k < 2 * d; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => Array.from(r.slice(d)));
}
module.exports = { load, cl, diff, ols, invert, L };
