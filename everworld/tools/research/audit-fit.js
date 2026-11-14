'use strict';
/* Plain refit of the existing 49 learned inputs, in the engine's own form, used as the audit's second yardstick:
 *   minutes:      real final - engine final  ~  engine remaining minutes x (b . inputs)        (cap -60% / +150%)
 *   per-minute:   real stat - engine stat with real minutes  ~  engine remaining stat at real minutes x (b . inputs)  (cap +-30%)
 * Cross-fitted by halves of the season (fit on one half by date, predict the other) so the residual of every 2026 row is
 * out of sample; 2027 rows get the fit made on all of 2026. A scenario that is still off AFTER this refit is not a matter
 * of stale weights: the engine has no input (or no shape) for it. */
const C = require('./audit-common');
const D0 = 49;

function solve(A, b, d) { // Gauss-Jordan on a copy
  const M = []; for (let i = 0; i < d; i++) { const row = new Float64Array(d + 1); for (let j = 0; j < d; j++) row[j] = A[i * d + j]; row[d] = b[i]; M.push(row); }
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[d] / row[i]));
}
/* rows: list; wOf(r) = the multiplier (remaining amount), yOf(r) = target, xOf(r) = the 49 inputs. Engine ridge: 32 x 25 pseudo-rows of average weight. */
function fit(rows, wOf, yOf, xOf) {
  const A = new Float64Array(D0 * D0), b = new Float64Array(D0);
  let n = 0, w2 = 0;
  for (const r of rows) {
    const w = wOf(r); if (!(w > 0)) continue;
    const y = yOf(r); if (y == null) continue;
    const x = xOf(r);
    n++; w2 += w * w;
    for (let i = 0; i < D0; i++) { const xi = x[i]; if (!xi) continue; b[i] += w * y * xi; const wi = w * w * xi; for (let j = 0; j < D0; j++) { const xj = x[j]; if (xj) A[i * D0 + j] += wi * xj; } }
  }
  if (!n) return null;
  const lam = 32 * 25 * (w2 / n);
  const lineup = new Set([C.IX.startUp, C.IX.startDown, C.IX.fresh, C.IX.deep]);
  for (let i = 0; i < D0; i++) A[i * D0 + i] += lam * (lineup.has(i) ? 0.1 : 1);
  return solve(A, b, D0);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot = (beta, x) => { let z = 0; for (let i = 0; i < D0; i++) z += beta[i] * x[i]; return z; };

// stat-specific inputs: the 'track' input (index 11) is the stat's own pace so far; everything else as in the minutes row
function xStat(r, k) {
  if (k === 1) return r.x; // the minutes row already carries the points track
  const x = r.x.slice();
  const exp = r.rpm[k - 1] * r.now[0];
  x[11] = r.g !== 'rep' && r.g !== 'pre' && r.now[0] >= 4 && exp > 0.3 ? clamp((r.now[k] - exp) / Math.sqrt(exp + 1), -2, 2.5) : 0;
  return x;
}
const live = (r) => r.g !== 'rep' && r.g !== 'pre';
// minutes design
const wMin = (r) => (r._remE >= 0.25 ? r._remE : 0);
const yMin = (r) => (r._played ? r._d[0] : live(r) ? r.now[0] - r.mn[0] : null); // live: never got in = finished with what he had; before tip: skipped
// per-minute design (players who played): engine's remaining stat at the real remaining minutes
const wStat = (k) => (r) => (r._played ? r._rm[k] - r.now[k] : 0);
const yStat = (k) => (r) => (r._played ? r._dr[k] : null);

// optional extra inputs for the minutes model (yardstick "C": the 49 inputs plus the calibration pair thin / full)
const REG = require('./audit-reg');
const EXTRA = { C: [(r) => Math.min(3 / Math.max(r._remE, 0.25), 6), (r) => r._remE / (48 - r.el) - 0.5] };
let extraMin = null;
const xMin = (r) => { if (!extraMin) return r.x; const x = r.x.slice(); for (const f of extraMin) x.push(f(r)); return x; };
function fitStage(rows) {
  const o = { min: extraMin ? REG.fit(rows, wMin, yMin, xMin, 49, { se: false }).beta : fit(rows, wMin, yMin, (r) => r.x) };
  for (let k = 1; k <= 3; k++) o['s' + k] = fit(rows, wStat(k), yStat(k), (r) => xStat(r, k));
  return o;
}
function apply(r, o) {
  // minutes after the plain refit
  const w = wMin(r);
  r._mR = o && o.min && w > 0 ? r.mn[0] + w * clamp(REG.dot(o.min, xMin(r)), -0.6, 1.5) : r.mn[0];
  r._dR = r._a[0] - r._mR; // residual, real minus refit (did not play = 0)
  r._qR = [0, 0, 0, 0];
  for (let k = 1; k <= 3; k++) {
    const ws = r._rm[k] - r.now[k];
    const adj = o && o['s' + k] && ws > 0 ? ws * clamp(dot(o['s' + k], xStat(r, k)), -0.3, 0.3) : 0;
    r._qR[k] = r._dr[k] - adj; // per-minute residual after the plain refit
  }
}
/* attach residuals: cross-fitted on the discovery season, and (if given) out of sample on the confirmation season */
function attach(D26, D27, yard) {
  extraMin = yard && EXTRA[yard] ? EXTRA[yard] : null;
  const models = {};
  for (const g of C.STAGES) {
    const rs = D26.rows.filter((r) => r.g === g);
    const h0 = rs.filter((r) => r._half === 0), h1 = rs.filter((r) => r._half === 1);
    const m0 = fitStage(h0), m1 = fitStage(h1), mAll = fitStage(rs);
    for (const r of h0) apply(r, m1);
    for (const r of h1) apply(r, m0);
    models[g] = mAll;
    // confirmation season: its engine was taught on other lessons, so the 2026 weights are not its plain refit. Refit the same
    // inputs on the confirmation season itself (in sample: a little too kind to the refit, so conservative for what is left over)
    if (D27) { const rs27 = D27.rows.filter((r) => r.g === g); const m27 = process.env.AUDIT_27 === 'from26' ? mAll : fitStage(rs27); for (const r of rs27) apply(r, m27); }
  }
  return models;
}
module.exports = { fit, fitStage, apply, attach, xStat, solve, D0 };
