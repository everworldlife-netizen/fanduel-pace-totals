/* late-common: shared helpers for the late-game minutes research (stages s36, s42; s30 kept for cross-checks).
 * Loads the feature file written by late-01-build.js; team-game clustered statistics (same maths as mid-common). */
'use strict';
const path = require('path');
const L = require('../lib');
const FEAT = (season) => path.join(L.ROOT, 'data/research', `late-feat-${season}.json.gz`);
const PAT_F = ['base', 'starter', 'bench', 'b2b', 'pace', 'blowout', 'roleTrend', 'matesOut', 'proof', 'home', 'softD', 'track', 'fouls', 'livePace', 'margin', 'minTrack', 'shooting',
  'uReal', 'luck', 'leadS', 'trailS', 'lopB', 'on', 'sitLong', 'dnp', 'usgHi', 'closeStar', 'pfX', 'recent', 'mpgC', 'fadeHist', 'leadProof', 'tdMkt', 'tdLive',
  'startUp', 'startDown', 'fresh', 'deep', 'vacPos', 'lastMin', 'rest3', 'missShare', 'loadS', 'loadB', 'loadBd', 'loadBq', 'favS', 'dogS', 'dogB'];
const IX = Object.fromEntries(PAT_F.map((k, i) => [k, i]));
function load(season) {
  const rows = L.readJSON(FEAT(season));
  for (const r of rows) {
    r.tg = r.id + ':' + r.tm;
    r.gap = r.ac0 != null ? r.ac0 - r.mn0 : null; // real final minus engine final
    r.rem = r.ac0 != null ? r.ac0 - r.now0 : null; // real minutes still to come (overtime included)
    r.erem = r.mn0 - r.now0; // engine's minutes still to come
  }
  return rows;
}
const played = (r) => r.ac0 != null && r.ac0 > 0;
const p10 = (r) => r.ac0 != null && r.ac0 >= 10;
/** mean of f over list, z clustered by key (default team-game). */
function cl(list, f, keyF) {
  const m = new Map();
  for (const o of list) { const k = keyF ? keyF(o) : o.tg; let a = m.get(k); if (!a) m.set(k, (a = [0, 0])); a[0] += f(o); a[1]++; }
  let S = 0, N = 0; for (const a of m.values()) { S += a[0]; N += a[1]; }
  if (!N) return { mean: NaN, se: NaN, z: NaN, n: 0, G: 0 };
  const mean = S / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; }
  const G = m.size; const se = G > 1 ? Math.sqrt(v * G / (G - 1)) / N : NaN;
  return { mean, se, z: mean / se, n: N, G };
}
/** difference of means A - B with a joint cluster linearisation. */
function diff(listA, listB, f, keyF) {
  const kf = keyF || ((o) => o.tg);
  const a = cl(listA, f, kf), b = cl(listB, f, kf);
  const m = new Map();
  for (const o of listA) { const k = kf(o); let x = m.get(k); if (!x) m.set(k, (x = [0, 0])); x[0] += (f(o) - a.mean) / a.n; }
  for (const o of listB) { const k = kf(o); let x = m.get(k); if (!x) m.set(k, (x = [0, 0])); x[1] += (f(o) - b.mean) / b.n; }
  let v = 0; for (const x of m.values()) { const e = x[0] - x[1]; v += e * e; }
  const G = m.size; const se = Math.sqrt(v * G / (G - 1));
  return { d: a.mean - b.mean, se, z: (a.mean - b.mean) / se, nA: a.n, nB: b.n, GA: a.G, GB: b.G, a: a.mean, b: b.mean };
}
function invert(A) {
  const d = A.length; const M = A.map((r, i) => { const x = new Float64Array(2 * d); x.set(r); x[d + i] = 1; return x; });
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) M[piv][c] = 1e-12;
    [M[c], M[piv]] = [M[piv], M[c]];
    const pv = M[c][c]; for (let k = 0; k < 2 * d; k++) M[c][k] /= pv;
    for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c]; if (!f) continue; for (let k = 0; k < 2 * d; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => Array.from(r.slice(d)));
}
/** OLS (optional ridge) with cluster-robust se. */
function ols(X, y, keys, ridge = 0) {
  const n = X.length, d = X[0].length;
  const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (let i = 0; i < n; i++) { const x = X[i]; for (let p = 0; p < d; p++) { if (!x[p]) continue; b[p] += x[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += x[p] * x[q]; } }
  for (let p = 0; p < d; p++) A[p][p] += ridge;
  const inv = invert(A);
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
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '   -' : (v >= 0 ? '+' : '') + v.toFixed(d));
/** one line: label, n, team-games, mean of f (default the gap), z */
function line(label, list, f = (r) => r.gap, keyF) {
  const c = cl(list, f, keyF);
  return `${String(label).padEnd(46)} n=${String(c.n).padStart(6)} tg=${String(c.G).padStart(5)}  mean=${fmt(c.mean, 3).padStart(7)}  z=${fmt(c.z, 1).padStart(6)}`;
}
const onBetween = (st, a, b) => { let s = 0; if (b <= a) return 0; for (const [x, y] of st) { const lo = Math.max(x, a), hi = Math.min(y, b); if (hi > lo) s += hi - lo; } return s; };
const onAt = (st, t) => { for (const [x, y] of st) if (x <= t && t < y) return true; return false; };
/** split by date: first half / second half of the games (by game count, cut on a date). */
function splitByDate(rows) {
  const gd = new Map(); for (const r of rows) gd.set(r.id, r.d);
  const ids = [...gd.keys()].sort((a, b) => (gd.get(a) < gd.get(b) ? -1 : gd.get(a) > gd.get(b) ? 1 : a - b));
  const cutDate = gd.get(ids[Math.floor(ids.length / 2)]);
  return { cutDate, A: rows.filter((r) => r.d < cutDate), B: rows.filter((r) => r.d >= cutDate) };
}
module.exports = { L, FEAT, PAT_F, IX, load, played, p10, cl, diff, ols, invert, fmt, line, onBetween, onAt, splitByDate };
