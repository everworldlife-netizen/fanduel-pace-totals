#!/usr/bin/env node
/* early-02: is the 6-minute number worse for everybody, or only for the players the app grades (10+ real minutes)?
 * Three views of the same player-games at pre / s6 / s12: played 10+, played >0, everyone listed (never in = 0).
 *   node tools/research/early-02-allin.js [2026|2027] */
'use strict';
const L = require('../lib');
const season = process.argv[2] || '2026';
const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
const J = new Map();
for (const r of rows) { if (r.un || !(r.g === 'pre' || r.g === 's6' || r.g === 's12')) continue; const k = r.id + ':' + r.pid; let o = J.get(k); if (!o) J.set(k, (o = {})); o[r.g] = r; }
const all = [...J.values()].filter((o) => o.pre && o.s6 && o.s12);
const acm = (o) => (o.pre.ac ? o.pre.ac[0] : 0);
function cl(list, f) { const m = new Map(); for (const o of list) { const k = o.pre.id + ':' + o.pre.tm; let a = m.get(k); if (!a) m.set(k, (a = [0, 0])); a[0] += f(o); a[1]++; } let S = 0, N = 0; for (const a of m.values()) { S += a[0]; N += a[1]; } const mean = S / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; } const G = m.size; return { mean, z: mean / (Math.sqrt(v * G / (G - 1)) / N), n: N }; }
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
function show(label, list) {
  if (list.length < 30) return;
  let s = `${label.padEnd(30)} n=${String(list.length).padStart(6)}`;
  for (const st of ['pre', 's6', 's12']) { const e = cl(list, (o) => Math.abs(o[st].pr[0] - acm(o))), b = cl(list, (o) => acm(o) - o[st].mn[0]); s += ` | ${st}: miss ${e.mean.toFixed(2)} bias ${f2(b.mean)} (z ${b.z.toFixed(1)})`; }
  const d = cl(list, (o) => Math.abs(o.s6.pr[0] - acm(o)) - Math.abs(o.pre.pr[0] - acm(o)));
  s += ` | s6-pre ${f2(d.mean)} z ${d.z.toFixed(1)}`;
  const never = list.filter((o) => !(acm(o) > 0)).length, lt10 = list.filter((o) => acm(o) < 10).length;
  s += ` | never in ${(100 * never / list.length).toFixed(1)}% <10min ${(100 * lt10 / list.length).toFixed(1)}%`;
  console.log(s);
}
const classes = [['all', () => true], ['starters tonight', (o) => o.pre.sT === 1], ['bench tonight', (o) => o.pre.sT === 0], ['bench, in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 0], ['bench, not in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 1],
  ['  not in by 6, mpg>=24', (o) => o.pre.sT === 0 && o.s6.dnp === 1 && o.pre.mpg >= 24], ['  not in by 6, mpg 18-24', (o) => o.pre.sT === 0 && o.s6.dnp === 1 && o.pre.mpg >= 18 && o.pre.mpg < 24], ['  not in by 6, mpg 12-18', (o) => o.pre.sT === 0 && o.s6.dnp === 1 && o.pre.mpg >= 12 && o.pre.mpg < 18], ['  not in by 6, mpg 6-12', (o) => o.pre.sT === 0 && o.s6.dnp === 1 && o.pre.mpg >= 6 && o.pre.mpg < 12], ['  not in by 6, mpg <6', (o) => o.pre.sT === 0 && o.s6.dnp === 1 && o.pre.mpg < 6],
  ['bench, not in by 12', (o) => o.pre.sT === 0 && o.s12.dnp === 1], ['bench, in by 12', (o) => o.pre.sT === 0 && o.s12.dnp === 0]];
for (const [view, f] of [['PLAYED 10+ (the app rule)', (o) => acm(o) >= 10], ['PLAYED >0', (o) => acm(o) > 0], ['EVERYONE LISTED (never in = 0 minutes)', () => true], ['ALL-IN (real 10+ or shown 10+ at that... using pre shown 10+)', (o) => acm(o) >= 10 || o.pre.pr[0] >= 10]]) {
  console.log(`\n== ${view} ==`);
  for (const [lab, g] of classes) show(lab, all.filter((o) => f(o) && g(o)));
}
// the size of the learned layer's move for not-in players: mn - mp pieces
console.log('\n== engine pieces, bench not in by 6 (everyone listed): plain (mp) vs learned (mn) ==');
for (const [lab, g] of [['bench not in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 1], ['bench in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 0], ['starter on at 6', (o) => o.pre.sT === 1 && o.s6.on === 1], ['starter off at 6', (o) => o.pre.sT === 1 && o.s6.on === 0]]) {
  const li = all.filter(g); const m = (f) => li.reduce((a, o) => a + f(o), 0) / li.length;
  console.log(`${lab.padEnd(20)} n=${li.length} pre: plain ${m((o) => o.pre.mp).toFixed(2)} learned ${m((o) => o.pre.mn[0]).toFixed(2)} | s6: plain ${m((o) => o.s6.mp).toFixed(2)} learned ${m((o) => o.s6.mn[0]).toFixed(2)} | s12: plain ${m((o) => o.s12.mp).toFixed(2)} learned ${m((o) => o.s12.mn[0]).toFixed(2)} | real (all) ${m(acm).toFixed(2)} real (played>0) ${(li.filter((o) => acm(o) > 0).reduce((a, o) => a + acm(o), 0) / li.filter((o) => acm(o) > 0).length).toFixed(2)}`);
}
