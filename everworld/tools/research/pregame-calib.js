'use strict';
// Calibration of the engine's minutes by level, per stage: is there curvature left that a level-only recalibration would fix?
const C = require('./pregame-common');
const S = C.prepare(+process.argv[2] || 2026);
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  console.log('\n' + g, 'played rows', rs.length);
  const bins = [[0, 6], [6, 10], [10, 14], [14, 18], [18, 22], [22, 26], [26, 30], [30, 33], [33, 36], [36, 60]];
  console.log(' mn bin      n     gap     se      z   | share played 10+ | miss10 ');
  for (const [a, b] of bins) {
    const q = rs.filter((r) => r.mn[0] >= a && r.mn[0] < b); if (!q.length) continue;
    const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id));
    const p10 = q.filter((r) => r.ac[0] >= 10);
    console.log(` ${String(a).padStart(2)}-${String(b).padEnd(3)} ${String(c.n).padStart(6)} ${c.m.toFixed(2).padStart(7)} ${c.se.toFixed(2).padStart(6)} ${c.z.toFixed(1).padStart(6)}   | ${(p10.length / q.length).toFixed(2)} | ${C.mean(p10.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)}`);
  }
  // all rows (did-not-play counted as 0 minutes): the unconditional picture
  const all = S.rows.filter((r) => r.g === g);
  console.log(' unconditional (did not play = 0):');
  for (const [a, b] of bins) {
    const q = all.filter((r) => r.mn[0] >= a && r.mn[0] < b); if (!q.length) continue;
    const c = C.cmean(q.map((r) => (r.ac ? r.ac[0] : 0) - r.mn[0]), q.map((r) => r.id));
    console.log(` ${String(a).padStart(2)}-${String(b).padEnd(3)} ${String(c.n).padStart(6)} ${c.m.toFixed(2).padStart(7)} ${c.se.toFixed(2).padStart(6)} ${c.z.toFixed(1).padStart(6)}   played ${(q.filter((r) => r.ac && r.ac[0] > 0).length / q.length).toFixed(3)}`);
  }
}
