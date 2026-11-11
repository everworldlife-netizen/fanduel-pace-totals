#!/usr/bin/env node
/* Second learning stage, study tool: can boosted trees on the live state take minutes (and then points, rebounds,
 * assists) closer than the engine's own number? Trains on dump rows from games the lessons never saw, tests on later
 * unseen games. If the trees win clearly on BOTH test sets, the stage is worth building into the app.
 *
 *   node tools/stage2.js --train data/runs/P1d-anch1.rows.json.gz [--split 2026-03-10] --test data/runs/P2-anch1.rows.json.gz
 *        [--rounds 150 --depth 4 --lr 0.06 --leaf 60] [--stat min|pts|reb|ast] [--save data/lessons/stage2.json]
 *
 * Rows: players who went on to play (the number means "if he plays"). Target: real remaining minus the engine's
 * remaining. Headline: average miss for players with 10+ real minutes, paired by game (z beyond 3 = real).
 */
'use strict';
const path = require('path');
const L = require('./lib');
const G = require('./research/late-gbm');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const STAT = arg('--stat', 'min'), SI = { min: 0, pts: 1, reb: 2, ast: 3 }[STAT];
const opt = { rounds: +arg('--rounds', 150), depth: +arg('--depth', 4), lr: +arg('--lr', 0.06), minLeaf: +arg('--leaf', 60) };
const GROUPS = (arg('--groups', 'rep,pre,s6,s12,s18,s24,s30,s36,s42')).split(',');
const read = (f) => L.readJSON(path.resolve(L.ROOT, f)).filter((r) => !r.un && r.g && r.mn && r.ac && r.ac[0] > 0 && r.x);
// what the trees may look at: the engine's own numbers, the player, the game state, and the layer's inputs
const NAMES = ['rem', 'remPlain', 'now', 'mpg', 'st', 'sT', 'on', 'dnp', 'mg', 'amg', 'pf', 'gms', 'hm', 'fm', 'pB', 'share', 'nowPts', 'remPts', 'remReb', 'remAst'];
function feats(r) {
  const rem = r.mn[0] - r.now[0];
  const base = [rem, (r.mp != null ? r.mp : r.mn[0]) - r.now[0], r.now[0], r.mpg || 0, r.st || 0, r.sT == null ? -1 : r.sT, r.on || 0, r.dnp || 0, r.mg || 0, Math.abs(r.mg || 0), r.pf || 0, Math.min(r.gms || 0, 30), r.hm || 0,
    r.fm == null ? 1 : r.fm, r.pB == null ? 0 : r.pB, r.el > 0 ? r.now[0] / r.el : 0, r.now[1], r.mn[1] - r.now[1], r.mn[2] - r.now[2], r.mn[3] - r.now[3]];
  return base.concat(r.x);
}
const all = read(arg('--train'));
const split = arg('--split', null);
const train = split ? all.filter((r) => r.d < split) : all;
const tests = [];
if (split) tests.push(['later games of the training file', all.filter((r) => r.d >= split)]);
for (const f of String(arg('--test', '')).split(',').filter(Boolean)) tests.push([f, read(f)]);
console.log(`stat ${STAT} | train ${train.length} rows, ${new Set(train.map((r) => r.id)).size} games | trees ${opt.rounds} x depth ${opt.depth}, step ${opt.lr}, leaf ${opt.minLeaf}`);
const models = {};
const shown = (r) => r.pr[SI], y0 = (r) => r.ac[SI] - r.mn[SI]; // target: real minus the engine's average
for (const g of GROUPS) {
  const tr = train.filter((r) => r.g === g);
  if (tr.length < 2000) continue;
  const t0 = Date.now();
  models[g] = G.train(tr.map(feats), tr.map(y0), opt);
  process.stderr.write(`  ${g}: ${tr.length} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
// shrink: how much of the trees' correction to apply (1 = all). The shown number can be the average or a blend with the middle; the correction is added to whatever is shown.
for (const [name, rows] of tests) {
  console.log(`\nTEST: ${name} (${new Set(rows.map((r) => r.id)).size} games)`);
  console.log('stage | players 10+ | miss now -> with trees (change, z by game) | for all who played');
  for (const g of GROUPS) {
    if (!models[g]) continue;
    const te = rows.filter((r) => r.g === g);
    if (!te.length) continue;
    const per = {};
    let a = 0, b = 0, n = 0, a2 = 0, b2 = 0, n2 = 0;
    for (const r of te) {
      const corr = G.predict(models[g], feats(r));
      const p0 = shown(r), p1 = Math.max(r.now[SI], p0 + corr);
      const e0 = Math.abs(p0 - r.ac[SI]), e1 = Math.abs(p1 - r.ac[SI]);
      a2 += e0; b2 += e1; n2++;
      if (r.ac[0] >= 10) { a += e0; b += e1; n++; const P = (per[r.id] = per[r.id] || [0, 0, 0]); P[0] += e0; P[1] += e1; P[2]++; }
    }
    const d = Object.values(per).map((P) => (P[1] - P[0]) / P[2]);
    const m = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(d.length - 1, 1));
    console.log(`${g.padEnd(5)} | ${String(n).padStart(6)} | ${(a / n).toFixed(3)} -> ${(b / n).toFixed(3)} (${(100 * (b / a - 1)).toFixed(1)}%, z ${(m / (sd / Math.sqrt(d.length))).toFixed(1)}) | ${(a2 / n2).toFixed(3)} -> ${(b2 / n2).toFixed(3)} (${(100 * (b2 / a2 - 1)).toFixed(1)}%)`);
  }
}
if (arg('--save')) { L.writeJSON(path.resolve(L.ROOT, arg('--save')), { stat: STAT, names: NAMES, opt, models }); console.log(`\n→ ${arg('--save')}`); }
