#!/usr/bin/env node
/* How close can a projection get? Three reference points for points, rebounds and assists, on the same player-games
 * (everyone who really played 10+ minutes and had a number):
 *   ours            the number the engine showed at that stage
 *   + real minutes  our per-minute numbers, but with the minutes he really played (nobody knows those in advance)
 *   + true level    the minutes he really played times his own per-minute average over the REST of the season
 *                   (hindsight: what an oracle that knows his minutes and his true level would say)
 * What is left after the last line is the game-to-game bounce of shots, boards and passes: no projection removes it.
 *   node tools/floor.js --dump data/runs/research-2026.rows.json.gz --season 2026 [--stage 0]
 */
'use strict';
const path = require('path');
const L = require('./lib');
const R = require('./replay');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const season = +arg('--season', 2026);
const rows = L.readJSON(path.resolve(L.ROOT, arg('--dump'))).filter((r) => !r.un && r.ac && r.ac[0] >= 10 && r.mn);
// season totals per player from complete games
const tot = {};
for (const it of L.readJSON(path.join(L.DATA, 'derived', `games-${season}.json.gz`))) {
  if (it.g.postseason || !R.boxOk(it)) continue;
  for (const [pid, a] of Object.entries(it.log.rows)) { const t = tot[pid] = tot[pid] || [0, 0, 0, 0]; t[0] += a.min || 0; t[1] += a.pts || 0; t[2] += a.reb || 0; t[3] += a.ast || 0; }
}
const stages = [...new Set(rows.map((r) => (r.g === 'rep' ? 'rep' : r.el)))];
const name = (s) => (s === 'rep' ? 'before lineups' : s === 0 ? 'tip-off' : `${s} min in`);
console.log('stage           stat  player-games |   ours | + real minutes | + true level (the floor) | share of our miss that is pure bounce');
for (const s of stages) {
  const rs = rows.filter((r) => (r.g === 'rep' ? 'rep' : r.el) === s);
  ['PTS', 'REB', 'AST'].forEach((nm, k) => {
    let n = 0, e0 = 0, e1 = 0, e2 = 0;
    for (const r of rs) {
      const t = tot[r.pid]; if (!t) continue;
      const act = r.ac[k + 1], now = r.now[k + 1], nowMin = r.now[0], am = r.ac[0];
      const restMin = t[0] - am, restStat = t[k + 1] - act;
      if (!(restMin >= 150)) continue; // needs a real sample of his other games
      const remMin = Math.max(r.mn[0] - nowMin, 0.01), remOur = Math.max(r.mn[k + 1] - now, 0);
      n++;
      e0 += Math.abs(r.pr[k + 1] - act);
      e1 += Math.abs(now + (remOur * Math.max(am - nowMin, 0)) / remMin - act);
      e2 += Math.abs(now + (restStat / restMin) * Math.max(am - nowMin, 0) - act);
    }
    if (n) console.log(`${name(s).padEnd(15)} ${nm}   ${String(n).padStart(11)} | ${(e0 / n).toFixed(2).padStart(6)} | ${(e1 / n).toFixed(2).padStart(14)} | ${(e2 / n).toFixed(2).padStart(24)} | ${Math.round((100 * e2) / e0)}%`);
  });
}
