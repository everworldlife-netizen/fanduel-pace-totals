#!/usr/bin/env node
/* Write the in-app accuracy report (ACCURACY in cs/build/app.js) from two bt2 runs on the same unseen games.
 *   node tools/mkaccuracy.js --before data/runs/B-base.json --after data/runs/B-v15.json --train 3586 --note "..." --findings data/accuracy-findings.json [--app cs/build/app.js]
 * before/after must come from `bt2 --out` with stages 0,12,24,36,42 (other stages are ignored).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const B = L.readJSON(path.resolve(L.ROOT, arg('--before'))), A = L.readJSON(path.resolve(L.ROOT, arg('--after')));
const MAP = { pre: '0', q1: '12', half: '24', q3: '36', late: '42' };
const r2 = (x) => +(+x).toFixed(2);
// Fixed population: everyone who really played 10+ minutes. A player with no projection counts as a full miss, so two
// engines that project different sets of players are still judged on exactly the same players.
const side = (R) => Object.fromEntries(Object.entries(MAP).map(([k, s]) => {
  const x = R.sum[s], per = Object.values(R.acc[s].per || {});
  if (per.length && per[0].length >= 17) {
    const t = per.reduce((a, g) => { for (const i of [11, 12, 13, 14, 15, 16]) a[i] = (a[i] || 0) + g[i]; return a; }, {});
    return [k, { pts: r2(t[12] / t[11]), reb: r2(t[14] / t[11]), ast: r2(t[15] / t[11]), fg3m: r2(t[16] / t[11]), min: r2(t[13] / t[11]), top3: +x.top3.toFixed(3), total: r2(x.total), players: t[11] }];
  }
  return [k, { pts: r2(x.pts), reb: r2(x.reb), ast: r2(x.ast), fg3m: r2(x.fg3m), min: r2(x.min), top3: +x.top3.toFixed(3), total: r2(x.total) }];
}));
// stated chance vs how often it happened, all four stats together, in one 10% band
const band = (R, s, lo) => { let n = 0, said = 0, hit = 0; for (const st of ['pts', 'reb', 'ast', 'fg3m']) { const b = R.acc[s].cal[st][Math.round(lo * 10)]; n += b[0]; said += b[1]; hit += b[2]; } return n ? { said: said / n, hit: hit / n, n } : null; };
const calib = [];
for (const [s, when] of [['0', 'at tip-off'], ['24', 'at halftime'], ['36', 'after Q3']]) for (const lo of [0.8, 0.6]) {
  const b = band(B, s, lo), a = band(A, s, lo);
  if (!a || !b || a.n < 200) continue;
  calib.push({ said: `${Math.round(100 * a.said)}% ${when}`, before: `${Math.round(100 * b.hit)}%`, now: `${Math.round(100 * a.hit)}%` });
}
const acc = { games: A.used, trainGames: +arg('--train', 0), note: arg('--note', ''), before: side(B), after: side(A), calib, findings: arg('--findings') ? L.readJSON(path.resolve(L.ROOT, arg('--findings'))) : [] };
const app = path.resolve(L.ROOT, arg('--app', 'cs/build/app.js'));
let s = fs.readFileSync(app, 'utf8');
const i0 = s.indexOf('/*ACCURACY*/'), i1 = s.indexOf('/*END*/');
if (i0 < 0 || i1 < 0) throw new Error('ACCURACY markers not found');
s = s.slice(0, i0 + '/*ACCURACY*/'.length) + JSON.stringify(acc) + s.slice(i1);
fs.writeFileSync(app, s);
console.log(JSON.stringify({ games: acc.games, before: acc.before.pre, after: acc.after.pre, calib }, null, 1));
