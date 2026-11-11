'use strict';
// Deep bench at tip-off: gap (real - engine) against absent teammates' minutes and his own season average; z by game.
const C = require('./pregame-common');
for (const season of [2026, 2027]) {
  const S = C.prepare(season);
  const d = S.rows.filter((r) => r.g === 'pre' && r.dp && r.gap != null);
  const X = d.map((r) => [1, Math.min(r.f.outTot || 0, 150) / 10, r.f.seasonMpg != null ? r.f.seasonMpg : (r.f.lastMpg != null ? r.f.lastMpg : 10)]);
  const m = C.ols(d.map((r) => r.gap), X, d.map((r) => r.id));
  console.log(`${season} tip-off, deep bench who played: ${d.length} rows, ${new Set(d.map((r) => r.tgk)).size} team-games; gap = ${m.beta[0].toFixed(2)} (z ${m.z[0].toFixed(1)}) + ${m.beta[1].toFixed(3)} per 10 absent minutes (z ${m.z[1].toFixed(1)}) + ${m.beta[2].toFixed(3)} per minute of his season average (z ${m.z[2].toFixed(1)}); mean gap ${C.mean(d.map((r) => r.gap)).toFixed(2)}, engine number ${C.mean(d.map((r) => r.mn[0])).toFixed(1)}, real ${C.mean(d.map((r) => r.ac[0])).toFixed(1)}`);
  const all = S.rows.filter((r) => r.g === 'pre' && r.dp);
  console.log(`   all deep-bench candidates ${all.length}: played ${(100 * all.filter((r) => r.ac && r.ac[0] > 0).length / all.length).toFixed(0)}%, 10+ ${(100 * all.filter((r) => r.ac && r.ac[0] >= 10).length / all.length).toFixed(0)}%`);
}
