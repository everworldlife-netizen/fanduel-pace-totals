#!/usr/bin/env node
/* Pregame research: a rule for the players with no number before lineups. Candidates = everyone the tip-off stage
 * projects but the before-lineups stage does not (deep bench, back from a layoff) plus the un rows. What did they
 * really play, how often 10+, and which simple number fits those who played 10+ (the only ones the app grades)?
 *   node tools/research/pregame-un2.js [season]
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const H = S.hist;
const repKeys = new Set(S.rows.filter((r) => r.g === 'rep').map((r) => r.id + ':' + r.pid));
const cand = S.rows.filter((r) => r.g === 'pre' && !repKeys.has(r.id + ':' + r.pid));   // projected at tip-off only
const sum = (label, a) => { const pl = a.filter((r) => r.ac && r.ac[0] > 0), p10 = a.filter((r) => r.ac && r.ac[0] >= 10); const tg = new Set(a.map((r) => r.tgk)).size;
  console.log(`  ${label.padEnd(34)} ${String(a.length).padStart(5)} candidates (${tg} team-games) | played ${(100 * pl.length / a.length).toFixed(0)}% | 10+ min ${(100 * p10.length / a.length).toFixed(0)}% | real min if played ${C.mean(pl.map((r) => r.ac[0])).toFixed(1)} | if 10+ ${p10.length ? C.mean(p10.map((r) => r.ac[0])).toFixed(1) : '-'} | tip-off number ${C.mean(a.map((r) => r.mn[0])).toFixed(1)} | tip-off miss on 10+ ${p10.length ? C.mean(p10.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2) : '-'}`); };
console.log(`${season}: players the tip-off stage projects and the before-lineups stage does not`);
sum('all', cand); sum('deep bench (dp)', cand.filter((r) => r.dp)); sum('back from a layoff (fr)', cand.filter((r) => r.fr)); sum('other', cand.filter((r) => !r.dp && !r.fr));
// deep bench: when do they play 10+? by how short-handed the team is
const deep = cand.filter((r) => r.dp);
console.log('\n  deep bench, chance of 10+ real minutes and minutes if played, by team situation:');
const by = (label, f, cuts) => { const line = []; for (let i = 0; i <= cuts.length; i++) { const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity; const q = deep.filter((r) => { const v = f(r); return v != null && v >= lo && v < hi; }); if (q.length < 20) { line.push('-'); continue; } const pl = q.filter((r) => r.ac && r.ac[0] > 0); line.push(`${(100 * q.filter((r) => r.ac && r.ac[0] >= 10).length / q.length).toFixed(0)}% / ${C.mean(pl.map((r) => r.ac[0])).toFixed(1)} (n${q.length})`); } console.log(`    ${label.padEnd(28)} ` + line.map((s) => s.padEnd(20)).join('') + '  cuts ' + cuts.join(',')); };
by('usual minutes out (outTot)', (r) => r.f.outTot, [20, 40, 60, 90, 130]);
by('available regulars (availN10)', (r) => r.f.availN10, [7, 8, 9, 10]);
by('dressed players', (r) => r.f.activeCount, [10, 11, 12, 13, 14]);
by('|spread|', (r) => (r.f.fav == null ? null : Math.abs(r.f.fav)), [3, 6, 9, 12]);
by('his season mpg', (r) => r.f.seasonMpg, [4, 7, 10, 14]);
by('his last-season mpg', (r) => r.f.lastMpg, [8, 12, 16, 22]);
by('same-position minutes out', (r) => r.f.outSame, [1, 15, 30, 50]);
// a number for the ones who end up with 10+ (what the app grades): fitted on the first half, tested on the second
const g10 = cand.concat([]).filter((r) => r.ac && r.ac[0] >= 10);
const dates = [...new Set(g10.map((r) => r.d))].sort(), cut = dates[Math.floor(dates.length / 2)];
const feats = (r) => [1, r.dp ? 1 : 0, Math.min(r.f.outTot || 0, 150) / 10, r.f.seasonMpg != null ? r.f.seasonMpg : (r.f.lastMpg != null ? r.f.lastMpg : 10), r.f.lastMpg != null ? r.f.lastMpg : (r.f.seasonMpg != null ? r.f.seasonMpg : 10), (r.f.outSame || 0) / 10];
const tr = g10.filter((r) => r.d < cut), te = g10.filter((r) => r.d >= cut);
const m = C.ols(tr.map((r) => r.ac[0]), tr.map(feats), tr.map((r) => r.id));
const mAll = C.ols(g10.map((r) => r.ac[0]), g10.map(feats), g10.map((r) => r.id));
const pred = (r, b) => feats(r).reduce((s, v, i) => s + v * b[i], 0);
console.log(`\n  those who played 10+ (${g10.length}; test half ${te.length}): miss of the tip-off number ${C.mean(te.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)}, of a flat ${C.mean(tr.map((r) => r.ac[0])).toFixed(1)}: ${C.mean(te.map((r) => Math.abs(r.ac[0] - C.mean(tr.map((x) => x.ac[0]))))).toFixed(2)}, of the fitted rule: ${C.mean(te.map((r) => Math.abs(r.ac[0] - pred(r, m.beta)))).toFixed(2)}`);
console.log('  fitted rule on all of them: real = ' + ['const', 'deep', 'outTot/10', 'season mpg', 'last-season mpg', 'outSame/10'].map((k, i) => `${mAll.beta[i].toFixed(2)} x ${k} (z ${mAll.z[i].toFixed(1)})`).join(' + '));
