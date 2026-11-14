#!/usr/bin/env node
/* early-01: follow the same player from tip-off ('pre') to 6 min ('s6') to 12 min ('s12').
 * Same player-games at all three stages. Miss by class; does the move help or hurt?
 *   node tools/research/early-01-paired.js [2026|2027] */
'use strict';
const L = require('../lib');
const season = process.argv[2] || '2026';
const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
const J = new Map(); // id:pid -> {pre,s6,s12}
for (const r of rows) {
  if (r.un || !(r.g === 'pre' || r.g === 's6' || r.g === 's12')) continue;
  const k = r.id + ':' + r.pid;
  let o = J.get(k); if (!o) J.set(k, (o = {}));
  o[r.g] = r;
}
const all = [...J.values()].filter((o) => o.pre && o.s6 && o.s12);
console.log(`season ${season}: ${all.length} player-games with all three stages`);
const played10 = all.filter((o) => o.pre.ac && o.pre.ac[0] >= 10);
const playedAny = all.filter((o) => o.pre.ac && o.pre.ac[0] > 0);
console.log(`played 10+: ${played10.length}; played >0: ${playedAny.length}`);

// cluster stats by team-game
function clusterMean(list, f, keyF) {
  const m = new Map();
  for (const o of list) { const k = keyF ? keyF(o) : o.pre.id + ':' + o.pre.tm; let a = m.get(k); if (!a) m.set(k, (a = [0, 0])); a[0] += f(o); a[1]++; }
  // ratio estimator: sum f / sum n, se via linearisation
  let S = 0, N = 0; for (const a of m.values()) { S += a[0]; N += a[1]; }
  const mean = S / N; let v = 0; for (const a of m.values()) { const e = a[0] - mean * a[1]; v += e * e; }
  const G = m.size; const se = Math.sqrt(v * G / (G - 1)) / N;
  return { mean, se, z: mean / se, n: N, G };
}
const fmt = (x, d = 3) => (x >= 0 ? ' ' : '') + x.toFixed(d);
function line(label, list) {
  if (list.length < 30) return;
  const e = (st) => clusterMean(list, (o) => Math.abs(o[st].pr[0] - o[st].ac[0]));
  const b = (st) => clusterMean(list, (o) => o[st].ac[0] - o[st].mn[0]);
  const d6 = clusterMean(list, (o) => Math.abs(o.s6.pr[0] - o.s6.ac[0]) - Math.abs(o.pre.pr[0] - o.pre.ac[0]));
  const d12 = clusterMean(list, (o) => Math.abs(o.s12.pr[0] - o.s12.ac[0]) - Math.abs(o.s6.pr[0] - o.s6.ac[0]));
  console.log(`${label.padEnd(34)} n=${String(list.length).padStart(6)} | miss pre ${e('pre').mean.toFixed(2)} s6 ${e('s6').mean.toFixed(2)} s12 ${e('s12').mean.toFixed(2)} | s6-pre ${fmt(d6.mean, 2)} (z ${fmt(d6.z, 1)}) s12-s6 ${fmt(d12.mean, 2)} (z ${fmt(d12.z, 1)}) | bias(real-engine) pre ${fmt(b('pre').mean, 2)} s6 ${fmt(b('s6').mean, 2)} (z ${fmt(b('s6').z, 1)}) s12 ${fmt(b('s12').mean, 2)} (z ${fmt(b('s12').z, 1)})`);
}
console.log('\n== players who really played 10+ ==');
const P = played10;
line('all', P);
line('starts tonight (sT=1)', P.filter((o) => o.pre.sT === 1));
line('  usual starter & starts', P.filter((o) => o.pre.sT === 1 && o.pre.st === 1));
line('  not usual heavy, starts', P.filter((o) => o.pre.sT === 1 && o.pre.st !== 1));
line('bench tonight (sT=0)', P.filter((o) => o.pre.sT === 0));
line('  bench mpg>=24 (usual starter sits)', P.filter((o) => o.pre.sT === 0 && o.pre.mpg >= 24));
line('  bench mpg 18-24', P.filter((o) => o.pre.sT === 0 && o.pre.mpg >= 18 && o.pre.mpg < 24));
line('  bench mpg 12-18', P.filter((o) => o.pre.sT === 0 && o.pre.mpg >= 12 && o.pre.mpg < 18));
line('  bench mpg <12', P.filter((o) => o.pre.sT === 0 && o.pre.mpg < 12));
line('  deep bench flag', P.filter((o) => o.pre.dp === 1));
line('  layoff flag (fr)', P.filter((o) => o.pre.fr === 1));
console.log('\n-- by state at 6 min --');
line('starter, on floor at 6, 6.0 min', P.filter((o) => o.pre.sT === 1 && o.s6.on === 1 && o.s6.now[0] >= 5.99));
line('starter, off floor at 6', P.filter((o) => o.pre.sT === 1 && o.s6.on === 0));
line('starter, on at 6 but sat some', P.filter((o) => o.pre.sT === 1 && o.s6.on === 1 && o.s6.now[0] < 5.99));
line('starter, pf>=2 at 6', P.filter((o) => o.pre.sT === 1 && o.s6.pf >= 2));
line('starter, pf=1 at 6', P.filter((o) => o.pre.sT === 1 && o.s6.pf === 1));
line('starter, pf=0 at 6', P.filter((o) => o.pre.sT === 1 && o.s6.pf === 0));
line('bench, checked in by 6', P.filter((o) => o.pre.sT === 0 && o.s6.dnp === 0));
line('bench, not in by 6', P.filter((o) => o.pre.sT === 0 && o.s6.dnp === 1));
line('bench, in by 6, on at 6', P.filter((o) => o.pre.sT === 0 && o.s6.dnp === 0 && o.s6.on === 1));
line('bench, in by 6, off at 6', P.filter((o) => o.pre.sT === 0 && o.s6.dnp === 0 && o.s6.on === 0));
console.log('\n-- by state at 12 min --');
line('starter, on at 12', P.filter((o) => o.pre.sT === 1 && o.s12.on === 1));
line('starter, off at 12', P.filter((o) => o.pre.sT === 1 && o.s12.on === 0));
line('starter pf>=2 at 12', P.filter((o) => o.pre.sT === 1 && o.s12.pf >= 2));
line('bench, not in by 12', P.filter((o) => o.pre.sT === 0 && o.s12.dnp === 1));
line('bench, in by 12', P.filter((o) => o.pre.sT === 0 && o.s12.dnp === 0));
line('bench, in by 12, on', P.filter((o) => o.pre.sT === 0 && o.s12.dnp === 0 && o.s12.on === 1));
line('bench, in by 12, off', P.filter((o) => o.pre.sT === 0 && o.s12.dnp === 0 && o.s12.on === 0));

