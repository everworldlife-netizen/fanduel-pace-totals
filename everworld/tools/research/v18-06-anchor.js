#!/usr/bin/env node
/* How much of the book's line belongs in the rest of the game, by game minute? (study of Nov 13, 2026)
 * Final margin = margin now + margin of the rest of the game. For the rest: ours, against the book's spread spread over the
 * time left (spread x minutes left / 48), and the best mix u. Same for the total: points still to come, ours against the
 * book's total minus... the book's total says nothing about the score so far, so there: the plain mix of the two finals.
 *   node tools/research/v18-06-anchor.js <fit run> <check run> [...]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const name = (s) => (s === 'rep' ? 'pre-lineup' : s === '0' ? 'tip-off' : `${s} min`);
const load = (f) => { const run = L.readJSON(path.resolve(f)); const out = {}; for (const [s, A] of Object.entries(run.acc)) { const G = []; for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || !it.market || it.market.total == null || it.market.spreadHome == null || pg[22] == null) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; const el = s === 'rep' ? 0 : +s; G.push({ el, left: Math.max(48 - el, 0), tot: fv + fh + pg[17], line: it.market.total, real: fv + fh, mar: pg[20], spr: it.market.spreadHome, rm: fv - fh, mNow: pg[22], tNow: pg[23] }); } out[s] = G; } return out; };
const sets = process.argv.slice(2).map((f) => ({ name: path.basename(f, '.json'), by: load(f) }));
const grid = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const marMiss = (G, u) => mean(G.map((g) => Math.abs(g.mNow + (1 - u) * (g.mar - g.mNow) + u * g.spr * g.left / 48 - g.rm)));
const totMiss = (G, w) => mean(G.map((g) => Math.abs((1 - w) * g.tot + w * g.line - g.real)));
console.log('MARGIN OF THE REST OF THE GAME: share u of the book\'s spread (spread over the time left). Miss of the final margin.');
console.log('stage       | ' + sets.map((S) => `${S.name}: ours → best u: miss (at u = 0.5)`.padEnd(46)).join(' | '));
for (const s of Object.keys(sets[0].by)) {
  const cells = sets.map((S) => { const G = S.by[s]; if (!G || !G.length) return '-'.padEnd(46); const m = grid.map((u) => marMiss(G, u)); const b = m.indexOf(Math.min(...m)); return `${m[0].toFixed(2)} → ${grid[b].toFixed(1)}: ${m[b].toFixed(2)} (${marMiss(G, 0.5).toFixed(2)}) [n ${G.length}]`.padEnd(46); });
  console.log(name(s).padEnd(11), '|', cells.join(' | '));
}
console.log('\nTOTAL: share w of the book\'s total in the final total.');
console.log('stage       | ' + sets.map((S) => `${S.name}: ours → best w: miss`.padEnd(40)).join(' | '));
for (const s of Object.keys(sets[0].by)) {
  const cells = sets.map((S) => { const G = S.by[s]; if (!G || !G.length) return '-'.padEnd(40); const m = grid.map((w) => totMiss(G, w)); const b = m.indexOf(Math.min(...m)); return `${m[0].toFixed(2)} → ${grid[b].toFixed(1)}: ${m[b].toFixed(2)}`.padEnd(40); });
  console.log(name(s).padEnd(11), '|', cells.join(' | '));
}
