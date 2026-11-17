#!/usr/bin/env node
/* Refit LAND: how much of the "middle" finish (vs the plain average of the simulations) to show at each stage and stat.
 * Reads bt2 dumps (--dump) made on TRAINING games, picks the weight in {0, .25, .5, .75, 1} with the smallest average
 * miss for players with 10+ real minutes, and can check the choice on other dumps.
 *   node tools/fitland.js --fit data/runs/dump-train.json.gz [--check data/runs/dump-test.json.gz] [--out data/lessons/land.json]
 */
'use strict';
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const STATS = ['pts', 'reb', 'ast', 'fg3m', 'min'], W = [0, 0.25, 0.5, 0.75, 1];
// where each stat sits in a dump row: [index in now/mn/ac, the middle value]
const midOf = (r, s, k) => (s === 'min' ? r.mm : r.md[k]);
const ixOf = (s, k) => (s === 'min' ? 0 : k + 1);
const GROUPS = ['rep', 'pre', 's6', 's12', 's18', 's24', 's30', 's36', 's42'];
function sums(file) {
  const out = {};
  for (const r of L.readJSON(path.resolve(L.ROOT, file))) {
    if (r.un || !r.ac || !(r.ac[0] >= 10) || !r.md || !r.g) continue;
    const G = (out[r.g] = out[r.g] || Object.fromEntries(STATS.map((s) => [s, { n: 0, e: W.map(() => 0) }])));
    STATS.forEach((s, k) => { const md = midOf(r, s, k), i = ixOf(s, k); if (md == null) return; const T = G[s]; T.n++; W.forEach((w, j) => { T.e[j] += Math.abs(Math.max(r.now[i], (1 - w) * r.mn[i] + w * md) - r.ac[i]); }); });
  }
  return out;
}
const fit = sums(arg('--fit'));
const land = {};
console.log('stage | stat | players | miss by weight on the middle (0 = plain average ... 1 = middle) | chosen');
for (const g of GROUPS) {
  if (!fit[g]) continue;
  land[g] = {};
  for (const s of STATS) {
    const T = fit[g][s];
    if (!T.n) continue;
    // keep the simpler choice (smaller weight) unless a bigger one is at least 0.2% better
    let best = 0; for (let j = 1; j < W.length; j++) if (T.e[j] < T.e[best] * 0.998) best = j;
    if (W[best] > 0) land[g][s] = W[best];
    console.log(`${g.padEnd(5)} | ${s.padEnd(4)} | ${String(T.n).padStart(6)} | ${T.e.map((x) => (x / T.n).toFixed(4)).join('  ')} | ${W[best]}`);
  }
}
if (arg('--check')) {
  const chk = sums(arg('--check'));
  console.log('\ncheck on other games: miss with the plain average → with the chosen weights');
  for (const g of GROUPS) if (chk[g] && land[g]) console.log(`${g.padEnd(5)} ` + STATS.filter((s) => chk[g][s].n).map((s) => { const T = chk[g][s]; const j = W.indexOf(land[g][s] || 0); return `${s} ${(T.e[0] / T.n).toFixed(4)}→${(T.e[j] / T.n).toFixed(4)}`; }).join(' | '));
}
if (arg('--out')) { L.writeJSON(path.resolve(L.ROOT, arg('--out')), land); console.log(`\n→ ${arg('--out')}`); }