// does the move help? regress (ac - mn_pre) on (mn_s6 - mn_pre) through clusters
function slope(list, a, b, label) {
  // y = ac - mn_a ; x = mn_b - mn_a ; slope with cluster-robust se (no intercept + intercept)
  let sx = 0, sy = 0, n = 0; for (const o of list) { sx += o[b].mn[0] - o[a].mn[0]; sy += o[a].ac[0] - o[a].mn[0]; n++; }
  const mx = sx / n, my = sy / n; let sxx = 0, sxy = 0;
  for (const o of list) { const x = o[b].mn[0] - o[a].mn[0] - mx, y = o[a].ac[0] - o[a].mn[0] - my; sxx += x * x; sxy += x * y; }
  const be = sxy / sxx; const m = new Map();
  for (const o of list) { const x = o[b].mn[0] - o[a].mn[0] - mx, y = o[a].ac[0] - o[a].mn[0] - my; const k = o.pre.id + ':' + o.pre.tm; m.set(k, (m.get(k) || 0) + x * (y - be * x)); }
  let v = 0; for (const s of m.values()) v += s * s; const se = Math.sqrt(v) / sxx;
  let ad = 0; for (const o of list) ad += Math.abs(o[b].mn[0] - o[a].mn[0]);
  console.log(`${label.padEnd(34)} n=${String(n).padStart(6)} mean|move| ${(ad / n).toFixed(2)} sd(move) ${Math.sqrt(sxx / n).toFixed(2)} slope of (real - ${a}) on (${b} - ${a}): ${be.toFixed(3)} ± ${se.toFixed(3)}  (1 = move fully right, 0 = pure noise)`);
}
console.log('\n== does the move pre -> s6 help? (players who played >0) ==');
for (const [lab, f] of [['all', () => true], ['starters tonight', (o) => o.pre.sT === 1], ['bench tonight', (o) => o.pre.sT === 0], ['bench, not in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 1], ['bench, in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 0], ['starter on at 6 full', (o) => o.pre.sT === 1 && o.s6.on === 1 && o.s6.now[0] >= 5.99], ['starter off at 6', (o) => o.pre.sT === 1 && o.s6.on === 0]]) {
  slope(played10.filter(f), 'pre', 's6', lab + ' [10+]');
}
console.log('\n== does the move s6 -> s12 help? ==');
for (const [lab, f] of [['all', () => true], ['starters tonight', (o) => o.pre.sT === 1], ['bench tonight', (o) => o.pre.sT === 0], ['bench, not in by 12', (o) => o.pre.sT === 0 && o.s12.dnp === 1], ['bench, in by 12', (o) => o.pre.sT === 0 && o.s12.dnp === 0]]) {
  slope(played10.filter(f), 's6', 's12', lab + ' [10+]');
}
// blend: what weight w on s6 (vs pre) minimises abs miss at s6
console.log('\n== blend w*s6 + (1-w)*pre (shown number pr) : miss by w, players 10+ ==');
for (const [lab, f] of [['all', () => true], ['starters tonight', (o) => o.pre.sT === 1], ['bench tonight', (o) => o.pre.sT === 0], ['bench not in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 1], ['bench in by 6', (o) => o.pre.sT === 0 && o.s6.dnp === 0]]) {
  const li = played10.filter(f); let s = lab.padEnd(22);
  for (const w of [0, 0.25, 0.5, 0.75, 1, 1.25]) { let e = 0; for (const o of li) e += Math.abs(w * o.s6.pr[0] + (1 - w) * o.pre.pr[0] - o.pre.ac[0]); s += ` w${w}:${(e / li.length).toFixed(3)}`; }
  console.log(s);
}
