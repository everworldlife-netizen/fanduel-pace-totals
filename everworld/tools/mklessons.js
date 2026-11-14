#!/usr/bin/env node
/* Combine two lesson files by stage of the game.
 * Why: the 2023-24 and 2024-25 play-by-play archives are missing stretches of most games. For the stages that replay a
 * game in progress that hurts (the state of the game is wrong), so lessons from complete games only (2025-26 on) test
 * better there, although they are three times fewer. Before tip-off and in the first quarter nothing has to be replayed
 * and the rare lineup situations need every game, so all games test better. Measured twice on unseen games (NOTES.md).
 *   node tools/mklessons.js --base all.json --mid clean.json [--groups s18,s24,s30,s36] [--team-groups s6,...,s42] --out hybrid.json
 */
'use strict';
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = L.readJSON(path.resolve(L.ROOT, arg('--base'))), B = L.readJSON(path.resolve(L.ROOT, arg('--mid')));
const groups = String(arg('--groups', 's18,s24,s30,s36')).split(',');
const out = JSON.parse(JSON.stringify(A));
for (const g of groups) {
  if (B.PAT_PRIOR[g]) out.PAT_PRIOR[g] = B.PAT_PRIOR[g];
  if (B.CAL_PRIOR && B.CAL_PRIOR[g]) out.CAL_PRIOR[g] = B.CAL_PRIOR[g];
  if (B.TEAM_PRIOR && B.TEAM_PRIOR[g] && out.TEAM_PRIOR) out.TEAM_PRIOR[g] = B.TEAM_PRIOR[g];
}
// the team check (points still to come against the sum of our players) needs the right score at the moment of the
// stage, which incomplete play-by-play does not have: every live stage takes it from the complete games
const teamGroups = String(arg('--team-groups', 's6,s12,s18,s24,s30,s36,s42')).split(',');
if (out.TEAM_PRIOR && B.TEAM_PRIOR) for (const g of teamGroups) if (B.TEAM_PRIOR[g]) out.TEAM_PRIOR[g] = B.TEAM_PRIOR[g];
out.meta = { ...A.meta, hybrid: { base: arg('--base'), mid: arg('--mid'), groups, teamGroups, baseGames: A.meta.games, midGames: B.meta.games } };
L.writeJSON(path.resolve(L.ROOT, arg('--out')), out);
console.log(`stages ${groups.join(', ')} from ${arg('--mid')} (${B.meta.games} games), the rest from ${arg('--base')} (${A.meta.games} games) → ${arg('--out')}`);
