'use strict';
/* Engine-form regression with extra inputs and cluster-robust z (games as clusters), for testing a candidate input
 * next to the 49 existing ones:   target ~ w x (b . [49 inputs, extras])   with the engine's ridge
 * (32 x 25 pseudo-rows of average weight; lineup inputs and candidates pulled 10x less). */
const C = require('./audit-common');
function invert(A, d) {
  const M = []; for (let i = 0; i < d; i++) { const x = new Float64Array(2 * d); for (let j = 0; j < d; j++) x[j] = A[i * d + j]; x[d + i] = 1; M.push(x); }
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) M[piv][c] = 1e-12;
    [M[c], M[piv]] = [M[piv], M[c]];
    const pv = M[c][c]; for (let k = 0; k < 2 * d; k++) M[c][k] /= pv;
    for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c]; if (!f) continue; for (let k = 0; k < 2 * d; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => r.slice(d));
}
/* rows; wOf(r) multiplier (>0 to be used); yOf(r) target (null = skip); xOf(r) = array of inputs (length d); nBase = how many are the old inputs */
function fit(rows, wOf, yOf, xOf, nBase = 49, opts = {}) {
  let d = 0; const X = [], Y = [], W = [], G = [];
  for (const r of rows) { const w = wOf(r); if (!(w > 0)) continue; const y = yOf(r); if (y == null) continue; const x = xOf(r); d = x.length; X.push(x); Y.push(y); W.push(w); G.push(r._gi); }
  const n = X.length; if (!n) return null;
  const A = new Float64Array(d * d), b = new Float64Array(d); let w2 = 0;
  for (let i = 0; i < n; i++) { const x = X[i], w = W[i]; w2 += w * w; for (let p = 0; p < d; p++) { const xp = x[p]; if (!xp) continue; b[p] += w * Y[i] * xp; const wp = w * w * xp; for (let q = 0; q < d; q++) if (x[q]) A[p * d + q] += wp * x[q]; } }
  const lam0 = opts.ridge != null ? opts.ridge : 32 * 25 * (w2 / n);
  const lineup = new Set([C.IX.startUp, C.IX.startDown, C.IX.fresh, C.IX.deep]);
  for (let p = 0; p < d; p++) A[p * d + p] += lam0 * (p >= nBase ? (opts.lamX != null ? opts.lamX : 0.1) : lineup.has(p) ? 0.1 : 1);
  const inv = invert(A, d);
  const beta = new Float64Array(d);
  for (let p = 0; p < d; p++) for (let q = 0; q < d; q++) beta[p] += inv[p][q] * b[q];
  let se = null;
  if (opts.se !== false) {
    const sc = new Map();
    for (let i = 0; i < n; i++) { const x = X[i], w = W[i]; let e = Y[i]; for (let p = 0; p < d; p++) e -= w * x[p] * beta[p]; let s = sc.get(G[i]); if (!s) sc.set(G[i], (s = new Float64Array(d))); for (let p = 0; p < d; p++) if (x[p]) s[p] += w * x[p] * e; }
    const M = new Float64Array(d * d);
    for (const s of sc.values()) for (let p = 0; p < d; p++) { if (!s[p]) continue; for (let q = 0; q < d; q++) M[p * d + q] += s[p] * s[q]; }
    se = new Float64Array(d);
    for (let p = 0; p < d; p++) { let v = 0; for (let q = 0; q < d; q++) { const a = inv[p][q]; if (!a) continue; let t = 0; for (let r = 0; r < d; r++) t += M[q * d + r] * inv[r][p]; v += a * t; } se[p] = Math.sqrt(Math.max(v, 0)); }
  }
  return { beta: Array.from(beta), se: se && Array.from(se), z: se && Array.from(beta).map((v, i) => (se[i] > 0 ? v / se[i] : 0)), n, d };
}
const dot = (beta, x) => { let z = 0; for (let i = 0; i < x.length; i++) z += beta[i] * x[i]; return z; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* paired comparison of two predictions of final minutes on a row list: mean abs miss each, % change, z by game */
function compare(rows, nG, predA, predB, actual = (r) => r._a[0]) {
  const s = new Float64Array(nG), n = new Float64Array(nG); let a = 0, b = 0, N = 0;
  for (const r of rows) { const ea = Math.abs(actual(r) - predA(r)), eb = Math.abs(actual(r) - predB(r)); a += ea; b += eb; N++; s[r._gi] += eb - ea; n[r._gi]++; }
  const m = C.clusterMean(s, n);
  return { n: N, a: a / N, b: b / N, pct: 100 * (b - a) / a, z: m.z };
}
module.exports = { fit, dot, clamp, compare, invert };
