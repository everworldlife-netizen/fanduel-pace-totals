#!/usr/bin/env node
/* Compare two bt2 runs on the same games, game by game (paired), so a real gain can be told from luck.
 *   node tools/cmp.js data/runs/A.json data/runs/B.json      (B is the candidate; negative change = B misses less)
 * z is the change divided by its paired standard error across games: beyond about ±2 is unlikely to be luck.
 */
'use strict';
const path = require('path');
const L = require('./lib');
const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: node tools/cmp.js A.json B.json'); process.exit(1); }
const A = L.readJSON(path.resolve(fa)), B = L.readJSON(path.resolve(fb));
const label = { rep: 'pre-lineup', 0: 'tip-off', 12: 'end Q1', 24: 'half', 36: 'end Q3', 42: '6:00 left' };
const COLS = [['PTS', 1, 0], ['REB', 2, 0], ['AST', 3, 0], ['3PM', 4, 0], ['MIN', 5, 0], ['PTS real10', 12, 11], ['MIN real10', 13, 11], ['PTS all-in', 7, 6], ['MIN all-in', 8, 6], ['TOTAL', 9, -1]];
console.log(`A = ${fa}\nB = ${fb}`);
const stages = Object.keys(A.acc).filter((s) => B.acc[s]);
let pooled = {};
for (const s of stages) {
  const pa = A.acc[s].per, pb = B.acc[s].per;
  const ids = Object.keys(pa).filter((id) => pb[id]);
  const line = [`${(label[s] || s + ' min').padEnd(10)} games ${String(ids.length).padStart(4)}`];
  for (const [name, col, ncol] of COLS) {
    let sa = 0, sb = 0, na = 0, nb = 0; const d = [];
    for (const id of ids) {
      const x = pa[id], y = pb[id];
      sa += x[col]; sb += y[col];
      na += ncol < 0 ? 1 : x[ncol]; nb += ncol < 0 ? 1 : y[ncol];
      d.push([y[col], ncol < 0 ? 1 : y[ncol], x[col], ncol < 0 ? 1 : x[ncol]]);
    }
    const ma = sa / Math.max(na, 1), mb = sb / Math.max(nb, 1);
    // paired per-game difference of the per-player misses, weighted by players in the game
    const nbar = (na + nb) / 2 / ids.length;
    const dg = d.map(([yb, nB, xa, nA]) => ((nB ? yb / nB : 0) - (nA ? xa / nA : 0)) * ((nA + nB) / 2 / nbar));
    const mean = dg.reduce((a, b) => a + b, 0) / dg.length;
    const sd = Math.sqrt(dg.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(dg.length - 1, 1));
    const z = sd > 0 ? mean / (sd / Math.sqrt(dg.length)) : 0;
    line.push(`${name} ${ma.toFixed(3)}→${mb.toFixed(3)} (${(100 * (mb / ma - 1)).toFixed(2)}%, z ${z.toFixed(1)})`);
    (pooled[name] = pooled[name] || []).push([ma, mb, z]);
  }
  console.log(line.join(' | '));
}
