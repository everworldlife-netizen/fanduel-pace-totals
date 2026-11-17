/* early-fit: an emulation of the engine's learned minutes layer on the dump rows, so that a new input can be priced the
 * way the engine would use it. final = now + rem * (1 + clamp(x . beta, -0.6, 1.5)), rem = plain final - now.
 * Fit = the engine's own least squares (weights rem^2, ridge 32 * 25 * mean(rem^2) per column), on a chosen population:
 *   rule 'all'    : everyone listed, a player who never gets in is graded at what he has (the engine's live rule)
 *   rule 'played' : only players who played (the engine's before-tip-off rule, and the population the app grades)
 */
'use strict';
const C = require('./early-common');
const D0 = 49;
function prep(all, ST, extra) {
  // extra: (o, ST) -> array of extra column values (already scaled to about -2..2)
  const out = [];
  for (const o of all) {
    const r = o[ST]; if (!r || !r.x) continue;
    const now = r.now[0], rem = r.mp - now;
    const x = r.x.slice(0, D0);
    const ex = extra ? extra(o, ST) : [];
    for (const v of ex) x.push(v || 0);
    out.push({ o, x, now, rem, ac: o.ac, tgtAll: o.ac > 0 ? o.ac : now, played: o.ac > 0, tg: o.tg, d: o.d, eng: r.mn[0], shown: r.pr[0] });
  }
  return out;
}
function fit(rows, rule, lam = 32, cols = null) {
  const d = rows[0].x.length; const use = cols || Array.from({ length: d }, (_, i) => i);
  const k = use.length; const A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
  let n = 0, w = 0;
  for (const q of rows) {
    if (rule === 'played' && !q.played) continue;
    if (!(q.rem >= 0.25)) continue;
    const y = (rule === 'played' ? q.ac : q.tgtAll) - (q.now + q.rem);
    const rem = q.rem;
    for (let i = 0; i < k; i++) { const xi = q.x[use[i]]; if (!xi) continue; b[i] += rem * y * xi; for (let j = 0; j < k; j++) A[i][j] += rem * rem * xi * q.x[use[j]]; }
    n++; w += rem * rem;
  }
  const avg = w / n;
  for (let i = 0; i < k; i++) A[i][i] += lam * avg * 25;
  const inv = C.invert(A); const beta = new Float64Array(d);
  for (let i = 0; i < k; i++) { let s = 0; for (let j = 0; j < k; j++) s += inv[i][j] * b[j]; beta[use[i]] = s; }
  return { beta: Array.from(beta), n };
}
function predict(q, beta) { let z = 0; for (let i = 0; i < beta.length; i++) z += beta[i] * (q.x[i] || 0); const f = 1 + Math.max(-0.6, Math.min(1.5, z)); return q.rem >= 0 ? Math.min(48 + 10, q.now + q.rem * f) : q.now + q.rem; }
/** paired comparison of two prediction functions on a population: mean abs miss each, difference, clustered z. */
function compare(rows, pa, pb, pop) {
  const li = rows.filter(pop);
  const m = new Map(); let sa = 0, sb = 0;
  for (const q of li) { const a = Math.abs(pa(q) - q.ac), b = Math.abs(pb(q) - q.ac); sa += a; sb += b; let x = m.get(q.tg); if (!x) m.set(q.tg, (x = [0])); x[0] += b - a; }
  const n = li.length; const mean = (sb - sa) / n; let v = 0; for (const x of m.values()) { const e = x[0] - mean * (n / m.size); v += e * e; }
  // ratio-style: cluster sums of differences
  let S = 0; const arr = [...m.values()].map((x) => x[0]); for (const s of arr) S += s; const mu = S / arr.length; let vv = 0; for (const s of arr) vv += (s - mu) * (s - mu); const se = Math.sqrt(vv * arr.length / (arr.length - 1)) / n;
  return { n, a: sa / n, b: sb / n, d: mean, pct: 100 * mean / (sa / n), z: mean / se };
}
const POPS = { '10+': (q) => q.ac >= 10, 'played': (q) => q.ac > 0, 'listed': () => true };
module.exports = { prep, fit, predict, compare, POPS, D0 };
