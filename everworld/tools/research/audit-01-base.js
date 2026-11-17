#!/usr/bin/env node
'use strict';
/* Audit, step 1: the base table. Per stage and role: how many rows, who played, signed bias (real minus the engine's
 * plain average) for minutes, points, rebounds, assists among players who played, the all-in view (did not play = 0),
 * the miss of the shown number (10+ real minutes) and the same with real minutes plugged in.
 *   node tools/research/audit-01-base.js [season]
 */
const C = require('./audit-common');
const season = +(process.argv[2] || 2026);
const D = C.load(season);
const nG = D.nGames;
console.log(`season ${season}: ${D.rows.length} rows, ${nG} games, ${D.un.length} unprojected 10+ minute lines`);
const unBy = {}; for (const u of D.un) unBy[u.el] = (unBy[u.el] || 0) + 1;
console.log('unprojected by elapsed:', JSON.stringify(unBy));
// how often the engine's remaining minutes are under half a minute while he really had 2+ left
for (const g of C.STAGES) {
  const rs = D.rows.filter((r) => r.g === g && r._played);
  const bad = rs.filter((r) => r._remE < 0.5 && r._remR >= 2).length;
  console.log(`${g}: played ${rs.length}, engine remaining <0.5 but really 2+ left: ${bad}`);
}
const ROLES = { all: () => true, starter: (r) => r.st === 1, reserve: (r) => r.st !== 1 };
console.log('\nstage role      rows  played  p10 |  bias MIN    z | all-in MIN   z | bias PTS    z  REB     z  AST     z | per-min bias PTS   z   REB    z   AST    z | miss MIN PTS  REB  AST | real-min miss PTS REB AST');
for (const g of C.STAGES) for (const [rn, rf] of Object.entries(ROLES)) {
  const rs = D.rows.filter((r) => r.g === g && rf(r));
  const mk = () => ({ s: new Float64Array(nG), n: new Float64Array(nG) });
  const b = [mk(), mk(), mk(), mk()], br = [null, mk(), mk(), mk()], ai = mk();
  let nP = 0, n10 = 0; const e = [0, 0, 0, 0], er = [0, 0, 0, 0];
  for (const r of rs) {
    ai.s[r._gi] += r._d[0]; ai.n[r._gi]++;
    if (!r._played) continue;
    nP++;
    for (let k = 0; k < 4; k++) { b[k].s[r._gi] += r._d[k]; b[k].n[r._gi]++; if (k) { br[k].s[r._gi] += r._dr[k]; br[k].n[r._gi]++; } }
    if (r._p10) { n10++; for (let k = 0; k < 4; k++) { e[k] += r._e[k]; er[k] += r._er[k]; } }
  }
  const B = b.map((x) => C.clusterMean(x.s, x.n)), BR = br.map((x) => x && C.clusterMean(x.s, x.n)), AI = C.clusterMean(ai.s, ai.n);
  console.log(`${g.padEnd(4)} ${rn.padEnd(8)} ${String(rs.length).padStart(6)} ${String(nP).padStart(6)} ${String(n10).padStart(6)} | ${C.f3(B[0].m)} ${C.f1(B[0].z)} | ${C.f3(AI.m)} ${C.f1(AI.z)} | ${C.f3(B[1].m)} ${C.f1(B[1].z)} ${C.f3(B[2].m)} ${C.f1(B[2].z)} ${C.f3(B[3].m)} ${C.f1(B[3].z)} | ${C.f3(BR[1].m)} ${C.f1(BR[1].z)} ${C.f3(BR[2].m)} ${C.f1(BR[2].z)} ${C.f3(BR[3].m)} ${C.f1(BR[3].z)} | ${C.f2(e[0] / n10)} ${C.f2(e[1] / n10)} ${C.f2(e[2] / n10)} ${C.f2(e[3] / n10)} | ${C.f2(er[1] / n10)} ${C.f2(er[2] / n10)} ${C.f2(er[3] / n10)}`);
}
