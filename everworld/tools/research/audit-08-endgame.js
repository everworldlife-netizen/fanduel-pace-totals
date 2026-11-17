#!/usr/bin/env node
'use strict';
/* Audit, step 8: the last stages by game script. Role x on/off the floor x score band at a stage:
 * engine remaining minutes before the learned layer (plain), as shown (final), and real; gap and z (games as clusters); 2027 next to it.
 *   node tools/research/audit-08-endgame.js s42 */
const C = require('./audit-common');
const g = process.argv[2] || 's42';
const D = { 2026: C.load(2026), 2027: C.load(2027) };
const band = (mg) => (mg >= 20 ? 'lead 20+' : mg >= 13 ? 'lead 13-19' : mg >= 6 ? 'lead 6-12' : mg >= -5 ? 'close +-5' : mg >= -12 ? 'trail 6-12' : mg >= -19 ? 'trail 13-19' : 'trail 20+');
const BANDS = ['lead 20+', 'lead 13-19', 'lead 6-12', 'close +-5', 'trail 6-12', 'trail 13-19', 'trail 20+'];
const cell = {};
for (const y of [2026, 2027]) {
  const nG = D[y].nGames;
  for (const r of D[y].rows) {
    if (r.g !== g) continue;
    const k = `${r.st === 1 ? 'starter' : 'reserve'}|${r.dnp ? 'not in yet' : r.on ? 'on' : 'off'}|${band(r.mg)}`;
    const c = (cell[k] = cell[k] || {}); const o = (c[y] = c[y] || { s: new Float64Array(nG), n: new Float64Array(nG), N: 0, plain: 0, fin: 0, real: 0, tg: new Set(), n10: 0, miss: 0 });
    o.s[r._gi] += r._d[0]; o.n[r._gi]++; o.N++; o.plain += r.mp - r.now[0]; o.fin += r._remE; o.real += r._a[0] - r.now[0]; o.tg.add(r.id + ':' + r.tm);
    if (r._p10) { o.n10++; o.miss += r._e[0]; }
  }
}
console.log(`${g}: role | floor | score | 2026 rows team-games | plain  final  real | gap    z | miss(10+) || 2027 rows tg | final real | gap z`);
for (const role of ['starter', 'reserve']) for (const fl of ['on', 'off', 'not in yet']) for (const b of BANDS) {
  const c = cell[`${role}|${fl}|${b}`]; if (!c || !c[2026]) continue;
  const a = c[2026], m = C.clusterMean(a.s, a.n), e = c[2027];
  let t = '';
  if (e) { const m2 = C.clusterMean(e.s, e.n); t = `${String(e.N).padStart(5)} ${String(e.tg.size).padStart(4)} | ${C.f2(e.fin / e.N)} ${C.f2(e.real / e.N)} | ${C.f2(m2.m)} ${C.f1(m2.z, 6)}`; }
  console.log(`${role.padEnd(8)} ${fl.padEnd(10)} ${b.padEnd(12)} | ${String(a.N).padStart(5)} ${String(a.tg.size).padStart(4)} | ${C.f2(a.plain / a.N)} ${C.f2(a.fin / a.N)} ${C.f2(a.real / a.N)} | ${C.f2(m.m)} ${C.f1(m.z, 6)} | ${C.f2(a.miss / a.n10)} || ${t}`);
}
