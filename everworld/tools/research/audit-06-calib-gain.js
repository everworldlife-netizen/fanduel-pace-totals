#!/usr/bin/env node
'use strict';
/* Audit, step 6: how much of the minutes miss does "the engine's remaining minutes are too spread out" account for?
 * Everything fitted on the first half of 2026 (by date) and scored on the second half; then fitted on all of 2026 and scored on 2027.
 *   A  engine as dumped
 *   B  plain refit of the 49 inputs (engine form, caps -60% / +150%)
 *   C  B plus two inputs: thin = 3 / remaining (an additive lift in the engine's share form), full = remaining / clock left - 0.5
 *   C2 the same, but the 'thin' part is applied outside the +150% cap
 *   D  A followed by a calibration table (engine remaining -> real remaining, by bands, monotone)
 *   E  B followed by the same kind of table
 * Scored on players with 10+ real minutes (the app's rule) and on every graded row (live: never got in = 0). */
const C = require('./audit-common');
const REG = require('./audit-reg');
const D26 = C.load(2026), D27 = C.load(2027);
const wMin = (r) => (r._remE >= 0.25 ? r._remE : 0);
const live = (r) => r._s >= 2;
const yMin = (r) => (r._played || live(r) ? r._d[0] : null);
const left = (r) => 48 - r.el;
const thin = (r) => Math.min(3 / Math.max(r._remE, 0.25), 6);
const full = (r) => r._remE / left(r) - 0.5;
const x51 = (r) => { const x = r.x.slice(); x.push(thin(r), full(r)); return x; };
const KN = [0, 0.5, 1, 2, 3.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 99];
function table(rows, remOf) { // monotone band means
  const pts = [];
  for (let i = 0; i + 1 < KN.length; i++) { let e = 0, a = 0, n = 0; for (const r of rows) { if (yMin(r) == null) continue; const q = remOf(r); if (q >= KN[i] && q < KN[i + 1]) { e += q; a += r._a[0] - r.now[0]; n++; } } if (n >= 30) pts.push([e / n, a / n, n]); }
  // pool adjacent violators on the real means
  for (let ch = true; ch;) { ch = false; for (let i = 0; i + 1 < pts.length; i++) if (pts[i][1] > pts[i + 1][1]) { const n = pts[i][2] + pts[i + 1][2]; pts.splice(i, 2, [(pts[i][0] * pts[i][2] + pts[i + 1][0] * pts[i + 1][2]) / n, (pts[i][1] * pts[i][2] + pts[i + 1][1] * pts[i + 1][2]) / n, n]); ch = true; break; } }
  return pts;
}
function look(pts, q) {
  if (!pts.length) return q;
  if (q <= pts[0][0]) return Math.max(q + (pts[0][1] - pts[0][0]), 0);
  for (let i = 0; i + 1 < pts.length; i++) if (q <= pts[i + 1][0]) { const t = (q - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]); }
  const L = pts[pts.length - 1]; return Math.max(q + (L[1] - L[0]), 0);
}
function models(train) {
  const B = REG.fit(train, wMin, yMin, (r) => r.x, 49, { se: false });
  const Cm = REG.fit(train, wMin, yMin, x51, 49);
  const pB = (r) => { const w = wMin(r); return w > 0 ? r.mn[0] + w * REG.clamp(REG.dot(B.beta, r.x), -0.6, 1.5) : r.mn[0]; };
  const pC = (r) => { const w = wMin(r); return w > 0 ? r.mn[0] + w * REG.clamp(REG.dot(Cm.beta, x51(r)), -0.6, 1.5) : r.mn[0]; };
  const pC2 = (r) => { const w = wMin(r); if (!(w > 0)) return r.mn[0]; const x = x51(r); const zt = Cm.beta[49] * x[49]; return Math.max(r.mn[0] + w * REG.clamp(REG.dot(Cm.beta, x) - zt, -0.6, 1.5) + w * zt, r.now[0]); };
  const tA = table(train, (r) => r._remE), tB = table(train, (r) => pB(r) - r.now[0]);
  const pD = (r) => r.now[0] + look(tA, r._remE);
  const pE = (r) => r.now[0] + look(tB, pB(r) - r.now[0]);
  return { pA: (r) => r.mn[0], pB, pC, pC2, pD, pE, Cm, tA };
}
const fmt = (c) => `${c.b.toFixed(3)} (${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)})`;
for (const g of C.STAGES) {
  const r26 = D26.rows.filter((r) => r.g === g), r27 = D27.rows.filter((r) => r.g === g);
  for (const [name, train, test, nG] of [['2026 first half -> second half', r26.filter((r) => r._half === 0), r26.filter((r) => r._half === 1), D26.nGames], ['all 2026 -> 2027', r26, r27, D27.nGames]]) {
    const M = models(train);
    const t10 = test.filter((r) => r._p10), tG = test.filter((r) => yMin(r) != null);
    console.log(`\n== ${g}: ${name} (10+: ${t10.length}, graded: ${tG.length}); new inputs: thin b=${M.Cm.beta[49].toFixed(4)} z ${M.Cm.z[49].toFixed(1)} (= ${(3 * M.Cm.beta[49]).toFixed(2)} min added to anyone), full b=${M.Cm.beta[50].toFixed(4)} z ${M.Cm.z[50].toFixed(1)}`);
    for (const [pop, T] of [['10+ ', t10], ['all ', tG]]) {
      const a = REG.compare(T, nG, M.pA, M.pA).a;
      console.log(`  ${pop} A engine ${a.toFixed(3)} | B refit ${fmt(REG.compare(T, nG, M.pA, M.pB))} | C +thin,full vs B ${fmt(REG.compare(T, nG, M.pB, M.pC))} | C2 vs B ${fmt(REG.compare(T, nG, M.pB, M.pC2))} | D table vs A ${fmt(REG.compare(T, nG, M.pA, M.pD))} | E table on refit vs B ${fmt(REG.compare(T, nG, M.pB, M.pE))}`);
    }
    if (name.startsWith('all')) console.log('  table (engine remaining -> real remaining): ' + M.tA.map((p) => `${p[0].toFixed(1)}->${p[1].toFixed(1)}`).join('  '));
  }
}
