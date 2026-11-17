/* late-anchor: "state anchors". For each state (a key computed from the live floor picture) fit
 *     real remaining = a + b x engine remaining
 * on training rows, apply to test rows (clamped to 0 .. time left + 1). A state with fewer than minN training rows keeps the
 * engine's number. kind 'L2' = least squares (calibrates the mean), 'L1' = least absolute deviations (calibrates the middle:
 * what the shown number should be if the goal is the smallest average miss). */
'use strict';
const C = require('./late-common');
function fitLine(xs, ys, kind) {
  const n = xs.length; let w = new Float64Array(n).fill(1), a = 0, b = 1;
  for (let it = 0; it < (kind === 'L1' ? 40 : 1); it++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sw += w[i]; sx += w[i] * xs[i]; sy += w[i] * ys[i]; sxx += w[i] * xs[i] * xs[i]; sxy += w[i] * xs[i] * ys[i]; }
    const den = sw * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) { a = sy / sw; b = 0; } else { b = (sw * sxy - sx * sy) / den; a = (sy - b * sx) / sw; }
    if (kind === 'L1') for (let i = 0; i < n; i++) w[i] = 1 / Math.max(Math.abs(ys[i] - a - b * xs[i]), 0.05);
  }
  return [a, b];
}
function fit(rows, stateF, { kind = 'L2', minN = 60 } = {}) {
  const by = new Map();
  for (const r of rows) { if (r.ac0 == null) continue; const k = stateF(r); if (k == null) continue; let a = by.get(k); if (!a) by.set(k, (a = { x: [], y: [] })); a.x.push(r.mn0 - r.now0); a.y.push(r.ac0 - r.now0); }
  const lines = new Map();
  for (const [k, v] of by) if (v.x.length >= minN) lines.set(k, [...fitLine(v.x, v.y, kind), v.x.length]);
  return lines;
}
function predict(r, lines, stateF) {
  const k = stateF(r); const ln = k == null ? null : lines.get(k);
  if (!ln) return r.mn0;
  const left = 48 - r.el;
  return r.now0 + Math.max(0, Math.min(left + 1, ln[0] + ln[1] * (r.mn0 - r.now0)));
}
/** paired comparison on players with 10+ real minutes, clustered by game */
function compare(rows, predA, predB) {
  const T = rows.filter(C.p10);
  const a = C.cl(T, (r) => Math.abs(r.ac0 - predA(r)), (r) => r.id), b = C.cl(T, (r) => Math.abs(r.ac0 - predB(r)), (r) => r.id);
  const d = C.cl(T, (r) => Math.abs(r.ac0 - predB(r)) - Math.abs(r.ac0 - predA(r)), (r) => r.id);
  return { n: T.length, a: a.mean, b: b.mean, d: d.mean, z: d.z, pct: 100 * d.mean / a.mean };
}
module.exports = { fit, predict, compare, fitLine };
