#!/usr/bin/env node
/* Pregame research: deep-bench players at tip-off (flag dp: under 6 a game over their last 3, on the posted list).
 * The app grades a number only when the player really plays 10+. What number serves them: "if he plays at all" or
 * "if he is in the rotation tonight (10+)"? Fitted on the first half of 2026, applied to the second; and 2026 -> 2027.
 *   node tools/research/pregame-deep.js
 */
'use strict';
const C = require('./pregame-common');
const feats = (r) => [1, Math.min(r.f.outTot || 0, 150) / 10, r.f.seasonMpg != null ? r.f.seasonMpg : (r.f.lastMpg != null ? r.f.lastMpg : 10)];
const S26 = C.prepare(2026), S27 = C.prepare(2027);
const pre = (S) => S.rows.filter((r) => r.g === 'pre' && r.ac && r.ac[0] > 0);
const run = (label, train, test) => {
  const dT = train.filter((r) => r.dp), dE = test.filter((r) => r.dp);
  const mAny = C.ols(dT.map((r) => r.ac[0]), dT.map(feats), dT.map((r) => r.id));
  const d10 = dT.filter((r) => r.ac[0] >= 10); const m10 = C.ols(d10.map((r) => r.ac[0]), d10.map(feats), d10.map((r) => r.id));
  const p = (r, m) => feats(r).reduce((s, v, i) => s + v * m.beta[i], 0);
  const all10 = test.filter((r) => r.ac[0] >= 10), e10 = dE.filter((r) => r.ac[0] >= 10);
  const base = C.mean(all10.map((r) => Math.abs(r.ac[0] - r.pr[0])));
  const withRule = (m) => C.mean(all10.map((r) => Math.abs(r.ac[0] - (r.dp ? p(r, m) : r.pr[0]))));
  console.log(`${label}: ${dE.length} deep-bench players who played (${new Set(dE.map((r) => r.tgk)).size} team-games), ${e10.length} of them 10+ minutes`);
  console.log(`   their miss when 10+: engine ${C.mean(e10.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)} | "if he plays at all" rule ${C.mean(e10.map((r) => Math.abs(r.ac[0] - p(r, mAny)))).toFixed(2)} | "if he is in the rotation" rule ${C.mean(e10.map((r) => Math.abs(r.ac[0] - p(r, m10)))).toFixed(2)}`);
  console.log(`   whole tip-off stage, 10+ players: ${base.toFixed(3)} -> ${withRule(mAny).toFixed(3)} (${(100 * (base - withRule(mAny)) / base).toFixed(2)}%) with the first rule, -> ${withRule(m10).toFixed(3)} (${(100 * (base - withRule(m10)) / base).toFixed(2)}%) with the second`);
  console.log(`   rules: at all = ${mAny.beta.map((b) => b.toFixed(2)).join(' , ')}   in the rotation = ${m10.beta.map((b) => b.toFixed(2)).join(' , ')}   (constant, absent minutes/10, his season minutes a game)`);
  console.log(`   the cost on the others: deep-bench players who played under 10 (${dE.length - e10.length}): engine miss ${C.mean(dE.filter((r) => r.ac[0] < 10).map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)}, second rule ${C.mean(dE.filter((r) => r.ac[0] < 10).map((r) => Math.abs(r.ac[0] - p(r, m10)))).toFixed(2)} (not graded by the app)`);
};
const a = pre(S26); const dates = [...new Set(a.map((r) => r.d))].sort(), cut = dates[Math.floor(dates.length / 2)];
run(`2026 second half, fitted on the first`, a.filter((r) => r.d < cut), a.filter((r) => r.d >= cut));
run('2027, fitted on 2026', a, pre(S27));
