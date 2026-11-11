#!/usr/bin/env node
/* Pregame research: realized blowouts against the expected margin, by role (tip-off stage).
 * (a) hindsight: gap (real - engine minutes) by how the game really ended; (b) what the engine could know before:
 * its own blowout chance pB and the books' spread; (c) is the blowout chance calibrated?
 *   node tools/research/pregame-blowout.js [season]
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const H = S.hist;
const rs = S.rows.filter((r) => r.g === 'pre' && r.gap != null);
for (const r of rs) { const tg = H.byKey[r.tgk]; r.fm = tg.margin; r.ot = tg.ot; }
const roles = [['starters', (r) => r.st === 1], ['18-24 a game', (r) => r.st !== 1 && r.mpg >= 18], ['under 18', (r) => r.mpg < 18]];
const tab = (label, f, cuts, names) => {
  console.log(`\n${label}`);
  for (const [nm, rf] of roles) {
    const line = [];
    for (let i = 0; i <= cuts.length; i++) { const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity; const q = rs.filter((r) => rf(r) && f(r) != null && f(r) >= lo && f(r) < hi); if (q.length < 30) { line.push('-'); continue; } const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id)); line.push(`${c.m >= 0 ? '+' : ''}${c.m.toFixed(2)} (${c.z.toFixed(1)}) n${q.length}`); }
    console.log(`  ${nm.padEnd(13)} ` + line.map((s) => s.padEnd(21)).join(''));
  }
  console.log('  ' + ''.padEnd(13) + ' ' + names.map((s) => s.padEnd(21)).join(''));
};
tab('(a) HINDSIGHT: gap by the real final margin of his team (overtime games apart)', (r) => (r.ot ? null : r.fm), [-25, -15, -8, 0, 8, 15, 25], ['lost by 25+', 'lost 15-24', 'lost 8-14', 'lost 1-7', 'won 1-7', 'won 8-14', 'won 15-24', 'won by 25+']);
tab('    overtime games', (r) => (r.ot ? r.ot : null), [2], ['one overtime', 'two or more']);
tab('(b) BEFORE THE GAME: gap by the books\' expected margin for his team', (r) => r.f.fav, [-12, -8, -4, 0, 4, 8, 12], ['dog 12+', 'dog 8-12', 'dog 4-8', 'dog 0-4', 'fav 0-4', 'fav 4-8', 'fav 8-12', 'fav 12+']);
tab('    gap by the engine\'s blowout chance pB', (r) => r.pB, [0.12, 0.18, 0.25, 0.35, 0.5], ['<.12', '.12-.18', '.18-.25', '.25-.35', '.35-.5', '.5+']);
// (c) calibration of pB against 15+ and 20+ finals, per game
const games = new Map(); for (const r of rs) if (!games.has(r.id)) games.set(r.id, { pB: r.pB, am: Math.abs(r.fm), fav: r.f.fav == null ? null : Math.abs(r.f.fav) });
const G = [...games.values()];
console.log(`\n(c) ${G.length} games: final margin 15+ in ${(100 * C.mean(G.map((g) => (g.am >= 15 ? 1 : 0)))).toFixed(1)}%, 20+ in ${(100 * C.mean(G.map((g) => (g.am >= 20 ? 1 : 0)))).toFixed(1)}%, 25+ in ${(100 * C.mean(G.map((g) => (g.am >= 25 ? 1 : 0)))).toFixed(1)}%; the engine's average blowout chance ${(100 * C.mean(G.map((g) => g.pB))).toFixed(1)}%`);
for (const [lo, hi] of [[0, 0.12], [0.12, 0.18], [0.18, 0.25], [0.25, 0.35], [0.35, 0.5], [0.5, 1.01]]) { const q = G.filter((g) => g.pB >= lo && g.pB < hi); if (q.length) console.log(`    pB ${lo}-${hi}: ${q.length} games, mean pB ${(100 * C.mean(q.map((g) => g.pB))).toFixed(0)}%, real 15+ ${(100 * C.mean(q.map((g) => (g.am >= 15 ? 1 : 0)))).toFixed(0)}%, real 20+ ${(100 * C.mean(q.map((g) => (g.am >= 20 ? 1 : 0)))).toFixed(0)}%, mean |spread| ${C.mean(q.filter((g) => g.fav != null).map((g) => g.fav)).toFixed(1)}`); }
// how much of the starters' minutes miss sits in games that ended 15+
const stR = rs.filter((r) => r.st === 1 && r.ac[0] >= 10);
const blow = stR.filter((r) => Math.abs(r.fm) >= 15), close = stR.filter((r) => Math.abs(r.fm) < 15);
console.log(`\nstarters with 10+ minutes: miss ${C.mean(stR.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)} overall; ${C.mean(close.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)} in games decided by under 15 (${close.length}), ${C.mean(blow.map((r) => Math.abs(r.ac[0] - r.pr[0]))).toFixed(2)} in games decided by 15+ (${blow.length}); if the final margin were known and the average gap of its bucket removed, the overall miss would be ` +
  (() => { const b = {}; for (const r of stR) { const k = Math.max(-4, Math.min(4, Math.round(r.fm / 8))) + ':' + (r.ot ? 1 : 0); (b[k] = b[k] || []).push(r.gap); } const mu = {}; for (const k of Object.keys(b)) mu[k] = C.mean(b[k]); return C.mean(stR.map((r) => Math.abs(r.ac[0] - r.pr[0] - mu[Math.max(-4, Math.min(4, Math.round(r.fm / 8))) + ':' + (r.ot ? 1 : 0)]))).toFixed(2); })());
