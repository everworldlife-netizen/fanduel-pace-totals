#!/usr/bin/env node
/* Pregame research: value of giving a before-lineups number to the players who have none (deep bench, back from a
 * layoff). "All-in" miss before lineups = every player with 10+ real minutes; one with no number counts his whole line.
 * Rule fitted on the first half of 2026 (players the tip-off stage projects, the before-lineups stage does not, who
 * played 10+), applied to the second half and, fitted on all of 2026, to 2027.
 *   node tools/research/pregame-un3.js
 */
'use strict';
const C = require('./pregame-common');
const feats = (r) => [1, Math.min(r.f.outTot || 0, 150) / 10, r.f.seasonMpg != null ? r.f.seasonMpg : (r.f.lastMpg != null ? r.f.lastMpg : 10)];
const load = (season) => {
  const S = C.prepare(season);
  const repKeys = new Set(S.rows.filter((r) => r.g === 'rep').map((r) => r.id + ':' + r.pid));
  const preKeys = new Set(S.rows.filter((r) => r.g === 'pre').map((r) => r.id + ':' + r.pid));
  const cand = S.rows.filter((r) => r.g === 'pre' && !repKeys.has(r.id + ':' + r.pid) && r.ac && r.ac[0] >= 10);     // no number before lineups, played 10+
  const rep10 = S.rows.filter((r) => r.g === 'rep' && r.ac && r.ac[0] >= 10);
  const seen = new Set(); const none = S.un.filter((u) => { const k = u.id + ':' + u.pid; if (seen.has(k) || preKeys.has(k)) return false; seen.add(k); return true; });  // no number at either stage
  return { S, cand, rep10, none };
};
const A = load(2026), B = load(2027);
const run = (label, train, test, rep10, none) => {
  const m = C.ols(train.map((r) => r.ac[0]), train.map(feats), train.map((r) => r.id));
  const pred = (r) => feats(r).reduce((s, v, i) => s + v * m.beta[i], 0);
  const before = (rep10.reduce((s, r) => s + Math.abs(r.ac[0] - r.pr[0]), 0) + test.reduce((s, r) => s + r.ac[0], 0) + none.reduce((s, r) => s + r.ac[0], 0)) / (rep10.length + test.length + none.length);
  const after = (rep10.reduce((s, r) => s + Math.abs(r.ac[0] - r.pr[0]), 0) + test.reduce((s, r) => s + Math.abs(r.ac[0] - pred(r)), 0) + none.reduce((s, r) => s + r.ac[0], 0)) / (rep10.length + test.length + none.length);
  const tg = new Set(test.map((r) => r.tgk)).size;
  console.log(`${label}: rule = ${m.beta[0].toFixed(1)} + ${m.beta[1].toFixed(2)} x (absent teammates' usual minutes / 10, capped at 15) + ${m.beta[2].toFixed(2)} x (his season minutes a game, else last season's, else 10)   [z ${m.z.map((z) => z.toFixed(1)).join(', ')}]`);
  console.log(`   ${test.length} player-games in ${tg} team-games get a number: their miss ${C.mean(test.map((r) => r.ac[0])).toFixed(2)} (no number) -> ${C.mean(test.map((r) => Math.abs(r.ac[0] - pred(r)))).toFixed(2)}; the tip-off number for the same players misses by ${C.mean(test.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)}; a flat 17 by ${C.mean(test.map((r) => Math.abs(r.ac[0] - 17))).toFixed(2)}`);
  console.log(`   all-in miss before lineups (${rep10.length + test.length + none.length} players with 10+ real minutes): ${before.toFixed(3)} -> ${after.toFixed(3)} = ${(100 * (before - after) / before).toFixed(1)}% less; still without a number: ${none.length}`);
};
const dates = [...new Set(A.S.rows.map((r) => r.d))].sort(), cut = dates[Math.floor(dates.length / 2)];
run(`2026 second half (from ${cut}), fitted on the first half`, A.cand.filter((r) => r.d < cut), A.cand.filter((r) => r.d >= cut), A.rep10.filter((r) => r.d >= cut), A.none.filter((r) => r.d >= cut));
run('2027, fitted on all of 2026', A.cand, B.cand, B.rep10, B.none);
